import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkCompleteness } from "./completeness";
import { rewriteToSet } from "./rewrite";
import { realize, synthesize, technologyMap } from "./synth";
import { verify } from "./verify";
import { parseInput } from "@/lib/core-engine/canonical";
import { minimize } from "@/lib/core-engine/minimizer";
import { arbFunction } from "@/lib/core-engine/testing/arbitraries";
import type { GateOp } from "./logic";
import type { BooleanFunction } from "@/lib/core-engine/types";

const fnOf = (src: string): BooleanFunction => {
  const r = parseInput(src);
  if (!r.ok) throw new Error("bad");
  return r.value;
};

const complete = (ops: GateOp[]) => checkCompleteness(ops).complete;

describe("Post's criterion — which gate sets can build anything", () => {
  it("the universal singletons", () => {
    expect(complete(["nand"])).toBe(true);
    expect(complete(["nor"])).toBe(true);
  });

  it("the classic complete sets", () => {
    expect(complete(["and", "or", "not"])).toBe(true);
    expect(complete(["and", "not"])).toBe(true);
    expect(complete(["or", "not"])).toBe(true);
  });

  /**
   * XOR ALONE IS NOT ENOUGH, and this is the case that matters most: a student
   * told "build it with XOR" would search forever. XOR is AFFINE — a XOR of its
   * inputs plus a constant — and affine functions are closed under composition.
   * No arrangement of them will ever produce an AND.
   */
  it("rejects XOR alone, and says why", () => {
    const r = checkCompleteness(["xor"]);
    expect(r.complete).toBe(false);
    expect(r.trappedIn).toContain("A");
    expect(r.reason).toMatch(/affine/i);
  });

  it("rejects XNOR alone too — same reason", () => {
    expect(checkCompleteness(["xnor"]).trappedIn).toContain("A");
  });

  /**
   * AND and OR are MONOTONE: turning an input on can never turn the output off.
   * So no combination of them can ever invert anything.
   */
  it("rejects AND + OR — monotone, so no inverter", () => {
    const r = checkCompleteness(["and", "or"]);
    expect(r.complete).toBe(false);
    expect(r.trappedIn).toContain("M");
    expect(r.reason).toMatch(/monotone/i);
  });

  it("rejects a lone AND, OR, or NOT", () => {
    expect(complete(["and"])).toBe(false);
    expect(complete(["or"])).toBe(false);
    expect(complete(["not"])).toBe(false);
  });

  it("rejects the empty set", () => {
    expect(checkCompleteness([]).complete).toBe(false);
  });

  /**
   * THE CASE THE POWER RAILS DECIDE.
   *
   * {XOR, AND} is trapped in T0 on its own — both gates output 0 for all-zero
   * inputs, so no circuit built from them can ever be 1 there. But the lab has a
   * +5V rail, and a constant 1 is not 0-preserving. With the rail, the set is
   * complete. Ignoring the rails would tell a student their buildable circuit is
   * impossible.
   */
  it("{XOR, AND} is incomplete WITHOUT constants and complete WITH them", () => {
    expect(checkCompleteness(["xor", "and"], false).complete).toBe(false);
    expect(checkCompleteness(["xor", "and"], false).trappedIn).toContain("T0");

    expect(checkCompleteness(["xor", "and"], true).complete).toBe(true);
  });

  it("agrees with itself: a superset of a complete set is complete", () => {
    fc.assert(
      fc.property(
        fc.subarray<GateOp>(["and", "or", "not", "nand", "nor", "xor", "xnor"]),
        (extra) => {
          expect(complete(["nand", ...extra])).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("rewriting into an arbitrary allowed set", () => {
  const SETS: GateOp[][] = [
    ["nand"],
    ["nor"],
    ["and", "or", "not"],
    ["or", "not"],
    ["and", "not"],
    ["nand", "xor"],
    ["xor", "and"],
    ["and", "or", "not", "nand", "nor"], // "no XOR"
  ];

  it.each(SETS.map((s) => [s.join("+"), s] as const))(
    "%s: every gate emitted is in the allowed set",
    (_name, allowed) => {
      const fn = fnOf("F(A,B,C) = A'B + BC");
      const nl = synthesize(minimize(fn, "sop").expression, fn.variables);
      const r = rewriteToSet(nl, allowed);

      expect(r.ok, r.error ?? "").toBe(true);
      for (const g of r.netlist.gates) {
        expect(allowed, `emitted a ${g.op}`).toContain(g.op);
      }
    },
  );

  /**
   * THE ACCEPTANCE GATE. A circuit built under an arbitrary rule must still
   * compute the right function — including the ones that need the power rails to
   * make an inverter out of XOR.
   */
  it.each(SETS.map((s) => [s.join("+"), s] as const))(
    "%s: the built circuit still verifies",
    (_name, allowed) => {
      for (const src of ["F(A,B) = A*B", "F(A,B,C) = A'B + BC", "F(A,B) = A ^ B"]) {
        const fn = fnOf(src);
        const nl = synthesize(minimize(fn, "sop").expression, fn.variables);
        const doc = realize(technologyMap(nl, "mixed", allowed), { discrete: true });

        const result = verify(doc, fn);
        expect(result.error, `${src}`).toBeNull();
        expect(result.ok, `${src} under ${allowed.join("+")}`).toBe(true);
      }
    },
  );

  it("refuses an impossible set rather than silently producing a wrong circuit", () => {
    const fn = fnOf("F(A,B) = A*B");
    const nl = synthesize(minimize(fn, "sop").expression, fn.variables);

    const r = rewriteToSet(nl, ["xor"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/affine/i);
  });

  it("verifies over random functions under an OR+NOT rule", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 1, maxVars: 3 }), (fn) => {
        const min = minimize(fn, "sop");
        if (min.trace.degenerate) return;

        const nl = synthesize(min.expression, fn.variables);
        const doc = realize(technologyMap(nl, "mixed", ["or", "not"]), {
          discrete: true,
        });
        expect(verify(doc, fn).ok).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});

describe("rewrite edge cases", () => {
  it("passes a BUF through as a double inversion", () => {
    const nl = {
      gates: [{ id: 0, op: "buf" as const, inputs: [0], output: 1 }],
      inputs: [{ name: "A", signal: 0 }],
      outputSignal: 1,
      constant: null,
    };
    const r = rewriteToSet(nl, ["nand"]);
    expect(r.ok).toBe(true);
    expect(r.netlist.gates.every((g) => g.op === "nand")).toBe(true);
  });

  it("rewrites every primitive op into a NOR-only set", () => {
    const ops = ["and", "or", "not", "nand", "nor", "xor", "xnor"] as const;
    for (const op of ops) {
      const arity = op === "not" ? 1 : 2;
      const nl = {
        gates: [{ id: 0, op, inputs: arity === 1 ? [0] : [0, 1], output: 2 }],
        inputs: [
          { name: "A", signal: 0 },
          { name: "B", signal: 1 },
        ],
        outputSignal: 2,
        constant: null,
      };
      const r = rewriteToSet(nl, ["nor"]);
      expect(r.ok, op).toBe(true);
      expect(r.netlist.gates.every((g) => g.op === "nor"), op).toBe(true);
    }
  });

  it("refuses a monotone-only set with the monotone reason", () => {
    const nl = {
      gates: [{ id: 0, op: "not" as const, inputs: [0], output: 1 }],
      inputs: [{ name: "A", signal: 0 }],
      outputSignal: 1,
      constant: null,
    };
    const r = rewriteToSet(nl, ["and", "or"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/monotone/i);
  });
});
