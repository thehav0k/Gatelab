import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { placeOnBreadboard, stripOfPin } from "./place";
import { realize, synthesize, technologyMap, type Strategy } from "./synth";
import { verify } from "./verify";
import { elaborate } from "./elaborate";
import { evaluate } from "./solver";
import { diagnose } from "./diagnostics";
import { dipHoles, stripOf, DEFAULT_BOARD } from "./breadboard";
import { pinsOf } from "./parts";
import { parseInput } from "@/lib/core-engine/canonical";
import { minimize } from "@/lib/core-engine/minimizer";
import { arbFunction } from "@/lib/core-engine/testing/arbitraries";
import type { BooleanFunction } from "@/lib/core-engine/types";
import type { CircuitDocument } from "./netlist";

const fnOf = (src: string): BooleanFunction => {
  const r = parseInput(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value;
};

/** Synthesize a function, then seat it on a real board. */
const board = (fn: BooleanFunction, strategy: Strategy = "mixed"): CircuitDocument =>
  placeOnBreadboard(
    realize(technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), strategy)),
  ).doc;

describe("placeOnBreadboard", () => {
  it("seats the chips straddling the centre channel", () => {
    const doc = board(fnOf("F(A,B,C) = A'B + BC"));
    const ics = Object.values(doc.nodes).filter((n) => n.kind === "ic");
    expect(ics.length).toBeGreaterThan(0);

    for (const ic of ics) {
      const holes = dipHoles({ col: Math.round(ic.pos.x) }, pinsOf(ic).length);
      const lower = holes.slice(0, 7);
      const upper = holes.slice(7);
      expect(lower.every((h) => h.row === "E"), ic.label).toBe(true);
      expect(upper.every((h) => h.row === "F"), ic.label).toBe(true);
    }
  });

  /**
   * THE PHYSICAL RULE. A chip's leg is IN a hole, so a jumper cannot also be in
   * that hole — it has to use one of the other four on the same strip. Break this
   * and you have drawn a picture of a breadboard, not modelled one: the
   * simulation would pass and the student could not build the thing.
   */
  it("never plugs a jumper into a hole a chip's leg already occupies", () => {
    const doc = board(fnOf("F(A,B,C) = A'B + BC"));

    const legs = new Set<string>();
    for (const node of Object.values(doc.nodes)) {
      if (node.kind !== "ic") continue;
      for (const h of dipHoles({ col: Math.round(node.pos.x) }, pinsOf(node).length)) {
        legs.add(`${h.col}/${h.row}`);
      }
    }

    for (const wire of Object.values(doc.wires)) {
      for (const end of [wire.a, wire.b]) {
        if (end.kind !== "hole") continue;
        expect(
          legs.has(`${end.ref.col}/${end.ref.row}`),
          `jumper ${wire.id} shares a hole with a chip leg`,
        ).toBe(false);
      }
    }
  });

  it("still lands each jumper on the RIGHT strip", () => {
    // The jumper must be electrically where the leg is, just not in the same hole.
    const doc = board(fnOf("F(A,B) = A*B"));
    const spec = DEFAULT_BOARD;

    // Every wire is hole-to-hole on a placed board.
    for (const wire of Object.values(doc.wires)) {
      expect(wire.a.kind).toBe("hole");
      expect(wire.b.kind).toBe("hole");
    }

    // And each chip's Vcc leg shares a strip with something that reaches a rail.
    const ic = Object.values(doc.nodes).find((n) => n.kind === "ic")!;
    const holes = dipHoles({ col: Math.round(ic.pos.x) }, pinsOf(ic).length);
    const vccLeg = holes[13]!; // pin 14
    const vccStrip = stripOf(spec, vccLeg);

    const touches = Object.values(doc.wires).some((w) =>
      [w.a, w.b].some((e) => e.kind === "hole" && stripOf(spec, e.ref) === vccStrip),
    );
    expect(touches).toBe(true);
  });

  it("builds a board with no faults", () => {
    const doc = board(fnOf("F(A,B,C) = A'B + BC"));
    const { index, netlist } = elaborate(doc);
    const state = evaluate(netlist, netlist.inputs.map(() => 0 as const));
    const errors = diagnose(doc, index, netlist, state).filter(
      (d) => d.severity === "error",
    );
    expect(errors.map((e) => e.message)).toEqual([]);
  });
});

describe("when it does not fit", () => {
  /**
   * A part seated past the last column is not "somewhere off to the right" — it is
   * NOWHERE. Reporting it matters: a silently off-board part presents as a
   * mysterious dead output, which is precisely the kind of lie this app exists to
   * stop telling.
   */
  it("reports parts that run off the end of a small board", () => {
    const fn = fnOf("F(A,B,C,D) = Σm(1,3,7,11,15)");
    const schematic = realize(
      technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), "mixed"),
    );

    const tiny = { columns: 12, railSegments: 2 };
    const { unplaced } = placeOnBreadboard(schematic, tiny);
    expect(unplaced.length).toBeGreaterThan(0);
  });

  it("keeps a chip that does fit, even when a later one does not", () => {
    const fn = fnOf("F(A,B,C,D) = Σm(1,3,7,11,15)");
    const schematic = realize(
      technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), "mixed"),
    );

    const { doc, unplaced } = placeOnBreadboard(schematic, {
      columns: 14,
      railSegments: 2,
    });
    const seated = Object.values(doc.nodes).filter((n) => n.kind === "ic");
    expect(seated.length).toBeGreaterThan(0);
    expect(unplaced.length).toBeGreaterThan(0);
  });
});

describe("stripOfPin", () => {
  it("names the strip a chip's pin is plugged into", () => {
    const doc = board(fnOf("F(A,B) = A*B"));
    const ic = Object.values(doc.nodes).find((n) => n.kind === "ic")!;

    const vcc = stripOfPin(doc, { node: ic.id, pin: "VCC" });
    const pin1 = stripOfPin(doc, { node: ic.id, pin: "1A" });

    expect(vcc).not.toBeNull();
    // Vcc is across the channel from pin 1, so a DIFFERENT strip.
    expect(vcc).not.toBe(pin1);
  });

  it("names the strip a seated switch is in", () => {
    const doc = board(fnOf("F(A,B) = A*B"));
    const sw = Object.values(doc.nodes).find((n) => n.kind === "switch")!;
    expect(stripOfPin(doc, { node: sw.id, pin: "Y" })).not.toBeNull();
  });

  it("returns null off a board, or for a pin that does not exist", () => {
    const schematic = realize(
      technologyMap(synthesize(minimize(fnOf("F(A,B) = A*B"), "sop").expression, ["A", "B"]), "mixed"),
    );
    const ic = Object.values(schematic.nodes).find((n) => n.kind === "ic")!;
    // No board: nothing is plugged into anything.
    expect(stripOfPin(schematic, { node: ic.id, pin: "VCC" })).toBeNull();

    const placed = board(fnOf("F(A,B) = A*B"));
    const placedIc = Object.values(placed.nodes).find((n) => n.kind === "ic")!;
    expect(stripOfPin(placed, { node: placedIc.id, pin: "NOPE" })).toBeNull();
  });
});

describe("the placed board is the same circuit", () => {
  /**
   * THE ACCEPTANCE GATE. A board seated from a synthesized design must verify
   * against the ORIGINAL ALGEBRA — through five holes of shorted metal, a split
   * power rail, and a chip straddling the centre channel.
   *
   * Nothing in the solver, the diagnostics, or the verification bridge changed to
   * make this work. That is Invariant 1 paying for itself.
   */
  it.each(["mixed", "nand-only", "nor-only"] as const)(
    "a %s board verifies against the function it was built from",
    (strategy) => {
      for (const src of ["F(A,B) = A*B", "F(A,B,C) = A'B + BC", "F(A,B) = A ^ B"]) {
        const fn = fnOf(src);
        const result = verify(board(fn, strategy), fn);
        expect(result.error, `${src} / ${strategy}`).toBeNull();
        expect(result.ok, `${src} / ${strategy}`).toBe(true);
      }
    },
  );

  it("verifies over random functions", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 1, maxVars: 3 }), (fn) => {
        if (minimize(fn, "sop").trace.degenerate) return;
        const result = verify(board(fn), fn);
        expect(result.error).toBeNull();
        expect(result.ok, JSON.stringify(result.mismatches)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it("gives the same truth table as the schematic it came from", () => {
    const fn = fnOf("F(A,B,C) = A'B + BC");
    const schematic = realize(
      technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), "mixed"),
    );
    const placed = placeOnBreadboard(schematic).doc;

    const rowsOf = (doc: CircuitDocument) =>
      verify(doc, fn).rows.map((r) => r.actual);

    expect(rowsOf(placed)).toEqual(rowsOf(schematic));
  });
});
