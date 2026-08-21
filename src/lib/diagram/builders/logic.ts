import {
  DONT_CARE,
  evaluate,
  format,
  fromTruthValues,
  minimize,
  parse,
  type TruthValue,
} from "@/lib/core-engine";
import { synthesize, technologyMap, type GateNetlist, type Strategy } from "@/lib/simulation/synth";
import type { GateOp } from "@/lib/simulation/logic";
import * as C from "../catalog";
import type { Diagram, DiagramGateOp, Endpoint } from "../types";
import { Sketch, at, toFunction, type FunctionSpec } from "./kit";

/**
 * From a Boolean function to a picture of a circuit, three ways.
 *
 * These three are not stylistic alternatives — they are three different exam
 * answers to three different questions, and the whole point is that they come
 * from the SAME function object:
 *
 *   gateLevel  — "design a logic circuit for …"           (Q5, Q6, Q7, Q8, Q13)
 *   decoder    — "implement f1, f2, f3 with a decoder …"  (Q18, Q41, Q44)
 *   mux        — "implement f using an 8-to-1 mux …"      (Q43, Q45, Q46)
 *
 * The gate-level path deliberately runs through the LAB's synthesizer
 * (`synthesize` then `technologyMap`), not a private one. That is what
 * guarantees the drawing here and the board the lab builds are the same circuit
 * — including the NAND-only rewrite, which is Q5's entire content. A second
 * synthesizer would be a second opinion, and the two would drift.
 */

const GATE_INPUT_NAMES = "ABCDEFGHIJKLMNOP";

/**
 * Lay a synthesized gate netlist into the sketch and return whatever drives its
 * output — a gate, an input tag, or a constant.
 *
 * The three degenerate returns matter more than they look. `F = 1` and `F = A`
 * are real answers to real questions, and a builder that assumed "the output is
 * always driven by a gate" draws a floating wire for both.
 */
function emitNetlist(
  s: Sketch,
  nl: GateNetlist,
  sourceOf: (variable: string) => Endpoint,
  prefix: string,
): Endpoint {
  if (nl.constant !== null) {
    const id = s.add(C.constant(`${prefix}k`, nl.constant));
    return at(id, "Y");
  }

  const driver = new Map<number, Endpoint>();
  for (const input of nl.inputs) driver.set(input.signal, sourceOf(input.name));

  for (const g of nl.gates) {
    const arity = g.op === "not" || g.op === "buf" ? 1 : g.inputs.length;
    const id = s.add(C.gate(`${prefix}g${g.id}`, g.op as DiagramGateOp, arity));
    driver.set(g.output, at(id, "Y"));
  }

  for (const g of nl.gates) {
    const id = `${prefix}g${g.id}`;
    g.inputs.forEach((signal, i) => {
      const from = driver.get(signal);
      const pin = GATE_INPUT_NAMES[i];
      if (from && pin) s.wire(from, at(id, pin));
    });
  }

  const out = driver.get(nl.outputSignal);
  if (out) return out;
  // Unreachable for a well-formed netlist, but a missing wire is worse than a
  // visible tie-off, so fail loudly in the drawing rather than silently.
  const id = s.add(C.constant(`${prefix}k`, 0));
  return at(id, "Y");
}

export interface GateDiagramOptions {
  readonly id: string;
  readonly title: string;
  readonly caption?: string;
  /** `"mixed"` uses whatever gate is cheapest; `"nand-only"` is Q5's rule. */
  readonly strategy?: Strategy;
  readonly allowed?: readonly GateOp[];
  /** Print each output's minimal expression as a note under the drawing. */
  readonly showExpressions?: boolean;
}

/**
 * The minimal SOP of each function, drawn as gates, in one shared input rail.
 *
 * Multi-output on purpose: a squarer has six outputs and a 2's complementer has
 * four, and drawing them as six separate figures loses the one fact worth seeing
 * — that they share their inputs and, after hash-consing, some of their gates.
 */
export function gateLevelDiagram(
  specs: readonly FunctionSpec[],
  opts: GateDiagramOptions,
): Diagram {
  const s = new Sketch();
  const first = specs[0];
  if (!first) return s.done({ id: opts.id, title: opts.title });
  const variables = first.variables;

  const inputs = new Map<string, Endpoint>();
  for (const v of variables) {
    const id = s.add(C.input(`in_${v}`, v));
    inputs.set(v, at(id, "Y"));
  }
  const sourceOf = (v: string): Endpoint =>
    inputs.get(v) ?? at(`in_${v}`, "Y");

  const expressions: string[] = [];

  specs.forEach((spec, k) => {
    const fn = toFunction(spec);
    const min = minimize(fn, "sop");
    expressions.push(`${spec.name} = ${format(min.expression)}`);

    const nl = synthesize(min.expression, variables);
    const mapped = technologyMap(nl, opts.strategy ?? "mixed", opts.allowed);
    const driver = emitNetlist(s, mapped.netlist, sourceOf, `f${k}_`);

    const outId = s.add(C.output(`out_${spec.name}`, spec.name));
    s.wire(driver, at(outId, "A"));
  });

  if (opts.showExpressions !== false) for (const e of expressions) s.note(e);

  return s.done({
    id: opts.id,
    title: opts.title,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- decoder implementation -------------------------------------------------

export interface DecoderDiagramOptions {
  readonly id: string;
  readonly title: string;
  readonly caption?: string;
  /**
   * A real 74138 has ACTIVE-LOW outputs, and that flips the collecting gate from
   * OR to NAND. Getting this wrong inverts every output — and it is the single
   * most common mistake in a decoder answer, so it is a first-class option
   * rather than something the builder guesses.
   */
  readonly activeLowOutputs?: boolean;
  readonly enable?: boolean;
  readonly decoderTitle?: string;
}

export function decoderImplementation(
  specs: readonly FunctionSpec[],
  opts: DecoderDiagramOptions,
): Diagram {
  const s = new Sketch();
  const first = specs[0];
  if (!first) return s.done({ id: opts.id, title: opts.title });

  const variables = first.variables;
  const n = variables.length;
  const low = opts.activeLowOutputs === true;

  const dec = s.add(
    C.decoder("DEC", n, {
      enable: opts.enable === true,
      outputsActiveLow: low,
      ...(opts.decoderTitle !== undefined ? { title: opts.decoderTitle } : {}),
    }),
  );

  // variables[0] is the MSB (see AGENTS.md), so it drives the decoder's highest
  // address line. Wiring these in alphabetical order instead is how a correct
  // design gets drawn as a wrong one.
  variables.forEach((v, i) => {
    const tag = s.add(C.input(`in_${v}`, v));
    s.wire(at(tag, "Y"), at(dec, `A${n - 1 - i}`));
  });
  if (opts.enable) {
    const en = s.add(C.constant("dec_en", 1));
    s.wire(at(en, "Y"), at(dec, "E"));
  }

  specs.forEach((spec, k) => {
    const rows = [...spec.minterms].sort((a, b) => a - b);
    const outId = s.add(C.output(`out_${spec.name}`, spec.name));

    if (rows.length === 0) {
      const z = s.add(C.constant(`z${k}`, 0));
      s.wire(at(z, "Y"), at(outId, "A"));
      return;
    }
    if (rows.length === 1) {
      const only = rows[0] as number;
      if (low) {
        // One active-low line still needs an inverter to become the function.
        const inv = s.add(C.gate(`inv${k}`, "not", 1));
        s.wire(at(dec, `Y${only}`), at(inv, "A"));
        s.wire(at(inv, "Y"), at(outId, "A"));
      } else {
        s.wire(at(dec, `Y${only}`), at(outId, "A"));
      }
      return;
    }

    const op: DiagramGateOp = low ? "nand" : "or";
    const g = s.add(C.gate(`col${k}`, op, rows.length, spec.name));
    rows.forEach((m, i) => {
      const pin = GATE_INPUT_NAMES[i];
      if (pin) s.wire(at(dec, `Y${m}`), at(g, pin));
    });
    s.wire(at(g, "Y"), at(outId, "A"));
  });

  s.note(
    low
      ? "Active-low outputs, so the minterms are collected with NAND: NAND of the complemented minterms is their OR."
      : "A decoder output IS a minterm. Every function is then just an OR of the rows where it is 1.",
  );
  for (const spec of specs) {
    s.note(`${spec.name} = Σm(${[...spec.minterms].sort((a, b) => a - b).join(", ")})`);
  }

  const half = 1 << (n - 1);
  const heavy = specs.filter((sp) => sp.minterms.length > half);
  if (heavy.length > 0) {
    s.note(
      `${heavy.map((h) => h.name).join(", ")} has more 1s than 0s — a NOR over the ZERO rows needs fewer inputs and is the same function.`,
    );
  }

  return s.done({
    id: opts.id,
    title: opts.title,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- multiplexer implementation ---------------------------------------------

export interface MuxDiagramOptions {
  readonly id: string;
  readonly title: string;
  readonly caption?: string;
  /** How many of the variables go to the select lines. The rest become data. */
  readonly selectBits: number;
}

/** What one data input of the mux turns out to be, once the residue is read off. */
export type Residue =
  | { readonly kind: "const"; readonly value: 0 | 1 }
  | { readonly kind: "var"; readonly name: string; readonly complemented: boolean }
  | { readonly kind: "expr"; readonly text: string; readonly values: readonly TruthValue[] };

/**
 * Shannon expansion, read off the truth table.
 *
 * Fix the k select variables to a value; what is left is a function of the other
 * n-k. That residue IS what you tie to that data input, and for the classic
 * exam version (k = n-1) it can only ever be one of four things: 0, 1, the last
 * variable, or its complement. That is the whole trick, and it is why an 8-to-1
 * mux implements ANY four-variable function with at most one inverter.
 *
 * DON'T-CARES ARE MATCHED PERMISSIVELY. A row the function does not care about
 * must not be allowed to veto `residue = D`, or the answer grows gates it does
 * not need — which is exactly the simplification the question is testing.
 */
export function residueOf(
  values: readonly TruthValue[],
  restVariables: readonly string[],
): Residue {
  const m = restVariables.length;
  const defined = values.filter((v) => v !== DONT_CARE);

  if (defined.every((v) => v === 0)) return { kind: "const", value: 0 };
  if (defined.every((v) => v === 1)) return { kind: "const", value: 1 };

  for (let t = 0; t < m; t++) {
    // restVariables[t] is the MSB-th of the remaining variables, so its bit
    // inside the residue index r is at position m-1-t. Same contract as always.
    const shift = m - 1 - t;
    let direct = true;
    let inverted = true;
    for (let r = 0; r < values.length; r++) {
      const v = values[r] as TruthValue;
      if (v === DONT_CARE) continue;
      const bit = (r >>> shift) & 1;
      if (v !== bit) direct = false;
      if (v === bit) inverted = false;
    }
    const name = restVariables[t] as string;
    if (direct) return { kind: "var", name, complemented: false };
    if (inverted) return { kind: "var", name, complemented: true };
  }

  const fn = fromTruthValues(restVariables, values as TruthValue[], "d");
  const text = fn.ok ? format(minimize(fn.value, "sop").expression) : "?";
  return { kind: "expr", text, values: [...values] };
}

export function muxImplementation(
  spec: FunctionSpec,
  opts: MuxDiagramOptions,
): Diagram {
  const s = new Sketch();
  const variables = spec.variables;
  const n = variables.length;
  const k = Math.max(1, Math.min(opts.selectBits, n));
  const rest = variables.slice(k);
  const m = rest.length;

  const fn = toFunction(spec);
  const values = Array.from(fn.values) as TruthValue[];

  const mx = s.add(C.mux("MUX", k));

  // Inputs are made once and shared: the select variables AND any variable that
  // turns out to be a data input feed from the same tag.
  const tag = new Map<string, Endpoint>();
  const tagOf = (v: string): Endpoint => {
    const hit = tag.get(v);
    if (hit) return hit;
    const id = s.add(C.input(`in_${v}`, v));
    const e = at(id, "Y");
    tag.set(v, e);
    return e;
  };
  const inverter = new Map<string, Endpoint>();
  const notOf = (v: string): Endpoint => {
    const hit = inverter.get(v);
    if (hit) return hit;
    const id = s.add(C.gate(`inv_${v}`, "not", 1, `${v}'`));
    s.wire(tagOf(v), at(id, "A"));
    const e = at(id, "Y");
    inverter.set(v, e);
    return e;
  };

  // Select lines: variables[0] is the MSB and drives the highest select input.
  for (let i = 0; i < k; i++) {
    const v = variables[i] as string;
    s.wire(tagOf(v), at(mx, `S${k - 1 - i}`));
  }

  const residues: Residue[] = [];
  const width = 1 << m;
  for (let j = 0; j < 1 << k; j++) {
    const slice = values.slice(j * width, (j + 1) * width);
    const res = residueOf(slice, rest);
    residues.push(res);

    let driver: Endpoint;
    switch (res.kind) {
      case "const": {
        const id = s.add(C.constant(`k${j}`, res.value));
        driver = at(id, "Y");
        break;
      }
      case "var":
        driver = res.complemented ? notOf(res.name) : tagOf(res.name);
        break;
      case "expr": {
        const sub = fromTruthValues(rest, res.values as TruthValue[], `d${j}`);
        if (!sub.ok) {
          const id = s.add(C.constant(`k${j}`, 0));
          driver = at(id, "Y");
          break;
        }
        const min = minimize(sub.value, "sop");
        const nl = synthesize(min.expression, rest);
        driver = emitNetlist(s, technologyMap(nl, "mixed").netlist, tagOf, `d${j}_`);
        break;
      }
    }
    s.wire(driver, at(mx, `D${j}`));
  }

  const out = s.add(C.output(`out_${spec.name}`, spec.name));
  s.wire(at(mx, "Y"), at(out, "A"));

  s.note(
    `Select lines take ${variables.slice(0, k).join(", ")}; each data input is what is left of ${spec.name} once those are fixed.`,
  );
  residues.forEach((r, j) => {
    const text =
      r.kind === "const"
        ? String(r.value)
        : r.kind === "var"
          ? `${r.name}${r.complemented ? "'" : ""}`
          : r.text;
    s.note(`I${j}  (${variables.slice(0, k).join("")} = ${j.toString(2).padStart(k, "0")})  =  ${text}`);
  });

  return s.done({
    id: opts.id,
    title: opts.title,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

/** The residues on their own, for the table the answer has to show. */
export function muxResidues(
  spec: FunctionSpec,
  selectBits: number,
): { readonly select: string; readonly residue: Residue }[] {
  const variables = spec.variables;
  const k = Math.max(1, Math.min(selectBits, variables.length));
  const rest = variables.slice(k);
  const values = Array.from(toFunction(spec).values) as TruthValue[];
  const width = 1 << rest.length;
  return Array.from({ length: 1 << k }, (_, j) => ({
    select: j.toString(2).padStart(k, "0"),
    residue: residueOf(values.slice(j * width, (j + 1) * width), rest),
  }));
}

// --- a tree of 2:1 multiplexers --------------------------------------------

type Leaf =
  | { readonly kind: "const"; readonly value: 0 | 1 }
  | { readonly kind: "node"; readonly ep: Endpoint; readonly key: string };

/**
 * "Implement f using only 2-to-1 multiplexers." (Q43.)
 *
 * A 2:1 mux is an if-then-else: `S ? D1 : D0`. So a chain of them testing one
 * variable per level is a DECISION TREE for the function, and any Boolean
 * function of n variables is expressible as one with at most 2^n - 1 muxes and
 * no other gates at all — not even an inverter, because `D0 = 1, D1 = 0` is a
 * complement.
 *
 * The tree is then REDUCED, exactly as a BDD is: if both branches of a mux lead
 * to the same place, the test was pointless and the mux disappears. That is what
 * turns the worst case into the small circuit an exam expects, and it is why the
 * answer is usually far fewer than 2^n - 1.
 */
export function muxTreeForFunction(
  spec: FunctionSpec,
  opts: { readonly id?: string; readonly title?: string; readonly caption?: string } = {},
): Diagram {
  const s = new Sketch();
  const variables = spec.variables;
  const n = variables.length;
  const values = Array.from(toFunction(spec).values) as TruthValue[];

  const tag = new Map<string, Endpoint>();
  const tagOf = (v: string): Endpoint => {
    const hit = tag.get(v);
    if (hit) return hit;
    const id = s.add(C.input(`in_${v}`, v));
    const e = at(id, "Y");
    tag.set(v, e);
    return e;
  };
  for (const v of variables) tagOf(v);

  const konst = new Map<0 | 1, Endpoint>();
  const constOf = (value: 0 | 1): Endpoint => {
    const hit = konst.get(value);
    if (hit) return hit;
    const id = s.add(C.constant(`k${value}`, value));
    const e = at(id, "Y");
    konst.set(value, e);
    return e;
  };

  let muxes = 0;
  const build = (level: number, prefix: number): Leaf => {
    if (level === n) {
      // `prefix` is the full minterm index once every variable has been fixed.
      const v = values[prefix];
      // A don't-care is free — resolve it to 0 so identical branches collapse.
      return { kind: "const", value: v === 1 ? 1 : 0 };
    }
    const lo = build(level + 1, prefix << 1);
    const hi = build(level + 1, (prefix << 1) | 1);

    const key = (l: Leaf): string => (l.kind === "const" ? `c${l.value}` : l.key);
    if (key(lo) === key(hi)) return lo; // both branches agree — the test is dead

    const id = s.add(C.mux(`M${muxes++}`, 1, { title: "2:1", subtitle: "" }));
    const feed = (l: Leaf, pin: string): void => {
      s.wire(l.kind === "const" ? constOf(l.value) : l.ep, at(id, pin));
    };
    feed(lo, "D0");
    feed(hi, "D1");
    s.wire(tagOf(variables[level] as string), at(id, "S0"));
    return { kind: "node", ep: at(id, "Y"), key: `m${id}` };
  };

  const root = build(0, 0);
  const out = s.add(C.output(`out_${spec.name}`, spec.name));
  s.wire(root.kind === "const" ? constOf(root.value) : root.ep, at(out, "A"));

  s.note("A 2:1 multiplexer is an if-then-else: with S = 0 it passes I0, with S = 1 it passes I1.");
  s.note(
    `Level k tests ${variables.join(", ")} in turn, so the tree walks the truth table one variable at a time and the leaves are the function's own 0s and 1s.`,
  );
  s.note(
    `Reduced from a worst case of ${(1 << n) - 1} multiplexers to ${muxes}: wherever both branches of a mux led to the same value, that test could not affect the answer and the mux was removed.`,
  );
  s.note("No gates are used at all — not even an inverter. I0 = 1, I1 = 0 is a complement.");

  return s.done({
    id: opts.id ?? `muxtree_${spec.name}`,
    title: opts.title ?? `${spec.name} from 2-to-1 multiplexers only`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- reading a function back OUT of a multiplexer ---------------------------

export interface MuxReadout {
  readonly variables: readonly string[];
  readonly values: readonly (0 | 1)[];
  readonly minterms: readonly number[];
  readonly expression: string;
  readonly minimal: string;
}

/**
 * The inverse question (Q46b): here is a mux with these things tied to its data
 * inputs — what function does it implement?
 *
 * Each data input is a function of the NON-select variables, and the mux simply
 * selects between them, so the answer is the concatenation of their truth
 * vectors in select order. Written out, that is exactly the truth table.
 *
 * Accepted data-input notations: `0`, `1`, a variable name, `D'` for its
 * complement, or any expression the engine's parser understands.
 */
export function readMux(
  selectVariables: readonly string[],
  dataVariables: readonly string[],
  inputs: readonly string[],
  name = "F",
): MuxReadout {
  const variables = [...selectVariables, ...dataVariables];
  const width = 1 << dataVariables.length;
  const values: (0 | 1)[] = [];

  for (let j = 0; j < 1 << selectVariables.length; j++) {
    const text = (inputs[j] ?? "0").trim();
    for (let r = 0; r < width; r++) {
      values.push(evalDataInput(text, dataVariables, r));
    }
  }

  const minterms = values.flatMap((v, m) => (v === 1 ? [m] : []));
  const fn = fromTruthValues(variables, values as TruthValue[], name);
  const minimal = fn.ok ? format(minimize(fn.value, "sop").expression) : "?";
  const expression = fn.ok ? format(minimize(fn.value, "sop").expression) : "?";

  return { variables, values, minterms, expression, minimal };
}

function evalDataInput(
  text: string,
  dataVariables: readonly string[],
  residue: number,
): 0 | 1 {
  if (text === "0") return 0;
  if (text === "1") return 1;
  const parsed = parse(text);
  if (!parsed.ok) return 0;
  // The lexer upper-cases identifiers, so the environment must be keyed the
  // same way or every lookup silently misses and the input reads as 0.
  const env = new Map<string, 0 | 1>();
  const m = dataVariables.length;
  dataVariables.forEach((v, i) => {
    env.set(v.toUpperCase(), ((residue >>> (m - 1 - i)) & 1) as 0 | 1);
  });
  return evaluate(parsed.value.ast, env);
}
