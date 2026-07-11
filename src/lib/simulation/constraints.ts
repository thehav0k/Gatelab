import type { GateOp } from "./logic";
import type { CircuitDocument } from "./netlist";
import { IC_LIBRARY } from "./ic-library";
import type { Strategy } from "./synth";
import { checkCompleteness } from "./completeness";

/**
 * The component constraint filter.
 *
 * An instructor says "implement this with NAND gates only", or "you may use the
 * fundamental gates but not XOR", or "build the full adder out of half adders".
 * That restriction is the exercise — so the app has to enforce it BEFORE the
 * student builds, not grade them on it afterwards.
 *
 * Two things follow from that, and both matter:
 *
 *   1. The palette is filtered. You cannot place what you are not allowed to use,
 *      so the constraint is discoverable rather than a rule you find out you broke.
 *   2. The synthesizer is steered. "Build it for me" under a NAND-only rule must
 *      produce a NAND-only circuit, not a mixed one with an apology.
 *
 * And a constraint is checkable: `violations()` reports anything already on the
 * board that the current rule forbids, which is what makes it safe to switch
 * rules mid-build.
 */

export interface Constraint {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Gate primitives the palette may offer. Empty = none (ICs only). */
  readonly gates: readonly GateOp[];
  /** 74xx parts the palette may offer. */
  readonly parts: readonly string[];
  /** The synthesizer strategy this rule implies. */
  readonly strategy: Strategy;
  /** Preset macro-circuits usable as building blocks under this rule. */
  readonly blocks?: readonly string[];
  /** The lesson, shown under the name. */
  readonly note?: string;
}

const ALL_GATES: GateOp[] = ["and", "or", "not", "nand", "nor", "xor", "xnor"];
const ALL_PARTS = IC_LIBRARY.map((d) => d.part);

/** Which chips implement a given gate op — used to derive a custom rule's parts. */
export const partsFor = (ops: readonly GateOp[]): string[] =>
  IC_LIBRARY.filter((d) => ops.includes(d.op)).map((d) => d.part);

export const CONSTRAINTS: readonly Constraint[] = [
  {
    id: "none",
    name: "No restriction",
    description: "Every gate and every chip in the library.",
    gates: ALL_GATES,
    parts: ALL_PARTS,
    strategy: "mixed",
  },
  {
    id: "fundamental",
    name: "Fundamental gates only",
    description: "AND, OR, NOT — nothing else.",
    gates: ["and", "or", "not"],
    parts: ["7408", "7432", "7404"],
    strategy: "mixed",
    note: "Every Boolean function can be written as a sum of products, so AND, OR and NOT are sufficient on their own. XOR is a convenience, not a necessity.",
  },
  {
    id: "nand-only",
    name: "NAND only",
    description: "One chip: the 7400.",
    gates: ["nand"],
    parts: ["7400"],
    strategy: "nand-only",
    note: "NAND is UNIVERSAL: NOT(a) = a NAND a, AND = NOT(NAND), OR = NAND of the inverted inputs (De Morgan). Everything else is built from those three moves — which is why a NAND-only design often needs fewer chips than a mixed one, even though it needs more gates.",
  },
  {
    id: "nor-only",
    name: "NOR only",
    description: "One chip: the 7402.",
    gates: ["nor"],
    parts: ["7402"],
    strategy: "nor-only",
    note: "NOR is universal too — the exact dual of NAND. Everything AND does, NOR does with the inputs inverted, and vice versa.",
  },
  {
    id: "no-xor",
    name: "No XOR",
    description: "Everything except XOR and XNOR.",
    gates: ["and", "or", "not", "nand", "nor"],
    parts: ["7400", "7402", "7404", "7408", "7432"],
    strategy: "mixed",
    note: "XOR is the expensive one — a 7486 gate is four transistors' worth of logic inside. Building it by hand from A·B' + A'·B shows you what you are actually paying for.",
  },
  {
    id: "blocks",
    name: "Build from blocks",
    description: "Compose bigger circuits out of half adders, muxes and decoders.",
    gates: ALL_GATES,
    parts: ALL_PARTS,
    strategy: "mixed",
    blocks: ["half-adder", "full-adder", "mux2", "mux4", "decoder"],
    note: "A full adder is two half adders and an OR gate. Composing the circuit out of blocks you have already verified is exactly how real hardware is designed — and it is why the half adder is worth building first.",
  },
] as const;

export const DEFAULT_CONSTRAINT = CONSTRAINTS[0] as Constraint;

/**
 * A rule the user built themselves — any subset of the gates.
 *
 * The named rules above are the common exercises. This is for the ones a teacher
 * actually invents ("OR and NOT only", "NAND and XOR"). completeness.ts decides
 * whether the set can express every function, and says why if it cannot — so a
 * student is never sent hunting for a circuit that provably does not exist.
 */
export function customConstraint(gates: readonly GateOp[]): Constraint {
  const check = checkCompleteness(gates);
  return {
    id: CUSTOM_ID,
    name: gates.length === 0 ? "Nothing allowed" : gates.map((g) => g.toUpperCase()).join(" + "),
    description: check.complete
      ? "Universal — every Boolean function can be built from these."
      : `Not universal — ${check.reason}`,
    gates: [...gates],
    parts: partsFor(gates),
    strategy: "mixed",
  };
}

export const CUSTOM_ID = "custom";

export const getConstraint = (id: string, customGates?: readonly GateOp[]): Constraint =>
  id === CUSTOM_ID
    ? customConstraint(customGates ?? [])
    : (CONSTRAINTS.find((c) => c.id === id) ?? DEFAULT_CONSTRAINT);

/** Can this rule express every Boolean function? */
export const isUniversal = (c: Constraint): boolean =>
  checkCompleteness(c.gates).complete;

export const whyNotUniversal = (c: Constraint): string | null =>
  checkCompleteness(c.gates).reason;

export const allowsGate = (c: Constraint, op: GateOp): boolean =>
  c.gates.includes(op);

export const allowsPart = (c: Constraint, part: string): boolean =>
  c.parts.includes(part);

export interface Violation {
  readonly nodeId: string;
  readonly label: string;
  /** What it is: a gate op or an IC part number. */
  readonly component: string;
  readonly message: string;
}

/**
 * Anything already on the board that this rule forbids.
 *
 * Switching rules mid-build must not silently invalidate work, and it must not
 * silently ALLOW it either — so we report, and let the user decide whether to
 * rebuild.
 */
/**
 * "a AND gate" reads as a typo, and this message appears every time somebody
 * switches rules mid-build. The article follows the SOUND of the name, not the
 * letter: AND, OR, XOR and XNOR all open on a vowel sound; NAND, NOR and NOT do
 * not. A 7408 is "a 7408" ("seven-four-oh-eight").
 */
const article = (name: string): string =>
  /^[AEIOUX]/.test(name) ? "an" : "a";

export function violations(
  doc: CircuitDocument,
  constraint: Constraint,
): Violation[] {
  const out: Violation[] = [];

  for (const node of Object.values(doc.nodes)) {
    if (node.kind === "gate" && !allowsGate(constraint, node.op)) {
      out.push({
        nodeId: node.id,
        label: node.label,
        component: node.op.toUpperCase(),
        message: `${node.label} is ${article(node.op.toUpperCase())} ${node.op.toUpperCase()} gate, which "${constraint.name}" does not permit.`,
      });
    }
    if (node.kind === "ic" && !allowsPart(constraint, node.part)) {
      out.push({
        nodeId: node.id,
        label: node.label,
        component: node.part,
        message: `${node.label} is a ${node.part}, which "${constraint.name}" does not permit.`,
      });
    }
  }

  return out;
}

export const satisfies = (doc: CircuitDocument, c: Constraint): boolean =>
  violations(doc, c).length === 0;
