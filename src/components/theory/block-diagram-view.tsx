"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DiagramFigure } from "@/components/diagrams/diagram-figure";
import { dontCares, minterms } from "@/lib/core-engine/canonical";
import type { BooleanFunction } from "@/lib/core-engine/types";
import { article, type FunctionSpec } from "@/lib/diagram/builders/kit";
import {
  decoderImplementation,
  gateLevelDiagram,
  muxImplementation,
  muxTreeForFunction,
} from "@/lib/diagram/builders/logic";
import { THEMES } from "@/lib/diagram/theme";
import type { Diagram } from "@/lib/diagram/types";
import { useConstraint } from "@/stores/workspace-store";
import { useDiagramStore, useDiagramTheme } from "@/stores/diagram-store";

/**
 * The bridge the other direction: from the function you are minimising to the
 * four standard ways of DRAWING it.
 *
 * These are not four styles of the same picture. They are four different answers,
 * and which one is correct depends on what the question allowed you to use — a
 * decoder, one multiplexer, a pile of 2:1 multiplexers, or gates. Putting them
 * side by side is the point: the gate version has the fewest components and the
 * decoder version shares its cost across every output, and a student who has only
 * ever seen one of them cannot make that trade.
 *
 * Everything here reuses the builders behind /diagrams, so a figure exported from
 * this tab is identical to one exported from there — including the styling, which
 * comes from the same persisted theme.
 */

type Mode = "gates" | "decoder" | "mux" | "muxtree";

const MODES: { value: Mode; label: string; blurb: string }[] = [
  {
    value: "gates",
    label: "Gates",
    blurb:
      "The minimal expression as gates, under whatever gate rule is currently active.",
  },
  {
    value: "decoder",
    label: "Decoder + OR",
    blurb:
      "A decoder generates every minterm; the function is an OR of the rows where it is 1. More gates, but the decoder is shared by every output you add.",
  },
  {
    value: "mux",
    label: "One multiplexer",
    blurb:
      "Shannon expansion: n−1 variables on the select lines, and each data input is 0, 1, the last variable, or its complement — read straight off the truth table.",
  },
  {
    value: "muxtree",
    label: "2:1 multiplexers",
    blurb:
      "A reduced decision tree. No gates at all, not even an inverter — a mux with I0 = 1 and I1 = 0 IS a complement.",
  },
];

export function BlockDiagramView({ fn }: { fn: BooleanFunction }) {
  const [mode, setMode] = useState<Mode>("gates");
  const constraint = useConstraint();
  const theme = useDiagramTheme();
  const themeName = useDiagramStore((s) => s.themeName);
  const setThemeName = useDiagramStore((s) => s.setThemeName);

  const spec: FunctionSpec = useMemo(
    () => ({
      name: fn.name || "F",
      variables: fn.variables,
      minterms: minterms(fn),
      dontCares: dontCares(fn),
    }),
    [fn],
  );

  const diagram: Diagram | null = useMemo(() => {
    // A constant function has no circuit, and every builder below would draw a
    // wire from nothing. Say so instead.
    if (spec.minterms.length === 0 || spec.minterms.length === 1 << fn.variables.length) {
      return null;
    }
    try {
      switch (mode) {
        case "gates":
          return gateLevelDiagram([spec], {
            id: `theory-gates-${spec.name}`,
            title: `${spec.name} — gate diagram`,
            strategy: constraint.strategy,
            ...(constraint.id !== "none" ? { allowed: constraint.gates } : {}),
          });
        case "decoder":
          return decoderImplementation([spec], {
            id: `theory-dec-${spec.name}`,
            title: `${spec.name} — from ${article(fn.variables.length)} ${fn.variables.length}-to-${1 << fn.variables.length} decoder`,
          });
        case "mux":
          return muxImplementation(spec, {
            id: `theory-mux-${spec.name}`,
            title: `${spec.name} — on ${article(1 << Math.max(1, fn.variables.length - 1))} ${1 << Math.max(1, fn.variables.length - 1)}-to-1 multiplexer`,
            selectBits: Math.max(1, fn.variables.length - 1),
          });
        case "muxtree":
          return muxTreeForFunction(spec, {
            id: `theory-tree-${spec.name}`,
            title: `${spec.name} — from 2-to-1 multiplexers only`,
          });
      }
    } catch {
      return null;
    }
  }, [mode, spec, fn.variables.length, constraint.strategy, constraint.id, constraint.gates]);

  const active = MODES.find((m) => m.value === mode);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(v) => v && setMode(v as Mode)}
          className="justify-start"
        >
          {MODES.map((m) => (
            <ToggleGroupItem key={m.value} value={m.value} className="px-3 text-xs">
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="ml-auto flex items-center gap-2">
          <Select value={themeName} onValueChange={setThemeName}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((t) => (
                <SelectItem key={t.name} value={t.name} className="text-xs">
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" size="sm">
            <Link href="/diagrams">
              More styling <ExternalLink />
            </Link>
          </Button>
        </div>
      </div>

      {active && (
        <p className="text-muted-foreground text-xs text-pretty">{active.blurb}</p>
      )}

      {diagram ? (
        <DiagramFigure diagram={diagram} theme={theme} maxHeight={480} />
      ) : (
        <Alert>
          <AlertTitle>Nothing to draw</AlertTitle>
          <AlertDescription>
            This function is constant — tie the output to +5V or to GND. Every
            construction below needs at least one row of each value.
          </AlertDescription>
        </Alert>
      )}

      <p className="text-muted-foreground text-xs text-pretty">
        Every figure here exports as SVG or PNG from the toolbar above it. The full
        set of worked block-diagram problems — demultiplexer trees, adders,
        counters, memory expansion — is on the{" "}
        <Link href="/diagrams" className="text-foreground underline underline-offset-4">
          Diagrams
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
