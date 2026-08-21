import * as C from "../catalog";
import type { Diagram, Endpoint } from "../types";
import { Sketch, at } from "./kit";

/**
 * Adders, complementers and the "compute 3Q+1" family.
 *
 * The organising idea: an arithmetic answer is a BLOCK diagram, and the blocks
 * are adders. An 8-bit adder's truth table has 2^17 rows — nobody minimizes one,
 * and a question that says "using a 4-bit adder" is telling you the block is the
 * primitive. So none of these builders synthesize gates; they wire up boxes, and
 * the boxes' internals live in the lab if you want to open them.
 */

// --- ripple-carry adder -----------------------------------------------------

export interface RippleAdderOptions {
  readonly id?: string;
  readonly bits: number;
  readonly title?: string;
  readonly caption?: string;
  /** Tie the operands to these constants instead of drawing input tags. */
  readonly a?: number;
  readonly b?: number;
  readonly carryIn?: 0 | 1;
}

/**
 * n full adders in a chain, carry rippling from bit 0 upward.
 *
 * Drawn LSB at the top so the carry runs downward and left-to-right, which is
 * the direction a reader's eye already travels. Drawing it MSB-first — the way
 * the number is written — makes the one signal the diagram exists to show run
 * backwards up the page.
 */
export function rippleAdderDiagram(opts: RippleAdderOptions): Diagram {
  const s = new Sketch();
  const bits = Math.max(1, opts.bits);
  const literal = opts.a !== undefined && opts.b !== undefined;

  const bitOf = (value: number, i: number): 0 | 1 => ((value >>> i) & 1) as 0 | 1;

  for (let i = 0; i < bits; i++) {
    const fa = s.add(C.fullAdder(`FA${i}`, `FA${i}`));

    const aSrc = literal
      ? s.add(C.constant(`ca${i}`, bitOf(opts.a as number, i)))
      : s.add(C.input(`A${i}`, `A${i}`));
    const bSrc = literal
      ? s.add(C.constant(`cb${i}`, bitOf(opts.b as number, i)))
      : s.add(C.input(`B${i}`, `B${i}`));
    s.wire(at(aSrc, "Y"), at(fa, "A"));
    s.wire(at(bSrc, "Y"), at(fa, "B"));

    if (i === 0) {
      const cin = s.add(C.constant("cin", opts.carryIn ?? 0));
      s.wire(at(cin, "Y"), at(fa, "Cin"));
    } else {
      s.wire(at(`FA${i - 1}`, "Cout"), at(fa, "Cin"));
    }

    const sum = s.add(C.output(`S${i}`, `S${i}`));
    s.wire(at(fa, "S"), at(sum, "A"));
  }

  const cout = s.add(C.output("Cout", `C${bits}`));
  s.wire(at(`FA${bits - 1}`, "Cout"), at(cout, "A"));

  s.note(
    "Each stage adds one bit of A, one bit of B and the carry out of the stage below it.",
  );
  s.note(
    `The top sum bit cannot settle until the carry has walked all ${bits} stages — that delay is the whole reason carry-lookahead exists.`,
  );
  if (literal) {
    const a = opts.a as number;
    const b = opts.b as number;
    const total = a + b + (opts.carryIn ?? 0);
    s.note(
      `${a.toString(2).padStart(bits, "0")} + ${b.toString(2).padStart(bits, "0")} = ${total
        .toString(2)
        .padStart(bits + 1, "0")}  (${a} + ${b} = ${total})`,
    );
  }

  return s.done({
    id: opts.id ?? `ripple${bits}`,
    title: opts.title ?? `${bits}-bit ripple-carry adder`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

/** The same addition, but as ONE box — the level of detail Q10 actually asks for. */
export function adderBlockDiagram(opts: {
  readonly bits: number;
  readonly a?: number;
  readonly b?: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const bits = opts.bits;
  const add = s.add(C.adder("ADD", bits, { bussed: true }));

  const label = (v: number | undefined, name: string): string =>
    v === undefined ? name : v.toString(2).padStart(bits, "0");

  const a = s.add(C.input("A", label(opts.a, `A${bits - 1}..A0`)));
  const b = s.add(C.input("B", label(opts.b, `B${bits - 1}..B0`)));
  const cin = s.add(C.constant("cin", 0));
  s.wire(at(a, "Y"), at(add, "A"), { width: bits });
  s.wire(at(b, "Y"), at(add, "B"), { width: bits });
  s.wire(at(cin, "Y"), at(add, "Cin"));

  const total =
    opts.a !== undefined && opts.b !== undefined ? opts.a + opts.b : undefined;
  const sum = s.add(
    C.output("S", total === undefined ? `S${bits - 1}..S0` : (total & ((1 << bits) - 1)).toString(2).padStart(bits, "0")),
  );
  const carry = s.add(
    C.output("COUT", total === undefined ? `C${bits}` : String((total >>> bits) & 1)),
  );
  s.wire(at(add, "S"), at(sum, "A"), { width: bits });
  s.wire(at(add, "Cout"), at(carry, "A"));

  if (total !== undefined) {
    s.note(
      `${(opts.a as number).toString(2).padStart(bits, "0")} + ${(opts.b as number)
        .toString(2)
        .padStart(bits, "0")} = ${total.toString(2).padStart(bits + 1, "0")}  (${opts.a} + ${opts.b} = ${total})`,
    );
    if (total >= 1 << bits) {
      s.note(
        `The result needs ${bits + 1} bits, so C${bits} is 1 — in ${bits}-bit unsigned arithmetic that is an overflow, and the carry-out is the flag that says so.`,
      );
    }
  }
  s.note(`The slash and the ${bits} on a line mean ${bits} parallel wires, not one.`);

  return s.done({
    id: opts.id ?? "adderblock",
    title: opts.title ?? `${bits}-bit parallel adder`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- two's complement -------------------------------------------------------

export type ComplementStyle = "invert-add-one" | "scan";

/**
 * The 2's complement of an n-bit number, two ways.
 *
 * `invert-add-one` is the definition, drawn: NOT every bit, then add 1 — and the
 * neat part is that the "+1" costs NOTHING, because a parallel adder already has
 * a carry-in sitting unused.
 *
 * `scan` is the trick you do by hand: copy the bits from the right up to and
 * INCLUDING the first 1, invert everything above it. As a circuit that is one
 * XOR per bit, with an OR chain carrying "have I seen a 1 yet" upward — no adder
 * at all, and no carry propagation, so it is also the faster of the two.
 */
export function twosComplementDiagram(opts: {
  readonly bits: number;
  readonly style?: ComplementStyle;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const bits = opts.bits;
  const style = opts.style ?? "invert-add-one";

  const inputs: Endpoint[] = [];
  for (let i = bits - 1; i >= 0; i--) {
    const tag = s.add(C.input(`A${i}`, `A${i}`));
    inputs[i] = at(tag, "Y");
  }

  if (style === "invert-add-one") {
    const add = s.add(C.adder("ADD", bits, { title: `${bits}-bit adder`, subtitle: "+1 via carry-in" }));
    for (let i = bits - 1; i >= 0; i--) {
      const inv = s.add(C.gate(`inv${i}`, "not", 1, `A${i}'`));
      s.wire(inputs[i] as Endpoint, at(inv, "A"));
      s.wire(at(inv, "Y"), at(add, `A${i}`));
      const zero = s.add(C.constant(`z${i}`, 0));
      s.wire(at(zero, "Y"), at(add, `B${i}`));
    }
    const one = s.add(C.constant("one", 1));
    s.wire(at(one, "Y"), at(add, "Cin"));

    for (let i = bits - 1; i >= 0; i--) {
      const out = s.add(C.output(`Y${i}`, `Y${i}`));
      s.wire(at(add, `S${i}`), at(out, "A"));
    }
    s.note("Invert every bit, then add one. That is the definition of 2's complement.");
    s.note(
      "The +1 is free: the adder's carry-in is otherwise unused, so tying it to 1 costs no extra gate at all. B is tied to 0000.",
    );
    s.note(
      "The carry-out is discarded — in n-bit modular arithmetic, 2^n - A is the answer and the 2^n never appears.",
    );
  } else {
    // "have we passed a 1 yet", accumulated from the LSB upward.
    let seen: Endpoint | null = null;
    for (let i = 0; i < bits; i++) {
      const x = s.add(C.gate(`x${i}`, "xor", 2, `Y${i}`));
      s.wire(inputs[i] as Endpoint, at(x, "A"));
      if (seen === null) {
        const zero = s.add(C.constant("z0", 0));
        s.wire(at(zero, "Y"), at(x, "B"));
      } else {
        s.wire(seen, at(x, "B"));
      }
      const out = s.add(C.output(`Y${i}`, `Y${i}`));
      s.wire(at(x, "Y"), at(out, "A"));

      if (i < bits - 1) {
        const or = s.add(C.gate(`o${i}`, "or", 2, `seen≤${i}`));
        s.wire(inputs[i] as Endpoint, at(or, "A"));
        if (seen === null) {
          const zero = s.add(C.constant(`zz${i}`, 0));
          s.wire(at(zero, "Y"), at(or, "B"));
        } else {
          s.wire(seen, at(or, "B"));
        }
        seen = at(or, "Y");
      }
    }
    s.note(
      "By hand you copy bits from the right up to and including the first 1, then invert the rest.",
    );
    s.note(
      "The OR chain carries 'a 1 has already been seen below this bit'; the XOR inverts a bit exactly when that is true.",
    );
    s.note(
      "No adder and no carry propagation, so this settles in two gate delays per bit instead of rippling across the whole word.",
    );
  }

  return s.done({
    id: opts.id ?? `twos${bits}`,
    title: opts.title ?? `${bits}-bit 2's complement`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- multiply by a constant, then add one ----------------------------------

export interface ScaleOptions {
  readonly bits: number;
  /** Must be `1 + 2^s` — the shift-and-add case an exam gives you an adder for. */
  readonly multiplier: number;
  readonly offset: 0 | 1;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
  readonly variable?: string;
  readonly result?: string;
}

/**
 * P = m·Q + c, built from ONE n-bit adder plus a couple of gates. (Q42.)
 *
 * The insight the question is testing: multiplying by 3 is not a multiplier. 3Q
 * is 2Q + Q, 2Q is Q wired one position to the left — a SHIFT IS FREE, it is
 * where you solder the wire — and the +1 is the adder's spare carry-in. So the
 * whole of "compute 3Q+1" is one adder, some rewiring, and a half adder to catch
 * the bits that fall off the top.
 */
export function scaleDiagram(opts: ScaleOptions): Diagram {
  const s = new Sketch();
  const bits = opts.bits;
  const v = opts.variable ?? "Q";
  const r = opts.result ?? "P";
  const shift = Math.round(Math.log2(opts.multiplier - 1));
  if (opts.multiplier !== 1 + 2 ** shift || shift < 1) {
    throw new Error(
      `scaleDiagram supports a multiplier of the form 1 + 2^s; got ${opts.multiplier}`,
    );
  }

  const tag = new Map<number, Endpoint>();
  for (let i = bits - 1; i >= 0; i--) {
    const id = s.add(C.input(`${v}${i}`, `${v}${i}`));
    tag.set(i, at(id, "Y"));
  }

  const add = s.add(
    C.adder("ADD", bits, {
      title: `${bits}-bit adder`,
      subtitle: `${v} + ${2 ** shift}${v}`,
    }),
  );

  // A = Q. B = Q shifted left by `shift`, which means bit i of B is bit i-shift
  // of Q — and the bottom `shift` bits of B are hard zeros.
  for (let i = bits - 1; i >= 0; i--) {
    s.wire(tag.get(i) as Endpoint, at(add, `A${i}`));
    const src = i - shift;
    if (src >= 0) {
      s.wire(tag.get(src) as Endpoint, at(add, `B${i}`));
    } else {
      const z = s.add(C.constant(`bz${i}`, 0));
      s.wire(at(z, "Y"), at(add, `B${i}`));
    }
  }
  const cin = s.add(C.constant("cin", opts.offset));
  s.wire(at(cin, "Y"), at(add, "Cin"));

  for (let i = bits - 1; i >= 0; i--) {
    const out = s.add(C.output(`${r}${i}`, `${r}${i}`));
    s.wire(at(add, `S${i}`), at(out, "A"));
  }

  // The `shift` top bits of Q never entered the adder — they are the high half
  // of 2Q. They have to be added to the carry that came out of the adder.
  let carry: Endpoint = at(add, "Cout");
  for (let k = 0; k < shift; k++) {
    const bit = bits - shift + k;
    const ha = s.add(C.halfAdder(`HA${k}`, `HA${k}`));
    s.wire(tag.get(bit) as Endpoint, at(ha, "A"));
    s.wire(carry, at(ha, "B"));
    const out = s.add(C.output(`${r}${bits + k}`, `${r}${bits + k}`));
    s.wire(at(ha, "S"), at(out, "A"));
    carry = at(ha, "C");
  }
  const top = s.add(C.output(`${r}${bits + shift}`, `${r}${bits + shift}`));
  s.wire(carry, at(top, "A"));

  s.note(
    `${opts.multiplier}${v} = ${2 ** shift}${v} + ${v}, and ${2 ** shift}${v} is just ${v} wired ${shift} position${shift === 1 ? "" : "s"} to the left. A shift costs no gates.`,
  );
  s.note(
    `The adder's B input is ${v}${bits - 1 - shift}..${v}0 followed by ${shift} zero${shift === 1 ? "" : "s"}; its A input is ${v} unshifted.`,
  );
  if (opts.offset === 1) {
    s.note(`The "+1" is the adder's carry-in tied to +5V — no extra hardware.`);
  }
  s.note(
    `${v} is ${bits} bits, so ${r} needs ${bits + shift + 1}: the top bits of ${2 ** shift}${v} never reach the adder and are combined with its carry-out by the half adder${shift === 1 ? "" : "s"}.`,
  );

  return s.done({
    id: opts.id ?? "scale",
    title: opts.title ?? `${r} = ${opts.multiplier}·${v}${opts.offset ? " + 1" : ""}`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- comparator -------------------------------------------------------------

/**
 * "Are these two n-bit numbers equal?" (Q13.)
 *
 * XNOR is the equality gate — it is 1 exactly when its two inputs match — so bit
 * equality is one XNOR per bit and word equality is the AND of all of them. It is
 * worth noticing that the obvious alternative, comparing the numbers by
 * subtracting them, needs a whole adder to answer a question n XNORs answer
 * flat.
 */
export function equalityComparatorDiagram(opts: {
  readonly bits: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
  readonly magnitude?: boolean;
}): Diagram {
  const s = new Sketch();
  const bits = opts.bits;

  const and = s.add(C.gate("EQ", "and", bits, "A = B"));
  for (let i = bits - 1; i >= 0; i--) {
    const a = s.add(C.input(`A${i}`, `A${i}`));
    const b = s.add(C.input(`B${i}`, `B${i}`));
    const x = s.add(C.gate(`x${i}`, "xnor", 2, `A${i} ⊙ B${i}`));
    s.wire(at(a, "Y"), at(x, "A"));
    s.wire(at(b, "Y"), at(x, "B"));
    const pin = "ABCDEFGH"[bits - 1 - i];
    if (pin) s.wire(at(x, "Y"), at(and, pin));
  }
  const out = s.add(C.output("OUT", "A = B"));
  s.wire(at(and, "Y"), at(out, "A"));

  s.note("XNOR is the equality gate: its output is 1 exactly when its two inputs agree.");
  s.note(
    `All ${bits} bit-comparisons must agree at once, so they are ANDed. One mismatched bit anywhere pulls the output to 0.`,
  );
  if (opts.magnitude) {
    s.note(
      "For A>B and A<B as well, compare from the MSB down: the first position where the bits differ decides it, and the equality terms above it are exactly the XNORs already drawn here.",
    );
  }

  return s.done({
    id: opts.id ?? `eq${bits}`,
    title: opts.title ?? `${bits}-bit equality comparator`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}
