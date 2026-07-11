import type { Span } from "./types";

/**
 * The AST. N-ary rather than strictly binary, because a 3-input AND gate is one
 * gate, not two — keeping `and(a, b, c)` flat means the synthesis pass in M5 can
 * see the real fan-in instead of rediscovering it from a right-leaning chain.
 *
 * Important asymmetry: AND / OR / XOR are associative, so the parser flattens
 * chains of them into a single n-ary node. NAND / NOR / XNOR are **not**
 * associative — `(A NAND B) NAND C` differs from `A NAND (B NAND C)` — so the
 * parser only ever builds them left-nested with exactly two operands. The
 * evaluator's n-ary reading of them (`nand = NOT(AND of all)`) is the
 * multi-input *gate* semantics, which is what a transform wants when it fuses
 * `not(and(a,b,c))` into one NAND3. Both readings agree at arity 2, which is the
 * only arity the parser produces.
 */
export type Expr =
  | ExprVar
  | ExprConst
  | ExprNot
  | ExprNary;

export interface ExprVar {
  readonly kind: "var";
  readonly name: string;
  readonly span: Span;
}

export interface ExprConst {
  readonly kind: "const";
  readonly value: 0 | 1;
  readonly span: Span;
}

export interface ExprNot {
  readonly kind: "not";
  readonly operand: Expr;
  readonly span: Span;
}

export type NaryOp = "and" | "or" | "xor" | "nand" | "nor" | "xnor";

export interface ExprNary {
  readonly kind: NaryOp;
  readonly operands: readonly Expr[];
  readonly span: Span;
}

/** Operators the parser is allowed to flatten. See the note above. */
export const ASSOCIATIVE_OPS = new Set<NaryOp>(["and", "or", "xor"]);

export const isNary = (e: Expr): e is ExprNary =>
  e.kind !== "var" && e.kind !== "const" && e.kind !== "not";

// --- constructors ----------------------------------------------------------

export const mkVar = (name: string, span: Span): ExprVar => ({
  kind: "var",
  name,
  span,
});

export const mkConst = (value: 0 | 1, span: Span): ExprConst => ({
  kind: "const",
  value,
  span,
});

export const mkNot = (operand: Expr, span: Span): ExprNot => ({
  kind: "not",
  operand,
  span,
});

export const mkNary = (
  kind: NaryOp,
  operands: readonly Expr[],
  span: Span,
): ExprNary => ({ kind, operands, span });

export const spanning = (a: Span, b: Span): Span => ({
  start: Math.min(a.start, b.start),
  end: Math.max(a.end, b.end),
});

// --- traversal -------------------------------------------------------------

export function children(e: Expr): readonly Expr[] {
  switch (e.kind) {
    case "var":
    case "const":
      return [];
    case "not":
      return [e.operand];
    case "and":
    case "or":
    case "xor":
    case "nand":
    case "nor":
    case "xnor":
      return e.operands;
  }
}

/** Variable names in first-appearance order, deduplicated. */
export function collectVariables(e: Expr): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (node: Expr): void => {
    if (node.kind === "var" && !seen.has(node.name)) {
      seen.add(node.name);
      out.push(node.name);
    }
    for (const c of children(node)) walk(c);
  };
  walk(e);
  return out;
}

/** Total literal count — the usual cost metric for a minimized expression. */
export function literalCount(e: Expr): number {
  if (e.kind === "var") return 1;
  if (e.kind === "const") return 0;
  return children(e).reduce((n, c) => n + literalCount(c), 0);
}
