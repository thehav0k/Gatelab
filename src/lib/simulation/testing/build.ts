import type { GateOp } from "../logic";
import {
  asNodeId,
  asWireId,
  type CircuitDocument,
  type CircuitNode,
  type NodeId,
  type PinRef,
  type Wire,
} from "../netlist";

/**
 * A tiny fluent builder for circuits, used by the tests and by the M7 presets.
 * Keeps the test bodies about the circuit under test rather than about object
 * literals.
 */
export class CircuitBuilder {
  private readonly nodes: Record<string, CircuitNode> = {};
  private readonly wires: Record<string, Wire> = {};
  private wireCount = 0;

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

  /** `wire("U1", "Y", "L1", "A")` */
  wire(nodeA: string, pinA: string, nodeB: string, pinB: string): this {
    const id = `w${(this.wireCount += 1)}`;
    this.wires[id] = {
      id: asWireId(id),
      a: { node: asNodeId(nodeA), pin: pinA },
      b: { node: asNodeId(nodeB), pin: pinB },
    };
    return this;
  }

  removeWire(id: string): this {
    delete this.wires[id];
    return this;
  }

  build(): CircuitDocument {
    return { nodes: { ...this.nodes }, wires: { ...this.wires } };
  }
}

export const circuit = (): CircuitBuilder => new CircuitBuilder();

export const ref = (node: string, pin: string): PinRef => ({
  node: asNodeId(node) as NodeId,
  pin,
});
