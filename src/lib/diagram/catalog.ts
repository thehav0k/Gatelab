import type { Block, DiagramGateOp, Port } from "./types";

/**
 * The MSI parts, as boxes.
 *
 * Every factory here answers one question: what are this part's PORTS, in what
 * order, on which edge? That is the entire content of "draw a 3-to-8 decoder",
 * and getting it wrong is the difference between an answer and a doodle — so the
 * conventions are fixed here, once, rather than re-decided by each builder:
 *
 *   - Address and select inputs are listed MSB FIRST, top to bottom. This is the
 *     same MSB-first contract the core engine works under (see AGENTS.md), and
 *     having the drawing disagree with the algebra is how a correct circuit gets
 *     marked wrong.
 *   - Data inputs are listed D0 at the TOP, ascending downward, because that is
 *     how every datasheet and every textbook draws a mux, and it is the order in
 *     which the select code counts.
 *   - Control pins (enable, clock, clear) get `gapBefore`, which visually
 *     separates them from the data pins. An enable buried in the middle of an
 *     address bus is the single most common way these diagrams are misread.
 *   - Clocks go on the BOTTOM edge, so the clock distribution line runs under the
 *     whole row of flip-flops instead of fighting the data flow.
 */

const p = (
  id: string,
  label: string,
  side: Port["side"],
  dir: Port["dir"],
  extra: Partial<Port> = {},
): Port => ({ id, label, side, dir, ...extra });

const pow2 = (bits: number): number => 1 << bits;

// --- primitives -------------------------------------------------------------

export const gate = (
  id: string,
  op: DiagramGateOp,
  arity = 2,
  title = "",
): Block => ({
  id,
  kind: "gate",
  title,
  tone: "gate",
  op,
  ports: [
    ...Array.from({ length: op === "not" || op === "buf" ? 1 : arity }, (_, i) =>
      p(String.fromCharCode(65 + i), "", "left", "in"),
    ),
    p("Y", "", "right", "out"),
  ],
});

export const input = (id: string, label = id): Block => ({
  id,
  kind: "io",
  title: label,
  tone: "input",
  ports: [p("Y", "", "right", "out")],
});

export const output = (id: string, label = id): Block => ({
  id,
  kind: "io",
  title: label,
  tone: "output",
  ports: [p("A", "", "left", "in")],
});

/** A tie-off to the supply rails. `1` is a real, drawable component. */
export const constant = (id: string, value: 0 | 1): Block => ({
  id,
  kind: "io",
  title: value === 1 ? "+5V" : "GND",
  tone: "input",
  ports: [p("Y", "", "right", "out")],
});

/**
 * A junction: a dot where wires meet, with one pin at its centre.
 *
 * The pin is `bidirectional` because a junction has no opinion about signal
 * flow — it is downstream of whatever drives it and upstream of everything it
 * feeds, and `connect()` therefore takes the direction from the OTHER end.
 */
export const junction = (id: string): Block => ({
  id,
  kind: "node",
  title: "",
  tone: "bus",
  ports: [{ id: "P", label: "", side: "right", dir: "out", bidirectional: true }],
});

export const note = (id: string, text: string): Block => ({
  id,
  kind: "label",
  title: text,
  tone: "note",
  ports: [],
});

// --- selectors --------------------------------------------------------------

export interface DecoderOptions {
  readonly enable?: boolean;
  readonly enableActiveLow?: boolean;
  readonly outputsActiveLow?: boolean;
  readonly title?: string;
  readonly subtitle?: string;
  /** Prefix for the address port labels. `A` by default, `S` for a demux. */
  readonly addrPrefix?: string;
  /** A demux also has a data input, which is the only thing that differs. */
  readonly dataInput?: string;
}

/**
 * A binary decoder — and, with `dataInput`, a demultiplexer.
 *
 * They are the same box. That is not a shortcut, it is the answer to Q17: a
 * decoder whose ENABLE pin is fed with data IS a demultiplexer, because each
 * output is (minterm of the address) AND (enable), and calling the enable "data"
 * changes nothing but the name on the pin. Building them from one factory means
 * the drawing cannot accidentally imply otherwise.
 */
export function decoder(
  id: string,
  addrBits: number,
  opts: DecoderOptions = {},
): Block {
  const prefix = opts.addrPrefix ?? "A";
  const outs = pow2(addrBits);
  const ports: Port[] = [];

  for (let i = addrBits - 1; i >= 0; i--) {
    ports.push(p(`${prefix}${i}`, `${prefix}${i}`, "left", "in"));
  }
  if (opts.dataInput) {
    ports.push(
      p("D", opts.dataInput, "left", "in", { gapBefore: true }),
    );
  }
  if (opts.enable) {
    ports.push(
      p("E", "E", "left", "in", {
        gapBefore: !opts.dataInput,
        ...(opts.enableActiveLow ? { activeLow: true } : {}),
      }),
    );
  }
  for (let i = 0; i < outs; i++) {
    ports.push(
      p(`Y${i}`, `Y${i}`, "right", "out", {
        ...(opts.outputsActiveLow ? { activeLow: true } : {}),
      }),
    );
  }

  return {
    id,
    kind: "box",
    title: opts.title ?? (opts.dataInput ? `DEMUX 1:${outs}` : `${addrBits}-to-${outs}`),
    tone: "msi",
    ports,
    ...(opts.subtitle !== undefined
      ? { subtitle: opts.subtitle }
      : { subtitle: opts.dataInput ? "demultiplexer" : "decoder" }),
  };
}

export const demux = (
  id: string,
  selBits: number,
  opts: Omit<DecoderOptions, "dataInput" | "addrPrefix"> = {},
): Block =>
  decoder(id, selBits, {
    ...opts,
    addrPrefix: "S",
    dataInput: "D",
    title: opts.title ?? `DEMUX 1:${pow2(selBits)}`,
  });

export interface MuxOptions {
  readonly enable?: boolean;
  readonly enableActiveLow?: boolean;
  readonly title?: string;
  readonly subtitle?: string;
  readonly complementOutput?: boolean;
}

/** An n-select multiplexer: 2^n data inputs, n select lines, one output. */
export function mux(id: string, selBits: number, opts: MuxOptions = {}): Block {
  const inputs = pow2(selBits);
  const ports: Port[] = [];
  for (let i = 0; i < inputs; i++) ports.push(p(`D${i}`, `I${i}`, "left", "in"));
  for (let i = selBits - 1; i >= 0; i--) {
    ports.push(p(`S${i}`, `S${i}`, "bottom", "in"));
  }
  if (opts.enable) {
    ports.push(
      p("E", "E", "left", "in", {
        gapBefore: true,
        ...(opts.enableActiveLow ? { activeLow: true } : {}),
      }),
    );
  }
  ports.push(p("Y", "Y", "right", "out"));
  if (opts.complementOutput) ports.push(p("W", "W", "right", "out", { activeLow: true }));

  return {
    id,
    kind: "box",
    title: opts.title ?? `MUX ${inputs}:1`,
    subtitle: opts.subtitle ?? "multiplexer",
    tone: "msi",
    ports,
  };
}

export interface EncoderOptions {
  readonly priority?: boolean;
  readonly validOutput?: boolean;
  readonly enable?: boolean;
  readonly title?: string;
  readonly inputPrefix?: string;
  readonly outputPrefix?: string;
}

/** A 2^n-to-n encoder. `priority` only changes the label — and the caption. */
export function encoder(
  id: string,
  outputBits: number,
  opts: EncoderOptions = {},
): Block {
  const ins = pow2(outputBits);
  const inPrefix = opts.inputPrefix ?? "D";
  const outPrefix = opts.outputPrefix ?? "Y";
  const ports: Port[] = [];
  for (let i = 0; i < ins; i++) ports.push(p(`${inPrefix}${i}`, `${inPrefix}${i}`, "left", "in"));
  if (opts.enable) ports.push(p("E", "E", "left", "in", { gapBefore: true }));
  for (let i = outputBits - 1; i >= 0; i--) {
    ports.push(p(`${outPrefix}${i}`, `${outPrefix}${i}`, "right", "out"));
  }
  if (opts.validOutput) ports.push(p("V", "V", "right", "out", { gapBefore: true }));

  return {
    id,
    kind: "box",
    title: opts.title ?? `${ins}-to-${outputBits}`,
    subtitle: opts.priority ? "priority encoder" : "encoder",
    tone: "msi",
    ports,
  };
}

// --- arithmetic -------------------------------------------------------------

export const halfAdder = (id: string, title = "HA"): Block => ({
  id,
  kind: "box",
  title,
  subtitle: "half adder",
  tone: "arith",
  ports: [
    p("A", "A", "left", "in"),
    p("B", "B", "left", "in"),
    p("S", "S", "right", "out"),
    p("C", "C", "right", "out"),
  ],
});

export const fullAdder = (id: string, title = "FA"): Block => ({
  id,
  kind: "box",
  title,
  subtitle: "full adder",
  tone: "arith",
  ports: [
    p("A", "A", "left", "in"),
    p("B", "B", "left", "in"),
    p("Cin", "Cin", "left", "in", { gapBefore: true }),
    p("S", "S", "right", "out"),
    p("Cout", "Cout", "right", "out"),
  ],
});

export interface AdderOptions {
  readonly title?: string;
  readonly subtitle?: string;
  /** Draw A and B as buses with one port each, rather than one port per bit. */
  readonly bussed?: boolean;
}

/** An n-bit parallel adder. The 74283 in everything but name. */
export function adder(id: string, bits: number, opts: AdderOptions = {}): Block {
  const ports: Port[] = [];
  if (opts.bussed) {
    ports.push(p("A", `A${bits - 1}..A0`, "left", "in", { width: bits }));
    ports.push(p("B", `B${bits - 1}..B0`, "left", "in", { width: bits }));
  } else {
    for (let i = bits - 1; i >= 0; i--) ports.push(p(`A${i}`, `A${i}`, "left", "in"));
    for (let i = bits - 1; i >= 0; i--) {
      ports.push(p(`B${i}`, `B${i}`, "left", "in", { gapBefore: i === bits - 1 }));
    }
  }
  ports.push(p("Cin", "C0", "left", "in", { gapBefore: true }));

  if (opts.bussed) {
    ports.push(p("S", `S${bits - 1}..S0`, "right", "out", { width: bits }));
  } else {
    for (let i = bits - 1; i >= 0; i--) ports.push(p(`S${i}`, `S${i}`, "right", "out"));
  }
  ports.push(p("Cout", "C" + bits, "right", "out", { gapBefore: true }));

  return {
    id,
    kind: "box",
    title: opts.title ?? `${bits}-bit adder`,
    subtitle: opts.subtitle ?? "parallel adder",
    tone: "arith",
    ports,
  };
}

/** A magnitude comparator: the 7485's three outputs, or just equality. */
export function comparator(
  id: string,
  bits: number,
  opts: { readonly magnitude?: boolean; readonly title?: string; readonly bussed?: boolean } = {},
): Block {
  const ports: Port[] = [];
  if (opts.bussed) {
    ports.push(p("A", `A${bits - 1}..A0`, "left", "in", { width: bits }));
    ports.push(p("B", `B${bits - 1}..B0`, "left", "in", { width: bits }));
  } else {
    for (let i = bits - 1; i >= 0; i--) ports.push(p(`A${i}`, `A${i}`, "left", "in"));
    for (let i = bits - 1; i >= 0; i--) {
      ports.push(p(`B${i}`, `B${i}`, "left", "in", { gapBefore: i === bits - 1 }));
    }
  }
  if (opts.magnitude) {
    ports.push(p("GT", "A>B", "right", "out"));
    ports.push(p("EQ", "A=B", "right", "out"));
    ports.push(p("LT", "A<B", "right", "out"));
  } else {
    ports.push(p("EQ", "A=B", "right", "out"));
  }
  return {
    id,
    kind: "box",
    title: opts.title ?? `${bits}-bit comparator`,
    subtitle: opts.magnitude ? "magnitude comparator" : "equality comparator",
    tone: "arith",
    ports,
  };
}

// --- sequential -------------------------------------------------------------

export type FlipFlopType = "d" | "jk" | "t" | "sr";

export interface FlipFlopOptions {
  readonly title?: string;
  readonly complement?: boolean;
  readonly preset?: boolean;
  readonly clear?: boolean;
  readonly negativeEdge?: boolean;
}

const FF_INPUTS: Readonly<Record<FlipFlopType, readonly string[]>> = {
  d: ["D"],
  jk: ["J", "K"],
  t: ["T"],
  sr: ["S", "R"],
};

/**
 * A flip-flop.
 *
 * The clock is on the BOTTOM edge and the asynchronous clear on the TOP, which
 * is not the datasheet's pin order — it is the drawing convention, and it exists
 * so that a row of four flip-flops can share one clock line running underneath
 * and one clear line running over, without either crossing a single data path.
 */
export function flipFlop(
  id: string,
  type: FlipFlopType,
  opts: FlipFlopOptions = {},
): Block {
  const ports: Port[] = FF_INPUTS[type].map((label) =>
    p(label, label, "left", "in"),
  );
  ports.push(p("CLK", opts.negativeEdge ? "CLK" : "CLK", "bottom", "in", { activeLow: opts.negativeEdge === true }));
  if (opts.clear) ports.push(p("CLR", "CLR", "top", "in", { activeLow: true }));
  if (opts.preset) ports.push(p("PRE", "PRE", "top", "in", { activeLow: true }));
  ports.push(p("Q", "Q", "right", "out"));
  if (opts.complement !== false) ports.push(p("QN", "Q'", "right", "out"));

  return {
    id,
    kind: "box",
    title: opts.title ?? id,
    subtitle: `${type.toUpperCase()} flip-flop`,
    tone: "seq",
    ports,
  };
}

export interface CounterOptions {
  readonly title?: string;
  readonly subtitle?: string;
  readonly load?: boolean;
  readonly clear?: boolean;
  readonly enable?: boolean;
  readonly rippleCarry?: boolean;
}

export function counter(id: string, bits: number, opts: CounterOptions = {}): Block {
  const ports: Port[] = [];
  if (opts.enable) ports.push(p("EN", "EN", "left", "in"));
  if (opts.load) ports.push(p("LD", "LOAD", "left", "in"));
  ports.push(p("CLK", "CLK", "bottom", "in"));
  if (opts.clear) ports.push(p("CLR", "CLR", "top", "in", { activeLow: true }));
  for (let i = bits - 1; i >= 0; i--) ports.push(p(`Q${i}`, `Q${i}`, "right", "out"));
  if (opts.rippleCarry) ports.push(p("RCO", "RCO", "right", "out", { gapBefore: true }));

  return {
    id,
    kind: "box",
    title: opts.title ?? `${bits}-bit counter`,
    subtitle: opts.subtitle ?? "binary counter",
    tone: "seq",
    ports,
  };
}

export function shiftRegister(
  id: string,
  bits: number,
  opts: { readonly title?: string; readonly serialOut?: boolean } = {},
): Block {
  const ports: Port[] = [
    p("SI", "SER IN", "left", "in"),
    p("CLK", "CLK", "bottom", "in"),
  ];
  for (let i = 0; i < bits; i++) ports.push(p(`Q${i}`, `Q${i}`, "right", "out"));
  if (opts.serialOut) ports.push(p("SO", "SER OUT", "right", "out", { gapBefore: true }));
  return {
    id,
    kind: "box",
    title: opts.title ?? `${bits}-bit shift register`,
    subtitle: "serial in, parallel out",
    tone: "seq",
    ports,
  };
}

export function register(
  id: string,
  bits: number,
  opts: { readonly title?: string; readonly bussed?: boolean } = {},
): Block {
  const ports: Port[] = [];
  if (opts.bussed) ports.push(p("D", `D${bits - 1}..D0`, "left", "in", { width: bits }));
  else for (let i = bits - 1; i >= 0; i--) ports.push(p(`D${i}`, `D${i}`, "left", "in"));
  ports.push(p("CLK", "CLK", "bottom", "in"));
  if (opts.bussed) ports.push(p("Q", `Q${bits - 1}..Q0`, "right", "out", { width: bits }));
  else for (let i = bits - 1; i >= 0; i--) ports.push(p(`Q${i}`, `Q${i}`, "right", "out"));
  return {
    id,
    kind: "box",
    title: opts.title ?? `${bits}-bit register`,
    subtitle: "parallel load",
    tone: "seq",
    ports,
  };
}

// --- memory -----------------------------------------------------------------

export interface MemoryOptions {
  readonly kind?: "ram" | "rom";
  readonly title?: string;
  /** Draw the address lines as one bus port rather than one port per line. */
  readonly bussed?: boolean;
  readonly chipSelectActiveLow?: boolean;
  readonly outputEnable?: boolean;
}

/**
 * A memory chip.
 *
 * `words x bits` is the whole specification, and every other number on the box
 * is derived from it — the address pin count is log2(words), never a separate
 * field that could disagree. Q31–Q35 are all this one arithmetic, so it lives in
 * one place and `builders/memory.ts` reads it back out.
 */
export function memory(
  id: string,
  words: number,
  bits: number,
  opts: MemoryOptions = {},
): Block {
  const addrLines = Math.ceil(Math.log2(Math.max(1, words)));
  const rom = (opts.kind ?? "ram") === "rom";
  const ports: Port[] = [];

  if (opts.bussed) {
    ports.push(p("A", `A${addrLines - 1}..A0`, "left", "in", { width: addrLines }));
  } else {
    for (let i = addrLines - 1; i >= 0; i--) ports.push(p(`A${i}`, `A${i}`, "left", "in"));
  }
  if (!rom) {
    ports.push(p("D", `D${bits - 1}..D0`, "left", "in", { width: bits, gapBefore: true }));
    ports.push(p("WE", "WE", "left", "in", { activeLow: true }));
  }
  ports.push(
    p("CS", "CS", "left", "in", {
      gapBefore: true,
      activeLow: opts.chipSelectActiveLow === true,
    }),
  );
  if (opts.outputEnable) ports.push(p("OE", "OE", "left", "in", { activeLow: true }));
  ports.push(
    p("Q", bits > 1 ? `Q${bits - 1}..Q0` : "Q", "right", "out", { width: bits }),
  );

  return {
    id,
    kind: "box",
    title: opts.title ?? `${formatWords(words)} × ${bits}`,
    subtitle: rom ? "ROM" : "RAM",
    tone: "memory",
    ports,
  };
}

/** 1024 -> "1K", 16384 -> "16K", 128 -> "128". The way a datasheet writes it. */
export function formatWords(words: number): string {
  if (words >= 1024 * 1024 && words % (1024 * 1024) === 0) return `${words / (1024 * 1024)}M`;
  if (words >= 1024 && words % 1024 === 0) return `${words / 1024}K`;
  return String(words);
}
