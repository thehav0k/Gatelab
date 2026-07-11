"use client";

import { useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCircuitStore } from "@/stores/circuit-store";
import { elaborate } from "@/lib/simulation/elaborate";
import { simulateTimed, type Waveform } from "@/lib/simulation/timing";
import { L1, LX, LZ, type Logic } from "@/lib/simulation/logic";

const ROW_H = 34;
const WAVE_H = 20;
const LABEL_W = 44;
const TICK_W = 7;

/**
 * The timing panel.
 *
 * Two things make this worth having rather than decorative. The inputs are driven
 * by a GRAY-CODE counter, so the diagram sweeps the whole truth table one bit at
 * a time and becomes a logic-analyzer view of the function. And the solver models
 * unit gate delay, so STATIC HAZARDS show up as real glitches — which the
 * settle-to-fixpoint solver on the canvas cannot show, because it converges past
 * them.
 */
export function WaveformPanel() {
  const doc = useCircuitStore((s) => s.doc);
  const [delay, setDelay] = useState(1);

  const result = useMemo(
    () => simulateTimed(elaborate(doc).netlist, { delay }),
    [doc, delay],
  );

  if (result.ticks === 0) {
    return (
      <p className="text-muted-foreground p-3 text-sm">
        Add input switches, some gates, and an LED, and the timing diagram will
        sweep every input combination.
      </p>
    );
  }

  const width = LABEL_W + result.ticks * TICK_W;
  const height = result.waves.length * ROW_H + 18;
  const glitchTicks = new Set(result.glitches.flatMap((g) => g.ticks));

  return (
    <div className="space-y-3 p-3">
      {result.glitches.length > 0 && (
        <Alert>
          <Zap className="text-logic-z" />
          <AlertTitle>Glitch detected</AlertTitle>
          <AlertDescription>
            {result.glitches.map((g) => g.label).join(", ")} pulses away from its
            settled value while the inputs are held steady — a{" "}
            <strong>static hazard</strong>, caused by unequal path delays rather
            than by a logic error. The truth table is still correct, but on real
            hardware that spike is a real pulse. The cure is a redundant consensus
            term: the one Quine–McCluskey discarded <em>because</em> it was
            redundant.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Gate delay</span>
        {[1, 2, 3].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={delay === d ? "secondary" : "ghost"}
            className="h-7 px-2 font-mono text-xs"
            onClick={() => setDelay(d)}
          >
            {d}
          </Button>
        ))}
        <span className="text-muted-foreground ml-auto text-xs">
          Gray-code sweep, forward then back
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <svg width={width} height={height} className="block">
          {/* Step boundaries. */}
          {Array.from({ length: result.steps + 1 }, (_, s) => {
            const x = LABEL_W + (result.settleTicks + s * result.ticksPerCombination) * TICK_W;
            return (
              <line
                key={s}
                x1={x}
                y1={4}
                x2={x}
                y2={height - 8}
                className="stroke-border"
                strokeDasharray="2 3"
              />
            );
          })}

          {/* Glitch highlights, behind the traces. */}
          {[...glitchTicks].map((t) => (
            <rect
              key={t}
              x={LABEL_W + t * TICK_W}
              y={4}
              width={TICK_W}
              height={height - 12}
              style={{ fill: "var(--logic-z)" }}
              opacity={0.18}
            />
          ))}

          {result.waves.map((wave, row) => (
            <WaveRow key={wave.label} wave={wave} row={row} />
          ))}
        </svg>
      </div>

      <p className="text-muted-foreground text-xs">
        Inputs step through every combination changing one bit at a time, then
        reverse — so each transition is exercised in both directions. A hazard is
        directional: it appears on a falling edge but not the matching rising one.
      </p>
    </div>
  );
}

function WaveRow({ wave, row }: { wave: Waveform; row: number }) {
  const top = 8 + row * ROW_H;
  const mid = top + WAVE_H / 2;

  // Digital waveform: horizontal runs joined by vertical edges.
  const yOf = (v: Logic): number =>
    v === L1 ? top : v === LZ || v === LX ? mid : top + WAVE_H;

  let d = "";
  let prev: Logic | null = null;
  wave.samples.forEach((v, t) => {
    const x = LABEL_W + t * TICK_W;
    const y = yOf(v);
    if (prev === null) d += `M ${x} ${y}`;
    else if (v !== prev) d += ` L ${x} ${yOf(prev)} L ${x} ${y}`;
    d += ` L ${x + TICK_W} ${y}`;
    prev = v;
  });

  const undefinedRuns = wave.samples
    .map((v, t) => (v === LX || v === LZ ? t : -1))
    .filter((t) => t >= 0);

  return (
    <g>
      <text
        x={LABEL_W - 8}
        y={mid + 4}
        textAnchor="end"
        className="fill-foreground font-mono text-[11px] font-medium"
      >
        {wave.label}
      </text>

      {/* Z / X stretches sit on the midline and are drawn in their own colour, so
          "floating" never looks like "low". */}
      {undefinedRuns.map((t) => (
        <rect
          key={t}
          x={LABEL_W + t * TICK_W}
          y={mid - 1.5}
          width={TICK_W}
          height={3}
          style={{ fill: wave.samples[t] === LZ ? "var(--logic-z)" : "var(--logic-x)" }}
        />
      ))}

      <path
        d={d}
        fill="none"
        strokeWidth={1.75}
        style={{ stroke: wave.isInput ? "var(--logic-low)" : "var(--logic-high)" }}
        strokeLinejoin="round"
      />
    </g>
  );
}
