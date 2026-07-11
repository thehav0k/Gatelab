import fc from "fast-check";
import { mkConst, mkNary, mkNot, mkVar, type Expr, type NaryOp } from "../ast";
import type { BooleanFunction, TruthValue } from "../types";

/**
 * Shared fast-check generators.
 *
 * The single highest-value property in this codebase is
 * `truthVector(ast) === truthVector(minimize(ast))` over random ASTs — it
 * catches almost every Quine-McCluskey bug (bad combining, dropped implicants,
 * a wrong essential-PI extraction, a botched Petrick expansion) on its own.
 * These generators are what feed it, so they live outside any one test file.
 */

const SPAN = { start: 0, end: 0 };

export const OPS: readonly NaryOp[] = [
  "and",
  "or",
  "xor",
  "nand",
  "nor",
  "xnor",
];

/** A random expression over the first `n` variables. */
export function arbExpr(variables: readonly string[]): fc.Arbitrary<Expr> {
  const leaf: fc.Arbitrary<Expr> = fc.oneof(
    { weight: 8, arbitrary: fc.constantFrom(...variables).map((v) => mkVar(v, SPAN)) },
    { weight: 1, arbitrary: fc.constantFrom(0 as const, 1 as const).map((c) => mkConst(c, SPAN)) },
  );

  return fc.letrec<{ expr: Expr }>((tie) => ({
    expr: fc.oneof(
      { maxDepth: 4, depthSize: "small" },
      { weight: 5, arbitrary: leaf },
      { weight: 2, arbitrary: tie("expr").map((e) => mkNot(e, SPAN)) },
      {
        weight: 6,
        arbitrary: fc
          .tuple(
            fc.constantFrom(...OPS),
            fc.array(tie("expr"), { minLength: 2, maxLength: 3 }),
          )
          .map(([op, ops]) => mkNary(op, ops, SPAN)),
      },
    ),
  })).expr;
}

/** Variable lists of a workable size — big enough to be interesting, small enough to brute-force. */
export const arbVariables = (min = 1, max = 4): fc.Arbitrary<string[]> =>
  fc
    .integer({ min, max })
    .map((n) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)));

/** A random *function* (not expression) — including don't-cares, which expressions can't produce. */
export function arbFunction(
  opts: { minVars?: number; maxVars?: number; dontCares?: boolean } = {},
): fc.Arbitrary<BooleanFunction> {
  const { minVars = 1, maxVars = 4, dontCares = true } = opts;
  const pool: TruthValue[] = dontCares ? [0, 1, 2] : [0, 1];

  return arbVariables(minVars, maxVars).chain((variables) =>
    fc
      .array(fc.constantFrom(...pool), {
        minLength: 1 << variables.length,
        maxLength: 1 << variables.length,
      })
      .map((values) => ({
        name: "F",
        variables,
        values: Uint8Array.from(values),
        source: { kind: "truth-table" } as const,
      })),
  );
}
