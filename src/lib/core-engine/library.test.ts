import { describe, expect, it } from "vitest";
import { FUNCTION_LIBRARY, blankTruthTable, getLibraryFunction } from "./library";
import { analyze } from "./index";
import { minterms } from "./canonical";
import { realize, synthesize, technologyMap } from "@/lib/simulation/synth";
import { verify } from "@/lib/simulation/verify";

describe("the function library", () => {
  /**
   * Every entry has to be a real, parseable function that the whole pipeline can
   * swallow — otherwise a preset is just a broken link.
   */
  it.each(FUNCTION_LIBRARY.map((f) => [f.id, f] as const))(
    "%s parses, minimizes, and builds a circuit that verifies",
    (_id, entry) => {
      const r = analyze(entry.source);
      expect(r.ok, `${entry.source}: ${r.diagnostics.map((d) => d.message).join("; ")}`).toBe(true);
      if (!r.ok) return;

      const { fn, sop } = r.value;
      if (sop.trace.degenerate) return;

      const nl = synthesize(sop.expression, fn.variables);
      const doc = realize(technologyMap(nl, "mixed"));
      const result = verify(doc, fn);

      expect(result.error, entry.name).toBeNull();
      expect(result.ok, entry.name).toBe(true);
    },
  );

  it("the mux keeps S as the MSB — the variable order is part of the spec", () => {
    const mux = getLibraryFunction("mux2")!;
    const r = analyze(mux.source);
    expect(r.ok && r.value.fn.variables).toEqual(["S", "A", "B"]);
  });

  it("the full adder's sum is the checkerboard that never simplifies", () => {
    const r = analyze(getLibraryFunction("full-adder-sum")!.source);
    if (!r.ok) throw new Error("bad");
    // Parity of three bits: 1 on exactly the odd-weight rows.
    expect(minterms(r.value.fn)).toEqual([1, 2, 4, 7]);
    // No two of those are adjacent, so nothing combines: four terms, three literals each.
    expect(r.value.sop.cover).toHaveLength(4);
    expect(r.value.sop.literals).toBe(12);
  });

  it("the carry-out is the majority function", () => {
    const r = analyze(getLibraryFunction("full-adder-carry")!.source);
    if (!r.ok) throw new Error("bad");
    // 1 whenever at least two of the three inputs are 1.
    expect(minterms(r.value.fn)).toEqual([3, 5, 6, 7]);
  });
});

describe("blankTruthTable", () => {
  it("produces an all-zero table of the right size", () => {
    const r = analyze(blankTruthTable(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.fn.variables).toEqual(["A", "B", "C"]);
    expect(r.value.fn.values).toHaveLength(8);
    expect(minterms(r.value.fn)).toEqual([]);
  });

  it("works for 2 to 4 variables", () => {
    for (const n of [2, 3, 4]) {
      const r = analyze(blankTruthTable(n));
      expect(r.ok, `${n} vars`).toBe(true);
      expect(r.ok && r.value.fn.values.length).toBe(1 << n);
    }
  });
});
