import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { gray, kmapLayout, kmapLoops, neighbours } from "./kmap";
import { minimize, cubeCovers } from "./minimizer";
import { parseInput } from "./canonical";
import { arbFunction } from "./testing/arbitraries";
import type { BooleanFunction } from "./types";

const fnOf = (src: string): BooleanFunction => {
  const r = parseInput(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value;
};

const loopsFor = (src: string) => {
  const fn = fnOf(src);
  const layout = kmapLayout(fn.variables);
  return { fn, layout, loops: kmapLoops(minimize(fn).cover, layout) };
};

describe("gray code", () => {
  it("produces the standard reflected sequence", () => {
    expect([0, 1, 2, 3].map(gray)).toEqual([0, 1, 3, 2]);
  });

  it("changes exactly one bit between successive values", () => {
    for (let i = 1; i < 16; i++) {
      const diff = gray(i) ^ gray(i - 1);
      expect(diff & (diff - 1)).toBe(0); // a power of two => exactly one bit
    }
  });
});

describe("kmapLayout", () => {
  it("lays out a 4-variable map as 4x4 with Gray-coded headers", () => {
    const l = kmapLayout(["A", "B", "C", "D"]);
    expect([l.rows, l.cols]).toEqual([4, 4]);
    expect(l.rowLabels).toEqual(["00", "01", "11", "10"]);
    expect(l.colLabels).toEqual(["00", "01", "11", "10"]);
    expect(l.rowVariables).toEqual(["A", "B"]);
    expect(l.colVariables).toEqual(["C", "D"]);
  });

  it("lays out a 3-variable map as 2x4", () => {
    const l = kmapLayout(["A", "B", "C"]);
    expect([l.rows, l.cols]).toEqual([2, 4]);
    expect(l.cellIndex[0]).toEqual([0, 1, 3, 2]);
    expect(l.cellIndex[1]).toEqual([4, 5, 7, 6]);
  });

  it("indexes every minterm exactly once, and positionOf inverts it", () => {
    for (const vars of [["A"], ["A", "B"], ["A", "B", "C"], ["A", "B", "C", "D"]]) {
      const l = kmapLayout(vars);
      const seen = l.cellIndex.flat().sort((a, b) => a - b);
      expect(seen).toEqual([...Array(1 << vars.length).keys()]);

      for (let m = 0; m < 1 << vars.length; m++) {
        const { row, col } = l.positionOf[m]!;
        expect(l.cellIndex[row]![col]).toBe(m);
      }
    }
  });

  // THE RULE. Screen adjacency must fall out of index adjacency, not the other
  // way round. If this passes, wrap-around is correct for free.
  it("puts every Hamming-1 neighbour in an adjacent cell, counting wrap", () => {
    for (const vars of [["A", "B"], ["A", "B", "C"], ["A", "B", "C", "D"]]) {
      const n = vars.length;
      const l = kmapLayout(vars);

      for (let m = 0; m < 1 << n; m++) {
        const here = l.positionOf[m]!;
        for (const nb of neighbours(m, n)) {
          const there = l.positionOf[nb]!;
          const dr = cyclicDistance(here.row, there.row, l.rows);
          const dc = cyclicDistance(here.col, there.col, l.cols);
          // Differ by one step along exactly one axis (wrapping counts as a step).
          expect([dr, dc].sort(), `m${m} vs m${nb}`).toEqual([0, 1]);
        }
      }
    }
  });
});

describe("kmapLoops", () => {
  it("draws a non-wrapping group as a single rectangle", () => {
    // Σm(4,5,6,7) over ABC is just A — the whole bottom row.
    const { loops } = loopsFor("F(A,B,C) = Σm(4,5,6,7)");
    expect(loops).toHaveLength(1);
    expect(loops[0]!.rects).toHaveLength(1);
    expect(loops[0]!.wraps).toBe(false);
    expect(loops[0]!.rects[0]).toEqual({ row: 1, col: 0, rowSpan: 1, colSpan: 4 });
  });

  // Pitfall #7 in its most visible form. m0 and m2 are adjacent (they differ in
  // one bit) but they sit at opposite ends of the row, so ONE implicant needs
  // TWO boxes. A GridRect (singular) return type cannot express this.
  it("splits a side-wrapping group into two disjoint rectangles", () => {
    // Σm(0,2) over ABC is A'C' — columns 00 and 10, which are the far left and
    // far right of the Gray-ordered header.
    const { loops } = loopsFor("F(A,B,C) = Σm(0,2)");
    const loop = loops[0]!;
    expect(loop.label).toBe("A'C'");
    expect(loop.wraps).toBe(true);
    expect(loop.rects).toHaveLength(2);
    expect(loop.cells).toEqual([0, 2]);
  });

  it("splits the four-corner group into four rectangles", () => {
    // Σm(0,2,8,10) over ABCD is B'D' — all four corners.
    const { loops } = loopsFor("F(A,B,C,D) = Σm(0,2,8,10)");
    const loop = loops[0]!;
    expect(loop.label).toBe("B'D'");
    expect(loop.rects).toHaveLength(4);
    for (const r of loop.rects) {
      expect([r.rowSpan, r.colSpan]).toEqual([1, 1]);
    }
    expect(loop.cells).toEqual([0, 2, 8, 10]);
  });

  it("reports which variables each group eliminated", () => {
    const { loops } = loopsFor("F(A,B,C) = Σm(4,5,6,7)");
    expect(loops[0]!.eliminated).toEqual(["B", "C"]);
  });

  it("assigns each loop a distinct colour slot", () => {
    const { loops } = loopsFor("F(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)");
    expect(new Set(loops.map((l) => l.colorIndex)).size).toBe(loops.length);
  });
});

describe("properties", () => {
  // The loops ARE the prime implicants (Invariant 4). This asserts the geometry
  // did not lose or invent a cell along the way — which is exactly where a
  // wrap-around bug would show up.
  it("a loop's rectangles cover precisely the cube's minterms", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 1, maxVars: 4 }), (fn) => {
        const layout = kmapLayout(fn.variables);
        const loops = kmapLoops(minimize(fn).cover, layout);

        for (const loop of loops) {
          // 1. What the rectangles paint on screen...
          const painted = new Set<number>();
          for (const r of loop.rects) {
            for (let dr = 0; dr < r.rowSpan; dr++) {
              for (let dc = 0; dc < r.colSpan; dc++) {
                painted.add(layout.cellIndex[r.row + dr]![r.col + dc]!);
              }
            }
          }

          // 2. ...must equal the cells the cube actually covers.
          const covered = new Set<number>();
          for (let m = 0; m < fn.values.length; m++) {
            if (cubeCovers(loop.cube, m)) covered.add(m);
          }

          expect([...painted].sort((a, b) => a - b)).toEqual(
            [...covered].sort((a, b) => a - b),
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it("every group is a power-of-two block, as a K-map group must be", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 1, maxVars: 4 }), (fn) => {
        const layout = kmapLayout(fn.variables);
        for (const loop of kmapLoops(minimize(fn).cover, layout)) {
          const size = loop.cells.length;
          expect(size & (size - 1)).toBe(0);
          expect([1, 2, 4].includes(loop.rects.length)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("never paints a cell the function says is 0", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 1, maxVars: 4 }), (fn) => {
        const layout = kmapLayout(fn.variables);
        for (const loop of kmapLoops(minimize(fn).cover, layout)) {
          for (const m of loop.cells) {
            expect(fn.values[m], `cell ${m}`).not.toBe(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

/** Distance along one axis, treating the axis as a ring (which a K-map is). */
function cyclicDistance(a: number, b: number, size: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, size - d);
}
