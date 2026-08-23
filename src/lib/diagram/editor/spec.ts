import {
  DONT_CARE,
  format,
  fromTruthValues,
  minimize,
  parseInput,
  type BooleanFunction,
  type Diagnostic,
  type TruthValue,
} from "@/lib/core-engine";
import { dontCares, minterms } from "@/lib/core-engine/canonical";
import type { FunctionSpec } from "../builders/kit";

/**
 * Turning what somebody types into functions.
 *
 * THREE NOTATIONS, ONE BOX. People arrive at a Boolean function from whichever
 * direction their question came from — an expression, a list of minterms, or a
 * column of output bits — and being told "wrong format" by a tool that could
 * obviously tell which one it was looking at is pure friction. So:
 *
 *     F(A,B,C) = A'B + BC'          an expression
 *     F(A,B,C) = Σm(1,3,5) + d(7)   minterms, with don't-cares
 *     F(A,B,C) = 01101001           the output column, MSB row first
 *
 * The first two are the core engine's own `parseInput`. The third is added here,
 * and it is checked FIRST and strictly — the string `1101` is a perfectly valid
 * expression (four constants juxtaposed, which means AND) so "looks like a bit
 * string" has to mean "is only 0/1/x and is exactly 2^n long", or an ordinary
 * expression would occasionally be read as a truth table.
 *
 * MULTIPLE OUTPUTS, ONE PER LINE. `f1`, `f2` and `f3` over the same variables is
 * how half the standard questions are posed, and it is also what makes a decoder
 * implementation worth drawing. The FIRST line establishes the variable list and
 * every later line inherits it, so only the first has to spell it out.
 */

export interface ParsedSpec {
  readonly specs: readonly FunctionSpec[];
  readonly variables: readonly string[];
  readonly functions: readonly BooleanFunction[];
  readonly diagnostics: readonly Diagnostic[];
  /** Minimal SOP of each function, for showing back what was understood. */
  readonly minimal: readonly string[];
}

export type SpecResult =
  | { readonly ok: true; readonly value: ParsedSpec }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

const WHOLE = { start: 0, end: 0 };

const fail = (message: string, severity: "error" = "error"): SpecResult => ({
  ok: false,
  diagnostics: [{ code: "unexpected-token", message, span: WHOLE, severity }],
});

/** `F(A,B,C) = 01101001` — a name, an optional variable list, and a bit column. */
const TABLE = /^\s*([A-Za-z][\w']*)?\s*(?:\(([^)]*)\))?\s*=\s*([01xX_\-\s]+)$/;

const isPowerOfTwo = (n: number): boolean => n >= 2 && (n & (n - 1)) === 0;

/**
 * `null` means "not a bit column, try the expression parser". An `error` means
 * "this is obviously meant to be a truth table and it does not add up".
 *
 * The distinction earns its keep on `F(A,B,C) = 1010`. Four bits is not a
 * three-variable table, so the old code handed it to the expression parser —
 * which happily read it as four constants ANDed together and built a circuit for
 * the constant 0. A wrong answer, silently, from an obvious typo. Anything that
 * is ONLY 0s, 1s and don't-cares is a truth table somebody got wrong, and saying
 * so is worth more than the vanishing chance they meant a constant.
 */
type TableRead =
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ok"; readonly fn: BooleanFunction };

function asTruthTable(
  line: string,
  inherited: readonly string[] | undefined,
): TableRead {
  const match = TABLE.exec(line);
  if (!match) return { kind: "none" };

  const bits = (match[3] ?? "").replace(/[\s_]/g, "");
  // A single character is `F = 1`, which is a constant, not a one-row table.
  if (!/^[01xX-]+$/.test(bits) || bits.length < 2) return { kind: "none" };

  const declared = (match[2] ?? "")
    .split(/[\s,]+/)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);

  if (!isPowerOfTwo(bits.length)) {
    return {
      kind: "error",
      message: `A truth table needs 2^n rows, and that column has ${bits.length}. ${
        nearestPowers(bits.length)
      }`,
    };
  }

  const n = Math.log2(bits.length);
  const variables = declared.length > 0 ? declared : (inherited ?? defaultNames(n));
  if (variables.length !== n) {
    return {
      kind: "error",
      message: `${bits.length} rows is a ${n}-variable table, but ${
        declared.length > 0 ? "you declared" : "the first line uses"
      } ${variables.length} (${variables.join(", ")}). Either give it ${2 ** variables.length} rows or name ${n} variable${n === 1 ? "" : "s"}.`,
    };
  }

  const values: TruthValue[] = [...bits].map((c) =>
    c === "1" ? 1 : c === "0" ? 0 : DONT_CARE,
  );
  const built = fromTruthValues(variables, values, (match[1] ?? "F").toUpperCase());
  return built.ok ? { kind: "ok", fn: built.value } : { kind: "none" };
}

const nearestPowers = (n: number): string => {
  const below = 2 ** Math.floor(Math.log2(n));
  return `The nearest are ${below} and ${below * 2}.`;
};

const defaultNames = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => "ABCDEFGH"[i] ?? `V${i}`);

/**
 * The variable list a line declares in its own header, if it has one.
 *
 * Needed because `parseInput`'s `variables` argument OVERRIDES the header — so
 * inheriting line 1's variables would silently reinterpret `f2(A,B,C) = …` as a
 * two-variable function and build a circuit for a function nobody wrote. The
 * header has to be read here and compared, so a disagreement is an error rather
 * than a quiet reinterpretation.
 */
const HEADER = /^\s*[A-Za-z][\w']*\s*\(([^)]*)\)\s*=/;

function declaredVariablesOf(line: string): string[] | null {
  const match = HEADER.exec(line);
  if (!match) return null;
  const declared = (match[1] ?? "")
    .split(/[\s,]+/)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  return declared.length > 0 ? declared : null;
}

export function parseSpec(text: string): SpecResult {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("//"));

  if (lines.length === 0) return fail("Type a function to build.");

  const functions: BooleanFunction[] = [];
  const diagnostics: Diagnostic[] = [];
  let variables: readonly string[] | undefined;

  for (const [index, line] of lines.entries()) {
    const table = asTruthTable(line, variables);
    if (table.kind === "error") {
      return fail(lines.length > 1 ? `Line ${index + 1}: ${table.message}` : table.message);
    }
    if (table.kind === "ok") {
      functions.push(table.fn);
      variables ??= table.fn.variables;
      continue;
    }

    const declared = declaredVariablesOf(line);
    if (
      declared &&
      variables &&
      (declared.length !== variables.length || declared.some((v, i) => v !== variables?.[i]))
    ) {
      return fail(
        `Every line must use the same variables. Line ${index + 1} declares ${declared.join(", ")}, but the first line uses ${variables.join(", ")}.`,
      );
    }

    const parsed = parseInput(line, declared ?? variables);
    if (!parsed.ok) {
      return {
        ok: false,
        diagnostics: parsed.diagnostics.map((d) => ({
          ...d,
          message: lines.length > 1 ? `Line ${index + 1}: ${d.message}` : d.message,
        })),
      };
    }
    diagnostics.push(...parsed.diagnostics);
    functions.push(parsed.value);
    variables ??= parsed.value.variables;
  }

  const vars = variables ?? [];
  if (vars.length === 0) return fail("That function has no variables to build from.");
  if (vars.length > 8) {
    return fail(
      `${vars.length} variables is ${2 ** vars.length} rows — more than this can usefully draw. Eight is the limit.`,
    );
  }

  // Every output has to be over the SAME variables, or the drawing would need
  // two input rails and the wiring would be meaningless. Inheritance makes this
  // rare, but an explicit second header can still disagree.
  const mismatch = functions.find(
    (f) => f.variables.length !== vars.length || f.variables.some((v, i) => v !== vars[i]),
  );
  if (mismatch) {
    return fail(
      `Every line must use the same variables. ${mismatch.name} uses ${mismatch.variables.join(", ")}, but the first line uses ${vars.join(", ")}.`,
    );
  }

  // Names must differ, or two output tags collide and one wire lands on the wrong one.
  const names = new Set<string>();
  const specs: FunctionSpec[] = functions.map((fn, i) => {
    let name = fn.name || `F${i + 1}`;
    while (names.has(name)) name = `${name}'`;
    names.add(name);
    return {
      name,
      variables: vars,
      minterms: minterms(fn),
      dontCares: dontCares(fn),
    };
  });

  return {
    ok: true,
    value: {
      specs,
      variables: vars,
      functions,
      diagnostics,
      minimal: functions.map(
        (fn, i) => `${specs[i]?.name ?? fn.name} = ${format(minimize(fn, "sop").expression)}`,
      ),
    },
  };
}

/** `Σm(1, 3, 5) + d(7)`, for echoing back what was understood. */
export const sigmaOf = (spec: FunctionSpec): string => {
  const m = [...spec.minterms].sort((a, b) => a - b).join(", ");
  const d = [...(spec.dontCares ?? [])].sort((a, b) => a - b).join(", ");
  return `${spec.name}(${spec.variables.join(", ")}) = Σm(${m})${d ? ` + d(${d})` : ""}`;
};
