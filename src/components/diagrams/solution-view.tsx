"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CATEGORY_LABELS, defaults, type Problem, type SolutionTable } from "@/lib/diagram/problems";
import type { DiagramTheme } from "@/lib/diagram/theme";
import { useHydrated } from "@/hooks/use-hydrated";
import { useDiagramStore } from "@/stores/diagram-store";
import { cn } from "@/lib/utils";
import { DiagramFigure } from "./diagram-figure";
import { ProblemParams } from "./problem-params";

/**
 * One question, answered.
 *
 * The order is the order you would write the answer on paper: the question, the
 * table you derive from it, the expression that falls out, the circuit, and then
 * the explanation. The drawing is the middle of an argument, not the whole of it
 * — which is why the steps are not an afterthought below a picture.
 */
export function SolutionView({
  problem,
  theme,
}: {
  problem: Problem;
  theme: DiagramTheme;
}) {
  const stored = useDiagramStore((s) => s.params[problem.id]);
  // The stored values come from localStorage, which the server cannot see. Use
  // the question's own defaults until hydration, or React discards the whole
  // server-rendered answer and re-derives it on the client.
  const hydrated = useHydrated();
  const values = useMemo(
    () => ({ ...defaults(problem), ...(hydrated ? (stored ?? {}) : {}) }),
    [problem, stored, hydrated],
  );

  // A builder is allowed to refuse an impossible combination by throwing — that
  // is better than drawing something wrong. Catch it here and say so, rather than
  // taking the whole page down with an error boundary.
  const result = useMemo(() => {
    try {
      return { solution: problem.solve(values), error: null as string | null };
    } catch (e) {
      return {
        solution: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [problem, values]);

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            Q{problem.number}
          </Badge>
          <Badge variant="outline">{CATEGORY_LABELS[problem.category]}</Badge>
          {problem.tags.map((t) => (
            <span key={t} className="text-muted-foreground text-[11px]">
              {t}
            </span>
          ))}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-balance">
          {problem.title}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">{problem.prompt}</p>
      </header>

      <ProblemParams problem={problem} values={values} />

      {result.error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Those settings do not describe a buildable circuit</AlertTitle>
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}

      {result.solution && (
        <>
          {result.solution.answer && (
            <div className="border-ring bg-accent rounded-md border px-4 py-3">
              <p className="text-muted-foreground mb-0.5 text-[11px] tracking-wide uppercase">
                Answer
              </p>
              <p className="text-sm font-medium text-pretty">{result.solution.answer}</p>
            </div>
          )}

          {result.solution.diagrams.map((d) => (
            <DiagramFigure key={d.id} diagram={d} theme={theme} />
          ))}

          {result.solution.expressions && result.solution.expressions.length > 0 && (
            <div className="bg-muted/40 space-y-1 rounded-md border p-3 font-mono text-xs">
              {result.solution.expressions.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}

          {(result.solution.tables ?? []).map((t, i) => (
            <SolutionTableView key={i} table={t} />
          ))}

          <section className="space-y-3">
            <h3 className="text-sm font-medium">Explanation</h3>
            <ol className="space-y-2.5">
              {result.solution.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-muted-foreground mt-0.5 shrink-0 font-mono text-xs tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-pretty">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * A table with a scroll container of its own.
 *
 * A 64-row truth table with eight columns is normal here, and letting it widen
 * the page body means every other panel on the screen scrolls sideways too.
 */
function SolutionTableView({ table }: { table: SolutionTable }) {
  const tall = table.rows.length > 20;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{table.title}</h3>
      <div
        className={cn(
          "overflow-auto rounded-md border",
          tall && "max-h-[26rem]",
        )}
      >
        {/* `w-auto`: a five-column truth table stretched to the full panel puts
            200px between P and Q and stops reading as a table at all. */}
        <Table className="w-auto min-w-[24rem]">
          <TableHeader className="bg-muted/60 sticky top-0">
            <TableRow>
              {table.columns.map((c, i) => (
                <TableHead key={i} className="h-8 px-3 font-mono text-[11px]">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, r) => {
              const lit =
                table.highlightWhen !== undefined &&
                row.slice(1).includes(table.highlightWhen) &&
                row.at(-1) === table.highlightWhen;
              return (
                <TableRow key={r} className={cn(lit && "bg-logic-high/8")}>
                  {row.map((cell, c) => (
                    <TableCell
                      key={c}
                      className={cn(
                        "px-3 py-1 font-mono text-xs",
                        c < row.length - 1 && "text-muted-foreground",
                      )}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {table.note && (
        <p className="text-muted-foreground text-xs text-pretty">{table.note}</p>
      )}
    </section>
  );
}
