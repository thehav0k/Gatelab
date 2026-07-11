import { describe, expect, it } from "vitest";
import { GATE_DOCS, IC_DOCS } from "./reference";
import { IC_LIBRARY } from "./ic-library";
import { evalGate } from "./logic";

/**
 * The manual is generated from the engine, so these tests are really asking one
 * question: does the reference tell the truth? A docs page that is wrong is worse
 * than no docs page, because it is believed.
 */
describe("GATE_DOCS", () => {
  it("documents all seven gates", () => {
    expect(GATE_DOCS.map((g) => g.op)).toEqual([
      "and",
      "or",
      "not",
      "nand",
      "nor",
      "xor",
      "xnor",
    ]);
  });

  it("every printed row is what the simulator actually computes", () => {
    for (const gate of GATE_DOCS) {
      for (const row of gate.table) {
        expect(evalGate(gate.op, row.inputs), `${gate.label}(${row.inputs})`).toBe(
          row.out,
        );
      }
    }
  });

  it("NOT is a one-input table; the rest take two", () => {
    expect(GATE_DOCS.find((g) => g.op === "not")?.table).toHaveLength(2);
    expect(GATE_DOCS.find((g) => g.op === "and")?.table).toHaveLength(4);
  });

  it("marks exactly NAND and NOR as universal", () => {
    const universal = GATE_DOCS.filter(
      (g) => g.properties.find((p) => p.name === "Universal")?.holds,
    ).map((g) => g.op);
    expect(universal).toEqual(["nand", "nor"]);
  });

  it("gets the controlling values right, because X-propagation depends on them", () => {
    // AND's annihilator is 0: one 0 decides the output. OR's is 1.
    const annihilator = (op: string) =>
      GATE_DOCS.find((g) => g.op === op)?.properties.find((p) =>
        p.name.startsWith("Annihilator"),
      )?.name;

    expect(annihilator("and")).toBe("Annihilator: 0");
    expect(annihilator("or")).toBe("Annihilator: 1");
    // XOR has NO controlling value — that is why XOR(anything, X) = X.
    expect(annihilator("xor")).toBeUndefined();
  });

  it("knows NAND is not associative — you cannot chain it like AND", () => {
    // NAND(NAND(a,b),c) != NAND(a,NAND(b,c)). Getting this wrong is how people
    // build a "3-input NAND" out of two 2-input NANDs and quietly get it wrong.
    const assoc = (op: string) =>
      GATE_DOCS.find((g) => g.op === op)?.properties.find(
        (p) => p.name === "Associative",
      )?.holds;

    expect(assoc("and")).toBe(true);
    expect(assoc("or")).toBe(true);
    expect(assoc("xor")).toBe(true);
    expect(assoc("nand")).toBe(false);
    expect(assoc("nor")).toBe(false);
  });

  it("lists real chips for every gate that has one", () => {
    for (const gate of GATE_DOCS) {
      for (const part of gate.chips) {
        expect(IC_LIBRARY.some((d) => d.part === part)).toBe(true);
      }
    }
    expect(GATE_DOCS.find((g) => g.op === "nand")?.chips).toContain("7400");
  });
});

describe("IC_DOCS", () => {
  it("covers the whole library", () => {
    expect(IC_DOCS).toHaveLength(IC_LIBRARY.length);
  });

  it("numbers pins from 1 and names every one", () => {
    for (const ic of IC_DOCS) {
      expect(ic.pins).toHaveLength(ic.pinCount);
      expect(ic.pins[0]?.pin).toBe(1);
      expect(ic.pins.at(-1)?.pin).toBe(ic.pinCount);
      expect(ic.pins.every((p) => p.name.length > 0)).toBe(true);
    }
  });

  it("puts Vcc on 14 and GND on 7 for every DIP-14", () => {
    for (const ic of IC_DOCS.filter((d) => d.pinCount === 14)) {
      expect(ic.vcc, ic.part).toBe(14);
      expect(ic.gnd, ic.part).toBe(7);
    }
  });

  it("reports the 7402's output on pin 1 — its pinout is NOT the 7400's", () => {
    // The trap this library exists to avoid: the 7402's gate 1 is inputs (2,3) →
    // output 1. The output comes FIRST. Pattern-matching the 7400's shape onto it
    // is the classic way to wire a NOR chip backwards.
    const nor = IC_DOCS.find((d) => d.part === "7402");
    expect(nor?.pins[0]?.name).toBe("1Y");
    expect(nor?.pins[1]?.name).toBe("1A");

    const nand = IC_DOCS.find((d) => d.part === "7400");
    expect(nand?.pins[0]?.name).toBe("1A");
  });
});
