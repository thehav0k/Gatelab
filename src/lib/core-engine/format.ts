import { isNary, type Expr, type NaryOp } from "./ast";

export type Notation = "unicode" | "ascii";

/**
 * AST -> string. Parenthesizes by precedence, so the output re-parses to an
 * equal tree (there is a round-trip property test for exactly this).
 */
export function format(e: Expr, notation: Notation = "unicode"): string {
  return emit(e, notation, 0);
}

/** Tightest binds first. Mirrors the parser's levels. */
const PRECEDENCE: Readonly<Record<NaryOp, number>> = {
  and: 3,
  nand: 3,
  xor: 2,
  xnor: 2,
  or: 1,
  nor: 1,
};

const SYMBOL: Readonly<Record<Notation, Readonly<Record<NaryOp, string>>>> = {
  unicode: {
    and: "·",
    or: " + ",
    xor: " ⊕ ",
    nand: " NAND ",
    nor: " NOR ",
    xnor: " XNOR ",
  },
  ascii: {
    and: "*",
    or: " + ",
    xor: " ^ ",
    nand: " NAND ",
    nor: " NOR ",
    xnor: " XNOR ",
  },
};

function emit(e: Expr, n: Notation, parentPrec: number): string {
  switch (e.kind) {
    case "var":
      return e.name;

    case "const":
      return String(e.value);

    case "not": {
      const inner = e.operand;
      // A postfix prime reads better than a prefix bang, but only on something
      // atomic — (A + B)' is fine, A + B' would be a lie.
      if (inner.kind === "var" || inner.kind === "const") {
        return `${emit(inner, n, 99)}'`;
      }
      return `(${emit(inner, n, 0)})'`;
    }

    default: {
      const prec = PRECEDENCE[e.kind];
      const body = e.operands
        .map((o) => emit(o, n, prec))
        .join(SYMBOL[n][e.kind]);
      return prec < parentPrec ? `(${body})` : body;
    }
  }
}

/** A one-line summary like `F(A, B, C) = Σm(1, 3) + d(5)`. */
export function formatSigma(
  name: string,
  variables: readonly string[],
  minterms: readonly number[],
  dontCares: readonly number[],
): string {
  const head = `${name}(${variables.join(", ")}) = Σm(${minterms.join(", ")})`;
  return dontCares.length > 0 ? `${head} + d(${dontCares.join(", ")})` : head;
}

/** True when the node needs wrapping inside `parent`. Exported for the UI. */
export const needsParens = (child: Expr, parent: Expr): boolean =>
  isNary(child) && isNary(parent) && PRECEDENCE[child.kind] < PRECEDENCE[parent.kind];
