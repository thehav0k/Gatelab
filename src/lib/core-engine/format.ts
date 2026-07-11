import { ASSOCIATIVE_OPS, isNary, type Expr, type NaryOp } from "./ast";

export type Notation = "unicode" | "ascii";

/**
 * AST -> string. Parenthesizes by precedence, so the output re-parses to an
 * equal tree (there is a round-trip property test for exactly this).
 */
export function format(e: Expr, notation: Notation = "unicode"): string {
  return emit(e, notation, 0);
}

/**
 * The associative gate each non-associative one inverts, for arity > 2.
 * See the note in `emit` — this is what keeps format() from changing the
 * function it is printing.
 */
const INVERTED_BASE: Partial<Record<NaryOp, NaryOp>> = {
  nand: "and",
  nor: "or",
  xnor: "xor",
};

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

function emit(
  e: Expr,
  n: Notation,
  parentPrec: number,
  parentKind?: NaryOp,
): string {
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
      /**
       * NAND / NOR / XNOR ARE NOT ASSOCIATIVE, so an n-ary one may NOT be emitted
       * as an infix chain.
       *
       * `NAND(a, b, c)` means a three-input NAND gate — `NOT(a·b·c)`. But the
       * text "a NAND b NAND c" re-parses as the left-nested `(a NAND b) NAND c`,
       * which is a DIFFERENT FUNCTION (they disagree on 4 of 8 rows). Emitting
       * the chain would make format() silently change the meaning of the tree,
       * and the round-trip property test in format.test.ts is what caught it.
       *
       * At arity 2 the two readings coincide, so the infix form is safe there and
       * reads better. Beyond that, spell it out as an inverted base gate.
       */
      if (INVERTED_BASE[e.kind] && e.operands.length > 2) {
        const base = INVERTED_BASE[e.kind] as NaryOp;
        const body = e.operands
          .map((o) => emit(o, n, PRECEDENCE[base], base))
          .join(SYMBOL[n][base]);
        return `(${body})'`;
      }

      const prec = PRECEDENCE[e.kind];
      const body = e.operands
        .map((o) => emit(o, n, prec, e.kind))
        .join(SYMBOL[n][e.kind]);

      // A child that binds LOOSER than its parent always needs parens.
      //
      // A child at the SAME precedence needs them too — UNLESS it is the very
      // same associative operator, where flattening is exactly what the parser
      // will reconstruct. That exception is narrow on purpose: NAND and OR share
      // a level with NOR, and `OR(A, NOR(B,C))` printed as "A + B NOR C" would
      // re-parse as `NOR(OR(A,B), C)` — a different function. Same trap as the
      // n-ary case above, one level down.
      const sameAssociative = parentKind === e.kind && ASSOCIATIVE_OPS.has(e.kind);
      const needs =
        prec < parentPrec || (prec === parentPrec && !sameAssociative);

      return needs ? `(${body})` : body;
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
