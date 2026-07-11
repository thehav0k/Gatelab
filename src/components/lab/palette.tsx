"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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

export function Palette() {
  const addNode = useCircuitStore((s) => s.addNode);

  return (
    <div className="space-y-4 p-3">
      <Section title="Gates">
        <div className="grid grid-cols-2 gap-1.5">
          {GATES.map((op) => (
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
