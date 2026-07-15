"use client";

import { useMemo } from "react";
import { StaticSchematic } from "@/components/shared/static-schematic";
import { Badge } from "@/components/ui/badge";
import {
  describeDesign,
  realize,
  synthesize,
  technologyMap,
} from "@/lib/simulation/synth";
import { describeWiring, formatPin, type WiringNet } from "@/lib/simulation/wiring";
import type { Minimization } from "@/lib/core-engine/minimizer";
import { cn } from "@/lib/utils";

/**
 * From algebra to a picture, and then to a wiring list.
 *
 * The theory workspace could always MINIMIZE. This is the step people ask for
 * next: "show me the circuit." Two circuits, actually — the gate diagram of the
 * simplified expression, and the same logic mapped onto real 74xx chips with the
 * pin-by-pin wiring you would transcribe onto a breadboard.
 *
 * Both come from the same synthesizer the lab's "Build it" uses, so what you see
 * here is exactly what you would get if you pressed it.
 */
export function CircuitView({
  min,
  variables,
}: {
  min: Minimization;
  variables: readonly string[];
}) {
  const built = useMemo(() => {
    const nl = synthesize(min.expression, variables);
    if (nl.constant !== null) return { constant: nl.constant as 0 | 1 };
    const design = technologyMap(nl, "mixed");
    return {
      constant: null,
      gateDoc: realize(design, { discrete: true }),
      icDoc: realize(design),
      summary: describeDesign(design),
      wiring: describeWiring(realize(design)),
    };
  }, [min, variables]);

  if (built.constant !== null) {
    return (
      <p className="text-muted-foreground text-sm">
        This function is the constant {built.constant} — there is no circuit to
        build. Tie the output {built.constant === 1 ? "to +5V" : "to GND"}.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-medium">Logic gate diagram</h3>
        <p className="text-muted-foreground mb-3 text-xs text-pretty">
          The minimal expression as gates. Inputs on the left, output on the right;
          each column is one more gate delay from the inputs.
        </p>
        <div className="bg-card overflow-hidden rounded-md border p-2">
          <StaticSchematic doc={built.gateDoc} maxHeight={360} />
        </div>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">On real 74xx chips</h3>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {built.summary}
          </Badge>
        </div>
        <p className="text-muted-foreground mb-3 text-xs text-pretty">
          The same logic packed into physical DIP packages, power rails wired.
        </p>
        <div className="bg-card overflow-hidden rounded-md border p-2">
          <StaticSchematic doc={built.icDoc} maxHeight={360} />
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium">Wiring list</h3>
        <p className="text-muted-foreground mb-3 text-xs text-pretty">
          Every connection, in datasheet language — the pin-to-pin list you would
          actually run on a breadboard.
        </p>
        <WiringTable nets={built.wiring.nets} />
      </div>
    </div>
  );
}

function WiringTable({ nets }: { nets: readonly WiringNet[] }) {
  const tone = (kind: WiringNet["kind"]) =>
    kind === "vcc" ? "text-logic-high" : kind === "gnd" ? "text-muted-foreground" : "";

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60">
          <tr className="text-left">
            <th className="text-muted-foreground w-10 px-3 py-2 text-xs font-medium">Net</th>
            <th className="px-3 py-2 text-xs font-medium">Driven by</th>
            <th className="px-3 py-2 text-xs font-medium">Connects to</th>
          </tr>
        </thead>
        <tbody className="font-mono text-xs">
          {nets.map((net) => (
            <tr key={net.index} className="border-t align-top">
              <td className={cn("px-3 py-1.5 tabular-nums", tone(net.kind))}>
                {net.kind === "vcc" ? "+5V" : net.kind === "gnd" ? "GND" : net.index}
              </td>
              <td className="px-3 py-1.5">
                {net.drivers.map((p) => formatPin(p)).join(", ") || (
                  <span className="text-logic-z">nothing (floating)</span>
                )}
              </td>
              <td className="text-muted-foreground px-3 py-1.5">
                {net.loads.map((p) => formatPin(p)).join(", ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
