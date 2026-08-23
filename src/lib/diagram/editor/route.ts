import type { Point } from "../layout";
import type { Vec } from "../measure";

/**
 * Orthogonal routing for FREELY PLACED blocks.
 *
 * WHY NOT THE A* ROUTER THE LAB ALREADY HAS. `simulation/router.ts` is a proper
 * A* over `(x, y, incoming-direction)` with a bend penalty, and it produces
 * better paths than this does. It is also the wrong tool here, twice over: it
 * allocates three `Int32Array`s the size of (grid cells x 5 directions) per
 * wire, which on an editor-sized canvas is megabytes per link — and it has to
 * run on every frame of a drag, for every wire attached to the block being
 * dragged. A board is routed once when it changes; a canvas is routed sixty
 * times a second.
 *
 * So this is a CANDIDATE router: propose the shapes a person would actually
 * draw between two pins, score each on bends, length, blocks cut through and
 * wires sat on top of, and take the best. No search, no allocation,
 * deterministic, and fast enough to run while the mouse is moving.
 *
 * THE SHAPES ARE GENERATED, NOT ENUMERATED BY CASE. An earlier version had one
 * hand-written list of candidates per combination of pin orientations, which
 * meant the pairs nobody had thought about (a top pin to a bottom pin, anything
 * involving a junction) fell through to a two-point path that was neither
 * orthogonal nor sensible. Now every shape is an H-V-H or a V-H-V through one
 * free coordinate, the interesting values of that coordinate are collected from
 * the geometry, and each end simply REJECTS the shapes that leave its pin
 * sideways. Adding a new kind of pin costs nothing.
 *
 * A LINK'S OWN BLOCKS ARE OBSTACLES TOO. This looks wrong at first — a pin sits
 * on its block's border, so surely a wire must be allowed to touch it — but the
 * path here runs anchor to anchor, and an anchor is already a stub's length
 * OUTSIDE the border. A route therefore never needs to enter either block, and
 * excluding them means a wire into a pin on the UNDERSIDE of a multiplexer drops
 * straight down through the body and comes out below it. Blocks are drawn over
 * wires, so the result was a select line that appeared to stop dead at the top
 * edge and reappear as a stub underneath.
 */

export interface Obstacle {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly id: string;
}

export interface Terminal {
  readonly x: number;
  readonly y: number;
  /**
   * Unit vector pointing away from the block, or ZERO for a pin that faces
   * nowhere — a junction dot. A free end accepts a wire from any direction,
   * which is the whole reason junctions can join two arbitrary points.
   */
  readonly out: Vec;
  readonly block: string;
}

/** A segment of a wire that has already been routed, for the overlap penalty. */
export interface Occupied {
  readonly a: Point;
  readonly b: Point;
  /** Wires from the SAME source pin are one signal and may share a lane. */
  readonly key: string;
}

export interface RouteOptions {
  readonly occupied?: readonly Occupied[];
  /** Fan-out key of the wire being routed; matches `Occupied.key`. */
  readonly key?: string;
}

/** How far a wire stands off a pin before it is allowed to turn. */
const ESCAPE = 16;
/** Clearance when a wire has to go round the outside of something. */
const LANE = 24;

const BEND_COST = 40;
const CROSS_COST = 4000;
/**
 * Leaving a pin in the direction it does not face.
 *
 * Not fatal — sometimes the only way out of a corner is backwards — but it must
 * lose to any path that goes the right way, including one with an extra bend.
 */
const BACKWARD_COST = 600;
/**
 * Per pixel of running exactly on top of another wire.
 *
 * Two wires sharing a lane read as ONE wire, which is the same failure as a
 * wire crossing a block: the picture states something that is not true. It is
 * charged by length rather than per-incident because a 4px touch where two
 * wires cross paths is nothing and a 300px shared run is the whole problem.
 */
const OVERLAP_COST = 3;

/**
 * Occupancy is O(wires x segments), so it is switched off on a canvas big
 * enough for that to be felt during a drag. Overlapping wires on a 200-wire
 * sheet are the least of the reader's problems.
 */
const OCCUPANCY_LIMIT = 4000;

export function routeLink(
  from: Terminal,
  to: Terminal,
  obstacles: readonly Obstacle[],
  opts: RouteOptions = {},
): Point[] {
  const candidates = proposals(from, to, obstacles);

  // Only obstacles that could possibly be hit are worth testing — a link in the
  // top-left cannot cross a block in the bottom-right, and this pre-filter is
  // what keeps a hundred-block canvas interactive.
  const box = bounds([...candidates.flat(), { x: from.x, y: from.y }, { x: to.x, y: to.y }]);
  const relevant = obstacles.filter(
    (o) =>
      o.x < box.x1 && o.x + o.w > box.x0 && o.y < box.y1 && o.y + o.h > box.y0,
  );

  const all = opts.occupied ?? [];
  const occupied =
    all.length > OCCUPANCY_LIMIT
      ? []
      : all.filter(
          (s) =>
            s.key !== opts.key &&
            Math.min(s.a.x, s.b.x) <= box.x1 &&
            Math.max(s.a.x, s.b.x) >= box.x0 &&
            Math.min(s.a.y, s.b.y) <= box.y1 &&
            Math.max(s.a.y, s.b.y) >= box.y0,
        );

  let best: Point[] | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const path = simplify(candidate);
    const score = scoreOf(path, relevant, occupied, from, to);
    if (score < bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best ?? simplify([{ x: from.x, y: from.y }, { x: to.x, y: to.y }]);
}

// --- the candidate shapes ---------------------------------------------------

function proposals(
  from: Terminal,
  to: Terminal,
  obstacles: readonly Obstacle[],
): Point[][] {
  const s = { x: from.x, y: from.y };
  const t = { x: to.x, y: to.y };
  // The escape point. For a junction the out vector is zero, so it coincides
  // with the pin and `simplify` drops it — which is exactly right: a junction
  // imposes no leaving direction at all.
  const s1 = { x: s.x + from.out.x * ESCAPE, y: s.y + from.out.y * ESCAPE };
  const t1 = { x: t.x + to.out.x * ESCAPE, y: t.y + to.out.y * ESCAPE };

  const shapes: Point[][] = [];
  const add = (...middle: Point[]) => shapes.push([s, s1, ...middle, t1, t]);

  // The two L shapes. One of them is a straight line whenever the pins align.
  add({ x: t1.x, y: s1.y });
  add({ x: s1.x, y: t1.y });

  // Every H-V-H through one vertical channel, and every V-H-V through one
  // horizontal channel. Both families are orthogonal by construction, so there
  // is no combination of pin orientations that can fall through to a diagonal.
  for (const mx of columns(from, to, s1, t1, obstacles)) {
    add({ x: mx, y: s1.y }, { x: mx, y: t1.y });
  }
  for (const my of rows(from, to, s1, t1, obstacles)) {
    add({ x: s1.x, y: my }, { x: t1.x, y: my });
  }

  return shapes;
}

/** Interesting vertical channels: between the pins, and clear of the blocks. */
function columns(
  from: Terminal,
  to: Terminal,
  s1: Point,
  t1: Point,
  obstacles: readonly Obstacle[],
): number[] {
  // The midpoint, and a channel just outside the pair on each side. The outside
  // pair is what makes a route to a pin BEHIND the source possible at all: the
  // only way there is out, round and back, and with no obstacle in the picture
  // there would otherwise be nothing on offer but a line straight through both
  // blocks.
  const out = new Set<number>([
    (s1.x + t1.x) / 2,
    Math.min(s1.x, t1.x) - LANE,
    Math.max(s1.x, t1.x) + LANE,
  ]);
  for (const o of obstacles) {
    if (o.id !== from.block && o.id !== to.block) continue;
    out.add(o.x - LANE);
    out.add(o.x + o.w + LANE);
  }
  const blockers = between(obstacles, Math.min(s1.y, t1.y), Math.max(s1.y, t1.y), "y");
  if (blockers.length > 0) {
    out.add(Math.min(...blockers.map((o) => o.x)) - LANE);
    out.add(Math.max(...blockers.map((o) => o.x + o.w)) + LANE);
  }
  return [...out];
}

/** Interesting horizontal channels: between the pins, and clear of the blocks. */
function rows(
  from: Terminal,
  to: Terminal,
  s1: Point,
  t1: Point,
  obstacles: readonly Obstacle[],
): number[] {
  const out = new Set<number>([
    (s1.y + t1.y) / 2,
    Math.min(s1.y, t1.y) - LANE,
    Math.max(s1.y, t1.y) + LANE,
  ]);
  for (const o of obstacles) {
    if (o.id !== from.block && o.id !== to.block) continue;
    out.add(o.y - LANE);
    out.add(o.y + o.h + LANE);
  }
  const blockers = between(obstacles, Math.min(s1.x, t1.x), Math.max(s1.x, t1.x), "x");
  if (blockers.length > 0) {
    out.add(Math.min(...blockers.map((o) => o.y)) - LANE);
    out.add(Math.max(...blockers.map((o) => o.y + o.h)) + LANE);
  }
  return [...out];
}

/** The obstacles whose span overlaps `[lo, hi]` on one axis. */
const between = (
  obstacles: readonly Obstacle[],
  lo: number,
  hi: number,
  axis: "x" | "y",
): Obstacle[] =>
  obstacles.filter((o) => {
    const a = axis === "x" ? o.x : o.y;
    const b = a + (axis === "x" ? o.w : o.h);
    return b >= lo - LANE && a <= hi + LANE;
  });

// --- scoring ----------------------------------------------------------------

function scoreOf(
  path: readonly Point[],
  obstacles: readonly Obstacle[],
  occupied: readonly Occupied[],
  from: Terminal,
  to: Terminal,
): number {
  let length = 0;
  let crossings = 0;
  let overlap = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (const o of obstacles) if (segmentHits(a, b, o)) crossings += 1;
    for (const s of occupied) overlap += collinearOverlap(a, b, s.a, s.b);
  }
  const bends = Math.max(0, path.length - 2);
  return (
    crossings * CROSS_COST +
    bends * BEND_COST +
    overlap * OVERLAP_COST +
    backwards(path, from, to) * BACKWARD_COST +
    length
  );
}

/**
 * How many of the two ends the wire leaves — or arrives at — the wrong way
 * round.
 *
 * This is the rule that stops a wire being drawn straight through the block it
 * came out of. Between two pins facing each other across a gap, a straight line
 * is the right answer and has no bends, so it wins on every other term; between
 * a right-facing output and a pin BEHIND it, the very same straight line runs
 * backwards through both bodies and would still win. The difference is entirely
 * in the direction of the first step.
 *
 * It is measured on the SIMPLIFIED path, which matters: the escape stub always
 * points the right way, and it is only after the collinear points are collapsed
 * that the first segment is the wire's real first move.
 */
function backwards(path: readonly Point[], from: Terminal, to: Terminal): number {
  let n = 0;
  const start = path[0];
  const afterStart = path[1];
  if (start && afterStart) {
    const along =
      (afterStart.x - start.x) * from.out.x + (afterStart.y - start.y) * from.out.y;
    if (along < -0.5) n += 1;
  }
  const end = path[path.length - 1];
  const beforeEnd = path[path.length - 2];
  if (end && beforeEnd) {
    // Into a pin the wire must run AGAINST that pin's outward normal.
    const along = (end.x - beforeEnd.x) * to.out.x + (end.y - beforeEnd.y) * to.out.y;
    if (along > 0.5) n += 1;
  }
  return n;
}

/** Does an axis-aligned segment pass through a rectangle's interior? */
function segmentHits(a: Point, b: Point, o: Obstacle): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  // A 1px inset, so a wire running exactly along a border is not a "hit" — it
  // is what a wire leaving a pin does, and penalising it would push every route
  // into a needless detour.
  return x0 < o.x + o.w - 1 && o.x + 1 < x1 && y0 < o.y + o.h - 1 && o.y + 1 < y1;
}

/** How far two axis-aligned segments run along exactly the same line. */
function collinearOverlap(a: Point, b: Point, c: Point, d: Point): number {
  const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(c.y - d.y) < 0.5;
  const vertical = Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - d.x) < 0.5;
  if (horizontal && Math.abs(a.y - c.y) < 1.5) {
    return span(a.x, b.x, c.x, d.x);
  }
  if (vertical && Math.abs(a.x - c.x) < 1.5) {
    return span(a.y, b.y, c.y, d.y);
  }
  return 0;
}

const span = (a1: number, a2: number, b1: number, b2: number): number =>
  Math.max(
    0,
    Math.min(Math.max(a1, a2), Math.max(b1, b2)) -
      Math.max(Math.min(a1, a2), Math.min(b1, b2)),
  );

const bounds = (points: readonly Point[]) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
};

/** Drop repeats and collapse collinear runs, so the bend count means something. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  const result: Point[] = [];
  for (let i = 0; i < out.length; i++) {
    const prev = result[result.length - 1];
    const cur = out[i] as Point;
    const next = out[i + 1];
    if (prev && next) {
      const flatX = Math.abs(prev.x - cur.x) < 0.5 && Math.abs(cur.x - next.x) < 0.5;
      const flatY = Math.abs(prev.y - cur.y) < 0.5 && Math.abs(cur.y - next.y) < 0.5;
      if (flatX || flatY) continue;
    }
    result.push(cur);
  }
  return result.length >= 2 ? result : [...out];
}
