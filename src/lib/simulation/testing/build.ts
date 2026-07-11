import type { GateOp } from "../logic";
import {
  asNodeId,
  asWireId,
  holeEnd,
  pinEnd,
  type CircuitDocument,
  type CircuitNode,
  type NodeId,
  type PinRef,
  type Wire,
} from "../netlist";
import { DEFAULT_BOARD, type BoardRow, type BreadboardSpec } from "../breadboard";

/**
 * A tiny fluent builder for circuits, used by the tests and by the M7 presets.
 * Keeps the test bodies about the circuit under test rather than about object
 * literals.
 */
export class CircuitBuilder {
  private readonly nodes: Record<string, CircuitNode> = {};
  private readonly wires: Record<string, Wire> = {};
  private wireCount = 0;
  private spec: BreadboardSpec | null = null;

  gate(id: string, op: GateOp, arity = 2, pos = { x: 0, y: 0 }): this {
    this.nodes[id] = {
      kind: "gate",
      id: asNodeId(id),
      label: id,
      op,
      arity,
      pos,
    };
    return this;
  }

  ic(id: string, part: string, pos = { x: 0, y: 0 }): this {
    this.nodes[id] = { kind: "ic", id: asNodeId(id), label: id, part, pos };
    return this;
  }

  switch(id: string, state: 0 | 1 = 0, pos = { x: 0, y: 0 }): this {
    this.nodes[id] = {
      kind: "switch",
      id: asNodeId(id),
      label: id,
      state,
      pos,
    };
    return this;
  }

  led(id: string, pos = { x: 0, y: 0 }): this {
    this.nodes[id] = { kind: "led", id: asNodeId(id), label: id, pos };
    return this;
  }

  rail(id: string, rail: "vcc" | "gnd", pos = { x: 0, y: 0 }): this {
    this.nodes[id] = { kind: "rail", id: asNodeId(id), label: id, rail, pos };
    return this;
  }

  /** `wire("U1", "Y", "L1", "A")` — pin to pin. */
  wire(nodeA: string, pinA: string, nodeB: string, pinB: string): this {
    const id = `w${(this.wireCount += 1)}`;
    this.wires[id] = {
      id: asWireId(id),
      a: pinEnd({ node: asNodeId(nodeA), pin: pinA }),
      b: pinEnd({ node: asNodeId(nodeB), pin: pinB }),
    };
    return this;
  }

  /** A breadboard jumper: `jumper(5, "A", 12, "C")`. */
  jumper(colA: number, rowA: BoardRow, colB: number, rowB: BoardRow): this {
    const id = `w${(this.wireCount += 1)}`;
    this.wires[id] = {
      id: asWireId(id),
      a: holeEnd({ col: colA, row: rowA }),
      b: holeEnd({ col: colB, row: rowB }),
    };
    return this;
  }

  /** Put the circuit on a breadboard. */
  board(spec: BreadboardSpec = DEFAULT_BOARD): this {
    this.spec = spec;
    return this;
  }

  /** Seat a one-pin part in a hole. ICs are seated by their column alone. */
  seat(id: string, col: number, row: BoardRow): this {
    const node = this.nodes[id];
    if (node) {
      this.nodes[id] = { ...node, pos: { x: col, y: 0 }, boardRow: row };
    }
    return this;
  }

  removeWire(id: string): this {
    delete this.wires[id];
    return this;
  }

  build(): CircuitDocument {
    return {
      nodes: { ...this.nodes },
      wires: { ...this.wires },
      board: this.spec,
    };
  }
}

export const circuit = (): CircuitBuilder => new CircuitBuilder();

export const ref = (node: string, pin: string): PinRef => ({
  node: asNodeId(node) as NodeId,
  pin,
});
