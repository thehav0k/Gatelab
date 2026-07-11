import type { Expr } from "@/lib/core-engine/ast";
import type { GateOp } from "./logic";
import {
  asNodeId,
  asWireId,
  type CircuitDocument,
  type CircuitNode,
  type NodeDraft,
  type NodeId,
  type PinRef,
  type Wire,
} from "./netlist";
import { GATE_H, IO_H, arityOf, gateInputNames } from "./parts";
import { IC_LIBRARY, dipWidth, getIc, type IcDefinition } from "./ic-library";

/**
 * Expression -> gates -> physical 74xx chips.
 *
 * Pipeline:
 *   Expr  --synthesize-->  GateNetlist   (2-input gates, hash-consed)
 *         --technologyMap->  MappedDesign (a gate family + a chip count)
 *         --realize------->  CircuitDocument (placeable, simulatable, wireable)
 *
 * The interesting parts are hash-consing (shared subexpressions become ONE gate,
 * not two) and leftover-slot absorption in the packer (an inverter is a free
 * NAND, so spare NAND slots can swallow the 7404 entirely).
 */

// ---------------------------------------------------------------------------
// 1. Synthesis: AST -> 2-input gate netlist
// ---------------------------------------------------------------------------

export interface LogicGate {
  readonly id: number;
  readonly op: GateOp;
  /** Signal ids. */
  readonly inputs: readonly number[];
  readonly output: number;
}

export interface GateNetlist {
  readonly gates: readonly LogicGate[];
  readonly inputs: readonly { readonly name: string; readonly signal: number }[];
  readonly outputSignal: number;
  /** Set when the expression is a constant — there is nothing to build. */
  readonly constant: 0 | 1 | null;
}

export function synthesize(expr: Expr, variables: readonly string[]): GateNetlist {
  const inputs = variables.map((name, i) => ({ name, signal: i }));
  const signalOf = new Map(inputs.map((i) => [i.name, i.signal]));
  let nextSignal = variables.length;

  const gates: LogicGate[] = [];

  /**
   * Hash-consing (structural hashing). Two identical subexpressions collapse to
   * ONE gate — which is what turns an SOP with shared product terms into a real
   * gate-count win rather than a tree with duplicated branches. Commutative ops
   * sort their inputs first so `A·B` and `B·A` hash the same.
   */
  const memo = new Map<string, number>();
  const COMMUTATIVE = new Set<GateOp>(["and", "or", "xor", "nand", "nor", "xnor"]);

  const emit = (op: GateOp, ins: readonly number[]): number => {
    const key = `${op}(${
      COMMUTATIVE.has(op) ? [...ins].sort((a, b) => a - b).join(",") : ins.join(",")
    })`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    const output = nextSignal++;
    gates.push({ id: gates.length, op, inputs: [...ins], output });
    memo.set(key, output);
    return output;
  };

  /**
   * Fold an n-ary node into 2-input gates as a BALANCED tree, not a chain.
   * AND(a,b,c,d) becomes ((a·b)·(c·d)) — depth 2 rather than 3. Halves the
   * propagation depth and looks dramatically better on the canvas.
   */
  const balanced = (op: GateOp, operands: readonly number[]): number => {
    if (operands.length === 1) return operands[0] as number;

    let level = [...operands];
    while (level.length > 1) {
      const next: number[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const a = level[i] as number;
        const b = level[i + 1];
        next.push(b === undefined ? a : emit(op, [a, b]));
      }
      level = next;
    }
    return level[0] as number;
  };

  let constant: 0 | 1 | null = null;

  const walk = (e: Expr): number => {
    switch (e.kind) {
      case "var": {
        const s = signalOf.get(e.name);
        if (s === undefined) throw new Error(`synthesize: unknown variable ${e.name}`);
        return s;
      }
      case "const":
        constant = e.value;
        return -1;

      case "not":
        return emit("not", [walk(e.operand)]);

      case "and":
      case "or":
      case "xor":
        return balanced(e.kind, e.operands.map(walk));

      // A 2-input NAND is one gate; an n-ary one is NOT(AND(...)). Both are
      // reachable, and both are correct — see the note in core-engine/ast.ts.
      case "nand":
      case "nor":
      case "xnor": {
        const base: GateOp = e.kind === "nand" ? "and" : e.kind === "nor" ? "or" : "xor";
        if (e.operands.length === 2) {
          return emit(e.kind, e.operands.map(walk));
        }
        return emit("not", [balanced(base, e.operands.map(walk))]);
      }
    }
  };

  const outputSignal = walk(expr);
  return { gates, inputs, outputSignal, constant };
}

// ---------------------------------------------------------------------------
// 2. Technology mapping
// ---------------------------------------------------------------------------

export type Strategy = "mixed" | "nand-only" | "nor-only";

export interface MappedDesign {
  readonly strategy: Strategy;
  readonly netlist: GateNetlist;
  /** One entry per physical chip. */
  readonly chips: readonly {
    readonly part: string;
    readonly def: IcDefinition;
    /** gate id -> which slot of this chip it occupies. */
    readonly slots: readonly { readonly slot: number; readonly gate: LogicGate }[];
  }[];
  readonly chipCount: number;
  readonly gateCount: number;
}

/**
 * Rewrite the netlist into a single gate family.
 *
 * De Morgan, applied mechanically:
 *   AND(a,b) = NAND(NAND(a,b), NAND(a,b))   -> a NAND, then an inverter
 *   OR(a,b)  = NAND(NOT a, NOT b)
 *   NOT(a)   = NAND(a, a)                    <- an inverter is a free NAND
 *
 * The NOR case is the exact dual. XOR expands to its 4-NAND form.
 */
function rewriteFamily(nl: GateNetlist, family: "nand" | "nor"): GateNetlist {
  const gates: LogicGate[] = [];
  let nextSignal =
    Math.max(nl.inputs.length, ...nl.gates.map((g) => g.output + 1), 0) + 1;

  const memo = new Map<string, number>();
  const emit = (op: GateOp, ins: readonly number[]): number => {
    const key = `${op}(${[...ins].sort((a, b) => a - b).join(",")})`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const output = nextSignal++;
    gates.push({ id: gates.length, op, inputs: [...ins], output });
    memo.set(key, output);
    return output;
  };

  const F: GateOp = family; // 'nand' | 'nor'
  const inv = (a: number): number => emit(F, [a, a]); // an inverter is a free NAND/NOR

  /** Rewrites of the primitive ops into the chosen family. */
  const build = (op: GateOp, ins: readonly number[]): number => {
    const a = ins[0] as number;
    const b = ins[1] as number;

    if (family === "nand") {
      switch (op) {
        case "not":
        case "buf":
          return op === "not" ? inv(a) : inv(inv(a));
        case "nand":
          return emit("nand", [a, b]);
        case "and":
          return inv(emit("nand", [a, b]));
        case "or":
          return emit("nand", [inv(a), inv(b)]); // De Morgan
        case "nor":
          return inv(emit("nand", [inv(a), inv(b)]));
        case "xor": {
          const t = emit("nand", [a, b]);
          return emit("nand", [emit("nand", [a, t]), emit("nand", [t, b])]);
        }
        case "xnor": {
          const t = emit("nand", [a, b]);
          return inv(emit("nand", [emit("nand", [a, t]), emit("nand", [t, b])]));
        }
      }
    }

    switch (op) {
      case "not":
      case "buf":
        return op === "not" ? inv(a) : inv(inv(a));
      case "nor":
        return emit("nor", [a, b]);
      case "or":
        return inv(emit("nor", [a, b]));
      case "and":
        return emit("nor", [inv(a), inv(b)]); // the dual of the NAND case
      case "nand":
        return inv(emit("nor", [inv(a), inv(b)]));
      case "xnor": {
        const t = emit("nor", [a, b]);
        return emit("nor", [emit("nor", [a, t]), emit("nor", [t, b])]);
      }
      case "xor": {
        const t = emit("nor", [a, b]);
        return inv(emit("nor", [emit("nor", [a, t]), emit("nor", [t, b])]));
      }
    }
  };

  // Map each original signal to its signal in the rewritten netlist.
  const remap = new Map<number, number>(nl.inputs.map((i) => [i.signal, i.signal]));
  for (const g of nl.gates) {
    const ins = g.inputs.map((s) => remap.get(s) as number);
    remap.set(g.output, build(g.op, ins));
  }

  return {
    gates,
    inputs: nl.inputs,
    outputSignal: remap.get(nl.outputSignal) ?? nl.outputSignal,
    constant: nl.constant,
  };
}

/**
 * Pack gates into physical packages.
 *
 * Bin-packing is NOT hard here: capacity is uniform per part (four gates per
 * 7400/02/08/32/86, six per 7404), so for a single gate type the optimum is just
 * ceil(demand / capacity). Five NANDs is exactly two 7400s. No heuristic needed.
 *
 * The genuinely interesting pass is LEFTOVER-SLOT ABSORPTION. `NOT(x)` is
 * `NAND(x, x)` for free, so spare NAND slots can swallow inverters — and if that
 * empties the 7404 entirely, the chip disappears from the bill of materials:
 *
 *   5 NANDs + 2 inverters, naively: 2 x 7400 + 1 x 7404 = 3 chips
 *   after absorption:                2 x 7400            = 2 chips
 */
function packChips(nl: GateNetlist): MappedDesign["chips"] {
  const byOp = new Map<GateOp, LogicGate[]>();
  for (const g of nl.gates) {
    byOp.set(g.op, [...(byOp.get(g.op) ?? []), g]);
  }

  /**
   * LEFTOVER-SLOT ABSORPTION.
   *
   * An inverter is `NAND(x, x)` — or `NOR(x, x)` — for free, so it can live in a
   * spare slot of a chip we are already paying for. We only ever move an
   * inverter into a slot that ALREADY EXISTS (`spare` is computed from the chip
   * count we had to buy anyway), so this can never add a package; it can only
   * remove the 7404.
   *
   * Note this matters in the MIXED strategy specifically. In a NAND-only or
   * NOR-only design there are no `not` gates left by this point — rewriteFamily
   * already turned every inverter into a family gate with its inputs tied.
   */
  const inverters = [...(byOp.get("not") ?? [])];
  if (inverters.length > 0) {
    for (const host of ["nand", "nor"] as const) {
      const hosted = byOp.get(host);
      const def = IC_LIBRARY.find((d) => d.op === host && d.inputsPerGate === 2);
      if (!hosted || hosted.length === 0 || !def) continue;

      const chipsNeeded = Math.ceil(hosted.length / def.gateCount);
      const spare = chipsNeeded * def.gateCount - hosted.length;
      const take = Math.min(spare, inverters.length);
      if (take === 0) continue;

      byOp.set(host, [...hosted, ...inverters.splice(0, take)]);
    }

    if (inverters.length > 0) byOp.set("not", inverters);
    else byOp.delete("not");
  }

  const chips: MappedDesign["chips"][number][] = [];

  for (const [op, gates] of byOp) {
    const def = IC_LIBRARY.find(
      (d) => d.op === op && d.inputsPerGate === (op === "not" ? 1 : 2),
    );
    if (!def) continue; // no chip implements this op directly

    for (let i = 0; i < gates.length; i += def.gateCount) {
      const batch = gates.slice(i, i + def.gateCount);
      chips.push({
        part: def.part,
        def,
        slots: batch.map((gate, k) => ({ slot: k + 1, gate })),
      });
    }
  }

  return chips;
}

export function technologyMap(nl: GateNetlist, strategy: Strategy): MappedDesign {
  const mapped =
    strategy === "mixed"
      ? nl
      : rewriteFamily(nl, strategy === "nand-only" ? "nand" : "nor");

  const chips = packChips(mapped);

  return {
    strategy,
    netlist: mapped,
    chips,
    chipCount: chips.length,
    gateCount: mapped.gates.length,
  };
}

/** Try every strategy and report the comparison — which is itself the lesson. */
export function compareStrategies(nl: GateNetlist): MappedDesign[] {
  return (["mixed", "nand-only", "nor-only"] as const)
    .map((s) => technologyMap(nl, s))
    .sort((a, b) => a.chipCount - b.chipCount || a.gateCount - b.gateCount);
}

// ---------------------------------------------------------------------------
// 3. Realization: a MappedDesign -> a placeable, simulatable CircuitDocument
// ---------------------------------------------------------------------------

export interface RealizeOptions {
  /** Build from discrete gate symbols instead of 74xx packages. */
  readonly discrete?: boolean;
  readonly outputLabel?: string;
}

export function realize(
  design: MappedDesign,
  options: RealizeOptions = {},
): CircuitDocument {
  const nodes: Record<string, CircuitNode> = {};
  const wires: Record<string, Wire> = {};
  let n = 0;
  let w = 0;

  const addNode = (node: NodeDraft): NodeId => {
    const id = asNodeId(`s${++n}`);
    nodes[id] = { ...node, id } as CircuitNode;
    return id;
  };
  const connect = (a: PinRef, b: PinRef): void => {
    const id = asWireId(`sw${++w}`);
    wires[id] = { id, a, b };
  };

  const { netlist } = design;

  // --- inputs: a switch per variable, down the left edge --------------------
  const switchOf = new Map<number, NodeId>();
  netlist.inputs.forEach((input, i) => {
    const id = addNode({
      kind: "switch",
      label: input.name,
      state: 0,
      pos: { x: 40, y: 60 + i * 70 },
    });
    switchOf.set(input.signal, id);
  });

  /** Where does a signal come from? A switch, or some gate's output pin. */
  const driverOf = new Map<number, PinRef>();
  for (const [signal, id] of switchOf) {
    driverOf.set(signal, { node: id, pin: "Y" });
  }

  if (options.discrete || design.chips.length === 0) {
    // --- discrete gate symbols, laid out by depth --------------------------
    const depth = computeDepths(netlist);
    const perColumn = new Map<number, number>();

    for (const gate of netlist.gates) {
      const d = depth.get(gate.output) ?? 0;
      const row = perColumn.get(d) ?? 0;
      perColumn.set(d, row + 1);

      const arity = arityOf(gate.op, gate.inputs.length);
      const id = addNode({
        kind: "gate",
        label: `G${gate.id + 1}`,
        op: gate.op,
        arity,
        pos: { x: 190 + d * 150, y: 50 + row * (GATE_H + 40) },
      });
      driverOf.set(gate.output, { node: id, pin: "Y" });
    }

    for (const gate of netlist.gates) {
      const target = nodeForGateOutput(nodes, driverOf, gate.output);
      if (!target) continue;
      const names = gateInputNames(arityOf(gate.op, gate.inputs.length));
      gate.inputs.forEach((signal, i) => {
        const from = driverOf.get(signal);
        const pin = names[i];
        if (from && pin) connect(from, { node: target, pin });
      });
    }
  } else {
    // --- 74xx packages ------------------------------------------------------
    const rails = {
      vcc: addNode({ kind: "rail", label: "V1", rail: "vcc", pos: { x: 620, y: 20 } }),
      gnd: addNode({ kind: "rail", label: "GND1", rail: "gnd", pos: { x: 700, y: 20 } }),
    };

    // Which chip+slot holds each gate, so we can find its output pin later.
    const placement = new Map<number, { node: NodeId; def: IcDefinition; slot: number }>();

    design.chips.forEach((chip, i) => {
      const id = addNode({
        kind: "ic",
        label: `U${i + 1}`,
        part: chip.part,
        pos: { x: 230 + (i % 2) * (dipWidth(14) + 90), y: 130 + Math.floor(i / 2) * 170 },
      });

      // ALWAYS wire pin 14 to Vcc and pin 7 to GND. This is the thing students
      // forget, so the generator must never forget it — and the checker must
      // always flag its absence.
      connect({ node: rails.vcc, pin: "VCC" }, { node: id, pin: "VCC" });
      connect({ node: rails.gnd, pin: "GND" }, { node: id, pin: "GND" });

      for (const { slot, gate } of chip.slots) {
        placement.set(gate.output, { node: id, def: chip.def, slot });
        const cell = chip.def.cells.find((c) => c.slot === slot);
        if (cell) driverOf.set(gate.output, { node: id, pin: cell.outputPin });
      }
    });

    for (const gate of netlist.gates) {
      const place = placement.get(gate.output);
      if (!place) continue;
      const cell = place.def.cells.find((c) => c.slot === place.slot);
      if (!cell) continue;

      // An inverter absorbed into a NAND slot ties BOTH inputs to the same
      // signal — that is precisely what makes it an inverter.
      const sources =
        gate.op === "not" && cell.inputPins.length > 1
          ? cell.inputPins.map(() => gate.inputs[0] as number)
          : gate.inputs;

      cell.inputPins.forEach((pin, i) => {
        const signal = sources[i];
        if (signal === undefined) return;
        const from = driverOf.get(signal);
        if (from) connect(from, { node: place.node, pin });
      });
    }
  }

  // --- output LED -----------------------------------------------------------
  const out = driverOf.get(netlist.outputSignal);
  const led = addNode({
    kind: "led",
    label: options.outputLabel ?? "F",
    pos: { x: 800, y: 60 + Math.max(0, netlist.inputs.length - 1) * 35 - IO_H / 2 },
  });
  if (out) connect(out, { node: led, pin: "A" });

  return { nodes, wires };
}

/** Longest path from an input — used to lay gates out in columns. */
function computeDepths(nl: GateNetlist): Map<number, number> {
  const depth = new Map<number, number>();
  for (const i of nl.inputs) depth.set(i.signal, 0);
  for (const g of nl.gates) {
    const d = Math.max(0, ...g.inputs.map((s) => (depth.get(s) ?? 0) + 1));
    depth.set(g.output, d);
  }
  return depth;
}

function nodeForGateOutput(
  nodes: Record<string, CircuitNode>,
  driverOf: ReadonlyMap<number, PinRef>,
  signal: number,
): NodeId | null {
  const ref = driverOf.get(signal);
  if (!ref || !nodes[ref.node]) return null;
  return ref.node;
}

/** Human summary for the UI: "Mixed gates: 4 ICs. NAND-only: 2 ICs." */
export function describeDesign(design: MappedDesign): string {
  const label =
    design.strategy === "mixed"
      ? "Mixed gates"
      : design.strategy === "nand-only"
        ? "NAND-only"
        : "NOR-only";
  const parts = design.chips.map((c) => c.part);
  const tally = [...new Set(parts)]
    .map((p) => {
      const n = parts.filter((q) => q === p).length;
      return n > 1 ? `${n}x ${p}` : p;
    })
    .join(", ");
  return `${label}: ${design.chipCount} IC${design.chipCount === 1 ? "" : "s"}${
    tally ? ` (${tally})` : ""
  }, ${design.gateCount} gates`;
}

export { getIc };
