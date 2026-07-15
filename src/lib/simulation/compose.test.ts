import { describe, expect, it } from "vitest";
import { composePreset, type CompositeSpec } from "./compose";
import { COMPOSITES, getComposite } from "./composites";
import { elaborate } from "./elaborate";
import { evaluate } from "./solver";
import { L0, L1 } from "./logic";

/**
 * Compose, then SIMULATE. A block diagram that does not compute the right thing
 * is worse than useless in a teaching tool, so every composite here is driven
 * through the real solver and checked against what the circuit is supposed to do.
 */

/** Run a composed circuit for one input assignment; read its outputs by label. */
function run(spec: CompositeSpec, bits: Record<string, 0 | 1>) {
  const doc = composePreset(spec);
  const { netlist } = elaborate(doc);
  const vector = netlist.inputs.map((p) => bits[p.label] ?? 0);
  const state = evaluate(netlist, vector);

  const out: Record<string, number> = {};
  for (const port of netlist.outputs) out[port.label] = state.values[port.net]!;
  return out;
}

/** Every output must be a definite 0 or 1 — a Z or X means something is floating. */
const allDefinite = (out: Record<string, number>) =>
  Object.values(out).every((v) => v === L0 || v === L1);

describe("full adder from half adders", () => {
  const spec = getComposite("fa-from-ha")!;

  it("adds three bits, for all eight inputs", () => {
    for (let m = 0; m < 8; m++) {
      const a = ((m >> 2) & 1) as 0 | 1;
      const b = ((m >> 1) & 1) as 0 | 1;
      const c = (m & 1) as 0 | 1;
      const out = run(spec, { A: a, B: b, Cin: c });
      const sum = a + b + c;
      expect(allDefinite(out), `inputs ${a}${b}${c}`).toBe(true);
      expect(out.S, `sum bit for ${a}${b}${c}`).toBe(sum & 1);
      expect(out.Cout, `carry for ${a}${b}${c}`).toBe((sum >> 1) & 1);
    }
  });
});

describe("multiplexer trees", () => {
  it("4:1 mux from 2:1 muxes routes the addressed data line", () => {
    const spec = getComposite("mux4-from-mux2")!;
    for (let addr = 0; addr < 4; addr++) {
      for (const bit of [0, 1] as const) {
        const data: Record<string, 0 | 1> = { D0: 0, D1: 0, D2: 0, D3: 0 };
        data[`D${addr}`] = bit;
        const out = run(spec, {
          S1: ((addr >> 1) & 1) as 0 | 1,
          S0: (addr & 1) as 0 | 1,
          ...data,
        });
        expect(out.Y, `addr ${addr}, bit ${bit}`).toBe(bit);
      }
    }
  });

  it("8:1 mux from 4:1 muxes routes the addressed data line", () => {
    const spec = getComposite("mux8-from-mux4")!;
    for (let addr = 0; addr < 8; addr++) {
      const data: Record<string, 0 | 1> = {};
      for (let i = 0; i < 8; i++) data[`D${i}`] = i === addr ? 1 : 0;
      const out = run(spec, {
        S2: ((addr >> 2) & 1) as 0 | 1,
        S1: ((addr >> 1) & 1) as 0 | 1,
        S0: (addr & 1) as 0 | 1,
        ...data,
      });
      expect(out.Y, `addr ${addr}`).toBe(1);
    }
  });
});

describe("ripple adders", () => {
  /** Read an n-bit result out of S{n-1..0} + Cout as a single number. */
  const readSum = (out: Record<string, number>, bits: number): number => {
    let v = (out.Cout ?? 0) << bits;
    for (let i = 0; i < bits; i++) v |= (out[`S${i}`] ?? 0) << i;
    return v;
  };

  const setBits = (prefix: string, value: number, bits: number) => {
    const b: Record<string, 0 | 1> = {};
    for (let i = 0; i < bits; i++) b[`${prefix}${i}`] = ((value >> i) & 1) as 0 | 1;
    return b;
  };

  it("2-bit adder is exhaustively correct", () => {
    const spec = getComposite("adder2")!;
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++)
        for (const cin of [0, 1] as const) {
          const out = run(spec, {
            ...setBits("A", a, 2),
            ...setBits("B", b, 2),
            Cin: cin,
          });
          expect(allDefinite(out)).toBe(true);
          expect(readSum(out, 2), `${a}+${b}+${cin}`).toBe(a + b + cin);
        }
  });

  it("4-bit adder is exhaustively correct", () => {
    const spec = getComposite("adder4")!;
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        const out = run(spec, { ...setBits("A", a, 4), ...setBits("B", b, 4), Cin: 0 });
        expect(readSum(out, 4), `${a}+${b}`).toBe(a + b);
      }
  });

  it("8-bit adder handles the worst-case carry ripple", () => {
    const spec = getComposite("adder8")!;
    // 255 + 1 forces the carry to walk the whole chain — the case that catches a
    // broken carry link.
    for (const [a, b, cin] of [
      [255, 1, 0],
      [255, 255, 1],
      [170, 85, 0],
      [200, 55, 1],
      [0, 0, 0],
    ] as const) {
      const out = run(spec, { ...setBits("A", a, 8), ...setBits("B", b, 8), Cin: cin });
      expect(allDefinite(out), `${a}+${b}+${cin}`).toBe(true);
      expect(readSum(out, 8), `${a}+${b}+${cin}`).toBe(a + b + cin);
    }
  });

  it("16-bit adder adds correctly across the full width", () => {
    const spec = getComposite("adder16")!;
    for (const [a, b] of [
      [65535, 1],
      [0xff, 0xff00],
      [12345, 54321],
      [0, 0],
    ] as const) {
      const out = run(spec, { ...setBits("A", a, 16), ...setBits("B", b, 16), Cin: 0 });
      let v = (out.Cout ?? 0) * 65536;
      for (let i = 0; i < 16; i++) v += (out[`S${i}`] ?? 0) << i;
      expect(v, `${a}+${b}`).toBe(a + b);
    }
  });
});

describe("the composite catalogue", () => {
  it("every composite composes without a dangling output", () => {
    for (const spec of COMPOSITES) {
      const doc = composePreset(spec);
      const { netlist } = elaborate(doc);
      // Every declared output ended up as an LED with a net behind it.
      expect(netlist.outputs.length, spec.id).toBe(spec.outputs.length);
    }
  });
});
