import { describe, expect, it } from "vitest";
import { rebuildUnder } from "./rebuild";
import { CUSTOM_ID, getConstraint } from "./constraints";
import { verify } from "./verify";
import type { CircuitDocument } from "./netlist";
import { analyze } from "../core-engine";

const SOURCE = "F(A,B,C) = A'B + BC";

const partsOf = (doc: CircuitDocument): string[] =>
  Object.values(doc.nodes)
    .filter((n) => n.kind === "ic")
    .map((n) => (n as { part: string }).part)
    .sort();

const fnOf = (source: string) => {
  const parsed = analyze(source);
  if (!parsed.ok) throw new Error(`fixture does not parse: ${source}`);
  return parsed.value.fn;
};

describe("rebuildUnder", () => {
  it("produces a DIFFERENT set of chips for a different rule", () => {
    // The whole point. Choosing "NAND only" has to change the board; if it does
    // not, the rule is a lint on a diagram nobody updated.
    const mixed = rebuildUnder(SOURCE, getConstraint("none"));
    const nand = rebuildUnder(SOURCE, getConstraint("nand-only"));
    const nor = rebuildUnder(SOURCE, getConstraint("nor-only"));
    if (!mixed.ok || !nand.ok || !nor.ok) throw new Error("all three should build");

    expect(new Set(partsOf(nand.doc))).toEqual(new Set(["7400"]));
    expect(new Set(partsOf(nor.doc))).toEqual(new Set(["7402"]));
    expect(partsOf(mixed.doc)).not.toEqual(partsOf(nand.doc));
  });

  it("every rule computes the SAME function", () => {
    // Rewriting into another gate set must not change what the circuit DOES. This
    // is the property that makes rebuilding safe to do behind a menu click.
    const expected = fnOf(SOURCE);

    for (const id of ["none", "fundamental", "nand-only", "nor-only", "no-xor"]) {
      const built = rebuildUnder(SOURCE, getConstraint(id));
      if (!built.ok) throw new Error(`${id} should build: ${built.reason}`);

      const result = verify(built.doc, expected);
      expect(result.error, id).toBeNull();
      expect(result.ok, `${id} must match the algebra it was built from`).toBe(true);
    }
  });

  it("refuses an impossible rule, and names the property that traps it", () => {
    // XOR is affine, affine functions compose to affine functions, and AND is not
    // affine. No number of XOR gates will ever build this.
    const r = rebuildUnder(SOURCE, getConstraint(CUSTOM_ID, ["xor"]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason.toLowerCase()).toContain("affine");
  });

  it("refuses a source that no longer parses", () => {
    expect(rebuildUnder("F(A,B) = A' +", getConstraint("nand-only")).ok).toBe(false);
  });

  it("refuses a constant, which has no circuit", () => {
    const r = rebuildUnder("F(A) = A + A'", getConstraint("none"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("constant");
  });

  it("powers every chip it emits", () => {
    // The rebuilt board must be a WORKING board, not a drawing. An unpowered IC
    // outputs Z, and a Z anywhere would make verify() fail — so this passing means
    // pin 14 and pin 7 really were wired.
    const r = rebuildUnder(SOURCE, getConstraint("nand-only"));
    if (!r.ok) throw new Error(r.reason);
    expect(verify(r.doc, fnOf(SOURCE)).ok).toBe(true);
  });
});
