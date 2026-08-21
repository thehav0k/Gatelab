import { CIRCUIT_PROBLEMS } from "./circuits";
import { WRITTEN_PROBLEMS } from "./written";
import type { Problem, ProblemCategory } from "./types";

export * from "./types";

/**
 * The whole assignment, in the order it was set.
 *
 * Sorted by the printed question number rather than by category, because that is
 * how a student holds the paper — "question 34" is the handle they have, and
 * making them hunt for it under "Memory" is a worse tool than a list.
 */
const numericPart = (n: string): number => Number.parseInt(n, 10) || 0;
const letterPart = (n: string): string => n.replace(/^\d+/, "");

export const PROBLEMS: readonly Problem[] = [
  ...CIRCUIT_PROBLEMS,
  ...WRITTEN_PROBLEMS,
].sort((a, b) => {
  const d = numericPart(a.number) - numericPart(b.number);
  return d !== 0 ? d : letterPart(a.number).localeCompare(letterPart(b.number));
});

export const getProblem = (id: string): Problem | undefined =>
  PROBLEMS.find((p) => p.id === id);

export const CATEGORY_LABELS: Readonly<Record<ProblemCategory, string>> = {
  circuit: "Circuit diagram",
  sequential: "Sequential",
  memory: "Memory",
  theory: "Theory",
  table: "Truth table",
};

export const CATEGORY_ORDER: readonly ProblemCategory[] = [
  "circuit",
  "sequential",
  "memory",
  "theory",
  "table",
];

/**
 * Substring search over number, title, prompt and tags.
 *
 * Deliberately not fuzzy. A student typing "34" means question 34, and a fuzzy
 * matcher that helpfully also returns 3 and 4 is worse than useless — so the
 * question number is matched exactly first, and everything else is a plain
 * case-insensitive `includes`.
 */
export function searchProblems(query: string): readonly Problem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return PROBLEMS;

  const exact = PROBLEMS.filter((p) => numericPart(p.number) === Number.parseInt(q, 10));
  const rest = PROBLEMS.filter(
    (p) =>
      !exact.includes(p) &&
      (p.number.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.prompt.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))),
  );
  return [...exact, ...rest];
}
