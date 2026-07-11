"use client";

import { motion } from "framer-motion";
import type { KMapLayout, KMapLoop } from "@/lib/core-engine/kmap";
import { DONT_CARE, type BooleanFunction, type TruthValue } from "@/lib/core-engine/types";
import { cn } from "@/lib/utils";

const CELL = 56;
const PAD = 34; // room for the Gray-code headers
const GLYPH: Readonly<Record<TruthValue, string>> = { 0: "0", 1: "1", 2: "X" };

interface Props {
  fn: BooleanFunction;
  layout: KMapLayout;
  loops: readonly KMapLoop[];
  /** Loop label being hovered in the PI chart — dims the others. */
  highlighted: string | null;
  onHighlight: (label: string | null) => void;
}

export function KMapGrid({ fn, layout, loops, highlighted, onHighlight }: Props) {
  const w = PAD + layout.cols * CELL;
  const h = PAD + layout.rows * CELL;

  const rowVars = layout.rowVariables.join("");
  const colVars = layout.colVariables.join("");

  return (
    <svg
      viewBox={`0 0 ${w + 4} ${h + 4}`}
      className="w-full max-w-md"
      role="img"
      aria-label={`Karnaugh map for ${fn.name}`}
    >
      {/* Axis captions */}
      <text x={4} y={13} className="fill-muted-foreground text-[11px] font-medium">
        {rowVars}
        <tspan className="fill-muted-foreground/50">\</tspan>
        {colVars}
      </text>

      {layout.colLabels.map((label, c) => (
        <text
          key={`col-${label}`}
          x={PAD + c * CELL + CELL / 2}
          y={24}
          textAnchor="middle"
          className="fill-muted-foreground font-mono text-[11px]"
        >
          {label}
        </text>
      ))}

      {layout.rowLabels.map((label, r) => (
        <text
          key={`row-${label}`}
          x={PAD - 8}
          y={PAD + r * CELL + CELL / 2 + 4}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-[11px]"
        >
          {label}
        </text>
      ))}

      {/* Cells */}
      {layout.cellIndex.map((row, r) =>
        row.map((m, c) => {
          const value = fn.values[m] as TruthValue;
          return (
            <g key={m}>
              <rect
                x={PAD + c * CELL}
                y={PAD + r * CELL}
                width={CELL}
                height={CELL}
                className="fill-card stroke-border"
                strokeWidth={1}
              />
              <text
                x={PAD + c * CELL + CELL / 2}
                y={PAD + r * CELL + CELL / 2 + 6}
                textAnchor="middle"
                className={cn(
                  "font-mono text-base font-semibold",
                  value === 1 && "fill-logic-high",
                  value === DONT_CARE && "fill-logic-z",
                  value === 0 && "fill-muted-foreground/40",
                )}
              >
                {GLYPH[value]}
              </text>
              <text
                x={PAD + c * CELL + 5}
                y={PAD + r * CELL + 13}
                className="fill-muted-foreground/40 font-mono text-[9px]"
              >
                {m}
              </text>
            </g>
          );
        }),
      )}

      {/* Loop overlays.
          A wrapping group is several disjoint rectangles (kmap.ts), so we draw
          every rect of every loop — there is no "the" rectangle. Overlapping
          loops are inset by their colour slot so coincident edges stay legible. */}
      {loops.map((loop) => {
        const dim = highlighted !== null && highlighted !== loop.label;
        const inset = 4 + (loop.colorIndex % 3) * 3.5;
        // `--loop-N`, not `--color-loop-N`: the @theme *inline* block folds its
        // values straight into utility classes and never emits the --color-*
        // custom properties, so var(--color-loop-1) resolves to nothing here.
        // Utilities like `fill-logic-high` are fine; direct var() reads are not.
        const color = `var(--loop-${loop.colorIndex + 1})`;

        return (
          <g
            key={loop.label}
            onMouseEnter={() => onHighlight(loop.label)}
            onMouseLeave={() => onHighlight(null)}
            className="cursor-pointer"
          >
            {loop.rects.map((rect, i) => (
              <motion.rect
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: dim ? 0.18 : 1, scale: 1 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                style={{ transformOrigin: "center", stroke: color, fill: color }}
                x={PAD + rect.col * CELL + inset}
                y={PAD + rect.row * CELL + inset}
                width={rect.colSpan * CELL - inset * 2}
                height={rect.rowSpan * CELL - inset * 2}
                rx={10}
                strokeWidth={2.5}
                fillOpacity={0.1}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
