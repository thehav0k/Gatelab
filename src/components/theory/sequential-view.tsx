"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DiagramFigure } from "@/components/diagrams/diagram-figure";
import { CounterDesigner } from "@/components/theory/counter-designer";
import {
  modNCounterDiagram,
  registerDiagram,
  rippleCounterDiagram,
  serialToParallelDiagram,
  shiftRegisterDiagram,
  syncCounterDiagram,
} from "@/lib/diagram/builders/sequential";
import type { Diagram } from "@/lib/diagram/types";
import { useDiagramTheme } from "@/stores/diagram-store";

/**
 * Sequential circuits, in the theory workspace.
 *
 * WHY THIS IS A SECTION AND NOT A TAB. Every tab above it is a view of ONE
 * Boolean function — its truth table, its K-map, its minimal form. A counter is
 * not a function of anything: ask "what is the output of a counter for input
 * 011" and the question has no answer, because the answer depends on how many
 * clock edges have happened. Filing it under the function would be filing it
 * under a thing it does not have.
 *
 * So it is its own section with its own picker, and every entry links to the
 * Lab preset that builds the same circuit out of real 74xx flip-flops — which
 * is the whole point of having both: this is the design, and that is the thing
 * you can wire up and get wrong.
 */

interface Entry {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** The `bits`/`modulus` control, when the circuit has one. */
  readonly param?: { readonly label: string; readonly min: number; readonly max: number };
  /** Absent for the designer, which builds its own circuit from a sequence. */
  readonly build?: (n: number) => Diagram;
  /** The Lab preset that builds this from real chips, if there is one. */
  readonly lab?: string;
}

const ENTRIES: readonly Entry[] = [
  {
    id: "custom",
    name: "Custom sequence…",
    blurb:
      "Give it the states you want counted, in the order you want them, and it derives the flip-flop equations — transition table, excitation table, don't cares and all. Any subset, any order.",
  },
  {
    id: "ripple",
    name: "Ripple counter",
    blurb:
      "Toggle flip-flops in a chain, each clocked by the one below it. No combinational logic at all — which is both why it is the simplest counter to build and why it is the slowest to settle.",
    param: { label: "Bits", min: 2, max: 6 },
    build: (bits) => rippleCounterDiagram({ bits, withTiming: true }),
    lab: "ripple-4",
  },
  {
    id: "sync",
    name: "Synchronous counter",
    blurb:
      "The same count, with every flip-flop on one clock and AND gates deciding which stages toggle. Every output changes at the same instant, so nothing downstream sees an invalid intermediate count.",
    param: { label: "Bits", min: 2, max: 5 },
    build: (bits) => syncCounterDiagram({ bits }),
    lab: "sync-2",
  },
  {
    id: "modn",
    name: "Mod-N counter",
    blurb:
      "A binary counter with a gate watching for N and feeding the clear. The count never reaches N — it is erased the instant it appears, which is why a mod-10 counter is built from a 4-bit one.",
    param: { label: "Modulus", min: 3, max: 16 },
    build: (modulus) => modNCounterDiagram({ modulus }),
  },
  {
    id: "register",
    name: "Parallel register",
    blurb:
      "n D flip-flops sharing one clock and one clear. Every bit loads at the same edge — the difference between a register and n unrelated flip-flops is that they are wired to the same clock.",
    param: { label: "Bits", min: 2, max: 8 },
    build: (bits) => registerDiagram({ bits }),
    lab: "register-4",
  },
  {
    id: "shift",
    name: "Shift register",
    blurb:
      "The same register with each output wired to the next input. Four wires is the entire difference, and it turns a store into a delay line.",
    param: { label: "Bits", min: 2, max: 8 },
    build: (bits) => shiftRegisterDiagram({ bits }),
    lab: "shift-4",
  },
  {
    id: "serial",
    name: "Serial to parallel",
    blurb:
      "A bit clock walking a counter, a demultiplexer steering each arriving bit to its own latch. This is how a shift register becomes a receiver.",
    param: { label: "Outputs", min: 2, max: 8 },
    build: (outputs) => serialToParallelDiagram({ outputs }),
  },
];

export function SequentialView() {
  const theme = useDiagramTheme();
  const [id, setId] = useState<string>(ENTRIES[0]!.id);
  const [n, setN] = useState(4);

  const entry = ENTRIES.find((e) => e.id === id) ?? (ENTRIES[0] as Entry);
  const value = entry.param
    ? Math.min(entry.param.max, Math.max(entry.param.min, n))
    : 0;

  const diagram = useMemo(
    () => (entry.build ? entry.build(value) : null),
    [entry, value],
  );

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Timer className="size-4" />
            Sequential circuits
          </h2>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            A counter has no truth table — its output depends on how many clock edges
            have happened, not on what its inputs are right now. So these live here
            rather than under a function, and each one links to the Lab preset that
            builds it out of real 74xx flip-flops.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Circuit</Label>
          <Select value={id} onValueChange={setId}>
            <SelectTrigger className="h-9 w-56 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTRIES.map((e) => (
                <SelectItem key={e.id} value={e.id} className="text-sm">
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {entry.param && (
          <div className="space-y-1.5">
            <Label htmlFor="seq-n" className="text-xs">
              {entry.param.label}
            </Label>
            <div className="flex items-center gap-2">
              <input
                id="seq-n"
                type="range"
                min={entry.param.min}
                max={entry.param.max}
                value={value}
                onChange={(e) => setN(Number(e.target.value))}
                className="accent-primary h-1.5 w-32 cursor-pointer"
              />
              <span className="text-muted-foreground w-6 font-mono text-xs tabular-nums">
                {value}
              </span>
            </div>
          </div>
        )}

        {entry.lab && (
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <Link href="/lab">
              Build it in the Lab <ExternalLink />
            </Link>
          </Button>
        )}
      </div>

      <p className="text-muted-foreground text-sm text-pretty">{entry.blurb}</p>

      {diagram ? (
        <DiagramFigure diagram={diagram} theme={theme} maxHeight={460} />
      ) : (
        <CounterDesigner />
      )}

      <Separator />
    </section>
  );
}
