import {
  collectVariables,
  mkConst,
  mkNary,
  mkNot,
  mkVar,
  type Expr,
} from "./ast";
import { truthVector } from "./evaluate";
import { looksLikeNotation, parseNotation } from "./notation";
import { parse } from "./parser";
import {
  DONT_CARE,
  MAX_VARIABLES,
  bitOf,
  err,
  ok,
  type BooleanFunction,
  type Diagnostic,
  type EngineResult,
  type FunctionSource,
  type Span,
  type TruthValue,
} from "./types";

/**
 * THE CONVERGENCE LAYER.
 *
 * Expression strings, Σm/ΠM notation, truth-table matrices, and K-map clicks are
 * four ways of saying the same thing. They all land here, on one dense ternary
 * truth vector, and nothing downstream ever needs to know which one the user
 * used.
 *
 * Note what is *not* here: Gray code. The K-map's (row, col) -> minterm mapping
 * lives in kmap.ts and nowhere else, so the UI converts to a linear index before
 * calling `fromTruthValues`. Gray code leaking into this file is how you end up
 * with two disagreeing definitions of adjacency.
 */

const WHOLE: Span = { start: 0, end: 0 };

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Auto-detects notation vs. expression. This is what the input box calls. */
export function parseInput(
  source: string,
  variables?: readonly string[],
): EngineResult<BooleanFunction> {
  return looksLikeNotation(source)
    ? fromNotation(source, variables)
    : fromExpression(source, variables);
}

export function fromExpression(
  source: string,
  variables?: readonly string[],
): EngineResult<BooleanFunction> {
  const parsed = parse(source);
  if (!parsed.ok) return err(parsed.diagnostics);

  const { ast, name, declaredVariables } = parsed.value;
  const diagnostics = [...parsed.diagnostics];

  // Precedence: an explicit argument beats the `F(A,B,C)` header, which beats
  // the variables that happen to appear in the expression text. The last is a
  // guess -- `F(A,B,C) = A + B` is a three-variable function whose body mentions
  // two -- so it is only used when nobody said otherwise.
  const vars = variables ?? declaredVariables ?? collectVariables(ast);

  // A constant expression like `1` or `A + A'` reduced to nothing. Give it one
  // dummy variable so there is still a table to render.
  if (vars.length === 0) return buildConstant(name, ast, source);

  const arity = checkArity(vars, { start: 0, end: source.length });
  if (arity) return err([...diagnostics, arity]);

  const missing = collectVariables(ast).filter((v) => !vars.includes(v));
  if (missing.length > 0) {
    return err([
      ...diagnostics,
      {
        code: "unexpected-token",
        message: `${missing.join(", ")} ${
          missing.length === 1 ? "is" : "are"
        } not in the declared variable list (${vars.join(", ")}).`,
        span: { start: 0, end: source.length },
        severity: "error",
      },
    ]);
  }

  return ok(
    makeFunction(name, vars, truthVector(ast, vars), {
      kind: "expression",
      text: source,
    }),
    diagnostics,
  );
}

export function fromNotation(
  source: string,
  variables?: readonly string[],
): EngineResult<BooleanFunction> {
  const parsed = parseNotation(source);
  if (!parsed.ok) return err(parsed.diagnostics);

  const { name, form, indices, dontCares, declaredVariables } = parsed.value;
  const diagnostics = [...parsed.diagnostics];
  const span: Span = { start: 0, end: source.length };

  let vars = variables ?? declaredVariables;
  if (!vars) {
    // Pitfall #2: arity is not inferable. Σm(0,2,5) is consistent with 3
    // variables and with 8. We take the smallest that fits and say so out loud,
    // because a silently-wrong variable count produces a silently-wrong K-map.
    const maxIndex = Math.max(0, ...indices, ...dontCares);
    const n = Math.max(1, bitsNeeded(maxIndex));
    vars = defaultVariableNames(n);
    diagnostics.push({
      code: "inferred-arity",
      message: `No variable list given — assuming ${n} variable${
        n === 1 ? "" : "s"
      } (${vars.join(", ")}) from the largest index. Write ${name}(${vars.join(
        ",",
      )}) = … to be explicit.`,
      span,
      severity: "warning",
    });
  }

  const arity = checkArity(vars, span);
  if (arity) return err([...diagnostics, arity]);

  const built =
    form === "sum"
      ? fromMinterms(vars, indices, dontCares, name)
      : fromMaxterms(vars, indices, dontCares, name);

  if (!built.ok) return err([...diagnostics, ...built.diagnostics]);

  return ok(
    { ...built.value, source: { kind: "notation", text: source, form } },
    [...diagnostics, ...built.diagnostics],
  );
}

export function fromMinterms(
  variables: readonly string[],
  minterms: readonly number[],
  dontCares: readonly number[] = [],
  name = "F",
): EngineResult<BooleanFunction> {
  return fromIndexSets(variables, minterms, dontCares, name, 0, 1);
}

export function fromMaxterms(
  variables: readonly string[],
  maxterms: readonly number[],
  dontCares: readonly number[] = [],
  name = "F",
): EngineResult<BooleanFunction> {
  // A maxterm is a row that evaluates to 0, so the background flips.
  return fromIndexSets(variables, maxterms, dontCares, name, 1, 0);
}

export function fromTruthValues(
  variables: readonly string[],
  values: readonly TruthValue[],
  name = "F",
  source: FunctionSource = { kind: "truth-table" },
): EngineResult<BooleanFunction> {
  const span = WHOLE;
  const arity = checkArity(variables, span);
  if (arity) return err([arity]);

  const expected = 1 << variables.length;
  if (values.length !== expected) {
    return err([
      {
        code: "index-out-of-range",
        message: `Expected ${expected} rows for ${variables.length} variables, got ${values.length}.`,
        span,
        severity: "error",
      },
    ]);
  }

  return ok(makeFunction(name, variables, Uint8Array.from(values), source));
}

// ---------------------------------------------------------------------------
// Derived views. Never stored — always recomputed from `values`.
// ---------------------------------------------------------------------------

export const minterms = (fn: BooleanFunction): number[] => indicesWhere(fn, 1);
export const maxterms = (fn: BooleanFunction): number[] => indicesWhere(fn, 0);
export const dontCares = (fn: BooleanFunction): number[] =>
  indicesWhere(fn, DONT_CARE);

function indicesWhere(fn: BooleanFunction, want: TruthValue): number[] {
  const out: number[] = [];
  for (let m = 0; m < fn.values.length; m++) {
    if (fn.values[m] === want) out.push(m);
  }
  return out;
}

/** 1 <-> 0. Don't-cares stay don't-cares. */
export function complement(fn: BooleanFunction): BooleanFunction {
  const values = new Uint8Array(fn.values.length);
  for (let m = 0; m < fn.values.length; m++) {
    const v = fn.values[m] as TruthValue;
    values[m] = v === DONT_CARE ? DONT_CARE : v === 1 ? 0 : 1;
  }
  return {
    name: `${fn.name}'`,
    variables: fn.variables,
    values,
    source: { kind: "derived", of: fn.name },
  };
}

/** Σ of full-width product terms. Don't-cares are treated as 0. */
export function canonicalSop(fn: BooleanFunction): Expr {
  const ms = minterms(fn);
  if (ms.length === 0) return mkConst(0, WHOLE);
  const products = ms.map((m) => literalsFor(fn.variables, m, false));
  return products.length === 1
    ? (products[0] as Expr)
    : mkNary("or", products, WHOLE);
}

/** Π of full-width sum terms. Don't-cares are treated as 1. */
export function canonicalPos(fn: BooleanFunction): Expr {
  const ms = maxterms(fn);
  if (ms.length === 0) return mkConst(1, WHOLE);
  const sums = ms.map((m) => literalsFor(fn.variables, m, true));
  return sums.length === 1 ? (sums[0] as Expr) : mkNary("and", sums, WHOLE);
}

/**
 * One product term (or, inverted, one sum term) for minterm `m`.
 *
 * The polarity flip is the whole difference between a minterm and a maxterm: in
 * the minterm A·B'·C, a 0 bit means a complemented literal; in the maxterm
 * A'+B+C', a 0 bit means an *un*complemented one.
 */
function literalsFor(
  variables: readonly string[],
  m: number,
  maxterm: boolean,
): Expr {
  const n = variables.length;
  const literals: Expr[] = variables.map((name, i) => {
    const bit = bitOf(m, i, n);
    const negate = maxterm ? bit === 1 : bit === 0;
    const v = mkVar(name, WHOLE);
    return negate ? mkNot(v, WHOLE) : v;
  });
  if (literals.length === 1) return literals[0] as Expr;
  return mkNary(maxterm ? "or" : "and", literals, WHOLE);
}

/**
 * The lab-grading primitive: does `candidate` implement `expected`?
 *
 * A don't-care in `expected` matches anything — that is the entire point of a
 * don't-care, and forgetting it here would fail a student for making a legal
 * choice we told them they were free to make.
 */
export function checkEquivalence(
  expected: BooleanFunction,
  candidate: BooleanFunction,
): { readonly equal: boolean; readonly mismatches: readonly number[] } {
  const mismatches: number[] = [];
  if (expected.values.length !== candidate.values.length) {
    return { equal: false, mismatches: [] };
  }
  for (let m = 0; m < expected.values.length; m++) {
    const e = expected.values[m] as TruthValue;
    if (e === DONT_CARE) continue;
    if (candidate.values[m] !== e) mismatches.push(m);
  }
  return { equal: mismatches.length === 0, mismatches };
}

/** Stable cache key. Canonical, so two spellings of one function share a key. */
export const functionKey = (fn: BooleanFunction): string =>
  `${fn.variables.join(",")}|${fn.values.join("")}`;

export const defaultVariableNames = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function makeFunction(
  name: string,
  variables: readonly string[],
  values: Uint8Array,
  source: FunctionSource,
): BooleanFunction {
  return { name, variables: [...variables], values, source };
}

function buildConstant(
  name: string,
  ast: Expr,
  source: string,
): EngineResult<BooleanFunction> {
  const vars = ["A"];
  return ok(
    makeFunction(name, vars, truthVector(ast, vars), {
      kind: "expression",
      text: source,
    }),
    [
      {
        code: "inferred-arity",
        message:
          "This expression has no variables. Showing it against a single dummy variable A.",
        span: { start: 0, end: source.length },
        severity: "info",
      },
    ],
  );
}

function checkArity(
  variables: readonly string[],
  span: Span,
): Diagnostic | null {
  if (variables.length > MAX_VARIABLES) {
    return {
      code: "too-many-variables",
      message: `${variables.length} variables means ${
        2 ** variables.length
      } rows. The limit is ${MAX_VARIABLES}.`,
      span,
      severity: "error",
    };
  }
  return null;
}

const bitsNeeded = (maxIndex: number): number =>
  maxIndex <= 0 ? 1 : 32 - Math.clz32(maxIndex);

/**
 * Shared by fromMinterms/fromMaxterms. `background` is what an unlisted row
 * gets; `listed` is what a listed one gets.
 */
function fromIndexSets(
  variables: readonly string[],
  listedIndices: readonly number[],
  dontCareIndices: readonly number[],
  name: string,
  background: TruthValue,
  listed: TruthValue,
): EngineResult<BooleanFunction> {
  const span = WHOLE;
  const arity = checkArity(variables, span);
  if (arity) return err([arity]);

  const n = variables.length;
  const rows = 1 << n;
  const diagnostics: Diagnostic[] = [];

  const outOfRange = [...listedIndices, ...dontCareIndices].filter(
    (m) => !Number.isInteger(m) || m < 0 || m >= rows,
  );
  if (outOfRange.length > 0) {
    return err([
      {
        code: "index-out-of-range",
        message: `Index ${outOfRange.join(", ")} is outside 0…${
          rows - 1
        } for ${n} variables.`,
        span,
        severity: "error",
      },
    ]);
  }

  const listedSet = new Set(listedIndices);
  const dontCareSet = new Set(dontCareIndices);

  const conflicts = [...listedSet].filter((m) => dontCareSet.has(m));
  if (conflicts.length > 0) {
    return err([
      {
        code: "conflicting-index",
        message: `Index ${conflicts.join(
          ", ",
        )} is listed both as a term and as a don't-care.`,
        span,
        severity: "error",
      },
    ]);
  }

  if (listedSet.size !== listedIndices.length) {
    diagnostics.push({
      code: "duplicate-index",
      message: "An index is repeated. Duplicates are ignored.",
      span,
      severity: "warning",
    });
  }

  const values = new Uint8Array(rows).fill(background);
  for (const m of listedSet) values[m] = listed;
  for (const m of dontCareSet) values[m] = DONT_CARE;

  return ok(
    makeFunction(name, variables, values, { kind: "truth-table" }),
    diagnostics,
  );
}
