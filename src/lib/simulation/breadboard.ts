/**
 * Breadboard geometry and the electrical semantics of its holes.
 *
 * This file is the whole reason Invariant 1 exists. A breadboard is a SHORTING
 * DEVICE: a 5-hole column strip is a hard short between five holes, and a power
 * rail is one node with fifty connections. Neither can be expressed as a
 * point-to-point `source -> target` edge — you would have to invent phantom
 * edges and then keep them in sync forever.
 *
 * Because nets are N-ary and rebuilt by union-find from scratch on every
 * topology change, the board costs almost nothing to add: its strips are just
 * more endpoints seeded into the same disjoint-set. Nothing in the solver, the
 * diagnostics, or the verification bridge changes at all.
 *
 * THE THREE FACTS THAT MAKE A BREADBOARD A BREADBOARD:
 *
 *  1. Within one column, holes A-E are shorted. Separately, F-J are shorted.
 *  2. A-E and F-J are NOT connected — the centre channel separates them. That
 *     gap is the entire point: a DIP straddles it, so its left-hand pins and
 *     right-hand pins land on different strips instead of shorting together.
 *  3. The power rails run the length of the board, but real boards BREAK them at
 *     the midpoint. Modelling a rail as one continuous net is a classic way to
 *     produce a simulation that works and a physical board that doesn't.
 */

/** Rows within a terminal strip. */
export const ROWS_LOWER = ["A", "B", "C", "D", "E"] as const;
export const ROWS_UPPER = ["F", "G", "H", "I", "J"] as const;
export const ALL_ROWS = [...ROWS_LOWER, ...ROWS_UPPER] as const;

export type TerminalRow = (typeof ALL_ROWS)[number];
/** `+` and `-` are the power rails; there is one pair above and one below. */
export type RailRow = "+top" | "-top" | "+bottom" | "-bottom";
export type BoardRow = TerminalRow | RailRow;

export interface HoleRef {
  /** 1-based, left to right. */
  readonly col: number;
  readonly row: BoardRow;
}

export interface BreadboardSpec {
  readonly columns: number;
  /** Real boards break their rails at the midpoint. See fact 3 above. */
  readonly railSegments: number;
}

/** A full-size solderless breadboard: 63 columns, rails broken in the middle. */
export const DEFAULT_BOARD: BreadboardSpec = { columns: 63, railSegments: 2 };

export const isRail = (row: BoardRow): row is RailRow =>
  row === "+top" || row === "-top" || row === "+bottom" || row === "-bottom";

export const isPositiveRail = (row: BoardRow): boolean =>
  row === "+top" || row === "+bottom";

export const holeKey = (h: HoleRef): string => `${h.col}/${h.row}`;

export function parseHoleKey(key: string): HoleRef | null {
  const [col, row] = key.split("/");
  if (!col || !row) return null;
  return { col: Number(col), row: row as BoardRow };
}

/**
 * The STRIP a hole belongs to — the set of holes it is electrically shorted to.
 *
 * Everything about the board's electrics reduces to this one function: two holes
 * are connected iff they return the same strip id. The union-find seeds itself
 * by grouping holes on strip id, and that is the entire integration.
 */
export function stripOf(spec: BreadboardSpec, hole: HoleRef): string {
  if (isRail(hole.row)) {
    // Rails are broken into segments, so a jumper into the left half of the +
    // rail does NOT power a chip wired to the right half. This trips people up on
    // real boards, and a simulator that pretends otherwise is teaching a lie.
    const perSegment = Math.ceil(spec.columns / spec.railSegments);
    const segment = Math.floor((hole.col - 1) / perSegment);
    return `rail:${hole.row}:${segment}`;
  }

  // The centre channel: A-E is one strip, F-J is another, and they never meet.
  const half = (ROWS_LOWER as readonly string[]).includes(hole.row) ? "L" : "U";
  return `col:${hole.col}:${half}`;
}

export const sameStrip = (
  spec: BreadboardSpec,
  a: HoleRef,
  b: HoleRef,
): boolean => stripOf(spec, a) === stripOf(spec, b);

/** Every hole on the board, in a stable order. */
export function allHoles(spec: BreadboardSpec): HoleRef[] {
  const out: HoleRef[] = [];
  const rails: RailRow[] = ["+top", "-top", "+bottom", "-bottom"];

  for (let col = 1; col <= spec.columns; col++) {
    for (const row of rails) out.push({ col, row });
    for (const row of ALL_ROWS) out.push({ col, row });
  }
  return out;
}

export const inBounds = (spec: BreadboardSpec, hole: HoleRef): boolean =>
  hole.col >= 1 && hole.col <= spec.columns;

// ---------------------------------------------------------------------------
// Rendering geometry
// ---------------------------------------------------------------------------

/** One hole pitch, in canvas units. A real board is 0.1in; 24px reads well. */
export const PITCH = 24;
export const BOARD_PAD = 20;
/** The gap the centre channel opens between rows E and F, in pitches. */
export const CHANNEL = 2;

/**
 * Vertical slot index of each row, top to bottom. The channel gap between E and F
 * is what a DIP straddles, so it is baked into the layout rather than added as an
 * afterthought.
 */
const ROW_SLOT: Readonly<Record<BoardRow, number>> = {
  "+top": 0,
  "-top": 1,

  // Upper strip, running DOWN toward the channel, so F is the row beside it.
  J: 3,
  I: 4,
  H: 5,
  G: 6,
  F: 7,

  // …the channel…

  // Lower strip, running AWAY from the channel, so E is the row beside it.
  //
  // The order here is load-bearing, not cosmetic. A DIP's pins sit in rows E and
  // F, and those two must be ADJACENT ACROSS THE CHANNEL — that adjacency IS the
  // 0.3-inch DIP width. Ordering this half A..E downward instead put row A next
  // to the channel and stretched every chip to seven rows tall.
  E: 7 + CHANNEL + 1,
  D: 7 + CHANNEL + 2,
  C: 7 + CHANNEL + 3,
  B: 7 + CHANNEL + 4,
  A: 7 + CHANNEL + 5,

  "-bottom": 7 + CHANNEL + 7,
  "+bottom": 7 + CHANNEL + 8,
};

export const holePoint = (hole: HoleRef): { x: number; y: number } => ({
  x: BOARD_PAD + (hole.col - 1) * PITCH + PITCH / 2,
  y: BOARD_PAD + (ROW_SLOT[hole.row] as number) * PITCH + PITCH / 2,
});

export const boardWidth = (spec: BreadboardSpec): number =>
  BOARD_PAD * 2 + spec.columns * PITCH;

export const boardHeight = (): number =>
  BOARD_PAD * 2 + (ROW_SLOT["+bottom"] + 1) * PITCH;

/** Nearest hole to a canvas point, or null if the point is off the board. */
export function holeAt(
  spec: BreadboardSpec,
  x: number,
  y: number,
): HoleRef | null {
  const col = Math.round((x - BOARD_PAD - PITCH / 2) / PITCH) + 1;
  if (col < 1 || col > spec.columns) return null;

  const slot = Math.round((y - BOARD_PAD - PITCH / 2) / PITCH);
  const row = (Object.keys(ROW_SLOT) as BoardRow[]).find(
    (r) => ROW_SLOT[r] === slot,
  );
  return row ? { col, row } : null;
}

// ---------------------------------------------------------------------------
// Placing a DIP
// ---------------------------------------------------------------------------

/**
 * Where each pin of a DIP lands when the chip is seated with pin 1 at `origin`.
 *
 * A DIP STRADDLES THE CENTRE CHANNEL. Pins 1..n/2 sit in row E (the top of the
 * lower strip) and pins n/2+1..n sit in row F (the bottom of the upper strip),
 * running back the other way — which is exactly the counter-clockwise numbering
 * the package is printed with.
 *
 * If the channel did not exist, the chip's left and right pins would land on the
 * same strip and every gate would be shorted input-to-output. That is why fact 2
 * above is load-bearing, and why there is a test for it.
 */
export function dipHoles(
  origin: { col: number },
  pinCount: number,
): HoleRef[] {
  const perRow = pinCount / 2;
  const holes: HoleRef[] = [];

  for (let pin = 1; pin <= pinCount; pin++) {
    if (pin <= perRow) {
      holes.push({ col: origin.col + (pin - 1), row: "E" });
    } else {
      holes.push({ col: origin.col + (pinCount - pin), row: "F" });
    }
  }
  return holes;
}

/** Does a DIP seated here fit on the board? */
export const dipFits = (
  spec: BreadboardSpec,
  origin: { col: number },
  pinCount: number,
): boolean =>
  origin.col >= 1 && origin.col + pinCount / 2 - 1 <= spec.columns;
