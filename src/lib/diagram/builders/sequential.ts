import { evaluate, format, parse } from "@/lib/core-engine";
import { synthesize, technologyMap, type GateNetlist } from "@/lib/simulation/synth";
import * as C from "../catalog";
import type { Diagram, DiagramGateOp, Endpoint, TimingChart, Waveform } from "../types";
import { Sketch, at } from "./kit";

/**
 * Counters, flip-flops and sequential design.
 *
 * The one thing every builder here has to get right is the DIRECTION OF TIME.
 * A sequential circuit's defining feature is that an output comes back round to
 * an input, and that loop is the answer to the question — so it must be drawn as
 * a loop: out of Q, round the outside, back into the logic. The layout engine
 * detects those as back edges and routes them underneath (see `layout.ts`),
 * which is exactly how they are drawn on paper, and for the same reason: a
 * feedback path that runs through the middle of the diagram reads as a forward
 * signal and the circuit looks combinational.
 */

const PIN = "ABCDEFGHIJKLMNOP";

// --- ripple (asynchronous) counter ------------------------------------------

export interface RippleCounterOptions {
  readonly bits: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
  readonly down?: boolean;
  readonly withTiming?: boolean;
}

/**
 * A ripple counter: n toggle flip-flops, each clocked by the one below it.
 *
 * There is no combinational logic at all — which is the entire appeal, and the
 * entire problem. Bit 1 cannot change until bit 0 has, so after n stages the
 * count is wrong for n propagation delays after every clock edge, and any gate
 * decoding those outputs sees a burst of invalid states. That is what the timing
 * diagram below shows, and it is why this is not used above a few bits.
 */
export function rippleCounterDiagram(opts: RippleCounterOptions): Diagram {
  const s = new Sketch();
  const bits = opts.bits;

  const clk = s.add(C.input("CLK", "CLK"));
  const one = s.add(C.constant("HI", 1));

  for (let i = 0; i < bits; i++) {
    const ff = s.add({
      ...C.flipFlop(`FF${i}`, "jk", {
        title: `FF${i}`,
        clear: true,
        negativeEdge: true,
      }),
      row: i,
    });
    s.wire(at(one, "Y"), at(ff, "J"));
    s.wire(at(one, "Y"), at(ff, "K"));

    // Bit 0 is clocked by the system clock. Every other bit is clocked by the
    // stage below — from Q for an UP counter on falling edges, from Q' for a
    // DOWN counter. Swapping those two is the classic sign error here.
    if (i === 0) {
      s.wire(at(clk, "Y"), at(ff, "CLK"));
    } else {
      s.wire(at(`FF${i - 1}`, opts.down ? "QN" : "Q"), at(ff, "CLK"));
    }

    const out = s.add(C.output(`Q${i}`, `Q${i}`));
    s.wire(at(ff, "Q"), at(out, "A"));
  }

  const clr = s.add(C.input("CLR", "CLR"));
  for (let i = 0; i < bits; i++) s.wire(at(clr, "Y"), at(`FF${i}`, "CLR"));

  s.note("J = K = 1 makes every flip-flop a toggle: each clock edge inverts its Q.");
  s.note(
    `Only FF0 sees the system clock. FF${1} is clocked by FF0's ${opts.down ? "Q'" : "Q"}, and so on up the chain — the clock RIPPLES.`,
  );
  s.note(
    `There is no combinational logic, which is why this is the cheapest counter to build and the worst to decode: after each edge the outputs are briefly wrong for up to ${bits} flip-flop delays.`,
  );

  const timing = opts.withTiming === false ? undefined : rippleTiming(bits);
  return s.done({
    id: opts.id ?? `ripple${bits}`,
    title: opts.title ?? `${bits}-bit asynchronous (ripple) ${opts.down ? "down " : ""}counter`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
    ...(timing !== undefined ? { timing } : {}),
  });
}

/**
 * The waveform that makes "asynchronous" mean something.
 *
 * Each trace is drawn shifted a little further right than the one below it.
 * That skew is not an artistic choice — it is the propagation delay, it
 * accumulates down the chain, and a timing diagram that draws every edge aligned
 * has drawn a SYNCHRONOUS counter and mislabelled it.
 */
export function rippleTiming(bits: number, periods?: number): TimingChart {
  // Show the whole cycle when it fits in a sensible width, so the roll-over
  // marker has something to point at; otherwise show a window of it.
  const cycles = periods ?? Math.min(16, 1 << bits);
  const samples = cycles * 2 + 1;
  const waves: Waveform[] = [
    {
      label: "CLK",
      values: Array.from({ length: samples }, (_, t) => (t % 2 === 0 ? 1 : 0) as 0 | 1),
      tone: "clock",
    },
  ];

  for (let b = 0; b < bits; b++) {
    waves.push({
      label: `Q${b}`,
      values: Array.from(
        { length: samples },
        (_, t) => ((Math.floor(t / 2) >>> b) & 1) as 0 | 1,
      ),
      // One flip-flop delay per stage, accumulating. Bit 0 lags the clock edge;
      // bit 3 lags it by four.
      delay: (b + 1) * 0.1,
      tone: "derived",
    });
  }

  return {
    title: `${bits}-bit ripple counter — timing`,
    waves,
    markers: [{ tick: 2 * (1 << bits), label: "rolls over" }].filter(
      (m) => m.tick <= samples,
    ),
    caption:
      "Every trace is drawn one flip-flop delay later than the one above it. The skew accumulates, so the whole count is momentarily wrong after each clock edge.",
  };
}

// --- synchronous counter ----------------------------------------------------

/**
 * A synchronous counter: every flip-flop on the SAME clock, with AND gates
 * deciding which ones toggle.
 *
 * Bit k toggles exactly when every lower bit is already 1 — which is just what
 * "carry" means in binary counting, made into a gate. The cost is that chain of
 * ANDs; the benefit is that all outputs change together, so a decoder on them
 * never sees an intermediate state.
 */
export function syncCounterDiagram(opts: {
  readonly bits: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const bits = opts.bits;
  const clk = s.add(C.input("CLK", "CLK"));
  const one = s.add(C.constant("HI", 1));

  const q: Endpoint[] = [];
  for (let i = 0; i < bits; i++) {
    const ff = s.add({
      ...C.flipFlop(`FF${i}`, "t", { title: `FF${i}`, clear: true }),
      row: i,
    });
    s.wire(at(clk, "Y"), at(ff, "CLK"));
    q.push(at(ff, "Q"));
    const out = s.add(C.output(`Q${i}`, `Q${i}`));
    s.wire(at(ff, "Q"), at(out, "A"));
  }

  for (let i = 0; i < bits; i++) {
    if (i === 0) {
      s.wire(at(one, "Y"), at(`FF0`, "T"));
      continue;
    }
    if (i === 1) {
      s.wire(q[0] as Endpoint, at(`FF1`, "T"));
      continue;
    }
    const g = s.add(C.gate(`and${i}`, "and", i, `T${i}`));
    for (let k = 0; k < i; k++) {
      const pin = PIN[k];
      if (pin) s.wire(q[k] as Endpoint, at(g, pin));
    }
    s.wire(at(g, "Y"), at(`FF${i}`, "T"));
  }

  s.note("Every flip-flop is clocked by the SAME edge — that is what synchronous means.");
  s.note(
    "Bit k toggles only when bits 0..k-1 are all 1, which is exactly the carry condition in binary counting. Those AND gates are the price of the speed.",
  );
  s.note(
    "All outputs change together, so the total delay is one flip-flop plus one gate no matter how wide the counter is — unlike a ripple counter, where it grows with every bit.",
  );

  return s.done({
    id: opts.id ?? `sync${bits}`,
    title: opts.title ?? `${bits}-bit synchronous binary counter`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- counters that do not count 0,1,2,3… ------------------------------------

/**
 * A counter that steps by 2^shift — "count only even numbers 0 to 14". (Q29.)
 *
 * The move that makes this trivial: do not build a counter that adds 2. Build an
 * ordinary counter with `states` states, call its outputs the HIGH bits of the
 * answer, and hard-wire the bottom `shift` bits to 0. An n-bit number whose low
 * bit is permanently 0 is an even number, always, with no decoding logic at all.
 */
export function steppedCounterDiagram(opts: {
  readonly states: number;
  readonly shift: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const stateBits = Math.ceil(Math.log2(opts.states));
  const shift = opts.shift;
  const clk = s.add(C.input("CLK", "CLK"));
  const one = s.add(C.constant("HI", 1));

  for (let i = 0; i < stateBits; i++) {
    const ff = s.add({
      ...C.flipFlop(`FF${i}`, "t", { title: `FF${i}`, clear: true }),
      row: i,
    });
    s.wire(at(clk, "Y"), at(ff, "CLK"));
    const out = s.add(C.output(`Q${i + shift}`, `Q${i + shift}`));
    s.wire(at(ff, "Q"), at(out, "A"));
  }
  for (let i = 0; i < stateBits; i++) {
    if (i === 0) s.wire(at(one, "Y"), at("FF0", "T"));
    else if (i === 1) s.wire(at("FF0", "Q"), at("FF1", "T"));
    else {
      const g = s.add(C.gate(`and${i}`, "and", i, `T${i + shift}`));
      for (let k = 0; k < i; k++) {
        const pin = PIN[k];
        if (pin) s.wire(at(`FF${k}`, "Q"), at(g, pin));
      }
      s.wire(at(g, "Y"), at(`FF${i}`, "T"));
    }
  }

  for (let b = 0; b < shift; b++) {
    const z = s.add(C.constant(`z${b}`, 0));
    const out = s.add(C.output(`Q${b}`, `Q${b}`));
    s.wire(at(z, "Y"), at(out, "A"));
  }

  const step = 1 << shift;
  const last = (opts.states - 1) * step;
  s.note(
    `The sequence is 0, ${step}, ${2 * step}, … ${last} — ${opts.states} values, so only ${stateBits} flip-flops are needed.`,
  );
  s.note(
    `Q${shift - 1}..Q0 are tied to GND. A number whose low ${shift} bit${shift === 1 ? " is" : "s are"} permanently 0 is a multiple of ${step} by construction — no decoding, no gates, nothing to get wrong.`,
  );
  s.note(
    `The counter itself is an ordinary mod-${opts.states} binary counter; only the labelling of its outputs changes.`,
  );

  return s.done({
    id: opts.id ?? `stepped${opts.states}x${1 << shift}`,
    title:
      opts.title ??
      `Counter: 0, ${step}, … ${last} (${opts.states} states, step ${step})`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

/**
 * A mod-N counter made by decoding N and clearing. The workhorse answer for
 * "design a counter that counts 0 to N-1" at any N that is not a power of two.
 */
export function modNCounterDiagram(opts: {
  readonly modulus: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const n = opts.modulus;
  const bits = Math.ceil(Math.log2(n));

  const clk = s.add(C.input("CLK", "CLK"));
  const cnt = s.add(
    C.counter("CNT", bits, {
      clear: true,
      title: `${bits}-bit counter`,
      subtitle: "synchronous, async clear",
    }),
  );
  s.wire(at(clk, "Y"), at(cnt, "CLK"));

  // Decode N itself — the first count that must not persist.
  const ones: number[] = [];
  for (let i = 0; i < bits; i++) if ((n >>> i) & 1) ones.push(i);

  const op: DiagramGateOp = ones.length === 1 ? "not" : "nand";
  const g = s.add(C.gate("DET", op, Math.max(1, ones.length), `detect ${n}`));
  ones.forEach((bit, k) => {
    const pin = PIN[k];
    if (pin) s.wire(at(cnt, `Q${bit}`), at(g, pin));
  });
  s.wire(at(g, "Y"), at(cnt, "CLR"));

  for (let i = bits - 1; i >= 0; i--) {
    const out = s.add(C.output(`Q${i}`, `Q${i}`));
    s.wire(at(cnt, `Q${i}`), at(out, "A"));
  }

  s.note(
    `Count ${n} is detected by NANDing the bits that are 1 in ${n.toString(2)} (Q${ones.join(", Q")}), and that pulls the asynchronous CLEAR low.`,
  );
  s.note(
    `The sequence is 0 … ${n - 1}, then straight back to 0: ${n} states from ${bits} flip-flops.`,
  );
  s.note(
    `State ${n} does exist, for a few nanoseconds, before the clear takes effect. That glitch is real — it is why a decoder driven from a counter like this needs its outputs strobed, and why a SYNCHRONOUS clear is preferred when the part offers one.`,
  );

  return s.done({
    id: opts.id ?? `mod${n}`,
    title: opts.title ?? `Mod-${n} counter`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- serial to parallel -----------------------------------------------------

/**
 * Distribute a serial stream to k outputs with a demultiplexer. (Q15.)
 *
 * The half of this question people miss: the demux alone does not "distribute"
 * anything — it needs to be TOLD which output the current bit belongs to, and
 * nothing in a serial stream says so. A counter clocked by the same bit clock is
 * what supplies the address, and latches are what hold each bit once the demux
 * has moved on. Without the latches, each output is high for one bit time and
 * then gone.
 */
export function serialToParallelDiagram(opts: {
  readonly outputs: number;
  readonly latched?: boolean;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const outs = opts.outputs;
  const selBits = Math.ceil(Math.log2(outs));
  const latched = opts.latched !== false;

  const din = s.add(C.input("DIN", "serial in"));
  const clk = s.add(C.input("CLK", "bit clock"));

  const cnt = s.add(
    C.counter("CNT", selBits, {
      title: `mod-${outs} counter`,
      subtitle: "supplies the address",
    }),
  );
  s.wire(at(clk, "Y"), at(cnt, "CLK"));

  const dm = s.add(C.demux("DEMUX", selBits, { enable: false }));
  s.wire(at(din, "Y"), at(dm, "D"));
  for (let i = 0; i < selBits; i++) s.wire(at(cnt, `Q${i}`), at(dm, `S${i}`));

  for (let k = 0; k < outs; k++) {
    if (latched) {
      const ff = s.add({
        ...C.flipFlop(`L${k}`, "d", { title: `D${k}`, complement: false }),
        row: k,
      });
      s.wire(at(dm, `Y${k}`), at(ff, "D"));
      s.wire(at(clk, "Y"), at(ff, "CLK"));
      const out = s.add(C.output(`Q${k}`, `Q${k}`));
      s.wire(at(ff, "Q"), at(out, "A"));
    } else {
      const out = s.add(C.output(`Q${k}`, `Q${k}`));
      s.wire(at(dm, `Y${k}`), at(out, "A"));
    }
  }

  s.note(
    "The demultiplexer routes one input to one of several outputs — but something has to choose WHICH, and a serial stream carries no address.",
  );
  s.note(
    `The mod-${outs} counter, clocked by the same bit clock, supplies that address: bit 0 goes to Y0, bit 1 to Y1, and so on, wrapping every ${outs} bits.`,
  );
  if (latched) {
    s.note(
      "Each output is latched. Without the latches every output would be valid for exactly one bit time and then vanish — you would have a distributor, not a serial-to-parallel converter.",
    );
  }
  s.note(
    "A shift register does the same job with fewer parts; the demux version is the one that generalises to routing a bus to one of several destinations.",
  );

  return s.done({
    id: opts.id ?? `s2p${outs}`,
    title: opts.title ?? `Serial to ${outs}-way parallel, using a demultiplexer`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- design from next-state equations ---------------------------------------

export interface SequentialSpec {
  /** External inputs, single letters — the parser reads `PQ` as P·Q. */
  readonly inputs: readonly string[];
  readonly stateVars: readonly string[];
  readonly type: "d" | "jk" | "t";
  /**
   * Excitation expressions, keyed by the FLIP-FLOP INPUT they drive:
   * `{ DA: "...", DB: "..." }` for D types, `{ JA: "...", KA: "..." }` for JK.
   */
  readonly excitation: Readonly<Record<string, string>>;
  readonly outputs?: readonly { readonly label: string; readonly expr: string }[];
}

/**
 * A sequential circuit from its excitation equations. (Q40.)
 *
 * The equations are parsed and synthesized by the SAME engine the rest of the
 * app uses, so the gates drawn here are the gates the lab would build, and the
 * state table below is computed from the same expressions rather than typed in
 * beside them. There is exactly one description of the circuit, and everything
 * else is derived from it — which is the only way the table and the drawing
 * cannot disagree.
 */
export function sequentialDesignDiagram(
  spec: SequentialSpec,
  opts: { readonly id?: string; readonly title?: string; readonly caption?: string } = {},
): Diagram {
  const s = new Sketch();
  const variables = [...spec.inputs, ...spec.stateVars];

  const source = new Map<string, Endpoint>();
  for (const v of spec.inputs) {
    const id = s.add(C.input(`in_${v}`, v));
    source.set(v, at(id, "Y"));
  }

  const clk = s.add(C.input("CLK", "CLK"));
  spec.stateVars.forEach((v, i) => {
    const ff = s.add({
      ...C.flipFlop(`FF_${v}`, spec.type, { title: v, clear: true }),
      row: i,
    });
    s.wire(at(clk, "Y"), at(ff, "CLK"));
    // The feedback: state variable v is READ from its own flip-flop's Q. The
    // layout engine sees this as a back edge and routes it around the outside.
    source.set(v, at(ff, "Q"));
    const out = s.add(C.output(`out_${v}`, v));
    s.wire(at(ff, "Q"), at(out, "A"));
  });

  const clr = s.add(C.input("CLR", "CLR"));
  for (const v of spec.stateVars) s.wire(at(clr, "Y"), at(`FF_${v}`, "CLR"));

  const emit = (expr: string, prefix: string): Endpoint | null => {
    const parsed = parse(expr);
    if (!parsed.ok) return null;
    const nl = synthesize(parsed.value.ast, variables);
    return emitInto(s, technologyMap(nl, "mixed").netlist, (v) => source.get(v) ?? at(`in_${v}`, "Y"), prefix);
  };

  for (const [pin, expr] of Object.entries(spec.excitation)) {
    // "DA" drives pin D of flip-flop A; "JB" drives pin J of flip-flop B.
    const which = pin.slice(0, 1).toUpperCase();
    const state = pin.slice(1);
    const driver = emit(expr, `e_${pin}_`);
    if (driver) s.wire(driver, at(`FF_${state}`, which));
    s.note(`${pin} = ${expr}`);
  }

  for (const out of spec.outputs ?? []) {
    const driver = emit(out.expr, `o_${out.label}_`);
    const tag = s.add(C.output(`out_${out.label}`, out.label));
    if (driver) s.wire(driver, at(tag, "A"));
    s.note(`${out.label} = ${out.expr}`);
  }

  s.note(
    "The wires running back underneath are the state feedback: each flip-flop's Q is an input to the next-state logic, which is what makes this circuit sequential rather than combinational.",
  );

  return s.done({
    id: opts.id ?? "seqdesign",
    title:
      opts.title ??
      `Sequential circuit — ${spec.stateVars.length} ${spec.type.toUpperCase()} flip-flops, inputs ${spec.inputs.join(", ")}`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

/** Shared with `builders/logic.ts` in spirit; kept local to avoid a cycle. */
function emitInto(
  s: Sketch,
  nl: GateNetlist,
  sourceOf: (variable: string) => Endpoint,
  prefix: string,
): Endpoint {
  if (nl.constant !== null) {
    const id = s.add(C.constant(`${prefix}k`, nl.constant));
    return at(id, "Y");
  }
  const driver = new Map<number, Endpoint>();
  for (const i of nl.inputs) driver.set(i.signal, sourceOf(i.name));
  for (const g of nl.gates) {
    const arity = g.op === "not" || g.op === "buf" ? 1 : g.inputs.length;
    const id = s.add(C.gate(`${prefix}g${g.id}`, g.op as DiagramGateOp, arity));
    driver.set(g.output, at(id, "Y"));
  }
  for (const g of nl.gates) {
    g.inputs.forEach((signal, i) => {
      const from = driver.get(signal);
      const pin = PIN[i];
      if (from && pin) s.wire(from, at(`${prefix}g${g.id}`, pin));
    });
  }
  return driver.get(nl.outputSignal) ?? at(`${prefix}k`, "Y");
}

// --- state table ------------------------------------------------------------

export interface StateRow {
  readonly present: string;
  readonly input: string;
  readonly next: string;
  readonly output: string;
}

/**
 * The state table, evaluated from the same expressions the drawing was built
 * from. For D flip-flops next state IS the excitation; for JK and T it has to go
 * through the characteristic equation, which is where the sign errors live:
 *
 *   D:  Q+ = D
 *   T:  Q+ = T ⊕ Q
 *   JK: Q+ = J·Q' + K'·Q
 */
export function stateTable(spec: SequentialSpec): StateRow[] {
  const compiled = new Map<string, (env: Map<string, 0 | 1>) => 0 | 1>();

  for (const [pin, expr] of Object.entries(spec.excitation)) {
    const parsed = parse(expr);
    if (parsed.ok) {
      const ast = parsed.value.ast;
      compiled.set(pin, (env) => evaluate(ast, env));
    }
  }
  const outputs = (spec.outputs ?? []).map((o) => {
    const parsed = parse(o.expr);
    return {
      label: o.label,
      run: parsed.ok
        ? (env: Map<string, 0 | 1>) => evaluate(parsed.value.ast, env)
        : () => 0 as const,
    };
  });

  const rows: StateRow[] = [];
  const nState = 1 << spec.stateVars.length;
  const nInput = 1 << spec.inputs.length;

  for (let st = 0; st < nState; st++) {
    for (let iv = 0; iv < nInput; iv++) {
      const env = new Map<string, 0 | 1>();
      spec.inputs.forEach((v, i) => {
        env.set(v, ((iv >>> (spec.inputs.length - 1 - i)) & 1) as 0 | 1);
      });
      spec.stateVars.forEach((v, i) => {
        env.set(v, ((st >>> (spec.stateVars.length - 1 - i)) & 1) as 0 | 1);
      });

      const next = spec.stateVars
        .map((v) => {
          const q = env.get(v) as 0 | 1;
          switch (spec.type) {
            case "d":
              return compiled.get(`D${v}`)?.(env) ?? 0;
            case "t": {
              const t = compiled.get(`T${v}`)?.(env) ?? 0;
              return (t ^ q) as 0 | 1;
            }
            case "jk": {
              const j = compiled.get(`J${v}`)?.(env) ?? 0;
              const k = compiled.get(`K${v}`)?.(env) ?? 0;
              return ((j && !q) || (!k && q) ? 1 : 0) as 0 | 1;
            }
          }
        })
        .join("");

      rows.push({
        present: spec.stateVars
          .map((v) => String(env.get(v) ?? 0))
          .join(""),
        input: spec.inputs.map((v) => String(env.get(v) ?? 0)).join(""),
        next,
        output: outputs.map((o) => String(o.run(env))).join(""),
      });
    }
  }
  return rows;
}

/** The minimal form of each excitation equation, for the write-up. */
export const excitationSummary = (spec: SequentialSpec): string[] =>
  Object.entries(spec.excitation).map(([pin, expr]) => {
    const parsed = parse(expr);
    return parsed.ok ? `${pin} = ${format(parsed.value.ast)}` : `${pin} = ${expr}`;
  });
