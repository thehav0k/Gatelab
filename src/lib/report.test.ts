import { describe, expect, it } from "vitest";
import { buildReport } from "./report";
import { realize, synthesize, technologyMap } from "./simulation/synth";
import { placeOnBreadboard } from "./simulation/place";
import { minimize } from "./core-engine/minimizer";
import { parseInput } from "./core-engine/canonical";
import type { BooleanFunction } from "./core-engine/types";

const fnOf = (src: string): BooleanFunction => {
  const r = parseInput(src);
  if (!r.ok) throw new Error("bad");
  return r.value;
};

const built = (src: string) => {
  const fn = fnOf(src);
  return realize(
    technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), "mixed"),
  );
};

describe("buildReport", () => {
  const SRC = "F(A,B,C) = A'B + BC";

  it("derives the algebra even with no circuit built", () => {
    const r = buildReport(SRC, null)!;
    expect(r).not.toBeNull();

    expect(r.sigma).toBe("F(A, B, C) = Σm(2, 3, 7)");
    expect(r.minimal).toBe("A'·B + B·C");
    expect(r.minimalLiterals).toBe(4);
    expect(r.canonicalLiterals).toBe(9);

    expect(r.qmColumns.length).toBeGreaterThan(0);
    expect(r.primeImplicants.length).toBeGreaterThan(0);
    expect(r.designs.some((d) => d.includes("NAND-only"))).toBe(true);

    // Nothing was built, so there is nothing to verify or fault.
    expect(r.verification).toBeNull();
    expect(r.faults).toEqual([]);
    expect(r.circuit).toBeNull();
  });

  it("marks the essential prime implicants", () => {
    const r = buildReport("F(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)", null)!;
    expect(r.primeImplicants.some((p) => p.essential)).toBe(true);
  });

  /**
   * The report is a DERIVATION, not a screenshot: it is recomputed from the same
   * engine the screen used. So a correct circuit must report as verified, with a
   * bill of materials that matches what is actually on the board.
   */
  it("verifies the circuit the student built, and bills its chips", () => {
    const r = buildReport(SRC, built(SRC))!;

    expect(r.verification?.ok).toBe(true);
    expect(r.verification?.rows).toHaveLength(8);
    expect(r.faults.filter((f) => f.severity === "error")).toEqual([]);

    expect(r.billOfMaterials.length).toBeGreaterThan(0);
    expect(r.chosenDesign).toMatch(/IC/);
    expect(r.billOfMaterials.every((b) => b.count > 0)).toBe(true);
  });

  it("reports a wrong circuit as wrong, with the reason", () => {
    // Build the circuit for a DIFFERENT function, then report it against this one.
    const r = buildReport(SRC, built("F(A,B,C) = Σm(0,1)"))!;
    expect(r.verification?.ok).toBe(false);
    expect(r.verification?.mismatches.length).toBeGreaterThan(0);
  });

  it("handles a circuit seated on a breadboard", () => {
    const r = buildReport(SRC, placeOnBreadboard(built(SRC)).doc)!;
    expect(r.onBoard).toBe(true);
    expect(r.verification?.ok).toBe(true);
  });

  it("includes the timing sweep, so a hazard shows up in the report", () => {
    const hazard = buildReport("F(A,B,C) = A*C' + B*C", built("F(A,B,C) = A*C' + B*C"))!;
    expect(hazard.timing).not.toBeNull();
    expect(hazard.timing!.glitches.length).toBeGreaterThan(0);
  });

  it("returns null rather than a half-report when the expression will not parse", () => {
    expect(buildReport("A + +", null)).toBeNull();
  });

  it("has no chip options for a constant function", () => {
    const r = buildReport("F(A,B) = Σm(0,1,2,3)", null)!;
    expect(r.designs).toEqual([]);
  });
});
