import { describe, expect, it } from "vitest";
import {
  IC_7400,
  IC_7402,
  IC_7404,
  IC_7408,
  IC_7410,
  IC_7411,
  IC_7420,
  IC_7421,
  IC_7427,
  IC_7430,
  IC_7432,
  IC_7486,
  IC_LIBRARY,
  pinOffset,
  validateDefinition,
  type IcDefinition,
} from "./ic-library";
import { elaborate } from "./elaborate";
import { evaluate } from "./solver";
import { diagnose } from "./diagnostics";
import { L0, L1, LX, LZ, type Logic } from "./logic";
import { circuit, ref } from "./testing/build";
import { pinKey, type CircuitDocument } from "./netlist";
import type { InputVector } from "./solver";

const pinNamed = (def: IcDefinition, number: number) =>
  def.pins.find((p) => p.number === number);

function run(doc: CircuitDocument, inputs: InputVector = []) {
  const { index, netlist } = elaborate(doc);
  const state = evaluate(netlist, inputs);
  const diagnostics = diagnose(doc, index, netlist, state);
  const at = (node: string, pin: string): Logic => {
    const netId = index.netOfPin.get(pinKey(ref(node, pin)));
    if (netId === undefined) throw new Error(`no such pin ${node}.${pin}`);
    return state.values[index.ordinalOf.get(netId) as number] as Logic;
  };
  return { state, diagnostics, at };
}

const codes = (ds: ReturnType<typeof diagnose>): string[] => ds.map((d) => d.code);

describe("pinouts — transcribed, then verified pin by pin", () => {
  // If any of these drift, a student wires a real chip to the wrong hole.
  it.each([
    [IC_7400, ["1A","1B","1Y","2A","2B","2Y","GND","3Y","3A","3B","4Y","4A","4B","VCC"]],
    [IC_7402, ["1Y","1A","1B","2Y","2A","2B","GND","3A","3B","3Y","4A","4B","4Y","VCC"]],
    [IC_7404, ["1A","1Y","2A","2Y","3A","3Y","GND","4Y","4A","5Y","5A","6Y","6A","VCC"]],
    [IC_7408, ["1A","1B","1Y","2A","2B","2Y","GND","3Y","3A","3B","4Y","4A","4B","VCC"]],
    [IC_7432, ["1A","1B","1Y","2A","2B","2Y","GND","3Y","3A","3B","4Y","4A","4B","VCC"]],
    [IC_7486, ["1A","1B","1Y","2A","2B","2Y","GND","3Y","3A","3B","4Y","4A","4B","VCC"]],
  ])("$part has the datasheet pinout", (def, expected) => {
    expect(def.pinNames).toEqual(expected);
  });

  /**
   * THE ONE EVERYONE GETS WRONG. The 7402's gate 1 is inputs (2,3) -> output 1:
   * the OUTPUT comes first. Every other quad gate here puts the inputs first. A
   * gate map written by pattern-matching the 7400 would put 1Y on pin 3, and the
   * simulation would be perfect while the real breadboard was wrong.
   */
  it("7402 gate 1 is inputs (2,3) -> output 1, NOT the 7400 shape", () => {
    expect(pinNamed(IC_7402, 1)?.name).toBe("1Y");
    expect(pinNamed(IC_7402, 1)?.dir).toBe("out");
    expect(pinNamed(IC_7402, 2)?.name).toBe("1A");
    expect(pinNamed(IC_7402, 3)?.name).toBe("1B");

    const gate1 = IC_7402.cells.find((c) => c.slot === 1);
    expect(gate1?.inputPins).toEqual(["1A", "1B"]);
    expect(gate1?.outputPin).toBe("1Y");
  });

  it("7402's RIGHT half flips back to A,B,Y order", () => {
    expect(pinNamed(IC_7402, 8)?.name).toBe("3A");
    expect(pinNamed(IC_7402, 10)?.name).toBe("3Y");
    expect(pinNamed(IC_7402, 10)?.dir).toBe("out");
  });

  it("7400 gate 1 IS the inputs-first shape — the contrast that makes 7402 a trap", () => {
    expect(pinNamed(IC_7400, 3)?.name).toBe("1Y");
    expect(pinNamed(IC_7400, 3)?.dir).toBe("out");
  });

  it("7404's right half reverses too: pin 8 is 4Y, pin 9 is 4A", () => {
    expect(pinNamed(IC_7404, 8)?.name).toBe("4Y");
    expect(pinNamed(IC_7404, 9)?.name).toBe("4A");
    const gate4 = IC_7404.cells.find((c) => c.slot === 4);
    expect(gate4?.inputPins).toEqual(["4A"]);
    expect(gate4?.outputPin).toBe("4Y");
  });

  it("puts Vcc on 14 and GND on 7 for every part", () => {
    for (const def of IC_LIBRARY) {
      expect(pinNamed(def, 14)?.name, def.part).toBe("VCC");
      expect(pinNamed(def, 14)?.dir, def.part).toBe("pwr");
      expect(pinNamed(def, 7)?.name, def.part).toBe("GND");
      expect(pinNamed(def, 7)?.dir, def.part).toBe("gnd");
    }
  });

  it("has the right gate count and arity per part", () => {
    expect(IC_7400.gateCount).toBe(4);
    expect(IC_7402.gateCount).toBe(4);
    expect(IC_7404.gateCount).toBe(6); // hex inverter
    expect(IC_7408.gateCount).toBe(4);
    expect(IC_7432.gateCount).toBe(4);
    expect(IC_7486.gateCount).toBe(4);
    expect(IC_7410.gateCount).toBe(3); // triple 3-input

    expect(IC_7404.inputsPerGate).toBe(1);
    expect(IC_7410.inputsPerGate).toBe(3);
  });

  // The schema's real test: a chip whose pins are physically scattered still
  // assembles correctly, because the gate map is derived and not written.
  it("assembles the 7410, whose gate 1 pins are scattered across the package", () => {
    const gate1 = IC_7410.cells.find((c) => c.slot === 1);
    expect(gate1?.inputPins).toEqual(["1A", "1B", "1C"]); // pins 1, 2, 13
    expect(gate1?.outputPin).toBe("1Y"); // pin 12
    expect(pinNamed(IC_7410, 13)?.name).toBe("1C");
    expect(pinNamed(IC_7410, 12)?.name).toBe("1Y");
  });
});

describe("validateDefinition", () => {
  it("passes every shipped part", () => {
    for (const def of IC_LIBRARY) {
      expect(validateDefinition(def), def.part).toEqual([]);
    }
  });

  it("rejects a definition with no power pins", () => {
    const bad = { ...IC_7400, pinNames: IC_7400.pinNames.map((n) => (n === "VCC" ? "NC" : n)) };
    expect(validateDefinition(bad)).toContain("no VCC pin");
  });

  it("rejects inconsistent arity within a part", () => {
    const bad: IcDefinition = {
      ...IC_7400,
      inputsPerGate: 2,
      cells: [
        { slot: 1, op: "nand", inputPins: ["1A", "1B"], outputPin: "1Y" },
        { slot: 2, op: "nand", inputPins: ["2A"], outputPin: "2Y" },
      ],
    };
    expect(validateDefinition(bad)).toContain("gate 2 has inconsistent arity");
  });
});

describe("DIP geometry", () => {
  // Counter-clockwise from the notch: pin 8 sits across from pin 7, pin 14
  // across from pin 1. That is why Vcc and GND land at opposite corners.
  it("puts pin 8 directly opposite pin 7, and pin 14 opposite pin 1", () => {
    expect(pinOffset(7, 14).x).toBe(pinOffset(8, 14).x);
    expect(pinOffset(1, 14).x).toBe(pinOffset(14, 14).x);
    expect(pinOffset(1, 14).y).not.toBe(pinOffset(14, 14).y);
  });

  it("runs pins 1-7 left to right along the bottom", () => {
    expect(pinOffset(1, 14).x).toBeLessThan(pinOffset(7, 14).x);
    expect(pinOffset(1, 14).y).toBe(pinOffset(7, 14).y);
  });

  it("runs pins 8-14 right to left along the top", () => {
    expect(pinOffset(8, 14).x).toBeGreaterThan(pinOffset(14, 14).x);
    expect(pinOffset(8, 14).y).toBe(pinOffset(14, 14).y);
  });
});

describe("simulating a real chip", () => {
  /** A powered 7408: switches A,B -> gate 1 (pins 1,2) -> LED on pin 3. */
  const wired7408 = (power = true) => {
    const b = circuit()
      .ic("U1", "7408")
      .switch("A")
      .switch("B")
      .led("Q")
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("A", "Y", "U1", "1A")
      .wire("B", "Y", "U1", "1B")
      .wire("U1", "1Y", "Q", "A");
    if (power) {
      b.wire("V1", "VCC", "U1", "VCC").wire("G0", "GND", "U1", "GND");
    }
    return b.build();
  };

  it("computes AND on gate 1 when properly powered", () => {
    const doc = wired7408();
    const table: [InputVector, Logic][] = [
      [[0, 0], L0],
      [[0, 1], L0],
      [[1, 0], L0],
      [[1, 1], L1],
    ];
    for (const [inputs, want] of table) {
      const { at, diagnostics } = run(doc, inputs);
      expect(at("Q", "A"), `A=${inputs[0]} B=${inputs[1]}`).toBe(want);
      expect(codes(diagnostics)).not.toContain("UNPOWERED_IC");
    }
  });

  /**
   * The message this whole product exists to produce. Forgetting pin 14 is THE
   * most common reason a student's board does nothing, and a boolean simulator
   * cannot even represent it.
   */
  it("reports an unpowered chip by name and pin number, and floats its outputs", () => {
    const { at, diagnostics } = run(wired7408(false), [1, 1]);

    const fault = diagnostics.find((d) => d.code === "UNPOWERED_IC");
    expect(fault).toBeDefined();
    expect(fault?.message).toContain("U1");
    expect(fault?.message).toContain("7408");
    expect(fault?.message).toContain("pin 14 (VCC)");
    expect(fault?.message).toContain("pin 7 (GND)");

    // The output is FLOATING, not low. An unpowered chip drives nothing.
    expect(at("Q", "A")).toBe(LZ);
    expect(at("Q", "A")).not.toBe(L0);
  });

  it("reports a chip with Vcc but no GND", () => {
    const doc = circuit()
      .ic("U1", "7408")
      .rail("V1", "vcc")
      .wire("V1", "VCC", "U1", "VCC")
      .build();

    const fault = run(doc).diagnostics.find((d) => d.code === "UNPOWERED_IC");
    expect(fault?.message).toContain("pin 7 (GND)");
    expect(fault?.message).not.toContain("pin 14");
  });

  it("simulates all four gates of one package independently", () => {
    // Gate 1 (pins 1,2 -> 3) and gate 4 (pins 12,13 -> 11) at once.
    const doc = circuit()
      .ic("U1", "7408")
      .switch("A")
      .switch("B")
      .led("Q")
      .led("R")
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("V1", "VCC", "U1", "VCC")
      .wire("G0", "GND", "U1", "GND")
      .wire("A", "Y", "U1", "1A")
      .wire("A", "Y", "U1", "1B")
      .wire("U1", "1Y", "Q", "A") // gate 1: A AND A = A
      .wire("B", "Y", "U1", "4A")
      .wire("B", "Y", "U1", "4B")
      .wire("U1", "4Y", "R", "A") // gate 4: B AND B = B
      .build();

    const { at } = run(doc, [1, 0]); // A=1, B=0
    expect(at("Q", "A")).toBe(L1);
    expect(at("R", "A")).toBe(L0);
  });

  it("gets the 7402's NOR right at its real pins", () => {
    const doc = circuit()
      .ic("U1", "7402")
      .switch("A")
      .switch("B")
      .led("Q")
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("V1", "VCC", "U1", "VCC")
      .wire("G0", "GND", "U1", "GND")
      .wire("A", "Y", "U1", "1A") // pin 2
      .wire("B", "Y", "U1", "1B") // pin 3
      .wire("U1", "1Y", "Q", "A") // pin 1 — the OUTPUT
      .build();

    expect(run(doc, [0, 0]).at("Q", "A")).toBe(L1); // NOR(0,0) = 1
    expect(run(doc, [1, 0]).at("Q", "A")).toBe(L0);
    expect(run(doc, [1, 1]).at("Q", "A")).toBe(L0);
  });

  /**
   * A 7408 has four gates. Use one and the other three are spare. Reporting
   * those as six FLOATING_INPUT warnings and three DANGLING_OUTPUTs is TRUE but
   * useless — it buries the fault the student actually needs to see.
   */
  it("reports the three spare gates once, not as nine separate faults", () => {
    const { diagnostics } = run(wired7408(), [1, 1]);

    const unused = diagnostics.filter((d) => d.code === "UNUSED_GATE");
    expect(unused).toHaveLength(1);
    expect(unused[0]?.message).toContain("gates 2, 3, 4");
    expect(unused[0]?.severity).toBe("info");

    // And crucially: NO floating-input noise from the gates nobody touched.
    expect(codes(diagnostics)).not.toContain("FLOATING_INPUT");
    expect(codes(diagnostics)).not.toContain("DANGLING_OUTPUT");
  });

  it("still floats an unconnected input on a powered chip", () => {
    const doc = circuit()
      .ic("U1", "7408")
      .switch("A")
      .led("Q")
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("V1", "VCC", "U1", "VCC")
      .wire("G0", "GND", "U1", "GND")
      .wire("A", "Y", "U1", "1A")
      .wire("U1", "1Y", "Q", "A") // 1B left dangling
      .build();

    const { at, diagnostics } = run(doc, [1]);
    expect(at("U1", "1B")).toBe(LZ);
    expect(at("Q", "A")).toBe(LX); // AND(1, floating) is unknown
    expect(codes(diagnostics)).toContain("FLOATING_INPUT");
  });

  it("builds a NAND-only inverter by tying a 7400's inputs together", () => {
    const doc = circuit()
      .ic("U1", "7400")
      .switch("A")
      .led("Q")
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("V1", "VCC", "U1", "VCC")
      .wire("G0", "GND", "U1", "GND")
      .wire("A", "Y", "U1", "1A")
      .wire("A", "Y", "U1", "1B")
      .wire("U1", "1Y", "Q", "A")
      .build();

    expect(run(doc, [0]).at("Q", "A")).toBe(L1);
    expect(run(doc, [1]).at("Q", "A")).toBe(L0);
  });
});

describe("the wider-fan-in parts", () => {
  it("7411 and 7427 share the 7410's scattered frame", () => {
    for (const def of [IC_7410, IC_7411, IC_7427]) {
      const gate1 = def.cells.find((c) => c.slot === 1);
      expect(gate1?.inputPins, def.part).toEqual(["1A", "1B", "1C"]);
      expect(gate1?.outputPin, def.part).toBe("1Y");
      // Gate 1's inputs are pins 1, 2 and 13; its output is pin 12. Nothing about
      // that is guessable — which is why the gate map is derived, not written.
      expect(pinNamed(def, 13)?.name, def.part).toBe("1C");
      expect(pinNamed(def, 12)?.name, def.part).toBe("1Y");
    }
    expect(IC_7411.op).toBe("and");
    expect(IC_7427.op).toBe("nor");
  });

  it("7420 and 7421 are dual 4-input, with pins 3 and 11 dead", () => {
    for (const def of [IC_7420, IC_7421]) {
      expect(def.gateCount, def.part).toBe(2);
      expect(def.inputsPerGate, def.part).toBe(4);
      expect(pinNamed(def, 3)?.dir, def.part).toBe("nc");
      expect(pinNamed(def, 11)?.dir, def.part).toBe("nc");
      expect(def.cells[0]?.inputPins).toEqual(["1A", "1B", "1C", "1D"]);
    }
  });

  it("7430 is one 8-input NAND with its output on pin 8", () => {
    expect(IC_7430.gateCount).toBe(1);
    expect(IC_7430.inputsPerGate).toBe(8);
    expect(pinNamed(IC_7430, 8)?.name).toBe("1Y");
    expect(pinNamed(IC_7430, 8)?.dir).toBe("out");
    expect(IC_7430.cells[0]?.inputPins).toEqual([
      "1A", "1B", "1C", "1D", "1E", "1F", "1G", "1H",
    ]);
  });

  it("every part still validates, and still has Vcc on 14 / GND on 7", () => {
    for (const def of IC_LIBRARY) {
      expect(validateDefinition(def), def.part).toEqual([]);
      expect(pinNamed(def, 14)?.name, def.part).toBe("VCC");
      expect(pinNamed(def, 7)?.name, def.part).toBe("GND");
    }
  });

  it("an 8-input NAND actually computes an 8-input NAND", () => {
    const doc = circuit()
      .ic("U1", "7430")
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("V1", "VCC", "U1", "VCC")
      .wire("G0", "GND", "U1", "GND")
      .led("Q")
      .wire("U1", "1Y", "Q", "A")
      .build();

    // All eight inputs floating -> unknown, not 0.
    expect(run(doc).at("Q", "A")).toBe(LX);

    // Tie every input high -> NAND(1,…,1) = 0.
    const b = circuit()
      .ic("U1", "7430")
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("V1", "VCC", "U1", "VCC")
      .wire("G0", "GND", "U1", "GND")
      .led("Q")
      .wire("U1", "1Y", "Q", "A");
    for (const p of ["1A", "1B", "1C", "1D", "1E", "1F", "1G", "1H"]) {
      b.wire("V1", "VCC", "U1", p);
    }
    expect(run(b.build()).at("Q", "A")).toBe(L0);
  });
});
