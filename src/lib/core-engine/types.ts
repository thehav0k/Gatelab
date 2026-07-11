/**
 * Core types for the theoretical engine.
 *
 * THE MSB CONTRACT
 * ----------------
 * For variable `variables[i]` of an n-variable function, its bit inside minterm
 * index `m` is `(m >>> (n - 1 - i)) & 1`. **`variables[0]` is the most
 * significant bit.**
 *
 * This single sentence is the contract between the parser, the truth table, the
 * Quine-McCluskey cube bitmasks, and the K-map Gray code. Every index
 * computation in the engine derives from the two helpers at the bottom of this
 * file. Never hand-roll the shift anywhere else — a stray `n - i` instead of
 * `n - 1 - i` produces a truth table that is wrong in a way that looks right.
 */

/** 0 and 1 are ordinary; 2 is a don't-care. */
export type TruthValue = 0 | 1 | 2;

export const FALSE = 0 satisfies TruthValue;
export const TRUE = 1 satisfies TruthValue;
export const DONT_CARE = 2 satisfies TruthValue;

/**
 * The canonical intermediate representation. Every input mode — expression
 * string, Σm/ΠM notation, truth-table matrix, K-map clicks — converges here.
 *
 * It is a *dense ternary truth vector*: total (every one of the 2^n rows carries
 * an explicit 0/1/X) and canonical (unique per function + variable order). That
 * canonicity is what lets `checkEquivalence` be a memcmp and what makes results
 * safe to cache and snapshot.
 *
 * Rejected alternatives, and why:
 *   - Minterm Set + don't-care Set. Encodes a *partial* function: "in neither
 *     set" implicitly means 0, which is exactly the assumption people forget
 *     when they later write `if (minterms.has(m))` and silently treat X as 0.
 *     Two sets can also contradict each other.
 *   - A cover (list of cubes). Not unique per function — `A + A'B` and `A + B`
 *     are the same function with different covers, so equivalence stops being
 *     cheap. A cover is an *output* of the engine, never its state.
 */
export interface BooleanFunction {
  readonly name: string;
  /** Canonical order. `variables[0]` is the MSB. See THE MSB CONTRACT above. */
  readonly variables: readonly string[];
  /** Length 2**n, indexed by minterm index. Each entry is a TruthValue. */
  readonly values: Uint8Array;
  readonly source: FunctionSource;
}

/** Provenance, so the UI can show how the current function was arrived at. */
export type FunctionSource =
  | { readonly kind: "expression"; readonly text: string }
  | { readonly kind: "notation"; readonly text: string; readonly form: "sum" | "product" }
  | { readonly kind: "truth-table" }
  | { readonly kind: "kmap" }
  | { readonly kind: "derived"; readonly of: string };

/**
 * A cube (implicant): a product term covering 2^(number of dashes) minterms.
 *
 * Bit layout follows THE MSB CONTRACT, so variable i occupies `varMask(i, n)`.
 *   - `care`: 1 where the variable appears in the term, 0 where it cancelled out.
 *   - `bits`: the required polarity, only meaningful where `care` has a 1.
 *
 * So A'B in a 3-variable function ABC is care=0b110, bits=0b010.
 *
 * Two cubes combine iff they have identical `care` masks and their `bits` differ
 * in exactly one bit position. The identical-`care` guard is easy to omit and
 * doing so produces plausible-looking garbage — see the tests.
 */
export interface Cube {
  readonly care: number;
  readonly bits: number;
  /** Minterms *and* don't-cares this cube covers. Sorted. Used for the PI chart. */
  readonly covers: readonly number[];
}

/** A source span, for underlining errors in the input box. */
export interface Span {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly span: Span;
  readonly severity: "error" | "warning" | "info";
}

export type DiagnosticCode =
  | "unexpected-character"
  | "unexpected-token"
  | "unexpected-end"
  | "unbalanced-paren"
  | "missing-operand"
  | "empty-expression"
  | "too-many-variables"
  | "duplicate-index"
  | "index-out-of-range"
  | "conflicting-index"
  | "inferred-arity"
  | "implicit-and";

/**
 * Errors are data, never thrown strings — the input box needs to underline the
 * exact span, and a `throw` loses that. Callers pattern-match on `ok`.
 */
export type EngineResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export const ok = <T>(
  value: T,
  diagnostics: readonly Diagnostic[] = [],
): EngineResult<T> => ({ ok: true, value, diagnostics });

export const err = <T>(diagnostics: readonly Diagnostic[]): EngineResult<T> => ({
  ok: false,
  diagnostics,
});

/**
 * Quine-McCluskey is exponential in the worst case and a 2^n-row truth table is
 * a DOM problem before it is a compute problem. No DLD course exceeds 6
 * variables; we reject beyond 10 with a clear message rather than hanging.
 */
export const MAX_VARIABLES = 10;

// ---------------------------------------------------------------------------
// THE MSB CONTRACT — the only place these shifts are allowed to be written.
// ---------------------------------------------------------------------------

/** The bit of `variables[i]` inside minterm index `m`, for an n-variable function. */
export const bitOf = (m: number, i: number, n: number): 0 | 1 =>
  ((m >>> (n - 1 - i)) & 1) as 0 | 1;

/** The mask selecting `variables[i]` in an n-variable function. */
export const varMask = (i: number, n: number): number => 1 << (n - 1 - i);

/** Population count — the number of 1s, i.e. the QM grouping key. */
export function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}
