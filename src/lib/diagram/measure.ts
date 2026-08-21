import type { Block, Port, Side } from "./types";
import type { DiagramTheme } from "./theme";

/**
 * How big is a block, and where exactly is each of its ports?
 *
 * Separated from `layout.ts` because it is the one part that has to lie about
 * fonts. There is no text metrics API in a Web Worker or a Node test — and
 * `src/lib` must run in both (Invariant 3) — so widths are ESTIMATED from
 * character counts. The estimate is deliberately generous: a box 6px too wide is
 * invisible, a title clipped by its own border is not.
 *
 * Everything downstream (layering, routing, the SVG writer) reads its geometry
 * from here and nowhere else, so a change to port pitch moves the wires with the
 * pins instead of leaving them behind.
 */

export interface Vec {
  readonly x: number;
  readonly y: number;
}

export interface PlacedPort {
  readonly port: Port;
  /** Where the port meets the block's border. */
  readonly x: number;
  readonly y: number;
  /** Where a wire attaches — the far end of the stub. */
  readonly ax: number;
  readonly ay: number;
  /** Unit vector pointing AWAY from the block. */
  readonly out: Vec;
}

export interface Box {
  readonly w: number;
  readonly h: number;
}

// --- constants --------------------------------------------------------------

/** Vertical distance between two ports on the same edge. */
export const PORT_PITCH = 20;
/** Horizontal distance between two ports on the top or bottom edge. */
export const PORT_PITCH_H = 34;
/** How far outside the border a wire attaches. The stub is drawn as part of the block. */
export const STUB = 14;
export const BLOCK_MIN_W = 92;
export const BLOCK_MIN_H = 52;
export const BLOCK_PAD_X = 12;

/**
 * The MINIMUM gate size. A gate grows with its fan-in — an 8-input OR drawn at
 * the same height as a 2-input one has its pins 5px apart and is unreadable, and
 * these diagrams routinely produce wide gates (a decoder's collecting OR has one
 * input per minterm).
 */
export const GATE_W = 56;
export const GATE_H = 42;
/** Vertical pitch between a gate's input pins. */
const GATE_PIN_PITCH = 13;

export const IO_H = 26;
export const IO_PAD_X = 12;

/**
 * Average glyph advance as a fraction of font size.
 *
 * 0.58 for the UI sans and 0.62 for the mono are measured from the two stacks
 * this app actually ships, rounded UP. Under-estimating clips text; over-
 * estimating leaves a little air. Only one of those is a bug.
 */
const SANS_ADVANCE = 0.58;
const MONO_ADVANCE = 0.62;

export const textWidth = (text: string, size: number, mono = false): number =>
  text.length * size * (mono ? MONO_ADVANCE : SANS_ADVANCE);

// --- port grouping ----------------------------------------------------------

export const portsOnSide = (block: Block, side: Side): Port[] =>
  block.ports.filter((p) => p.side === side);

/**
 * Fractional positions of `n` ports along an edge, in [0, 1].
 *
 * Naively that is `(i+1)/(n+1)`. The wrinkle is `gapBefore`: a decoder's `A1 A0`
 * and its `E` are not the same kind of thing, and drawing them at an even pitch
 * makes the reader hunt for the enable. A flagged port widens the gap ahead of
 * it, which costs one line here and saves a sentence in the caption.
 */
export function slotFractions(ports: readonly Port[]): number[] {
  const n = ports.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];

  // n + 1 gaps: before the first port, between each pair, after the last.
  const gaps: number[] = Array.from({ length: n + 1 }, () => 1);
  ports.forEach((p, i) => {
    if (p.gapBefore && i > 0) gaps[i] = 1.9;
  });

  const total = gaps.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += gaps[i] as number;
    out.push(acc / total);
  }
  return out;
}

// --- sizing -----------------------------------------------------------------

function boxSize(block: Block, theme: DiagramTheme): Box {
  const left = portsOnSide(block, "left");
  const right = portsOnSide(block, "right");
  const top = portsOnSide(block, "top");
  const bottom = portsOnSide(block, "bottom");

  const gapWeight = (ports: readonly Port[]): number =>
    ports.length + ports.filter((p) => p.gapBefore).length * 0.9;

  const sideHeight = (ports: readonly Port[]): number =>
    ports.length === 0 ? 0 : (gapWeight(ports) + 1) * PORT_PITCH;

  const titleH = theme.titleSize * 1.35;
  const subH = block.subtitle && theme.showSubtitles ? theme.subtitleSize * 1.5 : 0;

  const h = Math.max(
    BLOCK_MIN_H,
    sideHeight(left),
    sideHeight(right),
    titleH + subH + 24,
  );

  const labelW = (ports: readonly Port[]): number =>
    theme.showPortLabels
      ? Math.max(0, ...ports.map((p) => textWidth(p.label, theme.portLabelSize, true)))
      : 0;

  const textW = Math.max(
    textWidth(block.title, theme.titleSize),
    block.subtitle && theme.showSubtitles
      ? textWidth(block.subtitle, theme.subtitleSize)
      : 0,
  );

  /**
   * The centre text and the two columns of port labels have to COEXIST, not
   * merely fit individually. A 74138's `outputs Y0–Y3` subtitle drawn on a box
   * sized for its title alone runs straight through the `Y2` pin label — and the
   * result reads as a different pin name, which is the one thing a labelled
   * diagram must never do. So the width is the honest sum: labels, text, labels.
   */
  const sidesW = labelW(left) + labelW(right) + BLOCK_PAD_X * 3;
  const topW = Math.max(gapWeight(top), gapWeight(bottom)) * PORT_PITCH_H + PORT_PITCH_H;

  const w = Math.max(BLOCK_MIN_W, textW + BLOCK_PAD_X * 2, sidesW + textW, topW);

  // Round to a whole pixel so strokes stay crisp and layout is reproducible.
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

export function measure(block: Block, theme: DiagramTheme): Box {
  switch (block.kind) {
    case "gate": {
      const ins = portsOnSide(block, "left").length;
      const h = Math.max(GATE_H, ins * GATE_PIN_PITCH + 12);
      // The AND body's nose is an arc of radius h/2 springing from x = 0.42w, so
      // the tip lands at 0.42w + h/2. Widening with height is what keeps that tip
      // inside the box the router thinks the gate occupies.
      const w = Math.max(GATE_W, Math.ceil(h * 0.9));
      return { w, h };
    }
    case "io": {
      const w = textWidth(block.title, theme.titleSize, true) + IO_PAD_X * 2;
      return { w: Math.ceil(Math.max(38, w)), h: IO_H };
    }
    case "label": {
      const w = textWidth(block.title, theme.subtitleSize) + 8;
      return { w: Math.ceil(Math.max(30, w)), h: Math.ceil(theme.subtitleSize * 1.6) };
    }
    case "box":
      return boxSize(block, theme);
  }
}

// --- port placement ---------------------------------------------------------

const OUT_OF: Readonly<Record<Side, Vec>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/**
 * Every port of a block, positioned relative to the block's own origin.
 *
 * A gate is special-cased: its inputs sit on the flat left edge of a shape whose
 * right side is a curve, and its single output is at the tip. Everything else is
 * a rectangle and shares one code path.
 */
export function placePorts(block: Block, size: Box): Map<string, PlacedPort> {
  const out = new Map<string, PlacedPort>();

  const put = (port: Port, x: number, y: number): void => {
    const v = OUT_OF[port.side];
    out.set(port.id, {
      port,
      x,
      y,
      ax: x + v.x * STUB,
      ay: y + v.y * STUB,
      out: v,
    });
  };

  if (block.kind === "io" || block.kind === "label") {
    // An IO tag has at most one port, and it sits on the edge the tag faces.
    for (const p of block.ports) {
      const x = p.side === "left" ? 0 : p.side === "right" ? size.w : size.w / 2;
      const y = p.side === "top" ? 0 : p.side === "bottom" ? size.h : size.h / 2;
      put(p, x, y);
    }
    return out;
  }

  for (const side of ["left", "right", "top", "bottom"] as const) {
    const ports = portsOnSide(block, side);
    const fracs = slotFractions(ports);
    ports.forEach((p, i) => {
      const f = fracs[i] as number;
      switch (side) {
        case "left":
          put(p, 0, Math.round(size.h * f));
          break;
        case "right":
          put(p, size.w, Math.round(size.h * f));
          break;
        case "top":
          put(p, Math.round(size.w * f), 0);
          break;
        case "bottom":
          put(p, Math.round(size.w * f), size.h);
          break;
      }
    });
  }

  // A gate's output belongs at the tip of the symbol, on the vertical midline —
  // never at a fraction of the height, which would put an inverter's output
  // above its input.
  if (block.kind === "gate") {
    for (const p of portsOnSide(block, "right")) {
      put(p, size.w, Math.round(size.h / 2));
    }
  }

  return out;
}
