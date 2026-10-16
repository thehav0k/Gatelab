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
import type { SimFlop, SimNetlist } from "./elaborate";
import {
  asStored,
  asyncOutputs,
  clockedNext,
  heldOutputs,
  isEdge,
  UNKNOWN,
} from "./sequential";

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
  /** What every flip-flop is storing now. Feed it back in for the next step. */
  readonly state: SeqState;
  /** How many flip-flops loaded during this evaluation. */
  readonly edges: number;
}

/**
 * Everything the circuit remembers between evaluations.
 *
 * `clk` is not an optimisation — it is the only place an EDGE can live. A
 * fixpoint sees levels; by the time it has settled, the transition that caused
 * the settle is over and unrecoverable. Keeping each flip-flop's view of its own
 * clock from the end of the previous evaluation is what lets the next one say
 * "that went from 0 to 1".
 */
export interface SeqState {
  /** Per flip-flop, the stored Q. */
  readonly q: Uint8Array;
  /** Per flip-flop, its clock net's value at the end of the last evaluation. */
  readonly clk: Uint8Array;
}

/**
 * A circuit that has not been clocked yet.
 *
 * Q starts UNKNOWN, not 0. A real flip-flop powers up in whichever state the
 * metastability fell into — which is the entire reason every counter ever built
 * has a clear wired to it. Starting at 0 would make a missing reset invisible,
 * which is the same mistake as reading a floating input as false.
 */
export const initialState = (nl: SimNetlist): SeqState => ({
  q: new Uint8Array(nl.flops.length).fill(UNKNOWN),
  clk: new Uint8Array(nl.flops.length).fill(LZ),
});

export const cloneState = (state: SeqState): SeqState => ({
  q: new Uint8Array(state.q),
  clk: new Uint8Array(state.clk),
});

/**
 * The stored state, keyed by WHICH FLIP-FLOP rather than by array position.
 *
 * The netlist is rebuilt from the document on every simulation, so a flip-flop's
 * index in `nl.flops` is only as stable as the document's node order — add a
 * chip and every index after it shifts. Carrying the state across in an array
 * would then hand flip-flop 3's bit to flip-flop 4, which is a memory circuit
 * silently changing its mind about what it remembered. The identity of a
 * flip-flop is its package and its slot, so that is the key.
 *
 * Plain JSON, so it survives `persist` and a page reload.
 */
export type StoredState = Readonly<Record<string, readonly [Logic, Logic]>>;

const keyOf = (flop: SimFlop): string => `${flop.owner.node}/${flop.owner.slot}`;

export function toSeqState(nl: SimNetlist, stored: StoredState | undefined): SeqState {
  const state = initialState(nl);
  if (!stored) return state;
  for (const flop of nl.flops) {
    const saved = stored[keyOf(flop)];
    if (!saved) continue;
    state.q[flop.id] = saved[0];
    state.clk[flop.id] = saved[1];
  }
  return state;
}

export function fromSeqState(nl: SimNetlist, state: SeqState): StoredState {
  const out: Record<string, readonly [Logic, Logic]> = {};
  for (const flop of nl.flops) {
    out[keyOf(flop)] = [state.q[flop.id] as Logic, state.clk[flop.id] as Logic];
  }
  return out;
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
  /** What the flip-flops were storing. Omit to start from power-up. */
  readonly state?: SeqState;
  /**
   * Override each clock's level, positionally against `netlist.clocks`.
   *
   * Without this, driving a clock would mean editing the document and
   * re-elaborating — fine for a button press, hopeless for a timing sweep that
   * moves it a thousand times.
   */
  readonly clocks?: readonly (0 | 1)[];
}

const DEFAULT_MAX_CYCLES = 256;

/** Input vector: one bit per `netlist.inputs` entry, in that order. */
export type InputVector = readonly (0 | 1)[];

/**
 * PURE. Fresh buffers, no mutation of the netlist, no reference to the document.
 * This is what the M6 verification sweep calls 2^n times.
 *
 * SETTLE, LOOK FOR EDGES, SETTLE AGAIN.
 *
 * With no flip-flops in the circuit this is exactly one settle and nothing
 * else — the combinational path is untouched. With flip-flops it becomes a
 * short outer loop, and the loop is not an implementation detail: it is what a
 * RIPPLE counter is. Stage 0 toggles, and stage 0's own output is stage 1's
 * clock, so the edge that advances stage 1 does not exist until stage 0 has
 * already moved. One pass per stage, in order, is the delay you can see on a
 * real ripple counter's scope trace.
 *
 * Inside any one settle a flip-flop is a CONSTANT — it drives what it is
 * storing — so the fixpoint keeps being a pure function of the net vector and
 * every property that rested on that still holds.
 */
export function evaluate(
  nl: SimNetlist,
  inputs: InputVector,
  options: SimOptions = {},
): SimState {
  const state = cloneState(options.state ?? initialState(nl));
  if (nl.flops.length === 0) {
    return { ...settle(nl, inputs, options, state), state, edges: 0 };
  }

  // One pass per flip-flop is enough for the longest possible ripple, plus one
  // to confirm that nothing moved. More than that is a circuit clocking itself
  // — a ring oscillator — and it is reported rather than looped on forever.
  const maxPasses = nl.flops.length + 2;
  let last = settle(nl, inputs, options, state);
  let edges = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const moved = advance(nl, last.values, state);
    edges += moved;
    if (moved === 0) return { ...last, state, edges };
    last = settle(nl, inputs, options, state);
  }

  return { ...last, settled: false, state, edges };
}

/**
 * Apply one round of asynchronous overrides and clock edges to the stored state.
 *
 * Returns how many flip-flops actually loaded, which is the loop's termination
 * condition above.
 */
function advance(nl: SimNetlist, values: Uint8Array, state: SeqState): number {
  let moved = 0;

  for (const flop of nl.flops) {
    const clockNow = values[flop.clock] as Logic;
    const wasClock = state.clk[flop.id] as Logic;
    state.clk[flop.id] = clockNow;

    if (flop.power && !isPowered(flop.power, values)) {
      // An unpowered flip-flop is not holding anything. It has no supply to
      // hold it with, and saying it still remembers the last value would be the
      // same lie as an unpowered gate driving a clean 0.
      state.q[flop.id] = UNKNOWN;
      continue;
    }

    // Preset and clear are LEVEL-sensitive and outrank the clock, so they are
    // applied first and they write the stored bit — otherwise releasing clear
    // would reveal whatever was underneath it.
    const async = asyncOutputs(asyncOf(flop, values));
    if (async) {
      const forced = asStored(async.q);
      if (state.q[flop.id] !== forced) moved += 1;
      state.q[flop.id] = forced;
      continue;
    }

    if (!isEdge(flop.edge, wasClock, clockNow)) continue;

    const before = state.q[flop.id] as Logic;
    const after = asStored(
      clockedNext(flop.kind, flop.data.map((n) => values[n] as Logic), before),
    );
    state.q[flop.id] = after;
    if (after !== before) moved += 1;
  }

  return moved;
}

const asyncOf = (flop: SimFlop, values: Uint8Array) => ({
  preset: flop.preset === null ? null : ((values[flop.preset] ?? LZ) as Logic),
  clear: flop.clear === null ? null : ((values[flop.clear] ?? LZ) as Logic),
});

/** What a flip-flop is driving right now, given the levels on its async pins. */
function flopOutputs(flop: SimFlop, values: Uint8Array, q: Logic) {
  if (flop.power && !isPowered(flop.power, values)) return { q: LZ, qn: LZ };
  return asyncOutputs(asyncOf(flop, values)) ?? heldOutputs(q);
}

/** One combinational settle, with every flip-flop held at its stored value. */
function settle(
  nl: SimNetlist,
  inputs: InputVector,
  options: SimOptions,
  state: SeqState,
): Omit<SimState, "state" | "edges"> {
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
  nl.clocks.forEach((port, i) => {
    const bit = options.clocks?.[i] ?? port.state;
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

  // Which flip-flop outputs land on which net. Built once per settle, because
  // unlike a cell a flip-flop drives TWO nets and the pair is not always
  // complementary — hold preset and clear together and both go high.
  const flopDrivers = driverIndex(nl);
  // A flip-flop's contribution, recomputed each delta cycle from `cur` because
  // its async pins are level-sensitive.
  let flopOut = flopDrive(nl, cur, state);

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
    for (const slot of flopDrivers[net] ?? []) {
      drivers.push({ value: flopOut[slot] as Logic, strength: "strong" });
    }
    return resolveNet(drivers);
  };

  // Seed every net from its static drivers so rails and switches are live before
  // the first cell is ever evaluated.
  for (let net = 0; net < nl.netCount; net++) {
    cur[net] = resolve(net, cellOut);
  }
  flopOut = flopDrive(nl, cur, state);

  const seen = new Map<string, number>();
  let settled = false;
  let cycles = 0;
  let period = 0;

  for (cycles = 0; cycles < maxCycles; cycles++) {
    // --- 1. evaluate every cell against `cur` ONLY ------------------------
    flopOut = flopDrive(nl, cur, state);
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
    flopDrivers,
    flopOut,
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
  flopDrivers: readonly (readonly number[] | undefined)[] = [],
  flopOut: Uint8Array = new Uint8Array(),
): { values: Uint8Array; oscillating: number[] } {
  const resolve = (net: number, outs: Uint8Array): Logic => {
    if (shorted.has(net)) return LX;
    const drivers: Driver[] = [...(staticDrivers[net] as Driver[])];
    for (const cellId of cellsDriving(nl, net)) {
      drivers.push({ value: outs[cellId] as Logic, strength: "strong" });
    }
    for (const slot of flopDrivers[net] ?? []) {
      drivers.push({ value: flopOut[slot] as Logic, strength: "strong" });
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
 * Net -> the flip-flop output slots landing on it.
 *
 * Two slots per flip-flop, `2i` for Q and `2i+1` for Q-bar, so one flat array
 * indexes both without a second structure. A package with no complementary
 * output simply never registers its odd slot.
 */
function driverIndex(nl: SimNetlist): (number[] | undefined)[] {
  const index: (number[] | undefined)[] = new Array(nl.netCount);
  const put = (net: number, slot: number) => {
    const list = index[net] ?? [];
    list.push(slot);
    index[net] = list;
  };
  for (const flop of nl.flops) {
    put(flop.q, flop.id * 2);
    if (flop.qn !== null) put(flop.qn, flop.id * 2 + 1);
  }
  return index;
}

/** Every flip-flop's two output values, against the current net vector. */
function flopDrive(nl: SimNetlist, values: Uint8Array, state: SeqState): Uint8Array {
  const out = new Uint8Array(nl.flops.length * 2);
  for (const flop of nl.flops) {
    const driven = flopOutputs(flop, values, state.q[flop.id] as Logic);
    out[flop.id * 2] = driven.q;
    out[flop.id * 2 + 1] = driven.qn;
  }
  return out;
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
