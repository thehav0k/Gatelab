import { parse } from "@/lib/core-engine/parser";
import { synthesize, type GateNetlist } from "./synth";
import {
  arityOf,
  gateInputNames,
  GATE_H,
  GATE_W,
} from "./parts";
import {
  asNodeId,
  asWireId,
  pinEnd,
  type CircuitDocument,
  type CircuitNode,
  type Endpoint,
  type NodeId,
  type PinRef,
  type Wire,
} from "./netlist";

/**
 * HIERARCHICAL composition — building a circuit out of blocks, not out of a
 * flattened truth table.
 *
 * The existing presets are each ONE expression run through the synthesizer. That
 * is exactly wrong for the thing a student is actually being taught here: a full
 * adder is not "the SOP of three inputs", it is *two half adders and an OR*, and
 * an 8-bit adder is not a 2^17-row truth table anyone could minimize — it is
 * eight full adders with the carry rippling through. The structure IS the lesson,
 * and a flat SOP erases it.
 *
 * So a composite names its BLOCKS and the wires between them. Each block is still
 * a small expression run through the same synthesizer (so it cannot drift from
 * the gate-level truth), but the blocks are placed as distinct clusters and wired
 * port-to-port — carry-out of one full adder into carry-in of the next, exactly
 * as you would on paper. The result is a real, simulatable, verifiable board that
 * looks like its own block diagram.
 */

// --- block definitions ------------------------------------------------------

export interface BlockDef {
  readonly id: string;
  readonly name: string;
  /** Input port names — these ARE the variables of the block's expressions. */
  readonly inputs: readonly string[];
  readonly outputs: readonly { readonly label: string; readonly expr: string }[];
}

/**
 * The reusable blocks. Each is a handful of gates, and every composite is built
 * from these — so "full adder from half adders" really does instantiate the same
 * half adder a student would build on its own.
 */
export const BLOCKS: Readonly<Record<string, BlockDef>> = {
  ha: {
    id: "ha",
    name: "Half adder",
    inputs: ["A", "B"],
    outputs: [
      { label: "S", expr: "A ^ B" },
      { label: "C", expr: "A * B" },
    ],
  },
  fa: {
    id: "fa",
    // Carry-in is the single letter `C`, not `Cin` — juxtaposition means AND, so
    // the parser would read `Cin` as C·i·n. Port names are parsed as variables.
    name: "Full adder",
    inputs: ["A", "B", "C"],
    outputs: [
      { label: "S", expr: "A ^ B ^ C" },
      { label: "Co", expr: "A*B + C*(A ^ B)" },
    ],
  },
  or2: {
    id: "or2",
    name: "OR",
    inputs: ["A", "B"],
    outputs: [{ label: "Y", expr: "A + B" }],
  },
  mux2: {
    id: "mux2",
    name: "2:1 mux",
    inputs: ["S", "A", "B"],
    outputs: [{ label: "Y", expr: "S'*A + S*B" }],
  },
  mux4: {
    id: "mux4",
    name: "4:1 mux",
    inputs: ["S1", "S0", "D0", "D1", "D2", "D3"],
    outputs: [
      { label: "Y", expr: "S1'*S0'*D0 + S1'*S0*D1 + S1*S0'*D2 + S1*S0*D3" },
    ],
  },
};

// --- composite specification ------------------------------------------------

/**
 * A source of a signal: a top-level input or one block's output.
 *   "in:A"      a top-level input switch
 *   "U1.Co"     the output port `Co` of instance `U1`
 */
export type Source = string;

export interface Instance {
  readonly id: string;
  readonly block: string;
}

export interface CompositeSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly note?: string;
  readonly inputs: readonly string[];
  readonly instances: readonly Instance[];
  /** Wire a source into one input port of an instance: `to` is `"U1.A"`. */
  readonly connections: readonly { readonly from: Source; readonly to: string }[];
  /** Top-level outputs, each fed from a source. Order is the display order. */
  readonly outputs: readonly { readonly label: string; readonly from: Source }[];
}

// --- realizing one block ----------------------------------------------------

const BLOCK_GAP_X = 150;
const BLOCK_GAP_Y = GATE_H + 34;

interface RealizedBlock {
  readonly nodes: Record<string, CircuitNode>;
  readonly wires: Record<string, Wire>;
  /** Port name -> the gate-input pins that consume it. */
  readonly inputLoads: Record<string, PinRef[]>;
  /** Output label -> the gate-output pin that drives it. */
  readonly outputDriver: Record<string, PinRef>;
  readonly width: number;
  readonly height: number;
}

/** Longest path from an input, for laying a block's gates out in columns. */
function depthsOf(nl: GateNetlist): Map<number, number> {
  const depth = new Map<number, number>();
  for (const i of nl.inputs) depth.set(i.signal, 0);
  for (const g of nl.gates) {
    depth.set(g.output, Math.max(0, ...g.inputs.map((s) => (depth.get(s) ?? 0) + 1)));
  }
  return depth;
}

/**
 * Turn a block into a gate cluster with exposed PORTS instead of switches and an
 * LED. `realize()` in synth.ts always bakes in an input switch per variable and
 * an output LED — exactly the interface we must NOT have inside a block, because
 * a block's inputs come from other blocks and its outputs feed them. So this is a
 * sibling realizer that stops at the port boundary.
 *
 * INVARIANT: a block is a pure gate network. Its expressions contain no literal
 * constants (which would need a power rail) and no output is a bare input (which
 * would be a wire, not a gate). Every block in BLOCKS satisfies this, and the
 * composer relies on it — so there is no rail plumbing here at all.
 */
function realizeBlock(block: BlockDef): RealizedBlock {
  const nodes: Record<string, CircuitNode> = {};
  const wires: Record<string, Wire> = {};
  const inputLoads: Record<string, PinRef[]> = Object.fromEntries(
    block.inputs.map((p) => [p, []]),
  );
  const outputDriver: Record<string, PinRef> = {};

  const nInputs = block.inputs.length;
  let gi = 0;
  let wi = 0;
  let rowBase = 0;

  for (const output of block.outputs) {
    const parsed = parse(output.expr);
    if (!parsed.ok) continue;
    const nl = synthesize(parsed.value.ast, block.inputs);

    const depth = depthsOf(nl);
    const perColumn = new Map<number, number>();
    const driverLocal = new Map<number, PinRef>();

    for (const gate of nl.gates) {
      const d = depth.get(gate.output) ?? 0;
      const row = perColumn.get(d) ?? 0;
      perColumn.set(d, row + 1);
      const id = asNodeId(`g${gi++}`);
      nodes[id] = {
        id,
        kind: "gate",
        label: `G${gi}`,
        op: gate.op,
        arity: arityOf(gate.op, gate.inputs.length),
        pos: { x: d * BLOCK_GAP_X, y: rowBase + row * BLOCK_GAP_Y },
      };
      driverLocal.set(gate.output, { node: id, pin: "Y" });
    }

    for (const gate of nl.gates) {
      const target = driverLocal.get(gate.output);
      if (!target) continue;
      const names = gateInputNames(arityOf(gate.op, gate.inputs.length));
      gate.inputs.forEach((signal, i) => {
        const pin = names[i];
        if (!pin) return;
        const dest: PinRef = { node: target.node, pin };
        if (signal < nInputs) {
          // An input-port signal — record it as a load for that port.
          inputLoads[block.inputs[signal]!]!.push(dest);
        } else {
          // A gate output feeding another gate — wire it internally now.
          const from = driverLocal.get(signal);
          if (from) {
            const id = asWireId(`w${wi++}`);
            wires[id] = { id, a: pinEnd(from), b: pinEnd(dest) };
          }
        }
      });
    }

    const driver = driverLocal.get(nl.outputSignal);
    if (driver) outputDriver[output.label] = driver;

    const rows = Math.max(1, ...perColumn.values());
    rowBase += (rows + 0.5) * BLOCK_GAP_Y;
  }

  let w = GATE_W;
  let h = GATE_H;
  for (const node of Object.values(nodes)) {
    w = Math.max(w, node.pos.x + GATE_W);
    h = Math.max(h, node.pos.y + GATE_H);
  }

  return { nodes, wires, inputLoads, outputDriver, width: w, height: h };
}

// --- composing the whole thing ----------------------------------------------

const SWITCH_COL_W = 130;
const COL_GAP = 90;
const ROW_GAP = 70;

/**
 * How far downstream each instance sits: 1 + the deepest instance feeding it. An
 * instance fed only by top-level inputs is at depth 0. This is what lets a ripple
 * adder lay itself out left-to-right with the carry visibly flowing across.
 */
function instanceDepths(spec: CompositeSpec): Map<string, number> {
  const feeders = new Map<string, string[]>();
  for (const inst of spec.instances) feeders.set(inst.id, []);
  for (const c of spec.connections) {
    const dot = c.from.indexOf(".");
    const destInst = c.to.slice(0, c.to.indexOf("."));
    if (dot > 0) feeders.get(destInst)?.push(c.from.slice(0, dot));
  }

  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0; // cycles are not expected, but never loop forever
    seen.add(id);
    const d = Math.max(0, ...(feeders.get(id) ?? []).map((f) => visit(f, seen) + 1));
    depth.set(id, d);
    return d;
  };
  for (const inst of spec.instances) visit(inst.id, new Set());
  return depth;
}

/**
 * Compose a hierarchical preset into a flat, placeable, simulatable document.
 *
 * Every wire here is a real electrical connection — the composed board verifies
 * against the algebra just like a synthesized one, because it IS synthesized,
 * block by block, from the same gate tables.
 */
export function composePreset(spec: CompositeSpec): CircuitDocument {
  const nodes: Record<string, CircuitNode> = {};
  const wires: Record<string, Wire> = {};
  let n = 0;
  let w = 0;

  const connect = (a: PinRef, b: PinRef): void => {
    const id = asWireId(`cw${w++}`);
    wires[id] = { id, a: pinEnd(a), b: pinEnd(b) };
  };

  // --- top-level input switches, down the left edge ---
  const switchPin: Record<string, PinRef> = {};
  spec.inputs.forEach((label, i) => {
    const id = asNodeId(`n${n++}`);
    nodes[id] = { id, kind: "switch", label, state: 0, pos: { x: 30, y: 40 + i * ROW_GAP } };
    switchPin[label] = { node: id, pin: "Y" };
  });

  // --- lay the instances out in dataflow columns ---
  const depth = instanceDepths(spec);
  const byDepth = new Map<number, Instance[]>();
  for (const inst of spec.instances) {
    const d = depth.get(inst.id) ?? 0;
    (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(inst);
  }

  const realized = new Map<string, RealizedBlock>();
  for (const inst of spec.instances) {
    const def = BLOCKS[inst.block];
    if (def) realized.set(inst.id, realizeBlock(def));
  }

  const maxDepth = Math.max(0, ...depth.values());
  // x-origin of each column, accounting for the widest block in each earlier one.
  const colX: number[] = [];
  let x = SWITCH_COL_W;
  for (let d = 0; d <= maxDepth; d++) {
    colX[d] = x;
    const widest = Math.max(
      GATE_W,
      ...(byDepth.get(d) ?? []).map((i) => realized.get(i.id)?.width ?? GATE_W),
    );
    x += widest + COL_GAP;
  }

  // Global port maps, filled as instances are placed.
  const inputLoads: Record<string, Record<string, PinRef[]>> = {};
  const outputDriver: Record<string, Record<string, PinRef>> = {};

  for (const [d, insts] of byDepth) {
    insts.forEach((inst, row) => {
      const rb = realized.get(inst.id);
      if (!rb) return;
      const ox = colX[d]!;
      const oy = 30 + row * (rb.height + 60);
      const remap = new Map<string, NodeId>();

      for (const [localId, node] of Object.entries(rb.nodes)) {
        const gid = asNodeId(`n${n++}`);
        remap.set(localId, gid);
        nodes[gid] = {
          ...node,
          id: gid,
          label: `${inst.id}·${node.label}`,
          pos: { x: ox + node.pos.x, y: oy + node.pos.y },
        };
      }
      for (const wire of Object.values(rb.wires)) {
        const id = asWireId(`cw${w++}`);
        // rb.wires hold Endpoints (kind + ref), not bare PinRefs — remap the ref.
        const fixEnd = (e: Endpoint): Endpoint =>
          e.kind === "pin"
            ? pinEnd({ node: remap.get(e.ref.node)!, pin: e.ref.pin })
            : e;
        wires[id] = { id, a: fixEnd(wire.a), b: fixEnd(wire.b) };
      }

      const fixRef = (r: PinRef): PinRef => ({ node: remap.get(r.node)!, pin: r.pin });
      inputLoads[inst.id] = Object.fromEntries(
        Object.entries(rb.inputLoads).map(([p, refs]) => [p, refs.map(fixRef)]),
      );
      outputDriver[inst.id] = Object.fromEntries(
        Object.entries(rb.outputDriver).map(([l, ref]) => [l, fixRef(ref)]),
      );
    });
  }

  // --- resolve a source to the pin that drives it ---
  // A source is either a top-level input switch ("in:A") or one block's output
  // port ("U1.Co"). Blocks are pure gate networks, so there are no constant rails.
  const driverForSource = (src: Source): PinRef | null => {
    if (src.startsWith("in:")) return switchPin[src.slice(3)] ?? null;
    const dot = src.indexOf(".");
    if (dot > 0) return outputDriver[src.slice(0, dot)]?.[src.slice(dot + 1)] ?? null;
    return null;
  };

  // --- inter-block wiring ---
  for (const c of spec.connections) {
    const from = driverForSource(c.from);
    const dot = c.to.indexOf(".");
    const inst = c.to.slice(0, dot);
    const port = c.to.slice(dot + 1);
    const loads = inputLoads[inst]?.[port] ?? [];
    if (from) for (const load of loads) connect(from, load);
  }

  // --- top-level outputs on LEDs, far right ---
  const ledX = colX[maxDepth]! + 200;
  spec.outputs.forEach((out, i) => {
    const id = asNodeId(`n${n++}`);
    nodes[id] = { id, kind: "led", label: out.label, pos: { x: ledX, y: 40 + i * ROW_GAP } };
    const from = driverForSource(out.from);
    if (from) connect(from, { node: id, pin: "A" });
  });

  return { nodes, wires, board: null };
}
