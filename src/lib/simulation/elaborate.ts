import type { Driver, GateOp } from "./logic";
import { L0, L1 } from "./logic";
import { buildNetIndex, netOf, type CircuitDocument, type NetIndex, type NodeId } from "./netlist";
import { cellsOf, pinsOf, powerOf } from "./parts";

/**
 * Flatten the document into something the solver can chew on: a geometry-free,
 * reference-free bag of typed arrays and plain objects.
 *
 * `SimNetlist` is structured-cloneable BY CONSTRUCTION — no class instances, no
 * functions, no references back into the document. That is not an accident:
 *   - it can be postMessage'd to a Worker with zero serialization code, and
 *   - `evaluate()` is a pure function of it, so the M6 verification sweep can
 *     call it 2^n times without cloning or snapshotting the user's live circuit.
 */

export interface SimCell {
  readonly id: number;
  readonly op: GateOp;
  /** Net ordinals. */
  readonly inputs: readonly number[];
  readonly output: number;
  /** Null for ideal schematic gates. Set for ICs, which can be unpowered. */
  readonly power: { readonly vcc: number; readonly gnd: number } | null;
  /** So a diagnostic can say "IC U3, gate 2" rather than "cell 7". */
  readonly owner: { readonly node: NodeId; readonly slot: number };
}

export interface SimPort {
  readonly node: NodeId;
  readonly label: string;
  readonly net: number;
}

export interface SimNetlist {
  readonly netCount: number;
  readonly cells: readonly SimCell[];
  /** net ordinal -> ids of cells that read it. Drives the event queue. */
  readonly fanout: readonly (readonly number[])[];
  /** net ordinal -> always-on drivers (the rails). Switches are separate. */
  readonly railDrivers: readonly (readonly Driver[])[];
  /** Input switches, in stable label order. Indexes into evaluate()'s vector. */
  readonly inputs: readonly SimPort[];
  /** LED probes, in stable label order. */
  readonly outputs: readonly SimPort[];
  /** Net ordinals that short Vcc to GND — the solver pins these to X. */
  readonly railShorts: readonly number[];
  /**
   * Strongly-connected groups of cells — i.e. combinational feedback loops.
   * Structural, computed once, independent of any input vector.
   *
   * This is how oscillation is actually detected, and it has to be structural
   * rather than value-based. In 4-state logic a ring oscillator does NOT toggle:
   * `NOT(X) = X`, so it collapses to a stable X in one step. Watching values for
   * a period-2 wobble would therefore never fire. What we can say for certain is
   * "these gates form a loop", and then ask whether that loop reached a definite
   * value — which also correctly leaves `Y = A AND Y, A=0` alone, since that
   * loop settles to a clean 0.
   */
  readonly feedbackLoops: readonly (readonly number[])[];
}

export interface Elaboration {
  readonly index: NetIndex;
  readonly netlist: SimNetlist;
}

export function elaborate(doc: CircuitDocument): Elaboration {
  const index = buildNetIndex(doc, pinsOf);
  const ord = (node: NodeId, pin: string): number | null => {
    const id = netOf(index, { node, pin });
    return id === null ? null : (index.ordinalOf.get(id) ?? null);
  };

  const netCount = index.nets.length;
  const cells: SimCell[] = [];
  const railDrivers: Driver[][] = Array.from({ length: netCount }, () => []);
  const inputs: SimPort[] = [];
  const outputs: SimPort[] = [];

  for (const node of Object.values(doc.nodes)) {
    switch (node.kind) {
      case "rail": {
        const pin = node.rail === "vcc" ? "VCC" : "GND";
        const net = ord(node.id, pin);
        if (net !== null) {
          (railDrivers[net] as Driver[]).push({
            value: node.rail === "vcc" ? L1 : L0,
            strength: "supply",
          });
        }
        break;
      }

      case "switch": {
        const net = ord(node.id, "Y");
        // A switch with nothing attached still belongs in the input list — the
        // user placed it, and the truth-table sweep should still name it.
        if (net !== null) {
          inputs.push({ node: node.id, label: node.label, net });
        }
        break;
      }

      case "led": {
        const net = ord(node.id, "A");
        if (net !== null) {
          outputs.push({ node: node.id, label: node.label, net });
        }
        break;
      }

      case "gate":
      case "ic": {
        const power = powerOf(node);
        const vcc = power ? ord(node.id, power.vcc) : null;
        const gnd = power ? ord(node.id, power.gnd) : null;

        for (const template of cellsOf(node)) {
          const inputNets = template.inputPins.map((p) => ord(node.id, p));
          const outputNet = ord(node.id, template.outputPin);
          if (outputNet === null || inputNets.some((n) => n === null)) continue;

          cells.push({
            id: cells.length,
            op: template.op,
            inputs: inputNets as number[],
            output: outputNet,
            // An IC whose Vcc pin isn't on any net at all still has power
            // *requirements* — we record -1 so the solver reports it as
            // unpowered rather than silently treating it as ideal.
            power: power ? { vcc: vcc ?? -1, gnd: gnd ?? -1 } : null,
            owner: { node: node.id, slot: template.slot },
          });
        }
        break;
      }
    }
  }

  const fanout: number[][] = Array.from({ length: netCount }, () => []);
  for (const cell of cells) {
    for (const net of cell.inputs) {
      (fanout[net] as number[]).push(cell.id);
    }
  }

  // Stable, human order — so the truth table's columns don't shuffle between runs.
  inputs.sort((a, b) => a.label.localeCompare(b.label));
  outputs.sort((a, b) => a.label.localeCompare(b.label));

  const railShorts = index.nets
    .filter((n) => n.railShort)
    .map((n) => index.ordinalOf.get(n.id) as number);

  return {
    index,
    netlist: {
      netCount,
      cells,
      fanout,
      railDrivers,
      inputs,
      outputs,
      railShorts,
      feedbackLoops: findFeedbackLoops(cells, fanout),
    },
  };
}

/**
 * Tarjan's strongly-connected components over the cell graph, keeping only the
 * components that are genuine feedback: more than one cell, or a single cell
 * whose output feeds its own input.
 *
 * Iterative rather than recursive — a deep combinational chain would blow the
 * call stack, and this runs on user-authored graphs.
 */
function findFeedbackLoops(
  cells: readonly SimCell[],
  fanout: readonly (readonly number[])[],
): number[][] {
  const n = cells.length;
  const successors = cells.map((c) => fanout[c.output] ?? []);

  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const loops: number[][] = [];
  let counter = 0;

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;

    // (cell, next successor to visit)
    const work: [number, number][] = [[root, 0]];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;

    while (work.length > 0) {
      const frame = work[work.length - 1] as [number, number];
      const [v, i] = frame;
      const succ = successors[v] as readonly number[];

      if (i < succ.length) {
        frame[1] = i + 1;
        const w = succ[i] as number;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v] as number, index[w] as number);
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        const p = parent[0];
        low[p] = Math.min(low[p] as number, low[v] as number);
      }

      if (low[v] === index[v]) {
        const component: number[] = [];
        for (;;) {
          const w = stack.pop() as number;
          onStack[w] = 0;
          component.push(w);
          if (w === v) break;
        }

        const selfLoop =
          component.length === 1 &&
          (successors[v] as readonly number[]).includes(v);

        if (component.length > 1 || selfLoop) {
          loops.push(component.sort((a, b) => a - b));
        }
      }
    }
  }

  return loops;
}
