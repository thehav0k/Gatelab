"use client";

import { bitOf, DONT_CARE, type BooleanFunction, type TruthValue } from "@/lib/core-engine/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Beyond this, a truth table is a DOM problem before it is a compute problem —
 * and nobody reads 1024 rows anyway. We render a prefix and say so, rather than
 * freezing the tab and pretending we didn't.
 */
const MAX_RENDERED_ROWS = 256;

const GLYPH: Readonly<Record<TruthValue, string>> = { 0: "0", 1: "1", 2: "X" };

interface Props {
  fn: BooleanFunction;
  /** Cycles the row 0 → 1 → X → 0. Omit to render read-only. */
  onToggleRow?: (minterm: number) => void;
}

export function TruthTable({ fn, onToggleRow }: Props) {
  const n = fn.variables.length;
  const rows = fn.values.length;
  const shown = Math.min(rows, MAX_RENDERED_ROWS);

  return (
    <div className="flex min-h-0 flex-col">
      <ScrollArea className="h-[420px] rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0 backdrop-blur">
            <tr className="border-b">
              <th className="text-muted-foreground w-12 px-3 py-2 text-left font-medium tabular-nums">
                #
              </th>
              {fn.variables.map((v) => (
                <th key={v} className="px-3 py-2 text-left font-medium">
                  {v}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">{fn.name}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {Array.from({ length: shown }, (_, m) => {
              const value = fn.values[m] as TruthValue;
              return (
                <tr key={m} className="hover:bg-muted/40 border-b last:border-0">
                  <td className="text-muted-foreground px-3 py-1 tabular-nums">
                    {m}
                  </td>
                  {fn.variables.map((v, i) => (
                    <td key={v} className="text-muted-foreground px-3 py-1">
                      {bitOf(m, i, n)}
                    </td>
                  ))}
                  <td className="px-3 py-1">
                    <button
                      type="button"
                      disabled={!onToggleRow}
                      onClick={() => onToggleRow?.(m)}
                      aria-label={`Row ${m}: ${GLYPH[value]}`}
                      className={cn(
                        "w-7 rounded text-center font-semibold",
                        onToggleRow && "hover:bg-accent cursor-pointer",
                        value === 1 && "text-logic-high",
                        value === DONT_CARE && "text-logic-z",
                        value === 0 && "text-muted-foreground",
                      )}
                    >
                      {GLYPH[value]}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>

      {shown < rows && (
        <p className="text-muted-foreground mt-2 text-xs">
          Showing the first {shown} of {rows} rows.
        </p>
      )}
      {onToggleRow && (
        <p className="text-muted-foreground mt-2 text-xs">
          Click a value in the {fn.name} column to cycle it 0 → 1 → X.
        </p>
      )}
    </div>
  );
}
