import { describe, expect, it } from "vitest";
import { parse } from "./parser";
import { format } from "./format";
import { evaluate } from "./evaluate";
import type { Expr } from "./ast";

/** Parse and re-emit, which is a compact way to assert the tree's shape. */
const shape = (src: string): string => {
  const r = parse(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return show(r.value.ast);
};

/** Fully parenthesized s-expression — no precedence assumptions in the assertion. */
function show(e: Expr): string {
  switch (e.kind) {
    case "var":
      return e.name;
    case "const":
      return String(e.value);
    case "not":
      return `!${show(e.operand)}`;
    default:
      return `(${e.kind} ${e.operands.map(show).join(" ")})`;
  }
}

const errorOf = (src: string): string => {
  const r = parse(src);
  if (r.ok) throw new Error(`expected "${src}" to fail`);
  return r.diagnostics[0]?.code ?? "";
};

describe("parse — precedence", () => {
  it("binds NOT tighter than AND, AND tighter than XOR, XOR tighter than OR", () => {
    expect(shape("A + B * C")).toBe("(or A (and B C))");
    expect(shape("A * B + C")).toBe("(or (and A B) C)");
    expect(shape("A * B ^ C * D")).toBe("(xor (and A B) (and C D))");
    expect(shape("A ^ B + C")).toBe("(or (xor A B) C)");
    expect(shape("A' * B")).toBe("(and !A B)");
  });

  it("flattens associative chains into one n-ary node", () => {
    expect(shape("A + B + C")).toBe("(or A B C)");
    expect(shape("A * B * C")).toBe("(and A B C)");
    expect(shape("A ^ B ^ C")).toBe("(xor A B C)");
  });

  // NAND is not associative: (A NAND B) NAND C differs from A NAND (B NAND C).
  // Flattening it would silently change the function.
  it("keeps non-associative operators left-nested and binary", () => {
    expect(shape("A NAND B NAND C")).toBe("(nand (nand A B) C)");
    expect(shape("A NOR B NOR C")).toBe("(nor (nor A B) C)");
  });

  it("treats a mixed level as left-associative", () => {
    expect(shape("A + B NOR C")).toBe("(nor (or A B) C)");
  });

  it("parenthesizes to override precedence", () => {
    expect(shape("(A + B) * C")).toBe("(and (or A B) C)");
  });
});

describe("parse — implicit AND", () => {
  it("reads juxtaposition as a product", () => {
    expect(shape("AB")).toBe("(and A B)");
    expect(shape("A'B")).toBe("(and !A B)");
    expect(shape("A(B + C)")).toBe("(and A (or B C))");
    expect(shape("(A)(B)")).toBe("(and A B)");
    expect(shape("AB + BC")).toBe("(or (and A B) (and B C))");
  });

  it("mixes implicit and explicit AND in one term", () => {
    expect(shape("AB * C")).toBe("(and A B C)");
  });
});

describe("parse — postfix and prefix NOT", () => {
  it("applies a prime to the atom, and to a parenthesized group", () => {
    expect(shape("A'")).toBe("!A");
    expect(shape("(A + B)'")).toBe("!(or A B)");
  });

  it("stacks double negation rather than cancelling it (that is the minimizer's job)", () => {
    expect(shape("A''")).toBe("!!A");
    expect(shape("!!A")).toBe("!!A");
  });
});

describe("parse — headers", () => {
  it("accepts a bare name", () => {
    const r = parse("F = A + B");
    expect(r.ok && r.value.name).toBe("F");
    expect(r.ok && r.value.declaredVariables).toBeNull();
  });

  // Arity is not inferable from the body: this function has three variables and
  // mentions two. The header is the only place the truth can come from.
  it("captures a declared variable list, including unused variables", () => {
    const r = parse("F(A,B,C) = A + B");
    expect(r.ok && r.value.declaredVariables).toEqual(["A", "B", "C"]);
  });
});

describe("parse — errors are data with spans", () => {
  it("reports a dangling operator", () => {
    expect(errorOf("A +")).toBe("unexpected-end");
    expect(errorOf("A + + B")).toBe("missing-operand");
  });

  it("reports unbalanced parentheses on both sides", () => {
    expect(errorOf("(A + B")).toBe("unbalanced-paren");
    expect(errorOf("A + B)")).toBe("unbalanced-paren");
  });

  it("reports an empty expression", () => {
    expect(errorOf("   ")).toBe("empty-expression");
  });

  it("points at the offending span, not the whole line", () => {
    const r = parse("A + )");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.diagnostics[0]?.span).toEqual({ start: 4, end: 5 });
  });
});

describe("format round-trip", () => {
  const cases = [
    "A'B + BC'",
    "(A + B)(C + D)",
    "A ^ B ^ C",
    "A + B * C",
    "(A + B) * C",
    "A NAND B NAND C",
    "A'",
    "AB + A'C + BC",
  ];

  // format() must parenthesize by precedence. If it under-parenthesizes, the
  // re-parse produces a different tree and this catches it.
  it.each(cases)("re-parses %s to the same function", (src) => {
    const first = parse(src);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = parse(format(first.value.ast));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const vars = ["A", "B", "C", "D"];
    for (let m = 0; m < 1 << vars.length; m++) {
      const env = new Map<string, 0 | 1>(
        vars.map((v, i) => [v, ((m >>> (vars.length - 1 - i)) & 1) as 0 | 1]),
      );
      expect(evaluate(second.value.ast, env)).toBe(
        evaluate(first.value.ast, env),
      );
    }
  });
});
