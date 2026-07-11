import { describe, expect, it } from "vitest";
import {
  CONSTRAINTS,
  allowsGate,
  allowsPart,
  getConstraint,
  satisfies,
  violations,
} from "./constraints";
import { realize, synthesize, technologyMap } from "./synth";
import { verify } from "./verify";
import { circuit } from "./testing/build";
import { parseInput } from "@/lib/core-engine/canonical";
import { minimize } from "@/lib/core-engine/minimizer";
import type { BooleanFunction } from "@/lib/core-engine/types";

const fnOf = (src: string): BooleanFunction => {
  const r = parseInput(src);
  if (!r.ok) throw new Error("bad");
  return r.value;
};

describe("constraints", () => {
  it("NAND-only permits the 7400 and nothing else", () => {
    const c = getConstraint("nand-only");
    expect(allowsGate(c, "nand")).toBe(true);
    expect(allowsGate(c, "and")).toBe(false);
    expect(allowsGate(c, "xor")).toBe(false);
    expect(allowsPart(c, "7400")).toBe(true);
    expect(allowsPart(c, "7408")).toBe(false);
  });

  it("fundamental-only permits AND, OR, NOT but not XOR", () => {
    const c = getConstraint("fundamental");
    expect(allowsGate(c, "and")).toBe(true);
    expect(allowsGate(c, "not")).toBe(true);
    expect(allowsGate(c, "xor")).toBe(false);
    expect(allowsGate(c, "nand")).toBe(false);
  });

  it("falls back to no-restriction for an unknown id", () => {
    expect(getConstraint("nonsense").id).toBe("none");
  });
});

describe("violations", () => {
  it("names every forbidden part already on the board", () => {
    const doc = circuit()
      .gate("G1", "xor")
      .ic("U1", "7486")
      .gate("G2", "nand")
      .build();

    const v = violations(doc, getConstraint("nand-only"));
    expect(v.map((x) => x.label).sort()).toEqual(["G1", "U1"]);
    expect(v.find((x) => x.label === "G1")?.message).toMatch(/XOR/);
    expect(v.find((x) => x.label === "U1")?.message).toMatch(/7486/);
  });

  it("passes a board that already obeys the rule", () => {
    const doc = circuit().gate("G1", "nand").ic("U1", "7400").build();
    expect(satisfies(doc, getConstraint("nand-only"))).toBe(true);
  });

  it("never objects under no-restriction", () => {
    const doc = circuit().gate("G1", "xnor").ic("U1", "7486").build();
    expect(satisfies(doc, getConstraint("none"))).toBe(true);
  });
});

describe("the constraint steers the synthesizer", () => {
  /**
   * THE POINT OF THE WHOLE FEATURE. "Build it for me" under a NAND-only rule must
   * produce a circuit that OBEYS the rule — and that still computes the right
   * function. A constraint that the generator itself violates is worthless.
   */
  it.each(CONSTRAINTS.map((c) => [c.id, c] as const))(
    "%s: generated circuits obey the rule AND verify",
    (_id, constraint) => {
      const fn = fnOf("F(A,B,C) = A'B + BC");
      const doc = realize(
        technologyMap(
          synthesize(minimize(fn, "sop").expression, fn.variables),
          constraint.strategy,
        ),
      );

      expect(violations(doc, constraint).map((v) => v.message)).toEqual([]);
      expect(verify(doc, fn).ok).toBe(true);
    },
  );

  it("a NAND-only build really is nothing but 7400s", () => {
    const fn = fnOf("F(A,B,C) = A ^ B ^ C"); // XOR: the hardest case for NAND-only
    const doc = realize(
      technologyMap(minimizeFor(fn), getConstraint("nand-only").strategy),
    );

    const parts = Object.values(doc.nodes)
      .filter((n) => n.kind === "ic")
      .map((n) => n.part);

    expect(parts.length).toBeGreaterThan(0);
    expect(new Set(parts)).toEqual(new Set(["7400"]));
    expect(verify(doc, fn).ok).toBe(true);
  });

  it("a NOR-only build really is nothing but 7402s", () => {
    const fn = fnOf("F(A,B,C) = A'B + BC");
    const doc = realize(
      technologyMap(minimizeFor(fn), getConstraint("nor-only").strategy),
    );
    const parts = Object.values(doc.nodes)
      .filter((n) => n.kind === "ic")
      .map((n) => n.part);
    expect(new Set(parts)).toEqual(new Set(["7402"]));
    expect(verify(doc, fn).ok).toBe(true);
  });
});

function minimizeFor(fn: BooleanFunction) {
  return synthesize(minimize(fn, "sop").expression, fn.variables);
}
