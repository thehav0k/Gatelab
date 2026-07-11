"use client";

import type { GateOp } from "@/lib/simulation/logic";
import { GATE_H, GATE_W } from "@/lib/simulation/parts";

/**
 * Distinctive-shape (ANSI/IEEE) gate bodies. Deliberately real symbols rather
 * than labelled boxes — the shape is half of what a student is learning to read.
 */

const AND_BODY = `M0,0 H${GATE_W * 0.45} A${GATE_H / 2},${GATE_H / 2} 0 0 1 ${GATE_W * 0.45},${GATE_H} H0 Z`;

const OR_BODY = `M0,0 Q${GATE_W * 0.55},2 ${GATE_W},${GATE_H / 2} Q${GATE_W * 0.55},${GATE_H - 2} 0,${GATE_H} Q${GATE_W * 0.28},${GATE_H / 2} 0,0 Z`;

const XOR_ARC = `M-8,0 Q${GATE_W * 0.2},${GATE_H / 2} -8,${GATE_H}`;

const NOT_BODY = `M0,0 L${GATE_W * 0.72},${GATE_H / 2} L0,${GATE_H} Z`;

/** The inversion bubble. Its presence is the entire difference between AND and NAND. */
const BUBBLE_R = 5;

interface Props {
  op: GateOp;
  className?: string;
}

export function GateSymbol({ op, className }: Props) {
  const inverted = op === "nand" || op === "nor" || op === "xnor" || op === "not";
  const shape =
    op === "and" || op === "nand"
      ? "and"
      : op === "or" || op === "nor" || op === "xor" || op === "xnor"
        ? "or"
        : "not";

  const bubbleX =
    shape === "and" ? GATE_W : shape === "or" ? GATE_W : GATE_W * 0.72;

  return (
    <g className={className}>
      {shape === "and" && <path d={AND_BODY} />}
      {shape === "or" && <path d={OR_BODY} />}
      {shape === "not" && <path d={NOT_BODY} />}

      {(op === "xor" || op === "xnor") && <path d={XOR_ARC} fill="none" />}

      {inverted && (
        <circle cx={bubbleX + BUBBLE_R} cy={GATE_H / 2} r={BUBBLE_R} />
      )}

      {/* The stub from the body to the output pin, so the wire meets the symbol. */}
      <line
        x1={inverted ? bubbleX + BUBBLE_R * 2 : bubbleX}
        y1={GATE_H / 2}
        x2={GATE_W}
        y2={GATE_H / 2}
        fill="none"
      />
    </g>
  );
}
