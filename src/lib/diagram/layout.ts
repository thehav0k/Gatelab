import {
  measure,
  placePorts,
  STUB,
  type Box,
  type PlacedPort,
} from "./measure";
import type { DiagramTheme } from "./theme";
import type { Block, Diagram, Link, Rotation } from "./types";

/**
 * Turning a `Diagram` (boxes and links, no coordinates) into something drawable.
 *
 * THE ALGORITHM, AND WHY THIS ONE
 * -------------------------------
 * Layered (Sugiyama) drawing, in the classic four passes: layer assignment by
 * longest path, crossing reduction by barycentre, coordinate assignment by
 * priority, and orthogonal edge routing through channels.
 *
 * A force-directed layout — the thing every graph library reaches for — is
 * exactly wrong here. It produces a nice organic blob, and a block diagram is not
 * organic: signals flow LEFT TO RIGHT, every reader of every textbook in this
 * subject expects inputs on the left and outputs on the right, and a decoder
 * placed above its own inputs is not "a different aesthetic", it is wrong.
 *
 * DUMMY NODES ARE NOT OPTIONAL. A link that spans three columns has to get past
 * whatever is in the two columns between, and the only way to make that a
 * decision rather than an accident is to give the link a place in each column it
 * crosses. Without them, the wire runs at its source's y and saws straight
 * through the middle of an unrelated block — which looks, to a reader, exactly
 * like a connection. That single failure mode is why this is a real layered
 * layout and not a bag of heuristics.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PlacedBlock {
  readonly block: Block;
  readonly x: number;
  readonly y: number;
  /** The size AFTER rotation — what the router and the hit test must see. */
  readonly w: number;
  readonly h: number;
  readonly ports: ReadonlyMap<string, PlacedPort>;
  /**
   * Clockwise turn, for the renderers. Absent means upright, which is every
   * block the automatic layout produces — only the editor turns things.
   */
  readonly rotation?: Rotation;
}

export interface RoutedLink {
  readonly link: Link;
  readonly points: readonly Point[];
  /** Stable key for per-signal colouring — every fanout of one port shares it. */
  readonly colorKey: string;
  readonly width: number;
  /** True when the link had to be routed backwards, around the outside. */
  readonly feedback: boolean;
}

export interface PlacedDiagram {
  readonly diagram: Diagram;
  readonly blocks: readonly PlacedBlock[];
  readonly links: readonly RoutedLink[];
  /** Ports with more than one wire leaving them — a T junction gets a dot. */
  readonly junctions: readonly Point[];
  readonly width: number;
  readonly height: number;
}

// --- knobs ------------------------------------------------------------------

/** Space between columns. Wide enough for several vertical lanes plus both stubs. */
const COL_GAP = 118;
const ROW_GAP = 34;
/** A dummy node is a wire passing through, so it needs far less room than a box. */
const DUMMY_GAP = 15;
const DUMMY_H = 0;
/** How far a back-edge or a vertical-port approach stands off from the block. */
const ESCAPE = 18;
/**
 * How far below (or above) a top/bottom port the approach lane runs. Must be
 * comfortably less than ROW_GAP, or the lane lands inside the next block down.
 */
const APPROACH = 10;
const LANE_STEP = 14;
const BARYCENTRE_PASSES = 4;

// --- internal node model ----------------------------------------------------

interface LNode {
  readonly id: string;
  readonly kind: "block" | "dummy";
  readonly block: Block | null;
  /** Which link this dummy belongs to. */
  readonly linkId: string | null;
  w: number;
  h: number;
  col: number;
  order: number;
  y: number;
  x: number;
  readonly declared: number;
}

export function layout(diagram: Diagram, theme: DiagramTheme): PlacedDiagram {
  // --- 1. measure -----------------------------------------------------------
  const sizes = new Map<string, Box>();
  for (const b of diagram.blocks) sizes.set(b.id, measure(b, theme));

  const nodes = new Map<string, LNode>();
  diagram.blocks.forEach((b, i) => {
    const s = sizes.get(b.id) as Box;
    nodes.set(b.id, {
      id: b.id,
      kind: "block",
      block: b,
      linkId: null,
      w: s.w,
      h: s.h,
      col: 0,
      order: i,
      y: 0,
      x: 0,
      declared: i,
    });
  });

  // Links naming a missing block cannot be drawn; drop them rather than crash a
  // whole page over one typo, and let `validate()` be the thing that shouts.
  const links = diagram.links.filter(
    (l) => nodes.has(l.from.block) && nodes.has(l.to.block),
  );

  // --- 2. layer assignment --------------------------------------------------
  const back = new Set<string>();
  assignColumns(diagram, nodes, links, back);

  // --- 3. dummy chains for links spanning more than one column --------------
  const chains = new Map<string, LNode[]>();
  let dummySeq = 0;
  for (const l of links) {
    if (back.has(l.id)) continue;
    const a = nodes.get(l.from.block) as LNode;
    const b = nodes.get(l.to.block) as LNode;
    const chain: LNode[] = [];
    for (let c = a.col + 1; c < b.col; c++) {
      const d: LNode = {
        id: `~d${dummySeq++}`,
        kind: "dummy",
        block: null,
        linkId: l.id,
        w: 0,
        h: DUMMY_H,
        col: c,
        order: 0,
        y: 0,
        x: 0,
        declared: 1e6 + dummySeq,
      };
      nodes.set(d.id, d);
      chain.push(d);
    }
    if (chain.length > 0) chains.set(l.id, chain);
  }

  // --- 4. ordering and coordinates -----------------------------------------
  const columns = groupByColumn(nodes);
  const adjacency = buildAdjacency(links, back, chains, nodes);
  orderColumns(columns, adjacency);
  assignY(columns, adjacency);

  // --- 5. place, route, MEASURE THE CHANNELS, then do it again -------------
  //
  // How wide the gap between two columns needs to be is not known until the
  // wires have been routed, because it depends on how many of them have to run
  // vertically through it — and a 16-output decoder can need a dozen lanes where
  // a half adder needs one. A fixed gap is therefore wrong in both directions:
  // too narrow and the lanes spill out sideways across the blocks, too wide and
  // every simple diagram is padded with empty space.
  //
  // So route twice. The first pass is a PROBE whose paths are thrown away; all
  // that is kept is the lane count per channel. Lane assignment depends only on
  // the y coordinates (which this pass does not change), so the second pass
  // allocates exactly the same lanes into a gap now sized to hold them.
  const place = (
    xs: readonly number[],
  ): { placed: PlacedBlock[]; portIndex: Map<string, PlacedPort> } => {
    applyX(columns, xs);
    const placed: PlacedBlock[] = [];
    const portIndex = new Map<string, PlacedPort>();
    for (const b of diagram.blocks) {
      const n = nodes.get(b.id) as LNode;
      const size = sizes.get(b.id) as Box;
      const local = placePorts(b, size);
      const ports = new Map<string, PlacedPort>();
      for (const [id, p] of local) {
        const abs: PlacedPort = {
          port: p.port,
          x: n.x + p.x,
          y: n.y + p.y,
          ax: n.x + p.ax,
          ay: n.y + p.ay,
          out: p.out,
        };
        ports.set(id, abs);
        portIndex.set(`${b.id}.${id}`, abs);
      }
      placed.push({ block: b, x: n.x, y: n.y, w: size.w, h: size.h, ports });
    }
    return { placed, portIndex };
  };

  const routeAll = (
    router: Router,
    portIndex: ReadonlyMap<string, PlacedPort>,
  ): RoutedLink[] => {
    const out: RoutedLink[] = [];
    for (const l of links) {
      const from = portIndex.get(`${l.from.block}.${l.from.port}`);
      const to = portIndex.get(`${l.to.block}.${l.to.port}`);
      if (!from || !to) continue;
      const a = nodes.get(l.from.block) as LNode;
      const b = nodes.get(l.to.block) as LNode;
      const isBack = back.has(l.id) || b.col <= a.col;
      const points = isBack
        ? router.routeBack(from, to)
        : router.routeForward(from, to, a.col, b.col, chains.get(l.id) ?? []);
      out.push({
        link: l,
        points,
        colorKey: `${l.from.block}.${l.from.port}`,
        width: l.width ?? 1,
        feedback: isBack,
      });
    }
    return out;
  };

  const probeX = columnOrigins(columns, []);
  const probe = place(probeX);
  const prober = new Router(probeX, columns, contentBounds(probe.placed), []);
  routeAll(prober, probe.portIndex);

  const colX = columnOrigins(columns, prober.laneCounts());
  const { placed, portIndex } = place(colX);
  const bounds = contentBounds(placed);
  const router = new Router(colX, columns, bounds, prober.laneCounts());
  const routed = routeAll(router, portIndex);

  // --- 7. junction dots -----------------------------------------------------
  const fanout = new Map<string, number>();
  for (const l of links) {
    const key = `${l.from.block}.${l.from.port}`;
    fanout.set(key, (fanout.get(key) ?? 0) + 1);
  }
  const junctions: Point[] = [];
  for (const [key, n] of fanout) {
    if (n < 2) continue;
    const p = portIndex.get(key);
    if (p) junctions.push({ x: p.ax, y: p.ay });
  }

  // --- 8. canvas size -------------------------------------------------------
  const all = [...routed.flatMap((r) => r.points), ...junctions];
  let x0 = bounds.x0;
  let y0 = bounds.y0;
  let x1 = bounds.x1;
  let y1 = bounds.y1;
  for (const p of all) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }

  // Shift everything so the drawing starts at the origin. Doing it here rather
  // than in the SVG writer keeps the exported viewBox at `0 0 w h`, which is what
  // every downstream tool (Inkscape, Figma, a browser <img>) handles best.
  const dx = -x0;
  const dy = -y0;
  const shiftP = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });

  return {
    diagram,
    blocks: placed.map((b) => ({
      ...b,
      x: b.x + dx,
      y: b.y + dy,
      ports: new Map(
        [...b.ports].map(([id, p]) => [
          id,
          { ...p, x: p.x + dx, y: p.y + dy, ax: p.ax + dx, ay: p.ay + dy },
        ]),
      ),
    })),
    links: routed.map((r) => ({ ...r, points: r.points.map(shiftP) })),
    junctions: junctions.map(shiftP),
    width: Math.ceil(x1 - x0),
    height: Math.ceil(y1 - y0),
  };
}

// --- layering ---------------------------------------------------------------

/**
 * Longest-path layering, with three overrides that matter more than the
 * algorithm does:
 *
 *   - An explicit `column` wins outright. Some blocks belong where the author
 *     put them (a `Cin` that only feeds the last stage is still an input).
 *   - A source IO tag is pinned to column 0 and a sink IO tag to the last column,
 *     so the input and output rails line up rather than staggering with depth.
 *   - Cycles are broken by marking the offending links as back-edges. A
 *     sequential circuit is nothing BUT cycles, so this is the normal case here,
 *     not an error path.
 */
function assignColumns(
  diagram: Diagram,
  nodes: Map<string, LNode>,
  links: readonly Link[],
  back: Set<string>,
): void {
  const outgoing = new Map<string, Link[]>();
  for (const l of links) {
    const bucket = outgoing.get(l.from.block);
    if (bucket) bucket.push(l);
    else outgoing.set(l.from.block, [l]);
  }

  // Depth-first, marking any edge that returns to a node still on the stack.
  const state = new Map<string, 0 | 1 | 2>();
  const walk = (id: string): void => {
    state.set(id, 1);
    for (const l of outgoing.get(id) ?? []) {
      const s = state.get(l.to.block) ?? 0;
      if (s === 1) back.add(l.id);
      else if (s === 0) walk(l.to.block);
    }
    state.set(id, 2);
  };
  for (const id of nodes.keys()) if ((state.get(id) ?? 0) === 0) walk(id);

  const forward = links.filter((l) => !back.has(l.id));
  const incoming = new Map<string, Link[]>();
  for (const l of forward) {
    const bucket = incoming.get(l.to.block);
    if (bucket) bucket.push(l);
    else incoming.set(l.to.block, [l]);
  }

  const depth = new Map<string, number>();
  const resolve = (id: string, guard: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (guard.has(id)) return 0;
    guard.add(id);
    const node = nodes.get(id) as LNode;
    const explicit = node.block?.column;
    const d =
      explicit !== undefined
        ? explicit
        : Math.max(0, ...(incoming.get(id) ?? []).map((l) => resolve(l.from.block, guard) + 1));
    depth.set(id, d);
    return d;
  };
  for (const id of nodes.keys()) resolve(id, new Set());

  let max = 0;
  for (const id of nodes.keys()) {
    const d = depth.get(id) ?? 0;
    (nodes.get(id) as LNode).col = d;
    max = Math.max(max, d);
  }

  // Pin the IO rails. A sink tag with an explicit column keeps it.
  for (const b of diagram.blocks) {
    if (b.kind !== "io" || b.column !== undefined) continue;
    const n = nodes.get(b.id) as LNode;
    const sink = b.ports.every((p) => p.dir === "in");
    const source = b.ports.every((p) => p.dir === "out");
    if (sink && b.ports.length > 0) n.col = max;
    else if (source && b.ports.length > 0) n.col = 0;
  }
}

// --- ordering ---------------------------------------------------------------

interface Adjacency {
  readonly up: ReadonlyMap<string, string[]>;
  readonly down: ReadonlyMap<string, string[]>;
}

/**
 * Neighbour lists over the DUMMY-EXPANDED graph: a three-column link becomes
 * source → dummy → dummy → target, so the crossing-reduction pass can see and
 * move the places the wire passes through.
 */
function buildAdjacency(
  links: readonly Link[],
  back: Set<string>,
  chains: ReadonlyMap<string, LNode[]>,
  nodes: ReadonlyMap<string, LNode>,
): Adjacency {
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  const edge = (a: string, b: string): void => {
    (down.get(a) ?? down.set(a, []).get(a)!).push(b);
    (up.get(b) ?? up.set(b, []).get(b)!).push(a);
  };

  for (const l of links) {
    if (back.has(l.id)) continue;
    const a = nodes.get(l.from.block);
    const b = nodes.get(l.to.block);
    if (!a || !b || b.col <= a.col) continue;
    const chain = chains.get(l.id) ?? [];
    let prev = l.from.block;
    for (const d of chain) {
      edge(prev, d.id);
      prev = d.id;
    }
    edge(prev, l.to.block);
  }
  return { up, down };
}

const groupByColumn = (nodes: ReadonlyMap<string, LNode>): LNode[][] => {
  const cols: LNode[][] = [];
  for (const n of nodes.values()) {
    (cols[n.col] ?? (cols[n.col] = [])).push(n);
  }
  for (let i = 0; i < cols.length; i++) if (!cols[i]) cols[i] = [];
  for (const col of cols) col.sort((a, b) => a.declared - b.declared);
  return cols;
};

/**
 * Barycentre crossing reduction, sweeping down then up.
 *
 * TWO THINGS OVERRIDE THE HEURISTIC, and both are about the drawing being an
 * ANSWER rather than merely a tidy graph.
 *
 * An explicit `row` wins outright: "the four decoders go in numerical order" is
 * a fact about the answer, not a preference a heuristic may overturn.
 *
 * And COLUMN 0 IS NEVER REORDERED. It is the input rail, and the builder listed
 * those inputs in the order the reader expects — S3, S2, S1, S0, MSB first, the
 * same order the labels count in. Barycentre would happily shuffle them to save
 * two crossings, and a reader looking for S3 at the top would find S1 there. A
 * couple of extra crossings cost far less than that.
 */
function orderColumns(columns: LNode[][], adj: Adjacency): void {
  const indexIn = (col: LNode[], id: string): number =>
    col.findIndex((n) => n.id === id);

  const sweep = (from: LNode[], to: LNode[], side: ReadonlyMap<string, string[]>) => {
    const scored = to.map((n, i) => {
      const neighbours = (side.get(n.id) ?? [])
        .map((id) => indexIn(from, id))
        .filter((k) => k >= 0);
      const bary =
        neighbours.length > 0
          ? neighbours.reduce((a, b) => a + b, 0) / neighbours.length
          : i;
      return { n, bary, i };
    });
    scored.sort((a, b) => {
      const ra = a.n.block?.row;
      const rb = b.n.block?.row;
      if (ra !== undefined || rb !== undefined) {
        const ka = ra ?? a.bary;
        const kb = rb ?? b.bary;
        if (ka !== kb) return ka - kb;
      } else if (a.bary !== b.bary) return a.bary - b.bary;
      return a.i - b.i;
    });
    to.splice(0, to.length, ...scored.map((s) => s.n));
  };

  for (let pass = 0; pass < BARYCENTRE_PASSES; pass++) {
    for (let c = 1; c < columns.length; c++) {
      sweep(columns[c - 1] as LNode[], columns[c] as LNode[], adj.up);
    }
    for (let c = columns.length - 2; c >= 1; c--) {
      sweep(columns[c + 1] as LNode[], columns[c] as LNode[], adj.down);
    }
  }
  for (const col of columns) col.forEach((n, i) => (n.order = i));
}

// --- coordinates ------------------------------------------------------------

const gapAfter = (n: LNode): number => (n.kind === "dummy" ? DUMMY_GAP : ROW_GAP);

/**
 * Priority-style vertical placement: stack each column, then pull each node
 * toward the mean of its neighbours and re-stack. Four passes is enough to
 * straighten a ripple chain without letting a wide fan-out drag a column apart.
 */
function assignY(columns: LNode[][], adj: Adjacency): void {
  const stack = (col: LNode[], desired: readonly number[]): void => {
    let cursor = -Infinity;
    col.forEach((n, i) => {
      const want = desired[i] ?? 0;
      const y = Math.max(want, cursor);
      n.y = y;
      cursor = y + n.h + Math.max(gapAfter(n), gapAfter(col[i + 1] ?? n));
    });
    // Re-centre so the column does not drift down every pass.
    const shift =
      col.reduce((a, n, i) => a + (n.y - (desired[i] ?? n.y)), 0) / Math.max(1, col.length);
    for (const n of col) n.y -= shift;
  };

  for (const col of columns) {
    stack(col, col.map((_, i) => i * (ROW_GAP + 56)));
  }

  const centreOf = (n: LNode): number => n.y + n.h / 2;
  const nodeById = new Map<string, LNode>();
  for (const col of columns) for (const n of col) nodeById.set(n.id, n);

  for (let pass = 0; pass < 4; pass++) {
    const order = pass % 2 === 0 ? columns : [...columns].reverse();
    const side = pass % 2 === 0 ? adj.up : adj.down;
    for (const col of order) {
      const desired = col.map((n) => {
        const neighbours = (side.get(n.id) ?? [])
          .map((id) => nodeById.get(id))
          .filter((x): x is LNode => x !== undefined);
        if (neighbours.length === 0) return n.y;
        const mean =
          neighbours.reduce((a, m) => a + centreOf(m), 0) / neighbours.length;
        return mean - n.h / 2;
      });
      stack(col, desired);
    }
  }
}

/**
 * Column x origins. Every column is as wide as its widest member, and the gap
 * AFTER it is wide enough for the wires that must run vertically through it.
 */
function columnOrigins(
  columns: readonly LNode[][],
  laneCounts: readonly number[],
): number[] {
  const xs: number[] = [];
  let x = 0;
  for (let c = 0; c < columns.length; c++) {
    xs.push(x);
    const col = columns[c] as LNode[];
    const widest = Math.max(0, ...col.map((n) => n.w));
    // The channel that follows this column is the one that feeds column c+1.
    const lanes = laneCounts[c + 1] ?? 0;
    const needed = STUB * 2 + 24 + Math.max(0, lanes - 1) * LANE_STEP;
    x += widest + Math.max(COL_GAP, needed);
  }
  return xs;
}

const applyX = (columns: readonly LNode[][], xs: readonly number[]): void => {
  columns.forEach((col, c) => {
    for (const n of col) n.x = xs[c] ?? 0;
  });
};

function contentBounds(blocks: readonly PlacedBlock[]): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  if (blocks.length === 0) return { x0: 0, y0: 0, x1: 100, y1: 100 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of blocks) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x0, y0, x1, y1 };
}

// --- routing ----------------------------------------------------------------

/**
 * Interval-graph lane allocation.
 *
 * Two wires may share one lane iff their spans do not overlap — which is the
 * classic interval-colouring problem, and greedy-by-start is optimal for it. The
 * naive alternative (one lane per wire) makes a 16-output decoder's channel
 * wider than the diagram.
 */
class Lanes {
  private readonly ends: number[] = [];

  take(start: number, end: number, margin = 8): number {
    const lo = Math.min(start, end) - margin;
    const hi = Math.max(start, end) + margin;
    for (let i = 0; i < this.ends.length; i++) {
      if ((this.ends[i] as number) <= lo) {
        this.ends[i] = hi;
        return i;
      }
    }
    this.ends.push(hi);
    return this.ends.length - 1;
  }

  get count(): number {
    return this.ends.length;
  }
}

class Router {
  private readonly channels = new Map<number, Lanes>();
  private readonly belowLanes = new Lanes();

  constructor(
    private readonly colX: readonly number[],
    private readonly columns: readonly LNode[][],
    private readonly bounds: { x0: number; y0: number; x1: number; y1: number },
    /** Lane count per channel from the probe pass; empty on the probe itself. */
    private readonly budget: readonly number[],
  ) {}

  /** How many lanes each channel ended up using. Drives the gap widths. */
  laneCounts(): number[] {
    const out: number[] = [];
    for (const [c, lanes] of this.channels) out[c] = lanes.count;
    return out;
  }

  /**
   * Middle of the gap to the LEFT of column `c`, plus a lane offset.
   *
   * Centred on the FINAL lane count rather than the count so far — otherwise the
   * first wire routed through a channel is centred as if it were the only one,
   * and the picture depends on the order the links happened to be visited.
   */
  private channelX(c: number, y1: number, y2: number): number {
    const left = c > 0 ? (this.colX[c - 1] ?? 0) + this.columnWidth(c - 1) : this.bounds.x0;
    const right = this.colX[c] ?? left + COL_GAP;
    const usable = Math.max(24, right - left - STUB * 2);
    const lanes = this.channels.get(c) ?? this.channels.set(c, new Lanes()).get(c)!;
    const lane = lanes.take(y1, y2);
    const total = Math.max(this.budget[c] ?? 0, lanes.count);
    const step = Math.min(LANE_STEP, usable / Math.max(1, total));
    const x = left + STUB + usable / 2 + (lane - (total - 1) / 2) * step;
    // A hard clamp, because a wire outside its channel crosses a block body and
    // reads as a connection that is not there.
    return Math.min(Math.max(x, left + STUB), right - STUB);
  }

  private columnWidth(c: number): number {
    return Math.max(0, ...(this.columns[c] ?? []).map((n) => n.w));
  }

  /**
   * The normal case: out of a right-hand port, across any columns in between at
   * the heights the dummy nodes were placed at, into a left-hand port.
   */
  routeForward(
    from: PlacedPort,
    to: PlacedPort,
    fromCol: number,
    toCol: number,
    chain: readonly LNode[],
  ): Point[] {
    if (from.out.y !== 0) return this.routeFromVertical(from, to);

    const pts: Point[] = [{ x: from.x, y: from.y }, { x: from.ax, y: from.ay }];
    let y = from.ay;
    let col = fromCol + 1;

    for (const d of chain) {
      const targetY = d.y;
      if (Math.abs(targetY - y) > 0.5) {
        const cx = this.channelX(col, y, targetY);
        pts.push({ x: cx, y });
        pts.push({ x: cx, y: targetY });
        y = targetY;
      }
      col = d.col + 1;
    }

    /**
     * A port on the TOP or BOTTOM edge — a clock, an enable, a clear — has to be
     * approached vertically. The naive way is to send the wire round the outside
     * of the whole drawing and come up from underneath, which is what a schematic
     * tool does when it has no better idea; here it means a clock line ploughing
     * straight up through every flip-flop stacked below its target.
     *
     * Instead the wire drops into the channel beside the target's own column and
     * then runs across at a height inside the ROW GAP under the target block —
     * so the only thing the last leg passes beneath is the block it is going to.
     */
    const vertical = to.out.y !== 0;
    const approachY = vertical ? to.ay + to.out.y * APPROACH : to.ay;

    if (Math.abs(approachY - y) > 0.5) {
      const cx = this.channelX(toCol, y, approachY);
      pts.push({ x: cx, y });
      pts.push({ x: cx, y: approachY });
      y = approachY;
    }
    if (vertical) pts.push({ x: to.ax, y });
    pts.push({ x: to.ax, y: to.ay });
    pts.push({ x: to.x, y: to.y });
    return dedupe(pts);
  }

  /** Out of a port on the top or bottom edge into an ordinary side port. */
  private routeFromVertical(from: PlacedPort, to: PlacedPort): Point[] {
    const escY = from.ay + from.out.y * ESCAPE;
    return dedupe([
      { x: from.x, y: from.y },
      { x: from.ax, y: from.ay },
      { x: from.ax, y: escY },
      { x: to.ax, y: escY },
      { x: to.ax, y: to.ay },
      { x: to.x, y: to.y },
    ]);
  }

  /**
   * A back edge — the Q that feeds its own J, the carry that wraps round. Drawn
   * the way it is drawn on paper: out, down below everything, back, and up.
   * Never through the middle, where it would read as a forward signal.
   */
  routeBack(from: PlacedPort, to: PlacedPort): Point[] {
    const lane = this.belowLanes.take(
      Math.min(from.ax, to.ax) - ESCAPE,
      Math.max(from.ax, to.ax) + ESCAPE,
    );
    const y = this.bounds.y1 + ESCAPE + lane * LANE_STEP;
    const outX = from.ax + (from.out.x === 0 ? ESCAPE : from.out.x * ESCAPE);
    const inX = to.ax + (to.out.x === 0 ? -ESCAPE : to.out.x * ESCAPE);
    return dedupe([
      { x: from.x, y: from.y },
      { x: from.ax, y: from.ay },
      { x: outX, y: from.ay },
      { x: outX, y },
      { x: inX, y },
      { x: inX, y: to.ay },
      { x: to.ax, y: to.ay },
      { x: to.x, y: to.y },
    ]);
  }
}

/** Drop repeated points and collapse three collinear ones into two. */
function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  const simplified: Point[] = [];
  for (let i = 0; i < out.length; i++) {
    const prev = simplified[simplified.length - 1];
    const cur = out[i] as Point;
    const next = out[i + 1];
    if (prev && next) {
      const collinearX = Math.abs(prev.x - cur.x) < 0.5 && Math.abs(cur.x - next.x) < 0.5;
      const collinearY = Math.abs(prev.y - cur.y) < 0.5 && Math.abs(cur.y - next.y) < 0.5;
      if (collinearX || collinearY) continue;
    }
    simplified.push(cur);
  }
  return simplified;
}
