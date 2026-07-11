import type { Expr } from "./ast";
import { bitOf } from "./types";

/**
 * THE GOLDEN ORACLE.
 *
 * Every other algorithm in the engine — Quine-McCluskey, the K-map geometry, the
 * NAND/NOR rewrite, the circuit synthesizer — is property-tested against this
 * function. So it is deliberately the dumbest possible implementation: scalar,
 * recursive, no bit-parallel packing, no memoization, no cleverness. It should
 * be verifiable by reading it once.
 *
 * (A bit-parallel evaluator would be faster, but at n <= 10 the whole truth
 * table is 1024 rows and takes microseconds. Buying speed we don't need with
 * subtlety we can't afford in the oracle is a bad trade.)
 */
export function evaluate(e: Expr, env: ReadonlyMap<string, 0 | 1>): 0 | 1 {
  switch (e.kind) {
    case "const":
      return e.value;

    case "var": {
      const v = env.get(e.name);
      if (v === undefined) {
        // Callers build `env` from the function's full variable list, which is a
        // superset of the expression's variables. Reaching here is a bug in the
        // caller, not bad user input.
        throw new Error(`evaluate: variable "${e.name}" is not in the environment`);
      }
      return v;
    }

    case "not":
      return evaluate(e.operand, env) === 1 ? 0 : 1;

    case "and":
      return e.operands.every((o) => evaluate(o, env) === 1) ? 1 : 0;

    case "nand":
      return e.operands.every((o) => evaluate(o, env) === 1) ? 0 : 1;

    case "or":
      return e.operands.some((o) => evaluate(o, env) === 1) ? 1 : 0;

    case "nor":
      return e.operands.some((o) => evaluate(o, env) === 1) ? 0 : 1;

    // XOR over n operands is the parity of its 1s, which is the multi-input XOR
    // gate's semantics and reduces to the familiar 2-input one at arity 2.
    case "xor":
      return parity(e.operands, env);

    case "xnor":
      return parity(e.operands, env) === 1 ? 0 : 1;
  }
}

function parity(operands: readonly Expr[], env: ReadonlyMap<string, 0 | 1>): 0 | 1 {
  let p = 0;
  for (const o of operands) p ^= evaluate(o, env);
  return (p & 1) as 0 | 1;
}

/** Build the environment for minterm index `m`. Obeys THE MSB CONTRACT. */
export function envForMinterm(
  variables: readonly string[],
  m: number,
): Map<string, 0 | 1> {
  const n = variables.length;
  const env = new Map<string, 0 | 1>();
  for (let i = 0; i < n; i++) {
    env.set(variables[i] as string, bitOf(m, i, n));
  }
  return env;
}

/**
 * Sweep an expression over all 2^n assignments.
 *
 * An expression can never produce a don't-care, so every entry is 0 or 1. Only
 * Σm/ΠM notation and truth-table input can introduce a 2.
 */
export function truthVector(ast: Expr, variables: readonly string[]): Uint8Array {
  const n = variables.length;
  const rows = 1 << n;
  const values = new Uint8Array(rows);
  for (let m = 0; m < rows; m++) {
    values[m] = evaluate(ast, envForMinterm(variables, m));
  }
  return values;
}
