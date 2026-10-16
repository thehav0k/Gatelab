import type { SimNetlist } from "./elaborate";
import { evaluate, initialState, type SeqState } from "./solver";
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
  /** Clock cycles to run, for a clocked circuit. Ignored by the input sweep. */
  readonly cycles?: number;
  /**
   * Where the flip-flops are NOW.
   *
   * The chart answers "what happens over the next few cycles", and that
   * question has no answer independent of where the circuit currently is. Left
   * out, it starts from power-up — every stored bit unknown — which is exactly
   * what an uncleared counter really does, and exactly what the chart should
   * show when that is the truth.
   */
  readonly state?: SeqState;
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
  /**
   * Set when the circuit has too many inputs to sweep, instead of a waveform.
   *
   * A COMPLETE sweep or none, and never a partial one presented as a whole.
   * The two things this chart claims — "here is every input combination" and
   * "no output glitches" — are both claims about the WHOLE input space, and a
   * chart drawn from the first 128 combinations of 131,072 would be making both
   * of them falsely.
   */
  readonly tooWide?: { readonly inputs: number; readonly combinations: number };
  /**
   * Set when the chart was driven by the CLOCK rather than by an input sweep.
   *
   * The two charts answer different questions and must not be confused for one
   * another. A sweep says "here is the output for every input combination" —
   * a statement about a function. A clocked chart says "here is what happened
   * over these clock cycles" — a statement about a sequence, which is the only
   * thing a circuit with memory has.
   */
  readonly clocked?: { readonly cycles: number };
}

const DEFAULT_DELAY = 1;

/**
 * The most inputs this will sweep. 2^7 combinations, forward and back, is 256
 * held steps — already a chart you have to scroll.
 *
 * There was no limit at all, and every term of the cost is exponential: the
 * 4-bit ripple adder's 9 inputs produced an 11,275-tick chart 79,000 pixels
 * wide, which had no chance of being read and — because a wide child of a CSS
 * grid track widens the track — pushed the schematic, the fault panel and half
 * the page off the side of the window. Its 8-bit sibling asked for 262,144
 * steps and never returned; the 16-bit one asked for 17 billion and threw.
 *
 * The presets that ask for those are legitimate circuits. It is the SWEEP that
 * does not scale, so the sweep is what says no.
 */
export const MAX_SWEEP_INPUTS = 7;

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

  const nothing: TimedResult = {
    ticks: 0,
    waves: [],
    glitches: [],
    ticksPerCombination: 0,
    steps: 0,
    settleTicks: 0,
    combinations: [],
  };

  // A circuit with memory has no truth table to sweep, so the clock drives the
  // chart instead. This is not a fallback — it is the right chart for the
  // circuit, and the one a counter is always drawn with.
  if (nl.flops.length > 0) return simulateClocked(nl, options);

  if (n === 0 || nl.cells.length === 0) return nothing;

  // Refuse before allocating anything. `2 ** 33` steps is not a slow sweep, it
  // is an `Array.from` that throws — and the failure landed as an empty lab
  // with no explanation of what had happened to the circuit.
  if (n > MAX_SWEEP_INPUTS) {
    return { ...nothing, tooWide: { inputs: n, combinations: 2 ** n } };
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


// ---------------------------------------------------------------------------
// Clocked circuits
// ---------------------------------------------------------------------------

/** How many clock cycles a clocked chart runs for. Enough to see a 4-bit count. */
const DEFAULT_CYCLES = 18;
/** Ticks per half cycle. Only affects how wide the drawn pulses are. */
const HALF = 3;

/**
 * The waveform of a clocked circuit: drive the clock, watch the state.
 *
 * SAMPLED SETTLED, ONCE PER TICK. The combinational chart above models a unit
 * gate delay explicitly, because its whole purpose is to show a glitch — a
 * transient that only exists between gate delays. This one has a different
 * purpose and makes a different, weaker claim: each sample is the circuit after
 * it has finished reacting. A ripple counter's stages really do settle at
 * different moments and this chart does not show that, so it does not say it
 * does; what it shows is the count, which is what a counter's timing diagram is
 * for.
 *
 * The switches are held at whatever the document has them at. Sweeping them
 * would be sweeping inputs of a circuit whose output is not a function of its
 * inputs.
 */
function simulateClocked(nl: SimNetlist, options: TimedOptions): TimedResult {
  const cycles = options.cycles ?? DEFAULT_CYCLES;
  const ticks = cycles * HALF * 2;

  // Held where the user left them. Zeroing them would assert every active-low
  // clear on the board, and a counter that is permanently cleared counts zero.
  const inputs = nl.inputs.map((port) => port.state ?? 0);
  const samples: Logic[][] = Array.from({ length: nl.netCount }, () => []);

  // Start from power-up and let the first tick establish the clock's resting
  // level, exactly as the app does when a circuit is loaded.
  let state = options.state ?? initialState(nl);

  for (let t = 0; t < ticks; t++) {
    const high = Math.floor(t / HALF) % 2 === 1;
    const result = evaluate(nl, inputs, {
      state,
      clocks: nl.clocks.map(() => (high ? 1 : 0)),
    });
    state = result.state;
    for (let net = 0; net < nl.netCount; net++) {
      (samples[net] as Logic[]).push(result.values[net] as Logic);
    }
  }

  const waves: Waveform[] = [
    ...nl.clocks.map((port) => ({
      label: port.label,
      net: port.net,
      samples: samples[port.net] as Logic[],
      isInput: true,
    })),
    ...nl.inputs.map((port) => ({
      label: port.label,
      net: port.net,
      samples: samples[port.net] as Logic[],
      isInput: true,
    })),
    ...nl.outputs.map((port) => ({
      label: port.label,
      net: port.net,
      samples: samples[port.net] as Logic[],
      isInput: false,
    })),
  ];

  return {
    ticks,
    waves,
    // A glitch is a transient between gate delays, and this chart does not
    // model gate delays. Reporting an empty list would be a claim; reporting
    // nothing at all is the honest shape.
    glitches: [],
    ticksPerCombination: HALF * 2,
    steps: cycles,
    settleTicks: 0,
    combinations: [],
    clocked: { cycles },
  };
}
