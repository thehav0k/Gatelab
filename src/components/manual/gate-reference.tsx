"use client";

import { Check, X } from "lucide-react";
import { GateSymbol } from "@/components/lab/gate-symbol";
import { GATE_H, GATE_W } from "@/lib/simulation/parts";
import { Badge } from "@/components/ui/badge";
import { GATE_DOCS, LOGIC_DOCS } from "@/lib/simulation/reference";
import { cn } from "@/lib/utils";

/**
 * The gate reference.
 *
 * Every table on this page is COMPUTED by calling the simulator's own `evalGate`
 * (see reference.ts), not typed out here. A hand-written truth table in a docs page
 * is a second source of truth, and the day someone changes the gate logic without
 * changing the prose, the manual starts lying to students with total confidence.
 */
export function GateReference() {
  return (
    <div className="space-y-4">
      {GATE_DOCS.map((gate) => (
        <div key={gate.op} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-start gap-4">
            {/* GateSymbol renders a bare <g>, so it needs an <svg> and a viewBox to
                live in. The box is padded to leave room for the XOR arc, which sits
                OUTSIDE the body at negative x, and the inversion bubble, which sits
                past the right edge. */}
            <div className="bg-muted/40 flex h-16 w-24 shrink-0 items-center justify-center rounded-md border">
              <svg
                viewBox={`-14 -6 ${GATE_W + 32} ${GATE_H + 12}`}
                className="fill-card stroke-foreground/80 h-12 w-20"
                strokeWidth={1.5}
                aria-hidden
              >
                <GateSymbol op={gate.op} />
              </svg>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{gate.label}</h3>
                <code className="text-muted-foreground text-sm">{gate.algebra}</code>
                {gate.chips.map((part) => (
                  <Badge key={part} variant="secondary" className="font-mono text-[10px]">
                    {part}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 text-sm">{gate.definition}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
            {/* --- the truth table --- */}
            <table className="h-fit overflow-hidden rounded-md border text-sm">
              <thead className="bg-muted/60">
                <tr>
                  {gate.table[0]?.inputs.map((_, i) => (
                    <th key={i} className="px-3 py-1.5 font-mono text-xs font-medium">
                      {gate.table[0]!.inputs.length === 1
                        ? "A"
                        : String.fromCharCode(65 + i)}
                    </th>
                  ))}
                  <th className="bg-muted px-3 py-1.5 font-mono text-xs font-medium">
                    Y
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {gate.table.map((row, i) => (
                  <tr key={i} className="border-t">
                    {row.inputs.map((bit, j) => (
                      <td
                        key={j}
                        className="text-muted-foreground px-3 py-1 text-center text-xs"
                      >
                        {bit}
                      </td>
                    ))}
                    <td
                      className={cn(
                        "bg-muted/40 px-3 py-1 text-center text-xs font-semibold",
                        row.out === 1 ? "text-logic-high" : "text-muted-foreground",
                      )}
                    >
                      {row.out}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* --- the properties --- */}
            <ul className="space-y-1.5">
              {gate.properties.map((p) => (
                <li key={p.name} className="flex gap-2 text-xs">
                  {p.holds ? (
                    <Check className="text-logic-high mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <X className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className={cn("font-medium", !p.holds && "text-muted-foreground")}>
                      {p.name}
                    </span>
                    <span className="text-muted-foreground"> — {p.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-muted-foreground mt-3 border-l-2 pl-3 text-xs text-pretty">
            {gate.note}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * The four values. This is the one table that separates the lab from a boolean
 * simulator, so it is worth its own box rather than a footnote.
 */
export function LogicValues() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {LOGIC_DOCS.map((v) => (
        <div key={v.value} className="rounded-md border p-3">
          <div className="flex items-center gap-2">
            <code
              className={cn(
                "flex size-7 items-center justify-center rounded border font-semibold",
                v.value === "1" && "text-logic-high",
                v.value === "0" && "text-muted-foreground",
                v.value === "Z" && "text-logic-z",
                v.value === "X" && "text-logic-x",
              )}
            >
              {v.value}
            </code>
            <span className="text-sm font-medium">{v.name}</span>
          </div>
          <p className="text-muted-foreground mt-1.5 text-xs text-pretty">{v.meaning}</p>
        </div>
      ))}
    </div>
  );
}
