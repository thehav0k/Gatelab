import type { GateOp } from "./logic";
import type { PinSpec } from "./netlist";
import { DATA_PINS, type Edge, type FlopKind } from "./sequential";
import {
  registerIcLibrary,
  type CellTemplate,
  type FlopTemplate,
  type IcRegistry,
  type PowerPins,
} from "./parts";

/**
 * The 74xx TTL library.
 *
 * THE DESIGN RULE THAT MAKES THIS CORRECT: transcribe the datasheet's PIN NAMES,
 * and DERIVE the gate map from them. Never hand-write the gate map.
 *
 * Why it matters: the parts are NOT all shaped alike, and it is very easy to
 * assume they are.
 *
 *   7400 pin 1 = 1A, pin 2 = 1B, pin 3 = 1Y     (inputs first)
 *   7402 pin 1 = 1Y, pin 2 = 1A, pin 3 = 1B     (OUTPUT first!)
 *
 * And both of them flip layout again on the right-hand half of the package.
 * Pattern-matching one chip's shape onto another produces a chip that simulates
 * beautifully and is wired to the wrong pins on a real breadboard — the worst
 * possible failure for a lab assistant.
 *
 * So the only thing a human writes here is fourteen strings copied off a
 * datasheet. `parsePinNames` turns "1A"/"1Y" into gate slots, and
 * `validateDefinition` refuses anything inconsistent. Adding a new chip is one
 * line, and there is nowhere to put a typo that a test will not catch.
 */

export interface IcDefinition {
  readonly part: string;
  readonly name: string;
  readonly pinNames: readonly string[];
  /** Meaningless for a sequential part; `gateCount` is 0 there. */
  readonly op: GateOp;
  readonly pins: readonly PinSpec[];
  readonly cells: readonly CellTemplate[];
  /** Empty for a combinational part. */
  readonly flops: readonly FlopTemplate[];
  readonly power: PowerPins;
  readonly gateCount: number;
  readonly inputsPerGate: number;
  /** One line for the palette, so a chooser can say what the part is for. */
  readonly summary?: string;
}

/** Does this package contain state? Decides which palette section it lands in. */
export const isSequential = (def: IcDefinition): boolean => def.flops.length > 0;

// --- DIP-14 geometry --------------------------------------------------------

/** One hole = 0.1 inch. At 24px/hole a DIP14 is 144x72 on the canvas. */
export const PIN_PITCH = 24;
/** 0.3 inch across the notch — a real DIP straddles the breadboard channel. */
export const ROW_SPAN = 3 * PIN_PITCH;
export const DIP_INSET = PIN_PITCH / 2;

export const dipWidth = (pinCount: number): number =>
  (pinCount / 2 - 1) * PIN_PITCH + PIN_PITCH;
export const dipHeight = (): number => ROW_SPAN;

/**
 * DIP pin numbering is counter-clockwise from the notch: pin 1 is bottom-left,
 * pins 1..7 run left-to-right along the bottom, then 8..14 run RIGHT-TO-LEFT
 * along the top. So pin 8 sits directly across from pin 7, and pin 14 across
 * from pin 1 — which is exactly why Vcc (14) and GND (7) end up at opposite
 * corners.
 */
export function pinOffset(pin: number, pinCount: number): { x: number; y: number } {
  const perRow = pinCount / 2;
  if (pin <= perRow) {
    return { x: DIP_INSET + (pin - 1) * PIN_PITCH, y: ROW_SPAN };
  }
  return { x: DIP_INSET + (pinCount - pin) * PIN_PITCH, y: 0 };
}

// --- the parser -------------------------------------------------------------

const GATE_INPUT = /^(\d+)([A-H])$/; // 1A, 2B … up to 1H on the 8-input 7430
const GATE_OUTPUT = /^(\d+)Y$/; // 1Y, 2Y…

/**
 * Turn the datasheet pin-name array into pins, cells, and power pins.
 *
 * This is the whole trick: the gate map is *computed*, so it cannot disagree
 * with the pinout it was supposed to describe.
 */
function defineDip(
  part: string,
  name: string,
  op: GateOp,
  pinNames: readonly string[],
): IcDefinition {
  const pinCount = pinNames.length;

  const pins: PinSpec[] = pinNames.map((pinName, i) => {
    const number = i + 1;
    const offset = pinOffset(number, pinCount);

    if (pinName === "VCC") {
      return { number, name: pinName, dir: "pwr", strength: "supply", offset };
    }
    if (pinName === "GND") {
      return { number, name: pinName, dir: "gnd", strength: "supply", offset };
    }
    if (pinName === "NC") {
      return { number, name: pinName, dir: "nc", strength: "hiz", offset };
    }
    if (GATE_OUTPUT.test(pinName)) {
      return { number, name: pinName, dir: "out", strength: "strong", offset };
    }
    if (GATE_INPUT.test(pinName)) {
      return { number, name: pinName, dir: "in", strength: "hiz", offset };
    }
    throw new Error(`${part}: unrecognized pin name "${pinName}"`);
  });

  // Group by gate index. The input letters give the ordering, so a chip whose
  // inputs are physically out of order still gets its gate assembled correctly.
  const slots = new Map<number, { inputs: string[]; output: string | null }>();
  for (const pinName of pinNames) {
    const out = GATE_OUTPUT.exec(pinName);
    const inp = GATE_INPUT.exec(pinName);
    const slot = out ? Number(out[1]) : inp ? Number(inp[1]) : null;
    if (slot === null) continue;

    const entry = slots.get(slot) ?? { inputs: [], output: null };
    if (out) entry.output = pinName;
    else entry.inputs.push(pinName);
    slots.set(slot, entry);
  }

  const cells: CellTemplate[] = [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, entry]) => {
      if (!entry.output) throw new Error(`${part}: gate ${slot} has no Y pin`);
      return {
        slot,
        op,
        inputPins: [...entry.inputs].sort(), // 1A before 1B before 1C
        outputPin: entry.output,
      };
    });

  const def: IcDefinition = {
    part,
    name,
    pinNames,
    op,
    pins,
    cells,
    flops: [],
    power: { vcc: "VCC", gnd: "GND" },
    gateCount: cells.length,
    inputsPerGate: cells[0]?.inputPins.length ?? 0,
  };

  const problems = validateDefinition(def);
  if (problems.length > 0) {
    throw new Error(`${part}: ${problems.join("; ")}`);
  }
  return def;
}

export function validateDefinition(def: IcDefinition): string[] {
  const problems: string[] = [];

  if (def.pinNames.length % 2 !== 0) problems.push("odd pin count");
  if (!def.pinNames.includes("VCC")) problems.push("no VCC pin");
  if (!def.pinNames.includes("GND")) problems.push("no GND pin");

  const seen = new Set<string>();
  for (const name of def.pinNames) {
    if (name !== "NC" && seen.has(name)) problems.push(`duplicate pin ${name}`);
    seen.add(name);
  }

  for (const cell of def.cells) {
    if (cell.inputPins.length === 0) problems.push(`gate ${cell.slot} has no inputs`);
    if (cell.inputPins.length !== def.inputsPerGate) {
      problems.push(`gate ${cell.slot} has inconsistent arity`);
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The parts. Fourteen strings each, copied off the datasheet, pin 1 -> pin 14.
// ---------------------------------------------------------------------------

export const IC_7400 = defineDip("7400", "Quad 2-input NAND", "nand", [
  "1A", "1B", "1Y", "2A", "2B", "2Y", "GND",   // pins 1-7
  "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC",   // pins 8-14
]);

/**
 * THE ONE EVERYONE GETS WRONG.
 *
 * The 7402 is NOT shaped like the 7400. Its left half puts the OUTPUT FIRST —
 * gate 1 is inputs (2,3) -> output 1 — and then its right half flips back to
 * the A,B,Y order. Transcribe it; do not pattern-match it.
 */
export const IC_7402 = defineDip("7402", "Quad 2-input NOR", "nor", [
  "1Y", "1A", "1B", "2Y", "2A", "2B", "GND",   // pins 1-7   (Y FIRST)
  "3A", "3B", "3Y", "4A", "4B", "4Y", "VCC",   // pins 8-14  (Y last)
]);

/** The 7404 also reverses on the right half: pin 8 is 4Y, pin 9 is 4A. */
export const IC_7404 = defineDip("7404", "Hex inverter", "not", [
  "1A", "1Y", "2A", "2Y", "3A", "3Y", "GND",   // pins 1-7
  "4Y", "4A", "5Y", "5A", "6Y", "6A", "VCC",   // pins 8-14
]);

export const IC_7408 = defineDip("7408", "Quad 2-input AND", "and", [
  "1A", "1B", "1Y", "2A", "2B", "2Y", "GND",
  "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC",
]);

export const IC_7432 = defineDip("7432", "Quad 2-input OR", "or", [
  "1A", "1B", "1Y", "2A", "2B", "2Y", "GND",
  "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC",
]);

export const IC_7486 = defineDip("7486", "Quad 2-input XOR", "xor", [
  "1A", "1B", "1Y", "2A", "2B", "2Y", "GND",
  "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC",
]);

/** Proof the schema is right: adding a chip is one call and nothing else. */
export const IC_7410 = defineDip("7410", "Triple 3-input NAND", "nand", [
  "1A", "1B", "2A", "2B", "2C", "2Y", "GND",
  "3Y", "3A", "3B", "3C", "1Y", "1C", "VCC",
]);

/**
 * Triple 3-input AND. Shares the 7410's frame exactly — gate 1's pins are
 * scattered (1, 2, 13 -> 12), which is precisely why the gate map is DERIVED from
 * the pin names rather than written by hand.
 */
export const IC_7411 = defineDip("7411", "Triple 3-input AND", "and", [
  "1A", "1B", "2A", "2B", "2C", "2Y", "GND",
  "3Y", "3A", "3B", "3C", "1Y", "1C", "VCC",
]);

/** Triple 3-input NOR. Same frame again. */
export const IC_7427 = defineDip("7427", "Triple 3-input NOR", "nor", [
  "1A", "1B", "2A", "2B", "2C", "2Y", "GND",
  "3Y", "3A", "3B", "3C", "1Y", "1C", "VCC",
]);

/** Dual 4-input NAND. Note the two dead pins — 3 and 11 are not connected. */
export const IC_7420 = defineDip("7420", "Dual 4-input NAND", "nand", [
  "1A", "1B", "NC", "1C", "1D", "1Y", "GND",
  "2Y", "2A", "2B", "NC", "2C", "2D", "VCC",
]);

/** Dual 4-input AND. The 7420's frame, un-inverted. */
export const IC_7421 = defineDip("7421", "Dual 4-input AND", "and", [
  "1A", "1B", "NC", "1C", "1D", "1Y", "GND",
  "2Y", "2A", "2B", "NC", "2C", "2D", "VCC",
]);

/**
 * 8-input NAND. One gate, eight inputs, and three dead pins. The single output
 * sits on pin 8 — directly opposite GND — which catches people out.
 */
export const IC_7430 = defineDip("7430", "8-input NAND", "nand", [
  "1A", "1B", "1C", "1D", "1E", "1F", "GND",
  "1Y", "NC", "NC", "1G", "1H", "NC", "VCC",
]);


// ---------------------------------------------------------------------------
// Sequential parts
// ---------------------------------------------------------------------------

/**
 * A flip-flop package, derived from its pin names exactly as the gates are.
 *
 * SAME RULE, AND IT MATTERS MORE HERE. The only thing written by hand is the
 * datasheet's list of pin names; the flip-flop map is computed from it. These
 * parts are far less alike than the gates are — the '76 puts VCC on pin 5 and
 * GND on pin 13 rather than in the usual corners, the '107 has a clear and no
 * preset, and the '175 shares one clock and one clear across four flip-flops —
 * so pattern-matching one onto another produces a chip that simulates
 * beautifully and is wired to the wrong pins on a real board.
 *
 * The grammar is the silkscreen's own: a leading digit is the flip-flop number,
 * and a name with NO digit is shared by every flip-flop in the package. That
 * one rule is what makes a '74 (two independent clocks) and a '175 (one common
 * clock) the same nine lines of code.
 */
const SEQ_PIN = /^(\d*)(CLK|CLR|PRE|QN|D|T|J|K|S|R|Q)$/;

type Role = "CLK" | "CLR" | "PRE" | "QN" | "D" | "T" | "J" | "K" | "S" | "R" | "Q";

const OUTPUT_ROLES: readonly Role[] = ["Q", "QN"];

function defineSeqDip(
  part: string,
  name: string,
  kind: FlopKind,
  edge: Edge,
  summary: string,
  pinNames: readonly string[],
): IcDefinition {
  const pinCount = pinNames.length;

  const roleOf = (pinName: string): { slot: number | null; role: Role } | null => {
    const m = SEQ_PIN.exec(pinName);
    if (!m) return null;
    return { slot: m[1] ? Number(m[1]) : null, role: m[2] as Role };
  };

  const pins: PinSpec[] = pinNames.map((pinName, i) => {
    const number = i + 1;
    const offset = pinOffset(number, pinCount);

    if (pinName === "VCC") {
      return { number, name: pinName, dir: "pwr", strength: "supply", offset };
    }
    if (pinName === "GND") {
      return { number, name: pinName, dir: "gnd", strength: "supply", offset };
    }
    if (pinName === "NC") {
      return { number, name: pinName, dir: "nc", strength: "hiz", offset };
    }
    const parsed = roleOf(pinName);
    if (!parsed) throw new Error(`${part}: unrecognized pin name "${pinName}"`);
    const out = OUTPUT_ROLES.includes(parsed.role);
    return {
      number,
      name: pinName,
      dir: out ? "out" : "in",
      strength: out ? "strong" : "hiz",
      offset,
    };
  });

  // Numbered names belong to one flip-flop; unnumbered ones to all of them.
  const perSlot = new Map<number, Map<Role, string>>();
  const shared = new Map<Role, string>();
  for (const pinName of pinNames) {
    const parsed = roleOf(pinName);
    if (!parsed) continue;
    if (parsed.slot === null) {
      shared.set(parsed.role, pinName);
      continue;
    }
    const entry = perSlot.get(parsed.slot) ?? new Map<Role, string>();
    entry.set(parsed.role, pinName);
    perSlot.set(parsed.slot, entry);
  }

  const dataRoles = DATA_PINS[kind] as readonly Role[];

  const flops: FlopTemplate[] = [...perSlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, own]) => {
      const pin = (role: Role): string | null => own.get(role) ?? shared.get(role) ?? null;
      const need = (role: Role): string => {
        const found = pin(role);
        if (!found) throw new Error(`${part}: flip-flop ${slot} has no ${role} pin`);
        return found;
      };
      return {
        slot,
        kind,
        edge,
        clockPin: need("CLK"),
        dataPins: dataRoles.map(need),
        presetPin: pin("PRE"),
        clearPin: pin("CLR"),
        qPin: need("Q"),
        qnPin: pin("QN"),
      };
    });

  if (flops.length === 0) throw new Error(`${part}: no flip-flops found in the pin names`);

  const def: IcDefinition = {
    part,
    name,
    summary,
    pinNames,
    op: "buf", // unused; a sequential package has no gate op
    pins,
    cells: [],
    flops,
    power: { vcc: "VCC", gnd: "GND" },
    gateCount: 0,
    inputsPerGate: 0,
  };

  const problems = validateDefinition(def);
  if (problems.length > 0) throw new Error(`${part}: ${problems.join("; ")}`);
  return def;
}

/**
 * SN7474 — dual D-type positive-edge-triggered flip-flops with preset and clear.
 * Pin names from TI SDLS119 (SN5474/SN7474/SN74LS74A), N package, top view.
 */
export const IC_7474 = defineSeqDip(
  "7474",
  "Dual D flip-flop",
  "d",
  "rising",
  "Positive edge. Async preset and clear, both active low.",
  [
    "1CLR", "1D", "1CLK", "1PRE", "1Q", "1QN", "GND",   // pins 1-7
    "2QN", "2Q", "2PRE", "2CLK", "2D", "2CLR", "VCC",   // pins 8-14
  ],
);

/**
 * SN74LS76A — dual J-K flip-flops with preset and clear, NEGATIVE edge.
 * Pin names from TI SDLS121, 16-pin J/N package, top view.
 *
 * TWO THINGS THIS PART DOES NOT SHARE WITH ANY OTHER CHIP HERE. Its supply pins
 * are 5 and 13, not the corners — wire it like a '74 and it does not power up.
 * And the plain '76 is pulse-triggered (master-slave, with the ones-catching
 * that implies), while the 'LS76A is negative-edge-triggered; they share a
 * pinout and not a function table. The edge-triggered part is the one modelled,
 * so the edge-triggered part is the one named.
 */
export const IC_74LS76A = defineSeqDip(
  "74LS76A",
  "Dual J-K flip-flop",
  "jk",
  "falling",
  "Negative edge. Async preset and clear. Note: VCC is pin 5, GND is pin 13.",
  [
    "1CLK", "1PRE", "1CLR", "1J", "VCC", "2CLK", "2PRE", "2CLR",   // pins 1-8
    "2J", "2QN", "2Q", "2K", "GND", "1Q", "1QN", "1K",             // pins 9-16
  ],
);

/**
 * SN74LS107A — dual J-K flip-flops with clear, negative edge, no preset.
 * Pin names from TI SDLS036, N package, top view.
 */
export const IC_74LS107A = defineSeqDip(
  "74LS107A",
  "Dual J-K flip-flop",
  "jk",
  "falling",
  "Negative edge, clear only — no preset. The usual ripple-counter part.",
  [
    "1J", "1QN", "1Q", "1K", "2Q", "2QN", "GND",      // pins 1-7
    "2J", "2CLK", "2CLR", "2K", "1CLK", "1CLR", "VCC", // pins 8-14
  ],
);

/**
 * SN74175 — quadruple D-type flip-flops with a COMMON clock and clear.
 * Pin names from TI SDLS068A, N package, top view. This is a 4-bit register.
 */
export const IC_74175 = defineSeqDip(
  "74175",
  "Quad D register",
  "d",
  "rising",
  "Four D flip-flops on one clock and one clear. A 4-bit register.",
  [
    "CLR", "1Q", "1QN", "1D", "2D", "2QN", "2Q", "GND",  // pins 1-8
    "CLK", "3Q", "3QN", "3D", "4D", "4QN", "4Q", "VCC",  // pins 9-16
  ],
);

/**
 * SN74174 — hex D-type flip-flops with a common clock and clear, Q only.
 * Pin names from TI SDLS068A, N package, top view. A 6-bit register.
 */
export const IC_74174 = defineSeqDip(
  "74174",
  "Hex D register",
  "d",
  "rising",
  "Six D flip-flops on one clock and one clear. No complementary outputs.",
  [
    "CLR", "1Q", "1D", "2D", "2Q", "3D", "3Q", "GND",   // pins 1-8
    "CLK", "4Q", "4D", "5D", "5Q", "6D", "6Q", "VCC",   // pins 9-16
  ],
);

export const IC_LIBRARY: readonly IcDefinition[] = [
  // 2-input workhorses
  IC_7400,
  IC_7402,
  IC_7404,
  IC_7408,
  IC_7432,
  IC_7486,
  // wider fan-in
  IC_7410,
  IC_7411,
  IC_7420,
  IC_7421,
  IC_7427,
  IC_7430,
  // sequential
  IC_7474,
  IC_74LS76A,
  IC_74LS107A,
  IC_74175,
  IC_74174,
];

/** The packages with state in them, for the palette's own section. */
export const SEQUENTIAL_LIBRARY: readonly IcDefinition[] =
  IC_LIBRARY.filter(isSequential);

/** The plain gate packages. */
export const COMBINATIONAL_LIBRARY: readonly IcDefinition[] =
  IC_LIBRARY.filter((d) => !isSequential(d));

const BY_PART = new Map(IC_LIBRARY.map((d) => [d.part, d]));

export const getIc = (part: string): IcDefinition | undefined => BY_PART.get(part);

/** The chips that implement a given gate op — used by the M5 technology mapper. */
export const icForOp = (op: GateOp): IcDefinition | undefined =>
  IC_LIBRARY.find((d) => !isSequential(d) && d.op === op && d.inputsPerGate <= 2);

const registry: IcRegistry = {
  pins: (part) => must(part).pins,
  cells: (part) => must(part).cells,
  flops: (part) => must(part).flops,
  power: (part) => must(part).power,
  has: (part) => BY_PART.has(part),
};

function must(part: string): IcDefinition {
  const def = BY_PART.get(part);
  if (!def) throw new Error(`Unknown IC part "${part}"`);
  return def;
}

registerIcLibrary(registry);
