import { describe, expect, it } from "vitest";
import { elaborate } from "./elaborate";
import { evaluate, type InputVector } from "./solver";
import { diagnose } from "./diagnostics";
import { L0, L1, LX, LZ, type Logic } from "./logic";
import { circuit, ref } from "./testing/build";
import { pinKey, type CircuitDocument } from "./netlist";

/** Evaluate and read back the value on one node's pin. */
function run(doc: CircuitDocument, inputs: InputVector = []) {
  const { index, netlist } = elaborate(doc);
  const state = evaluate(netlist, inputs);
  const diagnostics = diagnose(doc, index, netlist, state);

  const at = (node: string, pin: string): Logic => {
    const netId = index.netOfPin.get(pinKey(ref(node, pin)));
    if (netId === undefined) throw new Error(`no such pin ${node}.${pin}`);
    return state.values[index.ordinalOf.get(netId) as number] as Logic;
  };

  return { state, diagnostics, at, netlist, index };
}

const codes = (ds: ReturnType<typeof diagnose>): string[] => ds.map((d) => d.code);

/** A powered AND gate wired switch A, switch B -> LED. */
const andCircuit = () =>
  circuit()
    .switch("A")
    .switch("B")
    .gate("G1", "and")
    .led("Q")
    .wire("A", "Y", "G1", "A")
    .wire("B", "Y", "G1", "B")
    .wire("G1", "Y", "Q", "A")
    .build();

describe("evaluate — combinational basics", () => {
  it("computes an AND gate across all four input combinations", () => {
    const doc = andCircuit();
    const expected: [InputVector, Logic][] = [
      [[0, 0], L0],
      [[0, 1], L0],
      [[1, 0], L0],
      [[1, 1], L1],
    ];
    for (const [inputs, want] of expected) {
      const { at, state } = run(doc, inputs);
      expect(state.settled).toBe(true);
      expect(at("Q", "A"), `A=${inputs[0]} B=${inputs[1]}`).toBe(want);
    }
  });

  it("propagates through a chain of gates", () => {
    // Q = NOT(A AND B) — a NAND built the long way.
    const doc = circuit()
      .switch("A")
      .switch("B")
      .gate("G1", "and")
      .gate("G2", "not", 1)
      .led("Q")
      .wire("A", "Y", "G1", "A")
      .wire("B", "Y", "G1", "B")
      .wire("G1", "Y", "G2", "A")
      .wire("G2", "Y", "Q", "A")
      .build();

    expect(run(doc, [1, 1]).at("Q", "A")).toBe(L0);
    expect(run(doc, [1, 0]).at("Q", "A")).toBe(L1);
  });

  it("is deterministic — the same netlist twice gives byte-identical state", () => {
    const doc = andCircuit();
    const a = run(doc, [1, 0]).state.values;
    const b = run(doc, [1, 0]).state.values;
    expect([...a]).toEqual([...b]);
  });
});

describe("evaluate — faults", () => {
  // The single most common lab mistake, and the one a boolean simulator cannot
  // see at all. Note the explicit assertion that it is NOT 0.
  it("leaves a floating input floating, and says so", () => {
    const doc = circuit()
      .switch("A")
      .gate("G1", "and") // pin B is wired to nothing
      .led("Q")
      .wire("A", "Y", "G1", "A")
      .wire("G1", "Y", "Q", "A")
      .build();

    const { at, diagnostics } = run(doc, [1]);
    expect(at("G1", "B")).toBe(LZ);
    expect(at("G1", "B")).not.toBe(L0); // the whole point
    expect(at("Q", "A")).toBe(LX); // AND(1, floating) is unknown, not 0
    expect(codes(diagnostics)).toContain("FLOATING_INPUT");
  });

  it("still lets a controlling value win over a floating input", () => {
    // AND(0, floating) is a clean 0 — X must not be unconditionally contagious,
    // or one loose wire turns the whole board red.
    const doc = circuit()
      .switch("A")
      .gate("G1", "and")
      .led("Q")
      .wire("A", "Y", "G1", "A")
      .wire("G1", "Y", "Q", "A")
      .build();

    expect(run(doc, [0]).at("Q", "A")).toBe(L0);
  });

  it("detects two outputs shorted together and disagreeing", () => {
    const doc = circuit()
      .switch("A")
      .switch("B")
      .gate("G1", "buf", 1)
      .gate("G2", "buf", 1)
      .led("Q")
      .wire("A", "Y", "G1", "A")
      .wire("B", "Y", "G2", "A")
      .wire("G1", "Y", "Q", "A")
      .wire("G2", "Y", "Q", "A") // <- both outputs on the LED's net
      .build();

    const { at, diagnostics } = run(doc, [0, 1]);
    expect(at("Q", "A")).toBe(LX);
    expect(codes(diagnostics)).toContain("OUTPUT_SHORT");
  });

  it("warns about two outputs on one net even while they agree", () => {
    // They agree right now. It is still a fault — it just hasn't bitten yet.
    const doc = circuit()
      .switch("A")
      .switch("B")
      .gate("G1", "buf", 1)
      .gate("G2", "buf", 1)
      .led("Q")
      .wire("A", "Y", "G1", "A")
      .wire("B", "Y", "G2", "A")
      .wire("G1", "Y", "Q", "A")
      .wire("G2", "Y", "Q", "A")
      .build();

    const { at, diagnostics } = run(doc, [1, 1]);
    expect(at("Q", "A")).toBe(L1);
    expect(codes(diagnostics)).toContain("OUTPUT_TO_OUTPUT");
    expect(codes(diagnostics)).not.toContain("OUTPUT_SHORT");
  });

  it("detects an output wired straight onto the +5V rail", () => {
    const doc = circuit()
      .switch("A")
      .rail("V1", "vcc")
      .gate("G1", "buf", 1)
      .wire("A", "Y", "G1", "A")
      .wire("G1", "Y", "V1", "VCC")
      .build();

    const { diagnostics } = run(doc, [0]);
    expect(codes(diagnostics)).toContain("OUTPUT_DRIVES_RAIL");
  });

  it("detects Vcc shorted to GND", () => {
    const doc = circuit()
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("V1", "VCC", "G0", "GND")
      .build();

    expect(codes(run(doc).diagnostics)).toContain("RAIL_SHORT");
  });
});

describe("evaluate — feedback", () => {
  /**
   * A cross-coupled NAND latch. This is the case a topological sort simply
   * cannot express — there is no valid ordering — and the case an in-place
   * iteration gets *plausibly but arbitrarily* wrong.
   */
  it("settles an SR latch and reports no oscillation", () => {
    // Active-low SR latch: S'=A, R'=B.
    const doc = circuit()
      .switch("S")
      .switch("R")
      .gate("N1", "nand")
      .gate("N2", "nand")
      .wire("S", "Y", "N1", "A")
      .wire("N2", "Y", "N1", "B")
      .wire("R", "Y", "N2", "A")
      .wire("N1", "Y", "N2", "B")
      .build();

    // Q is N1.Y; Q-bar is N2.Y. Inputs are sorted by label, so the vector is [R, S].

    // S'=0, R'=1 -> SET -> Q = 1, Q-bar = 0
    const set = run(doc, [1, 0]);
    expect(set.state.settled).toBe(true);
    expect(set.at("N1", "Y")).toBe(L1);
    expect(set.at("N2", "Y")).toBe(L0);

    // S'=1, R'=0 -> RESET -> Q = 0, Q-bar = 1
    const reset = run(doc, [0, 1]);
    expect(reset.state.settled).toBe(true);
    expect(reset.at("N1", "Y")).toBe(L0);
    expect(reset.at("N2", "Y")).toBe(L1);

    // And the latch is a feedback loop that SETTLES — so it must not be reported
    // as an oscillation. "Any cycle is an error" would fail exactly here.
    expect(codes(set.diagnostics)).not.toContain("OSCILLATION");
  });

  /**
   * Feedback that legitimately settles is NOT an error. Y = A AND Y with A = 0
   * converges to 0 in two cycles. A naive "any cycle is an error" implementation
   * gets this wrong.
   */
  it("settles a feedback loop that converges, and does not cry oscillation", () => {
    const doc = circuit()
      .switch("A")
      .gate("G1", "and")
      .wire("A", "Y", "G1", "A")
      .wire("G1", "Y", "G1", "B") // output back into its own input
      .build();

    const { state, at, diagnostics } = run(doc, [0]);
    expect(state.settled).toBe(true);
    expect(at("G1", "Y")).toBe(L0);
    expect(codes(diagnostics)).not.toContain("OSCILLATION");
  });

  /**
   * A ring oscillator. Note what 4-state logic actually does here: it does NOT
   * toggle 0-1-0-1. `NOT(X) = X` is a fixed point, so the ring collapses to a
   * stable X in one delta cycle — which is the physically honest answer (the net
   * has no definite value) but means value-watching can never detect the loop.
   *
   * That is exactly why oscillation is detected STRUCTURALLY, from the cell-graph
   * SCCs, and then confirmed by asking whether the loop reached a definite value.
   */
  it("detects a single-inverter ring oscillator", () => {
    const doc = circuit()
      .gate("G1", "not", 1)
      .wire("G1", "Y", "G1", "A")
      .build();

    const { at, diagnostics, netlist } = run(doc);
    expect(netlist.feedbackLoops).toHaveLength(1);
    expect(at("G1", "Y")).toBe(LX);
    expect(at("G1", "Y")).not.toBe(L0); // undefined, not low
    expect(codes(diagnostics)).toContain("OSCILLATION");
  });

  it("detects a three-inverter ring WITHOUT nuking unrelated nets", () => {
    // A ring oscillator, plus a completely separate AND gate that should be
    // entirely unaffected. If X is unconditionally contagious, or if we bail out
    // of the whole simulation on any cycle, the AND gate goes red too — and the
    // diagnostic becomes useless.
    const doc = circuit()
      .gate("R1", "not", 1)
      .gate("R2", "not", 1)
      .gate("R3", "not", 1)
      .wire("R1", "Y", "R2", "A")
      .wire("R2", "Y", "R3", "A")
      .wire("R3", "Y", "R1", "A")
      .switch("A")
      .switch("B")
      .gate("G1", "and")
      .led("Q")
      .wire("A", "Y", "G1", "A")
      .wire("B", "Y", "G1", "B")
      .wire("G1", "Y", "Q", "A")
      .build();

    const { at, diagnostics, netlist } = run(doc, [1, 1]);
    expect(netlist.feedbackLoops).toHaveLength(1); // only the ring, not the AND
    expect(codes(diagnostics)).toContain("OSCILLATION");

    // The ring is X...
    expect(at("R1", "Y")).toBe(LX);
    expect(at("R2", "Y")).toBe(LX);
    // ...and the innocent bystander still computes 1 AND 1 = 1.
    expect(at("Q", "A")).toBe(L1);
  });

  it("names the gates in the loop, so the message is actionable", () => {
    const doc = circuit()
      .gate("R1", "not", 1)
      .gate("R2", "not", 1)
      .gate("R3", "not", 1)
      .wire("R1", "Y", "R2", "A")
      .wire("R2", "Y", "R3", "A")
      .wire("R3", "Y", "R1", "A")
      .build();

    const osc = run(doc).diagnostics.find((d) => d.code === "OSCILLATION");
    expect(osc?.message).toContain("R1");
    expect(osc?.message).toContain("R2");
    expect(osc?.message).toContain("R3");
  });

  it("terminates rather than spinning on a pathological loop", () => {
    const doc = circuit()
      .gate("G1", "not", 1)
      .wire("G1", "Y", "G1", "A")
      .build();
    const { netlist } = elaborate(doc);
    const state = evaluate(netlist, [], { maxDeltaCycles: 8 });
    expect(state.deltaCycles).toBeLessThanOrEqual(8);
  });
});

describe("evaluate — purity", () => {
  // The whole reason the M6 verification sweep needs no cloning: evaluate() is a
  // pure function of (netlist, inputs) and touches neither.
  it("does not mutate the netlist or the document", () => {
    const doc = Object.freeze(andCircuit());
    const { netlist } = elaborate(doc);
    const frozen = Object.freeze(netlist);

    expect(() => evaluate(frozen, [1, 1])).not.toThrow();
    expect(() => evaluate(frozen, [0, 1])).not.toThrow();

    // Two sweeps in a row must not influence each other.
    const first = evaluate(frozen, [1, 1]).values;
    evaluate(frozen, [0, 0]);
    const again = evaluate(frozen, [1, 1]).values;
    expect([...again]).toEqual([...first]);
  });

  it("seeds cleanly on every call — no state carried between input vectors", () => {
    const doc = andCircuit();
    const { netlist } = elaborate(doc);

    const a = evaluate(netlist, [1, 1]).values;
    const b = evaluate(netlist, [1, 1]).values;
    expect([...a]).toEqual([...b]);
  });
});
