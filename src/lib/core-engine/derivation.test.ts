import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { deriveSteps, truthRows } from "./derivation";
import { analyze } from "./index";
import { arbFunction } from "./testing/arbitraries";
import { minimize } from "./minimizer";

const stepsFor = (src: string) => {
  const r = analyze(src);
  if (!r.ok) throw new Error("bad");
  return deriveSteps(r.value.fn, r.value.sop);
};

describe("deriveSteps", () => {
  it("walks the classic derivation in order", () => {
    const steps = stepsFor("F(A,B,C) = Σm(2,3,7)");
    const titles = steps.map((s) => s.title);

    expect(titles[0]).toMatch(/rows where the function is 1/i);
    expect(titles).toContain("Write it out the long way");
    expect(titles).toContain("Combine terms that differ in one variable");
    expect(titles).toContain("Collect the prime implicants");
    expect(titles[titles.length - 2] ?? titles[titles.length - 1]).toBeTruthy();

    const answer = steps.find((s) => s.title === "The minimal sum of products");
    expect(answer?.result).toBe("F = A'·B + B·C");
    expect(answer?.note).toMatch(/down from/);
  });

  it("numbers the steps consecutively from 1", () => {
    const steps = stepsFor("F(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)");
    expect(steps.map((s) => s.n)).toEqual(steps.map((_, i) => i + 1));
  });

  it("spells out the combining rule with the variable that cancels", () => {
    const steps = stepsFor("F(A,B) = Σm(2,3)"); // A·B' + A·B = A
    const combine = steps.find((s) => s.title.startsWith("Combine"))!;
    expect(combine.explain).toMatch(/XY \+ XY' = X/);
    expect(combine.rows?.[0]).toMatch(/B cancels/);
  });

  it("names the essential prime implicant and the row that forces it", () => {
    const steps = stepsFor("F(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)");
    const essential = steps.find((s) => s.title.startsWith("Find the ones"))!;
    expect(essential.rows?.length).toBeGreaterThan(0);
    expect(essential.rows?.[0]).toMatch(/only term covering m\d+/);
  });

  /**
   * A cyclic chart has NO essential prime implicants — every minterm is covered
   * twice. The derivation has to say so, rather than silently skipping the step.
   */
  it("says so when nothing is essential", () => {
    const steps = stepsFor("F(A,B,C) = Σm(0,1,2,5,6,7)");
    const s = steps.find((x) => x.title === "No term is forced");
    expect(s).toBeDefined();
    expect(s?.explain).toMatch(/cyclic/i);
    expect(s?.note).toMatch(/petrick/i);
  });

  it("explains don't-cares as a freedom, not an obligation", () => {
    const steps = stepsFor("F(A,B,C) = Σm(1) + d(0)");
    expect(steps[0]?.note).toMatch(/DON'T-CARES/);
    expect(steps[0]?.note).toMatch(/free to choose/i);
  });

  it("handles the constant functions without pretending to minimize them", () => {
    const zero = stepsFor("F(A,B) = Σm()");
    expect(zero.at(-1)?.result).toBe("F = 0");

    const one = stepsFor("F(A,B) = Σm(0,1,2,3)");
    expect(one.at(-1)?.result).toBe("F = 1");
  });

  it("never throws, whatever the function", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 1, maxVars: 4 }), (fn) => {
        const steps = deriveSteps(fn, minimize(fn, "sop"));
        expect(steps.length).toBeGreaterThan(0);
        expect(steps.every((s) => s.title && s.explain)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});

describe("truthRows", () => {
  it("enumerates the inputs under the MSB contract", () => {
    const r = analyze("F(A,B,C) = Σm(4)");
    if (!r.ok) throw new Error("bad");
    const rows = truthRows(r.value.fn);

    expect(rows).toHaveLength(8);
    expect(rows[4]?.inputs).toEqual([1, 0, 0]); // A is the MSB
    expect(rows[4]?.output).toBe(1);
    expect(rows[0]?.output).toBe(0);
  });
});
