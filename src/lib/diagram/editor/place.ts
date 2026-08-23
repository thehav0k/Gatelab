import type { PlacedBlock, PlacedDiagram, Point, RoutedLink } from "../layout";
import { measure, placeRotatedPorts, rotatedSize, type PlacedPort } from "../measure";
import type { DiagramTheme } from "../theme";
import type { Link, Rotation } from "../types";
import { blockOf, rotationOf, toDiagram, type EditorDocument } from "./document";
import { routeLink, type Obstacle, type Occupied, type Terminal } from "./route";

/**
 * The editor's answer to `layout()`: positions come from the DOCUMENT, not from
 * an algorithm.
 *
 * Both produce the same `PlacedDiagram`, which is the whole point — one renderer
 * draws both, one exporter exports both, and the auto-arrange button is nothing
 * more than running the other one and writing its coordinates back into the
 * document.
 *
 * `tight` is the difference between the CANVAS and a FIGURE. On the canvas the
 * origin must stay put or every block jumps sideways the moment one of them is
 * dragged near an edge; in an export the drawing should be cropped to its
 * contents. Same placement, different framing.
 */
export interface PlaceOptions {
  /** Crop to the content and move it to the origin. For export, not for editing. */
  readonly tight?: boolean;
  /** Space around the content. */
  readonly margin?: number;
}

/**
 * Where every pin of every instance is, without routing anything.
 *
 * Split out of `placeDocument` because the alignment assist needs it on every
 * frame of a drag and routing is the expensive half. Same numbers, same code
 * path — an assist that computed pin positions its own way would snap blocks
 * into alignments the router then drew crooked.
 */
export function portPositions(
  doc: EditorDocument,
  theme: DiagramTheme,
): Map<string, PlacedPort> {
  const index = new Map<string, PlacedPort>();
  for (const geometry of geometries(doc, theme)) {
    for (const [id, p] of geometry.ports) index.set(`${geometry.id}.${id}`, p);
  }
  return index;
}

interface Geometry {
  readonly id: string;
  readonly placed: PlacedBlock;
  readonly ports: ReadonlyMap<string, PlacedPort>;
}

function geometries(doc: EditorDocument, theme: DiagramTheme): Geometry[] {
  const out: Geometry[] = [];
  for (const instance of Object.values(doc.instances)) {
    const block = blockOf(doc, instance);
    if (!block) continue;
    const own = measure(block, theme);
    const rotation: Rotation = rotationOf(instance);
    const size = rotatedSize(own, rotation);
    const local = placeRotatedPorts(block, own, rotation);
    const ports = new Map<string, PlacedPort>();
    for (const [id, p] of local) {
      ports.set(id, {
        port: p.port,
        x: instance.x + p.x,
        y: instance.y + p.y,
        ax: instance.x + p.ax,
        ay: instance.y + p.ay,
        out: p.out,
      });
    }
    out.push({
      id: instance.id,
      ports,
      placed: {
        block,
        x: instance.x,
        y: instance.y,
        w: size.w,
        h: size.h,
        ports,
        ...(rotation === 0 ? {} : { rotation }),
      },
    });
  }
  return out;
}

export function placeDocument(
  doc: EditorDocument,
  theme: DiagramTheme,
  opts: PlaceOptions = {},
): PlacedDiagram {
  const margin = opts.margin ?? 40;

  const blocks: PlacedBlock[] = [];
  const portIndex = new Map<string, PlacedPort>();
  const obstacles: Obstacle[] = [];

  for (const geometry of geometries(doc, theme)) {
    const b = geometry.placed;
    for (const [id, p] of geometry.ports) portIndex.set(`${geometry.id}.${id}`, p);
    blocks.push(b);
    // A junction is a POINT, not a body. Treating it as an obstacle would mean
    // the router had to avoid the very place the wire is trying to reach.
    if (b.block.kind !== "node") {
      obstacles.push({ id: geometry.id, x: b.x, y: b.y, w: b.w, h: b.h });
    }
  }

  const routed: RoutedLink[] = [];
  const diagram = toDiagram(doc);
  const linkById = new Map(diagram.links.map((l) => [l.id, l]));

  // Wires already drawn, so the next one can be charged for sitting on top of
  // them. Order-dependent by nature — the first wire gets the best lane — but
  // the order is the document's own key order, which is stable.
  const occupied: Occupied[] = [];

  for (const link of diagram.links) {
    const from = portIndex.get(`${link.from.block}.${link.from.port}`);
    const to = portIndex.get(`${link.to.block}.${link.to.port}`);
    if (!from || !to) continue;
    const a: Terminal = { x: from.ax, y: from.ay, out: from.out, block: link.from.block };
    const b: Terminal = { x: to.ax, y: to.ay, out: to.out, block: link.to.block };
    const key = `${link.from.block}.${link.from.port}`;
    const middle = routeLink(a, b, obstacles, { occupied, key });
    routed.push({
      link: linkById.get(link.id) as Link,
      // The stubs are part of the block, so the path runs pin -> anchor -> ... ->
      // anchor -> pin. Without the pin points the wire stops short of the symbol.
      points: [{ x: from.x, y: from.y }, ...middle, { x: to.x, y: to.y }],
      colorKey: key,
      width: link.width ?? 1,
      feedback: false,
    });
    for (let i = 1; i < middle.length; i++) {
      occupied.push({ a: middle[i - 1] as Point, b: middle[i] as Point, key });
    }
  }

  const fanout = new Map<string, number>();
  for (const link of diagram.links) {
    const key = `${link.from.block}.${link.from.port}`;
    fanout.set(key, (fanout.get(key) ?? 0) + 1);
  }
  const junctions: Point[] = [];
  for (const [key, n] of fanout) {
    if (n < 2) continue;
    const p = portIndex.get(key);
    if (p) junctions.push({ x: p.ax, y: p.ay });
  }

  // --- framing --------------------------------------------------------------
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  const all: Point[] = [
    ...blocks.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ]),
    ...routed.flatMap((r) => r.points),
    ...junctions,
  ];
  if (all.length > 0) {
    x0 = Math.min(...all.map((p) => p.x));
    y0 = Math.min(...all.map((p) => p.y));
    x1 = Math.max(...all.map((p) => p.x));
    y1 = Math.max(...all.map((p) => p.y));
  }

  if (!opts.tight) {
    // Canvas framing: the origin is fixed at 0,0 so nothing moves under the
    // pointer, and the sheet is always at least as big as the content.
    return {
      diagram,
      blocks,
      links: routed,
      junctions,
      width: Math.max(x1 + margin, 640),
      height: Math.max(y1 + margin, 400),
    };
  }

  const dx = margin - x0;
  const dy = margin - y0;
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return {
    diagram,
    blocks: blocks.map((b) => ({
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
    links: routed.map((r) => ({ ...r, points: r.points.map(shift) })),
    junctions: junctions.map(shift),
    width: Math.ceil(x1 - x0 + margin * 2),
    height: Math.ceil(y1 - y0 + margin * 2),
  };
}

/** Which block and port, if any, is under this point? For hit-testing. */
export function portAt(
  placed: PlacedDiagram,
  at: Point,
  radius = 9,
): { block: string; port: string } | null {
  let best: { block: string; port: string } | null = null;
  let bestDistance = radius * radius;
  for (const b of placed.blocks) {
    for (const [id, p] of b.ports) {
      const dx = p.ax - at.x;
      const dy = p.ay - at.y;
      const d = dx * dx + dy * dy;
      if (d <= bestDistance) {
        bestDistance = d;
        best = { block: b.block.id, port: id };
      }
    }
  }
  return best;
}

/** The topmost block whose body contains this point. */
export function blockAt(placed: PlacedDiagram, at: Point): string | null {
  for (let i = placed.blocks.length - 1; i >= 0; i--) {
    const b = placed.blocks[i] as PlacedBlock;
    if (at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h) {
      return b.block.id;
    }
  }
  return null;
}

/** The nearest wire within `radius`, for click-to-select and delete. */
export function linkAt(
  placed: PlacedDiagram,
  at: Point,
  radius = 6,
): string | null {
  let best: string | null = null;
  let bestDistance = radius;
  for (const routed of placed.links) {
    for (let i = 1; i < routed.points.length; i++) {
      const a = routed.points[i - 1] as Point;
      const b = routed.points[i] as Point;
      const d = distanceToSegment(at, a, b);
      if (d < bestDistance) {
        bestDistance = d;
        best = routed.link.id;
      }
    }
  }
  return best;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The blocks whose bodies fall inside a marquee rectangle. */
export function blocksIn(
  placed: PlacedDiagram,
  rect: { x0: number; y0: number; x1: number; y1: number },
): string[] {
  const x0 = Math.min(rect.x0, rect.x1);
  const x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const y1 = Math.max(rect.y0, rect.y1);
  return placed.blocks
    .filter((b) => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0)
    .map((b) => b.block.id);
}
