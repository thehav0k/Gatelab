import { elaborate, type SimNetlist } from "./elaborate";
import { LX, LZ, isDefinite, type Logic } from "./logic";
import type { CircuitDocument } from "./netlist";
import { evaluate, type InputVector } from "./solver";
import { diagnose, type Diagnostic } from "./diagnostics";
import type { BooleanFunction } from "@/lib/core-engine/types";
import { DONT_CARE } from "@/lib/core-engine/types";

/**
 * THE VERIFICATION BRIDGE.
 *
 * Sweep every input combination through the circuit the user actually built, and
 * diff the result against the truth table their algebra says it should have.
 *
 * This costs almost nothing to write, because `evaluate()` is already a pure
 * function of (SimNetlist, InputVector) that touches neither the document nor
 * the netlist. So the sweep is literally "call it 2^n times" — no cloning, no
 * snapshotting, no defensive copies. That was the whole point of keeping the
 * solver pure.
 */

export interface VerifyRow {
  readonly minterm: number;
  readonly inputs: readonly (0 | 1)[];
  /** From the theory module. 2 = don't-care, and a don't-care matches anything. */
  readonly expected: 0 | 1 | 2;
  /** From the circuit. May be Z or X — that is a finding, not a bug. */
  readonly actual: Logic;
  readonly ok: boolean;
}

export type Hypothesis =
  | { readonly kind: "output-inverted"; readonly message: string }
  | { readonly kind: "inputs-swapped"; readonly a: string; readonly b: string; readonly message: string }
  | { readonly kind: "output-stuck"; readonly at: Logic; readonly message: string }
  | { readonly kind: "no-output"; readonly message: string }
  | { readonly kind: "floating"; readonly message: string };

export interface VerifyResult {
  readonly ok: boolean;
  readonly rows: readonly VerifyRow[];
  readonly mismatches: readonly VerifyRow[];
  readonly hypotheses: readonly Hypothesis[];
  readonly diagnostics: readonly Diagnostic[];
  /** Input switch labels, in the order they map to the expected function's variables. */
  readonly inputLabels: readonly string[];
  readonly outputLabel: string | null;
  /**
   * The circuit's steady state depends on how it was seeded, which means it has
   * MEMORY. A truth table cannot describe it, and we say so rather than emitting
   * a garbage one.
   */
  readonly nonCombinational: boolean;
  readonly error: string | null;
}

/**
 * Map the circuit's switches onto the expected function's variables.
 *
 * THE TRAP, AND IT IS A NASTY ONE. The netlist sorts its input ports by LABEL
 * (A, B, S). The function lists its variables in DECLARATION order (S, A, B) —
 * and for something like a multiplexer, `F(S, A, B)` is the natural way to write
 * it. Line those two up positionally and every row gets checked against the wrong
 * input combination, so a PERFECTLY CORRECT circuit is reported as wrong. That is
 * the single most damaging thing this bridge could possibly do.
 *
 * A variable's bit is decided by its position IN THE FUNCTION, never by its
 * position in the alphabet. So we build an explicit map from each switch to the
 * variable index it drives, and use that everywhere.
 */
interface Alignment {
  /** The function's variables, in the function's order. */
  readonly labels: string[];
  /** For netlist.inputs[i], the index of the variable it drives. */
  readonly variableOf: number[];
  readonly error: string | null;
}

function alignInputs(netlist: SimNetlist, expected: BooleanFunction): Alignment {
  const switches = netlist.inputs.map((p) => p.label);
  const wanted = [...expected.variables];

  const fail = (error: string): Alignment => ({
    labels: wanted,
    variableOf: [],
    error,
  });

  if (switches.length !== wanted.length) {
    return fail(
      `The circuit has ${switches.length} input switch${
        switches.length === 1 ? "" : "es"
      } (${switches.join(", ") || "none"}), but ${expected.name} has ${
        wanted.length
      } variable${wanted.length === 1 ? "" : "s"} (${wanted.join(", ")}).`,
    );
  }

  const variableOf = switches.map((label) => wanted.indexOf(label));
  const missing = switches.filter((_, i) => variableOf[i] === -1);
  if (missing.length > 0) {
    return fail(
      `Label your input switches ${wanted.join(
        ", ",
      )} so they can be matched to the function's variables. Found: ${switches.join(", ")}.`,
    );
  }

  return { labels: wanted, variableOf, error: null };
}

export function verify(
  doc: CircuitDocument,
  expected: BooleanFunction,
): VerifyResult {
  const { index, netlist } = elaborate(doc);

  const empty = (error: string | null, extra: Partial<VerifyResult> = {}): VerifyResult => ({
    ok: false,
    rows: [],
    mismatches: [],
    hypotheses: [],
    diagnostics: [],
    inputLabels: netlist.inputs.map((p) => p.label),
    outputLabel: netlist.outputs[0]?.label ?? null,
    nonCombinational: false,
    error,
    ...extra,
  });

  const probe = netlist.outputs[0];
  if (!probe) {
    return empty("Add an LED to mark which net is the output.");
  }

  const { labels, variableOf, error } = alignInputs(netlist, expected);
  if (error) return empty(error);

  const n = labels.length;
  const rows: VerifyRow[] = [];

  /**
   * A combinational circuit HAS NO FEEDBACK LOOPS. That is the definition, and
   * it is structurally decidable — `feedbackLoops` comes from a Tarjan pass over
   * the cell graph in elaborate(), independent of any input vector.
   *
   * Deciding it structurally rather than by simulation matters. The tempting
   * alternative — run the circuit from two different seeds and see if the steady
   * state differs — cannot work: a cross-coupled latch is SYMMETRIC, so seeding
   * every gate 0 and seeding every gate 1 both start the pair equal and it simply
   * oscillates either way. You would need an asymmetric seed, which means
   * guessing which of its two stable states to look for. Structure has no such
   * problem.
   *
   * So: if the user built a latch, we do not hand them a truth table that looks
   * authoritative and is meaningless. We tell them it has memory.
   */
  const nonCombinational = netlist.feedbackLoops.length > 0;

  /** The bit of the variable at position `v` inside minterm `m`. MSB contract. */
  const bitOfVar = (m: number, v: number): 0 | 1 =>
    ((m >>> (n - 1 - v)) & 1) as 0 | 1;

  for (let m = 0; m < 1 << n; m++) {
    // Each SWITCH gets the bit of the variable IT drives — not the bit at its own
    // alphabetical position. See the note on alignInputs.
    const inputs: InputVector = variableOf.map((v) => bitOfVar(m, v));

    const state = evaluate(netlist, inputs);
    const actual = state.values[probe.net] as Logic;

    const want = expected.values[m] as 0 | 1 | 2;
    // A don't-care means we told the student they may choose. Failing them for
    // choosing would be a bug in the grader, not in their circuit.
    const ok = want === DONT_CARE ? true : actual === want;

    // Report the row in the FUNCTION's variable order, so the table reads the way
    // the student wrote the function.
    const shown = labels.map((_, v) => bitOfVar(m, v));
    rows.push({ minterm: m, inputs: shown, expected: want, actual, ok });
  }

  const mismatches = rows.filter((r) => !r.ok);

  // Diagnostics for the current switch positions, so the panel can explain WHY.
  const live = evaluate(
    netlist,
    netlist.inputs.map((port) => {
      const node = doc.nodes[port.node];
      return node?.kind === "switch" ? node.state : (0 as const);
    }),
  );
  const diagnostics = diagnose(doc, index, netlist, live);

  return {
    ok: mismatches.length === 0 && !nonCombinational,
    rows,
    mismatches,
    hypotheses: hypothesize(rows, labels, diagnostics, nonCombinational),
    diagnostics,
    inputLabels: labels,
    outputLabel: probe.label,
    nonCombinational,
    error: null,
  };
}

/**
 * Cheap guesses at WHAT the student did wrong. This is the teaching product:
 * "your circuit is wrong on rows 2 and 5" is a grade; "you appear to have
 * swapped A and B" is a lesson.
 */
function hypothesize(
  rows: readonly VerifyRow[],
  labels: readonly string[],
  diagnostics: readonly Diagnostic[],
  nonCombinational: boolean,
): Hypothesis[] {
  const out: Hypothesis[] = [];
  const cared = rows.filter((r) => r.expected !== DONT_CARE);
  if (cared.length === 0) return out;

  if (nonCombinational) {
    out.push({
      kind: "floating",
      message:
        "This circuit's output depends on its own previous state — it has feedback, and therefore memory. A truth table cannot describe it.",
    });
  }

  const floating = diagnostics.find((d) => d.code === "FLOATING_INPUT");
  const unpowered = diagnostics.find((d) => d.code === "UNPOWERED_IC");

  // A specific cause beats a generic symptom. "This chip has no power" explains a
  // dead output far better than "the output is floating" does — so it is checked
  // BEFORE the all-floating early return below, which would otherwise swallow the
  // very case it best explains.
  if (unpowered) {
    out.push({ kind: "floating", message: unpowered.message });
  } else if (rows.some((r) => r.actual === LX) && floating) {
    out.push({ kind: "floating", message: floating.message });
  }

  // Nothing is driving the output on any row.
  if (rows.every((r) => r.actual === LZ)) {
    out.push({
      kind: "no-output",
      message:
        "The output is floating on every row — nothing drives it. Check that the last gate's output actually reaches the LED, and that every chip has power.",
    });
    return out;
  }

  const definite = cared.every((r) => isDefinite(r.actual));

  // Every single bit is flipped: an inversion somewhere.
  if (definite && cared.every((r) => r.actual !== r.expected)) {
    out.push({
      kind: "output-inverted",
      message:
        "Every row is the opposite of what it should be. The output is inverted — you likely used NAND where AND was needed, or dropped an inverter.",
    });
    return out;
  }

  // The output never changes.
  if (definite && new Set(cared.map((r) => r.actual)).size === 1) {
    const at = cared[0]?.actual as Logic;
    out.push({
      kind: "output-stuck",
      at,
      message: `The output is stuck at ${at} no matter what the inputs do. Check for a disconnected wire, or an input tied to a rail by mistake.`,
    });
    return out;
  }

  // The table matches under a swap of two input columns.
  if (definite) {
    const n = labels.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const matches = cared.every((row) => {
          const swapped = swapBits(row.minterm, i, j, n);
          const other = rows[swapped];
          return other !== undefined && other.actual === row.expected;
        });
        if (matches) {
          out.push({
            kind: "inputs-swapped",
            a: labels[i] as string,
            b: labels[j] as string,
            message: `The circuit is correct if you swap ${labels[i]} and ${labels[j]} — check those two wires.`,
          });
          return out;
        }
      }
    }
  }

  return out;
}

/** Exchange the bits at variable positions i and j, under the MSB contract. */
function swapBits(m: number, i: number, j: number, n: number): number {
  const bi = (m >>> (n - 1 - i)) & 1;
  const bj = (m >>> (n - 1 - j)) & 1;
  if (bi === bj) return m;
  return m ^ (1 << (n - 1 - i)) ^ (1 << (n - 1 - j));
}
