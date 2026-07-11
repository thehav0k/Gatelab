"use client";

import { useCallback, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { ExpressionInput } from "@/components/theory/expression-input";
import { TruthTable } from "@/components/theory/truth-table";
import { FunctionSummary } from "@/components/theory/function-summary";
import { KMapGrid } from "@/components/theory/kmap-grid";
import { QmTrace } from "@/components/theory/qm-trace";
import { MinimalForm } from "@/components/theory/minimal-form";
import { BuildCircuit } from "@/components/theory/build-circuit";
import { ConstraintMenu } from "@/components/lab/constraint-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalysis } from "@/hooks/use-analysis";
import { dontCares, minterms } from "@/lib/core-engine/canonical";
import { formatSigma } from "@/lib/core-engine/format";
import { literalCount } from "@/lib/core-engine/ast";
import { canonicalPos, canonicalSop } from "@/lib/core-engine/canonical";
import type { Form } from "@/lib/core-engine/minimizer";
import { DONT_CARE, type TruthValue } from "@/lib/core-engine/types";

export default function TheoryPage() {
  // The expression lives in a PERSISTED store, not in local state. A page's
  // useState dies the moment you navigate away, so walking to the lab and back
  // used to silently throw away whatever you had typed. It is a document, not a
  // widget.
  const source = useWorkspaceStore((s) => s.theorySource);
  const setSource = useWorkspaceStore((s) => s.setTheorySource);
  const [form, setForm] = useState<Form>("sop");
  // One highlight, shared by the K-map, the PI chart, and the minimal form —
  // hovering any one of them lights the other two.
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const { analysis, diagnostics, pending } = useAnalysis(source);

  const toggleRow = useCallback(
    (m: number) => {
      if (!analysis) return;
      const { fn } = analysis;
      const next = Uint8Array.from(fn.values);
      const cur = next[m] as TruthValue;
      next[m] = cur === 0 ? 1 : cur === 1 ? DONT_CARE : 0;

      const edited = { ...fn, values: next };
      setSource(
        formatSigma(fn.name, fn.variables, minterms(edited), dontCares(edited)),
      );
    },
    [analysis, setSource],
  );

  const min = analysis?.[form] ?? null;
  const loops = analysis?.loops[form] ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Theoretical Workspace
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Type an expression or a sum of minterms. The K-map loops are the prime
            implicants Quine–McCluskey found — hover either to light up the other.
          </p>
        </div>
        {/* The rule governs BOTH workspaces, so it is reachable from both. */}
        <div className="ml-auto">
          <ConstraintMenu />
        </div>
      </header>

      <ExpressionInput
        value={source}
        onChange={setSource}
        diagnostics={diagnostics}
      />

      {!analysis && pending && <Skeleton className="mt-6 h-64 w-full" />}

      {analysis && min && (
        <>
          <div className="mt-6 flex items-center justify-between gap-4">
            <Tabs value={form} onValueChange={(v) => setForm(v as Form)}>
              <TabsList>
                <TabsTrigger value="sop">Sum of products</TabsTrigger>
                <TabsTrigger value="pos">Product of sums</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Minimal {form === "sop" ? "SOP" : "POS"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MinimalForm
                  min={min}
                  variables={analysis.fn.variables}
                  canonicalLiterals={literalCount(
                    form === "sop"
                      ? canonicalSop(analysis.fn)
                      : canonicalPos(analysis.fn),
                  )}
                  highlighted={highlighted}
                  onHighlight={setHighlighted}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Build it</CardTitle>
              </CardHeader>
              <CardContent>
                <BuildCircuit
                  min={min}
                  variables={analysis.fn.variables}
                  fn={analysis.fn}
                  source={source}
                />
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Karnaugh map
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    grouping {form === "sop" ? "1s" : "0s"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analysis.layout ? (
                  <div className="space-y-4">
                    <KMapGrid
                      fn={analysis.fn}
                      layout={analysis.layout}
                      loops={loops}
                      highlighted={highlighted}
                      onHighlight={setHighlighted}
                    />
                    <ul className="space-y-1 text-xs">
                      {loops.map((loop) => (
                        <li
                          key={loop.label}
                          onMouseEnter={() => setHighlighted(loop.label)}
                          onMouseLeave={() => setHighlighted(null)}
                          className="flex cursor-pointer items-center gap-2"
                        >
                          {/* --loop-N, not --color-loop-N — see kmap-grid.tsx. */}
                          <span
                            className="size-3 shrink-0 rounded-sm"
                            style={{
                              backgroundColor: `var(--loop-${loop.colorIndex + 1})`,
                            }}
                          />
                          <code>{loop.label}</code>
                          <span className="text-muted-foreground">
                            {loop.cells.length} cell
                            {loop.cells.length === 1 ? "" : "s"}
                            {loop.eliminated.length > 0 && (
                              <> · {loop.eliminated.join(", ")} cancel out</>
                            )}
                            {loop.wraps && (
                              <span className="text-logic-z"> · wraps</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    A K-map stops being readable above 4 variables. The
                    Quine–McCluskey trace still works.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Quine–McCluskey, step by step
                </CardTitle>
              </CardHeader>
              <CardContent>
                <QmTrace
                  trace={min.trace}
                  highlighted={highlighted}
                  onHighlight={setHighlighted}
                />
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Truth table</CardTitle>
              </CardHeader>
              <CardContent>
                <TruthTable fn={analysis.fn} onToggleRow={toggleRow} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Function</CardTitle>
              </CardHeader>
              <CardContent>
                <FunctionSummary fn={analysis.fn} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
