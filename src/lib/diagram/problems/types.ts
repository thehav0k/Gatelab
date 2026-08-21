import { DONT_CARE, format, minimize } from "@/lib/core-engine";
import type { Diagram } from "../types";
import { toFunction, type FunctionSpec } from "../builders/kit";

/**
 * A question, and the machinery for answering it AT ANY SIZE.
 *
 * The tempting design is a lookup table: question 12 maps to a stored picture of
 * a 1-to-16 demultiplexer. It is also the wrong one, and for the same reason the
 * rest of this codebase computes rather than stores — a stored answer is correct
 * for exactly one phrasing of one question, and the next exam changes the 16 to a
 * 32 and the whole thing is worthless.
 *
 * So a `Problem` carries PARAMETERS and a `solve` function. "Design a circuit for
 * numbers divisible by 3 or 5" is really "divisible by p or q, over n bits", and
 * once it is written that way the tool answers a family of questions instead of
 * one — including the ones that were not on the sheet.
 */

export type ProblemCategory =
  | "circuit"
  | "sequential"
  | "memory"
  | "theory"
  | "table";

export type ParamValue = number | string;
export type ParamValues = Readonly<Record<string, ParamValue>>;

export interface ParamChoice {
  readonly value: string;
  readonly label: string;
}

export interface ParamSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: "int" | "choice" | "text";
  readonly min?: number;
  readonly max?: number;
  readonly choices?: readonly ParamChoice[];
  readonly initial: ParamValue;
  readonly hint?: string;
}

export interface SolutionTable {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly note?: string;
  /** Rows whose last column is this value get emphasised. Used for truth tables. */
  readonly highlightWhen?: string;
}

export interface Solution {
  readonly diagrams: readonly Diagram[];
  readonly tables?: readonly SolutionTable[];
  /** The worked answer, paragraph by paragraph, in the order you would write it. */
  readonly steps: readonly string[];
  /** A one-line headline for calculation questions. */
  readonly answer?: string;
  /** Expressions worth showing in a monospaced block. */
  readonly expressions?: readonly string[];
}

export interface Problem {
  readonly id: string;
  /** As printed on the assignment: "5", "41(a)". */
  readonly number: string;
  readonly title: string;
  readonly prompt: string;
  readonly category: ProblemCategory;
  readonly tags: readonly string[];
  readonly params?: readonly ParamSpec[];
  readonly solve: (values: ParamValues) => Solution;
}

// --- parameter access -------------------------------------------------------

export const num = (values: ParamValues, key: string, fallback: number): number => {
  const raw = values[key];
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const str = (values: ParamValues, key: string, fallback: string): string => {
  const raw = values[key];
  return raw === undefined || raw === "" ? fallback : String(raw);
};

/** Fill in every parameter's default, so `solve` never sees a hole. */
export const defaults = (problem: Problem): ParamValues =>
  Object.fromEntries((problem.params ?? []).map((p) => [p.key, p.initial]));

// --- tables -----------------------------------------------------------------

const VARIABLE_ALPHABET = "ABCDEFGHIJ";

export const variablesFor = (count: number, from = 0): string[] =>
  Array.from({ length: count }, (_, i) => VARIABLE_ALPHABET[from + i] ?? `V${i}`);

/**
 * The truth table of one or more functions over the same variables.
 *
 * Built from the engine's canonical truth vector rather than by re-evaluating an
 * expression, so it is the same table the minimizer worked from — which is the
 * only way the table and the circuit beside it can be guaranteed to agree.
 */
export function truthTable(
  specs: readonly FunctionSpec[],
  opts: { readonly title?: string; readonly decimal?: boolean } = {},
): SolutionTable {
  const first = specs[0];
  if (!first) return { title: opts.title ?? "Truth table", columns: [], rows: [] };

  const variables = first.variables;
  const n = variables.length;
  const vectors = specs.map((s) => toFunction(s).values);

  const columns = [
    ...(opts.decimal ? ["#"] : []),
    ...variables,
    ...specs.map((s) => s.name),
  ];

  const rows: string[][] = [];
  for (let m = 0; m < 1 << n; m++) {
    const bits = variables.map((_, i) => String((m >>> (n - 1 - i)) & 1));
    const outs = vectors.map((v) => {
      const value = v[m];
      return value === DONT_CARE ? "X" : String(value ?? 0);
    });
    rows.push([...(opts.decimal ? [String(m)] : []), ...bits, ...outs]);
  }

  return {
    title: opts.title ?? "Truth table",
    columns,
    rows,
    highlightWhen: "1",
  };
}

/** `F = B'C + AC'` for each spec, minimized by the engine. */
export const minimalExpressions = (specs: readonly FunctionSpec[]): string[] =>
  specs.map((s) => `${s.name} = ${format(minimize(toFunction(s), "sop").expression)}`);

export const sigmaOf = (spec: FunctionSpec): string =>
  `${spec.name}(${spec.variables.join(", ")}) = Σm(${[...spec.minterms].sort((a, b) => a - b).join(", ")})${
    spec.dontCares && spec.dontCares.length > 0
      ? ` + d(${[...spec.dontCares].sort((a, b) => a - b).join(", ")})`
      : ""
  }`;
