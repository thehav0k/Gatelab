"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BookOpen } from "lucide-react";
import { ExpressionInput } from "@/components/theory/expression-input";
import { TruthTableEditor } from "@/components/theory/truth-table-editor";
import { FunctionSummary } from "@/components/theory/function-summary";
import { KMapGrid } from "@/components/theory/kmap-grid";
import { QmTrace } from "@/components/theory/qm-trace";
import { MinimalForm } from "@/components/theory/minimal-form";
import { DerivationPanel } from "@/components/theory/derivation-panel";
import { BuildCircuit } from "@/components/theory/build-circuit";
import { CircuitView } from "@/components/theory/circuit-view";
import { BlockDiagramView } from "@/components/theory/block-diagram-view";
import { FunctionLibrary } from "@/components/theory/function-library";
import { ConstraintMenu } from "@/components/lab/constraint-menu";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SequentialView } from "@/components/theory/sequential-view";
import { Skeleton } from "@/components/ui/skeleton";

import { useAnalysis } from "@/hooks/use-analysis";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { literalCount } from "@/lib/core-engine/ast";
import { canonicalPos, canonicalSop } from "@/lib/core-engine/canonical";
import type { Form } from "@/lib/core-engine/minimizer";

/**
 * The theory workspace.
 *
 * ONE DOCUMENT, FIVE VIEWS. The expression box at the top is the document; the
 * tabs below are ways of looking at it. Editing the truth table rewrites the
 * expression and editing the expression redraws the truth table — because they
 * are the same thing, not two things that have to be kept in sync.
 *
 * It used to be one long scroll with everything on it at once, which made it
 * impossible to see which part mattered.
 */
const VALID_TABS = [
  "derivation",
  "table",
  "kmap",
  "tabular",
  "circuit",
  "diagram",
  "build",
] as const;

function TheoryContent() {
  const searchParams = useSearchParams();
  const paramTab = searchParams.get("tab");
  const paramMode = searchParams.get("mode");
  const [designMode, setDesignMode] = useState<"combinational" | "sequential">(
    paramMode === "sequential" ? "sequential" : "combinational",
  );
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [prevParamTab, setPrevParamTab] = useState<string | null>(paramTab);

  if (paramTab !== prevParamTab) {
    setPrevParamTab(paramTab);
    setSelectedTab(null);
  }

  const activeTab =
    selectedTab ??
    (paramTab && (VALID_TABS as readonly string[]).includes(paramTab)
      ? paramTab
      : "derivation");

  const source = useWorkspaceStore((s) => s.theorySource);
  const setSource = useWorkspaceStore((s) => s.setTheorySource);

  const [form, setForm] = useState<Form>("sop");
  // One highlight, shared by the K-map, the PI chart and the minimal form.
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const { analysis, diagnostics, pending } = useAnalysis(source);
  const min = analysis?.[form] ?? null;
  const loops = analysis?.loops[form] ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Theory</h1>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={designMode}
              onValueChange={(v) => {
                if (v === "combinational" || v === "sequential") setDesignMode(v);
              }}
              className="h-8"
              aria-label="Design mode selector"
            >
              <ToggleGroupItem value="combinational" className="px-2.5 text-xs font-medium">
                Combinational
              </ToggleGroupItem>
              <ToggleGroupItem value="sequential" className="px-2.5 text-xs font-medium">
                Sequential
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl text-pretty">
            {designMode === "combinational"
              ? "One function, many views. Write an expression, minterms, or truth table — see it derived, mapped, and reduced to minimal logic."
              : "Sequential circuit design: Synchronous counters, state transition tables, flip-flop excitation equations (JK, D, T), and hardware realization."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {designMode === "combinational" && <FunctionLibrary onPick={setSource} />}
          <ConstraintMenu />
          <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
            <Link href={designMode === "sequential" ? "/manual#sequential" : "/manual#theory"}>
              <BookOpen className="size-3.5" /> Manual
            </Link>
          </Button>
        </div>
      </header>

      {designMode === "sequential" ? (
        <SequentialView />
      ) : (
        <>
          <ExpressionInput value={source} onChange={setSource} diagnostics={diagnostics} />

          {!analysis && pending && <Skeleton className="mt-6 h-96 w-full" />}

      {analysis && min && (
        <>
          {/* The answer, always visible. Whichever tab you are on, this is what you
              came for. */}
          <Card className="mt-5">
            <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:items-center sm:gap-4">
              <CardTitle className="text-base">
                Minimal {form === "sop" ? "SOP" : "POS"}
              </CardTitle>
              <Tabs value={form} onValueChange={(v) => setForm(v as Form)}>
                <TabsList className="h-8 w-full sm:w-auto">
                  <TabsTrigger value="sop" className="text-xs">
                    Sum of products
                  </TabsTrigger>
                  <TabsTrigger value="pos" className="text-xs">
                    Product of sums
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <MinimalForm
                min={min}
                variables={analysis.fn.variables}
                canonicalLiterals={literalCount(
                  form === "sop" ? canonicalSop(analysis.fn) : canonicalPos(analysis.fn),
                )}
                highlighted={highlighted}
                onHighlight={setHighlighted}
              />
            </CardContent>
          </Card>

          <Tabs value={activeTab} onValueChange={setSelectedTab} className="mt-5">
            {/* Seven tabs do not fit on narrow screens. Scroll them smoothly rather than
                clipping the last tabs off the edge. */}
            <div className="w-full overflow-x-auto pb-1">
              <TabsList className="inline-flex h-auto w-max justify-start gap-1 p-1">
                <TabsTrigger value="derivation">How it was derived</TabsTrigger>
                <TabsTrigger value="table">Truth table</TabsTrigger>
                <TabsTrigger value="kmap">K-map</TabsTrigger>
                <TabsTrigger value="tabular">Tabular method</TabsTrigger>
                <TabsTrigger value="circuit">Circuit</TabsTrigger>
                <TabsTrigger value="diagram">Block diagram</TabsTrigger>
                <TabsTrigger value="build">Build it</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="derivation" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Step by step
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      the way you would work it on paper
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DerivationPanel fn={analysis.fn} min={min} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="table" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Truth table
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        editable
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TruthTableEditor fn={analysis.fn} onChange={setSource} />
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
            </TabsContent>

            <TabsContent value="kmap" className="mt-4">
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
                    <div className="flex flex-wrap gap-8">
                      <KMapGrid
                        fn={analysis.fn}
                        layout={analysis.layout}
                        loops={loops}
                        highlighted={highlighted}
                        onHighlight={setHighlighted}
                      />
                      <ul className="min-w-64 flex-1 space-y-1.5 text-sm">
                        {loops.map((loop) => (
                          <li
                            key={loop.label}
                            onMouseEnter={() => setHighlighted(loop.label)}
                            onMouseLeave={() => setHighlighted(null)}
                            className="flex cursor-pointer items-center gap-2"
                          >
                            <span
                              className="size-3 shrink-0 rounded-sm"
                              style={{
                                backgroundColor: `var(--loop-${loop.colorIndex + 1})`,
                              }}
                            />
                            <code>{loop.label}</code>
                            <span className="text-muted-foreground text-xs">
                              {loop.cells.length} cell{loop.cells.length === 1 ? "" : "s"}
                              {loop.eliminated.length > 0 && (
                                <> · {loop.eliminated.join(", ")} cancel out</>
                              )}
                              {loop.wraps && <span className="text-logic-z"> · wraps</span>}
                            </span>
                          </li>
                        ))}
                        <li className="text-muted-foreground pt-3 text-xs text-pretty">
                          The loops are not drawn by a second algorithm — they <em>are</em>{" "}
                          the prime implicants the tabular method found, rendered onto the
                          grid.
                        </li>
                      </ul>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      A K-map stops being readable above 4 variables. The tabular method
                      still works — see the other tabs.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tabular" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Quine–McCluskey
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      every intermediate table
                    </span>
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
            </TabsContent>

            <TabsContent value="circuit" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Circuit
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      gates, chips, and the wiring between them
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CircuitView min={min} variables={analysis.fn.variables} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="diagram" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Block diagram
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      four ways to implement the same function — and export any of them
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BlockDiagramView fn={analysis.fn} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="build" className="mt-4">
              <Card className="max-w-2xl">
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
            </TabsContent>
          </Tabs>
        </>
      )}

          {/* Prompt card to switch to sequential when in combinational */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/50 p-4 text-xs">
            <div>
              <p className="font-medium text-foreground">Need synchronous counters or state machines?</p>
              <p className="text-muted-foreground mt-0.5">
                Switch to Sequential mode to derive flip-flop excitation equations (JK, D, T) and excitation tables.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDesignMode("sequential")}
              className="text-xs"
            >
              Open Sequential Design
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function TheorySkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mt-6 h-96 w-full" />
      </div>
    </div>
  );
}

export default function TheoryPage() {
  return (
    <Suspense fallback={<TheorySkeleton />}>
      <TheoryContent />
    </Suspense>
  );
}

