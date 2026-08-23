import { format, fromTruthValues, minimize, type TruthValue } from "@/lib/core-engine";
import { synthesize as toGates, technologyMap } from "@/lib/simulation/synth";
import type { GateNetlist } from "@/lib/simulation/synth";
import { toFunction, type FunctionSpec } from "../builders/kit";
import { decisionTree, muxResidues, type DecisionNode } from "../builders/logic";
import type { DiagramTheme } from "../theme";
import type { DiagramGateOp } from "../types";
import { Assembler } from "./assemble";
import { portsOf, type EditorDocument } from "./document";
import { pInt } from "./parts";

/**
 * From an equation to blocks you can then edit.
 *
 * The catalogue already turns a function into a PICTURE. This turns it into a
 * DOCUMENT: real instances of real parts, wired with the same `connect()` the
 * canvas uses, so what comes out can be dragged, re-parameterised, grouped and
 * extended. That difference is the whole reason this file exists rather than
 * importing a `Diagram` and drawing it — an imported picture is something to
 * look at, and the builder's job is to give you something to work on.
 *
 * The five implementations are not styles. They are five different answers, and
 * which one is right depends on what you are allowed to use.
 */

export type Implementation = "gates" | "nand" | "nor" | "decoder" | "mux" | "muxtree";

export interface ImplementationInfo {
  readonly id: Implementation;
  readonly name: string;
  readonly summary: string;
}

export const IMPLEMENTATIONS: readonly ImplementationInfo[] = [
  {
    id: "gates",
    name: "Gates",
    summary: "The minimal sum of products, as ordinary gates. The fewest gates.",
  },
  {
    id: "nand",
    name: "NAND only",
    summary: "Every gate rewritten by De Morgan. Usually the fewest chips.",
  },
  { id: "nor", name: "NOR only", summary: "The exact dual of the NAND construction." },
  {
    id: "decoder",
    name: "Decoder + OR",
    summary:
      "A decoder generates every minterm; each output is an OR of its rows. One decoder serves any number of outputs.",
  },
  {
    id: "mux",
    name: "One multiplexer",
    summary:
      "Shannon expansion: n−1 variables select, and each data input is 0, 1, the last variable or its complement.",
  },
  {
    id: "muxtree",
    name: "2-to-1 multiplexer tree",
    summary: "A reduced decision tree. No gates at all — not even an inverter.",
  },
];

export interface SynthesisResult {
  readonly doc: EditorDocument;
  readonly notes: readonly string[];
}

export type SynthesisOutcome =
  | { readonly ok: true; readonly value: SynthesisResult }
  | { readonly ok: false; readonly reason: string };

const PIN = "ABCDEFGHIJKLMNOP";

/**
 * Lay a synthesized gate netlist into the document.
 *
 * The three degenerate cases are the ones worth naming: a constant function has
 * no gates and needs a tie-off, an output that IS an input is a wire, and both
 * are real answers that a "there is always a driving gate" assumption draws as a
 * dangling pin.
 */
function emitNetlist(
  a: Assembler,
  nl: GateNetlist,
  sourceOf: (variable: string) => [string, string],
  prefix: string,
): [string, string] {
  if (nl.constant !== null) {
    const k = a.add("constant", 0, 0, { value: String(nl.constant) });
    return [k, "Y"];
  }

  const driver = new Map<number, [string, string]>();
  for (const input of nl.inputs) driver.set(input.signal, sourceOf(input.name));

  for (const gate of nl.gates) {
    const arity = gate.op === "not" || gate.op === "buf" ? 1 : gate.inputs.length;
    const id = a.add("gate", 0, 0, {
      op: gate.op as DiagramGateOp,
      inputs: Math.max(2, arity),
    });
    driver.set(gate.output, [id, "Y"]);
  }

  for (const gate of nl.gates) {
    const target = driver.get(gate.output);
    if (!target) continue;
    gate.inputs.forEach((signal, i) => {
      const from = driver.get(signal);
      const pin = PIN[i];
      if (from && pin) a.wire(from, [target[0], pin]);
    });
  }

  const out = driver.get(nl.outputSignal);
  if (out) return out;
  const fallback = a.add("constant", 0, 0, { value: "0" });
  void prefix;
  return [fallback, "Y"];
}

// ---------------------------------------------------------------------------

export function buildImplementation(
  specs: readonly FunctionSpec[],
  implementation: Implementation,
  theme: DiagramTheme,
  options: { readonly selectBits?: number } = {},
): SynthesisOutcome {
  const first = specs[0];
  if (!first) return { ok: false, reason: "There is nothing to build." };
  const variables = first.variables;
  const n = variables.length;

  const title =
    specs.length === 1 ? `${first.name} — ${implementation}` : `${specs.length} outputs`;
  const a = new Assembler(title);
  const notes: string[] = [];

  // One input tag per variable, shared by every output. Made lazily so a
  // variable the function does not actually depend on does not appear as a
  // floating tag with nothing attached to it.
  const tags = new Map<string, [string, string]>();
  const tagOf = (v: string): [string, string] => {
    const hit = tags.get(v);
    if (hit) return hit;
    const id = a.add("input", 0, 0, { label: v });
    const ep: [string, string] = [id, "Y"];
    tags.set(v, ep);
    return ep;
  };
  const inverters = new Map<string, [string, string]>();
  const notOf = (v: string): [string, string] => {
    const hit = inverters.get(v);
    if (hit) return hit;
    const id = a.add("gate", 0, 0, { op: "not", title: `${v}'` });
    a.wire(tagOf(v), [id, "A"]);
    const ep: [string, string] = [id, "Y"];
    inverters.set(v, ep);
    return ep;
  };

  try {
    switch (implementation) {
      case "gates":
      case "nand":
      case "nor": {
        const strategy =
          implementation === "nand" ? "nand-only" : implementation === "nor" ? "nor-only" : "mixed";
        specs.forEach((spec, i) => {
          const fn = toFunction(spec);
          const min = minimize(fn, "sop");
          notes.push(`${spec.name} = ${format(min.expression)}`);
          const nl = toGates(min.expression, variables);
          const mapped = technologyMap(nl, strategy);
          const driver = emitNetlist(a, mapped.netlist, tagOf, `f${i}_`);
          const out = a.add("output", 0, 0, { label: spec.name });
          a.wire(driver, [out, "A"]);
        });
        if (implementation === "nand") {
          notes.push(
            "AND is a NAND then an inverter, OR is a NAND of the complements, and an inverter is a NAND with its inputs tied — so a NAND-only design usually needs no separate 7404.",
          );
        }
        break;
      }

      case "decoder": {
        const dec = a.add("decoder", 0, 0, { addr: n, enable: true });
        // variables[0] is the MSB, so it drives the decoder's highest address
        // line. Wiring these alphabetically instead is how a correct design gets
        // drawn as a wrong one.
        variables.forEach((v, i) => a.wire(tagOf(v), [dec, `A${n - 1 - i}`]));
        const enable = a.add("constant", 0, 0, { value: "1" });
        a.wire([enable, "Y"], [dec, "E"]);

        for (const spec of specs) {
          const rows = [...spec.minterms].sort((x, y) => x - y);
          const out = a.add("output", 0, 0, { label: spec.name });
          if (rows.length === 0) {
            const zero = a.add("constant", 0, 0, { value: "0" });
            a.wire([zero, "Y"], [out, "A"]);
            continue;
          }
          if (rows.length === 1) {
            a.wire([dec, `Y${rows[0]}`], [out, "A"]);
            continue;
          }
          const or = a.add("gate", 0, 0, { op: "or", inputs: rows.length, title: spec.name });
          rows.forEach((m, i) => {
            const pin = PIN[i];
            if (pin) a.wire([dec, `Y${m}`], [or, pin]);
          });
          a.wire([or, "Y"], [out, "A"]);
        }
        notes.push(
          "A decoder output IS a minterm, so every function is an OR of the rows where it is 1 — and one decoder serves all of them.",
        );
        break;
      }

      case "mux": {
        const k = Math.max(1, Math.min(options.selectBits ?? n - 1, Math.min(n, 4)));
        for (const spec of specs) {
          wireMultiplexer(a, spec, k, tagOf, notOf, notes);
        }
        notes.push(
          `Select lines take ${variables.slice(0, k).join(", ")}; each data input is what is left of the function once those are fixed.`,
        );
        break;
      }

      case "muxtree": {
        for (const spec of specs) {
          const { root, tests } = decisionTree(spec);
          const konst = new Map<0 | 1, [string, string]>();
          const constOf = (value: 0 | 1): [string, string] => {
            const hit = konst.get(value);
            if (hit) return hit;
            const id = a.add("constant", 0, 0, { value: String(value) });
            const ep: [string, string] = [id, "Y"];
            konst.set(value, ep);
            return ep;
          };
          const emit = (node: DecisionNode): [string, string] => {
            if (node.kind === "const") return constOf(node.value);
            const id = a.add("mux", 0, 0, { sel: 1, title: "2:1", subtitle: " " });
            a.wire(emit(node.lo), [id, "D0"]);
            a.wire(emit(node.hi), [id, "D1"]);
            a.wire(tagOf(variables[node.level] as string), [id, "S0"]);
            return [id, "Y"];
          };
          const out = a.add("output", 0, 0, { label: spec.name });
          a.wire(emit(root), [out, "A"]);
          notes.push(
            `${spec.name}: ${tests} multiplexer${tests === 1 ? "" : "s"}, reduced from a worst case of ${(1 << n) - 1}. No gates at all — I0 = 1 with I1 = 0 is a complement.`,
          );
        }
        break;
      }
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true, value: { doc: a.arrange(theme), notes } };
}

/**
 * Wire one multiplexer to implement one function.
 *
 * Shared by "build me a mux implementation" and by "wire up the mux I already
 * placed", which is the same operation seen from two directions — and the reason
 * the residue classification lives in one place.
 */
function wireMultiplexer(
  a: Assembler,
  spec: FunctionSpec,
  selectBits: number,
  tagOf: (v: string) => [string, string],
  notOf: (v: string) => [string, string],
  notes: string[],
  existing?: string,
): void {
  const variables = spec.variables;
  const rest = variables.slice(selectBits);
  const mx = existing ?? a.add("mux", 0, 0, { sel: selectBits });

  for (let i = 0; i < selectBits; i++) {
    a.wire(tagOf(variables[i] as string), [mx, `S${selectBits - 1 - i}`]);
  }

  muxResidues(spec, selectBits).forEach((row, j) => {
    const r = row.residue;
    let driver: [string, string];
    if (r.kind === "const") {
      const id = a.add("constant", 0, 0, { value: String(r.value) });
      driver = [id, "Y"];
    } else if (r.kind === "var") {
      driver = r.complemented ? notOf(r.name) : tagOf(r.name);
    } else {
      const sub = fromTruthValues(rest, r.values as TruthValue[], `d${j}`);
      if (!sub.ok) {
        const id = a.add("constant", 0, 0, { value: "0" });
        driver = [id, "Y"];
      } else {
        const min = minimize(sub.value, "sop");
        const nl = toGates(min.expression, rest);
        driver = emitNetlist(a, technologyMap(nl, "mixed").netlist, tagOf, `d${j}_`);
      }
    }
    a.wire(driver, [mx, `D${j}`]);
    notes.push(
      `I${j} (${variables.slice(0, selectBits).join("")} = ${row.select}) = ${
        r.kind === "const"
          ? r.value
          : r.kind === "var"
            ? `${r.name}${r.complemented ? "'" : ""}`
            : r.text
      }`,
    );
  });

  if (!existing) {
    const out = a.add("output", 0, 0, { label: spec.name });
    a.wire([mx, "Y"], [out, "A"]);
  }
}

export { wireMultiplexer };

// ---------------------------------------------------------------------------
// Auto-wiring a component the user has already placed
// ---------------------------------------------------------------------------

export type AutoWireOutcome =
  | {
      readonly ok: true;
      readonly doc: EditorDocument;
      readonly ids: readonly string[];
      readonly notes: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** Which parts know how to implement an arbitrary function on their own. */
export const AUTO_WIRABLE = new Set(["decoder", "mux"]);

/**
 * Wire the selected block up to implement a function.
 *
 * The same synthesis as `buildImplementation`, aimed at a block that is already
 * on the canvas — you place a 3-to-8 decoder, hand it a truth table, and it
 * grows the input tags, the collecting gates and the outputs around itself.
 *
 * IT REFUSES RATHER THAN RESHAPES. If the decoder has three address lines and
 * the function has four variables, the honest answers are "widen the decoder" or
 * "use a different function" — silently changing the part the user placed is the
 * tool overruling a decision that was deliberate. So it says which, and by how
 * much.
 *
 * Pins that are ALREADY wired are left alone. Auto-wiring is meant to finish a
 * circuit somebody started, and re-driving a pin they had connected on purpose
 * would be the feature undoing their work.
 */
export function autoWire(
  doc: EditorDocument,
  instanceId: string,
  specs: readonly FunctionSpec[],
): AutoWireOutcome {
  const instance = doc.instances[instanceId];
  if (!instance) return { ok: false, reason: "That block is no longer on the canvas." };
  if (!AUTO_WIRABLE.has(instance.part)) {
    return {
      ok: false,
      reason:
        "Select a decoder or a multiplexer. Those are the two parts that implement a function on their own; for anything else, build the circuit and it will be wired for you.",
    };
  }

  const first = specs[0];
  if (!first) return { ok: false, reason: "There is nothing to build." };
  const variables = first.variables;
  const n = variables.length;

  const a = Assembler.wrapping(doc);
  const before = new Set(Object.keys(doc.instances));
  const notes: string[] = [];

  const tags = new Map<string, [string, string]>();
  let tagRow = 0;
  const tagOf = (v: string): [string, string] => {
    const hit = tags.get(v);
    if (hit) return hit;
    const id = a.add("input", instance.x - 280, instance.y + tagRow * 64, { label: v });
    tagRow += 1;
    const ep: [string, string] = [id, "Y"];
    tags.set(v, ep);
    return ep;
  };
  const inverters = new Map<string, [string, string]>();
  const notOf = (v: string): [string, string] => {
    const hit = inverters.get(v);
    if (hit) return hit;
    const id = a.add("gate", instance.x - 140, instance.y + tagRow * 64, {
      op: "not",
      title: `${v}'`,
    });
    a.wire(tagOf(v), [id, "A"]);
    const ep: [string, string] = [id, "Y"];
    inverters.set(v, ep);
    return ep;
  };

  try {
    if (instance.part === "decoder") {
      const addr = pInt(instance.values, "addr", 2);
      if (addr !== n) {
        return {
          ok: false,
          reason: `This decoder has ${addr} address line${addr === 1 ? "" : "s"}, and ${first.name} has ${n} variable${n === 1 ? "" : "s"}. Set the decoder's address lines to ${n}, or give it a ${addr}-variable function.`,
        };
      }

      variables.forEach((v, i) => {
        a.wireIfFree(tagOf(v), [instanceId, `A${addr - 1 - i}`]);
      });
      if (!a.wired(instanceId, "E") && hasPort(doc, instanceId, "E")) {
        const enable = a.add("constant", instance.x - 140, instance.y + tagRow * 64 + 40, {
          value: "1",
        });
        a.wire([enable, "Y"], [instanceId, "E"]);
      }

      specs.forEach((spec, index) => {
        const rows = [...spec.minterms].sort((x, y) => x - y);
        const y = instance.y + index * 140;
        const out = a.add("output", instance.x + 460, y, { label: spec.name });
        if (rows.length === 0) {
          const zero = a.add("constant", instance.x + 260, y, { value: "0" });
          a.wire([zero, "Y"], [out, "A"]);
          return;
        }
        if (rows.length === 1) {
          a.wire([instanceId, `Y${rows[0]}`], [out, "A"]);
          return;
        }
        const or = a.add("gate", instance.x + 260, y, {
          op: "or",
          inputs: rows.length,
          title: spec.name,
        });
        rows.forEach((m, i) => {
          const pin = PIN[i];
          if (pin) a.wire([instanceId, `Y${m}`], [or, pin]);
        });
        a.wire([or, "Y"], [out, "A"]);
        notes.push(`${spec.name} = OR of Y${rows.join(", Y")}`);
      });
      notes.push(
        "A decoder output IS a minterm, so each function is an OR of the rows where it is 1 — and this one decoder serves every output you add.",
      );
    } else {
      const sel = pInt(instance.values, "sel", 2);
      if (sel > n) {
        return {
          ok: false,
          reason: `This multiplexer has ${sel} select lines but ${first.name} only has ${n} variable${n === 1 ? "" : "s"}. Reduce the select lines to ${Math.max(1, n - 1)}, or use a function of more variables.`,
        };
      }
      if (specs.length > 1) {
        notes.push(
          `A multiplexer has one output, so only ${first.name} was wired. Add another multiplexer for the rest.`,
        );
      }
      wireMultiplexer(a, first, sel, tagOf, notOf, notes, instanceId);
      if (!a.wired(instanceId, "Y")) {
        const out = a.add("output", instance.x + 300, instance.y, { label: first.name });
        a.wire([instanceId, "Y"], [out, "A"]);
      }
      if (sel < n - 1) {
        notes.push(
          `With ${sel} select line${sel === 1 ? "" : "s"} the data inputs are functions of ${n - sel} variables, so some of them need gates. A ${n - 1}-select multiplexer would need none.`,
        );
      }
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  return {
    ok: true,
    doc: a.doc,
    ids: Object.keys(a.doc.instances).filter((id) => !before.has(id)),
    notes,
  };
}

const hasPort = (doc: EditorDocument, instanceId: string, port: string): boolean => {
  const instance = doc.instances[instanceId];
  return instance ? portsOf(doc, instance).some((p) => p.id === port) : false;
};
