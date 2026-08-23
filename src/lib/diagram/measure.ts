import type { Block, DiagramGateOp, Port, Rotation, Side } from "./types";
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

/** A junction dot's box. Small, square, and centred on its single pin. */
export const NODE_SIZE = 10;

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
    case "node":
      return { w: NODE_SIZE, h: NODE_SIZE };
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

  // A junction's pin is its centre, and it has NO stub: a wire meeting a
  // junction meets it at the dot, from whichever side it arrives. The zero
  // `out` vector is what tells the router "this end faces nowhere" — see
  // `route.ts`, which offers a free terminal both an across-then-down and a
  // down-then-across path instead of forcing an escape direction on it.
  if (block.kind === "node") {
    for (const p of block.ports) {
      out.set(p.id, {
        port: p,
        x: size.w / 2,
        y: size.h / 2,
        ax: size.w / 2,
        ay: size.h / 2,
        out: { x: 0, y: 0 },
      });
    }
    return out;
  }

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

// --- gate geometry ----------------------------------------------------------

/**
 * Where the LEFTMOST drawn line of a gate is, at height `y`.
 *
 * An AND gate has a flat back, so its input pins at `x = 0` touch it. An OR
 * gate does not: its back is bowed inward, and at the middle of a 56px-wide
 * body that bow is more than 7px to the RIGHT of the bounding box. Every input
 * wire therefore stopped 7px short of the symbol and hung in space — most
 * visibly on a 2-input OR, whose pins sit exactly where the bow is deepest.
 *
 * This is the fix, and it belongs here rather than in the renderer because it
 * is the same curve `svg.ts` and `latex.ts` both draw: one source for the
 * shape, and the wire is extended to meet it.
 *
 * The two curves are quadratic Béziers whose y-component works out linear in
 * `t` (`y(t) = tH`), so `t` is simply `y / h` and there is nothing to solve.
 */
export function gateBackX(op: DiagramGateOp, size: Box, y: number): number {
  const t = size.h === 0 ? 0.5 : Math.min(1, Math.max(0, y / size.h));
  const bow = 2 * t * (1 - t);
  if (op === "xor" || op === "xnor") {
    // The extra arc, which stands off in FRONT of the back and is the leftmost
    // thing drawn near the ends. `-6` mirrors the offset in the renderers.
    return -6 * ((1 - t) ** 2 + t ** 2) + bow * size.w * 0.2;
  }
  if (op === "or" || op === "nor") return bow * size.w * 0.26;
  return 0;
}

// --- rotation ---------------------------------------------------------------

/**
 * Rotation is applied to a PLACEMENT, so all of it lives in these four
 * functions and every consumer — the router, the hit test, both exporters —
 * reads the rotated numbers without knowing rotation exists.
 *
 * Clockwise, because that is the direction the on-screen button turns.
 */
export const rotatedSize = (size: Box, rotation: Rotation): Box =>
  rotation === 90 || rotation === 270 ? { w: size.h, h: size.w } : size;

/** A point in the block's own frame, mapped into the rotated frame. */
export function rotatePoint(p: Vec, size: Box, rotation: Rotation): Vec {
  switch (rotation) {
    case 90:
      return { x: size.h - p.y, y: p.x };
    case 180:
      return { x: size.w - p.x, y: size.h - p.y };
    case 270:
      return { x: p.y, y: size.w - p.x };
    default:
      return p;
  }
}

/**
 * A direction vector, rotated. Zero stays zero — a junction faces nowhere.
 *
 * Negating a component of a unit vector produces `-0`, which compares equal to
 * `0` under `===` and NOT equal under `Object.is` — so it is invisible until it
 * reaches a deep-equality check or gets printed into a file. Normalised here,
 * once, rather than defended against everywhere downstream.
 */
export function rotateVec(v: Vec, rotation: Rotation): Vec {
  switch (rotation) {
    case 90:
      return { x: z(-v.y), y: z(v.x) };
    case 180:
      return { x: z(-v.x), y: z(-v.y) };
    case 270:
      return { x: z(v.y), y: z(-v.x) };
    default:
      return v;
  }
}

const z = (n: number): number => (n === 0 ? 0 : n);

/**
 * The translation that must precede `rotate(deg)` for the rotated shape to land
 * with its bounding box at the origin. SVG and TikZ both need it.
 */
export function rotationOffset(size: Box, rotation: Rotation): Vec {
  switch (rotation) {
    case 90:
      return { x: size.h, y: 0 };
    case 180:
      return { x: size.w, y: size.h };
    case 270:
      return { x: 0, y: size.w };
    default:
      return { x: 0, y: 0 };
  }
}

/** Every port of a block, positioned and turned. One place does both. */
export function placeRotatedPorts(
  block: Block,
  size: Box,
  rotation: Rotation,
): Map<string, PlacedPort> {
  const local = placePorts(block, size);
  if (rotation === 0) return local;
  const out = new Map<string, PlacedPort>();
  for (const [id, p] of local) {
    const at = rotatePoint({ x: p.x, y: p.y }, size, rotation);
    const anchor = rotatePoint({ x: p.ax, y: p.ay }, size, rotation);
    out.set(id, {
      port: p.port,
      x: at.x,
      y: at.y,
      ax: anchor.x,
      ay: anchor.y,
      out: rotateVec(p.out, rotation),
    });
  }
  return out;
}
