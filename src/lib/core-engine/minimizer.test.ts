import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { minimize, cubeCovers, cubeLabel, cubePattern, type Form } from "./minimizer";
import { parseInput } from "./canonical";
import { truthVector } from "./evaluate";
import { format } from "./format";
import { arbFunction } from "./testing/arbitraries";
import { DONT_CARE, popcount, varMask, type BooleanFunction, type Cube } from "./types";

const fnOf = (src: string): BooleanFunction => {
  const r = parseInput(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value;
};

const sop = (src: string): string => format(minimize(fnOf(src), "sop").expression);

describe("minimize — textbook cases", () => {
  // The classic. Σm(0,1,2,5,6,7) over A,B,C reduces to A'B' + A'C'... let's be
  // precise: the accepted minimal answer is A'C' + AC + ... — pin it by cost and
  // by semantics rather than by a spelling, and check the shape separately.
  it("solves Σm(0,1,2,5,6,7)", () => {
    const fn = fnOf("F(A,B,C) = Σm(0,1,2,5,6,7)");
    const r = minimize(fn);
    // Three 2-literal terms is the known minimum for this function.
    expect(r.cover).toHaveLength(3);
    expect(r.literals).toBe(6);
    expectImplements(r.expression, fn);
  });

  it("solves the 4-variable Σm(0,1,2,5,6,7,8,9,10,14) example", () => {
    const fn = fnOf("F(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)");
    const r = minimize(fn);
    expectImplements(r.expression, fn);
    expect(r.literals).toBeLessThanOrEqual(11);
  });

  it("finds the single 1-literal answer for a half-covered function", () => {
    // A alone: minterms 4,5,6,7 of ABC.
    expect(sop("F(A,B,C) = Σm(4,5,6,7)")).toBe("A");
  });

  it("uses don't-cares to grow a cube it otherwise could not", () => {
    // Σm(1) with d(0) over A,B: m1=A'B, m0=A'B'. Together they form A'.
    expect(sop("F(A,B) = Σm(1) + d(0)")).toBe("A'");
    // Without the don't-care, the answer must stay A'B.
    expect(sop("F(A,B) = Σm(1)")).toBe("A'·B");
  });
});

describe("minimize — degenerate cases", () => {
  it("returns the constant 0 for a function with no minterms", () => {
    const r = minimize(fnOf("F(A,B) = Σm()"));
    expect(format(r.expression)).toBe("0");
    expect(r.trace.degenerate).toBe("always-false");
  });

  it("returns the constant 1 for a tautology", () => {
    const r = minimize(fnOf("F(A,B) = Σm(0,1,2,3)"));
    expect(format(r.expression)).toBe("1");
    expect(r.trace.degenerate).toBe("always-true");
    expect(r.literals).toBe(0);
  });

  it("handles a single minterm", () => {
    expect(sop("F(A,B,C) = Σm(5)")).toBe("A·B'·C");
  });

  it("treats an all-don't-care function as always-false", () => {
    const r = minimize(fnOf("F(A,B) = Σm() + d(0,1,2,3)"));
    expect(r.trace.degenerate).toBe("always-false");
  });
});

describe("minimize — don't-cares are merge fuel, not obligations", () => {
  const fn = fnOf("F(A,B,C) = Σm(1,3) + d(5,7)");
  const r = minimize(fn);

  // Pitfall #6, half one. Don't-cares must take part in the tabulation so cubes
  // can grow — but they must never become COLUMNS of the PI chart, because
  // nothing is obliged to cover them.
  it("never lists a don't-care as a chart column", () => {
    expect(r.trace.chart.columns).toEqual([1, 3]);
    expect(r.trace.chart.columns).not.toContain(5);
    expect(r.trace.chart.columns).not.toContain(7);
  });

  it("still lets a don't-care enlarge the cube", () => {
    // m1,m3 alone give A'C. With d(5,7) the cube grows to just C.
    expect(format(r.expression)).toBe("C");
  });

  // Pitfall #6, other half. A prime implicant made only of don't-cares covers no
  // obligation at all, so it must be discarded — keeping it lets the cover
  // search "spend" a term on nothing.
  it("discards a prime implicant built only from don't-cares", () => {
    const g = fnOf("F(A,B,C) = Σm(0) + d(6,7)");
    const m = minimize(g);
    const labels = m.trace.primeImplicants.map((c) => cubeLabel(c, g.variables));
    // AB covers only the don't-cares 6 and 7 — it must not survive as a PI.
    expect(labels).not.toContain("A·B");
    expect(labels).not.toContain("AB");
    expectImplements(m.expression, g);
  });
});

describe("minimize — the cyclic chart (Petrick's method)", () => {
  // Σm(0,1,2,5,6,7) over 3 variables has no essential prime implicants: every
  // minterm is covered by exactly two PIs. This is the case a naive
  // essential-PI-only implementation silently fails on.
  const fn = fnOf("F(A,B,C) = Σm(0,1,2,5,6,7)");
  const r = minimize(fn);

  it("finds no essential prime implicants", () => {
    expect(r.trace.essentials).toHaveLength(0);
  });

  it("falls through to Petrick and still covers everything", () => {
    expect(r.trace.petrick).not.toBeNull();
    expect(r.trace.petrick?.exhausted).toBe(false);
    expectImplements(r.expression, fn);
  });

  it("reports the equally-minimal alternative covers rather than hiding them", () => {
    // This function has two distinct 3-term minimal covers.
    expect(r.alternativeCovers.length).toBeGreaterThanOrEqual(1);
    for (const alt of r.alternativeCovers) {
      expect(coverCost(alt)).toBe(coverCost(r.cover));
    }
  });

  it("does not flag an approximation when the exact search succeeded", () => {
    expect(r.trace.approximated).toBe(false);
  });
});

describe("minimize — POS", () => {
  it("produces a product of sums that implements the function", () => {
    const fn = fnOf("F(A,B,C) = Σm(0,1,2,5,6,7)");
    const r = minimize(fn, "pos");
    expectImplements(r.expression, fn);
    expect(r.form).toBe("pos");
  });

  it("De Morgans the complement's cubes into sum terms", () => {
    // F = A (minterms 4..7 of ABC). F' = A'. POS form is therefore just (A).
    const fn = fnOf("F(A,B,C) = Σm(4,5,6,7)");
    expect(format(minimize(fn, "pos").expression)).toBe("A");
  });

  it("agrees with SOP on every row", () => {
    const fn = fnOf("F(A,B,C,D) = Σm(1,3,7,11,15)");
    const asSop = truthVector(minimize(fn, "sop").expression, fn.variables);
    const asPos = truthVector(minimize(fn, "pos").expression, fn.variables);
    expect([...asSop]).toEqual([...asPos]);
  });
});

describe("minimize — the trace is the product", () => {
  const fn = fnOf("F(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)");
  const r = minimize(fn);

  it("captures every combining column", () => {
    expect(r.trace.columns.length).toBeGreaterThanOrEqual(2);
    expect(r.trace.columns[0]?.groups.length).toBeGreaterThan(1);
  });

  it("groups column 0 by population count", () => {
    for (const g of r.trace.columns[0]?.groups ?? []) {
      for (const e of g.entries) {
        expect(popcount(e.cube.bits & e.cube.care)).toBe(g.ones);
      }
    }
  });

  it("records which variable each merge eliminated", () => {
    const merges = r.trace.columns[0]?.merges ?? [];
    expect(merges.length).toBeGreaterThan(0);
    for (const m of merges) {
      expect(fn.variables).toContain(m.eliminated);
      // The merged cube constrains exactly one fewer variable than its parents.
      expect(popcount(m.into.care)).toBe(popcount(m.from[0].care) - 1);
    }
  });

  it("marks a term as prime exactly when it never combined", () => {
    const uncombined = r.trace.columns
      .flatMap((c) => c.groups)
      .flatMap((g) => g.entries)
      .filter((e) => !e.combined && !e.isDontCareOnly);
    for (const e of uncombined) {
      expect(r.trace.primeImplicants.map(key)).toContain(key(e.cube));
    }
  });

  it("renders cubes as QM binary patterns with dashes", () => {
    expect(cubePattern({ care: 0b1101, bits: 0b1001, covers: [] }, 4)).toBe("10-1");
  });
});

describe("minimize — properties", () => {
  // THE property. If minimization changes the function on any care row, this
  // catches it — bad combining, a dropped implicant, a wrong essential-PI
  // extraction, a botched Petrick expansion. It is worth more than every
  // example-based test above put together.
  it.each<Form>(["sop", "pos"])(
    "%s minimization preserves the function on every care row",
    (form) => {
      fc.assert(
        fc.property(arbFunction({ minVars: 1, maxVars: 4 }), (fn) => {
          const r = minimize(fn, form);
          const got = truthVector(r.expression, fn.variables);
          for (let m = 0; m < fn.values.length; m++) {
            if (fn.values[m] === DONT_CARE) continue; // free choice, by definition
            expect(got[m], `row ${m} of ${form}`).toBe(fn.values[m]);
          }
        }),
        { numRuns: 400 },
      );
    },
  );

  it("every cube in the cover is an implicant — it never covers a 0 row", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 1, maxVars: 4 }), (fn) => {
        const r = minimize(fn);
        if (r.trace.degenerate) return;
        for (const cube of r.cover) {
          for (let m = 0; m < fn.values.length; m++) {
            if (cubeCovers(cube, m)) expect(fn.values[m]).not.toBe(0);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("every prime implicant is actually prime — no literal can be dropped", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 2, maxVars: 4 }), (fn) => {
        const r = minimize(fn);
        const n = fn.variables.length;

        for (const pi of r.trace.primeImplicants) {
          for (let i = 0; i < n; i++) {
            const mask = varMask(i, n);
            if ((pi.care & mask) === 0) continue;

            // Drop one literal. The result must NOT be an implicant, or `pi` was
            // never prime in the first place.
            const grown: Cube = { care: pi.care & ~mask, bits: pi.bits & ~mask, covers: [] };
            const stillImplicant = allCovered(grown, fn);
            expect(stillImplicant, `${cubeLabel(pi, fn.variables)} is not prime`).toBe(
              false,
            );
          }
        }
      }),
      { numRuns: 250 },
    );
  });

  it("no prime implicant is subsumed by another", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 2, maxVars: 4 }), (fn) => {
        const pis = minimize(fn).trace.primeImplicants;
        for (const a of pis) {
          for (const b of pis) {
            if (key(a) === key(b)) continue;
            // b subsumes a iff b's constraints are a subset of a's and agree.
            const subsumes =
              (b.care & a.care) === b.care &&
              (b.bits & b.care) === (a.bits & b.care);
            expect(subsumes, `${key(b)} subsumes ${key(a)}`).toBe(false);
          }
        }
      }),
      { numRuns: 250 },
    );
  });

  // Independent oracle for the covering step: brute-force the true minimum over
  // all subsets of the prime implicants and check we matched it.
  it("achieves the exhaustive minimum cost for small functions", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 2, maxVars: 3 }), (fn) => {
        const r = minimize(fn);
        if (r.trace.degenerate) return;

        const pis = r.trace.primeImplicants;
        if (pis.length > 14) return; // 2^14 subsets is plenty; skip the rare blowup

        const need = [];
        for (let m = 0; m < fn.values.length; m++) {
          if (fn.values[m] === 1) need.push(m);
        }

        let bestCost = Infinity;
        for (let mask = 0; mask < 1 << pis.length; mask++) {
          const subset = pis.filter((_, i) => (mask >>> i) & 1);
          if (!need.every((m) => subset.some((c) => cubeCovers(c, m)))) continue;
          bestCost = Math.min(bestCost, coverCost(subset));
        }

        expect(coverCost(r.cover)).toBe(bestCost);
      }),
      { numRuns: 200 },
    );
  });
});

// --- helpers ---------------------------------------------------------------

const key = (c: Cube): string => `${c.care}:${c.bits & c.care}`;

/** Gate-input cost: literals + one input per term. Mirrors the minimizer's metric. */
const coverCost = (cover: readonly Cube[]): number =>
  cover.reduce((s, c) => s + popcount(c.care), 0) + cover.length;

/** Does `cube` cover only 1s and don't-cares (i.e. is it an implicant)? */
function allCovered(cube: Cube, fn: BooleanFunction): boolean {
  for (let m = 0; m < fn.values.length; m++) {
    if (cubeCovers(cube, m) && fn.values[m] === 0) return false;
  }
  return true;
}

function expectImplements(expr: Parameters<typeof truthVector>[0], fn: BooleanFunction): void {
  const got = truthVector(expr, fn.variables);
  for (let m = 0; m < fn.values.length; m++) {
    if (fn.values[m] === DONT_CARE) continue;
    expect(got[m], `row ${m}`).toBe(fn.values[m]);
  }
}
