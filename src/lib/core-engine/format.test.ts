import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { format, formatSigma, needsParens } from "./format";
import { children, collectVariables, isNary, literalCount, mkConst, mkNary, mkNot, mkVar } from "./ast";
import { parse } from "./parser";
import { evaluate } from "./evaluate";
import { arbExpr, arbVariables } from "./testing/arbitraries";
import type { Expr } from "./ast";

const SPAN = { start: 0, end: 0 };
const v = (n: string): Expr => mkVar(n, SPAN);
const exprOf = (src: string): Expr => {
  const r = parse(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value.ast;
};

describe("format", () => {
  it("uses a postfix prime on atoms and parenthesizes anything else", () => {
    expect(format(exprOf("A'"))).toBe("A'");
    expect(format(exprOf("(A + B)'"))).toBe("(A + B)'");
    expect(format(mkNot(mkConst(1, SPAN), SPAN))).toBe("1'");
  });

  it("parenthesizes only where precedence requires it", () => {
    expect(format(exprOf("A + B*C"))).toBe("A + B·C"); // AND binds tighter
    expect(format(exprOf("(A + B)*C"))).toBe("(A + B)·C"); // …so this needs parens
    expect(format(exprOf("A ^ B + C"))).toBe("A ⊕ B + C");
    expect(format(exprOf("A * (B ^ C)"))).toBe("A·(B ⊕ C)");
  });

  it("renders constants and word operators", () => {
    expect(format(exprOf("1"))).toBe("1");
    expect(format(exprOf("A NAND B"))).toBe("A NAND B");
    expect(format(exprOf("A NOR B"))).toBe("A NOR B");
    expect(format(exprOf("A XNOR B"))).toBe("A XNOR B");
  });

  it("has an ascii notation for copy-paste", () => {
    expect(format(exprOf("A*B + C"), "ascii")).toBe("A*B + C");
    expect(format(exprOf("A ^ B"), "ascii")).toBe("A ^ B");
  });

  it("formats a sigma summary", () => {
    expect(formatSigma("F", ["A", "B"], [1, 2], [])).toBe("F(A, B) = Σm(1, 2)");
    expect(formatSigma("F", ["A", "B"], [1], [3])).toBe("F(A, B) = Σm(1) + d(3)");
  });

  it("exposes its parenthesization rule", () => {
    const or = mkNary("or", [v("A"), v("B")], SPAN);
    const and = mkNary("and", [v("A"), v("B")], SPAN);
    expect(needsParens(or, and)).toBe(true); // OR inside AND needs parens
    expect(needsParens(and, or)).toBe(false); // AND inside OR does not
    expect(needsParens(v("A"), or)).toBe(false); // an atom never does
  });

  /**
   * REGRESSION. NAND/NOR/XNOR are not associative, so an n-ary one must NOT be
   * printed as an infix chain: `NAND(a,b,c)` is a 3-input NAND — `NOT(a·b·c)` —
   * but the text "a NAND b NAND c" re-parses as the left-nested
   * `(a NAND b) NAND c`, which disagrees on half the rows.
   *
   * The property test below caught this; these pin the exact shapes.
   */
  it("never prints a non-associative n-ary node as an infix chain", () => {
    const three = (op: "nand" | "nor" | "xnor") =>
      format(mkNary(op, [v("A"), v("B"), v("C")], SPAN));

    expect(three("nand")).toBe("(A·B·C)'");
    expect(three("nor")).toBe("(A + B + C)'");
    expect(three("xnor")).toBe("(A ⊕ B ⊕ C)'");
  });

  it("parenthesizes a same-precedence child unless it is the same associative op", () => {
    // NOR sits at the OR level. Printing OR(A, NOR(B,C)) as "A + B NOR C" would
    // re-parse as NOR(OR(A,B), C) — a different function.
    const nested = mkNary(
      "or",
      [v("A"), mkNary("nor", [v("B"), v("C")], SPAN)],
      SPAN,
    );
    expect(format(nested)).toBe("A + (B NOR C)");

    // Right-nested NAND needs the parens; the parser is left-associative.
    const rightNand = mkNary(
      "nand",
      [v("A"), mkNary("nand", [v("B"), v("C")], SPAN)],
      SPAN,
    );
    expect(format(rightNand)).toBe("A NAND (B NAND C)");

    // But a same associative op still flattens, because the parser rebuilds it.
    const flat = mkNary("or", [v("A"), mkNary("or", [v("B"), v("C")], SPAN)], SPAN);
    expect(format(flat)).toBe("A + B + C");
  });

  /**
   * The property that makes format() safe to use anywhere: whatever it emits must
   * re-parse to the SAME FUNCTION. If it ever under-parenthesizes, the round trip
   * silently changes the meaning — and this is what caught the two bugs above.
   */
  it("always re-parses to the same function", () => {
    fc.assert(
      fc.property(
        arbVariables(1, 3).chain((vars) => arbExpr(vars).map((ast) => ({ vars, ast }))),
        ({ vars, ast }) => {
          const reparsed = parse(format(ast));
          expect(reparsed.ok).toBe(true);
          if (!reparsed.ok) return;

          for (let m = 0; m < 1 << vars.length; m++) {
            const env = new Map<string, 0 | 1>(
              vars.map((name, i) => [
                name,
                ((m >>> (vars.length - 1 - i)) & 1) as 0 | 1,
              ]),
            );
            expect(evaluate(reparsed.value.ast, env)).toBe(evaluate(ast, env));
          }
        },
      ),
      { numRuns: 250 },
    );
  });
});

describe("ast helpers", () => {
  it("walks children of every node kind", () => {
    expect(children(v("A"))).toEqual([]);
    expect(children(mkConst(0, SPAN))).toEqual([]);
    expect(children(mkNot(v("A"), SPAN))).toHaveLength(1);
    expect(children(exprOf("A + B + C"))).toHaveLength(3);
    expect(children(exprOf("A NAND B"))).toHaveLength(2);
  });

  it("collects variables in first-appearance order, deduplicated", () => {
    expect(collectVariables(exprOf("C + A*C + B"))).toEqual(["C", "A", "B"]);
  });

  it("counts literals, ignoring constants", () => {
    expect(literalCount(exprOf("A'B + BC"))).toBe(4);
    expect(literalCount(exprOf("1"))).toBe(0);
    expect(literalCount(exprOf("A + 1"))).toBe(1);
  });

  it("identifies n-ary nodes", () => {
    expect(isNary(exprOf("A + B"))).toBe(true);
    expect(isNary(v("A"))).toBe(false);
    expect(isNary(mkNot(v("A"), SPAN))).toBe(false);
    expect(isNary(mkConst(1, SPAN))).toBe(false);
  });
});
