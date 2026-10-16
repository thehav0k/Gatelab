"use client";

import { useMemo, useState } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DiagramFigure } from "@/components/diagrams/diagram-figure";
import {
  designCounter,
  parseSequence,
  MAX_COUNTER_BITS,
  type CounterDesign,
  type CounterError,
  type FlipFlopType,
} from "@/lib/core-engine/counter";
import { DONT_CARE, TRUE } from "@/lib/core-engine/types";
import { sequentialDesignDiagram } from "@/lib/diagram/builders/sequential";
import { useDiagramTheme } from "@/stores/diagram-store";
import { cn } from "@/lib/utils";

/**
 * Design a counter from the sequence you want it to count.
 *
 * The tables are the deliverable, not the diagram. This is a marked exercise
 * and the marks are in the working — the transition table, the excitation
 * table, the don't cares, the minimal equations — so all of it is shown, in the
 * order it is derived, and the circuit comes last as the consequence rather
 * than as the answer.
 *
 * Everything on screen comes out of one `designCounter` call. There is no
 * second description of the circuit for the table and the drawing to disagree
 * about.
 */

const TYPES: readonly { readonly value: FlipFlopType; readonly label: string }[] = [
  { value: "jk", label: "J-K" },
  { value: "d", label: "D" },
  { value: "t", label: "T" },
];

const message = (error: CounterError): string => {
  switch (error.kind) {
    case "empty":
      return "Type a sequence of states, like 0, 1, 2, 3, 4.";
    case "too-short":
      return "A counter needs at least two states to count between.";
    case "duplicate":
      return `State ${error.state} appears twice. A state with two different successors is not a function of the present state, so no combinational logic can produce it.`;
    case "too-wide":
      return `${error.bits} flip-flops is past what these tables can usefully show. Keep the largest state under ${2 ** MAX_COUNTER_BITS}.`;
  }
};

export function CounterDesigner() {
  const theme = useDiagramTheme();
  const [text, setText] = useState("0, 1, 2, 3, 4");
  const [type, setType] = useState<FlipFlopType>("jk");

  /**
   * One memo, because parsing and designing are one step from the reader's
   * point of view: either the text describes a counter or it does not, and the
   * two failures need two different sentences.
   */
  const outcome = useMemo(() => {
    const sequence = parseSequence(text);
    if (sequence === null) return { kind: "unparsed" as const };
    const result = designCounter(sequence, type);
    return result.ok
      ? { kind: "ok" as const, design: result.design }
      : { kind: "error" as const, error: result.error };
  }, [text, type]);

  const diagram = useMemo(() => {
    if (outcome.kind !== "ok") return null;
    const { design } = outcome;
    return sequentialDesignDiagram(
      {
        inputs: [],
        stateVars: [...design.stateVars],
        type: design.type,
        excitation: Object.fromEntries(design.equations.map((e) => [e.pin, e.expr])),
      },
      {
        id: `counter-${design.sequence.join("-")}-${design.type}`,
        title: `Counter for ${design.sequence.join(" → ")} → …`,
      },
    );
  }, [outcome]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="seq" className="text-xs">
            The sequence to count
          </Label>
          <Input
            id="seq"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="0, 3, 5, 6"
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Flip-flops</Label>
          <ToggleGroup
            type="single"
            size="sm"
            value={type}
            onValueChange={(v) => v && setType(v as FlipFlopType)}
            className="justify-start"
          >
            {TYPES.map((t) => (
              <ToggleGroupItem key={t.value} value={t.value} className="px-3 text-xs">
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <p className="text-muted-foreground text-xs text-pretty">
        Any order, any subset — <code>0, 3, 5, 6</code> and{" "}
        <code>0, 1, 3, 2, 6, 7, 5, 4</code> are both counters. Commas, spaces or
        arrows all work.
      </p>

      {outcome.kind === "unparsed" && (
        <Note>
          That is not a list of state numbers. Try <code>0, 1, 2, 3</code>.
        </Note>
      )}
      {outcome.kind === "error" && <Note>{message(outcome.error)}</Note>}
      {outcome.kind === "ok" && <Design design={outcome.design} />}

      {diagram && <DiagramFigure diagram={diagram} theme={theme} maxHeight={480} />}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground flex items-start gap-2 rounded-md border p-3 text-sm text-pretty">
      <CircleAlert className="text-logic-z mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Design({ design }: { design: CounterDesign }) {
  const { stateVars, pins, bits, rows, equations, unused, strays } = design;
  const width = 1 << bits;

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm text-pretty">
        {design.sequence.length} states, {bits} flip-flop
        {bits === 1 ? "" : "s"}
        {unused.length > 0
          ? `, and ${unused.length} state${unused.length === 1 ? "" : "s"} the counter never visits (${unused.join(", ")}) — free to be anything, which is where the saving comes from.`
          : ", using every state there is."}
      </p>

      {/* --- the table ------------------------------------------------------ */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-center font-mono text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-muted-foreground px-2 py-1.5 font-medium" colSpan={bits}>
                Present
              </th>
              <th
                className="text-muted-foreground border-l px-2 py-1.5 font-medium"
                colSpan={bits}
              >
                Next
              </th>
              <th
                className="text-muted-foreground border-l px-2 py-1.5 font-medium"
                colSpan={pins.length}
              >
                Flip-flop inputs
              </th>
            </tr>
            <tr className="border-b">
              {stateVars.map((v) => (
                <th key={`p${v}`} className="text-muted-foreground px-2 py-1 font-normal">
                  {v}
                </th>
              ))}
              {stateVars.map((v, i) => (
                <th
                  key={`n${v}`}
                  className={cn(
                    "text-muted-foreground px-2 py-1 font-normal",
                    i === 0 && "border-l",
                  )}
                >
                  {v}
                  <span className="text-[9px]">+</span>
                </th>
              ))}
              {pins.map((pin, i) => (
                <th
                  key={pin}
                  className={cn(
                    "text-muted-foreground px-2 py-1 font-normal",
                    i === 0 && "border-l",
                  )}
                >
                  {pin}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.state}
                className={cn(
                  "border-b last:border-0",
                  // An unused row is greyed, not hidden. It is part of the
                  // working — the don't cares are where the gates were saved.
                  !row.used && "text-muted-foreground/60 bg-muted/30",
                )}
              >
                {row.present.map((bit, i) => (
                  <td key={i} className="px-2 py-1">
                    {bit}
                  </td>
                ))}
                {(row.nextBits ?? stateVars.map(() => null)).map((bit, i) => (
                  <td key={i} className={cn("px-2 py-1", i === 0 && "border-l")}>
                    {bit ?? "×"}
                  </td>
                ))}
                {row.excitation.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      "px-2 py-1",
                      i === 0 && "border-l",
                      v === DONT_CARE && "text-logic-z",
                    )}
                  >
                    {v === DONT_CARE ? "×" : v === TRUE ? "1" : "0"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground text-xs text-pretty">
        <span className="text-logic-z font-mono">×</span> is a don&apos;t care — a
        row the counter never reaches, or a J-K entry the excitation table leaves
        free. Both are handed to Quine–McCluskey as freedom.
      </p>

      {/* --- the equations --------------------------------------------------- */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Minimal excitation equations</h4>
        <div className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {equations.map((eq) => (
            <div key={eq.pin} className="flex items-baseline gap-2 font-mono text-sm">
              <span className="text-logic-high">{eq.pin}</span>
              <span className="text-muted-foreground">=</span>
              <span>{eq.expr}</span>
              <span className="text-muted-foreground ml-auto text-[10px]">
                {eq.literals} literal{eq.literals === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* --- where the unused states go --------------------------------------- */}
      {strays.length > 0 && (
        <div className="rounded-lg border p-3">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <RotateCcw className="size-3.5" />
            Where the unused states go
          </h4>
          <p className="text-muted-foreground mt-1 text-xs text-pretty">
            The minimizer was free to choose anything here and chose whatever made
            the algebra smallest. Where that leaves a state is a real property of
            the finished circuit that nobody decided on purpose — and it decides
            whether the counter can recover from a power-up glitch.
          </p>
          <ul className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-2">
            {strays.map((s) => (
              <li key={s.state} className="flex items-center gap-2">
                <span>
                  {s.state} → {s.goesTo}
                </span>
                <span
                  className={cn(
                    "text-[10px]",
                    s.recovers ? "text-logic-high" : "text-logic-x",
                  )}
                >
                  {s.recovers ? "returns to the sequence" : "never returns"}
                </span>
              </li>
            ))}
          </ul>
          <p
            className={cn(
              "mt-2 text-xs text-pretty",
              design.selfCorrecting ? "text-logic-high" : "text-logic-x",
            )}
          >
            {design.selfCorrecting
              ? "Self-correcting: from any unused state it finds its way back on its own."
              : "Not self-correcting: at least one unused state is a trap. Wire the clear, or add the terms that steer it home."}
          </p>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        {width - unused.length} of {width} states used.
      </p>
    </div>
  );
}
