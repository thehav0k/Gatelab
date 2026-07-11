import { describe, expect, it } from "vitest";
import { envForMinterm, evaluate, truthVector } from "./evaluate";
import { mkConst, mkNary, mkNot, mkVar, type Expr } from "./ast";
import { bitOf } from "./types";

const SPAN = { start: 0, end: 0 };
const v = (n: string): Expr => mkVar(n, SPAN);
const not = (e: Expr): Expr => mkNot(e, SPAN);
const nary = (k: Parameters<typeof mkNary>[0], ...ops: Expr[]): Expr =>
  mkNary(k, ops, SPAN);

const env = (bits: Record<string, 0 | 1>): Map<string, 0 | 1> =>
  new Map(Object.entries(bits) as [string, 0 | 1][]);

describe("evaluate — the golden oracle", () => {
  // Hand-verified against the definitions. Everything else in the engine is
  // property-tested against this function, so it gets checked by eye.
  it("computes every 2-input gate exhaustively", () => {
    const table: Record<string, [0 | 1, 0 | 1, 0 | 1, 0 | 1]> = {
      // A,B =        0,0  0,1  1,0  1,1
      and: [0, 0, 0, 1],
      or: [0, 1, 1, 1],
      xor: [0, 1, 1, 0],
      nand: [1, 1, 1, 0],
      nor: [1, 0, 0, 0],
      xnor: [1, 0, 0, 1],
    };

    for (const [op, expected] of Object.entries(table)) {
      const e = nary(op as Parameters<typeof mkNary>[0], v("A"), v("B"));
      const got = [
        evaluate(e, env({ A: 0, B: 0 })),
        evaluate(e, env({ A: 0, B: 1 })),
        evaluate(e, env({ A: 1, B: 0 })),
        evaluate(e, env({ A: 1, B: 1 })),
      ];
      expect(got, op).toEqual(expected);
    }
  });

  it("reads n-ary XOR as parity", () => {
    const e = nary("xor", v("A"), v("B"), v("C"));
    expect(evaluate(e, env({ A: 1, B: 1, C: 1 }))).toBe(1); // three 1s -> odd
    expect(evaluate(e, env({ A: 1, B: 1, C: 0 }))).toBe(0); // two 1s   -> even
  });

  it("reads n-ary NAND as an n-input NAND gate", () => {
    const e = nary("nand", v("A"), v("B"), v("C"));
    expect(evaluate(e, env({ A: 1, B: 1, C: 1 }))).toBe(0);
    expect(evaluate(e, env({ A: 1, B: 1, C: 0 }))).toBe(1);
  });

  it("handles NOT and constants", () => {
    expect(evaluate(not(v("A")), env({ A: 1 }))).toBe(0);
    expect(evaluate(not(not(v("A"))), env({ A: 1 }))).toBe(1);
    expect(evaluate(mkConst(1, SPAN), env({}))).toBe(1);
  });

  it("throws rather than guessing when a variable is missing", () => {
    expect(() => evaluate(v("Z"), env({ A: 1 }))).toThrow(/not in the environment/);
  });
});

describe("envForMinterm — THE MSB CONTRACT", () => {
  // variables[0] is the MOST significant bit. Getting this backwards produces a
  // truth table that is wrong in a way that still looks plausible, so it is
  // pinned here rather than left to a comment.
  it("puts variables[0] in the high bit", () => {
    const e = envForMinterm(["A", "B", "C"], 0b100);
    expect([e.get("A"), e.get("B"), e.get("C")]).toEqual([1, 0, 0]);
  });

  it("agrees with bitOf for every row", () => {
    const vars = ["A", "B", "C"];
    for (let m = 0; m < 8; m++) {
      const e = envForMinterm(vars, m);
      vars.forEach((name, i) => {
        expect(e.get(name)).toBe(bitOf(m, i, 3));
      });
    }
  });
});

describe("truthVector", () => {
  it("sweeps A'B + BC into the expected rows", () => {
    // A'B + BC over A,B,C. Minterms: A'B -> 010, 011 (2,3). BC -> 011, 111 (3,7).
    const e = nary(
      "or",
      nary("and", not(v("A")), v("B")),
      nary("and", v("B"), v("C")),
    );
    expect([...truthVector(e, ["A", "B", "C"])]).toEqual([0, 0, 1, 1, 0, 0, 0, 1]);
  });
});
