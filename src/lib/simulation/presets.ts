import { realize, synthesize, technologyMap, type Strategy } from "./synth";
import { parse } from "@/lib/core-engine/parser";
import type { CircuitDocument } from "./netlist";

/**
 * Preset macro-circuits.
 *
 * Deliberately defined as EXPRESSIONS and run through the same synthesizer the
 * "Build it" button uses, rather than hand-placed as node/wire literals. Two
 * reasons: they cannot drift away from the synthesizer's behaviour, and every
 * one of them is automatically available in all three gate families.
 */

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Each output of the macro-circuit, as an expression over `variables`. */
  readonly outputs: readonly { readonly label: string; readonly expr: string }[];
  readonly variables: readonly string[];
  /** The lesson this one is for, shown under the name. */
  readonly note?: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "half-adder",
    name: "Half adder",
    description: "Sum and carry of two bits.",
    variables: ["A", "B"],
    outputs: [
      { label: "S", expr: "A ^ B" },
      { label: "C", expr: "A * B" },
    ],
  },
  {
    id: "full-adder",
    name: "Full adder",
    description: "Adds two bits plus a carry-in.",
    variables: ["A", "B", "C"],
    outputs: [
      { label: "S", expr: "A ^ B ^ C" },
      { label: "K", expr: "A*B + B*C + A*C" },
    ],
  },
  {
    id: "comparator",
    name: "2-bit comparator",
    description: "Is A greater than B? (A1A0 vs B1B0)",
    variables: ["A1", "A0", "B1", "B0"],
    outputs: [{ label: "G", expr: "A1*B1' + A0*B1'*B0' + A1*A0*B0'" }],
  },
  {
    id: "mux2",
    name: "2-to-1 multiplexer",
    description: "Selects input A or B according to S.",
    variables: ["S", "A", "B"],
    outputs: [{ label: "Y", expr: "S'*A + S*B" }],
  },
  {
    id: "mux4",
    name: "4-to-1 multiplexer",
    description: "One of four data lines, chosen by two select bits.",
    variables: ["S1", "S0", "D0", "D1"],
    outputs: [{ label: "Y", expr: "S1'*S0'*D0 + S1'*S0*D1" }],
  },
  {
    id: "decoder",
    name: "2-to-4 decoder",
    description: "Exactly one of four outputs goes high.",
    variables: ["A", "B"],
    outputs: [
      { label: "Y0", expr: "A'*B'" },
      { label: "Y1", expr: "A'*B" },
      { label: "Y2", expr: "A*B'" },
      { label: "Y3", expr: "A*B" },
    ],
  },
  {
    id: "encoder",
    name: "4-to-2 priority encoder",
    description: "Encodes the highest-priority active input.",
    variables: ["D3", "D2", "D1", "D0"],
    outputs: [
      { label: "Q1", expr: "D3 + D2" },
      { label: "Q0", expr: "D3 + D2'*D1" },
    ],
  },
  {
    id: "hazard",
    name: "Static-1 hazard",
    description: "The minimal SOP A·C' + B·C.",
    variables: ["A", "B", "C"],
    outputs: [{ label: "F", expr: "A*C' + B*C" }],
    note: "Open the waveform panel: F glitches when C falls with A=B=1, even though the logic is correct. This is a MINIMAL cover — and minimal is not the same as hazard-free.",
  },
  {
    id: "hazard-free",
    name: "Static-1 hazard, cured",
    description: "The same function, plus the redundant consensus term A·B.",
    variables: ["A", "B", "C"],
    outputs: [{ label: "F", expr: "A*C' + B*C + A*B" }],
    note: "The same function as above — Quine–McCluskey discards A·B precisely because it is redundant. It is redundant in the steady state, not in time: it holds F high while the other two terms hand over, and the glitch disappears.",
  },
] as const;

/**
 * Build a preset by running each of its outputs through the real synthesizer and
 * merging the results onto one board, sharing the input switches.
 */
export function buildPreset(
  preset: Preset,
  strategy: Strategy = "mixed",
): CircuitDocument {
  const nodes: Record<string, CircuitDocument["nodes"][string]> = {};
  const wires: Record<string, CircuitDocument["wires"][string]> = {};

  let column = 0;
  for (const output of preset.outputs) {
    const parsed = parse(output.expr);
    if (!parsed.ok) continue;

    const nl = synthesize(parsed.value.ast, preset.variables);
    const doc = realize(technologyMap(nl, strategy), {
      outputLabel: output.label,
    });

    // Namespace each sub-circuit's ids so several can coexist on one board, and
    // stack them vertically so they do not overlap.
    const dy = column * 320;
    const prefix = `${preset.id}_${output.label}_`;

    for (const [id, node] of Object.entries(doc.nodes)) {
      // The input switches are SHARED — every output reads the same A, B, C.
      // Keep the first sub-circuit's switches and drop the rest, rewiring to them.
      if (node.kind === "switch" && column > 0) continue;

      const newId = node.kind === "switch" ? `${preset.id}_sw_${node.label}` : prefix + id;
      nodes[newId] = {
        ...node,
        id: newId as typeof node.id,
        pos: { x: node.pos.x, y: node.pos.y + (node.kind === "switch" ? 0 : dy) },
      };
    }

    for (const [id, wire] of Object.entries(doc.wires)) {
      const remap = (ref: { node: string; pin: string }) => {
        const node = doc.nodes[ref.node];
        return {
          node: (node?.kind === "switch"
            ? `${preset.id}_sw_${node.label}`
            : prefix + ref.node) as typeof wire.a.node,
          pin: ref.pin,
        };
      };
      const newId = (prefix + id) as typeof wire.id;
      wires[newId] = { id: newId, a: remap(wire.a), b: remap(wire.b) };
    }

    column += 1;
  }

  return { nodes, wires };
}

export const getPreset = (id: string): Preset | undefined =>
  PRESETS.find((p) => p.id === id);
