import { evalGate, L0, L1, type GateOp, type Logic } from "./logic";

/**
 * IS THIS SET OF GATES ENOUGH TO BUILD ANYTHING?
 *
 * An instructor can say "OR and NOT only", or "XOR only", and the honest answer
 * to the second is: *you cannot*. XOR (with any number of inputs, and even with
 * constants) can only ever produce affine functions — a·b is not one of them, so
 * no amount of cleverness gets you an AND gate. Letting a student hunt for a
 * circuit that provably does not exist is the cruellest thing this app could do.
 *
 * POST'S CRITERION settles it exactly. A set of Boolean functions is
 * functionally complete iff it is NOT wholly contained in any of the five
 * maximal clones:
 *
 *   T0  preserves 0        f(0,…,0) = 0
 *   T1  preserves 1        f(1,…,1) = 1
 *   M   monotone           x ≤ y  ⇒  f(x) ≤ f(y)   (bitwise)
 *   D   self-dual          f(¬x)  = ¬f(x)
 *   A   affine             f is a XOR of some inputs and a constant
 *
 * Escape all five and you can build every Boolean function; fail to escape even
 * one and there is an entire class you can never reach.
 *
 * CONSTANTS. The lab has a +5V rail and a GND rail, so the constants 0 and 1 are
 * always available. That matters enormously: the constant 1 is not 0-preserving
 * and the constant 0 is not 1-preserving, so having the rails demolishes T0 and
 * T1 for free. It is why {XOR, AND} — which is trapped in T0 on its own — becomes
 * complete the moment you can tie an input high. The check below models that,
 * because the alternative is to tell a student their perfectly buildable circuit
 * is impossible.
 */

/** A Boolean function as a truth table over `arity` inputs, MSB-first. */
interface TruthFn {
  readonly arity: number;
  /** values[i] for input pattern i. */
  readonly values: readonly (0 | 1)[];
}

const truthFnOf = (op: GateOp, arity: number): TruthFn => {
  const rows = 1 << arity;
  const values: (0 | 1)[] = [];
  for (let m = 0; m < rows; m++) {
    const inputs: Logic[] = [];
    for (let i = 0; i < arity; i++) {
      inputs.push(((m >>> (arity - 1 - i)) & 1) === 1 ? L1 : L0);
    }
    values.push(evalGate(op, inputs) === L1 ? 1 : 0);
  }
  return { arity, values };
};

const CONST_0: TruthFn = { arity: 1, values: [0, 0] };
const CONST_1: TruthFn = { arity: 1, values: [1, 1] };

// --- the five maximal clones ------------------------------------------------

const preservesZero = (f: TruthFn): boolean => f.values[0] === 0;

const preservesOne = (f: TruthFn): boolean =>
  f.values[f.values.length - 1] === 1;

/** Monotone: flipping any input from 0 to 1 can never take the output 1 -> 0. */
function isMonotone(f: TruthFn): boolean {
  const rows = 1 << f.arity;
  for (let a = 0; a < rows; a++) {
    for (let b = 0; b < rows; b++) {
      // a <= b bitwise
      if ((a & b) !== a) continue;
      if ((f.values[a] as number) > (f.values[b] as number)) return false;
    }
  }
  return true;
}

/** Self-dual: f(¬x) = ¬f(x) for every input. */
function isSelfDual(f: TruthFn): boolean {
  const rows = 1 << f.arity;
  const mask = rows - 1;
  for (let m = 0; m < rows; m++) {
    if (f.values[m] === f.values[m ^ mask]) return false;
  }
  return true;
}

/**
 * Affine: f is a XOR of a subset of its inputs, plus a constant.
 *
 * Computed by the Möbius transform — the Zhegalkin (algebraic normal form)
 * coefficients. A function is affine exactly when no coefficient of degree 2 or
 * higher survives, i.e. it has no AND term in it anywhere.
 */
function isAffine(f: TruthFn): boolean {
  const rows = 1 << f.arity;
  const anf = [...f.values] as number[];

  for (let step = 1; step < rows; step <<= 1) {
    for (let i = 0; i < rows; i++) {
      if (i & step) anf[i] = (anf[i] as number) ^ (anf[i ^ step] as number);
    }
  }

  for (let i = 0; i < rows; i++) {
    if (anf[i] === 1 && popcount(i) > 1) return false;
  }
  return true;
}

const popcount = (x: number): number => {
  let n = 0;
  for (let v = x; v; v &= v - 1) n++;
  return n;
};

// --- the verdict -------------------------------------------------------------

export type CloneName = "T0" | "T1" | "M" | "D" | "A";

export const CLONE_REASON: Readonly<Record<CloneName, string>> = {
  T0: "every one of these gates outputs 0 when all its inputs are 0, so the output can never be 1 with all-zero inputs.",
  T1: "every one of these gates outputs 1 when all its inputs are 1, so the output can never be 0 with all-one inputs.",
  M: "every one of these gates is monotone — turning an input on can never turn the output off — so they can never build an inverter.",
  D: "every one of these gates is self-dual, so any circuit built from them is self-dual too, and most functions are not.",
  A: "every one of these gates is affine (a XOR of its inputs plus a constant). Affine functions are closed under composition, so no combination of them can ever produce an AND.",
};

export interface Completeness {
  readonly complete: boolean;
  /** The clones the whole set is trapped inside. Empty iff complete. */
  readonly trappedIn: readonly CloneName[];
  readonly reason: string | null;
}

/**
 * Can every Boolean function be built from these gates?
 *
 * `withConstants` defaults to TRUE, because the lab always has power rails.
 */
export function checkCompleteness(
  ops: readonly GateOp[],
  withConstants = true,
): Completeness {
  if (ops.length === 0) {
    return {
      complete: false,
      trappedIn: [],
      reason: "No gates are allowed at all.",
    };
  }

  // NOT and BUF are 1-input; everything else we model at arity 2, which is enough:
  // a clone is closed under composition, so an n-input AND is in exactly the same
  // clones as a 2-input one.
  const fns: TruthFn[] = ops.map((op) =>
    truthFnOf(op, op === "not" || op === "buf" ? 1 : 2),
  );

  // The rails. See the note at the top: these are what kill T0 and T1.
  if (withConstants) fns.push(CONST_0, CONST_1);

  const trapped: CloneName[] = [];
  if (fns.every(preservesZero)) trapped.push("T0");
  if (fns.every(preservesOne)) trapped.push("T1");
  if (fns.every(isMonotone)) trapped.push("M");
  if (fns.every(isSelfDual)) trapped.push("D");
  if (fns.every(isAffine)) trapped.push("A");

  if (trapped.length === 0) {
    return { complete: true, trappedIn: [], reason: null };
  }

  const first = trapped[0] as CloneName;
  return {
    complete: false,
    trappedIn: trapped,
    reason: CLONE_REASON[first],
  };
}

/** A short, human verdict for the UI. */
export function completenessSummary(ops: readonly GateOp[]): string {
  const r = checkCompleteness(ops);
  return r.complete
    ? "Universal — every Boolean function can be built from these."
    : `Not universal — ${r.reason}`;
}
