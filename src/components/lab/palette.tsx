"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IC_LIBRARY } from "@/lib/simulation/ic-library";
import { allowsGate, allowsPart } from "@/lib/simulation/constraints";
import { useConstraint } from "@/stores/workspace-store";
import { gateNode, useCircuitStore } from "@/stores/circuit-store";
import { GATE_LABELS } from "@/lib/simulation/parts";
import type { GateOp } from "@/lib/simulation/logic";

const GATES: readonly GateOp[] = ["and", "or", "not", "nand", "nor", "xor", "xnor"];

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

export function Palette() {
  const addNode = useCircuitStore((s) => s.addNode);
  const constraint = useConstraint();

  // You cannot place what you are not allowed to use. Filtering the palette makes
  // the rule DISCOVERABLE — a constraint you find out you broke afterwards is a
  // grade, not a lesson.
  const gates = GATES.filter((op) => allowsGate(constraint, op));
  const parts = IC_LIBRARY.filter((def) => allowsPart(constraint, def.part));

  return (
    <div className="space-y-4 p-3">
      {constraint.id !== "none" && (
        <div className="bg-muted/60 rounded-md border p-2">
          <p className="text-xs font-medium">{constraint.name}</p>
          <p className="text-muted-foreground mt-0.5 text-[10px] leading-snug">
            {constraint.description}
          </p>
        </div>
      )}

      <Section title="Gates">
        <div className="grid grid-cols-2 gap-1.5">
          {gates.map((op) => (
            <Button
              key={op}
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={() => addNode(gateNode(op, nextDrop()))}
            >
              {GATE_LABELS[op]}
            </Button>
          ))}
        </div>
      </Section>

      <Separator />

      <Section title="I/O">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => addNode({ kind: "switch", state: 0, pos: nextDrop() })}
          >
            Switch
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => addNode({ kind: "led", pos: nextDrop() })}
          >
            LED
          </Button>
        </div>
      </Section>

      <Separator />

      <Section title="74xx TTL">
        <div className="grid grid-cols-2 gap-1.5">
          {parts.map((def) => (
            <Tooltip key={def.part}>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  onClick={() => addNode({ kind: "ic", part: def.part, pos: nextIcDrop() })}
                >
                  {def.part}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">{def.name}</p>
                <p className="text-muted-foreground text-xs">
                  Vcc on pin 14, GND on pin 7 — wire both, or it does nothing.
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </Section>

      <Separator />

      <Section title="Power">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => addNode({ kind: "rail", rail: "vcc", pos: nextDrop() })}
          >
            +5V
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => addNode({ kind: "rail", rail: "gnd", pos: nextDrop() })}
          >
            GND
          </Button>
        </div>
      </Section>
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
