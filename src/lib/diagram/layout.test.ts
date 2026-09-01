import { describe, expect, it } from "vitest";
import { layout, type PlacedBlock, type Point, type RoutedLink } from "./layout";
import { TEXTBOOK } from "./theme";
import { PROBLEMS, defaults } from "./problems";
import type { Diagram } from "./types";

/**
 * The two invariants that decide whether a diagram is an ANSWER or a mess, both
 * checked across every diagram the catalogue can produce.
 *
 * Neither is cosmetic. Two overlapping boxes hide a component; a wire crossing a
 * block body looks, to a reader, exactly like a connection to it — so a layout
 * that does either is not slightly ugly, it is WRONG, and it is wrong silently.
 * Nothing else in this codebase can catch that, which is why it is asserted here
 * over the real corpus rather than over a toy graph.
 */

const everyDiagram = (): { name: string; diagram: Diagram }[] =>
  PROBLEMS.flatMap((p) =>
    p.solve(defaults(p)).diagrams.map((d) => ({ name: `Q${p.number} ${d.id}`, diagram: d })),
  );

const overlaps = (a: PlacedBlock, b: PlacedBlock): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Does a wire segment pass through the interior of a block it does not touch? */
function crossings(link: RoutedLink, blocks: readonly PlacedBlock[]): number {
  let count = 0;
  for (let i = 1; i < link.points.length; i++) {
    const s = link.points[i - 1] as Point;
    const e = link.points[i] as Point;
    const x0 = Math.min(s.x, e.x);
    const x1 = Math.max(s.x, e.x);
    const y0 = Math.min(s.y, e.y);
    const y1 = Math.max(s.y, e.y);
    for (const b of blocks) {
      if (b.block.id === link.link.from.block || b.block.id === link.link.to.block) continue;
      // A 2px inset, so a wire that merely grazes a border is not a crossing.
      if (x0 < b.x + b.w - 2 && b.x + 2 < x1 && y0 < b.y + b.h - 2 && b.y + 2 < y1) count++;
    }
  }
  return count;
}

describe("layout invariants over the whole catalogue", () => {
  for (const { name, diagram } of everyDiagram()) {
    describe(name, () => {
      const placed = layout(diagram, TEXTBOOK);

      it("places no two blocks on top of each other", () => {
        for (let i = 0; i < placed.blocks.length; i++) {
          for (let j = i + 1; j < placed.blocks.length; j++) {
            const a = placed.blocks[i] as PlacedBlock;
            const b = placed.blocks[j] as PlacedBlock;
            expect(overlaps(a, b), `${a.block.id} overlaps ${b.block.id}`).toBe(false);
          }
        }
      });

      it("routes no wire through a block it is not connected to", () => {
        for (const l of placed.links) {
          expect(crossings(l, placed.blocks), `${l.link.id} crosses a block`).toBe(0);
        }
      });

      it("keeps every wire orthogonal", () => {
        for (const l of placed.links) {
          for (let i = 1; i < l.points.length; i++) {
            const a = l.points[i - 1] as Point;
            const b = l.points[i] as Point;
            expect(Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6).toBe(true);
          }
        }
      });

      it("draws every wire inside the reported canvas", () => {
        for (const l of placed.links) {
          for (const p of l.points) {
            expect(p.x).toBeGreaterThanOrEqual(-0.6);
            expect(p.y).toBeGreaterThanOrEqual(-0.6);
            expect(p.x).toBeLessThanOrEqual(placed.width + 0.6);
            expect(p.y).toBeLessThanOrEqual(placed.height + 0.6);
          }
        }
      });
    });
  }
});

describe("layered placement", () => {
  it("routes a feedback path around the outside, below every block", () => {
    // A sequential circuit is nothing but feedback; the back edge must not be
    // drawn through the middle, where it would read as a forward signal.
    const q40 = PROBLEMS.find((p) => p.id === "q40");
    expect(q40).toBeDefined();
    const diagram = (q40 as NonNullable<typeof q40>).solve(defaults(q40 as NonNullable<typeof q40>))
      .diagrams[0] as Diagram;
    const placed = layout(diagram, TEXTBOOK);
    const back = placed.links.filter((l) => l.feedback);
    expect(back.length).toBeGreaterThan(0);

    const bottom = Math.max(...placed.blocks.map((b) => b.y + b.h));
    for (const l of back) {
      const lowest = Math.max(...l.points.map((p) => p.y));
      expect(lowest).toBeGreaterThan(bottom);
    }
  });

  it("puts the fan-out's dot where the wires actually part, not on the pin", () => {
    const diagram: Diagram = {
      id: "fan",
      title: "fan",
      blocks: [
        { id: "S", kind: "io", title: "S", tone: "input", ports: [{ id: "Y", label: "", side: "right", dir: "out" }] },
        { id: "A", kind: "io", title: "A", tone: "output", ports: [{ id: "A", label: "", side: "left", dir: "in" }] },
        { id: "B", kind: "io", title: "B", tone: "output", ports: [{ id: "A", label: "", side: "left", dir: "in" }] },
      ],
      links: [
        { id: "1", from: { block: "S", port: "Y" }, to: { block: "A", port: "A" } },
        { id: "2", from: { block: "S", port: "Y" }, to: { block: "B", port: "A" } },
      ],
    };
    const placed = layout(diagram, TEXTBOOK);
    expect(placed.junctions).toHaveLength(1);

    // The old rule — "a port with two wires on it" — put the dot on the pin,
    // where nothing branches: the two wires run together for a while first. The
    // T was left undotted, which on a schematic says NOT connected.
    const dot = placed.junctions[0]!;
    const source = placed.blocks.find((b) => b.block.id === "S")!.ports.get("Y")!;
    expect(dot.x).toBeGreaterThan(source.ax + 10);

    // And it sits ON both wires — not necessarily on a corner of either, since
    // one of them simply passes through the point where the other leaves.
    for (const wire of placed.links) {
      const onIt = wire.points.slice(1).some((b, i) => {
        const a = wire.points[i]!;
        return (
          Math.min(a.x, b.x) - 1 <= dot.x &&
          dot.x <= Math.max(a.x, b.x) + 1 &&
          Math.min(a.y, b.y) - 1 <= dot.y &&
          dot.y <= Math.max(a.y, b.y) + 1
        );
      });
      expect(onIt).toBe(true);
    }
  });

  it("leaves a crossing between two different signals undotted", () => {
    // Two wires that cross is not two wires that meet, and the dot is the only
    // thing that says which one a drawing means.
    const diagram: Diagram = {
      id: "cross",
      title: "cross",
      blocks: [
        { id: "P", kind: "io", title: "P", tone: "input", ports: [{ id: "Y", label: "", side: "right", dir: "out" }] },
        { id: "Q", kind: "io", title: "Q", tone: "input", ports: [{ id: "Y", label: "", side: "right", dir: "out" }] },
        { id: "X", kind: "io", title: "X", tone: "output", ports: [{ id: "A", label: "", side: "left", dir: "in" }] },
        { id: "Z", kind: "io", title: "Z", tone: "output", ports: [{ id: "A", label: "", side: "left", dir: "in" }] },
      ],
      links: [
        { id: "1", from: { block: "P", port: "Y" }, to: { block: "Z", port: "A" } },
        { id: "2", from: { block: "Q", port: "Y" }, to: { block: "X", port: "A" } },
      ],
    };
    expect(layout(diagram, TEXTBOOK).junctions).toHaveLength(0);
  });

  it("drops a link that names a block that is not there, rather than throwing", () => {
    const diagram: Diagram = {
      id: "ghost",
      title: "ghost",
      blocks: [{ id: "S", kind: "io", title: "S", tone: "input", ports: [{ id: "Y", label: "", side: "right", dir: "out" }] }],
      links: [{ id: "1", from: { block: "S", port: "Y" }, to: { block: "GONE", port: "A" } }],
    };
    const placed = layout(diagram, TEXTBOOK);
    expect(placed.links).toHaveLength(0);
    expect(placed.blocks).toHaveLength(1);
  });
});
