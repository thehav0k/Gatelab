"use client";

import { deriveSteps } from "@/lib/core-engine/derivation";
import type { Minimization } from "@/lib/core-engine/minimizer";
import type { BooleanFunction } from "@/lib/core-engine/types";

/**
 * The derivation, in words.
 *
 * The QM trace shows *what* the algorithm did — the groups, the chart, the
 * expansion. This shows *why*, in the order a person would work it on paper. A
 * student staring at a prime-implicant chart does not need another table; they
 * need the sentence that joins one table to the next.
 *
 * All the reasoning lives in `deriveSteps` (src/lib), so this component has none.
 */
export function DerivationPanel({
  fn,
  min,
}: {
  fn: BooleanFunction;
  min: Minimization;
}) {
  const steps = deriveSteps(fn, min);

  return (
    <ol className="space-y-5">
      {steps.map((step) => (
        <li key={step.n} className="flex gap-3">
          <span className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs">
            {step.n}
          </span>

          <div className="min-w-0 flex-1 space-y-1.5">
            <h3 className="text-sm font-medium">{step.title}</h3>
            <p className="text-muted-foreground text-sm text-pretty">{step.explain}</p>

            {step.result && (
              <div className="bg-muted/60 rounded-md border px-3 py-2">
                <code className="text-sm break-words">{step.result}</code>
              </div>
            )}

            {step.rows && step.rows.length > 0 && (
              <ul className="space-y-0.5 pt-0.5">
                {step.rows.map((row, i) => (
                  <li key={i} className="text-muted-foreground font-mono text-xs">
                    {row}
                  </li>
                ))}
              </ul>
            )}

            {step.note && (
              <p className="text-muted-foreground border-l-2 pl-3 text-xs text-pretty italic">
                {step.note}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
