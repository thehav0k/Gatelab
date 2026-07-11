import { analyze } from "../core-engine";
import type { Constraint } from "./constraints";
import { checkCompleteness } from "./completeness";
import type { CircuitDocument } from "./netlist";
import {
  realize,
  synthesize,
  technologyMap,
  type MappedDesign,
} from "./synth";

/**
 * Re-synthesize a circuit under a different gate rule.
 *
 * The lab used to leave the board exactly as it was when you changed the rule.
 * That is right for a circuit you WIRED — silently rewriting someone's work is
 * unforgivable, and the invariant says so — but it is wrong for a circuit the app
 * BUILT for you. If the machine put a 7408 there, and you then say "NAND only",
 * the machine should put a 7400 there instead. Otherwise the rule is a lint on a
 * diagram nobody updated, and choosing "NAND only" appears to do nothing at all.
 *
 * The distinction is provenance, and it is the store's job to track it: this
 * function just answers "what would this function look like under that rule",
 * from the source expression alone. Same parser, same minimizer, same synthesizer
 * that Build-it uses — so the rebuilt board is the board you would have got if you
 * had chosen the rule first.
 */

export type Rebuild =
  | { readonly ok: true; readonly doc: CircuitDocument; readonly design: MappedDesign }
  | { readonly ok: false; readonly reason: string };

export function rebuildUnder(source: string, constraint: Constraint): Rebuild {
  const parsed = analyze(source);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.diagnostics[0]?.message ?? "That expression no longer parses.",
    };
  }

  const { fn, sop } = parsed.value;
  const netlist = synthesize(sop.expression, fn.variables);

  if (netlist.constant !== null) {
    return {
      ok: false,
      reason: `That function is the constant ${netlist.constant}. There is no circuit to build.`,
    };
  }

  const restricted = constraint.id !== "none";
  if (restricted) {
    // A rule can be IMPOSSIBLE — "XOR only" cannot express AND, at any size. Refuse
    // with the mathematics rather than building something that breaks the rule.
    const completeness = checkCompleteness(constraint.gates);
    if (!completeness.complete) {
      return {
        ok: false,
        // `reason` is only null when the set IS complete, but the type cannot say so.
        reason: completeness.reason ?? "That gate set cannot express every function.",
      };
    }
  }

  const design = technologyMap(
    netlist,
    constraint.strategy,
    restricted ? constraint.gates : undefined,
  );

  return { ok: true, doc: realize(design, { outputLabel: "F" }), design };
}
