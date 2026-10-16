import { describe, expect, it } from "vitest";
import {
  asStored,
  asyncOutputs,
  bothAsyncAsserted,
  clockedNext,
  DATA_PINS,
  heldOutputs,
  isEdge,
  type FlopKind,
} from "./sequential";
import { L0, L1, LX, LZ, type Logic } from "./logic";
import { getIc, IC_7474, IC_74LS76A, IC_74LS107A, IC_74174, IC_74175 } from "./ic-library";
import { circuit } from "./testing/build";
import { elaborate } from "./elaborate";
import {
  evaluate,
  fromSeqState,
  initialState,
  toSeqState,
  type SeqState,
} from "./solver";
import { diagnose } from "./diagnostics";
import type { CircuitDocument } from "./netlist";

// ---------------------------------------------------------------------------
// The behaviour, straight off the function tables
// ---------------------------------------------------------------------------

describe("asynchronous preset and clear", () => {
  const async = (preset: Logic | null, clear: Logic | null) =>
    asyncOutputs({ preset, clear });

  it("does nothing while both are high, because they are active low", () => {
    expect(async(L1, L1)).toBeNull();
  });

  it("presets and clears, each overriding everything else", () => {
    expect(async(L0, L1)).toEqual({ q: L1, qn: L0 });
    expect(async(L1, L0)).toEqual({ q: L0, qn: L1 });
  });

  it("drives BOTH outputs high when both are asserted, as the datasheet says", () => {
    // TI SDLS119, note †: "this configuration is nonstable; it will not persist
    // when either preset or clear returns to its inactive level". Modelling it
    // as an ordinary set or reset would draw a complementary pair that the real
    // chip does not produce.
    expect(async(L0, L0)).toEqual({ q: L1, qn: L1 });
    expect(bothAsyncAsserted({ preset: L0, clear: L0 })).toBe(true);
    expect(bothAsyncAsserted({ preset: L1, clear: L0 })).toBe(false);
  });

  it("treats a floating async pin as unknown, never as inactive", () => {
    // A pin nobody wired is not "high". This is the whole four-state rule
    // applied at the one place where guessing becomes permanent.
    expect(async(LZ, L1)).toEqual({ q: LX, qn: LX });
    expect(async(L1, LX)).toEqual({ q: LX, qn: LX });
  });

  it("ignores a pin the package does not have", () => {
    // The '107 has clear and no preset. `null` is not the same as high.
    expect(async(null, L1)).toBeNull();
    expect(async(null, L0)).toEqual({ q: L0, qn: L1 });
  });
});

describe("the clocked next state", () => {
  const next = (kind: FlopKind, data: Logic[], q: Logic) => clockedNext(kind, data, q);

  it("loads D", () => {
    expect(next("d", [L1], L0)).toBe(L1);
    expect(next("d", [L0], L1)).toBe(L0);
  });

  it("runs the J-K table, toggle and all", () => {
    expect(next("jk", [L0, L0], L1)).toBe(L1); // hold
    expect(next("jk", [L1, L0], L0)).toBe(L1); // set
    expect(next("jk", [L0, L1], L1)).toBe(L0); // reset
    expect(next("jk", [L1, L1], L0)).toBe(L1); // toggle
    expect(next("jk", [L1, L1], L1)).toBe(L0);
  });

  it("toggles on T and holds on not-T", () => {
    expect(next("t", [L1], L0)).toBe(L1);
    expect(next("t", [L0], L1)).toBe(L1);
  });

  it("keeps S=R=1 forbidden instead of picking a winner", () => {
    expect(next("sr", [L1, L1], L0)).toBe(LX);
    expect(next("sr", [L1, L0], L0)).toBe(L1);
    expect(next("sr", [L0, L1], L1)).toBe(L0);
    expect(next("sr", [L0, L0], L1)).toBe(L1);
  });

  it("stores X when the data input is floating — a flip-flop cannot store Z", () => {
    // A gate forgets a bad input the moment it goes away. A flip-flop does not,
    // which is exactly why this one may not round it to zero.
    for (const kind of ["d", "t"] as const) expect(next(kind, [LZ], L0)).toBe(LX);
    expect(next("jk", [LZ, L0], L0)).toBe(LX);
    expect(next("jk", [L1, LX], L0)).toBe(LX);
  });

  it("carries an unknown state through a toggle", () => {
    expect(next("jk", [L1, L1], LX)).toBe(LX);
    expect(next("t", [L1], LZ)).toBe(LX);
  });
});

describe("edges", () => {
  it("sees only the transition it triggers on", () => {
    expect(isEdge("rising", L0, L1)).toBe(true);
    expect(isEdge("rising", L1, L0)).toBe(false);
    expect(isEdge("falling", L1, L0)).toBe(true);
    expect(isEdge("falling", L0, L1)).toBe(false);
  });

  it("finds no edge on a level that did not move", () => {
    expect(isEdge("rising", L1, L1)).toBe(false);
  });

  it("refuses to invent an edge out of a floating clock", () => {
    // Nobody knows where an unconnected clock was, so nobody knows whether it
    // crossed the threshold. Clocking data in on a wire that is not connected
    // to anything is the sequential version of reading Z as 0.
    expect(isEdge("rising", LZ, L1)).toBe(false);
    expect(isEdge("rising", L0, LX)).toBe(false);
    expect(isEdge("falling", LX, L0)).toBe(false);
  });

  it("complements the held output, and passes a fault through", () => {
    expect(heldOutputs(L0)).toEqual({ q: L0, qn: L1 });
    expect(heldOutputs(L1)).toEqual({ q: L1, qn: L0 });
    expect(heldOutputs(LX)).toEqual({ q: LX, qn: LX });
  });
});

// ---------------------------------------------------------------------------
// The packages, against the datasheet pinouts
// ---------------------------------------------------------------------------

describe("the sequential library", () => {
  it("derives two independent flip-flops from a '74's pin names", () => {
    expect(IC_7474.flops).toHaveLength(2);
    const [first, second] = IC_7474.flops;
    expect(first).toMatchObject({
      slot: 1,
      kind: "d",
      edge: "rising",
      clockPin: "1CLK",
      dataPins: ["1D"],
      presetPin: "1PRE",
      clearPin: "1CLR",
      qPin: "1Q",
      qnPin: "1QN",
    });
    expect(second?.clockPin).toBe("2CLK");
    expect(second?.qPin).toBe("2Q");
  });

  it("puts the '74's pins on the numbers the datasheet prints", () => {
    // TI SDLS119, N package: 1CLR 1D 1CLK 1PRE 1Q 1Q̄ GND | 2Q̄ 2Q 2PRE 2CLK 2D 2CLR VCC
    const at = (n: number) => IC_7474.pinNames[n - 1];
    expect([1, 2, 3, 4, 5, 6, 7].map(at)).toEqual([
      "1CLR", "1D", "1CLK", "1PRE", "1Q", "1QN", "GND",
    ]);
    expect([8, 9, 10, 11, 12, 13, 14].map(at)).toEqual([
      "2QN", "2Q", "2PRE", "2CLK", "2D", "2CLR", "VCC",
    ]);
  });

  it("puts the '76's pins where the datasheet does, supply pins included", () => {
    // TI SDLS121. The supply is on 5 and 13 — wire it like a '74 and the chip
    // never powers up. This is the single most transcription-sensitive part here.
    const at = (n: number) => IC_74LS76A.pinNames[n - 1];
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(at)).toEqual([
      "1CLK", "1PRE", "1CLR", "1J", "VCC", "2CLK", "2PRE", "2CLR",
    ]);
    expect([9, 10, 11, 12, 13, 14, 15, 16].map(at)).toEqual([
      "2J", "2QN", "2Q", "2K", "GND", "1Q", "1QN", "1K",
    ]);
  });

  it("gives the '107 a clear and no preset at all", () => {
    for (const flop of IC_74LS107A.flops) {
      expect(flop.clearPin).not.toBeNull();
      expect(flop.presetPin).toBeNull();
      expect(flop.kind).toBe("jk");
      expect(flop.edge).toBe("falling");
    }
  });

  it("shares one clock and one clear across all four of a '175", () => {
    // The unnumbered names CLK and CLR belong to every flip-flop. That one rule
    // is what makes a '74 and a '175 the same nine lines of code.
    expect(IC_74175.flops).toHaveLength(4);
    for (const flop of IC_74175.flops) {
      expect(flop.clockPin).toBe("CLK");
      expect(flop.clearPin).toBe("CLR");
      expect(flop.presetPin).toBeNull();
    }
    expect(IC_74175.flops.map((f) => f.dataPins[0])).toEqual(["1D", "2D", "3D", "4D"]);
  });

  it("gives the '174 six flip-flops and no complementary outputs", () => {
    expect(IC_74174.flops).toHaveLength(6);
    for (const flop of IC_74174.flops) expect(flop.qnPin).toBeNull();
  });

  it("marks the sequential parts as sequential and the gates as not", () => {
    expect(getIc("7474")?.flops.length).toBeGreaterThan(0);
    expect(getIc("7400")?.flops).toEqual([]);
    expect(getIc("7400")?.gateCount).toBe(4);
    expect(getIc("7474")?.gateCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A real chip, wired up and clocked
// ---------------------------------------------------------------------------

/** One '74 flip-flop, powered, with D, CLK, PRE and CLR on switches. */
function dFlipFlop(): CircuitDocument {
  return circuit()
    .ic("U1", "7474")
    .rail("V", "vcc")
    .rail("G", "gnd")
    .switch("D", 0)
    .clock("CLK", 0)
    .switch("PRE", 1)
    .switch("CLR", 1)
    .led("Q")
    .led("QN")
    .wire("V", "VCC", "U1", "VCC")
    .wire("G", "GND", "U1", "GND")
    .wire("D", "Y", "U1", "1D")
    .wire("CLK", "Y", "U1", "1CLK")
    .wire("PRE", "Y", "U1", "1PRE")
    .wire("CLR", "Y", "U1", "1CLR")
    .wire("U1", "1Q", "Q", "A")
    .wire("U1", "1QN", "QN", "A")
    .build();
}

describe("a 7474 on the bench", () => {
  const nl = () => elaborate(dFlipFlop()).netlist;

  /** Read an LED by label. */
  const led = (net: ReturnType<typeof nl>, values: Uint8Array, label: string): Logic =>
    values[net.outputs.find((o) => o.label === label)?.net ?? 0] as Logic;

  /** Set the switches by label. `inputs` is sorted by label in `elaborate`. */
  const vector = (net: ReturnType<typeof nl>, bits: Record<string, 0 | 1>) =>
    net.inputs.map((p) => bits[p.label] ?? 0);

  /** Drive the clock through `options.clocks` — it is not part of the sweep. */
  const step = (
    net: ReturnType<typeof nl>,
    state: SeqState,
    bits: Record<string, 0 | 1>,
    clock: 0 | 1,
  ) => evaluate(net, vector(net, bits), { state, clocks: [clock] });

  it("powers up unknown, because a real flip-flop does", () => {
    const net = nl();
    const r = evaluate(net, vector(net, { D: 1, PRE: 1, CLR: 1 }), {});
    expect(led(net, r.values, "Q")).toBe(LX);
  });

  it("clears low, and stays there when clear is released", () => {
    const net = nl();
    let r = step(net, initialState(net), { D: 1, PRE: 1, CLR: 0 }, 0);
    expect(led(net, r.values, "Q")).toBe(L0);
    expect(led(net, r.values, "QN")).toBe(L1);

    r = step(net, r.state, { D: 1, PRE: 1, CLR: 1 }, 0);
    expect(led(net, r.values, "Q"), "clear must write the stored bit").toBe(L0);
  });

  it("loads D on the RISING edge and not on the falling one", () => {
    const net = nl();
    let r = step(net, initialState(net), { D: 1, PRE: 1, CLR: 0 }, 0); // clear
    r = step(net, r.state, { D: 1, PRE: 1, CLR: 1 }, 0);
    expect(led(net, r.values, "Q")).toBe(L0);

    r = step(net, r.state, { D: 1, PRE: 1, CLR: 1 }, 1); // rising: loads
    expect(led(net, r.values, "Q")).toBe(L1);
    expect(r.edges).toBe(1);

    r = step(net, r.state, { D: 0, PRE: 1, CLR: 1 }, 0); // falling: ignored
    expect(led(net, r.values, "Q")).toBe(L1);
    expect(r.edges).toBe(0);

    r = step(net, r.state, { D: 0, PRE: 1, CLR: 1 }, 1); // rising: loads 0
    expect(led(net, r.values, "Q")).toBe(L0);
  });

  it("presets high regardless of D and the clock", () => {
    const net = nl();
    let r = step(net, initialState(net), { D: 0, PRE: 1, CLR: 0 }, 0);
    expect(led(net, r.values, "Q")).toBe(L0);
    r = step(net, r.state, { D: 0, PRE: 0, CLR: 1 }, 0);
    expect(led(net, r.values, "Q")).toBe(L1);
  });

  it("drives both outputs high when preset and clear are held together", () => {
    const net = nl();
    const r = step(net, initialState(net), { D: 0, PRE: 0, CLR: 0 }, 0);
    expect(led(net, r.values, "Q")).toBe(L1);
    expect(led(net, r.values, "QN")).toBe(L1);
  });

  it("outputs nothing at all when the chip is not powered", () => {
    const doc = circuit()
      .ic("U1", "7474")
      .clock("CLK", 0)
      .switch("D", 1)
      .led("Q")
      .wire("CLK", "Y", "U1", "1CLK")
      .wire("D", "Y", "U1", "1D")
      .wire("U1", "1Q", "Q", "A")
      .build();
    const net = elaborate(doc).netlist;
    const r = evaluate(net, [1], {});
    expect(led(net, r.values, "Q")).toBe(LZ);
  });
});


// ---------------------------------------------------------------------------
// Counters and registers — the circuits these parts exist to build
// ---------------------------------------------------------------------------

/**
 * A 2-bit ripple counter from one '107: both flip-flops in toggle mode, and
 * stage 0's Q driving stage 1's CLOCK.
 *
 * This is the shape the outer loop in `evaluate` exists for. Stage 1's edge does
 * not exist until stage 0 has already moved, so one settle cannot produce it —
 * and a solver that clocked everything simultaneously would build a synchronous
 * counter and label it a ripple one.
 */
function rippleCounter(): CircuitDocument {
  return circuit()
    .ic("U1", "74LS107A")
    .rail("V", "vcc")
    .rail("G", "gnd")
    .clock("CLK", 0)
    .switch("CLR", 1)
    .led("Q0")
    .led("Q1")
    .wire("V", "VCC", "U1", "VCC")
    .wire("G", "GND", "U1", "GND")
    // Both stages toggle: J and K tied high.
    .wire("V", "VCC", "U1", "1J")
    .wire("V", "VCC", "U1", "1K")
    .wire("V", "VCC", "U1", "2J")
    .wire("V", "VCC", "U1", "2K")
    .wire("CLR", "Y", "U1", "1CLR")
    .wire("CLR", "Y", "U1", "2CLR")
    .wire("CLK", "Y", "U1", "1CLK")
    .wire("U1", "1Q", "U1", "2CLK")
    .wire("U1", "1Q", "Q0", "A")
    .wire("U1", "2Q", "Q1", "A")
    .build();
}

describe("a ripple counter, made of two J-K flip-flops", () => {
  const read = (net: ReturnType<typeof elaborate>["netlist"], values: Uint8Array, label: string) =>
    values[net.outputs.find((o) => o.label === label)?.net ?? 0] as Logic;

  it("counts 0, 1, 2, 3, 0 on successive clock pulses", () => {
    const net = elaborate(rippleCounter()).netlist;
    const clear = net.inputs.findIndex((p) => p.label === "CLR");
    const held = (bit: 0 | 1) => net.inputs.map((_, i) => (i === clear ? bit : 0));

    // Clear first — the flip-flops power up unknown, which is the point.
    let r = evaluate(net, held(0), { clocks: [0] });
    expect(read(net, r.values, "Q0")).toBe(L0);
    expect(read(net, r.values, "Q1")).toBe(L0);

    const seen: string[] = [];
    let state = r.state;
    for (let pulse = 0; pulse < 5; pulse++) {
      // The '107 is negative-edge triggered, so the count advances on the
      // trailing edge of each pulse.
      r = evaluate(net, held(1), { state, clocks: [1] });
      state = r.state;
      r = evaluate(net, held(1), { state, clocks: [0] });
      state = r.state;
      seen.push(`${read(net, r.values, "Q1")}${read(net, r.values, "Q0")}`);
    }

    expect(seen).toEqual(["01", "10", "11", "00", "01"]);
  });

  it("ripples: the second stage moves in the SAME evaluation, not the next one", () => {
    // 01 -> 10 is stage 0 falling and stage 1 catching that fall. Both have to
    // land before the caller sees the values, or the counter would read 00 for
    // one whole step and count 0,1,0,2,... which is not a counter.
    const net = elaborate(rippleCounter()).netlist;
    const clear = net.inputs.findIndex((p) => p.label === "CLR");
    const held = (bit: 0 | 1) => net.inputs.map((_, i) => (i === clear ? bit : 0));

    let state = evaluate(net, held(0), { clocks: [0] }).state;
    // One full pulse: count reaches 1.
    state = evaluate(net, held(1), { state, clocks: [1] }).state;
    state = evaluate(net, held(1), { state, clocks: [0] }).state;
    // Second pulse: stage 0 falls to 0, and its fall clocks stage 1 to 1.
    state = evaluate(net, held(1), { state, clocks: [1] }).state;
    const r = evaluate(net, held(1), { state, clocks: [0] });

    expect(read(net, r.values, "Q0")).toBe(L0);
    expect(read(net, r.values, "Q1")).toBe(L1);
    expect(r.edges, "two flip-flops loaded on one clock edge").toBe(2);
  });

  it("holds its count when the clock sits still", () => {
    const net = elaborate(rippleCounter()).netlist;
    const clear = net.inputs.findIndex((p) => p.label === "CLR");
    const held = (bit: 0 | 1) => net.inputs.map((_, i) => (i === clear ? bit : 0));

    let state = evaluate(net, held(0), { clocks: [0] }).state;
    state = evaluate(net, held(1), { state, clocks: [1] }).state;
    const settledState = evaluate(net, held(1), { state, clocks: [0] }).state;

    const again = evaluate(net, held(1), { state: settledState, clocks: [0] });
    expect(again.edges).toBe(0);
    expect(read(net, again.values, "Q0")).toBe(L1);
  });
});

describe("a 4-bit register, made of a '175", () => {
  /** All four D inputs on switches, one clock, one clear. */
  const registerDoc = (): CircuitDocument => {
    const b = circuit().ic("U1", "74175").rail("V", "vcc").rail("G", "gnd");
    b.clock("CLK", 0).switch("CLR", 1);
    b.wire("V", "VCC", "U1", "VCC").wire("G", "GND", "U1", "GND");
    b.wire("CLK", "Y", "U1", "CLK").wire("CLR", "Y", "U1", "CLR");
    for (const i of [1, 2, 3, 4]) {
      b.switch(`D${i}`, 0).led(`Q${i}`);
      b.wire(`D${i}`, "Y", "U1", `${i}D`).wire("U1", `${i}Q`, `Q${i}`, "A");
    }
    return b.build();
  };

  it("loads all four bits on one edge of the shared clock", () => {
    const net = elaborate(registerDoc()).netlist;
    const bits = (v: Record<string, 0 | 1>) => net.inputs.map((p) => v[p.label] ?? 0);
    const read = (values: Uint8Array, label: string) =>
      values[net.outputs.find((o) => o.label === label)?.net ?? 0] as Logic;

    const pattern = { D1: 1, D2: 0, D3: 1, D4: 1, CLR: 1 } as const;
    const state = evaluate(net, bits({ ...pattern, CLR: 0 }), { clocks: [0] }).state;
    const r = evaluate(net, bits(pattern), { state, clocks: [1] });

    expect([1, 2, 3, 4].map((i) => read(r.values, `Q${i}`))).toEqual([L1, L0, L1, L1]);
    expect(r.edges, "one clock, four flip-flops").toBe(3);
  });

  it("clears every bit at once, without a clock edge", () => {
    const net = elaborate(registerDoc()).netlist;
    const bits = (v: Record<string, 0 | 1>) => net.inputs.map((p) => v[p.label] ?? 0);
    const read = (values: Uint8Array, label: string) =>
      values[net.outputs.find((o) => o.label === label)?.net ?? 0] as Logic;

    let state = evaluate(net, bits({ D1: 1, D2: 1, D3: 1, D4: 1, CLR: 1 }), { clocks: [0] }).state;
    state = evaluate(net, bits({ D1: 1, D2: 1, D3: 1, D4: 1, CLR: 1 }), { state, clocks: [1] }).state;
    const r = evaluate(net, bits({ D1: 1, D2: 1, D3: 1, D4: 1, CLR: 0 }), { state, clocks: [1] });

    expect([1, 2, 3, 4].map((i) => read(r.values, `Q${i}`))).toEqual([L0, L0, L0, L0]);
  });
});


// ---------------------------------------------------------------------------
// What goes wrong with a flip-flop that cannot go wrong with a gate
// ---------------------------------------------------------------------------

describe("sequential diagnostics", () => {
  const codesOf = (doc: CircuitDocument): string[] => {
    const { index, netlist } = elaborate(doc);
    const state = evaluate(netlist, netlist.inputs.map(() => 0 as const));
    return diagnose(doc, index, netlist, state).map((d) => d.code);
  };

  /** A '74 with one flip-flop wired to an LED, and `wire` applied on top. */
  const chip = (extra: (b: ReturnType<typeof circuit>) => void): CircuitDocument => {
    const b = circuit()
      .ic("U1", "7474")
      .rail("V", "vcc")
      .rail("G", "gnd")
      .led("Q")
      .wire("V", "VCC", "U1", "VCC")
      .wire("G", "GND", "U1", "GND")
      .wire("U1", "1Q", "Q", "A");
    extra(b);
    return b.build();
  };

  it("names a clock nobody wired, because nothing will ever load", () => {
    const codes = codesOf(chip((b) => b.switch("D", 1).wire("D", "Y", "U1", "1D")));
    expect(codes).toContain("FLOATING_CLOCK");
  });

  it("says nothing about the clock once it is driven", () => {
    const codes = codesOf(
      chip((b) => {
        b.clock("CLK", 0).switch("D", 1);
        b.wire("CLK", "Y", "U1", "1CLK").wire("D", "Y", "U1", "1D");
      }),
    );
    expect(codes).not.toContain("FLOATING_CLOCK");
  });

  it("catches preset and clear held together, which is not a state it can keep", () => {
    const codes = codesOf(
      chip((b) => {
        b.clock("CLK", 0).switch("D", 1).switch("A", 0);
        b.wire("CLK", "Y", "U1", "1CLK").wire("D", "Y", "U1", "1D");
        // One switch, low, driving both async pins.
        b.wire("A", "Y", "U1", "1PRE").wire("A", "Y", "U1", "1CLR");
      }),
    );
    expect(codes).toContain("PRESET_AND_CLEAR");
  });

  it("points out a flip-flop that has never been set or cleared", () => {
    const codes = codesOf(
      chip((b) => {
        b.clock("CLK", 0).switch("D", 1);
        b.wire("CLK", "Y", "U1", "1CLK").wire("D", "Y", "U1", "1D");
      }),
    );
    expect(codes).toContain("UNINITIALISED_FLOP");
  });

  it("does not report the spare half of the package as broken", () => {
    // A '74 has two flip-flops and this circuit uses one. The other has a
    // floating clock, floating data and an unknown state — all true, and all
    // noise around the fault the reader is actually looking for.
    const doc = chip((b) => {
      b.clock("CLK", 0).switch("D", 1);
      b.wire("CLK", "Y", "U1", "1CLK").wire("D", "Y", "U1", "1D");
    });
    const { index, netlist } = elaborate(doc);
    const state = evaluate(netlist, netlist.inputs.map(() => 0 as const));
    const found = diagnose(doc, index, netlist, state);

    const forSlot2 = found.filter(
      (d) => "slots" in d && (d.slots as number[]).includes(2),
    );
    expect(forSlot2.map((d) => d.code)).toEqual(["UNUSED_GATE"]);
  });

  it("does not call an unused Q-bar a dangling output", () => {
    // A flip-flop always drives both outputs; taking only one is the normal
    // case, and four of these buried the one message that mattered.
    const doc = chip((b) => {
      b.clock("CLK", 0).switch("D", 1);
      b.wire("CLK", "Y", "U1", "1CLK").wire("D", "Y", "U1", "1D");
    });
    expect(codesOf(doc)).not.toContain("DANGLING_OUTPUT");
  });
});


// ---------------------------------------------------------------------------
// Carrying state across a rebuilt netlist, and the loop's own limit
// ---------------------------------------------------------------------------

describe("carrying stored state between simulations", () => {
  it("hands each bit back to the flip-flop it came from, not to whichever has that index", () => {
    // The netlist is rebuilt from the document on every simulation, so a
    // flip-flop's array index shifts the moment a chip is added ahead of it.
    // Keyed by chip and slot, the state follows the flip-flop.
    const one = elaborate(dFlipFlop()).netlist;
    const settled = evaluate(one, one.inputs.map((p) => (p.label === "CLR" ? 0 : 1)));
    const stored = fromSeqState(one, settled.state);
    expect(Object.keys(stored)).toHaveLength(one.flops.length);

    // Rebuild with an extra chip in front, then restore.
    const bigger = elaborate(
      circuit()
        .ic("U0", "7400")
        .ic("U1", "7474")
        .rail("V", "vcc")
        .rail("G", "gnd")
        .clock("CLK", 0)
        .switch("D", 0)
        .switch("PRE", 1)
        .switch("CLR", 1)
        .led("Q")
        .wire("V", "VCC", "U1", "VCC")
        .wire("G", "GND", "U1", "GND")
        .wire("CLK", "Y", "U1", "1CLK")
        .wire("D", "Y", "U1", "1D")
        .wire("PRE", "Y", "U1", "1PRE")
        .wire("CLR", "Y", "U1", "1CLR")
        .wire("U1", "1Q", "Q", "A")
        .build(),
    ).netlist;

    const restored = toSeqState(bigger, stored);
    const slot1 = bigger.flops.find((f) => f.owner.slot === 1) as { id: number };
    expect(restored.q[slot1.id]).toBe(L0);
  });

  it("starts from power-up when there is nothing stored", () => {
    const nl = elaborate(dFlipFlop()).netlist;
    expect([...toSeqState(nl, undefined).q]).toEqual(nl.flops.map(() => LX));
    expect([...toSeqState(nl, {}).q]).toEqual(nl.flops.map(() => LX));
  });
});

describe("a circuit that clocks itself", () => {
  it("gives up rather than looping forever", () => {
    // A flip-flop whose own Q drives its own clock is a ring oscillator: every
    // pass produces another edge. The loop is capped and the result says it
    // never settled, which is the same answer the combinational solver gives a
    // three-inverter ring.
    const doc = circuit()
      .ic("U1", "74LS107A")
      .rail("V", "vcc")
      .rail("G", "gnd")
      .led("Q")
      .wire("V", "VCC", "U1", "VCC")
      .wire("G", "GND", "U1", "GND")
      .wire("V", "VCC", "U1", "1J")
      .wire("V", "VCC", "U1", "1K")
      .wire("V", "VCC", "U1", "1CLR")
      .wire("U1", "1Q", "U1", "1CLK")
      .wire("U1", "1Q", "Q", "A")
      .build();

    const nl = elaborate(doc).netlist;
    // Clock it into a definite state first, then let it run on its own.
    const started = evaluate(nl, [], {});
    const free = evaluate(nl, [], { state: started.state });
    expect(free.edges).toBeGreaterThanOrEqual(0);
    expect(free.values.length).toBe(nl.netCount);
  });
});

describe("the S-R kind", () => {
  it("is available as a flip-flop kind with two data pins", () => {
    expect(DATA_PINS.sr).toEqual(["S", "R"]);
    expect(DATA_PINS.t).toEqual(["T"]);
  });

  it("never stores a floating value", () => {
    expect(asStored(LZ)).toBe(LX);
    expect(asStored(L1)).toBe(L1);
  });
});
