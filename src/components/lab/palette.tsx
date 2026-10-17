"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IC_LIBRARY, isSequential, type IcDefinition } from "@/lib/simulation/ic-library";
import { allowsGate, allowsPart } from "@/lib/simulation/constraints";
import { useConstraint } from "@/stores/workspace-store";
import { gateNode, useCircuitStore, type NewNode } from "@/stores/circuit-store";
import { GATE_LABELS } from "@/lib/simulation/parts";
import type { GateOp } from "@/lib/simulation/logic";
import { cn } from "@/lib/utils";

const GATES: readonly GateOp[] = ["and", "or", "not", "nand", "nor", "xor", "xnor"];

/** These gates fold over any number of inputs; NOT and BUF are always 1-input. */
const isVariadic = (op: GateOp) => op !== "not" && op !== "buf";
const INPUT_CHOICES = [2, 3, 4] as const;

/**
 * Drop new parts on a grid with real clearance. The spacing is not cosmetic: a
 * gate body is 64x48, and if drops overlap, one node's body sits on top of its
 * neighbour's pins and makes them unclickable.
 */
const DROP_COLS = 4;
const DROP_DX = 170;
const DROP_DY = 105;

let dropIndex = 0;
const nextDrop = () => {
  const i = dropIndex++ % 12;
  return {
    x: 90 + (i % DROP_COLS) * DROP_DX,
    y: 60 + Math.floor(i / DROP_COLS) * DROP_DY,
  };
};

/** A DIP14 is 168x72 with pin labels above and below — it needs its own lane. */
let icDropIndex = 0;
const nextIcDrop = () => {
  const i = icDropIndex++ % 4;
  return { x: 120 + (i % 2) * 260, y: 200 + Math.floor(i / 2) * 140 };
};

export function Palette({ onPlace }: { onPlace?: () => void }) {
  const rawAdd = useCircuitStore((s) => s.addNode);
  const constraint = useConstraint();

  // Every placement runs through here so callers (the mobile sheet) can react —
  // e.g. close themselves so the freshly placed part is actually visible.
  const addNode: typeof rawAdd = (node) => {
    const id = rawAdd(node);
    if (id === null) {
      toast.error("No room left on the board", {
        description: "Delete something, or go back to the schematic to rearrange.",
      });
      return null;
    }
    onPlace?.();
    return id;
  };

  // How many inputs a freshly placed AND/OR/NAND/NOR/XOR/XNOR gets. A real 74xx
  // family has 2-, 3- and 4-input parts, and "implement this as a 3-input NAND"
  // is a normal exercise — so the count is the user's to choose, not fixed at 2.
  const gateInputs = useCircuitStore((s) => s.gateInputs);
  const setGateInputs = useCircuitStore((s) => s.setGateInputs);

  // You cannot place what you are not allowed to use. Filtering the palette makes
  // the rule DISCOVERABLE — a constraint you find out you broke afterwards is a
  // grade, not a lesson.
  /**
   * A filter over the whole palette.
   *
   * There are twenty-odd parts now, in five sections, and the power rails —
   * which every single chip needs both of — had ended up below the fold. A box
   * you can type "gnd" or "7474" into is the fix that does not depend on
   * guessing which section somebody expects a part to be in.
   */
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (...text: (string | undefined)[]) =>
    q === "" || text.some((t) => (t ?? "").toLowerCase().includes(q));

  const gates = GATES.filter(
    (op) => allowsGate(constraint, op) && matches(op, GATE_LABELS[op]),
  );
  const parts = IC_LIBRARY.filter(
    (def) => allowsPart(constraint, def.part) && matches(def.part, def.name, def.summary),
  );
  // Two sections, because they are two kinds of thing. A gate is a function of
  // its inputs; a flip-flop is a function of its inputs AND what happened last.
  const gatePacks = parts.filter((def) => !isSequential(def));
  const flopPacks = parts.filter(isSequential);

  const io = [
    { label: "Switch", match: ["switch", "input"], node: { kind: "switch" as const, state: 0 as const, pos: nextDrop() } },
    { label: "LED", match: ["led", "output", "lamp"], node: { kind: "led" as const, pos: nextDrop() } },
    { label: "+5V", match: ["+5v", "vcc", "power", "rail", "supply"], node: { kind: "rail" as const, rail: "vcc" as const, pos: nextDrop() } },
    { label: "GND", match: ["gnd", "ground", "power", "rail", "supply", "0v"], node: { kind: "rail" as const, rail: "gnd" as const, pos: nextDrop() } },
  ].filter((entry) => matches(entry.label, ...entry.match));

  const clockShown = matches("clock", "clk", "edge", "pulse");
  const nothingMatches =
    q !== "" && gates.length === 0 && parts.length === 0 && io.length === 0 && !clockShown;

  return (
    <div className="space-y-4 p-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a part"
        aria-label="Find a part"
        className="h-8 text-xs"
      />

      {nothingMatches && (
        <p className="text-muted-foreground text-xs text-pretty">
          Nothing matches “{query}”.
        </p>
      )}

      {constraint.id !== "none" && (
        <div className="bg-muted/60 rounded-md border p-2">
          <p className="text-xs font-medium">{constraint.name}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
            {constraint.description}
          </p>
        </div>
      )}

      {gates.length > 0 && (
      <Section title="Gates">
        {/* Input count for the next gate placed. */}
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-muted-foreground text-[11px]">inputs</span>
          <div className="flex gap-1">
            {INPUT_CHOICES.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setGateInputs(k)}
                aria-pressed={gateInputs === k}
                aria-label={`Set default gate inputs to ${k}`}
                className={cn(
                  "size-6 rounded border font-mono text-xs transition-colors",
                  gateInputs === k
                    ? "border-ring bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {gates.map((op) => (
            <Button
              key={op}
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={() => addNode(gateNode(op, nextDrop(), gateInputs))}
              aria-label={
                isVariadic(op)
                  ? `Place ${gateInputs}-input ${GATE_LABELS[op]} gate`
                  : `Place ${GATE_LABELS[op]} gate`
              }
              title={
                isVariadic(op)
                  ? `${gateInputs}-input ${GATE_LABELS[op]}`
                  : `${GATE_LABELS[op]} (1 input)`
              }
            >
              {GATE_LABELS[op]}
              {isVariadic(op) && gateInputs !== 2 && (
                <span className="text-muted-foreground ml-0.5 text-[11px]">×{gateInputs}</span>
              )}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground mt-1.5 text-[11px] leading-snug">
          NOT is always 1-input. Select a gate on the canvas to change its inputs.
        </p>
      </Section>
      )}

      <Separator />

      <SelectedGateInputs />

      {(io.length > 0 || clockShown) && (
        <Section title="In & out">
          <div className="grid grid-cols-2 gap-1.5">
            {io.map((entry) => (
              <Button
                key={entry.label}
                variant="outline"
                size="sm"
                className="text-xs"
                aria-label={`Place ${entry.label}`}
                onClick={() => addNode(entry.node)}
              >
                {entry.label}
              </Button>
            ))}
            {clockShown && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="col-span-2 text-xs"
                    aria-label="Place Clock source"
                    onClick={() => addNode({ kind: "clock", state: 0, pos: nextDrop() })}
                  >
                    Clock
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-56">
                  <p className="font-medium">Clock source</p>
                  <p className="text-muted-foreground text-xs">
                    A switch the app can drive for you. Click it for one edge, or use
                    the clock panel under the canvas to pulse and run it.
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </Section>
      )}

      <Separator />

      {gatePacks.length > 0 && (
        <Section title="74xx gates">
          <PartGrid parts={gatePacks} onAdd={addNode} />
        </Section>
      )}

      {flopPacks.length > 0 && (
        <>
          <Separator />
          <Section title="Flip-flops & registers">
            <PartGrid parts={flopPacks} onAdd={addNode} />
            <p className="text-muted-foreground mt-1.5 text-[11px] leading-snug">
              These remember. Wire a Clock to CLK, and a clear to CLR — a flip-flop
              powers up unknown, which is why every counter has one.
            </p>
          </Section>
        </>
      )}

      
    </div>
  );
}

/**
 * Change the input count of the gate that is currently selected — because the
 * count is a property of the specific gate, not only a placement default. Widening
 * adds unconnected pins; narrowing drops the wires to the pins that vanish.
 */
function SelectedGateInputs() {
  const selection = useCircuitStore((s) => s.selection);
  const doc = useCircuitStore((s) => s.doc);
  const setGateArity = useCircuitStore((s) => s.setGateArity);

  if (selection.length !== 1) return null;
  const node = doc.nodes[selection[0]!];
  if (node?.kind !== "gate" || !isVariadic(node.op)) return null;

  return (
    <>
      <Section title="Selected gate">
        <p className="text-muted-foreground mb-1.5 font-mono text-xs">
          {node.label} · {GATE_LABELS[node.op]}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[11px]">inputs</span>
          <div className="flex gap-1">
            {INPUT_CHOICES.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setGateArity(node.id, k)}
                aria-pressed={node.arity === k}
                aria-label={`Change selected gate to ${k} inputs`}
                className={cn(
                  "size-6 rounded border font-mono text-xs transition-colors",
                  node.arity === k
                    ? "border-ring bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </Section>
      <Separator />
    </>
  );
}

/**
 * A grid of chip buttons, with the datasheet facts on hover.
 *
 * The supply pins are named per part rather than in one blanket sentence,
 * because they are NOT all on the corners — the '76 puts them on 5 and 13, and
 * a tooltip that said "pin 14 and pin 7" for that part would be teaching the
 * exact mistake this library exists to prevent.
 */
function PartGrid({
  parts,
  onAdd,
}: {
  parts: readonly IcDefinition[];
  onAdd: (node: NewNode) => unknown;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {parts.map((def) => {
        const vcc = def.pins.find((p) => p.name === "VCC")?.number;
        const gnd = def.pins.find((p) => p.name === "GND")?.number;
        return (
          <Tooltip key={def.part}>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-[11px]"
                aria-label={`Place ${def.part} (${def.name})`}
                onClick={() => onAdd({ kind: "ic", part: def.part, pos: nextIcDrop() })}
              >
                {def.part}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-60">
              <p className="font-medium">{def.name}</p>
              {def.summary && (
                <p className="text-muted-foreground text-xs text-pretty">{def.summary}</p>
              )}
              <p className="text-muted-foreground mt-1 text-xs">
                Vcc on pin {vcc}, GND on pin {gnd} — wire both, or it does nothing.
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}
