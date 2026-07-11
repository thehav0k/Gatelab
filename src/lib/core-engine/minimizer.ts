import { mkConst, mkNary, mkNot, mkVar, type Expr } from "./ast";
import { minterms, dontCares, maxterms, complement } from "./canonical";
import {
  bitOf,
  popcount,
  varMask,
  type BooleanFunction,
  type Cube,
} from "./types";

/**
 * Quine-McCluskey, with every intermediate state captured.
 *
 * The pedagogical output IS the product here — a minimizer that only returns the
 * answer is worthless for a lab assistant. So the trace is a typed structure the
 * UI renders, not a string log: `MinimizationTrace` carries the popcount groups,
 * each combining pass with which terms merged into which, the prime implicant
 * chart, the essential-PI extraction, the dominance reductions, and Petrick's
 * expansion for the cyclic remainder.
 *
 * Cube representation (see types.ts): `care` marks which variables survive,
 * `bits` their required polarity. Two cubes combine iff they have IDENTICAL
 * `care` masks and their `bits` differ in exactly one position. Omitting the
 * identical-care guard is the classic QM bug — it "works" on small examples and
 * silently produces non-implicants on larger ones.
 */

// ---------------------------------------------------------------------------
// Result & trace types
// ---------------------------------------------------------------------------

export type Form = "sop" | "pos";

export interface Minimization {
  readonly form: Form;
  /** The chosen cover. For POS these are cubes of the *complement* — see toExpr. */
  readonly cover: readonly Cube[];
  readonly expression: Expr;
  readonly literals: number;
  /** Every minimal cover found, not just the one we picked. Often there are several. */
  readonly alternativeCovers: readonly (readonly Cube[])[];
  readonly trace: MinimizationTrace;
}

export interface MinimizationTrace {
  readonly form: Form;
  readonly variables: readonly string[];
  readonly minterms: readonly number[];
  readonly dontCares: readonly number[];
  /** Set when the function is constant 0 or constant 1; the pipeline is skipped. */
  readonly degenerate: "always-false" | "always-true" | null;
  readonly columns: readonly TabularColumn[];
  readonly primeImplicants: readonly Cube[];
  readonly chart: PrimeImplicantChart;
  readonly essentials: readonly EssentialPick[];
  readonly reductions: readonly DominanceStep[];
  readonly petrick: PetrickStep | null;
  /**
   * True when the exact minimum-cover search hit its budget and we fell back to
   * a greedy cover. The UI must say so — silently returning an approximation as
   * "the minimal form" is how a student gets marked wrong by their grader.
   */
  readonly approximated: boolean;
}

/** One column of the tabular method: the terms, grouped by number of 1s. */
export interface TabularColumn {
  readonly index: number;
  readonly groups: readonly TabularGroup[];
  readonly merges: readonly Merge[];
}

export interface TabularGroup {
  readonly ones: number;
  readonly entries: readonly TabularEntry[];
}

export interface TabularEntry {
  readonly cube: Cube;
  readonly label: string;
  /** False => this cube never combined with anything, so it is a prime implicant. */
  readonly combined: boolean;
  readonly isDontCareOnly: boolean;
}

export interface Merge {
  readonly from: readonly [Cube, Cube];
  readonly into: Cube;
  /** The variable that cancelled out. */
  readonly eliminated: string;
}

export interface PrimeImplicantChart {
  /** Only the *care* terms. Don't-cares must never be columns — see below. */
  readonly columns: readonly number[];
  readonly rows: readonly ChartRow[];
}

export interface ChartRow {
  readonly cube: Cube;
  readonly label: string;
  /** Which of `chart.columns` this row covers. */
  readonly covers: readonly number[];
}

export interface EssentialPick {
  readonly cube: Cube;
  /** The minterm covered by this PI and no other — the reason it is essential. */
  readonly becauseOf: number;
}

export interface DominanceStep {
  readonly kind: "row-dominance" | "column-dominance";
  readonly removed: string;
  readonly dominatedBy: string;
  readonly explanation: string;
}

export interface PetrickStep {
  /** Product-of-sums form, one clause per uncovered minterm. */
  readonly clauses: readonly { readonly minterm: number; readonly rows: readonly string[] }[];
  /** Each expanded product term (a candidate cover), after absorption. */
  readonly products: readonly (readonly string[])[];
  readonly chosen: readonly string[];
  readonly exhausted: boolean;
}

/** Guard on Petrick's expansion. Minimum-cover is NP-hard; this must terminate. */
const PETRICK_BUDGET = 200_000;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function minimize(fn: BooleanFunction, form: Form = "sop"): Minimization {
  // POS is the dual: minimize the complement as an SOP, then De Morgan it. This
  // is not a shortcut — it is the definition, and it means one tested algorithm
  // serves both forms instead of two nearly-identical ones.
  const target = form === "sop" ? fn : complement(fn);

  const ones = minterms(target);
  const dcs = dontCares(target);
  const n = target.variables.length;

  const degenerate = checkDegenerate(target, ones, form);
  if (degenerate) return degenerate;

  // --- 1. tabular reduction ------------------------------------------------
  const { columns, primeImplicants } = tabulate(ones, dcs, n, target.variables);

  // --- 2. prime implicant chart -------------------------------------------
  // Pitfall #6: don't-cares are MERGE FUEL, not coverage obligations. They take
  // part in the tabulation above (so cubes can grow) but they are NOT columns of
  // the chart — nothing needs to cover them. A PI made only of don't-cares
  // covers no obligation at all and is discarded outright.
  const usefulPIs = primeImplicants.filter((pi) =>
    pi.covers.some((m) => ones.includes(m)),
  );
  const labels = labelCubes(usefulPIs, target.variables);
  const chart = buildChart(usefulPIs, ones, labels);

  // --- 3. essential prime implicants --------------------------------------
  const { essentials, remaining } = findEssentials(chart, ones);

  // --- 4. cover the remainder ---------------------------------------------
  const essentialCubes = essentials.map((e) => e.cube);
  const reductions: DominanceStep[] = [];
  let petrick: PetrickStep | null = null;
  let approximated = false;
  let covers: Cube[][] = [essentialCubes];

  if (remaining.length > 0) {
    const secondary = solveCover(
      chart,
      remaining,
      essentialCubes,
      labels,
      reductions,
    );
    petrick = secondary.petrick;
    approximated = secondary.approximated;
    covers = secondary.covers.map((extra) => [...essentialCubes, ...extra]);
  }

  const scored = covers
    .map((c) => ({ cover: c, cost: coverCost(c, n) }))
    .sort((a, b) => a.cost - b.cost);
  const best = scored[0] as { cover: Cube[]; cost: number };
  const minCost = best.cost;
  const alternatives = scored
    .filter((s) => s.cost === minCost)
    .map((s) => s.cover);

  const expression = coverToExpr(best.cover, target.variables, form);

  return {
    form,
    cover: best.cover,
    expression,
    literals: countLiterals(best.cover, n),
    alternativeCovers: alternatives.slice(1),
    trace: {
      form,
      variables: target.variables,
      minterms: ones,
      dontCares: dcs,
      degenerate: null,
      columns,
      primeImplicants: usefulPIs,
      chart,
      essentials,
      reductions,
      petrick,
      approximated,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Tabular reduction
// ---------------------------------------------------------------------------

function tabulate(
  ones: readonly number[],
  dcs: readonly number[],
  n: number,
  variables: readonly string[],
): { columns: TabularColumn[]; primeImplicants: Cube[] } {
  const fullCare = n === 0 ? 0 : (1 << n) - 1;
  const careSet = new Set(ones);

  let current: Cube[] = [...ones, ...dcs]
    .sort((a, b) => a - b)
    .map((m) => ({ care: fullCare, bits: m, covers: [m] }));

  const columns: TabularColumn[] = [];
  const primeImplicants: Cube[] = [];
  let columnIndex = 0;

  while (current.length > 0) {
    const merges: Merge[] = [];
    const next = new Map<string, Cube>();
    const combined = new Set<number>();

    // Group by popcount of the *bits under care*, which is the QM grouping key.
    const byOnes = new Map<number, number[]>();
    current.forEach((cube, i) => {
      const k = popcount(cube.bits & cube.care);
      const bucket = byOnes.get(k);
      if (bucket) bucket.push(i);
      else byOnes.set(k, [i]);
    });

    const sortedOnes = [...byOnes.keys()].sort((a, b) => a - b);

    // Only adjacent popcount groups can combine: merging flips exactly one bit,
    // which changes the count by exactly one.
    for (const k of sortedOnes) {
      const here = byOnes.get(k) ?? [];
      const there = byOnes.get(k + 1) ?? [];

      for (const i of here) {
        for (const j of there) {
          const a = current[i] as Cube;
          const b = current[j] as Cube;

          // THE GUARD. Two cubes may only combine if they cover the same set of
          // variables. Without this, A'B (care=110) would "combine" with A'BC
          // (care=111) and produce a cube that is not an implicant of anything.
          if (a.care !== b.care) continue;

          const diff = (a.bits ^ b.bits) & a.care;
          if (popcount(diff) !== 1) continue;

          combined.add(i);
          combined.add(j);

          const merged: Cube = {
            care: a.care & ~diff,
            bits: a.bits & ~diff,
            covers: mergeSorted(a.covers, b.covers),
          };

          const key = cubeKey(merged);
          if (!next.has(key)) next.set(key, merged);

          merges.push({
            from: [a, b],
            into: merged,
            eliminated: variables[maskIndex(diff, n)] as string,
          });
        }
      }
    }

    columns.push({
      index: columnIndex,
      groups: sortedOnes.map((ones_) => ({
        ones: ones_,
        entries: (byOnes.get(ones_) ?? []).map((i) => {
          const cube = current[i] as Cube;
          return {
            cube,
            label: cubeLabel(cube, variables),
            combined: combined.has(i),
            isDontCareOnly: !cube.covers.some((m) => careSet.has(m)),
          };
        }),
      })),
      merges,
    });

    // Anything that failed to combine with anything can grow no further: prime.
    current.forEach((cube, i) => {
      if (!combined.has(i)) primeImplicants.push(cube);
    });

    current = [...next.values()];
    columnIndex += 1;
  }

  return { columns, primeImplicants: dedupeCubes(primeImplicants) };
}

// ---------------------------------------------------------------------------
// 2 & 3. Chart and essentials
// ---------------------------------------------------------------------------

function buildChart(
  pis: readonly Cube[],
  ones: readonly number[],
  labels: ReadonlyMap<string, string>,
): PrimeImplicantChart {
  const careSet = new Set(ones);
  return {
    columns: [...ones],
    rows: pis.map((cube) => ({
      cube,
      label: labels.get(cubeKey(cube)) as string,
      covers: cube.covers.filter((m) => careSet.has(m)),
    })),
  };
}

function findEssentials(
  chart: PrimeImplicantChart,
  ones: readonly number[],
): { essentials: EssentialPick[]; remaining: number[] } {
  const essentials: EssentialPick[] = [];
  const chosen = new Set<string>();

  // A minterm covered by exactly one PI forces that PI into every cover.
  for (const m of ones) {
    const covering = chart.rows.filter((r) => r.covers.includes(m));
    const only = covering[0];
    if (covering.length === 1 && only && !chosen.has(only.label)) {
      chosen.add(only.label);
      essentials.push({ cube: only.cube, becauseOf: m });
    }
  }

  const covered = new Set<number>();
  for (const e of essentials) {
    for (const m of e.cube.covers) covered.add(m);
  }

  return {
    essentials,
    remaining: ones.filter((m) => !covered.has(m)),
  };
}

// ---------------------------------------------------------------------------
// 4. Cover the cyclic remainder
// ---------------------------------------------------------------------------

function solveCover(
  chart: PrimeImplicantChart,
  remaining: readonly number[],
  essentials: readonly Cube[],
  labels: ReadonlyMap<string, string>,
  reductions: DominanceStep[],
): {
  covers: Cube[][];
  petrick: PetrickStep | null;
  approximated: boolean;
} {
  const essentialKeys = new Set(essentials.map(cubeKey));
  let rows = chart.rows
    .filter((r) => !essentialKeys.has(cubeKey(r.cube)))
    .map((r) => ({
      label: r.label,
      cube: r.cube,
      covers: r.covers.filter((m) => remaining.includes(m)),
    }))
    .filter((r) => r.covers.length > 0);

  let columns = [...remaining];

  // --- dominance reduction, recorded for the trace -------------------------
  // Pitfall #8: the directions are opposite and easy to invert.
  //   Row dominance:    row A covers a SUPERSET of row B  => drop B (dominated).
  //   Column dominance: column X is covered by a SUPERSET of the rows that cover
  //                     column Y => drop X (dominating) — satisfying Y satisfies X.
  //
  // We record these for the trace but do NOT let them prune the enumeration
  // below, because dominance can discard a genuinely distinct equally-minimal
  // solution, and we want to show the student every minimal answer.
  for (let changed = true; changed; ) {
    changed = false;

    outer: for (const a of rows) {
      for (const b of rows) {
        if (a.label === b.label) continue;
        const aCost = popcount(a.cube.care);
        const bCost = popcount(b.cube.care);
        if (isSuperset(a.covers, b.covers) && aCost <= bCost) {
          if (a.covers.length === b.covers.length && aCost === bCost) continue;
          reductions.push({
            kind: "row-dominance",
            removed: b.label,
            dominatedBy: a.label,
            explanation: `${a.label} covers everything ${b.label} does, for no more literals, so ${b.label} can be dropped.`,
          });
          rows = rows.filter((r) => r.label !== b.label);
          changed = true;
          break outer;
        }
      }
    }

    if (changed) continue;

    outer2: for (const x of columns) {
      for (const y of columns) {
        if (x === y) continue;
        const rx = rows.filter((r) => r.covers.includes(x)).map((r) => r.label);
        const ry = rows.filter((r) => r.covers.includes(y)).map((r) => r.label);
        if (rx.length > ry.length && isSuperset(rx, ry)) {
          reductions.push({
            kind: "column-dominance",
            removed: String(x),
            dominatedBy: String(y),
            explanation: `Every implicant that covers m${y} also covers m${x}, so covering m${y} covers m${x} for free.`,
          });
          columns = columns.filter((c) => c !== x);
          changed = true;
          break outer2;
        }
      }
    }
  }

  if (columns.length === 0 || rows.length === 0) {
    return { covers: [[]], petrick: null, approximated: false };
  }

  // --- Petrick's method ----------------------------------------------------
  const clauses = columns.map((m) => ({
    minterm: m,
    rows: rows.filter((r) => r.covers.includes(m)).map((r) => r.label),
  }));

  const byLabel = new Map(rows.map((r) => [r.label, r.cube]));
  const expansion = expandPetrick(clauses);

  if (expansion.exhausted) {
    // Budget blown. Fall back to greedy set-cover and SAY SO — an approximation
    // presented as "the minimal form" is worse than no answer, because the
    // student cannot tell it apart from the real one.
    const greedy = greedyCover(rows, columns);
    return {
      covers: [greedy.map((l) => byLabel.get(l) as Cube)],
      petrick: {
        clauses,
        products: [],
        chosen: greedy,
        exhausted: true,
      },
      approximated: true,
    };
  }

  // Among the expanded products, keep every one of minimum cost.
  const cost = (labelSet: readonly string[]): number =>
    labelSet.reduce(
      (sum, l) => sum + popcount((byLabel.get(l) as Cube).care),
      labelSet.length,
    );

  const minCost = Math.min(...expansion.products.map(cost));
  const winners = expansion.products.filter((p) => cost(p) === minCost);
  const chosen = winners[0] as string[];

  return {
    covers: winners.map((w) => w.map((l) => byLabel.get(l) as Cube)),
    petrick: {
      clauses,
      products: expansion.products,
      chosen,
      exhausted: false,
    },
    approximated: false,
  };
}

/**
 * Petrick's method: multiply out the product-of-sums, absorbing as we go.
 *
 * Absorption (`X + XY = X`) is what keeps this tractable — without it the term
 * count explodes multiplicatively and even small cyclic charts blow up. With it,
 * the classroom-sized charts finish instantly. We still keep a hard budget,
 * because minimum-cover is NP-hard and a pure function must never loop unbounded
 * even inside a worker (an unkillable worker is still a leak).
 */
function expandPetrick(
  clauses: readonly { minterm: number; rows: readonly string[] }[],
): { products: string[][]; exhausted: boolean } {
  let products: string[][] = [[]];
  let work = 0;

  for (const clause of clauses) {
    const next: string[][] = [];
    for (const p of products) {
      for (const label of clause.rows) {
        work += 1;
        if (work > PETRICK_BUDGET) return { products: [], exhausted: true };
        next.push(p.includes(label) ? p : [...p, label].sort());
      }
    }
    products = absorb(next);
  }

  return { products, exhausted: false };
}

/** Drop any product that is a superset of another — that is `X + XY = X`. */
function absorb(products: readonly string[][]): string[][] {
  const unique = [...new Map(products.map((p) => [p.join(","), p])).values()];
  unique.sort((a, b) => a.length - b.length);

  const kept: string[][] = [];
  for (const p of unique) {
    if (!kept.some((k) => k.every((l) => p.includes(l)))) kept.push(p);
  }
  return kept;
}

/** The fallback when Petrick's budget is exhausted. Always covers; rarely optimal. */
function greedyCover(
  rows: readonly { label: string; cube: Cube; covers: readonly number[] }[],
  columns: readonly number[],
): string[] {
  const uncovered = new Set(columns);
  const chosen: string[] = [];

  while (uncovered.size > 0) {
    let best: { label: string; gain: number; cost: number } | null = null;
    for (const r of rows) {
      if (chosen.includes(r.label)) continue;
      const gain = r.covers.filter((m) => uncovered.has(m)).length;
      if (gain === 0) continue;
      const cost = popcount(r.cube.care);
      if (!best || gain > best.gain || (gain === best.gain && cost < best.cost)) {
        best = { label: r.label, gain, cost };
      }
    }
    if (!best) break; // unreachable for a well-formed chart, but never spin
    chosen.push(best.label);
    const picked = rows.find((r) => r.label === best.label);
    for (const m of picked?.covers ?? []) uncovered.delete(m);
  }

  return chosen;
}

// ---------------------------------------------------------------------------
// Degenerate cases
// ---------------------------------------------------------------------------

function checkDegenerate(
  fn: BooleanFunction,
  ones: readonly number[],
  form: Form,
): Minimization | null {
  const zeros = maxterms(fn);
  const emptyTrace = (
    degenerate: "always-false" | "always-true",
  ): MinimizationTrace => ({
    form,
    variables: fn.variables,
    minterms: ones,
    dontCares: dontCares(fn),
    degenerate,
    columns: [],
    primeImplicants: [],
    chart: { columns: [], rows: [] },
    essentials: [],
    reductions: [],
    petrick: null,
    approximated: false,
  });

  const span = { start: 0, end: 0 };

  // No minterms: the SOP is 0. (In POS mode we are minimizing the complement,
  // so "the complement is never true" means the original is always true: 1.)
  if (ones.length === 0) {
    return {
      form,
      cover: [],
      expression: mkConst(form === "sop" ? 0 : 1, span),
      literals: 0,
      alternativeCovers: [],
      trace: emptyTrace("always-false"),
    };
  }

  // No maxterms: every care row is 1, so the function is the constant 1.
  if (zeros.length === 0) {
    return {
      form,
      cover: [{ care: 0, bits: 0, covers: ones }],
      expression: mkConst(form === "sop" ? 1 : 0, span),
      literals: 0,
      alternativeCovers: [],
      trace: emptyTrace("always-true"),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cover -> expression
// ---------------------------------------------------------------------------

/**
 * For SOP: each cube is a product, OR'd together.
 *
 * For POS: `cover` describes the COMPLEMENT of the function (we minimized F').
 * By De Morgan, F = (F')' turns each product of the complement into a sum term
 * with every literal inverted, and the OR into an AND. So a complement cube
 * A·B' becomes the clause (A' + B).
 */
function coverToExpr(
  cover: readonly Cube[],
  variables: readonly string[],
  form: Form,
): Expr {
  const span = { start: 0, end: 0 };
  const n = variables.length;

  if (cover.length === 0) return mkConst(form === "sop" ? 0 : 1, span);

  const terms = cover.map((cube) => {
    const literals: Expr[] = [];
    for (let i = 0; i < n; i++) {
      const mask = varMask(i, n);
      if ((cube.care & mask) === 0) continue;
      const isOne = (cube.bits & mask) !== 0;
      // SOP: a 0 bit means a complemented literal. POS: the polarity flips.
      const negate = form === "sop" ? !isOne : isOne;
      const v = mkVar(variables[i] as string, span);
      literals.push(negate ? mkNot(v, span) : v);
    }

    if (literals.length === 0) return mkConst(1, span);
    if (literals.length === 1) return literals[0] as Expr;
    return mkNary(form === "sop" ? "and" : "or", literals, span);
  });

  if (terms.length === 1) return terms[0] as Expr;
  return mkNary(form === "sop" ? "or" : "and", terms, span);
}

// ---------------------------------------------------------------------------
// Cube helpers
// ---------------------------------------------------------------------------

export const cubeKey = (c: Cube): string => `${c.care}:${c.bits & c.care}`;

/** Human-readable product term, e.g. `A'BD`. A cube with no care bits is `1`. */
export function cubeLabel(cube: Cube, variables: readonly string[]): string {
  const n = variables.length;
  let out = "";
  for (let i = 0; i < n; i++) {
    const mask = varMask(i, n);
    if ((cube.care & mask) === 0) continue;
    out += variables[i];
    if ((cube.bits & mask) === 0) out += "'";
  }
  return out === "" ? "1" : out;
}

/** The QM "binary pattern" view — `10-1` — which is what the tabular chart shows. */
export function cubePattern(cube: Cube, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    const mask = varMask(i, n);
    out += (cube.care & mask) === 0 ? "-" : (cube.bits & mask) !== 0 ? "1" : "0";
  }
  return out;
}

function labelCubes(
  cubes: readonly Cube[],
  variables: readonly string[],
): Map<string, string> {
  return new Map(cubes.map((c) => [cubeKey(c), cubeLabel(c, variables)]));
}

function dedupeCubes(cubes: readonly Cube[]): Cube[] {
  return [...new Map(cubes.map((c) => [cubeKey(c), c])).values()];
}

const countLiterals = (cover: readonly Cube[], n: number): number =>
  cover.reduce((sum, c) => sum + popcount(c.care), 0) * (n > 0 ? 1 : 0);

/** Gate-input cost: literals plus one input per term. Standard QM tie-break. */
const coverCost = (cover: readonly Cube[], n: number): number =>
  countLiterals(cover, n) + cover.length;

const isSuperset = <T>(a: readonly T[], b: readonly T[]): boolean =>
  b.every((x) => a.includes(x));

function mergeSorted(a: readonly number[], b: readonly number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

/** Index of the single set bit in `mask`, under THE MSB CONTRACT. */
function maskIndex(mask: number, n: number): number {
  for (let i = 0; i < n; i++) {
    if (varMask(i, n) === mask) return i;
  }
  return 0;
}

/** Does this cube cover minterm m? Used by the K-map to place loops. */
export const cubeCovers = (cube: Cube, m: number): boolean =>
  (m & cube.care) === (cube.bits & cube.care);

/** Reconstruct which variables a cube constrains, for the UI. */
export function cubeLiterals(
  cube: Cube,
  variables: readonly string[],
): { variable: string; negated: boolean }[] {
  const n = variables.length;
  const out: { variable: string; negated: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const mask = varMask(i, n);
    if ((cube.care & mask) === 0) continue;
    out.push({
      variable: variables[i] as string,
      negated: (cube.bits & mask) === 0,
    });
  }
  return out;
}

/** The variables a cube eliminated — what the UI shows next to each K-map loop. */
export function cubeEliminated(
  cube: Cube,
  variables: readonly string[],
): string[] {
  const n = variables.length;
  return variables.filter((_, i) => (cube.care & varMask(i, n)) === 0).map(
    (v) => v,
  );
}

export { bitOf };
