import { describe, expect, it } from "vitest";
import { layout } from "../layout";
import { renderSvg } from "../svg";
import { PRINT, SLATE, TEXTBOOK } from "../theme";
import { validate } from "../types";
import { PROBLEMS, defaults, getProblem, searchProblems } from "./index";

/**
 * The catalogue's load-bearing test.
 *
 * Every problem is solved at its defaults, every diagram it produces is checked
 * for dangling links, and every one is laid out and rendered. A builder that
 * names a port that does not exist draws a missing wire and says nothing, which
 * is the worst possible failure for a tool whose entire output is a picture — so
 * it is a test failure here instead.
 */
describe("problem catalogue", () => {
  it("has unique ids and a question number for every entry", () => {
    const ids = new Set(PROBLEMS.map((p) => p.id));
    expect(ids.size).toBe(PROBLEMS.length);
    for (const p of PROBLEMS) {
      expect(p.number).not.toBe("");
      expect(p.title.length).toBeGreaterThan(3);
      expect(p.prompt.length).toBeGreaterThan(20);
    }
  });

  /**
   * The completeness gate.
   *
   * The catalogue's claim is that it covers the whole assignment, and a catalogue
   * that quietly drops question 33 makes that claim false in the one way nobody
   * checks — you only find out when you turn to the page and it is not there.
   */
  it("covers every question number from 1 to 46", () => {
    const present = new Set(PROBLEMS.map((p) => Number.parseInt(p.number, 10)));
    const missing: number[] = [];
    for (let i = 1; i <= 46; i++) if (!present.has(i)) missing.push(i);
    expect(missing).toEqual([]);
    expect(PROBLEMS).toHaveLength(46);
  });

  it("is sorted by question number", () => {
    const numbers = PROBLEMS.map((p) => Number.parseInt(p.number, 10));
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThanOrEqual(numbers[i - 1] as number);
    }
  });

  for (const problem of PROBLEMS) {
    describe(`Q${problem.number} — ${problem.title}`, () => {
      const solution = problem.solve(defaults(problem));

      it("produces an explanation", () => {
        expect(solution.steps.length).toBeGreaterThan(0);
        for (const step of solution.steps) expect(step.trim().length).toBeGreaterThan(10);
      });

      it("produces diagrams whose links all resolve", () => {
        for (const d of solution.diagrams) {
          expect(validate(d)).toEqual([]);
          expect(d.blocks.length).toBeGreaterThan(0);
        }
      });

      it("lays out and renders in every theme", () => {
        for (const d of solution.diagrams) {
          for (const theme of [TEXTBOOK, SLATE, PRINT]) {
            const placed = layout(d, theme);
            expect(placed.width).toBeGreaterThan(0);
            expect(placed.height).toBeGreaterThan(0);
            const svg = renderSvg(placed, theme);
            expect(svg.startsWith("<svg")).toBe(true);
            expect(svg).not.toContain("undefined");
            expect(svg).not.toContain("NaN");
          }
        }
      });

      it("keeps every table rectangular", () => {
        for (const t of solution.tables ?? []) {
          for (const row of t.rows) expect(row.length).toBe(t.columns.length);
        }
      });
    });
  }
});

describe("search", () => {
  it("puts the exact question number first", () => {
    const hits = searchProblems("34");
    expect(hits[0]?.number).toBe("34");
  });

  it("matches tags and titles", () => {
    expect(searchProblems("demultiplexer").length).toBeGreaterThan(1);
    expect(searchProblems("").length).toBe(PROBLEMS.length);
  });

  it("finds a problem by id", () => {
    expect(getProblem("q12")?.number).toBe("12");
    expect(getProblem("nope")).toBeUndefined();
  });
});

/**
 * Every problem, at every setting of every parameter.
 *
 * The whole premise of this catalogue is that the questions are PARAMETERISED —
 * "1-to-16 from 2-to-4 decoders" is really "a demultiplexer tree", and the 16
 * and the 4 are arguments. A builder that only works at the sizes on the exam
 * paper would make that claim false, so it is checked: each parameter is moved
 * off its default in turn and the whole solution is re-derived and re-rendered.
 *
 * Parameters vary ONE AT A TIME rather than combinatorially. That keeps the
 * sweep linear, and the interesting failures — an off-by-one in a width, a tree
 * that only balances at a power of two — are all reachable one axis at a time.
 *
 * Integer parameters move by ±1 rather than to their extremes on purpose. The
 * memory questions accept millions of words, and a chip size at its minimum
 * against a target at its maximum is not a test, it is a hang.
 */
describe("every problem, off its defaults", () => {
  for (const problem of PROBLEMS) {
    for (const param of problem.params ?? []) {
      const alternatives: (number | string)[] =
        param.kind === "choice"
          ? (param.choices ?? []).map((c) => c.value).filter((c) => c !== param.initial)
          : param.kind === "int"
            ? [
                Math.max(param.min ?? 0, Number(param.initial) - 1),
                Math.min(param.max ?? Number.MAX_SAFE_INTEGER, Number(param.initial) + 1),
              ].filter((n) => n !== Number(param.initial))
            : [];

      for (const value of alternatives) {
        it(`Q${problem.number} with ${param.key} = ${value}`, () => {
          const solution = problem.solve({ ...defaults(problem), [param.key]: value });
          expect(solution.steps.length).toBeGreaterThan(0);
          for (const d of solution.diagrams) {
            expect(validate(d)).toEqual([]);
            const svg = renderSvg(layout(d, TEXTBOOK), TEXTBOOK);
            expect(svg).not.toContain("NaN");
            expect(svg).not.toContain("undefined");
          }
          for (const t of solution.tables ?? []) {
            for (const row of t.rows) expect(row.length).toBe(t.columns.length);
          }
        });
      }
    }
  }
});

describe("free-text parameters", () => {
  it("survives an unparsable expression rather than throwing", () => {
    const q43 = getProblem("q43");
    expect(q43).toBeDefined();
    const solution = (q43 as NonNullable<typeof q43>).solve({
      ...defaults(q43 as NonNullable<typeof q43>),
      expr: "((( not an expression",
    });
    expect(solution.diagrams.length).toBeGreaterThan(0);
  });

  it("accepts a lower-case expression, because the lexer upper-cases anyway", () => {
    const q43 = getProblem("q43") as NonNullable<ReturnType<typeof getProblem>>;
    const lower = q43.solve({ ...defaults(q43), expr: "x'y + x'z + xy'z'", vars: "x y z" });
    const upper = q43.solve(defaults(q43));
    expect(lower.expressions).toEqual(upper.expressions);
  });

  it("ignores a minterm the variable count cannot address", () => {
    const q18 = getProblem("q18") as NonNullable<ReturnType<typeof getProblem>>;
    const solution = q18.solve({ ...defaults(q18), vars: 2, f1: "0, 1, 99" });
    for (const d of solution.diagrams) expect(validate(d)).toEqual([]);
  });
});
