import { describe, expect, it } from "vitest";
import * as C from "./catalog";
import { layout } from "./layout";
import { measure, placePorts, slotFractions } from "./measure";
import { renderSvg } from "./svg";
import { TEXTBOOK } from "./theme";
import { validate, type Block, type Diagram } from "./types";
import {
  demuxTreeDiagram,
  muxTreeDiagram,
  priorityEncoderDiagram,
} from "./builders/selectors";

/**
 * Every MSI part, instantiated and drawn.
 *
 * The failure this catches is specific and silent: two ports on one block with
 * the same id. The second one wins every lookup, so a wire that should land on
 * `A1` lands on `A0` instead — a picture that is wrong in a way that looks
 * completely fine. Nothing downstream can detect it, so it is checked here for
 * every part at every width the builders use.
 */
const PARTS: Block[] = [
  C.gate("g1", "and", 2),
  C.gate("g2", "not"),
  C.gate("g3", "xnor", 2),
  C.gate("g4", "or", 8),
  C.input("i1", "A"),
  C.output("o1", "F"),
  C.constant("k1", 1),
  C.constant("k0", 0),
  C.note("n1", "an annotation"),
  C.decoder("d1", 2),
  C.decoder("d2", 3, { enable: true, enableActiveLow: true, outputsActiveLow: true }),
  C.decoder("d3", 4, { enable: true, dataInput: "D" }),
  C.demux("dm", 3, { enable: true }),
  C.mux("m1", 1),
  C.mux("m2", 3, { enable: true, enableActiveLow: true, complementOutput: true }),
  C.encoder("e1", 2),
  C.encoder("e2", 3, { priority: true, validOutput: true, enable: true }),
  C.halfAdder("ha"),
  C.fullAdder("fa"),
  C.adder("a1", 4),
  C.adder("a2", 8, { bussed: true }),
  C.comparator("c1", 4),
  C.comparator("c2", 4, { magnitude: true, bussed: true }),
  C.flipFlop("ff1", "d"),
  C.flipFlop("ff2", "jk", { preset: true, clear: true, negativeEdge: true }),
  C.flipFlop("ff3", "t", { complement: false }),
  C.flipFlop("ff4", "sr"),
  C.counter("cn1", 4),
  C.counter("cn2", 4, { load: true, clear: true, enable: true, rippleCarry: true }),
  C.shiftRegister("sr1", 4),
  C.shiftRegister("sr2", 8, { serialOut: true }),
  C.register("r1", 4),
  C.register("r2", 8, { bussed: true }),
  C.memory("mm1", 1024, 8),
  C.memory("mm2", 32768, 8, { kind: "rom", bussed: true, outputEnable: true }),
  C.memory("mm3", 16, 4, { chipSelectActiveLow: true }),
];

describe("the MSI catalogue", () => {
  for (const part of PARTS) {
    it(`${part.id} (${part.title}) has unique, placeable ports`, () => {
      const ids = new Set(part.ports.map((p) => p.id));
      expect(ids.size, `duplicate port id in ${part.id}`).toBe(part.ports.length);

      const size = measure(part, TEXTBOOK);
      expect(size.w).toBeGreaterThan(0);
      expect(size.h).toBeGreaterThan(0);

      const placed = placePorts(part, size);
      expect(placed.size).toBe(part.ports.length);
      for (const p of placed.values()) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(size.w);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(size.h);
      }
    });
  }

  it("renders every part on one sheet", () => {
    const diagram: Diagram = { id: "all", title: "Every part", blocks: PARTS, links: [] };
    expect(validate(diagram)).toEqual([]);
    const svg = renderSvg(layout(diagram, TEXTBOOK), TEXTBOOK);
    expect(svg).not.toContain("NaN");
    for (const part of PARTS) {
      if (part.kind === "box") expect(svg).toContain(part.title.replace(/×/g, "×"));
    }
  });

  it("derives a memory's address pin count from its word count", () => {
    expect(C.memory("m", 1024, 8).ports.filter((p) => /^A\d+$/.test(p.id))).toHaveLength(10);
    expect(C.memory("m", 16, 4).ports.filter((p) => /^A\d+$/.test(p.id))).toHaveLength(4);
  });

  it("writes word counts the way a datasheet does", () => {
    expect(C.formatWords(128)).toBe("128");
    expect(C.formatWords(16 * 1024)).toBe("16K");
    expect(C.formatWords(2 * 1024 * 1024)).toBe("2M");
    expect(C.formatWords(1500)).toBe("1500");
  });

  it("gives a demultiplexer a data pin and a decoder none", () => {
    expect(C.demux("d", 2).ports.some((p) => p.id === "D")).toBe(true);
    expect(C.decoder("d", 2).ports.some((p) => p.id === "D")).toBe(false);
  });

  it("separates control pins from data pins with a gap", () => {
    const dec = C.decoder("d", 3, { enable: true });
    const fracs = slotFractions(dec.ports.filter((p) => p.side === "left"));
    // A2, A1, A0 then E: the last step must be bigger than the ones before it.
    const gaps = fracs.slice(1).map((f, i) => f - (fracs[i] as number));
    expect(gaps.at(-1)).toBeGreaterThan(gaps[0] as number);
  });
});

describe("selector trees", () => {
  it("builds a wide mux from narrow ones, low select bits first", () => {
    const d = muxTreeDiagram({ selectBits: 3, stageBits: 1 });
    expect(validate(d)).toEqual([]);
    // 8 inputs from 2:1 muxes = 4 + 2 + 1.
    expect(d.blocks.filter((b) => b.title === "MUX 2:1")).toHaveLength(7);
    expect(d.blocks.filter((b) => b.kind === "io" && b.title.startsWith("I"))).toHaveLength(8);
  });

  it("needs no tree when one stage is wide enough", () => {
    const d = demuxTreeDiagram({ selectBits: 2, stageBits: 2 });
    expect(validate(d)).toEqual([]);
    expect(d.blocks.filter((b) => b.tone === "msi")).toHaveLength(1);
    expect(d.notes?.some((n) => n.includes("no tree"))).toBe(true);
  });

  it("drops the data pin and ties the enable when drawn as a plain decoder", () => {
    const d = demuxTreeDiagram({ selectBits: 3, stageBits: 2, data: false });
    expect(validate(d)).toEqual([]);
    expect(d.blocks.some((b) => b.id === "DIN")).toBe(false);
    expect(d.title).toContain("decoder");
  });

  it("masks each priority-encoder input with every higher one", () => {
    const d = priorityEncoderDiagram({ bits: 2 });
    expect(validate(d)).toEqual([]);
    // D0 must be gated by D1', D2' and D3'; D3 needs no gate at all.
    expect(d.blocks.some((b) => b.id === "w0")).toBe(true);
    expect(d.blocks.some((b) => b.id === "w3")).toBe(false);
    expect(d.blocks.some((b) => b.id === "V")).toBe(true);
  });
});
