"use client";

import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCircuitStore } from "@/stores/circuit-store";
import { LOGIC_NAMES, type Logic } from "@/lib/simulation/logic";
import { cn } from "@/lib/utils";

/**
 * The controls a clocked circuit needs, and only appears when there is one.
 *
 * A combinational circuit is driven entirely by its switches: set them, read the
 * answer. A sequential one cannot be driven that way at all — the whole point is
 * that its output depends on a sequence of EDGES, and there is no way to produce
 * an edge by setting a level. So the clock gets its own controls, and the lab is
 * unusable for counters without them.
 *
 * PULSE, NOT TOGGLE, IS THE PRIMARY ACTION. Half the parts here load on the
 * rising edge ('74, '175) and half on the falling one ('76, '107), so a button
 * that only raised the clock would appear to do nothing at all on a ripple
 * counter. One press runs the level up and back down, which advances either.
 */
export function ClockPanel() {
  const doc = useCircuitStore((s) => s.doc);
  const pulseClock = useCircuitStore((s) => s.pulseClock);
  const toggleClock = useCircuitStore((s) => s.toggleClock);
  const resetState = useCircuitStore((s) => s.resetState);
  const flopState = useCircuitStore((s) => s.flopState);

  const clocks = Object.values(doc.nodes).filter((n) => n.kind === "clock");
  const stored = Object.entries(flopState);

  const [running, setRunning] = useState(false);
  const [hz, setHz] = useState(2);

  /**
   * Free-running.
   *
   * The tick reads the store rather than closing over the clocks it found at
   * render time, which is both simpler and more correct: it pulses whatever
   * clocks exist NOW, so adding or deleting one mid-run does the obvious thing
   * instead of driving a stale list.
   */
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const state = useCircuitStore.getState();
      for (const node of Object.values(state.doc.nodes)) {
        if (node.kind === "clock") state.pulseClock(node.id);
      }
    }, 1000 / hz);
    return () => clearInterval(timer);
  }, [running, hz]);

  // Nothing clocked on the board: say nothing. A panel of controls for a thing
  // that is not there is worse than no panel.
  if (clocks.length === 0 && stored.length === 0) return null;

  return (
    <Card className="flex shrink-0 flex-row flex-wrap items-center gap-2 px-3 py-2">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Zap className="size-3.5" />
        Clock
      </span>

      {clocks.length === 0 ? (
        <span className="text-muted-foreground text-xs text-pretty">
          This circuit has flip-flops but no clock source. Add one from the palette
          and wire it to CLK.
        </span>
      ) : (
        <>
          {clocks.map((clock) => (
            <div key={clock.id} className="flex items-center gap-1">
              <span className="font-mono text-[11px]">{clock.label}</span>
              <button
                type="button"
                onClick={() => toggleClock(clock.id)}
                title="Toggle this clock — one edge"
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                  clock.kind === "clock" && clock.state === 1
                    ? "border-logic-high text-logic-high"
                    : "text-muted-foreground",
                )}
              >
                {clock.kind === "clock" && clock.state === 1 ? "HIGH" : "LOW"}
              </button>
            </div>
          ))}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => clocks.forEach((c) => pulseClock(c.id))}
              >
                <SkipForward className="size-3.5" />
                Pulse
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              One complete pulse — up and back down — so a rising-edge part and a
              falling-edge part both advance.
            </TooltipContent>
          </Tooltip>

          <Button
            size="sm"
            variant={running ? "destructive" : "outline"}
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setRunning((r) => !r)}
          >
            {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {running ? "Stop" : "Run"}
          </Button>

          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={1}
              max={10}
              value={hz}
              onChange={(e) => setHz(Number(e.target.value))}
              className="accent-primary h-1.5 w-20 cursor-pointer"
              aria-label="Clock rate"
            />
            <span className="text-muted-foreground w-10 font-mono text-[10px] tabular-nums">
              {hz} Hz
            </span>
          </div>
        </>
      )}

      {stored.length > 0 && (
        <>
          <span className="text-muted-foreground ml-auto flex items-center gap-1.5 text-[11px]">
            <span className="font-medium">State</span>
            <span className="font-mono">
              {stored.map(([key, [q]]) => (
                <span key={key} className="ml-1" title={key}>
                  {LOGIC_NAMES[q as Logic]}
                </span>
              ))}
            </span>
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={resetState}
              >
                <RotateCcw className="size-3.5" />
                Power-cycle
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Put every flip-flop back to unknown, where a real one starts. Not an
              edit — it does not touch undo.
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </Card>
  );
}
