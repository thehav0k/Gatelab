import type { GateOp } from "./logic";
import type { GateNetlist, LogicGate } from "./synth";
import { checkCompleteness } from "./completeness";

/**
 * Rewrite a gate netlist into an ARBITRARY allowed gate set.
 *
 * The old synthesizer had three hardcoded strategies (mixed, NAND-only,
 * NOR-only). That covers the exercises everyone sets and none of the ones a
 * teacher actually invents — "OR and NOT only", "no XOR", "NAND and XOR".
 *
 * The generalization is straightforward once you notice that every rewrite
 * bottoms out in three primitives: NOT, AND, OR. Derive those three from
 * whatever is allowed, and everything else follows by definition. If any of them
 * cannot be derived, the set is not universal — and completeness.ts will already
 * have said so, with the reason.
 *
 * The derivations, in the order we prefer them (cheapest first):
 *
 *   NOT a  =  NAND(a,a)  |  NOR(a,a)  |  XOR(a,1)  |  XNOR(a,0)
 *   a·b    =  NOT(NAND(a,b))  |  NOR(NOT a, NOT b)  |  NOT(OR(NOT a, NOT b))
 *   a+b    =  NOT(NOR(a,b))   |  NAND(NOT a, NOT b) |  NOT(AND(NOT a, NOT b))
 *   a⊕b    =  NOT(XNOR(a,b))  |  (a·¬b) + (¬a·b)
 *
 * The `XOR(a,1)` route is why the rails matter: with a constant 1 available,
 * XOR alone gives you an inverter — which is exactly what turns the otherwise
 * T0-trapped set {XOR, AND} into a universal one.
 */

export interface RewriteResult {
  readonly netlist: GateNetlist;
  readonly ok: boolean;
  readonly error: string | null;
}

export function rewriteToSet(
  nl: GateNetlist,
  allowed: readonly GateOp[],
): RewriteResult {
  const complete = checkCompleteness(allowed);
  if (!complete.complete) {
    return {
      netlist: nl,
      ok: false,
      error: complete.reason,
    };
  }

  const can = (op: GateOp): boolean => allowed.includes(op);

  const gates: LogicGate[] = [];
  let nextSignal =
    Math.max(nl.inputs.length, ...nl.gates.map((g) => g.output + 1), 0) + 1;

  const memo = new Map<string, number>();
  const emit = (op: GateOp, ins: readonly number[]): number => {
    const key = `${op}(${[...ins].sort((a, b) => a - b).join(",")})`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const output = nextSignal++;
    gates.push({ id: gates.length, op, inputs: [...ins], output });
    memo.set(key, output);
    return output;
  };

  /**
   * The constants. These are the power rails, and they are what make several
   * otherwise-incomplete sets usable — see the note above.
   *
   * A constant is materialized as a signal id below the input range, which
   * realize() wires to +5V or GND.
   */
  const CONST_1 = -1;
  const CONST_0 = -2;

  // --- the three primitives, derived from whatever is on offer ---------------

  const NOT = (a: number): number => {
    if (can("not")) return emit("not", [a]);
    if (can("nand")) return emit("nand", [a, a]);
    if (can("nor")) return emit("nor", [a, a]);
    if (can("xor")) return emit("xor", [a, CONST_1]); // a ⊕ 1 = ¬a
    if (can("xnor")) return emit("xnor", [a, CONST_0]); // ¬(a ⊕ 0) = ¬a
    throw new Error("no inverter is derivable");
  };

  const AND = (a: number, b: number): number => {
    if (can("and")) return emit("and", [a, b]);
    if (can("nand")) return NOT(emit("nand", [a, b]));
    if (can("nor")) return emit("nor", [NOT(a), NOT(b)]); // De Morgan
    if (can("or")) return NOT(emit("or", [NOT(a), NOT(b)]));
    throw new Error("no conjunction is derivable");
  };

  const OR = (a: number, b: number): number => {
    if (can("or")) return emit("or", [a, b]);
    if (can("nor")) return NOT(emit("nor", [a, b]));
    if (can("nand")) return emit("nand", [NOT(a), NOT(b)]); // De Morgan
    if (can("and")) return NOT(emit("and", [NOT(a), NOT(b)]));
    throw new Error("no disjunction is derivable");
  };

  const XOR = (a: number, b: number): number => {
    if (can("xor")) return emit("xor", [a, b]);
    if (can("xnor")) return NOT(emit("xnor", [a, b]));
    // a⊕b = (a·¬b) + (¬a·b)
    return OR(AND(a, NOT(b)), AND(NOT(a), b));
  };

  const build = (op: GateOp, ins: readonly number[]): number => {
    const a = ins[0] as number;
    const b = ins[1] as number;

    switch (op) {
      case "not":
        return NOT(a);
      case "buf":
        return NOT(NOT(a));
      case "and":
        return AND(a, b);
      case "or":
        return OR(a, b);
      case "nand":
        return NOT(AND(a, b));
      case "nor":
        return NOT(OR(a, b));
      case "xor":
        return XOR(a, b);
      case "xnor":
        return NOT(XOR(a, b));
    }
  };

  const remap = new Map<number, number>(nl.inputs.map((i) => [i.signal, i.signal]));

  try {
    for (const g of nl.gates) {
      const ins = g.inputs.map((s) => remap.get(s) ?? s);
      remap.set(g.output, build(g.op, ins));
    }
  } catch (e) {
    return {
      netlist: nl,
      ok: false,
      error: e instanceof Error ? e.message : "could not rewrite",
    };
  }

  return {
    netlist: {
      gates,
      inputs: nl.inputs,
      outputSignal: remap.get(nl.outputSignal) ?? nl.outputSignal,
      constant: nl.constant,
    },
    ok: true,
    error: null,
  };
}

/** Signal ids below zero are the power rails, not gate outputs. */
export const isConstantSignal = (s: number): boolean => s < 0;
export const constantValue = (s: number): 0 | 1 => (s === -1 ? 1 : 0);
