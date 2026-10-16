import { describe, expect, it } from "vitest";
import { MAX_SWEEP_INPUTS, simulateTimed } from "./timing";
import { getSequentialPreset } from "./sequential-presets";
import { evaluate } from "./solver";
import { elaborate } from "./elaborate";
import { realize, synthesize, technologyMap } from "./synth";
import { circuit } from "./testing/build";
import { L0, L1, LX, type Logic } from "./logic";
import { parse } from "@/lib/core-engine/parser";
import type { CircuitDocument } from "./netlist";

const timed = (doc: CircuitDocument, delay = 1) =>
  simulateTimed(elaborate(doc).netlist, { delay });

const exprOf = (src: string) => {
  const r = parse(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value.ast;
};

/** Build a discrete-gate circuit straight from an expression, no minimization. */
const fromExpr = (src: string, vars: string[]): CircuitDocument =>
  realize(technologyMap(synthesize(exprOf(src), vars), "mixed"), {
    discrete: true,
    outputLabel: "F",
  });

/** The settled value of a wave at the end of each held step of the FORWARD sweep. */
const perStep = (r: ReturnType<typeof timed>, label: string, steps: number): Logic[] => {
  const wave = r.waves.find((w) => w.label === label)!;
  const w = r.ticksPerCombination;
  return Array.from(
    { length: steps },
    (_, s) => wave.samples[r.settleTicks + s * w + (w - 1)] as Logic,
  );
};

describe("counter-driven inputs", () => {
  /**
   * The inputs sweep the whole truth table over time, which is what makes the
   * timing diagram a logic-analyzer view of the function rather than decoration.
   *
   * In GRAY order — exactly one input changes per step. See the long note in
   * timing.ts: sweeping in plain binary would change several inputs at once and
   * manufacture function hazards, which no redundant term can cure, so the
   * lesson the panel is meant to teach would be a lie.
   */
  it("sweeps in Gray order, changing exactly one input per step", () => {
    const result = timed(fromExpr("A * B", ["A", "B"]));

    const a = perStep(result, "A", 4);
    const b = perStep(result, "B", 4);

    // Gray(0..3) = 00, 01, 11, 10. A is the MSB, as everywhere else.
    expect(a).toEqual([L0, L0, L1, L1]);
    expect(b).toEqual([L0, L1, L1, L0]);

    // The defining property: exactly one bit differs between successive steps.
    for (let s = 1; s < 4; s++) {
      const changed = Number(a[s] !== a[s - 1]) + Number(b[s] !== b[s - 1]);
      expect(changed, `step ${s}`).toBe(1);
    }
  });

  it("still visits every input combination exactly once", () => {
    const result = timed(fromExpr("A * B", ["A", "B"]));
    const a = perStep(result, "A", 4);
    const b = perStep(result, "B", 4);
    const seen = a.map((v, i) => `${v}${b[i]}`);
    expect(new Set(seen).size).toBe(4);
  });

  it("computes the right settled output for each step", () => {
    // Gray order 00, 01, 11, 10 -> AND = 0, 0, 1, 0
    expect(perStep(timed(fromExpr("A * B", ["A", "B"])), "F", 4)).toEqual([
      L0, L0, L1, L0,
    ]);
  });

  it("gives a circuit with no inputs nothing to draw", () => {
    expect(timed(circuit().gate("G1", "and").build()).ticks).toBe(0);
  });
});

describe("static hazards — the reason this solver exists", () => {
  /**
   * THE CLASSIC STATIC-1 HAZARD.
   *
   *   F = A·C' + B·C     over A=1, B=1, with C falling 1 -> 0
   *
   * Both product terms should be able to hold F high through that transition.
   * But the A·C' term needs C' — which has to go through an inverter — while the
   * B·C term loses C immediately. So B·C drops on the very next tick, and A·C'
   * does not rise until a tick later. For one tick nothing holds F up, and it
   * dips to 0. That momentary 1-0-1 spike is a static-1 hazard, and on real
   * hardware it is a real pulse that can clock a real flip-flop.
   *
   * The fixpoint solver in solver.ts CANNOT show this: it iterates to
   * convergence and reports only the final answer, by which time the glitch has
   * been swallowed. That is precisely why the timed solver exists.
   */
  it("shows a glitch on the minimal SOP A·C' + B·C", () => {
    const doc = fromExpr("A*C' + B*C", ["A", "B", "C"]);
    const result = timed(doc);

    expect(result.glitches.length).toBeGreaterThan(0);
    expect(result.glitches[0]?.label).toBe("F");
    expect(result.glitches[0]?.ticks.length).toBeGreaterThan(0);
  });

  /**
   * THE CURE, and the reason this closes the loop back to the theory module.
   *
   * Add the consensus term A·B. It is redundant — Quine-McCluskey discards it
   * precisely BECAUSE it covers nothing that the other two do not, and the
   * minimal cover is minimal without it. But it is redundant in the *steady
   * state*, not in *time*: A·B holds F high all the way through C's transition,
   * bridging the gap while the other two terms hand over.
   *
   * So: MINIMAL IS NOT THE SAME AS HAZARD-FREE. The term the minimizer threw
   * away is the term that fixes the glitch. That is a real exam topic, and now a
   * student can see it happen.
   */
  it("removes the glitch when the redundant consensus term A·B is added back", () => {
    const doc = fromExpr("A*C' + B*C + A*B", ["A", "B", "C"]);
    const result = timed(doc);

    expect(result.glitches).toEqual([]);
  });

  it("the two circuits are logically identical — the consensus term changes nothing in steady state", () => {
    const minimal = timed(fromExpr("A*C' + B*C", ["A", "B", "C"]));
    const hazardFree = timed(fromExpr("A*C' + B*C + A*B", ["A", "B", "C"]));

    // Same function. Different behaviour in TIME. That is the whole lesson: the
    // term the minimizer correctly threw away as redundant is the term that
    // fixes the glitch.
    expect(perStep(minimal, "F", 8)).toEqual(perStep(hazardFree, "F", 8));
  });

  it("does not cry glitch on a circuit that has none", () => {
    expect(timed(fromExpr("A * B", ["A", "B"])).glitches).toEqual([]);
    expect(timed(fromExpr("A + B", ["A", "B"])).glitches).toEqual([]);
  });

  it("a longer gate delay widens the glitch rather than hiding it", () => {
    const fast = timed(fromExpr("A*C' + B*C", ["A", "B", "C"]), 1);
    const slow = timed(fromExpr("A*C' + B*C", ["A", "B", "C"]), 3);

    expect(fast.glitches.length).toBeGreaterThan(0);
    expect(slow.glitches.length).toBeGreaterThan(0);
    // A slower inverter means a longer gap to bridge.
    expect(slow.glitches[0]!.ticks.length).toBeGreaterThan(
      fast.glitches[0]!.ticks.length,
    );
  });
});

describe("waveforms", () => {
  it("sweeps forward and then back, so every transition happens in both directions", () => {
    const r = timed(fromExpr("A * B", ["A", "B"]));
    expect(r.steps).toBe(8); // 2 * 2^2
    expect(r.combinations).toEqual([0, 1, 3, 2, 2, 3, 1, 0]);
  });

  it("records one sample per tick for every input and output", () => {
    const doc = fromExpr("A * B", ["A", "B"]);
    const result = timed(doc);

    expect(result.waves.map((w) => w.label).sort()).toEqual(["A", "B", "F"]);
    for (const wave of result.waves) {
      expect(wave.samples).toHaveLength(result.ticks);
    }
  });

  it("marks which waves are inputs", () => {
    const result = timed(fromExpr("A * B", ["A", "B"]));
    expect(result.waves.filter((w) => w.isInput).map((w) => w.label)).toEqual([
      "A",
      "B",
    ]);
    expect(result.waves.filter((w) => !w.isInput).map((w) => w.label)).toEqual(["F"]);
  });

  it("works on a real 74xx board, not just discrete gates", () => {
    const doc = realize(
      technologyMap(synthesize(exprOf("A*B"), ["A", "B"]), "mixed"),
      { outputLabel: "F" },
    );
    const result = timed(doc);
    expect(perStep(result, "F", 4)).toEqual([L0, L0, L1, L0]); // Gray order
  });
});


describe("the sweep refuses what it cannot draw", () => {
  /** A circuit with `n` independent inputs, each through an inverter to an LED. */
  const wide = (n: number): CircuitDocument => {
    const b = circuit();
    for (let i = 0; i < n; i++) {
      b.switch(`S${i}`, 0)
        .gate(`N${i}`, "not", 1)
        .led(`L${i}`)
        .wire(`S${i}`, "Y", `N${i}`, "A")
        .wire(`N${i}`, "Y", `L${i}`, "A");
    }
    return b.build();
  };

  it("sweeps a circuit at the limit", () => {
    const r = timed(wide(MAX_SWEEP_INPUTS));
    expect(r.tooWide).toBeUndefined();
    expect(r.steps).toBe(2 * 2 ** MAX_SWEEP_INPUTS);
    expect(r.ticks).toBeGreaterThan(0);
  });

  it("refuses one input past it, and says how far past", () => {
    // Every term of the cost is exponential, so there is no "slow" here, only
    // "never": the 8-bit ripple adder's 17 inputs asked for 262,144 held steps
    // and the 16-bit one's 33 asked for 17 billion, which `Array.from` throws
    // on outright. The failure arrived as an empty lab with no explanation.
    const n = MAX_SWEEP_INPUTS + 1;
    const r = timed(wide(n));
    expect(r.tooWide).toEqual({ inputs: n, combinations: 2 ** n });
    expect(r.ticks).toBe(0);
    expect(r.waves).toEqual([]);
  });

  it("returns immediately rather than trying and failing", () => {
    // 33 inputs is the 16-bit adder. Before the guard this threw a RangeError
    // from inside an Array.from of 17 billion elements.
    const started = Date.now();
    const r = timed(wide(33));
    expect(r.tooWide?.inputs).toBe(33);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("claims nothing about glitches it did not look for", () => {
    // "No glitches" is a statement about the WHOLE input space. A partial sweep
    // that reported an empty glitch list would be making that claim falsely.
    const r = timed(wide(MAX_SWEEP_INPUTS + 1));
    expect(r.glitches).toEqual([]);
    expect(r.combinations).toEqual([]);
    expect(r.tooWide).toBeDefined();
  });
});


describe("the clocked chart", () => {
  /** The 4-bit ripple counter preset, which is a circuit with memory. */
  const counter = () =>
    elaborate(getSequentialPreset("ripple-4")!.build()).netlist;

  /** Pull the counter's active-low clear down once, and keep the state. */
  const cleared = (nl: ReturnType<typeof counter>) => {
    const clr = nl.inputs.findIndex((p) => p.label === "CLR");
    return evaluate(nl, nl.inputs.map((_, i) => (i === clr ? 0 : 1)), { clocks: [0] }).state;
  };

  it("drives the clock instead of sweeping inputs", () => {
    const r = simulateTimed(counter(), { cycles: 8 });
    expect(r.clocked).toEqual({ cycles: 8 });
    // A sweep would have claimed a combination per step. This one has none,
    // because there is no combination to name — only a moment in a sequence.
    expect(r.combinations).toEqual([]);
    expect(r.ticks).toBeGreaterThan(0);
  });

  it("puts the clock on the chart, above the outputs", () => {
    const r = simulateTimed(counter(), { cycles: 4 });
    expect(r.waves[0]?.label).toBe("CLK");
    expect(r.waves.map((w) => w.label)).toContain("Q0");
    expect(r.waves.map((w) => w.label)).toContain("Q3");
  });

  it("shows unknowns for a counter nobody has cleared, because that is the truth", () => {
    // A flip-flop powers up in whichever state it fell into. A chart that drew
    // a tidy count here would be inventing the one thing the clear exists for.
    const r = simulateTimed(counter(), { cycles: 6 });
    const q0 = r.waves.find((w) => w.label === "Q0");
    expect(q0?.samples.every((v) => v === LX)).toBe(true);
  });

  it("halves the rate at every stage, which is what a ripple counter IS", () => {
    // Q0 changes once per clock cycle, Q1 once per two, Q2 once per four. If
    // the stages were clocked together this would come out flat.
    const nl = counter();
    const r = simulateTimed(nl, { cycles: 24, state: cleared(nl) });
    const edges = (label: string) => {
      const w = r.waves.find((x) => x.label === label);
      let count = 0;
      for (let i = 1; i < (w?.samples.length ?? 0); i++) {
        if (w?.samples[i] !== w?.samples[i - 1]) count += 1;
      }
      return count;
    };
    expect(edges("Q0")).toBeGreaterThan(edges("Q1"));
    expect(edges("Q1")).toBeGreaterThan(edges("Q2"));
    expect(edges("Q2")).toBeGreaterThan(edges("Q3"));
  });

  it("claims no glitches, because it does not model the delays that make them", () => {
    // An empty list on a chart that never looked would be a claim. This chart
    // samples settled values, so it reports nothing rather than "none found".
    const r = simulateTimed(counter(), { cycles: 6 });
    expect(r.glitches).toEqual([]);
    expect(r.clocked).toBeDefined();
  });

  it("still sweeps a circuit with no memory in it", () => {
    const doc = fromExpr("A*B", ["A", "B"]);
    const r = timed(doc);
    expect(r.clocked).toBeUndefined();
    expect(r.combinations.length).toBeGreaterThan(0);
  });
});
