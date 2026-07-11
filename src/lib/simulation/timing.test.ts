import { describe, expect, it } from "vitest";
import { simulateTimed } from "./timing";
import { elaborate } from "./elaborate";
import { realize, synthesize, technologyMap } from "./synth";
import { circuit } from "./testing/build";
import { L0, L1, type Logic } from "./logic";
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
