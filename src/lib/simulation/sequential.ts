import { isDefinite, L0, L1, LX, LZ, type Logic } from "./logic";

/**
 * Flip-flops: the first thing in this simulator that has a yesterday.
 *
 * WHY THIS IS A SEPARATE FILE AND A SEPARATE PASS
 * ----------------------------------------------
 * Everything else here is combinational. `solver.ts` iterates a delta-cycle
 * fixpoint until the net vector stops changing, and its whole correctness
 * argument rests on that fixpoint being a pure function of the inputs. A
 * flip-flop breaks that: its output depends on what happened at the last clock
 * edge, and an EDGE is not something a fixpoint can perceive — by the time the
 * loop has settled, the transition that caused it is over.
 *
 * So state is kept out of the fixpoint entirely. Within a settle, a flip-flop is
 * a constant: it drives whatever it is currently storing. Between settles, the
 * solver compares each clock net against its value at the end of the previous
 * settle, and any flip-flop whose clock moved the right way samples its data
 * and updates. Then it settles again, because that output change may have moved
 * another flip-flop's clock — which is exactly what a ripple counter IS, and
 * why the loop has to repeat rather than run once.
 *
 * WHY A FLIP-FLOP POWERS UP AT X. A real one comes up in whichever state the
 * metastability happened to fall into; that is the entire reason every counter
 * you have ever seen has a CLEAR wired to it. Starting at 0 would make a
 * missing reset invisible, which is the same mistake as reading a floating
 * input as false — the one this simulator exists to refuse to make.
 */

export type FlopKind = "d" | "jk" | "t" | "sr";

/** Which clock transition loads the flip-flop. */
export type Edge = "rising" | "falling";

/** The two outputs. They are NOT always complementary — see `asyncOutputs`. */
export interface FlopOutputs {
  readonly q: Logic;
  readonly qn: Logic;
}

/**
 * The asynchronous inputs, both ACTIVE LOW, as every 74xx part has them.
 *
 * `null` means the part has no such pin — a '107 has clear and no preset — and
 * that is different from a pin sitting high. A missing pin can never assert; an
 * unconnected one is floating, and floating is not "inactive".
 */
export interface AsyncInputs {
  readonly preset: Logic | null;
  readonly clear: Logic | null;
}

/**
 * What preset and clear force, or `null` if neither is asserting.
 *
 * The nonstable case is real and is in the datasheet: hold both low and BOTH
 * outputs go high, which is not a state the flip-flop can keep once either one
 * is released. It is reported rather than smoothed over, because a student who
 * has wired preset and clear together has made a mistake worth naming.
 */
export function asyncOutputs(async: AsyncInputs): FlopOutputs | null {
  const { preset, clear } = async;
  const asserted = (v: Logic | null): boolean | null =>
    v === null ? false : v === L0 ? true : v === L1 ? false : null;

  const p = asserted(preset);
  const c = asserted(clear);

  // A floating or conflicting async pin is not "inactive" — it is a pin whose
  // effect nobody can predict, and the honest output is X.
  if (p === null || c === null) return { q: LX, qn: LX };
  if (p && c) return { q: L1, qn: L1 };
  if (p) return { q: L1, qn: L0 };
  if (c) return { q: L0, qn: L1 };
  return null;
}

/** Is this async combination the nonstable both-low one? */
export const bothAsyncAsserted = (async: AsyncInputs): boolean =>
  async.preset === L0 && async.clear === L0;

/**
 * The stored value after a clock edge.
 *
 * `data` is positional per kind: `[d]`, `[j, k]`, `[t]`, `[s, r]`. An
 * indeterminate data input produces an indeterminate state — clocking in a
 * floating D gives you X, not 0. That is the whole point of four-state logic
 * applied to the one place where the mistake becomes permanent: a combinational
 * gate forgets a bad input the moment it goes away, and a flip-flop does not.
 */
export function clockedNext(
  kind: FlopKind,
  data: readonly Logic[],
  q: Logic,
): Logic {
  switch (kind) {
    case "d": {
      const d = data[0] ?? LZ;
      return isDefinite(d) ? d : LX;
    }
    case "t": {
      const t = data[0] ?? LZ;
      if (!isDefinite(t)) return LX;
      if (t === L0) return q;
      return toggle(q);
    }
    case "jk": {
      const j = data[0] ?? LZ;
      const k = data[1] ?? LZ;
      if (!isDefinite(j) || !isDefinite(k)) return LX;
      if (j === L0 && k === L0) return q;
      if (j === L1 && k === L0) return L1;
      if (j === L0 && k === L1) return L0;
      return toggle(q);
    }
    case "sr": {
      const s = data[0] ?? LZ;
      const r = data[1] ?? LZ;
      if (!isDefinite(s) || !isDefinite(r)) return LX;
      if (s === L1 && r === L1) return LX; // forbidden, and it stays forbidden
      if (s === L1) return L1;
      if (r === L1) return L0;
      return q;
    }
  }
}

/** Hold and toggle both have to carry an unknown forward as unknown. */
const toggle = (q: Logic): Logic => (q === L0 ? L1 : q === L1 ? L0 : LX);

/**
 * Did the clock just do the thing this flip-flop triggers on?
 *
 * Only a definite 0->1 or 1->0 counts. A clock coming out of Z or X has not
 * "risen": nobody knows where it was, so nobody knows whether it crossed the
 * threshold, and inventing an edge there would clock in data on a wire that is
 * not connected to anything.
 */
export function isEdge(edge: Edge, before: Logic, after: Logic): boolean {
  if (!isDefinite(before) || !isDefinite(after)) return false;
  return edge === "rising" ? before === L0 && after === L1 : before === L1 && after === L0;
}

/** The outputs a flip-flop drives while it is simply holding `q`. */
export const heldOutputs = (q: Logic): FlopOutputs => ({
  q,
  qn: q === L0 ? L1 : q === L1 ? L0 : q === LZ ? LZ : LX,
});

/** How many data pins each kind has, and what they are called in order. */
export const DATA_PINS: Readonly<Record<FlopKind, readonly string[]>> = {
  d: ["D"],
  t: ["T"],
  jk: ["J", "K"],
  sr: ["S", "R"],
};

/** The power-up state of a real flip-flop: nobody knows. */
export const UNKNOWN: Logic = LX;

/** Never let `LZ` reach a stored bit — a flip-flop cannot store "floating". */
export const asStored = (v: Logic): Logic => (v === LZ ? LX : v);
