import { describe, expect, it } from "vitest";
import { analyze } from "./index";
import { format } from "./format";

/**
 * `analyze` is the single entry point the UI and the Web Worker call. Everything
 * the theory workspace renders comes out of one of these, so it is worth pinning
 * directly rather than only through its parts.
 */
describe("analyze", () => {
  it("returns the function, both minimizations, and the K-map in one call", () => {
    const r = analyze("F(A,B,C) = A'B + BC");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { fn, sop, pos, layout, loops } = r.value;

    expect(fn.variables).toEqual(["A", "B", "C"]);
    expect(format(sop.expression)).toBe("A'·B + B·C");
    expect(sop.literals).toBe(4);

    // POS is a different spelling of the same function.
    expect(pos.form).toBe("pos");

    expect(layout).not.toBeNull();
    expect(layout?.rows).toBe(2);
    expect(layout?.cols).toBe(4);

    // The K-map loops ARE the QM prime implicants (Invariant 4) — same count.
    expect(loops.sop).toHaveLength(sop.cover.length);
    expect(loops.pos).toHaveLength(pos.cover.length);
  });

  it("groups 0s for the POS loops and 1s for the SOP loops", () => {
    const r = analyze("F(A,B) = Σm(3)");
    if (!r.ok) throw new Error("expected ok");

    // SOP covers the single 1.
    expect(r.value.loops.sop.flatMap((l) => l.cells)).toEqual([3]);
    // POS covers the complement — the 0 cells.
    const posCells = new Set(r.value.loops.pos.flatMap((l) => l.cells));
    expect(posCells.has(3)).toBe(false);
  });

  it("drops the K-map above 4 variables but still minimizes", () => {
    const r = analyze("F(A,B,C,D,E) = Σm(0,31)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.layout).toBeNull();
    expect(r.value.loops.sop).toEqual([]);
    expect(r.value.sop.cover.length).toBeGreaterThan(0);
  });

  it("passes diagnostics through on success", () => {
    // No variable list, so the arity is inferred — that must still be reported.
    const r = analyze("Σm(0,2,5)");
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain("inferred-arity");
  });

  it("fails with diagnostics rather than throwing", () => {
    const r = analyze("A + +");
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("missing-operand");
  });

  it("accepts an explicit variable list", () => {
    const r = analyze("A + B", ["A", "B", "C"]);
    expect(r.ok && r.value.fn.variables).toEqual(["A", "B", "C"]);
    expect(r.ok && r.value.fn.values).toHaveLength(8);
  });
});
