import type { BooleanFunction } from "./types";
import { DONT_CARE } from "./types";
import { canonicalSop, dontCares, maxterms, minterms } from "./canonical";
import { format } from "./format";
import { cubeLabel, cubePattern, type Minimization } from "./minimizer";
import { literalCount } from "./ast";

/**
 * The derivation, spelled out.
 *
 * The QM trace already shows *what* the algorithm did. This shows *why*, in the
 * order a person would actually work it on paper — and it exists because a
 * student staring at a prime-implicant chart does not need more tables, they need
 * the sentence that connects one table to the next.
 *
 * Every step carries its own before/after, so the UI never has to reconstruct the
 * reasoning from the data. There is no logic in the component.
 */

export interface DerivationStep {
  readonly n: number;
  readonly title: string;
  /** One sentence: what we are doing and why. */
  readonly explain: string;
  /** The algebra, if this step has any. */
  readonly result?: string;
  /** Supporting rows — a table, a list of terms, a set of merges. */
  readonly rows?: readonly string[];
  /** The takeaway, when there is one worth stating. */
  readonly note?: string;
}

export function deriveSteps(
  fn: BooleanFunction,
  min: Minimization,
): DerivationStep[] {
  const steps: DerivationStep[] = [];
  const ms = minterms(fn);
  const ds = dontCares(fn);
  const Ms = maxterms(fn);
  const n = fn.variables.length;
  const vars = fn.variables.join(", ");

  let step = 1;
  const push = (s: Omit<DerivationStep, "n">) => steps.push({ n: step++, ...s });

  // --- 1. read the table ----------------------------------------------------
  push({
    title: "Read the rows where the function is 1",
    explain: `Every row of the truth table where ${fn.name} = 1 is a minterm — one specific combination of inputs that must switch the output on.`,
    result:
      ms.length > 0
        ? `${fn.name}(${vars}) = Σm(${ms.join(", ")})${ds.length ? ` + d(${ds.join(", ")})` : ""}`
        : `${fn.name}(${vars}) = 0`,
    rows: ms.map((m) => `m${m} = ${termFor(fn, m)}`),
    ...(ds.length > 0
      ? {
          note: `Rows ${ds.join(", ")} are DON'T-CARES. They may come out 0 or 1 — we are free to choose whichever makes the answer smaller, and that freedom is worth a lot.`,
        }
      : {}),
  });

  if (min.trace.degenerate === "always-false") {
    push({
      title: "The function is never 1",
      explain: "There are no minterms at all, so the output is the constant 0.",
      result: `${fn.name} = 0`,
    });
    return steps;
  }
  if (min.trace.degenerate === "always-true") {
    push({
      title: "The function is always 1",
      explain: `Every care row is 1 (there are no maxterms), so the output is the constant 1.`,
      result: `${fn.name} = 1`,
    });
    return steps;
  }

  // --- 2. canonical SOP -----------------------------------------------------
  const canonical = canonicalSop(fn);
  push({
    title: "Write it out the long way",
    explain:
      "OR the minterms together. This is the canonical sum of products — always correct, and always bigger than it needs to be.",
    result: format(canonical),
    note: `${literalCount(canonical)} literals. Every term names every variable, which is exactly the waste we are about to remove.`,
  });

  // --- 3. combine ------------------------------------------------------------
  const merges = min.trace.columns.flatMap((c) => c.merges);
  if (merges.length > 0) {
    push({
      title: "Combine terms that differ in one variable",
      explain:
        "If two terms are identical except for one variable — one has it, the other has its complement — that variable cannot matter. XY + XY' = X(Y + Y') = X. Drop it.",
      rows: merges
        .slice(0, 14)
        .map(
          (m) =>
            `${cubePattern(m.from[0], n)} + ${cubePattern(m.from[1], n)} → ${cubePattern(m.into, n)}   (${m.eliminated} cancels)`,
        ),
      note:
        merges.length > 14
          ? `…and ${merges.length - 14} more. Repeat until nothing else combines.`
          : "Repeat until nothing else combines. Whatever is left can shrink no further — those are the PRIME IMPLICANTS.",
    });
  }

  // --- 4. prime implicants ---------------------------------------------------
  const pis = min.trace.chart.rows;
  push({
    title: "Collect the prime implicants",
    explain:
      "A prime implicant is a term that has been combined as far as it can go. Every one of them is a legal piece of the answer — but we probably do not need all of them.",
    rows: pis.map((r) => `${r.label}   covers ${r.covers.map((m) => `m${m}`).join(", ")}`),
  });

  // --- 5. essential ----------------------------------------------------------
  const essentials = min.trace.essentials;
  if (essentials.length > 0) {
    push({
      title: "Find the ones you have no choice about",
      explain:
        "If a minterm is covered by exactly ONE prime implicant, that implicant has to be in the answer — nothing else can cover that row. Those are the essential prime implicants.",
      rows: essentials.map((e) => {
        const label = cubeLabel(e.cube, fn.variables);
        return `${label} is the only term covering m${e.becauseOf}, so it must be included.`;
      }),
    });
  } else {
    push({
      title: "No term is forced",
      explain:
        "Every minterm is covered by more than one prime implicant, so nothing is essential. The chart is CYCLIC and the cover has to be chosen by search rather than read off.",
      note: "This is where Petrick's method comes in: multiply out the choices and take the cheapest.",
    });
  }

  // --- 6. cover the rest ------------------------------------------------------
  const covered = new Set(essentials.flatMap((e) => e.cube.covers));
  const remaining = ms.filter((m) => !covered.has(m));
  if (remaining.length > 0) {
    push({
      title: "Cover whatever is left",
      explain: `The essential terms do not reach ${remaining.map((m) => `m${m}`).join(", ")}. Pick the cheapest remaining implicants that do.`,
      ...(min.trace.petrick
        ? {
            rows: [
              min.trace.petrick.clauses
                .map((c) => `(${c.rows.join(" + ")})`)
                .join(" · ") + "  must all be satisfied",
              `cheapest product: ${min.trace.petrick.chosen.join(" · ") || "—"}`,
            ],
          }
        : {}),
    });
  } else if (essentials.length > 0) {
    push({
      title: "Nothing is left over",
      explain:
        "The essential prime implicants already cover every minterm, so the answer is just those. No search is needed.",
    });
  }

  // --- 7. the answer ----------------------------------------------------------
  const saved = literalCount(canonical) - min.literals;
  push({
    title: "The minimal sum of products",
    explain: "OR the chosen terms together. This is the answer.",
    result: `${fn.name} = ${format(min.expression)}`,
    note:
      saved > 0
        ? `${min.literals} literals, down from ${literalCount(canonical)} — ${saved} fewer.${
            min.alternativeCovers.length > 0
              ? ` ${min.alternativeCovers.length} other cover${min.alternativeCovers.length === 1 ? "" : "s"} of exactly the same cost also exist; none is more correct than this one.`
              : ""
          }`
        : `${min.literals} literals. Nothing could be saved — this function was already minimal.`,
  });

  // --- 8. the POS aside --------------------------------------------------------
  if (Ms.length > 0 && Ms.length < fn.values.length) {
    push({
      title: "And the other way round",
      explain:
        "The same function can be written as a product of sums by grouping the 0s instead of the 1s. Sometimes it is cheaper; often it is not. It is the same function either way.",
      result: `${fn.name} = ΠM(${Ms.join(", ")})`,
    });
  }

  return steps;
}

/** The product term for one minterm: A·B'·C. */
function termFor(fn: BooleanFunction, m: number): string {
  const n = fn.variables.length;
  return fn.variables
    .map((v, i) => {
      const bit = (m >>> (n - 1 - i)) & 1;
      return bit === 1 ? v : `${v}'`;
    })
    .join("·");
}

/** Row-by-row view of the truth table, for the editor. */
export interface TruthRow {
  readonly minterm: number;
  readonly inputs: readonly (0 | 1)[];
  readonly output: 0 | 1 | 2;
}

export function truthRows(fn: BooleanFunction): TruthRow[] {
  const n = fn.variables.length;
  return Array.from({ length: fn.values.length }, (_, m) => ({
    minterm: m,
    inputs: fn.variables.map((_, i) => ((m >>> (n - 1 - i)) & 1) as 0 | 1),
    output: fn.values[m] as 0 | 1 | 2,
  }));
}

export const OUTPUT_CYCLE: Readonly<Record<0 | 1 | 2, 0 | 1 | 2>> = {
  0: 1,
  1: DONT_CARE,
  [DONT_CARE]: 0,
};
