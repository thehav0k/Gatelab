import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  canonicalPos,
  canonicalSop,
  checkEquivalence,
  complement,
  dontCares,
  fromMaxterms,
  fromMinterms,
  fromTruthValues,
  functionKey,
  maxterms,
  minterms,
  parseInput,
} from "./canonical";
import { truthVector } from "./evaluate";
import { arbExpr, arbFunction, arbVariables } from "./testing/arbitraries";
import type { BooleanFunction } from "./types";

const unwrap = (r: ReturnType<typeof parseInput>): BooleanFunction => {
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value;
};

describe("parseInput — the convergence layer", () => {
  it("routes an expression to the expression parser", () => {
    const fn = unwrap(parseInput("A'B + BC"));
    expect(fn.variables).toEqual(["A", "B", "C"]);
    expect(minterms(fn)).toEqual([2, 3, 7]);
  });

  it("routes Σm notation to the notation parser", () => {
    const fn = unwrap(parseInput("F(A,B,C) = Σm(2,3,7)"));
    expect(minterms(fn)).toEqual([2, 3, 7]);
  });

  // The whole point of the convergence layer: three spellings of one function
  // must produce byte-identical truth vectors.
  it("lands the same function on the same vector regardless of input mode", () => {
    const viaExpr = unwrap(parseInput("F(A,B,C) = A'B + BC"));
    const viaSigma = unwrap(parseInput("F(A,B,C) = Σm(2,3,7)"));
    const viaTable = unwrap(
      fromTruthValues(["A", "B", "C"], [0, 0, 1, 1, 0, 0, 0, 1]),
    );

    expect(functionKey(viaExpr)).toBe(functionKey(viaSigma));
    expect(functionKey(viaExpr)).toBe(functionKey(viaTable));
  });
});

describe("notation", () => {
  it("keeps don't-cares distinct from both 1s and 0s", () => {
    const fn = unwrap(parseInput("F(A,B,C) = Σm(0,2,5) + d(6,7)"));
    expect(minterms(fn)).toEqual([0, 2, 5]);
    expect(dontCares(fn)).toEqual([6, 7]);
    expect(maxterms(fn)).toEqual([1, 3, 4]);
  });

  it("inverts the background for ΠM (a maxterm is a row that is 0)", () => {
    const fn = unwrap(parseInput("F(A,B,C) = ΠM(1,3,4)"));
    expect(maxterms(fn)).toEqual([1, 3, 4]);
    expect(minterms(fn)).toEqual([0, 2, 5, 6, 7]);
  });

  it("ΠM(x) and Σm(complement of x) are the same function", () => {
    const viaPi = unwrap(parseInput("F(A,B,C) = ΠM(1,3,4)"));
    const viaSigma = unwrap(parseInput("F(A,B,C) = Σm(0,2,5,6,7)"));
    expect(functionKey(viaPi)).toBe(functionKey(viaSigma));
  });

  it("accepts the ascii spellings", () => {
    expect(minterms(unwrap(parseInput("F(A,B,C) = sum(2,3,7)")))).toEqual([2, 3, 7]);
    expect(minterms(unwrap(parseInput("F(A,B,C) = m(2,3,7)")))).toEqual([2, 3, 7]);
  });

  // Pitfall #2. Σm(0,2,5) is consistent with 3 variables and with 8. We pick the
  // smallest that fits, but we must never do it silently.
  it("warns when it has to guess the variable count", () => {
    const r = parseInput("Σm(0,2,5)");
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain("inferred-arity");
    expect(r.ok && r.value.variables).toEqual(["A", "B", "C"]);
  });

  it("does not guess when the header declares the variables", () => {
    const r = parseInput("F(A,B,C,D) = Σm(0,2,5)");
    expect(r.ok && r.value.variables).toHaveLength(4);
    expect(r.diagnostics.map((d) => d.code)).not.toContain("inferred-arity");
  });

  it("rejects an index that cannot exist at this arity", () => {
    const r = parseInput("F(A,B) = Σm(0,7)");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.diagnostics[0]?.code).toBe("index-out-of-range");
  });

  it("rejects an index claimed as both a term and a don't-care", () => {
    const r = fromMinterms(["A", "B"], [1, 2], [2]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.diagnostics[0]?.code).toBe("conflicting-index");
  });

  it("m( and M( differ only by case, and the case is the operator", () => {
    expect(minterms(unwrap(parseInput("F(A,B) = m(1)")))).toEqual([1]);
    expect(maxterms(unwrap(parseInput("F(A,B) = M(1)")))).toEqual([1]);
  });

  it("does not mistake the expression m(A+B) for notation", () => {
    const fn = unwrap(parseInput("m(A+B)"));
    expect(fn.variables).toEqual(["M", "A", "B"]);
  });
});

describe("arity and variable declarations", () => {
  it("keeps a declared variable the expression never mentions", () => {
    const fn = unwrap(parseInput("F(A,B,C) = A + B"));
    expect(fn.variables).toEqual(["A", "B", "C"]);
    expect(fn.values).toHaveLength(8);
    // C is genuinely irrelevant: rows differing only in C must agree.
    expect(fn.values[0]).toBe(fn.values[1]);
  });

  it("rejects a variable the declaration does not cover", () => {
    const r = parseInput("F(A,B) = A + C");
    expect(r.ok).toBe(false);
  });

  it("rejects more variables than the engine will render", () => {
    const r = parseInput("F(A,B,C,D,E,F,G,H,I,J,K) = A");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.diagnostics[0]?.code).toBe("too-many-variables");
  });
});

describe("canonical forms", () => {
  it("canonicalSop re-evaluates to the original function", () => {
    const fn = unwrap(parseInput("F(A,B,C) = A'B + BC"));
    expect([...truthVector(canonicalSop(fn), fn.variables)]).toEqual([...fn.values]);
  });

  it("canonicalPos re-evaluates to the original function", () => {
    const fn = unwrap(parseInput("F(A,B,C) = A'B + BC"));
    expect([...truthVector(canonicalPos(fn), fn.variables)]).toEqual([...fn.values]);
  });

  it("degenerates to a constant when there are no terms", () => {
    const zero = unwrap(fromMinterms(["A", "B"], []));
    expect(canonicalSop(zero)).toEqual(expect.objectContaining({ kind: "const", value: 0 }));

    const one = unwrap(fromMaxterms(["A", "B"], []));
    expect(canonicalPos(one)).toEqual(expect.objectContaining({ kind: "const", value: 1 }));
  });

  it("complement flips 1 and 0 but leaves don't-cares alone", () => {
    const fn = unwrap(parseInput("F(A,B,C) = Σm(0,2) + d(6,7)"));
    const c = complement(fn);
    expect(minterms(c)).toEqual([1, 3, 4, 5]);
    expect(dontCares(c)).toEqual([6, 7]);
  });
});

describe("checkEquivalence — the lab-grading primitive", () => {
  it("names the rows that disagree", () => {
    const a = unwrap(fromMinterms(["A", "B"], [1, 2]));
    const b = unwrap(fromMinterms(["A", "B"], [1, 3]));
    expect(checkEquivalence(a, b)).toEqual({ equal: false, mismatches: [2, 3] });
  });

  // A don't-care means "we told the student they may choose". Failing them for
  // choosing would be a bug in the grader, not in their circuit.
  it("lets a candidate pick anything on a don't-care row", () => {
    const expected = unwrap(parseInput("F(A,B) = Σm(1) + d(2)"));
    const chose1 = unwrap(fromMinterms(["A", "B"], [1, 2]));
    const chose0 = unwrap(fromMinterms(["A", "B"], [1]));
    expect(checkEquivalence(expected, chose1).equal).toBe(true);
    expect(checkEquivalence(expected, chose0).equal).toBe(true);
  });
});

describe("properties", () => {
  // canonicalSop is a *different* expression from the input, built from the
  // truth vector rather than the AST. If either the vector or the SOP builder is
  // wrong, they disagree.
  it("canonicalSop of any expression round-trips to the same truth vector", () => {
    fc.assert(
      fc.property(
        arbVariables(1, 4).chain((vars) =>
          arbExpr(vars).map((ast) => ({ vars, ast })),
        ),
        ({ vars, ast }) => {
          const values = truthVector(ast, vars);
          const fn = unwrap(
            fromTruthValues(vars, [...values] as (0 | 1)[]),
          );
          expect([...truthVector(canonicalSop(fn), vars)]).toEqual([...values]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("canonicalPos of any function round-trips too", () => {
    fc.assert(
      fc.property(arbFunction({ dontCares: false }), (fn) => {
        expect([...truthVector(canonicalPos(fn), fn.variables)]).toEqual([
          ...fn.values,
        ]);
      }),
      { numRuns: 300 },
    );
  });

  it("complement is an involution", () => {
    fc.assert(
      fc.property(arbFunction(), (fn) => {
        expect([...complement(complement(fn)).values]).toEqual([...fn.values]);
      }),
      { numRuns: 200 },
    );
  });

  it("minterms, maxterms and don't-cares partition every row exactly once", () => {
    fc.assert(
      fc.property(arbFunction(), (fn) => {
        const total =
          minterms(fn).length + maxterms(fn).length + dontCares(fn).length;
        expect(total).toBe(fn.values.length);
      }),
      { numRuns: 200 },
    );
  });
});
