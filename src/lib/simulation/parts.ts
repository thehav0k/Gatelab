import type { GateOp } from "./logic";
import type { CircuitNode, PinSpec, Point } from "./netlist";

/**
 * What each node kind looks like, electrically and geometrically.
 *
 * Three resolvers, deliberately separate:
 *   - pinsOf    : the pins a node exposes (netlist + rendering + hit-testing)
 *   - cellsOf   : the logic gates inside it (what the solver evaluates)
 *   - powerOf   : which pins must be at Vcc/GND for it to work at all
 *
 * A schematic gate primitive is *ideal*: one cell, no power pins. A 74xx DIP is
 * four cells and two power pins. Keeping the three resolvers separate is what
 * lets M4 add the IC library without touching the netlist builder or the solver.
 */

export const GATE_W = 64;
export const GATE_H = 48;
export const IO_W = 44;
export const IO_H = 32;

/** One gate inside a node. An IC has several; a gate primitive has one. */
export interface CellTemplate {
  readonly slot: number;
  readonly op: GateOp;
  readonly inputPins: readonly string[];
  readonly outputPin: string;
}

export interface PowerPins {
  readonly vcc: string;
  readonly gnd: string;
}

/** Gate primitives are ideal — they need no supply and cannot be unpowered. */
export const GATE_OPS: readonly GateOp[] = [
  "and",
  "or",
  "not",
  "nand",
  "nor",
  "xor",
  "xnor",
  "buf",
];

export const GATE_LABELS: Readonly<Record<GateOp, string>> = {
  and: "AND",
  or: "OR",
  not: "NOT",
  nand: "NAND",
  nor: "NOR",
  xor: "XOR",
  xnor: "XNOR",
  buf: "BUF",
};

/** NOT and BUF take exactly one input, whatever arity says. */
export const arityOf = (op: GateOp, requested: number): number =>
  op === "not" || op === "buf" ? 1 : Math.max(2, requested);

export const gateInputNames = (arity: number): string[] =>
  Array.from({ length: arity }, (_, i) => String.fromCharCode(65 + i));

/** Where a gate's input pins sit on its left edge, evenly spread. */
export function gateInputOffset(index: number, arity: number): Point {
  const spacing = GATE_H / (arity + 1);
  return { x: 0, y: spacing * (index + 1) };
}

export const gateOutputOffset = (): Point => ({ x: GATE_W, y: GATE_H / 2 });

/**
 * The pins a node exposes. IC nodes delegate to the library registered below,
 * which is empty until M4 — hence the `icPins` indirection rather than a direct
 * import (which would be a cycle).
 */
export function pinsOf(node: CircuitNode): readonly PinSpec[] {
  switch (node.kind) {
    case "gate": {
      const arity = arityOf(node.op, node.arity);
      const inputs: PinSpec[] = gateInputNames(arity).map((name, i) => ({
        number: 0,
        name,
        dir: "in",
        strength: "hiz",
        offset: gateInputOffset(i, arity),
      }));
      return [
        ...inputs,
        {
          number: 0,
          name: "Y",
          dir: "out",
          strength: "strong",
          offset: gateOutputOffset(),
        },
      ];
    }

    case "switch":
      return [
        {
          number: 0,
          name: "Y",
          dir: "out",
          strength: "strong",
          offset: { x: IO_W, y: IO_H / 2 },
        },
      ];

    case "led":
      return [
        {
          number: 0,
          name: "A",
          dir: "in",
          strength: "hiz",
          offset: { x: 0, y: IO_H / 2 },
        },
      ];

    case "rail":
      return [
        {
          number: 0,
          name: node.rail === "vcc" ? "VCC" : "GND",
          // A rail DRIVES at supply strength. It is not a passive label.
          dir: node.rail === "vcc" ? "pwr" : "gnd",
          strength: "supply",
          offset: { x: IO_W / 2, y: node.rail === "vcc" ? IO_H : 0 },
        },
      ];

    case "ic":
      return icRegistry.pins(node.part);
  }
}

/** The gates inside a node — what the solver actually evaluates. */
export function cellsOf(node: CircuitNode): readonly CellTemplate[] {
  switch (node.kind) {
    case "gate": {
      const arity = arityOf(node.op, node.arity);
      return [
        {
          slot: 0,
          op: node.op,
          inputPins: gateInputNames(arity),
          outputPin: "Y",
        },
      ];
    }
    case "ic":
      return icRegistry.cells(node.part);
    case "switch":
    case "led":
    case "rail":
      return [];
  }
}

/**
 * The supply pins a node needs. Null means "ideal, cannot be unpowered".
 *
 * This is the seam that makes UNPOWERED_IC possible: a schematic gate has no
 * power pins to forget, but a 7408 has two, and forgetting pin 14 is the single
 * most common lab mistake there is.
 */
export function powerOf(node: CircuitNode): PowerPins | null {
  return node.kind === "ic" ? icRegistry.power(node.part) : null;
}

// ---------------------------------------------------------------------------
// IC registry — populated in M4. Kept behind an indirection so parts.ts does not
// import the library and the library can import parts.ts's types.
// ---------------------------------------------------------------------------

export interface IcRegistry {
  pins(part: string): readonly PinSpec[];
  cells(part: string): readonly CellTemplate[];
  power(part: string): PowerPins | null;
  has(part: string): boolean;
}

const missing = (part: string): never => {
  throw new Error(`Unknown IC part "${part}" — no IC library is registered.`);
};

let icRegistry: IcRegistry = {
  pins: missing,
  cells: missing,
  power: missing,
  has: () => false,
};

export function registerIcLibrary(registry: IcRegistry): void {
  icRegistry = registry;
}
