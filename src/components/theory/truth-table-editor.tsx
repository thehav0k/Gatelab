"use client";

import { useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { truthRows } from "@/lib/core-engine/derivation";
import { formatSigma } from "@/lib/core-engine/format";
import { dontCares, minterms } from "@/lib/core-engine/canonical";
import { DONT_CARE, type BooleanFunction, type TruthValue } from "@/lib/core-engine/types";
import { cn } from "@/lib/utils";

const GLYPH: Readonly<Record<TruthValue, string>> = { 0: "0", 1: "1", 2: "X" };

interface Props {
  fn: BooleanFunction;
  /** Rewrites the source string — the single source of truth. */
  onChange: (source: string) => void;
}

/**
 * The truth table as an EDITOR.
 *
 * You can rename the variables and set every output. What you cannot do is edit
 * the input columns — and that is not an oversight. A truth table's rows ARE the
 * enumeration of every input combination, in order; "editing" a 0 to a 1 in the
 * A column would not change the function, it would just put the rows in the wrong
 * places. The rows are the question. The output column is the answer, and that is
 * what you fill in.
 *
 * Every edit rewrites the SOURCE STRING (as Σm notation), so the expression box,
 * this table, the K-map and the circuit stay four views of one document rather
 * than four things that have to be kept in sync.
 */
export function TruthTableEditor({ fn, onChange }: Props) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const rows = truthRows(fn);
  const n = fn.variables.length;

  const rewrite = (values: Uint8Array, variables: readonly string[]) => {
    const edited: BooleanFunction = { ...fn, variables: [...variables], values };
    onChange(
      formatSigma(fn.name, variables, minterms(edited), dontCares(edited)),
    );
  };

  const cycle = (m: number) => {
    const values = Uint8Array.from(fn.values);
    const cur = values[m] as TruthValue;
    values[m] = cur === 0 ? 1 : cur === 1 ? DONT_CARE : 0;
    rewrite(values, fn.variables);
  };

  const setAll = (v: TruthValue) => {
    rewrite(new Uint8Array(fn.values.length).fill(v), fn.variables);
  };

  const rename = (i: number, raw: string) => {
    const name = raw.trim().toUpperCase().slice(0, 2);
    if (!/^[A-Z][0-9]?$/.test(name)) return;
    if (fn.variables.some((v, j) => j !== i && v === name)) return;

    const variables = fn.variables.map((v, j) => (j === i ? name : v));
    rewrite(Uint8Array.from(fn.values), variables);
  };

  /**
   * Changing the variable count RESIZES the table. Growing keeps the existing
   * rows (a new MSB of 0 leaves the old function on the bottom half); shrinking
   * keeps the top half and drops the rest, which is the only honest thing to do
   * with rows that no longer exist.
   */
  const resize = (delta: number) => {
    const next = Math.min(6, Math.max(1, n + delta));
    if (next === n) return;

    const variables = Array.from({ length: next }, (_, i) =>
      fn.variables[i] ?? String.fromCharCode(65 + i),
    );
    const values = new Uint8Array(1 << next);
    const keep = Math.min(fn.values.length, values.length);
    values.set(fn.values.slice(0, keep));
    rewrite(values, variables);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          {n} variable{n === 1 ? "" : "s"} · {fn.values.length} rows
        </span>
        <Button variant="outline" size="sm" className="size-7 p-0" onClick={() => resize(-1)}>
          <Minus className="size-3.5" />
        </Button>
        <Button variant="outline" size="sm" className="size-7 p-0" onClick={() => resize(1)}>
          <Plus className="size-3.5" />
        </Button>

        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAll(0)}>
            <RotateCcw className="size-3" /> all 0
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAll(1)}>
            all 1
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[380px] rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 sticky top-0 backdrop-blur">
            <tr className="border-b">
              <th className="text-muted-foreground w-10 px-2 py-2 text-left text-xs font-medium">
                #
              </th>
              {fn.variables.map((v, i) => (
                <th key={i} className="px-2 py-1.5 text-left font-medium">
                  {renaming === i ? (
                    <Input
                      autoFocus
                      defaultValue={v}
                      onBlur={(e) => {
                        rename(i, e.target.value);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          rename(i, e.currentTarget.value);
                          setRenaming(null);
                        }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="h-6 w-12 px-1 font-mono text-xs"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRenaming(i)}
                      className="hover:bg-accent rounded px-1 font-mono"
                      title="Rename this variable"
                    >
                      {v}
                    </button>
                  )}
                </th>
              ))}
              <th className="px-2 py-1.5 text-left font-medium">
                <span className="font-mono">{fn.name}</span>
              </th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row) => (
              <tr
                key={row.minterm}
                className={cn(
                  "hover:bg-muted/40 border-b last:border-0",
                  row.output === 1 && "bg-logic-high/5",
                )}
              >
                <td className="text-muted-foreground px-2 py-1 text-xs tabular-nums">
                  {row.minterm}
                </td>
                {/* The input columns are the ENUMERATION. They are not editable
                    because editing them would not change the function — it would
                    just put the rows out of order. */}
                {row.inputs.map((bit, i) => (
                  <td key={i} className="text-muted-foreground px-2 py-1">
                    {bit}
                  </td>
                ))}
                <td className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => cycle(row.minterm)}
                    className={cn(
                      "hover:bg-accent w-7 cursor-pointer rounded text-center font-semibold",
                      row.output === 1 && "text-logic-high",
                      row.output === DONT_CARE && "text-logic-z",
                      row.output === 0 && "text-muted-foreground",
                    )}
                  >
                    {GLYPH[row.output]}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>

      <p className="text-muted-foreground text-xs">
        Click a value in the <span className="font-mono">{fn.name}</span> column to
        cycle it 0 → 1 → X. Click a variable name to rename it. The input columns
        are fixed — they are the enumeration of every combination, which is the
        question, not the answer.
      </p>
    </div>
  );
}
