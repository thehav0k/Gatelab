"use client";

import { format } from "@/lib/core-engine/format";
import { cubeLabel, type Minimization } from "@/lib/core-engine/minimizer";
import { cn } from "@/lib/utils";

interface Props {
  min: Minimization;
  canonicalLiterals: number;
  variables: readonly string[];
  highlighted: string | null;
  onHighlight: (label: string | null) => void;
}

export function MinimalForm({
  min,
  canonicalLiterals,
  variables,
  highlighted,
  onHighlight,
}: Props) {
  const saved = canonicalLiterals - min.literals;

  return (
    <div className="space-y-3">
      {/* Each term is hoverable so it cross-highlights with its K-map loop. */}
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-2 font-mono text-lg">
        <span className="text-muted-foreground">
          {min.form === "sop" ? "F =" : "F ="}
        </span>
        {min.cover.length === 0 ? (
          <span>{format(min.expression)}</span>
        ) : (
          min.cover.map((cube, i) => {
            const label = cubeLabel(cube, variables);
            const term = format(termExpr(min, i));
            return (
              <span key={label} className="flex items-baseline">
                {i > 0 && (
                  <span className="text-muted-foreground mx-1.5">
                    {min.form === "sop" ? "+" : "·"}
                  </span>
                )}
                <span
                  onMouseEnter={() => onHighlight(label)}
                  onMouseLeave={() => onHighlight(null)}
                  className={cn(
                    "cursor-pointer rounded px-1 transition-colors",
                    highlighted === label
                      ? "bg-accent text-foreground"
                      : "hover:bg-accent/50",
                  )}
                >
                  {min.form === "pos" ? `(${term})` : term}
                </span>
              </span>
            );
          })
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        {min.literals} literal{min.literals === 1 ? "" : "s"}
        {saved > 0 && (
          <>
            {" "}
            — down from {canonicalLiterals} in the canonical form (
            <span className="text-logic-high">{saved} fewer</span>)
          </>
        )}
        {min.alternativeCovers.length > 0 && (
          <>
            {" · "}
            {min.alternativeCovers.length} other cover
            {min.alternativeCovers.length === 1 ? "" : "s"} of equal cost exist
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Pull one term out of the minimized expression. The expression's top node is
 * the OR (SOP) or AND (POS) of the cover, in cover order — except when there is
 * exactly one term, in which case there is no wrapper node at all.
 */
function termExpr(min: Minimization, i: number) {
  const top = min.expression;
  if (top.kind === "and" || top.kind === "or") {
    const operand = top.operands[i];
    if (operand && min.cover.length > 1) return operand;
  }
  return top;
}
