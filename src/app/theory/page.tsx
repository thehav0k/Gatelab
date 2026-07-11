"use client";

import { useCallback, useMemo, useState } from "react";
import { ExpressionInput } from "@/components/theory/expression-input";
import { TruthTable } from "@/components/theory/truth-table";
import { FunctionSummary } from "@/components/theory/function-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dontCares, minterms, parseInput } from "@/lib/core-engine/canonical";
import { formatSigma } from "@/lib/core-engine/format";
import { DONT_CARE, type TruthValue } from "@/lib/core-engine/types";

const INITIAL = "A'B + BC";

export default function TheoryPage() {
  const [source, setSource] = useState(INITIAL);

  // Synchronous for now: at n <= 10 the whole sweep is microseconds. The Web
  // Worker arrives in M2, when Quine-McCluskey (and specifically Petrick) can
  // actually take long enough to be worth moving off the main thread.
  const result = useMemo(() => parseInput(source), [source]);
  const fn = result.ok ? result.value : null;

  /**
   * The truth table is an input mode, not just a view. Rather than introduce a
   * second source of truth, a click rewrites the input box as Σm notation — so
   * the text field stays the one editable surface and the table edit is
   * something you can see, undo, and copy out.
   */
  const toggleRow = useCallback(
    (m: number) => {
      if (!fn) return;
      const next = Uint8Array.from(fn.values);
      const cur = next[m] as TruthValue;
      next[m] = cur === 0 ? 1 : cur === 1 ? DONT_CARE : 0;

      const edited = { ...fn, values: next };
      setSource(
        formatSigma(fn.name, fn.variables, minterms(edited), dontCares(edited)),
      );
    },
    [fn],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Theoretical Workspace
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Type an expression or a sum of minterms. Everything below is derived
          from the same canonical truth vector.
        </p>
      </header>

      <ExpressionInput
        value={source}
        onChange={setSource}
        diagnostics={result.diagnostics}
      />

      {fn && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Truth table</CardTitle>
            </CardHeader>
            <CardContent>
              <TruthTable fn={fn} onToggleRow={toggleRow} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Function</CardTitle>
            </CardHeader>
            <CardContent>
              <FunctionSummary fn={fn} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
