import { describe, expect, it } from "vitest";
import {
  designCounter,
  parseSequence,
  stateVarNames,
  MAX_COUNTER_BITS,
  type CounterDesign,
  type FlipFlopType,
} from "./counter";
import { DONT_CARE, TRUE, FALSE } from "./types";

/**
 * THE ACCEPTANCE TEST: walk the equations and check they count.
 *
 * A design is not "a table that looks plausible" — it is a claim that these
 * flip-flop inputs, fed back from these outputs, step through exactly this
 * sequence. So the check runs the finished equations as hardware would: read
 * the excitation for the present state, apply the flip-flop's own next-state
 * rule, and see where it lands. Every step of the derivation could be
 * individually reasonable and the whole still be wrong.
 */
function run(design: CounterDesign, from: number): number {
  const row = design.rows.find((r) => r.state === from);
  if (!row) throw new Error(`no row for ${from}`);

  // Read the FINISHED equation, don't cares already resolved by the minimizer.
  const value = (column: number): 0 | 1 =>
    (design.equations[column]?.output[from] ?? 0) as 0 | 1;

  let next = 0;
  for (let b = 0; b < design.bits; b++) {
    const q = row.present[b] as 0 | 1;
    let bit: 0 | 1;
    if (design.type === "d") bit = value(b);
    else if (design.type === "t") bit = ((value(b) ^ q) as 0 | 1);
    else {
      const j = value(b * 2);
      const k = value(b * 2 + 1);
      bit = ((j === 1 && q === 0) || (k === 0 && q === 1) ? 1 : 0) as 0 | 1;
    }
    next = (next << 1) | bit;
  }
  return next;
}

const design = (seq: readonly number[], type: FlipFlopType = "jk"): CounterDesign => {
  const r = designCounter(seq, type);
  if (!r.ok) throw new Error(`design failed: ${r.error.kind}`);
  return r.design;
};

describe("designing a counter from a sequence", () => {
  const SEQUENCES: readonly (readonly number[])[] = [
    [0, 1, 2, 3],
    [0, 1, 2, 3, 4, 5, 6, 7],
    [0, 1, 2, 3, 4],          // mod-5: three unused states
    [0, 2, 4, 6],             // even only
    [0, 3, 5, 6],             // arbitrary, and not in order
    [3, 1, 7, 0, 5],          // no relationship to counting at all
    [7, 6, 5, 4, 3, 2, 1, 0], // down
    [0, 1, 3, 2, 6, 7, 5, 4], // Gray code
  ];

  for (const type of ["d", "t", "jk"] as const) {
    it(`counts the sequence it was given, with ${type.toUpperCase()} flip-flops`, () => {
      for (const seq of SEQUENCES) {
        const d = design(seq, type);
        const walked = seq.map((state, i) => [state, run(d, state), seq[(i + 1) % seq.length]]);
        for (const [from, got, want] of walked) {
          expect(got, `${type}: ${seq.join(",")} — ${from} should go to ${want}`).toBe(want);
        }
      }
    });
  }

  it("sizes the width from the largest state, not from the length", () => {
    // Counting 0, 3, 5, 6 is four states long and needs three flip-flops.
    // Sizing by the count would silently drop the top bit.
    expect(design([0, 3, 5, 6]).bits).toBe(3);
    expect(design([0, 1, 2, 3]).bits).toBe(2);
    expect(design([0, 1]).bits).toBe(1);
    expect(design([0, 9]).bits).toBe(4);
  });

  it("names the state variables MSB first, like everything else here", () => {
    expect(stateVarNames(3)).toEqual(["A", "B", "C"]);
    expect(design([0, 1, 2, 3, 4]).stateVars).toEqual(["A", "B", "C"]);
  });

  it("lists the flip-flop inputs in column order", () => {
    expect(design([0, 1, 2, 3], "d").pins).toEqual(["DA", "DB"]);
    expect(design([0, 1, 2, 3], "t").pins).toEqual(["TA", "TB"]);
    expect(design([0, 1, 2, 3], "jk").pins).toEqual(["JA", "KA", "JB", "KB"]);
  });
});

describe("unused states", () => {
  it("marks them don't-care rather than zero", () => {
    // A mod-5 counter has three unused states. Treating them as zeros instead
    // of as don't cares is the step people skip, and it typically doubles the
    // gate count.
    const d = design([0, 1, 2, 3, 4]);
    expect(d.unused).toEqual([5, 6, 7]);
    for (const row of d.rows.filter((r) => !r.used)) {
      expect(row.excitation.every((v) => v === DONT_CARE)).toBe(true);
      expect(row.next).toBeNull();
    }
    // Every unused state is free in every equation. For J-K that is not the
    // WHOLE freedom — the excitation table leaves half its own entries free
    // too, so a J-K equation has strictly more don't cares than there are
    // unused states, and conflating the two hides where the saving came from.
    for (const eq of d.equations) {
      for (const state of [5, 6, 7]) expect(eq.dontCares).toContain(state);
    }
    // D has no freedom of its own, so there the two sets are exactly equal.
    for (const eq of design([0, 1, 2, 3, 4], "d").equations) {
      expect(eq.dontCares).toEqual([5, 6, 7]);
    }
  });

  it("costs fewer literals than pretending they are zeros", () => {
    // The claim above, measured. Same sequence, don't cares versus not.
    const withDcs = design([0, 1, 2, 3, 4]);
    const free = withDcs.equations.reduce((n, e) => n + e.literals, 0);
    // Force every unused state to hold at zero by including them in the count.
    const forced = design([0, 1, 2, 3, 4, 5, 6, 7]);
    const fixed = forced.equations.reduce((n, e) => n + e.literals, 0);
    expect(free).toBeLessThanOrEqual(fixed);
  });

  it("says where each stray state actually goes, and whether it comes back", () => {
    // The minimizer was free to choose anything here and chose whatever was
    // cheapest. Where that leaves an unused state is a real property of the
    // finished circuit that nobody decided on purpose.
    const d = design([0, 1, 2, 3, 4]);
    expect(d.strays.map((s) => s.state)).toEqual([5, 6, 7]);
    for (const stray of d.strays) {
      expect(stray.goesTo).toBeGreaterThanOrEqual(0);
      expect(stray.goesTo).toBeLessThan(1 << d.bits);
      expect(typeof stray.recovers).toBe("boolean");
    }
    expect(d.selfCorrecting).toBe(d.strays.every((s) => s.recovers));
  });

  it("reads a CONSTANT equation as the constant it is", () => {
    // The bug this exists for: a degenerate minimization — `KA = 1`, which
    // mod-5 produces twice — skips the cube pipeline, so its cover comes back
    // EMPTY. Deriving the hardware's behaviour from the cover therefore read
    // every don't care as 0, which invented three trap states and reported a
    // perfectly good counter as not self-correcting.
    const d = design([0, 1, 2, 3, 4], "jk");
    const ka = d.equations.find((e) => e.pin === "KA") as CounterDesign["equations"][number];
    expect(ka.expr).toBe("1");
    expect([...ka.output]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);

    // And with that read correctly, the textbook mod-5 J-K counter recovers
    // from every unused state.
    expect(d.strays.map((s) => [s.state, s.goesTo])).toEqual([[5, 2], [6, 2], [7, 0]]);
    expect(d.selfCorrecting).toBe(true);
  });

  it("agrees with the equations it printed, at every state", () => {
    // `output` is what the circuit does; `minterms` is what the design REQUIRED.
    // Wherever the design required something, the finished equation must still
    // do it — a minimizer that dropped a required minterm would be caught here
    // rather than by a counter that skips a number.
    for (const seq of [[0, 1, 2, 3, 4], [0, 3, 5, 6], [1, 2, 4, 7]]) {
      for (const type of ["d", "t", "jk"] as const) {
        const d = design(seq, type);
        for (const eq of d.equations) {
          for (const m of eq.minterms) expect(eq.output[m], `${eq.pin}@${m}`).toBe(1);
          const required0 = d.rows
            .filter((r) => r.excitation[d.pins.indexOf(eq.pin)] === FALSE)
            .map((r) => r.state);
          for (const m of required0) expect(eq.output[m], `${eq.pin}@${m}`).toBe(0);
        }
      }
    }
  });

  it("has no strays at all when the sequence uses every state", () => {
    const d = design([0, 1, 2, 3]);
    expect(d.unused).toEqual([]);
    expect(d.strays).toEqual([]);
    expect(d.selfCorrecting).toBe(true);
  });

  it("leaves half the J-K entries free, which is why J-K comes out smaller", () => {
    const d = design([0, 1, 2, 3], "jk");
    const row0 = d.rows.find((r) => r.state === 0) as CounterDesign["rows"][number];
    // 00 -> 01: A holds at 0 (J=0, K=X); B goes 0 -> 1 (J=1, K=X).
    expect(row0.excitation).toEqual([FALSE, DONT_CARE, TRUE, DONT_CARE]);
  });

  it("fills every D entry, because D has no freedom", () => {
    const d = design([0, 1, 2, 3], "d");
    const row0 = d.rows.find((r) => r.state === 0) as CounterDesign["rows"][number];
    expect(row0.excitation).toEqual([FALSE, TRUE]);
  });

  it("sets T exactly where the bit changes", () => {
    const d = design([0, 1, 2, 3], "t");
    // 01 -> 10: both bits flip.
    const row1 = d.rows.find((r) => r.state === 1) as CounterDesign["rows"][number];
    expect(row1.excitation).toEqual([TRUE, TRUE]);
  });
});

describe("refusing what cannot be built", () => {
  it("needs at least two states", () => {
    expect(designCounter([])).toMatchObject({ ok: false, error: { kind: "empty" } });
    expect(designCounter([3])).toMatchObject({ ok: false, error: { kind: "too-short" } });
  });

  it("refuses a repeated state, because that is not a function", () => {
    // A state that appears twice has two different successors. No combinational
    // logic can produce that, and no amount of minimizing will help.
    expect(designCounter([0, 1, 2, 1])).toMatchObject({
      ok: false,
      error: { kind: "duplicate", state: 1 },
    });
  });

  it("refuses a sequence too wide to draw", () => {
    const wide = designCounter([0, 2 ** (MAX_COUNTER_BITS + 1)]);
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.error.kind).toBe("too-wide");
  });
});

describe("reading a sequence a person typed", () => {
  it("takes commas, spaces, arrows and dashes alike", () => {
    expect(parseSequence("0, 3, 5, 6")).toEqual([0, 3, 5, 6]);
    expect(parseSequence("0 3 5 6")).toEqual([0, 3, 5, 6]);
    expect(parseSequence("0 -> 3 -> 5")).toEqual([0, 3, 5]);
    expect(parseSequence("0→3→5")).toEqual([0, 3, 5]);
    expect(parseSequence("0;3;5")).toEqual([0, 3, 5]);
  });

  it("refuses anything that is not a list of numbers", () => {
    expect(parseSequence("")).toBeNull();
    expect(parseSequence("0, x, 2")).toBeNull();
    expect(parseSequence("hello")).toBeNull();
    expect(parseSequence("1.5, 2")).toBeNull();
  });
});
