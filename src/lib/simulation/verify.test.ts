import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { verify } from "./verify";
import { realize, synthesize, technologyMap, type Strategy } from "./synth";
import { circuit } from "./testing/build";
import { L0, L1, LZ } from "./logic";
import { parseInput } from "@/lib/core-engine/canonical";
import { minimize } from "@/lib/core-engine/minimizer";
import { arbFunction } from "@/lib/core-engine/testing/arbitraries";
import type { BooleanFunction } from "@/lib/core-engine/types";
import type { CircuitDocument } from "./netlist";

const fnOf = (src: string): BooleanFunction => {
  const r = parseInput(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value;
};

/** Build the circuit the theory module would build for this function. */
const built = (fn: BooleanFunction, strategy: Strategy = "mixed"): CircuitDocument =>
  realize(technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), strategy));

/** A hand-wired AND of two switches into an LED, with configurable gate op. */
const handWired = (op: "and" | "or" | "nand", swap = false): CircuitDocument =>
  circuit()
    .switch("A")
    .switch("B")
    .gate("G1", op)
    .led("F")
    .wire("A", "Y", "G1", swap ? "B" : "A")
    .wire("B", "Y", "G1", swap ? "A" : "B")
    .wire("G1", "Y", "F", "A")
    .build();

describe("verify — the happy path", () => {
  it("passes a circuit the synthesizer generated for the function", () => {
    const fn = fnOf("F(A,B,C) = A'B + BC");
    const result = verify(built(fn), fn);

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.rows).toHaveLength(8);
  });

  it("passes for every technology mapping", () => {
    const fn = fnOf("F(A,B,C) = Σm(1,3,5,7)");
    for (const s of ["mixed", "nand-only", "nor-only"] as const) {
      expect(verify(built(fn, s), fn).ok, s).toBe(true);
    }
  });

  // A don't-care means the student was TOLD they may choose. Failing them for
  // choosing would be a bug in the grader, not in their circuit.
  it("accepts either choice on a don't-care row", () => {
    const spec = fnOf("F(A,B) = Σm(1) + d(2)");

    // A circuit that outputs 1 on the don't-care row…
    const chose1 = built(fnOf("F(A,B) = Σm(1,2)"));
    expect(verify(chose1, spec).ok).toBe(true);

    // …and one that outputs 0 there. Both are correct.
    const chose0 = built(fnOf("F(A,B) = Σm(1)"));
    expect(verify(chose0, spec).ok).toBe(true);
  });
});

describe("verify — the failure modes it must explain", () => {
  it("names the exact rows that disagree", () => {
    const spec = fnOf("F(A,B) = Σm(3)"); // A AND B
    const result = verify(handWired("or"), spec); // built an OR instead

    expect(result.ok).toBe(false);
    // OR is 1 on rows 1 and 2 where AND is 0.
    expect(result.mismatches.map((r) => r.minterm)).toEqual([1, 2]);
    expect(result.mismatches[0]?.expected).toBe(0);
    expect(result.mismatches[0]?.actual).toBe(L1);
  });

  it("spots an inverted output — NAND where AND was needed", () => {
    const spec = fnOf("F(A,B) = Σm(3)"); // AND
    const result = verify(handWired("nand"), spec);

    expect(result.ok).toBe(false);
    expect(result.hypotheses.map((h) => h.kind)).toContain("output-inverted");
    expect(result.hypotheses[0]?.message).toMatch(/inverted/i);
  });

  it("spots swapped inputs", () => {
    // Spec: F = A AND NOT B, which is minterm 2 (A=1, B=0).
    // Built:  F = B AND NOT A, which is minterm 1 — the two input wires crossed.
    const spec = fnOf("F(A,B) = Σm(2)");
    const doc = circuit()
      .switch("A")
      .switch("B")
      .gate("N1", "not", 1)
      .gate("G1", "and")
      .led("F")
      .wire("A", "Y", "N1", "A") // inverts A — should have inverted B
      .wire("B", "Y", "G1", "A") // feeds B straight in — should have been A
      .wire("N1", "Y", "G1", "B")
      .wire("G1", "Y", "F", "A")
      .build();

    const result = verify(doc, spec);
    expect(result.ok).toBe(false);
    const swap = result.hypotheses.find((h) => h.kind === "inputs-swapped");
    expect(swap).toBeDefined();
    expect([swap?.kind === "inputs-swapped" && swap.a, swap?.kind === "inputs-swapped" && swap.b])
      .toEqual(["A", "B"]);
  });

  it("spots a stuck output", () => {
    const spec = fnOf("F(A,B) = Σm(3)");
    const doc = circuit()
      .switch("A")
      .switch("B")
      .rail("G0", "gnd")
      .led("F")
      .wire("G0", "GND", "F", "A") // output tied to ground
      .build();

    const result = verify(doc, spec);
    expect(result.hypotheses.map((h) => h.kind)).toContain("output-stuck");
  });

  it("spots an output nothing drives", () => {
    const spec = fnOf("F(A,B) = Σm(3)");
    const doc = circuit().switch("A").switch("B").led("F").build();

    const result = verify(doc, spec);
    expect(result.rows.every((r) => r.actual === LZ)).toBe(true);
    expect(result.hypotheses.map((h) => h.kind)).toContain("no-output");
  });

  it("surfaces an unpowered chip as the reason, rather than just 'wrong'", () => {
    const spec = fnOf("F(A,B) = Σm(3)");
    const doc = circuit()
      .ic("U1", "7408")
      .switch("A")
      .switch("B")
      .led("F")
      .wire("A", "Y", "U1", "1A")
      .wire("B", "Y", "U1", "1B")
      .wire("U1", "1Y", "F", "A") // no Vcc, no GND
      .build();

    const result = verify(doc, spec);
    expect(result.ok).toBe(false);
    expect(result.hypotheses.some((h) => h.message.includes("pin 14"))).toBe(true);
  });
});

describe("verify — circuits a truth table cannot describe", () => {
  /**
   * An SR latch's output depends on its history, not just on its inputs. Emitting
   * a truth table for it would be a garbage answer that LOOKS authoritative.
   *
   * Caught structurally: a combinational circuit has no feedback loops, and the
   * loops come from a Tarjan pass over the cell graph. The tempting alternative —
   * simulate from two different seeds and see if the answers differ — does not
   * work, because a cross-coupled latch is SYMMETRIC: seeding every gate 0 and
   * seeding every gate 1 both start the pair equal, and it just oscillates either
   * way.
   */
  it("refuses to grade a circuit with memory, and says why", () => {
    const spec = fnOf("F(A,B) = Σm(3)");
    const doc = circuit()
      .switch("A")
      .switch("B")
      .gate("N1", "nand")
      .gate("N2", "nand")
      .led("F")
      .wire("A", "Y", "N1", "A")
      .wire("N2", "Y", "N1", "B")
      .wire("B", "Y", "N2", "A")
      .wire("N1", "Y", "N2", "B")
      .wire("N1", "Y", "F", "A")
      .build();

    const result = verify(doc, spec);
    expect(result.nonCombinational).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.hypotheses[0]?.message).toMatch(/memory/i);
  });
});

describe("verify — input alignment", () => {
  it("refuses when the switch count does not match the variable count", () => {
    const spec = fnOf("F(A,B,C) = Σm(1)");
    const result = verify(handWired("and"), spec); // only A and B exist
    expect(result.error).toMatch(/2 input switches.*3 variables/);
  });

  it("refuses when the switches are not labelled like the variables", () => {
    const spec = fnOf("F(A,B) = Σm(3)");
    const doc = circuit()
      .switch("X")
      .switch("Y")
      .gate("G1", "and")
      .led("F")
      .wire("X", "Y", "G1", "A")
      .wire("Y", "Y", "G1", "B")
      .wire("G1", "Y", "F", "A")
      .build();

    expect(verify(doc, spec).error).toMatch(/Label your input switches A, B/);
  });

  it("asks for an LED when there is no output to read", () => {
    const spec = fnOf("F(A,B) = Σm(3)");
    const doc = circuit().switch("A").switch("B").build();
    expect(verify(doc, spec).error).toMatch(/Add an LED/);
  });
});

describe("verify — purity", () => {
  /**
   * The direct test of the architecture: the sweep evaluates the circuit 2^n
   * times and must not touch the user's live document once. If it did, running
   * Verify would silently edit their board.
   */
  it("does not mutate the document it is verifying", () => {
    const fn = fnOf("F(A,B,C) = A'B + BC");
    const doc = built(fn);

    // Deep-freeze: any write at all throws.
    const freeze = (o: unknown): void => {
      if (o && typeof o === "object") {
        Object.freeze(o);
        Object.values(o).forEach(freeze);
      }
    };
    freeze(doc);

    expect(() => verify(doc, fn)).not.toThrow();
    expect(verify(doc, fn).ok).toBe(true);
  });
});

describe("verify — properties", () => {
  /**
   * THE END-TO-END PROPERTY, and the one that makes the whole product
   * trustworthy: whatever the theory module says the function is, the circuit
   * the app builds for it must verify GREEN. If minimizer and simulator ever
   * drift apart, this goes red — instead of a student being told their correct
   * circuit is wrong.
   */
  it("anything the app builds, the app verifies", () => {
    fc.assert(
      fc.property(
        arbFunction({ minVars: 1, maxVars: 3 }),
        fc.constantFrom<Strategy>("mixed", "nand-only", "nor-only"),
        (fn, strategy) => {
          const min = minimize(fn, "sop");
          // A constant function has no circuit to build.
          if (min.trace.degenerate) return;

          const result = verify(built(fn, strategy), fn);
          expect(result.error, `${strategy}`).toBeNull();
          expect(result.ok, `${strategy}: ${JSON.stringify(result.mismatches)}`).toBe(
            true,
          );
        },
      ),
      { numRuns: 150 },
    );
  });

  it("a wrong circuit is never reported as correct", () => {
    // Verify F against the circuit for NOT F. It must always fail, and it must
    // always be able to say why.
    fc.assert(
      fc.property(arbFunction({ minVars: 2, maxVars: 3, dontCares: false }), (fn) => {
        const complementFn: BooleanFunction = {
          ...fn,
          values: Uint8Array.from([...fn.values].map((v) => (v === 1 ? 0 : 1))),
        };
        const min = minimize(complementFn, "sop");
        if (min.trace.degenerate || minimize(fn, "sop").trace.degenerate) return;

        const result = verify(built(complementFn), fn);
        expect(result.ok).toBe(false);
        expect(result.mismatches.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe("verify — sanity of the row data", () => {
  it("reports rows under the MSB contract, matching the theory module", () => {
    const fn = fnOf("F(A,B,C) = Σm(4)"); // A=1, B=0, C=0
    const result = verify(built(fn), fn);

    const row4 = result.rows[4];
    expect(row4?.inputs).toEqual([1, 0, 0]); // A is the MSB
    expect(row4?.expected).toBe(1);
    expect(row4?.actual).toBe(L1);

    expect(result.rows[0]?.actual).toBe(L0);
  });
});

describe("verify — input ORDER, not just input names", () => {
  /**
   * THE BUG THIS PINS.
   *
   * The circuit's switches are sorted by LABEL (A, B, S). The function's
   * variables are in DECLARATION order (S, A, B) — and for a multiplexer that is
   * the natural way to write it. Matching them up positionally checks every row
   * against the wrong input combination, so a perfectly correct mux gets reported
   * as wrong, which is the single most damaging thing this bridge could do.
   *
   * The variable's POSITION IN THE FUNCTION decides its bit, not its position in
   * the alphabet.
   */
  it("verifies a 2-to-1 mux declared as F(S,A,B), not F(A,B,S)", () => {
    const spec = fnOf("F(S,A,B) = S'*A + S*B");
    expect(spec.variables).toEqual(["S", "A", "B"]);

    const doc = built(spec);
    const result = verify(doc, spec);

    expect(result.error).toBeNull();
    expect(result.ok, JSON.stringify(result.mismatches)).toBe(true);
  });

  it("reports each row's inputs in the FUNCTION's variable order", () => {
    const spec = fnOf("F(S,A,B) = S'*A + S*B");
    const result = verify(built(spec), spec);

    expect(result.inputLabels).toEqual(["S", "A", "B"]);

    // Minterm 4 is S=1, A=0, B=0 under the MSB contract.
    expect(result.rows[4]?.inputs).toEqual([1, 0, 0]);
  });

  it("still works when the declared order happens to be alphabetical", () => {
    const spec = fnOf("F(A,B,C) = A'B + BC");
    expect(verify(built(spec), spec).ok).toBe(true);
  });
});
