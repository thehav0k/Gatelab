import { describe, expect, it } from "vitest";
import { PRESETS, buildPreset } from "./presets";
import { elaborate } from "./elaborate";
import { evaluate } from "./solver";
import { diagnose } from "./diagnostics";
import { simulateTimed } from "./timing";
import { truthVector } from "@/lib/core-engine/evaluate";
import { parse } from "@/lib/core-engine/parser";
import type { Logic } from "./logic";
import type { Strategy } from "./synth";

const STRATEGIES: Strategy[] = ["mixed", "nand-only", "nor-only"];

describe("presets", () => {
  it.each(PRESETS.map((p) => [p.id, p] as const))(
    "%s builds a board whose every output matches its expression",
    (_id, preset) => {
      const doc = buildPreset(preset);
      const { netlist } = elaborate(doc);
      const n = preset.variables.length;

      for (const output of preset.outputs) {
        const parsed = parse(output.expr);
        expect(parsed.ok, output.expr).toBe(true);
        if (!parsed.ok) return;

        const expected = [...truthVector(parsed.value.ast, preset.variables)];
        const port = netlist.outputs.find((p) => p.label === output.label);
        expect(port, `${output.label} LED`).toBeDefined();
        if (!port) return;

        const got: number[] = [];
        for (let m = 0; m < 1 << n; m++) {
          const inputs = netlist.inputs.map(
            (p) =>
              // The switches are shared across outputs, so align by LABEL rather
              // than by position — the netlist sorts them, the preset may not.
              ((m >>> (n - 1 - preset.variables.indexOf(p.label))) & 1) as 0 | 1,
          );
          const state = evaluate(netlist, inputs);
          got.push(state.values[port.net] as Logic);
        }

        expect(got, `${preset.id}.${output.label}`).toEqual(expected);
      }
    },
  );

  it.each(PRESETS.map((p) => [p.id, p] as const))(
    "%s builds with no faults",
    (_id, preset) => {
      const doc = buildPreset(preset);
      const { index, netlist } = elaborate(doc);
      const state = evaluate(
        netlist,
        netlist.inputs.map(() => 0 as const),
      );
      const errors = diagnose(doc, index, netlist, state).filter(
        (d) => d.severity === "error",
      );
      expect(errors.map((e) => e.message)).toEqual([]);
    },
  );

  it("shares one set of input switches across all outputs", () => {
    // The full adder has two outputs. It must have THREE switches, not six.
    const doc = buildPreset(PRESETS.find((p) => p.id === "full-adder")!);
    const switches = Object.values(doc.nodes).filter((n) => n.kind === "switch");
    expect(switches).toHaveLength(3);
    expect(switches.map((s) => s.label).sort()).toEqual(["A", "B", "C"]);

    const leds = Object.values(doc.nodes).filter((n) => n.kind === "led");
    expect(leds.map((l) => l.label).sort()).toEqual(["K", "S"]);
  });

  it("builds in every gate family", () => {
    for (const s of STRATEGIES) {
      const doc = buildPreset(PRESETS.find((p) => p.id === "half-adder")!, s);
      expect(Object.keys(doc.nodes).length, s).toBeGreaterThan(0);
    }
  });
});

describe("the hazard presets — the lesson, end to end", () => {
  const hazard = PRESETS.find((p) => p.id === "hazard")!;
  const cured = PRESETS.find((p) => p.id === "hazard-free")!;

  it("the minimal SOP glitches", () => {
    const result = simulateTimed(elaborate(buildPreset(hazard)).netlist);
    expect(result.glitches.length).toBeGreaterThan(0);
  });

  it("the version with the redundant consensus term does not", () => {
    const result = simulateTimed(elaborate(buildPreset(cured)).netlist);
    expect(result.glitches).toEqual([]);
  });

  it("and they are the SAME FUNCTION — which is the entire point", () => {
    const table = (id: string): number[] => {
      const preset = PRESETS.find((p) => p.id === id)!;
      const { netlist } = elaborate(buildPreset(preset));
      const port = netlist.outputs[0]!;
      return Array.from({ length: 8 }, (_, m) => {
        const inputs = netlist.inputs.map(
          (p) =>
            ((m >>> (2 - preset.variables.indexOf(p.label))) & 1) as 0 | 1,
        );
        return evaluate(netlist, inputs).values[port.net] as number;
      });
    };

    expect(table("hazard")).toEqual(table("hazard-free"));
  });
});

describe("mux4 truth table — all 64 rows (LAB-07)", () => {
  it("evaluates correctly according to select lines across all 64 combinations", () => {
    const preset = PRESETS.find((p) => p.id === "mux4")!;
    const { netlist } = elaborate(buildPreset(preset));
    const port = netlist.outputs.find((o) => o.label === "Y")!;

    for (let s1 = 0; s1 <= 1; s1++) {
      for (let s0 = 0; s0 <= 1; s0++) {
        for (let d0 = 0; d0 <= 1; d0++) {
          for (let d1 = 0; d1 <= 1; d1++) {
            for (let d2 = 0; d2 <= 1; d2++) {
              for (let d3 = 0; d3 <= 1; d3++) {
                const valMap: Record<string, 0 | 1> = {
                  S1: s1 as 0 | 1,
                  S0: s0 as 0 | 1,
                  D0: d0 as 0 | 1,
                  D1: d1 as 0 | 1,
                  D2: d2 as 0 | 1,
                  D3: d3 as 0 | 1,
                };
                const inputs = netlist.inputs.map((p) => valMap[p.label] ?? (0 as const));
                const state = evaluate(netlist, inputs);
                const expected = s1 === 0 ? (s0 === 0 ? d0 : d1) : s0 === 0 ? d2 : d3;
                expect(state.values[port.net]).toBe(expected);
              }
            }
          }
        }
      }
    }
  });
});

