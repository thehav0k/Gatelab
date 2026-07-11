import type { SimNetlist } from "./elaborate";
import { evalGate, resolveNet, L0, L1, LZ, type Driver, type Logic } from "./logic";

/**
 * The unit-delay timed solver, and the counter-driven waveform on top of it.
 *
 * WHY THIS EXISTS, given that a timing diagram over combinational logic driven by
 * manual switch flips would be nearly content-free:
 *
 * 1. COUNTER-DRIVEN INPUTS. A toggles every 2 ticks, B every 4, C every 8. The
 *    waveform then sweeps all 2^n input combinations over time — it becomes a
 *    logic-analyzer view of the truth table, which is worth looking at.
 *
 * 2. UNIT DELAY. The delta-cycle solver in solver.ts iterates to a fixpoint and
 *    reports only the settled answer. It cannot show a glitch, because a glitch
 *    is a transient that the fixpoint has already swallowed. Here, each gate
 *    takes exactly one tick to respond, so signals arriving by different-length
 *    paths arrive at different times — and STATIC HAZARDS become visible as
 *    momentary spikes on the output.
 *
 * And that is the payoff, because it closes the loop back to the theory module.
 * A minimal SOP can glitch. Adding back the redundant consensus prime implicant —
 * the one Quine-McCluskey discarded precisely BECAUSE it was redundant — removes
 * the glitch. Minimal is not the same as hazard-free, and now you can see it.
 */

export interface TimedOptions {
  /** Gate propagation delay, in ticks. */
  readonly delay?: number;
  /** Ticks to settle before the first input change, so t=0 is not a fake edge. */
  readonly settleTicks?: number;
}

export interface Waveform {
  readonly label: string;
  readonly net: number;
  /** One sample per tick. */
  readonly samples: readonly Logic[];
  readonly isInput: boolean;
}

export interface TimedResult {
  readonly ticks: number;
  readonly waves: readonly Waveform[];
  /**
   * Ticks at which an output pulsed away from its settled value and back — a
   * glitch. Reported per output waveform.
   */
  readonly glitches: readonly { readonly label: string; readonly ticks: readonly number[] }[];
  /** Ticks per held input combination, so the UI can draw the step markers. */
  readonly ticksPerCombination: number;
  /** Total held steps. The sweep runs forward and then back — see simulateTimed. */
  readonly steps: number;
  /** Tick at which the sweep begins (everything before it is the settling period). */
  readonly settleTicks: number;
  /** The input combination held during each step, for aligning the UI. */
  readonly combinations: readonly number[];
}

const DEFAULT_DELAY = 1;

/**
 * Reflected binary (Gray) code. Successive values differ in exactly ONE bit.
 *
 * The same function the K-map uses, and here for the same underlying reason.
 */
const gray = (i: number): number => i ^ (i >>> 1);

/**
 * Drive the inputs from a GRAY-CODE counter and record every net over time.
 *
 * Gray code, not plain binary, and this is load-bearing rather than cosmetic.
 *
 * A binary counter steps 011 -> 100, changing all three inputs at once. Any
 * output transient across a multi-input change is a FUNCTION HAZARD, and function
 * hazards are unavoidable — no amount of redundant logic can remove them, because
 * the function itself is doing something different at the two endpoints. Sweeping
 * in binary therefore produces glitches that look like the ones we want to teach
 * about but cannot be cured, which would make the lesson actively misleading.
 *
 * A Gray counter changes exactly one input per step. The only transients left are
 * LOGIC HAZARDS — caused by unequal path delays inside the gate network, not by
 * the function — and those are exactly the ones a redundant consensus term
 * removes. That is the lesson, and it only exists in Gray order.
 *
 * AND THE SWEEP RUNS FORWARD, THEN BACK. A Gray sequence visits each combination
 * once, so it crosses each adjacent pair in only ONE direction — and a hazard is
 * directional. The classic static-1 in `A·C' + B·C` appears when C FALLS with
 * A=B=1 (the B·C term collapses immediately while A·C' is still waiting on the
 * inverter), and not when C rises. Sweep one way only and you would never see it.
 * Running the palindrome exercises every adjacent transition in both directions,
 * which is exactly what you would do on a bench to hunt for glitches.
 */
export function simulateTimed(
  nl: SimNetlist,
  options: TimedOptions = {},
): TimedResult {
  const delay = Math.max(1, options.delay ?? DEFAULT_DELAY);
  const n = nl.inputs.length;

  if (n === 0 || nl.cells.length === 0) {
    return {
      ticks: 0,
      waves: [],
      glitches: [],
      ticksPerCombination: 0,
      steps: 0,
      settleTicks: 0,
      combinations: [],
    };
  }

  // Each input combination must be held long enough for the deepest path to
  // propagate AND for any glitch to be visible before we move on.
  const depth = longestPath(nl);
  const ticksPerCombination = Math.max(4, (depth + 2) * delay);
  const settle = options.settleTicks ?? ticksPerCombination;

  // Forward through the Gray sequence, then back — see the note above.
  const sweep = 1 << n;
  const steps = 2 * sweep;
  const combinations = Array.from({ length: steps }, (_, s) =>
    gray(s < sweep ? s : steps - 1 - s),
  );
  const ticks = settle + steps * ticksPerCombination;

  const values = new Uint8Array(nl.netCount);
  /** Each cell's output, and the tick at which its currently-pending value lands. */
  const cellOut = new Uint8Array(nl.cells.length).fill(LZ);
  const pending = new Uint8Array(nl.cells.length).fill(LZ);
  const pendingAt = new Int32Array(nl.cells.length).fill(-1);

  const shorted = new Set(nl.railShorts);
  const samples: Logic[][] = Array.from({ length: nl.netCount }, () => []);

  for (let t = 0; t < ticks; t++) {
    // --- 1. the Gray-code input counter, forward then back -----------------
    const phase = Math.max(0, t - settle);
    const stepIndex = Math.min(
      steps - 1,
      Math.floor(phase / ticksPerCombination),
    );
    const combination = combinations[stepIndex] as number;

    const staticDrivers: Driver[][] = nl.railDrivers.map((d) => [...d]);
    nl.inputs.forEach((port, i) => {
      const bit = ((combination >>> (n - 1 - i)) & 1) as 0 | 1;
      (staticDrivers[port.net] as Driver[]).push({
        value: bit === 1 ? L1 : L0,
        strength: "strong",
      });
    });

    // --- 2. resolve nets from the CURRENT cell outputs ---------------------
    for (let net = 0; net < nl.netCount; net++) {
      if (shorted.has(net)) {
        values[net] = 3;
        continue;
      }
      const drivers: Driver[] = [...(staticDrivers[net] as Driver[])];
      for (const cell of nl.cells) {
        if (cell.output === net) {
          drivers.push({ value: cellOut[cell.id] as Logic, strength: "strong" });
        }
      }
      values[net] = resolveNet(drivers);
    }

    for (let net = 0; net < nl.netCount; net++) {
      (samples[net] as Logic[]).push(values[net] as Logic);
    }

    // --- 3. schedule each gate's response, `delay` ticks from now ----------
    //
    // THIS is what makes a glitch possible. In the fixpoint solver every gate
    // updates in the same instant, so a signal that races down a short path and
    // one that takes a long path arrive together and cancel. Here they don't:
    // the short path lands first, the output moves, and only later does the long
    // path arrive and put it back. That momentary spike is the static hazard.
    for (const cell of nl.cells) {
      const want =
        cell.power && !isPowered(cell.power, values)
          ? LZ
          : evalGate(
              cell.op,
              cell.inputs.map((net) => values[net] as Logic),
            );

      if (want !== (pending[cell.id] as Logic)) {
        pending[cell.id] = want;
        pendingAt[cell.id] = t + delay;
      }
    }

    // --- 4. land the responses that are due --------------------------------
    for (const cell of nl.cells) {
      if (pendingAt[cell.id] === t + 1) {
        cellOut[cell.id] = pending[cell.id] as Logic;
      }
    }
  }

  const inputNets = new Set(nl.inputs.map((p) => p.net));
  const waves: Waveform[] = [];

  for (const port of nl.inputs) {
    waves.push({
      label: port.label,
      net: port.net,
      samples: samples[port.net] as Logic[],
      isInput: true,
    });
  }
  for (const port of nl.outputs) {
    if (inputNets.has(port.net)) continue;
    waves.push({
      label: port.label,
      net: port.net,
      samples: samples[port.net] as Logic[],
      isInput: false,
    });
  }

  return {
    ticks,
    waves,
    glitches: waves
      .filter((w) => !w.isInput)
      .map((w) => ({
        label: w.label,
        ticks: findGlitches(w.samples, settle, ticksPerCombination),
      }))
      .filter((g) => g.ticks.length > 0),
    ticksPerCombination,
    steps,
    settleTicks: settle,
    combinations,
  };
}

/**
 * A glitch is a transient: within ONE held input combination, the signal moves
 * away from the value it eventually settles on, and then comes back.
 *
 * We compare each sample against the value at the END of its own window — which
 * is by construction the settled value, since the window is longer than the
 * longest path.
 */
function findGlitches(
  samples: readonly Logic[],
  settle: number,
  windowSize: number,
): number[] {
  const out: number[] = [];

  for (let start = settle; start + windowSize <= samples.length; start += windowSize) {
    const settled = samples[start + windowSize - 1] as Logic;

    // Skip the leading edge — the output is *allowed* to be in transit right
    // after the inputs change. A glitch is a spike AFTER it first arrives.
    let arrived = -1;
    for (let t = start; t < start + windowSize; t++) {
      if (samples[t] === settled) {
        arrived = t;
        break;
      }
    }
    if (arrived < 0) continue;

    for (let t = arrived; t < start + windowSize; t++) {
      if (samples[t] !== settled) out.push(t);
    }
  }

  return out;
}

/** Longest combinational path, in gates. Sets how long each input must be held. */
function longestPath(nl: SimNetlist): number {
  const depth = new Int32Array(nl.netCount);
  // The cells are in construction order, which is close enough to topological
  // for a bound; iterate a few times so feedback does not under-report.
  for (let pass = 0; pass < Math.min(8, nl.cells.length + 1); pass++) {
    for (const cell of nl.cells) {
      const d = Math.max(0, ...cell.inputs.map((net) => depth[net] as number)) + 1;
      if (d > (depth[cell.output] as number)) depth[cell.output] = d;
    }
  }
  return Math.max(1, ...depth);
}

function isPowered(power: { vcc: number; gnd: number }, values: Uint8Array): boolean {
  if (power.vcc < 0 || power.gnd < 0) return false;
  return values[power.vcc] === L1 && values[power.gnd] === L0;
}
