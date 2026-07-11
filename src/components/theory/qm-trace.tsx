"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { TriangleAlert } from "lucide-react";
import { cubePattern, type MinimizationTrace } from "@/lib/core-engine/minimizer";
import { cn } from "@/lib/utils";

interface Props {
  trace: MinimizationTrace;
  /** Cross-highlighting with the K-map. */
  highlighted: string | null;
  onHighlight: (label: string | null) => void;
}

export function QmTrace({ trace, highlighted, onHighlight }: Props) {
  const n = trace.variables.length;

  if (trace.degenerate) {
    return (
      <p className="text-muted-foreground text-sm">
        {trace.degenerate === "always-true"
          ? "Every care row is 1, so the function is the constant 1. There is nothing to minimize."
          : "There are no minterms, so the function is the constant 0."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {trace.approximated && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Minimum cover approximated</AlertTitle>
          <AlertDescription>
            Petrick&apos;s expansion exceeded its search budget, so this cover
            came from a greedy fallback. It is a valid cover but may not be the
            smallest one.
          </AlertDescription>
        </Alert>
      )}

      <Accordion type="multiple" defaultValue={["col-0", "chart"]}>
        {/* --- 1. the combining columns ------------------------------------ */}
        {trace.columns.map((col) => (
          <AccordionItem key={col.index} value={`col-${col.index}`}>
            <AccordionTrigger className="text-sm">
              {col.index === 0
                ? "Step 1 — group the minterms by number of 1s"
                : `Step ${col.index + 1} — combine terms differing in one bit`}
              <Badge variant="secondary" className="ml-auto mr-2 font-normal">
                {col.merges.length} merge{col.merges.length === 1 ? "" : "s"}
              </Badge>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                {col.groups.map((group) => (
                  <div key={group.ones}>
                    <div className="text-muted-foreground mb-1 text-xs">
                      {group.ones} one{group.ones === 1 ? "" : "s"}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.entries.map((entry) => (
                        <span
                          key={cubePattern(entry.cube, n) + entry.cube.covers.join()}
                          onMouseEnter={() => onHighlight(entry.label)}
                          onMouseLeave={() => onHighlight(null)}
                          className={cn(
                            "rounded border px-2 py-1 font-mono text-xs",
                            // A term that never combined can grow no further: it
                            // is prime. That is the whole point of the tick.
                            !entry.combined && "border-logic-high/50 bg-logic-high/10",
                            entry.isDontCareOnly && "opacity-50",
                            highlighted === entry.label && "ring-ring ring-2",
                          )}
                          title={`m(${entry.cube.covers.join(",")})${
                            entry.isDontCareOnly ? " — don't-cares only" : ""
                          }`}
                        >
                          {cubePattern(entry.cube, n)}
                          <span className="text-muted-foreground ml-1.5">
                            {entry.cube.covers.join(",")}
                          </span>
                          {!entry.combined && (
                            <span className="text-logic-high ml-1.5">✓</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}

                {col.merges.length > 0 && (
                  <p className="text-muted-foreground text-xs">
                    Terms marked ✓ combined with nothing, so they can grow no
                    further — those are the prime implicants.
                  </p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}

        {/* --- 2. the prime implicant chart -------------------------------- */}
        <AccordionItem value="chart">
          <AccordionTrigger className="text-sm">
            Prime implicant chart
            <Badge variant="secondary" className="ml-auto mr-2 font-normal">
              {trace.chart.rows.length} PI
              {trace.chart.rows.length === 1 ? "" : "s"}
            </Badge>
          </AccordionTrigger>
          <AccordionContent>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-1" />
                    {trace.chart.columns.map((m) => (
                      <th
                        key={m}
                        className="text-muted-foreground px-2 py-1 font-mono text-xs font-normal"
                      >
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trace.chart.rows.map((row) => {
                    const essential = trace.essentials.some(
                      (e) => e.cube === row.cube,
                    );
                    return (
                      <tr
                        key={row.label}
                        onMouseEnter={() => onHighlight(row.label)}
                        onMouseLeave={() => onHighlight(null)}
                        className={cn(
                          "hover:bg-accent/50 cursor-pointer border-t",
                          highlighted === row.label && "bg-accent",
                        )}
                      >
                        <td className="px-2 py-1 font-mono text-xs whitespace-nowrap">
                          {row.label}
                          {essential && (
                            <span
                              className="text-logic-high ml-1.5"
                              title="Essential — it is the only implicant covering some minterm"
                            >
                              ★
                            </span>
                          )}
                        </td>
                        {trace.chart.columns.map((m) => (
                          <td
                            key={m}
                            className="px-2 py-1 text-center font-mono text-xs"
                          >
                            {row.covers.includes(m) ? (
                              <span className="text-logic-high">×</span>
                            ) : (
                              <span className="text-muted-foreground/20">·</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Don't-cares are deliberately absent from the columns above. */}
            {trace.dontCares.length > 0 && (
              <p className="text-muted-foreground mt-3 text-xs">
                Don&apos;t-cares ({trace.dontCares.join(", ")}) helped the terms
                combine, but they are not columns here — nothing has to cover
                them.
              </p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* --- 3. essential prime implicants -------------------------------- */}
        <AccordionItem value="essentials">
          <AccordionTrigger className="text-sm">
            Essential prime implicants
            <Badge variant="secondary" className="ml-auto mr-2 font-normal">
              {trace.essentials.length}
            </Badge>
          </AccordionTrigger>
          <AccordionContent>
            {trace.essentials.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                None. Every minterm is covered by more than one prime implicant,
                so the chart is <em>cyclic</em> and the cover has to be chosen by
                search rather than read off.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {trace.essentials.map((e) => (
                  <li key={e.becauseOf} className="flex gap-2">
                    <code className="text-logic-high">
                      {trace.chart.rows.find((r) => r.cube === e.cube)?.label}
                    </code>
                    <span className="text-muted-foreground">
                      is the only implicant covering m{e.becauseOf}, so every
                      cover must include it.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* --- 4. reductions + Petrick -------------------------------------- */}
        {(trace.reductions.length > 0 || trace.petrick) && (
          <AccordionItem value="cover">
            <AccordionTrigger className="text-sm">
              Covering the rest
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                {trace.reductions.map((d, i) => (
                  <p key={i} className="text-muted-foreground">
                    <Badge variant="outline" className="mr-2 font-normal">
                      {d.kind === "row-dominance" ? "row" : "column"} dominance
                    </Badge>
                    {d.explanation}
                  </p>
                ))}

                {trace.petrick && (
                  <div className="space-y-2">
                    <p className="text-muted-foreground">
                      Petrick&apos;s method — every remaining minterm must be
                      covered by at least one of the implicants below, so multiply
                      out the product of sums and take the cheapest term.
                    </p>
                    <code className="block font-mono text-xs break-words">
                      {trace.petrick.clauses
                        .map((c) => `(${c.rows.join(" + ")})`)
                        .join(" · ")}
                    </code>
                    <p className="text-sm">
                      Cheapest product:{" "}
                      <code className="text-logic-high">
                        {trace.petrick.chosen.join(" · ") || "—"}
                      </code>
                    </p>
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
