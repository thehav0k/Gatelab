import type { GateOp } from "./logic";
import type { PinSpec } from "./netlist";
import {
  registerIcLibrary,
  type CellTemplate,
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
  readonly op: GateOp;
  readonly pins: readonly PinSpec[];
  readonly cells: readonly CellTemplate[];
  readonly power: PowerPins;
  readonly gateCount: number;
  readonly inputsPerGate: number;
}

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

const GATE_INPUT = /^(\d+)([A-F])$/; // 1A, 2B, 3C…
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

export const IC_LIBRARY: readonly IcDefinition[] = [
  IC_7400,
  IC_7402,
  IC_7404,
  IC_7408,
  IC_7432,
  IC_7486,
  IC_7410,
];

const BY_PART = new Map(IC_LIBRARY.map((d) => [d.part, d]));

export const getIc = (part: string): IcDefinition | undefined => BY_PART.get(part);

/** The chips that implement a given gate op — used by the M5 technology mapper. */
export const icForOp = (op: GateOp): IcDefinition | undefined =>
  IC_LIBRARY.find((d) => d.op === op && d.inputsPerGate <= 2);

const registry: IcRegistry = {
  pins: (part) => must(part).pins,
  cells: (part) => must(part).cells,
  power: (part) => must(part).power,
  has: (part) => BY_PART.has(part),
};

function must(part: string): IcDefinition {
  const def = BY_PART.get(part);
  if (!def) throw new Error(`Unknown IC part "${part}"`);
  return def;
}

registerIcLibrary(registry);
