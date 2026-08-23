import { Assembler } from "./assemble";
import type { EditorDocument } from "./document";

/**
 * Starting points.
 *
 * An empty canvas is the hardest thing to put in front of somebody. These are
 * real documents built from the same parts the palette offers — every block is
 * editable, every wire is a wire — so they are not examples to look at, they are
 * work to continue. Widen the adder, change the decoders, group the lot.
 *
 * They are built by CALLING THE OPERATIONS rather than by writing out instance
 * literals, which means a template cannot encode a document the editor itself
 * could not have produced: no ports that do not exist, no wires the connection
 * rules would have rejected.
 */

export interface Template {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly build: () => EditorDocument;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: "half-adder",
    name: "Half adder",
    summary: "Two inputs, an XOR and an AND. The smallest thing worth drawing.",
    build: () => {
      const b = new Assembler("Half adder");
      const a = b.add("input", 40, 60, { label: "A" });
      const bb = b.add("input", 40, 180, { label: "B" });
      const x = b.add("gate", 240, 50, { op: "xor" });
      const and = b.add("gate", 240, 170, { op: "and" });
      const s = b.add("output", 440, 60, { label: "S" });
      const c = b.add("output", 440, 180, { label: "C" });
      b.wire([a, "Y"], [x, "A"]);
      b.wire([bb, "Y"], [x, "B"]);
      b.wire([a, "Y"], [and, "A"]);
      b.wire([bb, "Y"], [and, "B"]);
      b.wire([x, "Y"], [s, "A"]);
      b.wire([and, "Y"], [c, "A"]);
      return b.doc;
    },
  },
  {
    id: "full-adder",
    name: "Full adder from half adders",
    summary: "Two half adders and an OR — the classic decomposition, as blocks.",
    build: () => {
      const b = new Assembler("Full adder");
      const a = b.add("input", 40, 60, { label: "A" });
      const bb = b.add("input", 40, 140, { label: "B" });
      const cin = b.add("input", 40, 300, { label: "Cin" });
      const h1 = b.add("halfadder", 240, 80);
      const h2 = b.add("halfadder", 460, 180);
      const or = b.add("gate", 680, 300, { op: "or" });
      const s = b.add("output", 700, 180, { label: "S" });
      const co = b.add("output", 860, 300, { label: "Cout" });
      b.wire([a, "Y"], [h1, "A"]);
      b.wire([bb, "Y"], [h1, "B"]);
      b.wire([h1, "S"], [h2, "A"]);
      b.wire([cin, "Y"], [h2, "B"]);
      b.wire([h2, "S"], [s, "A"]);
      b.wire([h1, "C"], [or, "B"]);
      b.wire([h2, "C"], [or, "A"]);
      b.wire([or, "Y"], [co, "A"]);
      return b.doc;
    },
  },
  {
    id: "ripple-adder",
    name: "4-bit ripple-carry adder",
    summary: "Four full adders with the carry rippling through. Widen it by copying one.",
    build: () => {
      const b = new Assembler("4-bit ripple-carry adder");
      const cin = b.add("input", 40, 520, { label: "C0" });
      let carry: [string, string] = [cin, "Y"];
      for (let i = 0; i < 4; i++) {
        const y = 40 + i * 140;
        const ai = b.add("input", 40, y, { label: `A${i}` });
        const bi = b.add("input", 40, y + 60, { label: `B${i}` });
        const fa = b.add("fulladder", 260, y);
        const si = b.add("output", 520, y, { label: `S${i}` });
        b.wire([ai, "Y"], [fa, "A"]);
        b.wire([bi, "Y"], [fa, "B"]);
        b.wire(carry, [fa, "Cin"]);
        b.wire([fa, "S"], [si, "A"]);
        carry = [fa, "Cout"];
      }
      const cout = b.add("output", 520, 600, { label: "C4" });
      b.wire(carry, [cout, "A"]);
      return b.doc;
    },
  },
  {
    id: "demux-tree",
    name: "1-to-16 demultiplexer",
    summary: "Five 2-to-4 decoders, the first one enabling the other four.",
    build: () => {
      const b = new Assembler("1-to-16 demultiplexer");
      const din = b.add("input", 40, 40, { label: "D" });
      const s3 = b.add("input", 40, 120, { label: "S3" });
      const s2 = b.add("input", 40, 180, { label: "S2" });
      const s1 = b.add("input", 40, 240, { label: "S1" });
      const s0 = b.add("input", 40, 300, { label: "S0" });

      const first = b.add("decoder", 260, 120, {
        addr: 2,
        enable: true,
        subtitle: "stage 1",
      });
      b.wire([din, "Y"], [first, "E"]);
      b.wire([s3, "Y"], [first, "A1"]);
      b.wire([s2, "Y"], [first, "A0"]);

      for (let bank = 0; bank < 4; bank++) {
        const dec = b.add("decoder", 560, 40 + bank * 260, {
          addr: 2,
          enable: true,
          subtitle: `Y${bank * 4}–Y${bank * 4 + 3}`,
        });
        b.wire([first, `Y${bank}`], [dec, "E"]);
        b.wire([s1, "Y"], [dec, "A1"]);
        b.wire([s0, "Y"], [dec, "A0"]);
        for (let k = 0; k < 4; k++) {
          const out = b.add("output", 820, 40 + bank * 260 + k * 56, {
            label: `Y${bank * 4 + k}`,
          });
          b.wire([dec, `Y${k}`], [out, "A"]);
        }
      }
      return b.doc;
    },
  },
  {
    id: "counter",
    name: "4-bit ripple counter",
    summary: "Four toggling flip-flops, each clocked by the one before it.",
    build: () => {
      const b = new Assembler("4-bit ripple counter");
      const clk = b.add("clock", 40, 200, { label: "CLK" });
      const one = b.add("constant", 40, 60, { value: "1" });
      const clr = b.add("input", 40, 320, { label: "CLR" });

      let clock: [string, string] = [clk, "Y"];
      for (let i = 0; i < 4; i++) {
        const x = 260 + i * 300;
        const ff = b.add("flipflop", x, 140, {
          type: "jk",
          clear: true,
          negedge: true,
          title: `FF${i}`,
        });
        b.wire([one, "Y"], [ff, "J"]);
        b.wire([one, "Y"], [ff, "K"]);
        b.wire(clock, [ff, "CLK"]);
        b.wire([clr, "Y"], [ff, "CLR"]);
        const q = b.add("output", x + 190, 140, { label: `Q${i}` });
        b.wire([ff, "Q"], [q, "A"]);
        // The next stage is clocked by THIS stage's Q — the whole idea of a
        // ripple counter, and the reason it needs no gates at all.
        clock = [ff, "Q"];
      }
      return b.doc;
    },
  },
  {
    id: "memory",
    name: "Memory expansion",
    summary: "Four banks and a bank-select decoder — the shape every memory map has.",
    build: () => {
      const b = new Assembler("64K × 8 from 16K × 8 chips");
      const low = b.add("input", 40, 260, { label: "A13..A0", bussed: true, bits: 14 });
      const high = b.add("input", 40, 340, { label: "A15..A14", bussed: true, bits: 2 });
      const we = b.add("input", 40, 420, { label: "WE" });
      const data = b.add("input", 40, 500, { label: "D7..D0", bussed: true, bits: 8 });
      const dec = b.add("decoder", 280, 300, { addr: 2, enable: false, subtitle: "bank select" });
      b.wire([high, "Y"], [dec, "A1"]);
      b.wire([high, "Y"], [dec, "A0"]);

      const out = b.add("output", 900, 300, { label: "D7..D0", bussed: true, bits: 8 });
      for (let bank = 0; bank < 4; bank++) {
        const chip = b.add("memory", 560, 40 + bank * 200, {
          kind: "ram",
          words: 16384,
          bits: 8,
          csLow: true,
          bussed: true,
          subtitle: `bank ${bank}`,
        });
        b.wire([low, "Y"], [chip, "A"]);
        b.wire([data, "Y"], [chip, "D"]);
        b.wire([we, "Y"], [chip, "WE"]);
        b.wire([dec, `Y${bank}`], [chip, "CS"]);
        b.wire([chip, "Q"], [out, "A"]);
      }
      return b.doc;
    },
  },
];

export const getTemplate = (id: string): Template | undefined =>
  TEMPLATES.find((t) => t.id === id);
