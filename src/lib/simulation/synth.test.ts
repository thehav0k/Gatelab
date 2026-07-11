import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  compareStrategies,
  describeDesign,
  realize,
  synthesize,
  technologyMap,
  type Strategy,
} from "./synth";
import { elaborate } from "./elaborate";
import { evaluate } from "./solver";
import { diagnose } from "./diagnostics";
import { L0, L1, type Logic } from "./logic";
import { parseInput } from "@/lib/core-engine/canonical";
import { minimize } from "@/lib/core-engine/minimizer";
import { truthVector } from "@/lib/core-engine/evaluate";
import { parse } from "@/lib/core-engine/parser";
import { arbExpr, arbVariables } from "@/lib/core-engine/testing/arbitraries";
import { collectVariables } from "@/lib/core-engine/ast";
import type { CircuitDocument } from "./netlist";

const STRATEGIES: Strategy[] = ["mixed", "nand-only", "nor-only"];

const exprOf = (src: string) => {
  const r = parse(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value.ast;
};

/** Sweep a synthesized circuit and read its truth table back off the LEDs. */
function sweep(doc: CircuitDocument, inputCount: number): Logic[] {
  const { netlist } = elaborate(doc);
  const out: Logic[] = [];

  for (let m = 0; m < 1 << inputCount; m++) {
    const inputs = netlist.inputs.map((_, i) =>
      // netlist.inputs is sorted by label (A, B, C…), and variables[0] is the
      // MSB, so bit i of m is the value of input i. Same contract as the theory
      // engine — if these two disagree, the verification bridge lies.
      (((m >>> (inputCount - 1 - i)) & 1) as 0 | 1),
    );
    const state = evaluate(netlist, inputs);
    const port = netlist.outputs[0];
    out.push(port ? (state.values[port.net] as Logic) : 3);
  }
  return out;
}

function build(src: string, strategy: Strategy, discrete = false) {
  const ast = exprOf(src);
  const variables = collectVariables(ast).sort();
  const nl = synthesize(ast, variables);
  const design = technologyMap(nl, strategy);
  const doc = realize(design, { discrete });
  return { ast, variables, nl, design, doc };
}

describe("synthesize", () => {
  it("hash-conses shared subexpressions into ONE gate", () => {
    // A·B appears twice. A tree would build it twice; a circuit builds it once.
    const ast = exprOf("A*B + A*B*C");
    const nl = synthesize(ast, ["A", "B", "C"]);

    const ands = nl.gates.filter((g) => g.op === "and");
    // AB (shared), then (AB)·C, then the OR. Three gates, not four.
    expect(ands).toHaveLength(2);
    expect(nl.gates).toHaveLength(3);
  });

  it("decomposes an n-ary gate into a BALANCED tree, not a chain", () => {
    const nl = synthesize(exprOf("A*B*C*D"), ["A", "B", "C", "D"]);
    // Balanced: (A·B)·(C·D) -> 3 gates, depth 2. A chain would also be 3 gates
    // but depth 3, so assert the depth.
    expect(nl.gates).toHaveLength(3);

    const depth = new Map<number, number>();
    for (const i of nl.inputs) depth.set(i.signal, 0);
    for (const g of nl.gates) {
      depth.set(g.output, Math.max(...g.inputs.map((s) => (depth.get(s) ?? 0) + 1)));
    }
    expect(depth.get(nl.outputSignal)).toBe(2);
  });
});

describe("technology mapping", () => {
  // Capacity is uniform, so this is just ceil(demand/capacity) — no heuristic.
  it("packs 4 NANDs into one 7400 and 5 into two", () => {
    const four = technologyMap(
      { gates: nands(4), inputs: [{ name: "A", signal: 0 }], outputSignal: 1, constant: null },
      "mixed",
    );
    expect(four.chipCount).toBe(1);

    const five = technologyMap(
      { gates: nands(5), inputs: [{ name: "A", signal: 0 }], outputSignal: 1, constant: null },
      "mixed",
    );
    expect(five.chipCount).toBe(2);
    expect(five.chips.map((c) => c.part)).toEqual(["7400", "7400"]);
  });

  /**
   * THE PAYOFF PASS. An inverter is a NAND with its inputs tied together, so it
   * costs nothing extra to put it in a spare NAND slot. Naively this design is
   * 2 x 7400 + 1 x 7404 = 3 chips. After absorption the 7404 disappears entirely.
   */
  it("absorbs inverters into spare NAND slots, dropping the 7404 entirely", () => {
    // A MIXED design — this is where 7404s actually appear. (In a NAND-only
    // design there are no inverters left to absorb: rewriteFamily already turned
    // each one into a NAND with its inputs tied.)
    const gates = [...nands(5), ...nots(2, 100)];
    const design = technologyMap(
      { gates, inputs: [{ name: "A", signal: 0 }], outputSignal: 1, constant: null },
      "mixed",
    );

    expect(design.chipCount).toBe(2);
    expect(design.chips.map((c) => c.part)).toEqual(["7400", "7400"]);
    expect(design.chips.some((c) => c.part === "7404")).toBe(false);
  });

  it("does NOT absorb when there is no spare slot to absorb into", () => {
    // Four NANDs fill a 7400 exactly. The inverter has nowhere free to go, so
    // it must still get its own 7404 — absorption may never ADD a package.
    const gates = [...nands(4), ...nots(1, 100)];
    const design = technologyMap(
      { gates, inputs: [{ name: "A", signal: 0 }], outputSignal: 1, constant: null },
      "mixed",
    );
    expect(design.chips.map((c) => c.part).sort()).toEqual(["7400", "7404"]);
  });

  it("rewrites into a single gate family", () => {
    const { design } = build("A + B", "nand-only");
    expect(design.netlist.gates.every((g) => g.op === "nand")).toBe(true);

    const nor = build("A * B", "nor-only");
    expect(nor.design.netlist.gates.every((g) => g.op === "nor")).toBe(true);
  });

  it("compares the strategies, which is itself the lesson", () => {
    const ast = exprOf("A*B + C*D");
    const nl = synthesize(ast, ["A", "B", "C", "D"]);
    const ranked = compareStrategies(nl);

    expect(ranked).toHaveLength(3);
    // Sorted cheapest-first, so the UI can just say "use this one".
    expect(ranked[0]!.chipCount).toBeLessThanOrEqual(ranked[2]!.chipCount);
    expect(describeDesign(ranked[0]!)).toMatch(/IC/);
  });
});

describe("realize", () => {
  it("ALWAYS wires pin 14 to Vcc and pin 7 to GND on every chip", () => {
    // The thing students forget. The generator must never forget it.
    const { doc, design } = build("A*B + C*D", "mixed");
    const { index } = elaborate(doc);

    const ics = Object.values(doc.nodes).filter((n) => n.kind === "ic");
    expect(ics.length).toBe(design.chipCount);
    expect(ics.length).toBeGreaterThan(0);

    for (const ic of ics) {
      const vcc = index.netOfPin.get(`${ic.id}::VCC`);
      const gnd = index.netOfPin.get(`${ic.id}::GND`);
      expect(vcc, `${ic.label} VCC`).toBe(index.vcc);
      expect(gnd, `${ic.label} GND`).toBe(index.gnd);
    }
  });

  it("produces a circuit with no faults", () => {
    const { doc } = build("A*B + C*D", "mixed");
    const { index, netlist } = elaborate(doc);
    const state = evaluate(
      netlist,
      netlist.inputs.map(() => 0 as const),
    );
    const errors = diagnose(doc, index, netlist, state).filter(
      (d) => d.severity === "error",
    );
    expect(errors).toEqual([]);
  });

  it("ties both inputs of an absorbed inverter to the same signal", () => {
    const { doc, design } = build("A'", "nand-only");
    expect(design.chips[0]?.part).toBe("7400");

    // NOT A becomes NAND(A, A): the switch must reach BOTH 1A and 1B.
    const { index } = elaborate(doc);
    const sw = Object.values(doc.nodes).find((n) => n.kind === "switch");
    const ic = Object.values(doc.nodes).find((n) => n.kind === "ic");
    const swNet = index.netOfPin.get(`${sw?.id}::Y`);
    expect(index.netOfPin.get(`${ic?.id}::1A`)).toBe(swNet);
    expect(index.netOfPin.get(`${ic?.id}::1B`)).toBe(swNet);
  });
});

describe("round-trip — the acceptance gate", () => {
  it.each(STRATEGIES)("a %s circuit reproduces the expression's truth table", (strategy) => {
    for (const src of ["A*B", "A + B", "A'B + BC", "A ^ B", "(A+B)(C+D)", "A'"]) {
      const { doc, variables, ast } = build(src, strategy);
      const expected = [...truthVector(ast, variables)];
      const got = sweep(doc, variables.length).map(Number);
      expect(got, `${src} as ${strategy}`).toEqual(expected);
    }
  });

  it.each(STRATEGIES)("a discrete-gate %s circuit does too", (strategy) => {
    for (const src of ["A'B + BC", "A ^ B ^ C"]) {
      const { doc, variables, ast } = build(src, strategy, true);
      expect(sweep(doc, variables.length).map(Number)).toEqual([
        ...truthVector(ast, variables),
      ]);
    }
  });

  /**
   * THE BIG ONE. This closes the loop between the two halves of the app: build a
   * random expression, minimize it with the theory engine, synthesize it into
   * real 74xx chips, simulate the resulting board, and assert the board's truth
   * table equals the expression's.
   *
   * Any drift between the minimizer and the simulator becomes a red test here,
   * instead of a user-visible "verification says my correct circuit is wrong".
   */
  it("minimize -> synthesize -> simulate reproduces the original function", () => {
    fc.assert(
      fc.property(
        arbVariables(1, 3).chain((vars) => arbExpr(vars).map((ast) => ({ vars, ast }))),
        fc.constantFrom<Strategy>("mixed", "nand-only", "nor-only"),
        ({ vars, ast }, strategy) => {
          const expected = [...truthVector(ast, vars)];

          // Round-trip through the theory engine, exactly as the app does.
          const fn = parseInput(
            `F(${vars.join(",")}) = Σm(${expected
              .map((v, m) => (v === 1 ? m : -1))
              .filter((m) => m >= 0)
              .join(",")})`,
          );
          if (!fn.ok) return;

          const min = minimize(fn.value, "sop");
          const nl = synthesize(min.expression, vars);
          if (nl.constant !== null) return; // constant 0/1 has no circuit to build

          const doc = realize(technologyMap(nl, strategy));
          expect(sweep(doc, vars.length).map(Number), `${strategy}`).toEqual(expected);
        },
      ),
      { numRuns: 120 },
    );
  });
});

// --- helpers ---------------------------------------------------------------

const nands = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    op: "nand" as const,
    inputs: [0, 0],
    output: i + 1,
  }));

const nots = (n: number, base: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: base + i,
    op: "not" as const,
    inputs: [0],
    output: base + i + 1,
  }));

describe("degenerate", () => {
  it("reports a constant expression rather than building nothing", () => {
    const nl = synthesize(exprOf("1"), ["A"]);
    expect(nl.constant).toBe(1);
    expect(nl.gates).toHaveLength(0);
  });

  it("realizes a single-variable pass-through", () => {
    const { doc, variables, ast } = build("A", "mixed");
    expect(sweep(doc, variables.length).map(Number)).toEqual([...truthVector(ast, variables)]);
  });
});

describe("evaluate parity", () => {
  it("agrees with the golden oracle on a hand-checked case", () => {
    const { doc } = build("A*B", "mixed");
    const table = sweep(doc, 2);
    expect(table).toEqual([L0, L0, L0, L1]);
  });
});
