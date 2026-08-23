import { describe, expect, it } from "vitest";
import { evaluate, parse, truthVector } from "@/lib/core-engine";
import { toDiagram, blockOf, type EditorDocument } from "./document";
import { addFromPalette, freeSpaceBelow, mergeDocument, setValues } from "./ops";
import { parseSpec, sigmaOf } from "./spec";
import {
  AUTO_WIRABLE,
  IMPLEMENTATIONS,
  autoWire,
  buildImplementation,
  type Implementation,
} from "./synthesize";
import { TEXTBOOK } from "../theme";
import { validate } from "../types";
import { placeDocument } from "./place";
import { renderSvg } from "../svg";
import { getTemplate } from "./templates";
import { emptyDocument } from "./document";

const specOf = (text: string) => {
  const parsed = parseSpec(text);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join("; "));
  return parsed.value;
};

const IMPLS: Implementation[] = ["gates", "nand", "nor", "decoder", "mux", "muxtree"];

describe("reading a function out of what somebody typed", () => {
  it("takes an expression", () => {
    const { specs, variables } = specOf("F(A,B,C) = A'B + BC'");
    expect(variables).toEqual(["A", "B", "C"]);
    // A'B is rows 2,3; BC' is rows 2,6.
    expect(specs[0]?.minterms).toEqual([2, 3, 6]);
  });

  it("takes minterm notation, with don't-cares", () => {
    const { specs } = specOf("F(A,B,C) = Σm(1,3,5) + d(7)");
    expect(specs[0]?.minterms).toEqual([1, 3, 5]);
    expect(specs[0]?.dontCares).toEqual([7]);
  });

  it("takes maxterm notation", () => {
    const { specs } = specOf("F(A,B) = ΠM(0,2)");
    expect(specs[0]?.minterms).toEqual([1, 3]);
  });

  /**
   * The truth-table form has to be recognised BEFORE the expression parser sees
   * it, because `1101` is a perfectly valid expression — four constants
   * juxtaposed, which means AND. Hence the strict test: only 0/1/x, and exactly
   * a power-of-two long.
   */
  it("takes a column of output bits", () => {
    const { specs, variables } = specOf("F(A,B,C) = 01101001");
    expect(variables).toEqual(["A", "B", "C"]);
    expect(specs[0]?.minterms).toEqual([1, 2, 4, 7]);
  });

  it("accepts don't-cares and separators in the bit column", () => {
    const { specs } = specOf("F(A,B) = 1 0 x 1");
    expect(specs[0]?.minterms).toEqual([0, 3]);
    expect(specs[0]?.dontCares).toEqual([2]);
  });

  it("does not mistake a short expression for a bit column", () => {
    // Length 1 is not a power of two >= 2, so this stays an expression.
    const { specs } = specOf("F(A) = 1");
    expect(specs[0]?.minterms).toEqual([0, 1]);
  });

  it("infers the variables when none are declared, and says so", () => {
    const parsed = parseSpec("Σm(1,3,5)");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.variables).toHaveLength(3);
    expect(parsed.value.diagnostics.some((d) => d.severity === "warning")).toBe(true);
  });

  it("reads several outputs, the later ones inheriting the variables", () => {
    const { specs, variables } = specOf(
      "f1(A,B,C) = Σm(1,2,4,7)\nf2 = Σm(3,5,6,7)\nf3 = 11110000",
    );
    expect(variables).toEqual(["A", "B", "C"]);
    // The engine upper-cases identifiers, names included.
    expect(specs.map((s) => s.name)).toEqual(["F1", "F2", "F3"]);
    expect(specs[1]?.minterms).toEqual([3, 5, 6, 7]);
    expect(specs[2]?.minterms).toEqual([0, 1, 2, 3]);
  });

  it("ignores blank lines and comments", () => {
    const { specs } = specOf("# the sum bit\nS(X,Y,Z) = Σm(1,2,4,7)\n\n// carry\nC = Σm(3,5,6,7)");
    expect(specs).toHaveLength(2);
  });

  it("refuses lines that disagree about the variables", () => {
    const parsed = parseSpec("f1(A,B) = Σm(1)\nf2(A,B,C) = Σm(3)");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.diagnostics[0]?.message).toMatch(/same variables/);
  });

  it("refuses nonsense, and says which line", () => {
    expect(parseSpec("").ok).toBe(false);
    expect(parseSpec("F = ((((").ok).toBe(false);
    const twoLines = parseSpec("F(A,B) = A\nG = )(");
    expect(twoLines.ok).toBe(false);
    if (twoLines.ok) return;
    expect(twoLines.diagnostics[0]?.message).toMatch(/Line 2/);
  });

  it("refuses a function too wide to draw", () => {
    const parsed = parseSpec("F(A,B,C,D,E,F,G,H,I) = Σm(1)");
    expect(parsed.ok).toBe(false);
  });

  /**
   * `1010` is also a valid expression — four constants ANDed, which is 0 — so
   * before this was caught, a mistyped truth table quietly built a circuit for
   * the constant 0. An obvious typo producing a wrong answer with no complaint
   * is the worst thing an input box can do.
   */
  it("says so when a bit column does not match the variables", () => {
    const wrongCount = parseSpec("F(A,B,C) = 1010");
    expect(wrongCount.ok).toBe(false);
    if (wrongCount.ok) return;
    expect(wrongCount.diagnostics[0]?.message).toMatch(/2-variable table/);
    expect(wrongCount.diagnostics[0]?.message).toMatch(/8 rows/);
  });

  it("says so when a bit column is not a power of two long", () => {
    const odd = parseSpec("F(A,B,C) = 101");
    expect(odd.ok).toBe(false);
    if (odd.ok) return;
    expect(odd.diagnostics[0]?.message).toMatch(/2\^n rows/);
    expect(odd.diagnostics[0]?.message).toMatch(/2 and 4/);
  });

  it("still reads a bare constant as an expression", () => {
    expect(specOf("F(A,B) = 1").specs[0]?.minterms).toEqual([0, 1, 2, 3]);
    expect(specOf("F(A,B) = 0").specs[0]?.minterms).toEqual([]);
  });

  it("keeps two outputs apart when they were given the same name", () => {
    const { specs } = specOf("F(A,B) = Σm(1)\nF = Σm(2)");
    expect(new Set(specs.map((s) => s.name)).size).toBe(2);
  });

  it("echoes the rows back in sigma notation", () => {
    const { specs } = specOf("F(A,B,C) = Σm(1,3) + d(5)");
    expect(sigmaOf(specs[0]!)).toBe("F(A, B, C) = Σm(1, 3) + d(5)");
  });
});

// ---------------------------------------------------------------------------

/**
 * THE ACCEPTANCE TEST FOR THE WHOLE FEATURE.
 *
 * A generated circuit is only worth anything if it computes the function that
 * was asked for. So: build the same function six ways, walk each resulting
 * document back to a Boolean expression by following its wires, and check the
 * truth table against the original. This catches an inverted enable, a decoder
 * addressed least-significant-bit-first, a Shannon residue read off the wrong
 * half of the table — none of which look wrong in a picture.
 */
function evaluateDocument(
  doc: EditorDocument,
  variables: readonly string[],
  outputName: string,
  assignment: ReadonlyMap<string, 0 | 1>,
): 0 | 1 | null {
  const value = new Map<string, 0 | 1>();

  const driverOf = (block: string, port: string): { block: string; port: string } | null => {
    const link = Object.values(doc.links).find(
      (l) => l.to.block === block && l.to.port === port,
    );
    return link ? link.from : null;
  };

  const seen = new Set<string>();
  const read = (block: string, port: string): 0 | 1 | null => {
    const key = `${block}.${port}`;
    const cached = value.get(key);
    if (cached !== undefined) return cached;
    if (seen.has(key)) return null; // a loop; generated circuits have none
    seen.add(key);

    const instance = doc.instances[block];
    if (!instance) return null;
    let result: 0 | 1 | null = null;

    if (instance.part === "input" || instance.part === "clock") {
      result = assignment.get(String(instance.values.label ?? "")) ?? null;
    } else if (instance.part === "constant") {
      result = instance.values.value === "1" ? 1 : 0;
    } else if (instance.part === "gate") {
      const op = String(instance.values.op ?? "and");
      const inputs: (0 | 1)[] = [];
      for (const p of blockOf(doc, instance)?.ports ?? []) {
        if (p.dir !== "in") continue;
        const from = driverOf(block, p.id);
        const v = from ? read(from.block, from.port) : null;
        if (v === null) return null;
        inputs.push(v);
      }
      result = applyGate(op, inputs);
    } else if (instance.part === "decoder") {
      const addr = Number(instance.values.addr ?? 2);
      const bits: (0 | 1)[] = [];
      for (let i = addr - 1; i >= 0; i--) {
        const from = driverOf(block, `A${i}`);
        const v = from ? read(from.block, from.port) : null;
        if (v === null) return null;
        bits.push(v);
      }
      const code = bits.reduce<number>((acc, b) => (acc << 1) | b, 0);
      const enablePin = driverOf(block, "E");
      const enable = enablePin ? read(enablePin.block, enablePin.port) : 1;
      const index = Number.parseInt(port.slice(1), 10);
      result = enable === 1 && code === index ? 1 : 0;
    } else if (instance.part === "mux") {
      const sel = Number(instance.values.sel ?? 2);
      const bits: (0 | 1)[] = [];
      for (let i = sel - 1; i >= 0; i--) {
        const from = driverOf(block, `S${i}`);
        const v = from ? read(from.block, from.port) : null;
        if (v === null) return null;
        bits.push(v);
      }
      const code = bits.reduce<number>((acc, b) => (acc << 1) | b, 0);
      const from = driverOf(block, `D${code}`);
      result = from ? read(from.block, from.port) : null;
    } else if (instance.part === "output") {
      const from = driverOf(block, "A");
      result = from ? read(from.block, from.port) : null;
    }

    if (result !== null) value.set(key, result);
    return result;
  };

  const tag = Object.values(doc.instances).find(
    (i) => i.part === "output" && i.values.label === outputName,
  );
  if (!tag) return null;
  void variables;
  return read(tag.id, "A");
}

function applyGate(op: string, inputs: readonly (0 | 1)[]): 0 | 1 {
  const and = inputs.every((v) => v === 1) ? 1 : 0;
  const or = inputs.some((v) => v === 1) ? 1 : 0;
  const xor = (inputs.reduce<number>((a, v) => a ^ v, 0) & 1) as 0 | 1;
  switch (op) {
    case "and": return and;
    case "nand": return (and ^ 1) as 0 | 1;
    case "or": return or;
    case "nor": return (or ^ 1) as 0 | 1;
    case "xor": return xor;
    case "xnor": return (xor ^ 1) as 0 | 1;
    case "not": return ((inputs[0] ?? 0) ^ 1) as 0 | 1;
    default: return inputs[0] ?? 0;
  }
}

const CASES = [
  "F(A,B,C) = A'B + BC'",
  "F(A,B,C) = Σm(1,2,4,7)",
  "F(A,B,C,D) = Σm(2,3,5,7,11,13)",
  "F(A,B) = Σm(0,3)",
  "F(A,B,C) = 01101001",
  "F(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)",
];

describe("building an implementation from an equation", () => {
  for (const source of CASES) {
    for (const impl of IMPLS) {
      it(`${impl}: ${source}`, () => {
        const { specs, variables } = specOf(source);
        const built = buildImplementation(specs, impl, TEXTBOOK);
        expect(built.ok, built.ok ? "" : (built as { reason: string }).reason).toBe(true);
        if (!built.ok) return;

        const doc = built.value.doc;
        expect(validate(toDiagram(doc))).toEqual([]);

        // Every row of the original truth table, through the built circuit.
        const expected = truthVector(
          parse(source).ok
            ? (parse(source) as { value: { ast: Parameters<typeof evaluate>[0] } }).value.ast
            : ({ kind: "const", value: 0, span: { start: 0, end: 0 } } as never),
          variables,
        );
        const n = variables.length;
        for (let m = 0; m < 1 << n; m++) {
          const assignment = new Map<string, 0 | 1>();
          variables.forEach((v, i) => {
            assignment.set(v, ((m >>> (n - 1 - i)) & 1) as 0 | 1);
          });
          const actual = evaluateDocument(doc, variables, specs[0]!.name, assignment);
          const want = specs[0]!.minterms.includes(m) ? 1 : 0;
          expect(actual, `${impl} row ${m} of ${source}`).toBe(want);
        }
        void expected;
      });
    }
  }

  it("builds several outputs onto one decoder", () => {
    const { specs } = specOf("f1(A,B,C) = Σm(1,2,4,7)\nf2 = Σm(3,5,6,7)");
    const built = buildImplementation(specs, "decoder", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const doc = built.value.doc;
    const decoders = Object.values(doc.instances).filter((i) => i.part === "decoder");
    expect(decoders).toHaveLength(1);

    for (const spec of specs) {
      for (let m = 0; m < 8; m++) {
        const assignment = new Map<string, 0 | 1>();
        ["A", "B", "C"].forEach((v, i) => {
          assignment.set(v, ((m >>> (2 - i)) & 1) as 0 | 1);
        });
        expect(
          evaluateDocument(doc, spec.variables, spec.name, assignment),
          `${spec.name} row ${m}`,
        ).toBe(spec.minterms.includes(m) ? 1 : 0);
      }
    }
  });

  it("reduces the multiplexer tree below the worst case", () => {
    const { specs } = specOf("F(A,B,C,D) = Σm(2,3,5,7,11,13)");
    const built = buildImplementation(specs, "muxtree", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const muxes = Object.values(built.value.doc.instances).filter((i) => i.part === "mux");
    expect(muxes.length).toBeGreaterThan(0);
    expect(muxes.length).toBeLessThan((1 << 4) - 1);
  });

  it("uses no gates at all in a multiplexer tree", () => {
    const { specs } = specOf("F(A,B,C) = Σm(1,2,4,7)");
    const built = buildImplementation(specs, "muxtree", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(
      Object.values(built.value.doc.instances).filter((i) => i.part === "gate"),
    ).toHaveLength(0);
  });

  it("produces a NAND-only circuit that really is NAND only", () => {
    const { specs } = specOf("F(A,B,C) = A'B + BC'");
    const built = buildImplementation(specs, "nand", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const gates = Object.values(built.value.doc.instances).filter((i) => i.part === "gate");
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.every((g) => g.values.op === "nand")).toBe(true);
  });

  it("arranges what it builds, and draws", () => {
    const { specs } = specOf("F(A,B,C) = Σm(1,2,4,7)");
    const built = buildImplementation(specs, "gates", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const placed = placeDocument(built.value.doc, TEXTBOOK);
    expect(placed.blocks.length).toBeGreaterThan(3);
    // Inputs on the left of outputs — the arrange step ran.
    const input = placed.blocks.find((b) => b.block.kind === "io" && b.block.title === "A");
    const output = placed.blocks.find((b) => b.block.title === "F");
    expect(input!.x).toBeLessThan(output!.x);
    expect(renderSvg(placed, TEXTBOOK, { frame: "canvas" })).not.toContain("NaN");
  });

  it("describes every implementation it offers", () => {
    expect(IMPLEMENTATIONS.map((i) => i.id).sort()).toEqual([...IMPLS].sort());
    for (const impl of IMPLEMENTATIONS) expect(impl.summary.length).toBeGreaterThan(20);
  });

  it("builds a constant function as a tie-off, not a dangling wire", () => {
    for (const source of ["F(A,B) = 0000", "F(A,B) = 1111"]) {
      const { specs } = specOf(source);
      const built = buildImplementation(specs, "gates", TEXTBOOK);
      expect(built.ok, source).toBe(true);
      if (!built.ok) return;
      const constants = Object.values(built.value.doc.instances).filter(
        (i) => i.part === "constant",
      );
      expect(constants.length, source).toBeGreaterThan(0);
      expect(validate(toDiagram(built.value.doc))).toEqual([]);
    }
  });

  it("wires a single-minterm output straight off the decoder", () => {
    const { specs } = specOf("F(A,B,C) = Σm(5)");
    const built = buildImplementation(specs, "decoder", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // No collecting gate — one minterm is already the function.
    expect(
      Object.values(built.value.doc.instances).filter((i) => i.part === "gate"),
    ).toHaveLength(0);
    const straight = Object.values(built.value.doc.links).find(
      (l) => l.from.port === "Y5",
    );
    expect(straight).toBeDefined();
  });

  it("ties an always-false decoder output to ground", () => {
    const { specs } = specOf("F(A,B) = 0000");
    const built = buildImplementation(specs, "decoder", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(
      Object.values(built.value.doc.instances).some(
        (i) => i.part === "constant" && i.values.value === "0",
      ),
    ).toBe(true);
  });

  it("builds one multiplexer per output", () => {
    const { specs } = specOf("f1(A,B,C) = Σm(1,2)\nf2 = Σm(3,5)");
    const built = buildImplementation(specs, "mux", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(
      Object.values(built.value.doc.instances).filter((i) => i.part === "mux"),
    ).toHaveLength(2);
    expect(validate(toDiagram(built.value.doc))).toEqual([]);
  });

  it("honours an explicit select width", () => {
    const { specs } = specOf("F(A,B,C,D) = Σm(2,3,5,7,11,13)");
    const built = buildImplementation(specs, "mux", TEXTBOOK, { selectBits: 2 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const mux = Object.values(built.value.doc.instances).find((i) => i.part === "mux");
    expect(mux?.values.sel).toBe(2);
  });

  it("refuses an empty specification", () => {
    expect(buildImplementation([], "gates", TEXTBOOK).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("auto-wiring a block already on the canvas", () => {
  const withPart = (part: string, values: Record<string, string | number | boolean>) => {
    const added = addFromPalette(emptyDocument(), part, 200, 200);
    if (!added) throw new Error("no part");
    return { doc: setValues(added.doc, added.id, values).doc, id: added.id };
  };

  it("wires a decoder to a truth table", () => {
    const { doc, id } = withPart("decoder", { addr: 3, enable: true });
    const { specs } = specOf("F(A,B,C) = Σm(1,2,4,7)");
    const result = autoWire(doc, id, specs);
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) return;

    expect(validate(toDiagram(result.doc))).toEqual([]);
    // The decoder the user placed is still the one being used.
    expect(Object.values(result.doc.instances).filter((i) => i.part === "decoder")).toHaveLength(1);
    for (let m = 0; m < 8; m++) {
      const assignment = new Map<string, 0 | 1>();
      ["A", "B", "C"].forEach((v, i) => assignment.set(v, ((m >>> (2 - i)) & 1) as 0 | 1));
      expect(evaluateDocument(result.doc, ["A", "B", "C"], "F", assignment)).toBe(
        specs[0]!.minterms.includes(m) ? 1 : 0,
      );
    }
  });

  it("wires a multiplexer by Shannon expansion", () => {
    const { doc, id } = withPart("mux", { sel: 3 });
    const { specs } = specOf("F(A,B,C,D) = Σm(2,3,5,7,11,13)");
    const result = autoWire(doc, id, specs);
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) return;

    for (let m = 0; m < 16; m++) {
      const assignment = new Map<string, 0 | 1>();
      ["A", "B", "C", "D"].forEach((v, i) => assignment.set(v, ((m >>> (3 - i)) & 1) as 0 | 1));
      expect(evaluateDocument(result.doc, ["A", "B", "C", "D"], "F", assignment)).toBe(
        specs[0]!.minterms.includes(m) ? 1 : 0,
      );
    }
  });

  it("wires a narrow multiplexer with the gates the residues need", () => {
    const { doc, id } = withPart("mux", { sel: 2 });
    const { specs } = specOf("F(A,B,C,D) = Σm(2,3,5,7,11,13)");
    const result = autoWire(doc, id, specs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.values(result.doc.instances).some((i) => i.part === "gate")).toBe(true);
    for (let m = 0; m < 16; m++) {
      const assignment = new Map<string, 0 | 1>();
      ["A", "B", "C", "D"].forEach((v, i) => assignment.set(v, ((m >>> (3 - i)) & 1) as 0 | 1));
      expect(evaluateDocument(result.doc, ["A", "B", "C", "D"], "F", assignment)).toBe(
        specs[0]!.minterms.includes(m) ? 1 : 0,
      );
    }
  });

  /**
   * Refusing is the feature. Reshaping the block the user deliberately placed
   * would be the tool overruling them, and the message has to say what to change.
   */
  it("refuses a decoder that is the wrong width, and says which way", () => {
    const { doc, id } = withPart("decoder", { addr: 3 });
    const { specs } = specOf("F(A,B,C,D) = Σm(1)");
    const result = autoWire(doc, id, specs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/3 address lines/);
    expect(result.reason).toMatch(/4/);
  });

  it("refuses a multiplexer with more select lines than there are variables", () => {
    const { doc, id } = withPart("mux", { sel: 4 });
    const { specs } = specOf("F(A,B) = Σm(1)");
    expect(autoWire(doc, id, specs).ok).toBe(false);
  });

  it("refuses a part that cannot implement a function on its own", () => {
    const { doc, id } = withPart("gate", { op: "and" });
    const { specs } = specOf("F(A,B) = Σm(1)");
    const result = autoWire(doc, id, specs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/decoder or a multiplexer/);
    expect(AUTO_WIRABLE.has("gate")).toBe(false);
  });

  it("leaves pins the user already wired alone", () => {
    const { doc, id } = withPart("decoder", { addr: 2, enable: true });
    const seeded = addFromPalette(doc, "input", 0, 0);
    let start = seeded!.doc;
    start = setValues(start, seeded!.id, { label: "A" }).doc;
    const wired = {
      ...start,
      seq: start.seq + 1,
      links: {
        w99: {
          id: "w99",
          from: { block: seeded!.id, port: "Y" },
          to: { block: id, port: "A1" },
        },
      },
    };

    const { specs } = specOf("F(A,B) = Σm(1,2)");
    const result = autoWire(wired, id, specs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Still exactly one wire into A1 — the one that was already there.
    const intoA1 = Object.values(result.doc.links).filter(
      (l) => l.to.block === id && l.to.port === "A1",
    );
    expect(intoA1).toHaveLength(1);
    expect(intoA1[0]?.from.block).toBe(seeded!.id);
  });

  it("says so when only the first output could be wired to one multiplexer", () => {
    const { doc, id } = withPart("mux", { sel: 2 });
    const { specs } = specOf("f1(A,B,C) = Σm(1,2)\nf2 = Σm(3,5)");
    const result = autoWire(doc, id, specs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.some((n) => n.includes("one output"))).toBe(true);
  });

  it("warns when a narrow multiplexer forces extra gates", () => {
    const { doc, id } = withPart("mux", { sel: 1 });
    const { specs } = specOf("F(A,B,C,D) = Σm(2,3,5,7,11,13)");
    const result = autoWire(doc, id, specs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.some((n) => n.includes("select line"))).toBe(true);
  });

  it("ties an always-false output to ground when auto-wiring a decoder", () => {
    const { doc, id } = withPart("decoder", { addr: 2, enable: true });
    const { specs } = specOf("F(A,B) = 0000");
    const result = autoWire(doc, id, specs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      Object.values(result.doc.instances).some(
        (i) => i.part === "constant" && i.values.value === "0",
      ),
    ).toBe(true);
  });

  it("wires a single minterm straight through when auto-wiring", () => {
    const { doc, id } = withPart("decoder", { addr: 2, enable: false });
    const { specs } = specOf("F(A,B) = Σm(2)");
    const result = autoWire(doc, id, specs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.values(result.doc.links).some((l) => l.from.port === "Y2")).toBe(true);
  });

  it("refuses when the block has gone", () => {
    const { specs } = specOf("F(A,B) = Σm(1)");
    expect(autoWire(emptyDocument(), "ghost", specs).ok).toBe(false);
  });
});

describe("merging generated work into a canvas", () => {
  it("renumbers everything so nothing collides", () => {
    const target = getTemplate("half-adder")!.build();
    const { specs } = specOf("F(A,B,C) = Σm(1,2,4,7)");
    const built = buildImplementation(specs, "gates", TEXTBOOK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const before = Object.keys(target.instances).length;
    const merged = mergeDocument(target, built.value.doc, freeSpaceBelow(target));
    expect(Object.keys(merged.doc.instances)).toHaveLength(
      before + Object.keys(built.value.doc.instances).length,
    );
    expect(validate(toDiagram(merged.doc))).toEqual([]);
    // The originals are untouched.
    for (const id of Object.keys(target.instances)) {
      expect(merged.doc.instances[id]).toEqual(target.instances[id]);
    }
  });

  it("drops the new work clear of the old", () => {
    const target = getTemplate("half-adder")!.build();
    const built = buildImplementation(specOf("F(A,B) = Σm(1)").specs, "gates", TEXTBOOK);
    if (!built.ok) return;
    const at = freeSpaceBelow(target);
    const merged = mergeDocument(target, built.value.doc, at);
    const oldBottom = Math.max(...Object.values(target.instances).map((i) => i.y));
    for (const id of merged.ids) {
      expect(merged.doc.instances[id]!.y).toBeGreaterThan(oldBottom);
    }
  });

  it("renumbers custom parts rather than assuming two are the same", () => {
    const a = getTemplate("half-adder")!.build();
    const merged = mergeDocument(a, a, { x: 0, y: 400 });
    expect(Object.keys(merged.doc.instances)).toHaveLength(
      Object.keys(a.instances).length * 2,
    );
    expect(validate(toDiagram(merged.doc))).toEqual([]);
  });
});
