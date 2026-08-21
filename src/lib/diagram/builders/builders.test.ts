import { describe, expect, it } from "vitest";
import { describePlan, describeSizing, memorySizing, planExpansion } from "./memory";
import { stateTable, rippleTiming, excitationSummary, type SequentialSpec } from "./sequential";
import { readMux, residueOf, muxResidues } from "./logic";
import { bitwiseSpecs, mintermsWhere, toFunction } from "./kit";
import { scaleDiagram } from "./arithmetic";
import { validate } from "../types";

describe("memory sizing", () => {
  it("derives address lines from the word count, not the word width", () => {
    const s = memorySizing(16 * 1024, 32);
    expect(s.addressLines).toBe(14);
    expect(s.dataInputs).toBe(32);
    expect(s.dataOutputs).toBe(32);
    expect(s.totalBits).toBe(16 * 1024 * 32);
  });

  it("rounds up for a word count that is not a power of two", () => {
    // 1000 words still needs 10 lines; 2^9 = 512 is not enough.
    expect(memorySizing(1000, 8).addressLines).toBe(10);
  });

  it("says something about every quantity the question asks for", () => {
    expect(describeSizing(memorySizing(16 * 1024, 12))).toHaveLength(4);
  });
});

describe("memory expansion", () => {
  it("plans 64x8 from 16x4 as two wide by four deep", () => {
    const p = planExpansion(64, 8, 16, 4);
    expect(p.wide).toBe(2);
    expect(p.deep).toBe(4);
    expect(p.chips).toBe(8);
    expect(p.target.addressLines).toBe(6);
    expect(p.sharedAddressLines).toBe(4);
    expect(p.decodedAddressLines).toBe(2);
    expect(p.decoder).toEqual({ inputs: 2, outputs: 4 });
    expect(p.feasible).toBe(true);
  });

  it("plans 256K x 8 from 32K x 8 as eight banks and a 3-to-8 decoder", () => {
    const p = planExpansion(256 * 1024, 8, 32 * 1024, 8);
    expect(p.chips).toBe(8);
    expect(p.wide).toBe(1);
    expect(p.target.addressLines).toBe(18);
    expect(p.sharedAddressLines).toBe(15);
    expect(p.decoder).toEqual({ inputs: 3, outputs: 8 });
  });

  it("needs no decoder when one bank covers the whole space", () => {
    const p = planExpansion(32, 8, 32, 4);
    expect(p.deep).toBe(1);
    expect(p.decoder).toBeNull();
    expect(describePlan(p).at(-1)).toContain("No decoding");
  });

  it("reports, rather than hides, a size that does not divide evenly", () => {
    const p = planExpansion(100, 12, 32, 8);
    expect(p.feasible).toBe(false);
    expect(p.problems.length).toBe(2);
  });
});

describe("state table", () => {
  const spec: SequentialSpec = {
    inputs: ["P"],
    stateVars: ["A", "B"],
    type: "d",
    excitation: { DA: "A*P + B*P", DB: "A'*P" },
    outputs: [{ label: "Y", expr: "(A + B)*P'" }],
  };

  it("has one row per state and input combination", () => {
    expect(stateTable(spec)).toHaveLength(4 * 2);
  });

  it("takes the next state straight from D, because Q+ = D", () => {
    const rows = stateTable(spec);
    // A=1 B=0, P=1 -> DA = 1*1 + 0*1 = 1, DB = 0*1 = 0 -> next 10
    const row = rows.find((r) => r.present === "10" && r.input === "1");
    expect(row?.next).toBe("10");
    // P = 0 clears both.
    expect(rows.find((r) => r.present === "11" && r.input === "0")?.next).toBe("00");
  });

  it("applies the characteristic equation for JK and T", () => {
    const jk: SequentialSpec = {
      inputs: ["P"],
      stateVars: ["A"],
      type: "jk",
      excitation: { JA: "P", KA: "P" },
    };
    // J = K = P: with P = 1 the flip-flop toggles, with P = 0 it holds.
    expect(stateTable(jk).find((r) => r.present === "0" && r.input === "1")?.next).toBe("1");
    expect(stateTable(jk).find((r) => r.present === "1" && r.input === "1")?.next).toBe("0");
    expect(stateTable(jk).find((r) => r.present === "1" && r.input === "0")?.next).toBe("1");

    const t: SequentialSpec = {
      inputs: ["P"],
      stateVars: ["A"],
      type: "t",
      excitation: { TA: "P" },
    };
    expect(stateTable(t).find((r) => r.present === "1" && r.input === "1")?.next).toBe("0");
  });

  it("formats the excitation equations", () => {
    expect(excitationSummary(spec)).toHaveLength(2);
  });
});

describe("ripple timing", () => {
  it("gives each bit a larger delay than the one below it", () => {
    const chart = rippleTiming(4);
    const delays = chart.waves.slice(1).map((w) => w.delay ?? 0);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1] as number);
    }
  });

  it("counts in binary: bit k toggles half as often as bit k-1", () => {
    const chart = rippleTiming(3, 8);
    const q0 = chart.waves[1]?.values ?? [];
    const q1 = chart.waves[2]?.values ?? [];
    const edges = (v: readonly number[]) =>
      v.filter((x, i) => i > 0 && x !== v[i - 1]).length;
    expect(edges(q0)).toBeGreaterThan(edges(q1));
  });
});

describe("Shannon residues", () => {
  it("recognises a constant residue", () => {
    expect(residueOf([0, 0, 0, 0], ["C", "D"])).toEqual({ kind: "const", value: 0 });
    expect(residueOf([1, 1], ["D"])).toEqual({ kind: "const", value: 1 });
  });

  it("recognises a variable and its complement", () => {
    expect(residueOf([0, 1], ["D"])).toMatchObject({ kind: "var", name: "D", complemented: false });
    expect(residueOf([1, 0], ["D"])).toMatchObject({ kind: "var", name: "D", complemented: true });
  });

  it("falls back to an expression when the residue is neither", () => {
    const r = residueOf([0, 0, 0, 1], ["C", "D"]);
    expect(r.kind).toBe("expr");
  });

  it("gives an n-1 select mux only constants and single literals", () => {
    const spec = {
      name: "f",
      variables: ["A", "B", "C", "D"],
      minterms: mintermsWhere(4, (m) => m % 3 === 0),
    };
    for (const row of muxResidues(spec, 3)) {
      expect(row.residue.kind).not.toBe("expr");
    }
  });
});

describe("reading a function back out of a multiplexer", () => {
  it("concatenates the data inputs' truth vectors in select order", () => {
    const r = readMux(["A", "B"], ["C"], ["C", "C'", "1", "0"], "F");
    // AB=00 -> C  : rows 0,1 = 0,1
    // AB=01 -> C' : rows 2,3 = 1,0
    // AB=10 -> 1  : rows 4,5 = 1,1
    // AB=11 -> 0  : rows 6,7 = 0,0
    expect(Array.from(r.values)).toEqual([0, 1, 1, 0, 1, 1, 0, 0]);
    expect(r.minterms).toEqual([1, 2, 4, 5]);
    expect(r.minimal.length).toBeGreaterThan(0);
  });

  it("treats an unparsable data input as 0 rather than throwing", () => {
    const r = readMux(["A"], ["B"], ["((", "1"], "F");
    expect(Array.from(r.values).slice(0, 2)).toEqual([0, 0]);
  });
});

describe("bitwise output specs", () => {
  it("splits a word-level function into one spec per output bit, MSB first", () => {
    const specs = bitwiseSpecs(3, ["A", "B", "C"], (x) => x * x, 6, "S");
    expect(specs.map((s) => s.name)).toEqual(["S5", "S4", "S3", "S2", "S1", "S0"]);
    // A square's low bit equals the input's low bit, so S0's rows are the odd ones.
    expect(specs[5]?.minterms).toEqual([1, 3, 5, 7]);
    // No square of a 3-bit number ever sets bit 1 (n^2 mod 4 is 0 or 1).
    expect(specs[4]?.minterms).toEqual([]);
  });

  it("builds a function whose truth vector matches the minterm list", () => {
    const fn = toFunction({ name: "F", variables: ["A", "B"], minterms: [1, 2] });
    expect(Array.from(fn.values)).toEqual([0, 1, 1, 0]);
  });

  it("refuses a minterm that is out of range, loudly", () => {
    // A silently-dropped minterm would be a diagram that is quietly the wrong
    // function, which is the one failure this whole module exists to avoid.
    expect(() => toFunction({ name: "F", variables: ["A", "B"], minterms: [9] })).toThrow();
  });
});

describe("constant multiply", () => {
  it("builds P = 3Q + 1 from one adder and a half adder", () => {
    const d = scaleDiagram({ bits: 4, multiplier: 3, offset: 1 });
    expect(validate(d)).toEqual([]);
    expect(d.blocks.filter((b) => b.subtitle === "parallel adder").length).toBe(0);
    expect(d.blocks.some((b) => b.subtitle === "half adder")).toBe(true);
    // P needs 6 bits for a 4-bit Q: 3*15 + 1 = 46.
    expect(d.blocks.filter((b) => b.kind === "io" && b.title.startsWith("P")).length).toBe(6);
  });

  it("refuses a multiplier it cannot express as a shift plus an add", () => {
    expect(() => scaleDiagram({ bits: 4, multiplier: 7, offset: 0 })).toThrow();
  });
});
