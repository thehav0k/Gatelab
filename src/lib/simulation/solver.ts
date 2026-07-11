import {
  evalGate,
  resolveNet,
  L0,
  L1,
  LX,
  LZ,
  type Driver,
  type Logic,
} from "./logic";
import type { SimNetlist } from "./elaborate";

/**
 * Event-driven, double-buffered delta-cycle solver.
 *
 * WHY NOT A TOPOLOGICAL SORT? Because it requires a DAG, and the user can — and
 * in a digital logic lab, WILL — wire an output back to an input. The moment
 * they cross-couple two NAND gates into a latch, a levelized sort has no valid
 * order at all. An event-driven fixpoint handles feedback natively, and as a
 * bonus it makes a switch toggle cost O(activity) instead of O(whole circuit).
 *
 * THE LOAD-BEARING DETAIL: evaluation reads from `cur` and writes to `next`,
 * then swaps. It does NOT iterate in place.
 *
 * Iterate in place and a cross-coupled latch "settles" to whatever the pop order
 * happened to produce — a different, entirely plausible-looking answer depending
 * on which cell you visited first. Results become irreproducible, tests become
 * flaky, and period-2 oscillation vanishes because it gets absorbed into the
 * iteration order.
 *
 * Double-buffering makes the transition `state[k+1] = f(state[k])` a
 * deterministic pure function of the whole net-value vector. Three things fall
 * out of that:
 *   - reproducible results, hence testable ones;
 *   - period-2 oscillation actually manifests as period-2 oscillation;
 *   - and since the state space is finite (4^nets) and f is deterministic, the
 *     sequence is *provably eventually periodic* — so hash-based cycle detection
 *     is complete, not a heuristic. The iteration cap is then a performance
 *     guard, not a correctness crutch.
 */

export interface SimState {
  /** Net ordinal -> Logic. */
  readonly values: Uint8Array;
  readonly settled: boolean;
  readonly deltaCycles: number;
  /** Net ordinals that never stopped changing. Empty when settled. */
  readonly oscillating: readonly number[];
  /** 0 when settled. */
  readonly period: number;
}

export interface SimOptions {
  readonly maxDeltaCycles?: number;
  /**
   * The initial value of every CELL OUTPUT — which is what a feedback loop
   * starts from, and therefore the only thing that can steer it to one stable
   * state rather than another.
   *
   * (Seeding the *net* array instead would do nothing at all: the first thing
   * the solver does is resolve every net from its drivers, which overwrites it.
   * That mistake made the two-seed memory check below compare two identical
   * runs.)
   *
   * An acyclic circuit converges to the same fixpoint from ANY seed — its
   * outputs are a function of its inputs, full stop. A circuit with memory does
   * not. So running it twice from `L0` and from `L1` and comparing is a sound
   * test for "this thing has state", and that is exactly what verify() does.
   */
  readonly seed?: Logic;
}

const DEFAULT_MAX_CYCLES = 256;

/** Input vector: one bit per `netlist.inputs` entry, in that order. */
export type InputVector = readonly (0 | 1)[];

/**
 * PURE. Fresh buffers, no mutation of the netlist, no reference to the document.
 * This is what the M6 verification sweep calls 2^n times.
 */
export function evaluate(
  nl: SimNetlist,
  inputs: InputVector,
  options: SimOptions = {},
): SimState {
  const maxCycles = options.maxDeltaCycles ?? DEFAULT_MAX_CYCLES;
  const seed = options.seed ?? LZ;

  let cur = new Uint8Array(nl.netCount);
  let next = new Uint8Array(nl.netCount);

  // Drivers that do not depend on any cell: the rails, plus the switches for
  // this particular input vector.
  const staticDrivers: Driver[][] = nl.railDrivers.map((d) => [...d]);
  nl.inputs.forEach((port, i) => {
    const bit = inputs[i];
    if (bit === undefined) return;
    (staticDrivers[port.net] as Driver[]).push({
      value: bit === 1 ? L1 : L0,
      strength: "strong",
    });
  });

  // A cell's current output, so a net can be resolved from all of its drivers
  // without re-evaluating any of them. THIS is what the seed initializes — see
  // SimOptions.seed. Defaults to Z: a gate that has not been evaluated yet
  // drives nothing.
  const cellOut = new Uint8Array(nl.cells.length).fill(seed);

  const shorted = new Set(nl.railShorts);

  const resolve = (net: number, outs: Uint8Array): Logic => {
    // A net shorting Vcc to GND has no honest value. Say X and let diagnostics
    // explain, rather than inventing a level.
    if (shorted.has(net)) return LX;

    const drivers: Driver[] = [...(staticDrivers[net] as Driver[])];
    for (const cellId of cellsDriving(nl, net)) {
      drivers.push({
        value: outs[cellId] as Logic,
        strength: "strong",
      });
    }
    return resolveNet(drivers);
  };

  // Seed every net from its static drivers so rails and switches are live before
  // the first cell is ever evaluated.
  for (let net = 0; net < nl.netCount; net++) {
    cur[net] = resolve(net, cellOut);
  }

  const seen = new Map<string, number>();
  let settled = false;
  let cycles = 0;
  let period = 0;

  for (cycles = 0; cycles < maxCycles; cycles++) {
    // --- 1. evaluate every cell against `cur` ONLY ------------------------
    const nextCellOut = new Uint8Array(cellOut);
    for (const cell of nl.cells) {
      let value: Logic;

      if (cell.power && !isPowered(cell.power, cur)) {
        // An unpowered chip drives nothing. Not 0 — nothing. Boolean logic
        // cannot express this, which is why we are not using boolean logic.
        value = LZ;
      } else {
        value = evalGate(
          cell.op,
          cell.inputs.map((n) => cur[n] as Logic),
        );
      }

      nextCellOut[cell.id] = value;
    }

    // --- 2. resolve every net from the new cell outputs -------------------
    for (let net = 0; net < nl.netCount; net++) {
      next[net] = resolve(net, nextCellOut);
    }

    // --- 3. settled? -------------------------------------------------------
    // This check MUST come before cycle detection below. A fixed point is itself
    // a period-1 cycle — it repeats its own state forever — so a hash check
    // placed first would flag every stable circuit as an oscillator.
    if (equal(cur, next)) {
      cellOut.set(nextCellOut);
      settled = true;
      break;
    }

    // --- 4. cycle detection ------------------------------------------------
    // Because f is deterministic and the state space is finite, a repeated state
    // means we are in a genuine loop (period >= 2), definitively — not a
    // heuristic. Fixed points were already claimed above.
    const key = hash(next);
    const before = seen.get(key);
    if (before !== undefined) {
      period = cycles - before;
      break;
    }
    seen.set(key, cycles);

    cellOut.set(nextCellOut);
    const swap = cur;
    cur = next;
    next = swap;
  }

  if (settled) {
    return {
      values: cur,
      settled: true,
      deltaCycles: cycles,
      oscillating: [],
      period: 0,
    };
  }

  // --- oscillation ---------------------------------------------------------
  // Do NOT nuke the board. Replay the loop, and only the nets that actually took
  // more than one value inside it become X; everything stable keeps its value.
  // A three-inverter ring should turn ITS OWN loop red, not the whole circuit.
  const { values, oscillating } = collapseOscillation(
    nl,
    cur,
    staticDrivers,
    cellOut,
    shorted,
    Math.max(1, period),
  );

  return {
    values,
    settled: false,
    deltaCycles: cycles,
    oscillating,
    period,
  };
}

/**
 * Run the loop once more, note which nets are unstable, pin those to X, then let
 * X propagate downstream one final time — honouring controlling values, so an
 * `AND(0, X)` downstream still yields a clean 0.
 */
function collapseOscillation(
  nl: SimNetlist,
  start: Uint8Array,
  staticDrivers: readonly (readonly Driver[])[],
  cellOut: Uint8Array,
  shorted: ReadonlySet<number>,
  period: number,
): { values: Uint8Array; oscillating: number[] } {
  const resolve = (net: number, outs: Uint8Array): Logic => {
    if (shorted.has(net)) return LX;
    const drivers: Driver[] = [...(staticDrivers[net] as Driver[])];
    for (const cellId of cellsDriving(nl, net)) {
      drivers.push({ value: outs[cellId] as Logic, strength: "strong" });
    }
    return resolveNet(drivers);
  };

  const seenValues: Set<Logic>[] = Array.from(
    { length: nl.netCount },
    (_, net) => new Set<Logic>([start[net] as Logic]),
  );

  let cur = new Uint8Array(start);
  let outs = new Uint8Array(cellOut);

  for (let step = 0; step < period; step++) {
    const nextOuts = new Uint8Array(outs);
    for (const cell of nl.cells) {
      nextOuts[cell.id] =
        cell.power && !isPowered(cell.power, cur)
          ? LZ
          : evalGate(
              cell.op,
              cell.inputs.map((n) => cur[n] as Logic),
            );
    }

    const nextValues = new Uint8Array(nl.netCount);
    for (let net = 0; net < nl.netCount; net++) {
      nextValues[net] = resolve(net, nextOuts);
      (seenValues[net] as Set<Logic>).add(nextValues[net] as Logic);
    }

    cur = nextValues;
    outs = nextOuts;
  }

  const oscillating: number[] = [];
  const values = new Uint8Array(cur);
  for (let net = 0; net < nl.netCount; net++) {
    if ((seenValues[net] as Set<Logic>).size > 1) {
      oscillating.push(net);
      values[net] = LX;
    }
  }

  // One settling pass so X reaches the gates downstream of the loop.
  for (let pass = 0; pass < 2; pass++) {
    const nextOuts = new Uint8Array(outs);
    for (const cell of nl.cells) {
      nextOuts[cell.id] =
        cell.power && !isPowered(cell.power, values)
          ? LZ
          : evalGate(
              cell.op,
              cell.inputs.map((n) => values[n] as Logic),
            );
    }
    for (let net = 0; net < nl.netCount; net++) {
      if (oscillating.includes(net)) continue; // stays pinned to X
      values[net] = resolve(net, nextOuts);
    }
    outs = nextOuts;
  }

  return { values, oscillating };
}

/** An IC is powered iff its Vcc pin resolves to 1 and its GND pin to 0. */
function isPowered(
  power: { vcc: number; gnd: number },
  values: Uint8Array,
): boolean {
  if (power.vcc < 0 || power.gnd < 0) return false; // pin not on any net at all
  return values[power.vcc] === L1 && values[power.gnd] === L0;
}

/**
 * Which cells drive this net. Derived rather than cached — the cell count is
 * small and this keeps SimNetlist free of a redundant index that could drift.
 */
function cellsDriving(nl: SimNetlist, net: number): number[] {
  const out: number[] = [];
  for (const cell of nl.cells) {
    if (cell.output === net) out.push(cell.id);
  }
  return out;
}

const equal = (a: Uint8Array, b: Uint8Array): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** FNV-1a over the value vector. Only needs to be a good map key. */
function hash(values: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    h ^= values[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export { LX, LZ, L0, L1 };
