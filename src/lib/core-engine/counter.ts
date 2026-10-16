import { truthVector } from "./evaluate";
import { format } from "./format";
import { minimize } from "./minimizer";
import {
  DONT_CARE,
  FALSE,
  TRUE,
  type BooleanFunction,
  type TruthValue,
} from "./types";

/**
 * Designing a counter from the sequence you want it to count.
 *
 * This is the standard exercise run forwards. Everywhere else in the app a
 * sequential circuit is described by its excitation equations and the tables
 * are derived from them; here the SEQUENCE is given and the equations are what
 * has to be found. The procedure is fixed and every step of it is worth showing,
 * because the marks are in the steps:
 *
 *   1. the sequence gives a transition table — each state's successor;
 *   2. the flip-flop's own excitation table turns each transition into the
 *      inputs that produce it;
 *   3. each of those inputs is a Boolean function of the present state;
 *   4. minimize it — and the states the counter never visits are DON'T CARES.
 *
 * STEP 4 IS THE WHOLE POINT, and it is the step people skip. A mod-5 counter
 * has three unused states, and treating them as zeros rather than as don't
 * cares typically doubles the gate count. So they are marked in the table and
 * handed to Quine–McCluskey as don't cares, which is exactly what the existing
 * minimizer already takes.
 *
 * WHAT IT DOES NOT PROMISE. An unused state is a don't care for the ALGEBRA,
 * which means the circuit's behaviour there is whatever the minimizer's choice
 * happened to make it. If the counter powers up in one of them it may or may
 * not find its way back into the sequence; `strayStates` says which, and where
 * they go. That is a real property of the finished circuit and the reason a
 * self-correcting counter is a different, more expensive design.
 */

export type FlipFlopType = "d" | "t" | "jk";

/** One row of the design table: a present state and everything it implies. */
export interface CounterRow {
  readonly state: number;
  /** Present-state bits, MSB first. */
  readonly present: readonly (0 | 1)[];
  /** Next state, or null when this state is not in the sequence. */
  readonly next: number | null;
  readonly nextBits: readonly (0 | 1)[] | null;
  /**
   * What each flip-flop input must be, in `pins` order. `DONT_CARE` appears
   * both for unused states and for the J/K entries the excitation table leaves
   * free — the two sources of freedom that make this design cheaper than a
   * naive one.
   */
  readonly excitation: readonly TruthValue[];
  readonly used: boolean;
}

export interface CounterEquation {
  readonly pin: string;
  /** The minimal sum of products, as text — ready for `sequentialDesignDiagram`. */
  readonly expr: string;
  readonly minterms: readonly number[];
  readonly dontCares: readonly number[];
  /**
   * What the MINIMIZED equation actually outputs, per state — the finished
   * circuit's own behaviour, don't cares resolved.
   *
   * "It was a don't care" is not an answer to "what does the hardware do". The
   * minimizer picked something, and this is what it picked; it is what decides
   * where an unused state goes, and therefore whether the counter is
   * self-correcting.
   *
   * Read by EVALUATING the expression rather than by inspecting the chosen
   * cover. A constant equation — `KA = 1`, which mod-5 produces twice — is
   * degenerate: the cube pipeline is skipped and the cover comes back EMPTY, so
   * a cover-based reading called it 0 everywhere and invented three trap states
   * that the real circuit does not have.
   */
  readonly output: Uint8Array;
  readonly literals: number;
}

export interface StrayState {
  readonly state: number;
  readonly goesTo: number;
  /** Does following it from here eventually reach the sequence? */
  readonly recovers: boolean;
}

export interface CounterDesign {
  readonly sequence: readonly number[];
  readonly bits: number;
  /** `["C","B","A"]` for three bits — MSB first, matching the MSB contract. */
  readonly stateVars: readonly string[];
  readonly type: FlipFlopType;
  /** The flip-flop input names in column order: `["DC","DB","DA"]`, `["JC","KC",…]`. */
  readonly pins: readonly string[];
  readonly rows: readonly CounterRow[];
  readonly equations: readonly CounterEquation[];
  /** States the counter never visits, in order. */
  readonly unused: readonly number[];
  /** Where each unused state would actually go, given the equations chosen. */
  readonly strays: readonly StrayState[];
  /** True when every unused state eventually falls back into the sequence. */
  readonly selfCorrecting: boolean;
}

export type CounterError =
  | { readonly kind: "empty" }
  | { readonly kind: "too-short" }
  | { readonly kind: "duplicate"; readonly state: number }
  | { readonly kind: "too-wide"; readonly bits: number };

export type CounterResult =
  | { readonly ok: true; readonly design: CounterDesign }
  | { readonly ok: false; readonly error: CounterError };

/** Above this the tables stop being readable and the K-maps stop being drawable. */
export const MAX_COUNTER_BITS = 5;

/**
 * State variable names, MSB first: A is the most significant.
 *
 * Deliberately the same convention as `variables[0]` is the MSB everywhere
 * else. A counter whose bit order disagreed with the rest of the app would
 * produce a correct table under a wrong heading, which is the worst kind of
 * wrong.
 */
export const stateVarNames = (bits: number): string[] =>
  Array.from({ length: bits }, (_, i) => String.fromCharCode(65 + i));

const bitsOf = (value: number, width: number): (0 | 1)[] =>
  Array.from({ length: width }, (_, i) => ((value >>> (width - 1 - i)) & 1) as 0 | 1);

/**
 * The J-K excitation table, which is the only one worth memorising:
 *
 *   0 -> 0   J=0  K=X        1 -> 0   J=X  K=1
 *   0 -> 1   J=1  K=X        1 -> 1   J=X  K=0
 *
 * Half of it is don't-care, and that is why J-K designs come out smaller than
 * D designs for the same sequence.
 */
const jkFor = (from: 0 | 1, to: 0 | 1): [TruthValue, TruthValue] =>
  from === 0 ? [to === 1 ? TRUE : FALSE, DONT_CARE] : [DONT_CARE, to === 0 ? TRUE : FALSE];

const pinsFor = (type: FlipFlopType, vars: readonly string[]): string[] =>
  type === "jk" ? vars.flatMap((v) => [`J${v}`, `K${v}`]) : vars.map((v) => `${type.toUpperCase()}${v}`);

/**
 * Design a counter for `sequence`.
 *
 * The width is taken from the largest state in the sequence, not from its
 * length: counting 0, 3, 5, 6 needs three flip-flops even though it is four
 * states long, and sizing it by the count would silently drop the top bit.
 */
export function designCounter(
  sequence: readonly number[],
  type: FlipFlopType = "jk",
): CounterResult {
  if (sequence.length === 0) return { ok: false, error: { kind: "empty" } };
  if (sequence.length < 2) return { ok: false, error: { kind: "too-short" } };

  const seen = new Set<number>();
  for (const state of sequence) {
    // A repeated state has two different successors, which is not a function —
    // no combinational logic can produce it, and no amount of minimizing will
    // help. Say so rather than quietly building the last one.
    if (seen.has(state)) return { ok: false, error: { kind: "duplicate", state } };
    seen.add(state);
  }

  const highest = Math.max(...sequence);
  const bits = Math.max(1, highest === 0 ? 1 : Math.floor(Math.log2(highest)) + 1);
  if (bits > MAX_COUNTER_BITS) return { ok: false, error: { kind: "too-wide", bits } };

  const stateVars = stateVarNames(bits);
  const pins = pinsFor(type, stateVars);
  const size = 1 << bits;

  const successor = new Map<number, number>();
  sequence.forEach((state, i) => {
    successor.set(state, sequence[(i + 1) % sequence.length] as number);
  });

  const rows: CounterRow[] = [];
  for (let state = 0; state < size; state++) {
    const present = bitsOf(state, bits);
    const next = successor.get(state) ?? null;
    const nextBits = next === null ? null : bitsOf(next, bits);

    const excitation: TruthValue[] = [];
    for (let b = 0; b < bits; b++) {
      const from = present[b] as 0 | 1;
      const to = nextBits?.[b] ?? null;
      if (to === null) {
        // An unused state constrains nothing at all.
        if (type === "jk") excitation.push(DONT_CARE, DONT_CARE);
        else excitation.push(DONT_CARE);
        continue;
      }
      if (type === "d") excitation.push(to === 1 ? TRUE : FALSE);
      else if (type === "t") excitation.push(from === to ? FALSE : TRUE);
      else excitation.push(...jkFor(from, to));
    }

    rows.push({ state, present, next, nextBits, excitation, used: next !== null });
  }

  const equations = pins.map((pin, column) => {
    const values = new Uint8Array(size);
    for (const row of rows) values[row.state] = row.excitation[column] ?? DONT_CARE;

    const fn: BooleanFunction = {
      name: pin,
      variables: stateVars,
      values,
      source: { kind: "truth-table" },
    };
    const minimal = minimize(fn, "sop");

    return {
      pin,
      expr: format(minimal.expression),
      minterms: rows.filter((r) => r.excitation[column] === TRUE).map((r) => r.state),
      dontCares: rows
        .filter((r) => r.excitation[column] === DONT_CARE)
        .map((r) => r.state),
      output: truthVector(minimal.expression, stateVars),
      literals: minimal.literals,
    } satisfies CounterEquation;
  });

  const unused = rows.filter((r) => !r.used).map((r) => r.state);
  const strays = strayStates(rows, equations, stateVars, type, bits, new Set(sequence));

  return {
    ok: true,
    design: {
      sequence,
      bits,
      stateVars,
      type,
      pins,
      rows,
      equations,
      unused,
      strays,
      selfCorrecting: strays.every((s) => s.recovers),
    },
  };
}

/**
 * Where an unused state actually goes, once the equations are fixed.
 *
 * The minimizer was free to choose anything for these, and it chose whatever
 * made the algebra smallest — which means the answer is a real property of the
 * finished circuit that nobody decided on purpose. A counter that cannot get
 * back into its own sequence from a power-up glitch is a genuine defect, and it
 * is invisible unless you look.
 */
function strayStates(
  rows: readonly CounterRow[],
  equations: readonly CounterEquation[],
  stateVars: readonly string[],
  type: FlipFlopType,
  bits: number,
  inSequence: ReadonlySet<number>,
): StrayState[] {
  const value = (column: number, state: number): 0 | 1 =>
    (equations[column]?.output[state] ?? 0) as 0 | 1;

  const step = (state: number): number => {
    const present = bitsOf(state, bits);
    let next = 0;
    for (let b = 0; b < bits; b++) {
      const q = present[b] as 0 | 1;
      let bit: 0 | 1;
      if (type === "d") bit = value(b, state);
      else if (type === "t") bit = ((value(b, state) ^ q) as 0 | 1);
      else {
        const j = value(b * 2, state);
        const k = value(b * 2 + 1, state);
        bit = ((j === 1 && q === 0) || (k === 0 && q === 1) ? 1 : 0) as 0 | 1;
      }
      next = (next << 1) | bit;
    }
    return next;
  };

  return rows
    .filter((r) => !r.used)
    .map((r) => {
      const goesTo = step(r.state);
      // Walk forward until we land in the sequence or repeat ourselves. The
      // state space is finite and `step` is deterministic, so this terminates.
      const visited = new Set<number>([r.state]);
      let at = goesTo;
      let recovers = false;
      while (!visited.has(at)) {
        if (inSequence.has(at)) {
          recovers = true;
          break;
        }
        visited.add(at);
        at = step(at);
      }
      if (inSequence.has(at)) recovers = true;
      return { state: r.state, goesTo, recovers };
    });
}

/** The parsed sequence, or null if the text does not describe one. */
export function parseSequence(text: string): number[] | null {
  const parts = text
    .split(/[\s,;>→-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    out.push(Number(part));
  }
  return out;
}
