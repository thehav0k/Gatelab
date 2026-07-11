import { pinKey, type CircuitDocument, type CircuitNode, type Point, type Wire } from "./netlist";
import { pinsOf, GATE_H, GATE_W, IO_H, IO_W } from "./parts";
import { dipHeight, dipWidth, getIc } from "./ic-library";

/**
 * Orthogonal wire routing.
 *
 * WHY A*, AND NOT LEE'S ALGORITHM / BFS.
 *
 * Lee's algorithm is a BFS wavefront, and BFS finds shortest paths only when
 * every edge costs the same. We want MINIMAL BENDS, and a bend penalty makes the
 * graph WEIGHTED — at which point a FIFO queue no longer yields optimal paths.
 * The classic failure: two routes of identical Manhattan length, one with 1 bend
 * and one with 5, and BFS returns whichever it happened to pop first. The board
 * looks like spaghetti and it is not obvious why.
 *
 * So the search state has to be `(x, y, incoming direction)` — because "is this
 * step a bend?" depends on how you arrived at the cell — and the search has to be
 * A* (or Dijkstra) over that weighted graph. There is a test that pins exactly
 * this: two equal-length paths, and the router must pick the one with one bend.
 *
 * THE CORRECTNESS RULE THAT OUTRANKS EVERYTHING ELSE:
 *
 *     Electrical connectivity must NEVER depend on routing success.
 *
 * A route is COSMETIC. If the router fails, the wire is still a wire, its net is
 * still merged, and the simulation is unaffected — the UI just draws a straight
 * air-wire and says so. That is why routes are derived state and live nowhere
 * near the document (see circuit-store).
 */

/** Canvas units per grid cell. Matches the canvas snap grid. */
export const CELL = 8;

export interface CostModel {
  readonly step: number;
  /** The whole reason this cannot be a plain BFS. */
  readonly bend: number;
  /** Crossing a foreign net: allowed (jumpers cross in 3D), just discouraged. */
  readonly crossNet: number;
  /**
   * A soft keep-out around component bodies. Without it, routes hug the chips so
   * tightly that they run straight over the printed pin numbers — legible on the
   * grid, illegible on screen. Small enough that it never forces a detour when
   * space is genuinely tight.
   */
  readonly nearBody: number;
}

export const DEFAULT_COST: CostModel = {
  step: 10,
  bend: 30,
  crossNet: 60,
  nearBody: 6,
};

/** How far outside the components the router may roam, in cells. */
const MARGIN = 4;
/** Safety valve. At our grid sizes a route is found in a few thousand pops. */
const MAX_EXPANSIONS = 60_000;

export interface OccupancyGrid {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  /** -1 = hard blocked (a component body). 0 = free. >0 = occupied by that net id. */
  readonly cells: Int32Array;
  /** 1 where a cell touches a body — a soft keep-out, not an obstacle. */
  readonly near: Uint8Array;
}

export type Route = readonly Point[];
export interface RouteResult {
  /** Wire id -> its path, or null when no route exists (draw an air-wire). */
  readonly paths: ReadonlyMap<string, Route | null>;
  readonly failed: readonly string[];
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The bounding box a node's body occupies, in canvas units. */
export function footprint(node: CircuitNode): { x: number; y: number; w: number; h: number } {
  switch (node.kind) {
    case "gate":
      return { x: node.pos.x, y: node.pos.y, w: GATE_W, h: GATE_H };
    case "ic": {
      const def = getIc(node.part);
      const pins = def?.pins.length ?? 14;
      return { x: node.pos.x, y: node.pos.y, w: dipWidth(pins), h: dipHeight() };
    }
    case "switch":
    case "led":
    case "rail":
      return { x: node.pos.x, y: node.pos.y, w: IO_W, h: IO_H };
  }
}

export const pinPoint = (node: CircuitNode, pin: string): Point | null => {
  const spec = pinsOf(node).find((p) => p.name === pin);
  return spec ? { x: node.pos.x + spec.offset.x, y: node.pos.y + spec.offset.y } : null;
};

const toCell = (v: number): number => Math.round(v / CELL);

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

export function buildOccupancy(doc: CircuitDocument): OccupancyGrid {
  const nodes = Object.values(doc.nodes);

  let minX = 0;
  let minY = 0;
  let maxX = 1;
  let maxY = 1;

  for (const node of nodes) {
    const f = footprint(node);
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  }

  const x0 = toCell(minX) - MARGIN;
  const y0 = toCell(minY) - MARGIN;
  const w = toCell(maxX) - x0 + MARGIN + 1;
  const h = toCell(maxY) - y0 + MARGIN + 1;

  const cells = new Int32Array(w * h);
  const near = new Uint8Array(w * h);
  const grid: OccupancyGrid = { x0, y0, w, h, cells, near };

  // Component bodies are hard obstacles: two parts cannot occupy one space, and a
  // wire drawn across a chip is exactly the ugliness we are here to remove.
  for (const node of nodes) {
    const f = footprint(node);
    const cx0 = toCell(f.x);
    const cy0 = toCell(f.y);
    const cx1 = toCell(f.x + f.w);
    const cy1 = toCell(f.y + f.h);

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = index(grid, cx, cy);
        if (i >= 0) cells[i] = -1;
      }
    }
  }

  // The soft keep-out: any free cell touching a body. Computed BEFORE the pins are
  // punched back out, so the ring around a chip is continuous.
  for (let cy = y0; cy < y0 + h; cy++) {
    for (let cx = x0; cx < x0 + w; cx++) {
      const i = index(grid, cx, cy);
      if (i < 0 || cells[i] === -1) continue;
      for (let d = 0; d < 4; d++) {
        const j = index(grid, cx + (DX[d] as number), cy + (DY[d] as number));
        if (j >= 0 && cells[j] === -1) {
          near[i] = 1;
          break;
        }
      }
    }
  }

  // …but every pin must remain reachable, or nothing could be wired at all. A pin
  // sits ON its body's edge, so it would otherwise be sealed inside the obstacle.
  for (const node of nodes) {
    for (const spec of pinsOf(node)) {
      const p = { x: node.pos.x + spec.offset.x, y: node.pos.y + spec.offset.y };
      const i = index(grid, toCell(p.x), toCell(p.y));
      if (i >= 0) {
        cells[i] = 0;
        near[i] = 0; // a pin is where a wire is SUPPOSED to go
      }
    }
  }

  return grid;
}

const index = (g: OccupancyGrid, cx: number, cy: number): number => {
  const x = cx - g.x0;
  const y = cy - g.y0;
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return -1;
  return y * g.w + x;
};

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
/** 4 means "no incoming direction yet" — the start cell is free to leave any way. */
const START_DIR = 4;
const DIRS = 5;

/**
 * A lower bound on the bends still required, given where we are pointing and
 * where we still have to go. Admissible and consistent, so A* stays optimal.
 */
function minTurns(dir: number, dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const axes = (dx !== 0 ? 1 : 0) + (dy !== 0 ? 1 : 0);
  if (dir === START_DIR) return axes - 1;

  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const alongX = DX[dir] !== 0;

  if (alongX) {
    if (DX[dir] === sx) return axes - 1; // already heading the right way on x
    if (dx === 0) return 1; // only y remains, and we are pointing across it
    return 2; // pointing away along x — we must turn back
  }
  if (DY[dir] === sy) return axes - 1;
  if (dy === 0) return 1;
  return 2;
}

/** Binary min-heap over packed state ids, keyed by f-score. */
class Heap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= (this.keys[i] as number)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.ids[0] as number;
    const lastId = this.ids.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && (this.keys[l] as number) < (this.keys[m] as number)) m = l;
        if (r < this.ids.length && (this.keys[r] as number) < (this.keys[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b] as number, this.ids[a] as number];
    [this.keys[a], this.keys[b]] = [this.keys[b] as number, this.keys[a] as number];
  }
}

/**
 * Route one wire. `net` is the id whose existing cells are free to reuse — that
 * is the Steiner trick: a second wire on the same net can merge into the first
 * one's path at zero cost instead of running alongside it.
 */
export function routeWire(
  grid: OccupancyGrid,
  from: Point,
  to: Point,
  net: number,
  cost: CostModel = DEFAULT_COST,
): Route | null {
  const sx = toCell(from.x);
  const sy = toCell(from.y);
  const tx = toCell(to.x);
  const ty = toCell(to.y);

  if (index(grid, sx, sy) < 0 || index(grid, tx, ty) < 0) return null;
  if (sx === tx && sy === ty) return [{ x: from.x, y: from.y }];

  const size = grid.w * grid.h;
  const stateCount = size * DIRS;

  const g = new Int32Array(stateCount).fill(-1);
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const heap = new Heap();

  const heuristic = (cx: number, cy: number, dir: number): number =>
    cost.step * (Math.abs(tx - cx) + Math.abs(ty - cy)) +
    cost.bend * minTurns(dir, tx - cx, ty - cy);

  const startState = (index(grid, sx, sy) as number) * DIRS + START_DIR;
  g[startState] = 0;
  heap.push(startState, heuristic(sx, sy, START_DIR));

  let expansions = 0;
  let goal = -1;

  while (heap.size > 0) {
    if (++expansions > MAX_EXPANSIONS) return null;

    const state = heap.pop();
    const cellIdx = Math.floor(state / DIRS);
    const dir = state % DIRS;

    const cx = grid.x0 + (cellIdx % grid.w);
    const cy = grid.y0 + Math.floor(cellIdx / grid.w);

    if (cx === tx && cy === ty) {
      goal = state;
      break;
    }

    const gc = g[state] as number;

    for (let nd = 0; nd < 4; nd++) {
      const nx = cx + (DX[nd] as number);
      const ny = cy + (DY[nd] as number);
      const ni = index(grid, nx, ny);
      if (ni < 0) continue;

      const occupant = grid.cells[ni] as number;
      const isTarget = nx === tx && ny === ty;

      // A body is a hard obstacle — except that the target pin itself sits on one.
      if (occupant === -1 && !isTarget) continue;

      let stepCost = cost.step;
      // Cells already carrying THIS net are free to reuse; foreign nets are a
      // crossing, which is allowed (jumpers cross over in 3D) but discouraged.
      if (occupant > 0 && occupant !== net) stepCost += cost.crossNet;
      // Give the chips a little breathing room, so routes do not run across the
      // printed pin numbers.
      if (grid.near[ni] === 1) stepCost += cost.nearBody;

      // THE BEND. This is why the state carries a direction and why BFS is wrong.
      if (dir !== START_DIR && nd !== dir) stepCost += cost.bend;

      const nextState = ni * DIRS + nd;
      const tentative = gc + stepCost;
      const known = g[nextState] as number;

      if (known === -1 || tentative < known) {
        g[nextState] = tentative;
        cameFrom[nextState] = state;
        heap.push(nextState, tentative + heuristic(nx, ny, nd));
      }
    }
  }

  if (goal < 0) return null;

  // Walk back, then simplify collinear runs into corner points.
  const cells: Point[] = [];
  for (let s = goal; s !== -1; s = cameFrom[s] as number) {
    const ci = Math.floor(s / DIRS);
    cells.push({
      x: (grid.x0 + (ci % grid.w)) * CELL,
      y: (grid.y0 + Math.floor(ci / grid.w)) * CELL,
    });
  }
  cells.reverse();

  // Snap the endpoints back to the exact pin positions — the pins are what the
  // wire must visibly touch, and they may sit off the grid.
  cells[0] = { x: from.x, y: from.y };
  cells[cells.length - 1] = { x: to.x, y: to.y };

  return simplify(cells);
}

/** Collapse runs of collinear points down to their corners. */
export function simplify(path: readonly Point[]): Point[] {
  if (path.length <= 2) return [...path];
  const out: Point[] = [path[0] as Point];

  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1] as Point;
    const b = path[i] as Point;
    const c = path[i + 1] as Point;
    const collinear =
      (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }

  out.push(path[path.length - 1] as Point);
  return out;
}

export const bendCount = (path: readonly Point[]): number =>
  Math.max(0, path.length - 2);

// ---------------------------------------------------------------------------
// Routing a whole board
// ---------------------------------------------------------------------------

/**
 * Route every wire.
 *
 * Wires are routed shortest-first: a short hop between adjacent pins has few
 * alternatives, while a long haul across the board has many, so letting the
 * constrained wires claim their space first leaves the flexible ones to work
 * around them. Wires of the same net are routed consecutively so the later ones
 * can merge into the earlier ones' paths for free.
 */
export function routeAll(
  doc: CircuitDocument,
  netOfWire: (wire: Wire) => number,
  cost: CostModel = DEFAULT_COST,
): RouteResult {
  const grid = buildOccupancy(doc);
  const paths = new Map<string, Route | null>();
  const failed: string[] = [];

  const jobs = Object.values(doc.wires)
    .map((wire) => {
      const na = doc.nodes[wire.a.node];
      const nb = doc.nodes[wire.b.node];
      const from = na ? pinPoint(na, wire.a.pin) : null;
      const to = nb ? pinPoint(nb, wire.b.pin) : null;
      return { wire, from, to, net: netOfWire(wire) };
    })
    .filter((j): j is typeof j & { from: Point; to: Point } => !!j.from && !!j.to);

  jobs.sort((a, b) => {
    const la = Math.abs(a.from.x - a.to.x) + Math.abs(a.from.y - a.to.y);
    const lb = Math.abs(b.from.x - b.to.x) + Math.abs(b.from.y - b.to.y);
    return la - lb || a.net - b.net;
  });

  for (const job of jobs) {
    const path = routeWire(grid, job.from, job.to, job.net, cost);
    paths.set(job.wire.id, path);

    if (!path) {
      // A wire that cannot be routed is STILL A WIRE. Its net stays merged and the
      // simulation is untouched; the UI just draws it straight and flags it.
      failed.push(job.wire.id);
      continue;
    }

    // Claim the cells so later wires route around — or, on the same net, through.
    paint(grid, path, job.net);
  }

  return { paths, failed };
}

/** Mark every cell a routed path passes through as belonging to its net. */
function paint(grid: OccupancyGrid, path: Route, net: number): void {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as Point;
    const b = path[i + 1] as Point;
    const ax = toCell(a.x);
    const ay = toCell(a.y);
    const bx = toCell(b.x);
    const by = toCell(b.y);

    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    let cx = ax;
    let cy = ay;

    for (;;) {
      const i2 = index(grid, cx, cy);
      // Never overwrite a body: a pin cell we freed still sits on one, and
      // stamping a net id there would make the body permeable to later routes.
      if (i2 >= 0 && (grid.cells[i2] as number) === 0) grid.cells[i2] = net;
      if (cx === bx && cy === by) break;
      cx += dx;
      cy += dy;
    }
  }
}

export { pinKey };
