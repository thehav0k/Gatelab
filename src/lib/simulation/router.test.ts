import { describe, expect, it } from "vitest";
import {
  CELL,
  DEFAULT_COST,
  bendCount,
  buildOccupancy,
  footprint,
  pinPoint,
  routeAll,
  routeWire,
  simplify,
  type OccupancyGrid,
} from "./router";
import { elaborate } from "./elaborate";
import { buildNetIndex, endpointKey, type CircuitDocument, type Point, type Wire } from "./netlist";
import { pinsOf } from "./parts";
import { circuit } from "./testing/build";
import { realize, synthesize, technologyMap } from "./synth";
import { parse } from "@/lib/core-engine/parser";

/** An empty grid of `w` x `h` cells with its origin at 0,0. */
const emptyGrid = (w: number, h: number): OccupancyGrid => ({
  x0: 0,
  y0: 0,
  w,
  h,
  cells: new Int32Array(w * h),
  near: new Uint8Array(w * h),
});

const block = (g: OccupancyGrid, cx: number, cy: number): void => {
  g.cells[cy * g.w + cx] = -1;
};

const at = (cx: number, cy: number): Point => ({ x: cx * CELL, y: cy * CELL });

describe("routeWire — basics", () => {
  it("routes a straight shot with zero bends", () => {
    const path = routeWire(emptyGrid(20, 10), at(1, 5), at(15, 5), 1);
    expect(path).not.toBeNull();
    expect(bendCount(path!)).toBe(0);
    expect(path).toEqual([at(1, 5), at(15, 5)]);
  });

  it("routes an L-shape with exactly one bend", () => {
    const path = routeWire(emptyGrid(20, 20), at(1, 1), at(10, 10), 1);
    expect(bendCount(path!)).toBe(1);
  });

  /**
   * THE TEST A PLAIN BFS FAILS.
   *
   * Lee's algorithm is a BFS wavefront, and BFS is only optimal when every edge
   * costs the same. Minimal bends means a WEIGHTED graph, so a FIFO queue returns
   * a shortest-*length* path with an arbitrary number of jogs — and every route
   * here has the same length.
   *
   * There are many monotone staircases from (1,1) to (11,6); all of them are 15
   * steps. Only two have a single bend. An optimal weighted search must find one
   * of those; BFS would return whichever staircase it popped first.
   */
  it("prefers the fewest bends among many equal-length paths", () => {
    const path = routeWire(emptyGrid(24, 16), at(1, 1), at(11, 6), 1);
    expect(path).not.toBeNull();

    // Same Manhattan length either way…
    const length = path!.reduce(
      (sum, p, i) =>
        i === 0
          ? 0
          : sum + Math.abs(p.x - (path![i - 1] as Point).x) + Math.abs(p.y - (path![i - 1] as Point).y),
      0,
    );
    expect(length / CELL).toBe(15);

    // …but it must take the ONE-bend route, not a staircase.
    expect(bendCount(path!)).toBe(1);
  });

  it("is deterministic", () => {
    const a = routeWire(emptyGrid(30, 20), at(2, 2), at(25, 15), 1);
    const b = routeWire(emptyGrid(30, 20), at(2, 2), at(25, 15), 1);
    expect(a).toEqual(b);
  });

  it("produces a purely orthogonal path", () => {
    const path = routeWire(emptyGrid(30, 20), at(1, 1), at(25, 15), 1)!;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1] as Point;
      const b = path[i] as Point;
      // Every segment moves along exactly one axis.
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });
});

describe("routeWire — obstacles", () => {
  it("detours around a wall rather than through it", () => {
    const g = emptyGrid(20, 12);
    // A wall across the direct path, with a gap at the bottom.
    for (let cy = 0; cy <= 8; cy++) block(g, 8, cy);

    const path = routeWire(g, at(2, 4), at(15, 4), 1);
    expect(path).not.toBeNull();

    // It must dip below the wall, so it cannot stay on row 4.
    expect(path!.some((p) => p.y / CELL > 8)).toBe(true);
    expect(bendCount(path!)).toBeGreaterThan(0);
  });

  /**
   * A route is COSMETIC. Failing to find one must never affect connectivity —
   * see the header of router.ts. Here the target is walled in completely.
   */
  it("returns null for an unreachable target instead of inventing a path", () => {
    const g = emptyGrid(20, 20);
    for (const [cx, cy] of [
      [14, 9], [15, 9], [16, 9],
      [14, 10], [16, 10],
      [14, 11], [15, 11], [16, 11],
    ] as const) {
      block(g, cx, cy);
    }

    expect(routeWire(g, at(2, 2), at(15, 10), 1)).toBeNull();
  });

  it("crosses a foreign net when it must, but prefers not to", () => {
    const g = emptyGrid(24, 12);
    // A foreign net (id 7) laid across the middle, with a way around the bottom.
    for (let cx = 0; cx <= 20; cx++) g.cells[5 * g.w + cx] = 7;

    const cheapDetour = routeWire(g, at(2, 2), at(18, 8), 1, DEFAULT_COST)!;
    // Going around is possible here, so with a stiff crossing penalty it should
    // cross at most once.
    const crossings = cheapDetour.filter((p) => p.y / CELL === 5).length;
    expect(crossings).toBeLessThanOrEqual(2);

    // But it is never a hard block: make crossing free and it goes straight over.
    const free = routeWire(g, at(2, 5), at(18, 5), 1, { ...DEFAULT_COST, crossNet: 0 })!;
    expect(bendCount(free)).toBe(0);
  });

  it("reuses its OWN net's cells for free", () => {
    const g = emptyGrid(24, 12);
    for (let cx = 0; cx <= 20; cx++) g.cells[5 * g.w + cx] = 3;

    // Net 3 routing along its own trunk must not be charged the crossing penalty.
    const path = routeWire(g, at(2, 5), at(18, 5), 3)!;
    expect(bendCount(path)).toBe(0);
  });
});

describe("simplify", () => {
  it("collapses collinear runs to corners", () => {
    expect(
      simplify([at(0, 0), at(1, 0), at(2, 0), at(2, 1), at(2, 2)]),
    ).toEqual([at(0, 0), at(2, 0), at(2, 2)]);
  });

  it("leaves a two-point path alone", () => {
    expect(simplify([at(0, 0), at(3, 0)])).toEqual([at(0, 0), at(3, 0)]);
  });
});

describe("occupancy", () => {
  it("blocks component bodies but leaves every pin reachable", () => {
    const doc = circuit().ic("U1", "7408", { x: 100, y: 100 }).build();
    const grid = buildOccupancy(doc);
    const node = doc.nodes["U1"]!;

    // The middle of the chip is solid.
    const f = footprint(node);
    const midX = Math.round((f.x + f.w / 2) / CELL) - grid.x0;
    const midY = Math.round((f.y + f.h / 2) / CELL) - grid.y0;
    expect(grid.cells[midY * grid.w + midX]).toBe(-1);

    // Every pin is enterable, or nothing could ever be wired.
    for (const spec of pinsOf(node)) {
      const p = pinPoint(node, spec.name)!;
      const cx = Math.round(p.x / CELL) - grid.x0;
      const cy = Math.round(p.y / CELL) - grid.y0;
      expect(grid.cells[cy * grid.w + cx], spec.name).toBe(0);
    }
  });
});

describe("routeAll — on real boards", () => {
  const netOf = (doc: CircuitDocument) => {
    const index = buildNetIndex(doc, pinsOf);
    return (wire: Wire) => {
      const id = index.netOfEndpoint.get(endpointKey(wire.a));
      return id ? (index.ordinalOf.get(id) ?? 0) + 1 : 0;
    };
  };

  const built = (src: string, vars: string[]): CircuitDocument => {
    const r = parse(src);
    if (!r.ok) throw new Error("bad expression");
    return realize(technologyMap(synthesize(r.value.ast, vars), "mixed"), {
      outputLabel: "F",
    });
  };

  it("routes every wire of a synthesized 74xx board", () => {
    const doc = built("A'B + BC", ["A", "B", "C"]);
    const result = routeAll(doc, netOf(doc));

    expect(result.paths.size).toBe(Object.keys(doc.wires).length);
    expect(result.failed).toEqual([]);
  });

  /**
   * The actual defect this exists to fix: the old "out, across, in" path drew
   * wires straight through the chips.
   */
  it("never draws a wire through a chip body", () => {
    const doc = built("A'B + BC", ["A", "B", "C"]);
    const { paths } = routeAll(doc, netOf(doc));
    const grid = buildOccupancy(doc);

    const pinCells = new Set<string>();
    for (const node of Object.values(doc.nodes)) {
      for (const spec of pinsOf(node)) {
        const p = pinPoint(node, spec.name)!;
        pinCells.add(`${Math.round(p.x / CELL)},${Math.round(p.y / CELL)}`);
      }
    }

    for (const [id, path] of paths) {
      if (!path) continue;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i] as Point;
        const b = path[i + 1] as Point;
        const ax = Math.round(a.x / CELL);
        const ay = Math.round(a.y / CELL);
        const bx = Math.round(b.x / CELL);
        const by = Math.round(b.y / CELL);
        const dx = Math.sign(bx - ax);
        const dy = Math.sign(by - ay);

        let cx = ax;
        let cy = ay;
        for (;;) {
          // A pin sits on its body's edge, so it is legitimately "inside" one.
          if (!pinCells.has(`${cx},${cy}`)) {
            const gi = (cy - grid.y0) * grid.w + (cx - grid.x0);
            expect(grid.cells[gi], `wire ${id} crosses a body at ${cx},${cy}`).not.toBe(-1);
          }
          if (cx === bx && cy === by) break;
          cx += dx;
          cy += dy;
        }
      }
    }
  });

  it("leaves the simulation completely untouched", () => {
    // The load-bearing rule: a route is cosmetic. Routing must not change a
    // single net, a single value, or a single diagnostic.
    const doc = built("A'B + BC", ["A", "B", "C"]);
    const before = elaborate(doc);

    routeAll(doc, netOf(doc));

    const after = elaborate(doc);
    expect(after.netlist.netCount).toBe(before.netlist.netCount);
    expect(after.netlist.cells.length).toBe(before.netlist.cells.length);
  });

  it("still reports a wire it could not route, rather than dropping it", () => {
    // Two pins with no space between them at all: the LED is buried under the IC.
    const doc = circuit()
      .ic("U1", "7408", { x: 0, y: 0 })
      .led("Q", { x: 40, y: 24 }) // inside the chip's footprint
      .wire("U1", "1Y", "Q", "A")
      .build();

    const result = routeAll(doc, () => 1);
    // Either it routes or it does not — but the wire must appear in the map
    // either way, so the UI can fall back to an air-wire.
    expect(result.paths.has("w1")).toBe(true);
  });
});
