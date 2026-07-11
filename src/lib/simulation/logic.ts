/**
 * Four-state logic. Build this first; everything in the lab depends on it.
 *
 * WHY NOT BOOLEAN (Invariant 2)
 * -----------------------------
 * With only 0 and 1:
 *   - An unconnected input reads as `false`. The single most common lab mistake
 *     — a forgotten jumper — becomes invisible, and the circuit silently
 *     "works". The entire product value proposition dies right here.
 *   - Two conflicting drivers need a tiebreak, so an output-to-output short gets
 *     a plausible value instead of an error. The student ships a circuit that
 *     would smoke.
 *   - An unpowered IC has no way to say "I am outputting nothing".
 *
 * So: 0, 1, Z (floating / high-impedance), X (conflict / unknown).
 *
 * THE RULE: `Z` MUST NEVER COERCE TO `0`. Not in a gate table, not via `!!v`,
 * not in the LED renderer. And note the physics is counterintuitive — a floating
 * TTL input actually floats *high* — so if you ever "helpfully" default it,
 * defaulting to 0 is the worst available choice. The correct answer is always:
 * propagate X and raise a diagnostic.
 */

export const L0 = 0;
export const L1 = 1;
export const LZ = 2;
export const LX = 3;

export type Logic = 0 | 1 | 2 | 3;

export const LOGIC_NAMES: Readonly<Record<Logic, string>> = {
  [L0]: "0",
  [L1]: "1",
  [LZ]: "Z",
  [LX]: "X",
};

/**
 * Drive strength. Resolution happens in two stages: strongest class wins
 * outright, then equals fight it out through the table below.
 */
export type Strength = "supply" | "strong" | "pull" | "hiz";
//                       rails     outputs   resistors  inputs / tri-stated

const CLASS: Readonly<Record<Strength, number>> = {
  hiz: 0,
  pull: 1,
  strong: 2,
  supply: 2, // deliberately the SAME class as `strong` — see below
};

/**
 * `supply` and `strong` share a resolution class on purpose.
 *
 * If Vcc silently overrode a gate output, then wiring an output pin to the +5V
 * rail would resolve to a clean 1 and look like a working circuit. It is a dead
 * short that destroys the chip. Putting both in the driving class makes it
 * resolve to X, and a separate structural diagnostic (OUTPUT_DRIVES_RAIL) names
 * the exact pin. The finer tag survives only so the message can say "you
 * connected 1Y to +5V" instead of "two drivers conflict".
 */

/**
 * Resolution table for two drivers of equal strength.
 *
 *        0    1    Z    X
 *   0    0    X    0    X
 *   1    X    1    1    X
 *   Z    0    1    Z    X
 *   X    X    X    X    X
 *
 * Z is the identity element and 0-vs-1 is the short. Commutative and
 * associative, so a net's drivers can be reduced in any order — which is what
 * makes the solver's iteration order irrelevant to its answer.
 */
// prettier-ignore
const RESOLVE = new Uint8Array([
  /*        0   1   Z   X  */
  /* 0 */  L0, LX, L0, LX,
  /* 1 */  LX, L1, L1, LX,
  /* Z */  L0, L1, LZ, LX,
  /* X */  LX, LX, LX, LX,
]);

export const resolvePair = (a: Logic, b: Logic): Logic =>
  RESOLVE[a * 4 + b] as Logic;

export interface Driver {
  readonly value: Logic;
  readonly strength: Strength;
}

/**
 * Resolve everything driving one net.
 *
 * Stage 1 (strength class) is what lets a pull-up resistor lose to a gate output
 * *without* raising an error — which is physically correct. Stage 2 (the table)
 * is what turns two conflicting outputs into X, which is how we detect the
 * short. Returns Z when nothing drives the net at all: that is a floating net,
 * not a 0.
 */
export function resolveNet(drivers: readonly Driver[]): Logic {
  let bestClass = -1;
  let acc: Logic = LZ;

  for (const d of drivers) {
    if (d.strength === "hiz" || d.value === LZ) continue;

    const c = CLASS[d.strength];
    if (c > bestClass) {
      bestClass = c;
      acc = d.value;
    } else if (c === bestClass) {
      acc = resolvePair(acc, d.value);
    }
  }

  return acc;
}

// ---------------------------------------------------------------------------
// Gate tables
// ---------------------------------------------------------------------------

export type GateOp =
  | "and"
  | "or"
  | "nand"
  | "nor"
  | "xor"
  | "xnor"
  | "not"
  | "buf";

/**
 * Evaluate a gate over 4-state inputs.
 *
 * CONTROLLING VALUES MATTER. `AND(0, X) = 0`, because a 0 on an AND input forces
 * the output regardless of what the other input is doing. `OR(1, X) = 1`
 * likewise. If X were unconditionally contagious, a single floating pin would
 * turn the whole board red and the diagnostic would be worthless.
 *
 * But do NOT over-generalize that: XOR and XNOR have NO controlling value, so
 * any X or Z input makes them X. Getting this table exactly right is why there
 * is a test asserting all sixteen cells of every operator.
 *
 * A Z at a gate *input* is treated as X — a floating TTL input is not a logic
 * level — and separately raises FLOATING_INPUT. It must never become 0.
 */
export function evalGate(op: GateOp, inputs: readonly Logic[]): Logic {
  switch (op) {
    case "not":
      return invert(sanitize(inputs[0] ?? LZ));
    case "buf":
      return sanitize(inputs[0] ?? LZ);

    case "and":
      return andFold(inputs);
    case "nand":
      return invert(andFold(inputs));

    case "or":
      return orFold(inputs);
    case "nor":
      return invert(orFold(inputs));

    case "xor":
      return xorFold(inputs);
    case "xnor":
      return invert(xorFold(inputs));
  }
}

/** A floating input is not a logic level. Z at an input reads as unknown. */
const sanitize = (v: Logic): Logic => (v === LZ ? LX : v);

const invert = (v: Logic): Logic => (v === L0 ? L1 : v === L1 ? L0 : LX);

/** 0 is AND's controlling value: one 0 forces the output, unknowns be damned. */
function andFold(inputs: readonly Logic[]): Logic {
  let sawUnknown = false;
  for (const raw of inputs) {
    const v = sanitize(raw);
    if (v === L0) return L0;
    if (v === LX) sawUnknown = true;
  }
  return sawUnknown ? LX : L1;
}

/** 1 is OR's controlling value. */
function orFold(inputs: readonly Logic[]): Logic {
  let sawUnknown = false;
  for (const raw of inputs) {
    const v = sanitize(raw);
    if (v === L1) return L1;
    if (v === LX) sawUnknown = true;
  }
  return sawUnknown ? LX : L0;
}

/** XOR has no controlling value: every input matters, so any unknown wins. */
function xorFold(inputs: readonly Logic[]): Logic {
  let parity = 0;
  for (const raw of inputs) {
    const v = sanitize(raw);
    if (v === LX) return LX;
    parity ^= v;
  }
  return (parity & 1) as Logic;
}

/** Is this a driven, definite logic level? The one place a `Logic` may become boolean. */
export const isDefinite = (v: Logic): v is 0 | 1 => v === L0 || v === L1;

export const toBit = (v: Logic): 0 | 1 | null => (isDefinite(v) ? v : null);
