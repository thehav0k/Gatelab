import { describe, expect, it } from "vitest";
import { SEQUENTIAL_PRESETS, getSequentialPreset } from "./sequential-presets";
import { elaborate } from "./elaborate";
import { evaluate, initialState, type SeqState } from "./solver";
import { diagnose } from "./diagnostics";
import { L0, L1, type Logic } from "./logic";
import type { CircuitDocument } from "./netlist";

/**
 * A preset on the bench: elaborate it, hold the switches, drive the clock.
 *
 * THE ACCEPTANCE TEST IS THAT IT COUNTS. A miswired sequential preset is not a
 * picture that looks slightly off — it is a circuit that counts 0, 1, 0, 2 and
 * teaches that. Reading the LEDs back after each pulse is the only check that
 * can tell the difference.
 */
function bench(doc: CircuitDocument) {
  const { index, netlist } = elaborate(doc);
  const label = (l: string) => netlist.inputs.findIndex((p) => p.label === l);

  const vector = (bits: Record<string, 0 | 1>) =>
    netlist.inputs.map((p) => bits[p.label] ?? 0);

  const read = (values: Uint8Array, l: string): Logic =>
    values[netlist.outputs.find((o) => o.label === l)?.net ?? 0] as Logic;

  return { index, netlist, label, vector, read };
}

/** Hold `bits`, pulse the clock `n` times, and read `leds` after each pulse. */
function pulses(
  doc: CircuitDocument,
  bits: Record<string, 0 | 1>,
  leds: readonly string[],
  n: number,
): string[] {
  const { netlist, vector, read } = bench(doc);
  let state: SeqState = initialState(netlist);
  const out: string[] = [];

  // Establish the clock's resting level first. A flip-flop that has never seen
  // its clock has no "before" to compare against, so the very first transition
  // after power-up is not an edge — which is exactly what happens on a real
  // board, and why the app simulates once as soon as a circuit is loaded.
  state = evaluate(netlist, vector(bits), { state, clocks: netlist.clocks.map(() => 0) }).state;

  for (let i = 0; i < n; i++) {
    state = evaluate(netlist, vector(bits), {
      state,
      clocks: netlist.clocks.map(() => 1),
    }).state;
    const settled = evaluate(netlist, vector(bits), {
      state,
      clocks: netlist.clocks.map(() => 0),
    });
    state = settled.state;
    out.push(leds.map((l) => String(read(settled.values, l))).join(""));
  }
  return out;
}

/** Assert the clear line actually reaches every flip-flop. */
function clearedTo(doc: CircuitDocument, leds: readonly string[]): Logic[] {
  const { netlist, vector, read } = bench(doc);
  const r = evaluate(netlist, vector({ CLR: 0 }), { clocks: netlist.clocks.map(() => 0) });
  return leds.map((l) => read(r.values, l));
}

describe("the sequential presets", () => {
  it("every one of them powers, and raises no error", () => {
    for (const preset of SEQUENTIAL_PRESETS) {
      const doc = preset.build();
      const { index, netlist } = elaborate(doc);
      const state = evaluate(netlist, netlist.inputs.map(() => 0 as const));
      const errors = diagnose(doc, index, netlist, state).filter(
        (d) => d.severity === "error",
      );
      expect(errors.map((e) => e.code), preset.id).toEqual([]);
    }
  });

  it("every one of them has a clock, and every flip-flop's clock is driven", () => {
    for (const preset of SEQUENTIAL_PRESETS) {
      const doc = preset.build();
      const { index, netlist } = elaborate(doc);
      expect(netlist.clocks.length, preset.id).toBeGreaterThan(0);
      expect(netlist.flops.length, preset.id).toBeGreaterThan(0);

      const state = evaluate(netlist, netlist.inputs.map(() => 0 as const));
      const floating = diagnose(doc, index, netlist, state).filter(
        (d) => d.code === "FLOATING_CLOCK",
      );
      expect(floating, preset.id).toEqual([]);
    }
  });

  it("clears to zero, because a flip-flop powers up unknown", () => {
    // Hold clear low and every Q must be a definite 0. A preset whose clear
    // does not reach every stage leaves an X on the board that no amount of
    // clocking will resolve.
    expect(clearedTo(getSequentialPreset("ripple-4")!.build(), ["Q0", "Q1", "Q2", "Q3"]))
      .toEqual([L0, L0, L0, L0]);
    expect(clearedTo(getSequentialPreset("register-4")!.build(), ["Q1", "Q2", "Q3", "Q4"]))
      .toEqual([L0, L0, L0, L0]);
  });

  it("counts 0 to 15 on the 4-bit ripple counter, in order", () => {
    const doc = getSequentialPreset("ripple-4")!.build();
    // Clear first, then count. Reading Q3..Q0 gives the number MSB-first.
    const { netlist, vector } = bench(doc);
    let state = evaluate(netlist, vector({ CLR: 0 }), { clocks: [0] }).state;

    const seen: number[] = [];
    for (let i = 0; i < 17; i++) {
      state = evaluate(netlist, vector({ CLR: 1 }), { state, clocks: [1] }).state;
      const r = evaluate(netlist, vector({ CLR: 1 }), { state, clocks: [0] });
      state = r.state;
      const read = (l: string) =>
        r.values[netlist.outputs.find((o) => o.label === l)?.net ?? 0] === L1 ? 1 : 0;
      seen.push(read("Q3") * 8 + read("Q2") * 4 + read("Q1") * 2 + read("Q0"));
    }

    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1]);
  });

  it("counts the same on the synchronous version, one wire apart", () => {
    const doc = getSequentialPreset("sync-2")!.build();
    const { netlist, vector } = bench(doc);
    let state = evaluate(netlist, vector({ CLR: 0 }), { clocks: [0] }).state;

    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      state = evaluate(netlist, vector({ CLR: 1 }), { state, clocks: [1] }).state;
      const r = evaluate(netlist, vector({ CLR: 1 }), { state, clocks: [0] });
      state = r.state;
      const read = (l: string) =>
        r.values[netlist.outputs.find((o) => o.label === l)?.net ?? 0];
      seen.push(`${read("Q1")}${read("Q0")}`);
    }
    expect(seen).toEqual(["01", "10", "11", "00", "01"]);
  });

  it("halves the clock rate on the divide-by-two", () => {
    const doc = getSequentialPreset("divide-by-two")!.build();
    const { netlist, vector } = bench(doc);
    let state = evaluate(netlist, vector({ CLR: 0 }), { clocks: [0] }).state;

    const seen: Logic[] = [];
    for (let i = 0; i < 4; i++) {
      const r = evaluate(netlist, vector({ CLR: 1 }), { state, clocks: [1] });
      state = r.state;
      seen.push(r.values[netlist.outputs[0]?.net ?? 0] as Logic);
      state = evaluate(netlist, vector({ CLR: 1 }), { state, clocks: [0] }).state;
    }
    // One change per pulse: 1, 0, 1, 0 — half the rate of the clock driving it.
    expect(seen).toEqual([L1, L0, L1, L0]);
  });

  it("walks a bit along the shift register, one place per pulse", () => {
    const doc = getSequentialPreset("shift-4")!.build();
    const { netlist, vector } = bench(doc);
    let state = evaluate(netlist, vector({ CLR: 0, SIN: 0 }), { clocks: [0] }).state;

    const step = (sin: 0 | 1) => {
      state = evaluate(netlist, vector({ CLR: 1, SIN: sin }), { state, clocks: [1] }).state;
      const r = evaluate(netlist, vector({ CLR: 1, SIN: sin }), { state, clocks: [0] });
      state = r.state;
      return [1, 2, 3, 4]
        .map((i) => r.values[netlist.outputs.find((o) => o.label === `Q${i}`)?.net ?? 0])
        .join("");
    };

    // One 1 in, then zeros: it should march across and fall off the end.
    expect(step(1)).toBe("1000");
    expect(step(0)).toBe("0100");
    expect(step(0)).toBe("0010");
    expect(step(0)).toBe("0001");
    expect(step(0)).toBe("0000");
  });

  it("loads all four bits of the register at once, and holds them", () => {
    const doc = getSequentialPreset("register-4")!.build();
    const pattern = { CLR: 1, D1: 1, D2: 0, D3: 1, D4: 0 } as const;
    const seen = pulses(doc, pattern, ["Q1", "Q2", "Q3", "Q4"], 2);
    expect(seen[0]).toBe(`${L1}${L0}${L1}${L0}`);
    expect(seen[1], "a second pulse loads the same data again").toBe(seen[0]);
  });

  it("gives every preset a distinct id", () => {
    const ids = SEQUENTIAL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getSequentialPreset("nope")).toBeUndefined();
  });
});
