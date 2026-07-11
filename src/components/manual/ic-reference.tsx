"use client";

import { Badge } from "@/components/ui/badge";
import { IC_DOCS, type IcDoc } from "@/lib/simulation/reference";
import { cn } from "@/lib/utils";

/**
 * The chip reference, drawn as an actual DIP.
 *
 * A table of pin names teaches nothing, because the thing that goes wrong at a
 * bench is never "what is pin 14 called" — it is "which end is pin 1". So the
 * package is drawn the way it sits in front of you: the NOTCH at the top, pin 1 to
 * its left, numbers running DOWN the left side and back UP the right. That is the
 * whole convention, and it is the one people get backwards.
 *
 * Every name here is read out of `ic-library.ts`, which is transcribed from the
 * datasheets and validated on load — so the 7402's output really does appear on
 * pin 1, exactly as it does on the real part.
 */
function pinTone(name: string): string {
  if (name === "VCC") return "text-logic-high";
  if (name === "GND") return "text-muted-foreground";
  if (/Y$/.test(name)) return "text-logic-z"; // outputs
  return "text-foreground";
}

function Dip({ ic }: { ic: IcDoc }) {
  const half = ic.pinCount / 2;
  const left = ic.pins.slice(0, half); // 1 … 7, downward
  const right = ic.pins.slice(half).reverse(); // 14 … 8, upward

  return (
    <div className="flex items-start gap-1.5 font-mono text-[11px]">
      {/* left pin numbers + names */}
      <ul className="space-y-1 text-right">
        {left.map((p) => (
          <li key={p.pin} className="flex h-5 items-center justify-end gap-1.5">
            <span className={cn("w-8", pinTone(p.name))}>{p.name}</span>
            <span className="text-muted-foreground w-4 tabular-nums">{p.pin}</span>
            <span className="bg-muted-foreground/50 h-px w-2.5" />
          </li>
        ))}
      </ul>

      {/* the package, with the notch */}
      <div className="bg-muted/60 relative w-16 rounded-sm border py-1">
        <div className="border-muted-foreground/50 absolute -top-px left-1/2 size-3 -translate-x-1/2 rounded-b-full border border-t-0 bg-[var(--background)]" />
        <div
          className="text-muted-foreground flex items-center justify-center text-center"
          style={{ height: `${half * 1.5}rem` }}
        >
          <span className="font-semibold">{ic.part}</span>
        </div>
      </div>

      {/* right pin numbers + names */}
      <ul className="space-y-1">
        {right.map((p) => (
          <li key={p.pin} className="flex h-5 items-center gap-1.5">
            <span className="bg-muted-foreground/50 h-px w-2.5" />
            <span className="text-muted-foreground w-4 tabular-nums">{p.pin}</span>
            <span className={cn("w-8", pinTone(p.name))}>{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IcReference() {
  return (
    <div className="space-y-4">
      {IC_DOCS.map((ic) => (
        <div key={ic.part} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-base font-semibold">{ic.part}</h3>
            <Badge variant="secondary" className="text-[10px] font-normal">
              {ic.gateCount} × {ic.inputsPerGate}-input {ic.op.toUpperCase()}
            </Badge>
            <span className="text-muted-foreground text-xs">DIP-{ic.pinCount}</span>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">{ic.name}</p>

          <div className="mt-4 flex flex-wrap items-start gap-6">
            <Dip ic={ic} />

            <div className="min-w-48 flex-1 space-y-2 text-xs">
              <p>
                <span className="text-muted-foreground">Power: </span>
                <span className="text-logic-high font-medium">
                  pin {ic.vcc} → +5V
                </span>
                <span className="text-muted-foreground"> · </span>
                <span className="font-medium">pin {ic.gnd} → GND</span>
              </p>
              <p className="text-muted-foreground text-pretty">
                Pin names follow the datasheet: <code>1A</code>, <code>1B</code> are
                the inputs of gate 1 and <code>1Y</code> is its output. Numbering runs
                anticlockwise from the notch — down the left side, then back up the
                right.
              </p>
              {ic.part === "7402" && (
                <p className="text-logic-z text-pretty">
                  Careful: the 7402 is <em>not</em> shaped like the 7400. Its gate 1
                  is inputs (2, 3) → output <strong>1</strong> — the output comes
                  first. Pattern-matching one chip&apos;s layout onto another is the
                  classic way to wire a NOR chip backwards.
                </p>
              )}
              {ic.part === "7404" && (
                <p className="text-logic-z text-pretty">
                  The inverters reverse direction on the right-hand half of the
                  package. Read the pin names, not the pattern.
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
