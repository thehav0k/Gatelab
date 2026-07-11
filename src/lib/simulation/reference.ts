import { evalGate, isDefinite, type GateOp, type Logic } from "./logic";
import { IC_LIBRARY, type IcDefinition } from "./ic-library";
import { GATE_LABELS } from "./parts";

/**
 * The reference material behind the manual's gate and chip pages.
 *
 * THE TRUTH TABLES ARE COMPUTED, NOT TYPED. Every row here comes from calling the
 * simulator's own `evalGate`. A hand-written table in a docs page is a second
 * source of truth that drifts the first time somebody touches the gate logic and
 * forgets the prose — and a *reference manual that is wrong* is worse than no
 * reference at all, because it is believed. If the simulator's XOR were broken,
 * this page would print the broken table, and the test suite that pins `evalGate`
 * would be the thing that fails.
 *
 * Same rule for the chips: the pinouts are read straight out of `ic-library.ts`,
 * which is transcribed from the datasheets and validated on load.
 */

// --- gates ------------------------------------------------------------------

export interface GateProperty {
  readonly name: string;
  readonly holds: boolean;
  readonly detail: string;
}

export interface GateDoc {
  readonly op: GateOp;
  readonly label: string;
  /** The algebraic form, with the operator symbol a textbook would use. */
  readonly algebra: string;
  readonly definition: string;
  /** Rows of a 2-input table (1-input for NOT/BUF): inputs, then the output. */
  readonly table: readonly { readonly inputs: readonly (0 | 1)[]; readonly out: 0 | 1 }[];
  readonly properties: readonly GateProperty[];
  /** Why an engineer reaches for this one. */
  readonly note: string;
  /** The chips in the library that contain it. */
  readonly chips: readonly string[];
}

/** Every 2ⁿ input combination, as definite bits. */
const combinations = (n: number): (0 | 1)[][] =>
  Array.from({ length: 1 << n }, (_, m) =>
    Array.from({ length: n }, (_, i) => ((m >>> (n - 1 - i)) & 1) as 0 | 1),
  );

/** The gate's own table, straight from the simulator. */
function tableFor(op: GateOp, arity: number) {
  return combinations(arity).map((inputs) => {
    const out = evalGate(op, inputs as readonly Logic[]);
    if (!isDefinite(out)) {
      // Definite inputs must give a definite output; a gate that returns Z or X for
      // 0s and 1s is broken, and we would rather throw than document it.
      throw new Error(`${op} returned a non-definite value for definite inputs`);
    }
    return { inputs, out };
  });
}

/** Is the operator commutative — does swapping the inputs change anything? */
const isCommutative = (op: GateOp): boolean =>
  combinations(2).every(
    ([a, b]) => evalGate(op, [a!, b!]) === evalGate(op, [b!, a!]),
  );

/** Is it associative — does (a∘b)∘c equal a∘(b∘c)? */
const isAssociative = (op: GateOp): boolean =>
  combinations(3).every(([a, b, c]) => {
    const left = evalGate(op, [evalGate(op, [a!, b!]), c!]);
    const right = evalGate(op, [a!, evalGate(op, [b!, c!])]);
    return left === right;
  });

/** A value e with a ∘ e = a for every a. */
const identityOf = (op: GateOp): 0 | 1 | null => {
  for (const e of [0, 1] as const) {
    if (([0, 1] as const).every((a) => evalGate(op, [a, e]) === a)) return e;
  }
  return null;
};

/** A value z with a ∘ z = z for every a — the value that swallows everything. */
const annihilatorOf = (op: GateOp): 0 | 1 | null => {
  for (const z of [0, 1] as const) {
    if (([0, 1] as const).every((a) => evalGate(op, [a, z]) === z)) return z;
  }
  return null;
};

/**
 * Can this gate, alone, build every Boolean function? Only NAND and NOR can, and
 * that is exactly why the 7400 is the most common chip ever made.
 */
const UNIVERSAL: ReadonlySet<GateOp> = new Set<GateOp>(["nand", "nor"]);

const chipsWith = (op: GateOp): string[] =>
  IC_LIBRARY.filter((d) => d.op === op).map((d) => d.part);

interface Seed {
  readonly algebra: string;
  readonly definition: string;
  readonly note: string;
  readonly arity: number;
}

const SEEDS: Readonly<Record<GateOp, Seed>> = {
  and: {
    algebra: "Y = A · B",
    definition: "The output is 1 only when EVERY input is 1.",
    note: "AND is a gate that asks 'are all of these true?'. Its controlling value is 0: a single 0 on any input forces the output to 0, whatever the others are doing — which is why AND(0, X) is 0 and not X.",
    arity: 2,
  },
  or: {
    algebra: "Y = A + B",
    definition: "The output is 1 when ANY input is 1.",
    note: "The dual of AND. Its controlling value is 1: one input at 1 decides the output on its own, so OR(1, X) is 1 even with a floating second input.",
    arity: 2,
  },
  not: {
    algebra: "Y = A′",
    definition: "The output is the opposite of the input.",
    note: "An inverter. You rarely buy one: NOT is free inside a NAND or NOR package — tie both inputs together and NAND(a, a) = a′ — which is why a NAND-only design usually needs no 7404 at all.",
    arity: 1,
  },
  nand: {
    algebra: "Y = (A · B)′",
    definition: "AND, inverted. The output is 0 only when every input is 1.",
    note: "UNIVERSAL: every Boolean function can be built from NAND alone. That, plus the fact that it is the cheapest gate to make in TTL, is why the 7400 is the most-produced logic chip in history.",
    arity: 2,
  },
  nor: {
    algebra: "Y = (A + B)′",
    definition: "OR, inverted. The output is 1 only when every input is 0.",
    note: "Also UNIVERSAL, and the dual of NAND. The Apollo Guidance Computer was built almost entirely from NOR gates — about 5,600 of them, and nothing else.",
    arity: 2,
  },
  xor: {
    algebra: "Y = A ⊕ B",
    definition: "The output is 1 when the inputs DIFFER.",
    note: "The difference detector, and the sum bit of an adder. It has NO controlling value — no single input can decide the output alone — so XOR(anything, X) is X. It is also affine, which is why a rule of 'XOR only' can never build an AND.",
    arity: 2,
  },
  xnor: {
    algebra: "Y = (A ⊕ B)′",
    definition: "The output is 1 when the inputs are the SAME.",
    note: "The equality detector. An n-bit comparator is n XNORs and an AND.",
    arity: 2,
  },
  buf: {
    algebra: "Y = A",
    definition: "The output copies the input.",
    note: "Logically it does nothing — which is the point. A buffer exists to restore a weak signal and to drive more inputs than the source could manage alone.",
    arity: 1,
  },
};

export const GATE_DOCS: readonly GateDoc[] = (
  ["and", "or", "not", "nand", "nor", "xor", "xnor"] as const
).map((op): GateDoc => {
  const seed = SEEDS[op];
  const unary = seed.arity === 1;
  const identity = unary ? null : identityOf(op);
  const annihilator = unary ? null : annihilatorOf(op);

  /**
   * A ONE-INPUT gate has no commutativity and no associativity — not "false", but
   * undefined: there is no second input to swap and no third to regroup. Printing a
   * red cross beside them would teach something that is simply not true.
   */
  const properties: GateProperty[] = unary
    ? [
        {
          name: "Involution",
          holds: true,
          detail:
            "(A′)′ = A — invert twice and you are back where you started, which is why a double inverter is a buffer.",
        },
        {
          name: "Universal",
          holds: false,
          detail:
            "NOT alone cannot express every function — it cannot combine two signals at all.",
        },
      ]
    : [
        {
          name: "Commutative",
          holds: isCommutative(op),
          detail: "A ∘ B = B ∘ A — the order of the inputs does not matter.",
        },
        {
          name: "Associative",
          holds: isAssociative(op),
          detail: isAssociative(op)
            ? "(A ∘ B) ∘ C = A ∘ (B ∘ C) — so it chains, and a wide version means what you expect."
            : "(A ∘ B) ∘ C ≠ A ∘ (B ∘ C) — so a CHAIN of them is not the same as one wide gate. You cannot widen it by chaining; that is what the 7410 and 7420 are for.",
        },
        {
          name: "Universal",
          holds: UNIVERSAL.has(op),
          detail: UNIVERSAL.has(op)
            ? "Every Boolean function can be built from this gate alone."
            : "This gate alone cannot express every function; it needs help.",
        },
      ];

  if (identity !== null) {
    properties.push({
      name: `Identity: ${identity}`,
      holds: true,
      detail: `A ∘ ${identity} = A — feeding a constant ${identity} leaves the other input untouched, which is how you disable an input you are not using.`,
    });
  }
  if (annihilator !== null) {
    properties.push({
      name: `Annihilator: ${annihilator}`,
      holds: true,
      detail: `A ∘ ${annihilator} = ${annihilator} — a single ${annihilator} decides the output on its own, whatever else is happening.`,
    });
  }

  return {
    op,
    label: GATE_LABELS[op],
    algebra: seed.algebra,
    definition: seed.definition,
    table: tableFor(op, seed.arity),
    properties,
    note: seed.note,
    chips: chipsWith(op),
  };
});

// --- chips ------------------------------------------------------------------

export interface IcDoc {
  readonly part: string;
  readonly name: string;
  readonly op: GateOp;
  readonly gateCount: number;
  readonly inputsPerGate: number;
  readonly pinCount: number;
  /** [pin number, pin name] down the left side and up the right, as printed. */
  readonly pins: readonly { readonly pin: number; readonly name: string }[];
  readonly vcc: number;
  readonly gnd: number;
}

/**
 * The library stores the power pins by NAME, because that is what the datasheet
 * prints. The manual wants the NUMBER — "pin 14", not "VCC" — because that is what
 * you count round the notch when the chip is in front of you.
 */
const pinNumberOf = (d: IcDefinition, name: string): number =>
  d.pinNames.indexOf(name) + 1;

export const IC_DOCS: readonly IcDoc[] = IC_LIBRARY.map((d: IcDefinition) => ({
  part: d.part,
  name: d.name,
  op: d.op,
  gateCount: d.gateCount,
  inputsPerGate: d.inputsPerGate,
  pinCount: d.pinNames.length,
  pins: d.pinNames.map((name, i) => ({ pin: i + 1, name })),
  vcc: pinNumberOf(d, d.power.vcc),
  gnd: pinNumberOf(d, d.power.gnd),
}));

/**
 * The four-state values, explained. This is the thing that separates the lab from
 * a boolean simulator, so the manual has to say what each one MEANS on a bench.
 */
export const LOGIC_DOCS = [
  {
    value: "0",
    name: "Low",
    meaning: "A net driven to ground. In TTL, anything below about 0.8 V.",
  },
  {
    value: "1",
    name: "High",
    meaning: "A net driven to +5 V. In TTL, anything above about 2.0 V.",
  },
  {
    value: "Z",
    name: "Floating",
    meaning:
      "Nothing is driving this net at all. It is NOT 0 — a real TTL input left floating drifts HIGH and behaves unpredictably, so reading it as 0 is the worst available guess. Gatelab propagates it and raises a fault instead.",
  },
  {
    value: "X",
    name: "Conflict",
    meaning:
      "Two drivers disagree — one is pulling the net to 0 while another pulls it to 1. On a real board this is a short, and it is the one that gets hot.",
  },
] as const;
