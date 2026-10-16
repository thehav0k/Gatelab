import {
  asNodeId,
  asWireId,
  pinEnd,
  type CircuitDocument,
  type CircuitNode,
  type NodeId,
  type Wire,
} from "./netlist";

/**
 * Clocked circuits, built from the real flip-flop packages.
 *
 * WHY THESE ARE HAND-WIRED AND THE COMBINATIONAL PRESETS ARE NOT. Those are
 * expressions run through the synthesizer, which is right for them: a function
 * IS its expression, and generating the gates keeps them honest. A counter is
 * not a function of anything — it is a specific arrangement of specific parts,
 * and the arrangement is the entire content of the lesson. "Stage 0's Q drives
 * stage 1's clock" cannot be written as an expression, and if it could, the
 * thing that made it a ripple counter would have been optimised away.
 *
 * Every one of these is checked by clocking it and reading the count, in
 * `sequential-presets.test.ts`. A miswired preset is not a picture that looks
 * slightly wrong; it is a circuit that counts 0, 1, 0, 2 and teaches that.
 */

export interface SequentialPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The lesson, shown under the name when it is opened. */
  readonly note?: string;
  readonly build: () => CircuitDocument;
}

/** A minimal document builder. Pin-to-pin only; these never touch a board. */
class Board {
  private readonly nodes: Record<string, CircuitNode> = {};
  private readonly wires: Record<string, Wire> = {};
  private n = 0;

  ic(id: string, part: string, x: number, y: number): this {
    this.nodes[id] = { kind: "ic", id: asNodeId(id), label: id, part, pos: { x, y } };
    return this;
  }
  rail(id: string, rail: "vcc" | "gnd", x: number, y: number): this {
    this.nodes[id] = { kind: "rail", id: asNodeId(id), label: id, rail, pos: { x, y } };
    return this;
  }
  switch(id: string, state: 0 | 1, x: number, y: number): this {
    this.nodes[id] = { kind: "switch", id: asNodeId(id), label: id, state, pos: { x, y } };
    return this;
  }
  clock(id: string, x: number, y: number): this {
    this.nodes[id] = { kind: "clock", id: asNodeId(id), label: id, state: 0, pos: { x, y } };
    return this;
  }
  led(id: string, x: number, y: number): this {
    this.nodes[id] = { kind: "led", id: asNodeId(id), label: id, pos: { x, y } };
    return this;
  }
  wire(a: NodeId | string, ap: string, b: NodeId | string, bp: string): this {
    const id = asWireId(`w${(this.n += 1)}`);
    this.wires[id] = {
      id,
      a: pinEnd({ node: asNodeId(String(a)), pin: ap }),
      b: pinEnd({ node: asNodeId(String(b)), pin: bp }),
    };
    return this;
  }
  /** Power a package from the two rails, by its own supply pin names. */
  power(id: string): this {
    return this.wire("V", "VCC", id, "VCC").wire("G", "GND", id, "GND");
  }
  build(): CircuitDocument {
    return { nodes: this.nodes, wires: this.wires };
  }
}

const rails = (b: Board): Board => b.rail("V", "vcc", 20, 20).rail("G", "gnd", 100, 20);

/**
 * An n-bit RIPPLE counter: every stage clocked by the stage below it.
 *
 * Two flip-flops per '107 package. Each is in toggle mode (J and K tied high),
 * so it flips on every clock it sees — and what stage i sees is stage i-1's
 * output. That is the whole circuit, and it is also the whole problem with it:
 * the top bit cannot settle until the carry has walked all the way up.
 */
function rippleCounter(bits: number): CircuitDocument {
  const b = rails(new Board());
  b.clock("CLK", 20, 120).switch("CLR", 1, 20, 200);

  const packages = Math.ceil(bits / 2);
  for (let i = 0; i < packages; i++) b.ic(`U${i + 1}`, "74LS107A", 200 + i * 260, 100);
  for (let i = 0; i < packages; i++) b.power(`U${i + 1}`);

  for (let bit = 0; bit < bits; bit++) {
    const chip = `U${Math.floor(bit / 2) + 1}`;
    const slot = (bit % 2) + 1;
    // Toggle mode, and a clear that reaches every stage.
    b.wire("V", "VCC", chip, `${slot}J`);
    b.wire("V", "VCC", chip, `${slot}K`);
    b.wire("CLR", "Y", chip, `${slot}CLR`);

    if (bit === 0) {
      b.wire("CLK", "Y", chip, `${slot}CLK`);
    } else {
      const prev = `U${Math.floor((bit - 1) / 2) + 1}`;
      const prevSlot = ((bit - 1) % 2) + 1;
      b.wire(prev, `${prevSlot}Q`, chip, `${slot}CLK`);
    }

    b.led(`Q${bit}`, 640 + Math.floor(bit / 2) * 60, 80 + (bit % 2) * 80);
    b.wire(chip, `${slot}Q`, `Q${bit}`, "A");
  }
  return b.build();
}

/**
 * A 2-bit SYNCHRONOUS counter, for contrast: one clock, both stages.
 *
 * Stage 1 toggles only when stage 0 is high, which is what its J and K being
 * tied to Q0 says. Both flip-flops see the same edge at the same instant, so
 * there is no ripple and no settling delay — the difference this preset exists
 * to show, sitting next to the ripple one in the menu.
 */
function synchronousCounter(): CircuitDocument {
  const b = rails(new Board());
  b.clock("CLK", 20, 120).switch("CLR", 1, 20, 200).ic("U1", "74LS107A", 200, 100);
  b.power("U1");

  // Stage 0: free-running toggle.
  b.wire("V", "VCC", "U1", "1J").wire("V", "VCC", "U1", "1K");
  // Stage 1: toggles only when stage 0 is already high.
  b.wire("U1", "1Q", "U1", "2J").wire("U1", "1Q", "U1", "2K");
  // One clock to both. THIS is what makes it synchronous.
  b.wire("CLK", "Y", "U1", "1CLK").wire("CLK", "Y", "U1", "2CLK");
  b.wire("CLR", "Y", "U1", "1CLR").wire("CLR", "Y", "U1", "2CLR");

  b.led("Q0", 520, 80).led("Q1", 520, 180);
  b.wire("U1", "1Q", "Q0", "A").wire("U1", "2Q", "Q1", "A");
  return b.build();
}

/** A 4-bit parallel register: four D inputs, one clock, one clear. */
function register(): CircuitDocument {
  const b = rails(new Board());
  b.clock("CLK", 20, 120).switch("CLR", 1, 20, 190).ic("U1", "74175", 260, 90);
  b.power("U1");
  b.wire("CLK", "Y", "U1", "CLK").wire("CLR", "Y", "U1", "CLR");

  for (const i of [1, 2, 3, 4]) {
    b.switch(`D${i}`, 0, 20, 260 + (i - 1) * 60);
    b.led(`Q${i}`, 600, 60 + (i - 1) * 60);
    b.wire(`D${i}`, "Y", "U1", `${i}D`);
    b.wire("U1", `${i}Q`, `Q${i}`, "A");
  }
  return b.build();
}

/**
 * A 4-bit SHIFT register: the same '175, with each Q feeding the next D.
 *
 * The only difference between this and the register above is four wires, which
 * is the point worth seeing — a register that feeds itself sideways is a shift
 * register, and there is no separate part involved.
 */
function shiftRegister(): CircuitDocument {
  const b = rails(new Board());
  b.clock("CLK", 20, 120).switch("CLR", 1, 20, 190).switch("SIN", 0, 20, 260);
  b.ic("U1", "74175", 260, 90);
  b.power("U1");
  b.wire("CLK", "Y", "U1", "CLK").wire("CLR", "Y", "U1", "CLR");
  b.wire("SIN", "Y", "U1", "1D");

  for (const i of [2, 3, 4]) b.wire("U1", `${i - 1}Q`, "U1", `${i}D`);
  for (const i of [1, 2, 3, 4]) {
    b.led(`Q${i}`, 600, 60 + (i - 1) * 60);
    b.wire("U1", `${i}Q`, `Q${i}`, "A");
  }
  return b.build();
}

/**
 * One '74 wired as a divide-by-two: D fed from its own Q-bar.
 *
 * The smallest sequential circuit worth drawing, and the one that shows what
 * "edge-triggered" buys you — the same wiring on a transparent latch would
 * oscillate as fast as the gates allowed rather than divide anything.
 */
function divideByTwo(): CircuitDocument {
  const b = rails(new Board());
  b.clock("CLK", 20, 120).switch("CLR", 1, 20, 200).ic("U1", "7474", 220, 100);
  b.power("U1");
  b.wire("CLK", "Y", "U1", "1CLK");
  b.wire("U1", "1QN", "U1", "1D");
  b.wire("CLR", "Y", "U1", "1CLR");
  b.wire("V", "VCC", "U1", "1PRE");
  b.led("Q", 520, 100);
  b.wire("U1", "1Q", "Q", "A");
  return b.build();
}

export const SEQUENTIAL_PRESETS: readonly SequentialPreset[] = [
  {
    id: "divide-by-two",
    name: "Divide by two",
    description: "One D flip-flop with its own Q̄ fed back to D.",
    note: "The output changes once per clock pulse, so it runs at half the clock rate. Chain these and you have a ripple counter.",
    build: divideByTwo,
  },
  {
    id: "ripple-2",
    name: "2-bit ripple counter",
    description: "Two J-K flip-flops, each clocked by the one below it.",
    build: () => rippleCounter(2),
  },
  {
    id: "ripple-4",
    name: "4-bit ripple counter",
    description: "Four toggling flip-flops in a chain. Counts 0 to 15.",
    note: "Every stage is clocked by the one below it, so the top bit cannot settle until the carry has walked all the way up. Watch the clear: the flip-flops power up unknown.",
    build: () => rippleCounter(4),
  },
  {
    id: "sync-2",
    name: "2-bit synchronous counter",
    description: "Both flip-flops on one clock; stage 1 toggles when stage 0 is high.",
    note: "The same count as the ripple version, with one wire moved. Every stage sees the same edge at the same instant, so there is no settling delay to wait out.",
    build: synchronousCounter,
  },
  {
    id: "register-4",
    name: "4-bit register",
    description: "A 74175: four D flip-flops on one clock. Loads all four bits at once.",
    build: register,
  },
  {
    id: "shift-4",
    name: "4-bit shift register",
    description: "The same 74175, with each Q wired to the next D.",
    note: "Four wires is the whole difference between a register and a shift register. Set SIN, pulse the clock, and watch the bit walk along.",
    build: shiftRegister,
  },
];

export const getSequentialPreset = (id: string): SequentialPreset | undefined =>
  SEQUENTIAL_PRESETS.find((p) => p.id === id);
