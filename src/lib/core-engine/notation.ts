import { err, ok, type Diagnostic, type EngineResult, type Span } from "./types";

/**
 * Minterm / maxterm notation:
 *
 *   Σm(0, 2, 5) + d(6, 7)
 *   F(A,B,C) = Σm(0,2,5)
 *   ΠM(1,3,4) · D(6)
 *   sum(0,2,5)
 *   m(0,2,5)
 *
 * Deliberately a small ad-hoc scanner rather than a reuse of the Boolean lexer:
 * the two languages disagree about what `+`, `m`, and `d` mean, and forcing them
 * through one tokenizer would make both worse.
 */

export interface ParsedNotation {
  readonly name: string;
  readonly form: "sum" | "product";
  /** Minterm indices for `sum`, maxterm indices for `product`. */
  readonly indices: readonly number[];
  readonly dontCares: readonly number[];
  /** From an `F(A,B,C) =` header. Null if the user did not say. */
  readonly declaredVariables: readonly string[] | null;
}

const SUM = /^[Σ∑]|^sum\b/i;
const PRODUCT = /^[Π∏]|^prod(uct)?\b/i;

/**
 * Does this input want the notation parser rather than the expression parser?
 *
 * The bare `m(...)` / `M(...)` forms have to be recognized by their *digits* —
 * `m` is a perfectly good variable name, so `m(A+B)` is an expression while
 * `m(0,2,5)` is notation. The digit is the whole distinction.
 */
export function looksLikeNotation(source: string): boolean {
  const s = source.trim();
  return (
    /[Σ∑Π∏]/.test(s) ||
    /(^|[\s=+·*])(sum|prod|product)\b/i.test(s) ||
    /(^|[\s=+·*])[mM]\s*\(\s*\d/.test(s)
  );
}

export function parseNotation(source: string): EngineResult<ParsedNotation> {
  const diagnostics: Diagnostic[] = [];
  let rest = source;
  let offset = 0;

  const fail = (
    code: Diagnostic["code"],
    message: string,
    span: Span,
  ): EngineResult<ParsedNotation> =>
    err([...diagnostics, { code, message, span, severity: "error" }]);

  const eat = (n: number): void => {
    rest = rest.slice(n);
    offset += n;
  };
  const skipSpace = (): void => {
    const m = /^\s*/.exec(rest);
    if (m) eat(m[0].length);
  };

  // --- optional `F(A,B,C) =` header ---------------------------------------
  let name = "F";
  let declaredVariables: string[] | null = null;

  const header = /^\s*([A-Za-z][0-9]*)\s*(\(([^)]*)\))?\s*=/.exec(source);
  if (header) {
    name = (header[1] as string).toUpperCase();
    const varList = header[3];
    if (varList !== undefined && varList.trim() !== "") {
      declaredVariables = varList
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter((v) => v !== "");
    }
    eat(header[0].length);
  }

  // --- Σ / Π --------------------------------------------------------------
  skipSpace();
  let form: "sum" | "product";
  const sum = SUM.exec(rest);
  const product = PRODUCT.exec(rest);

  if (sum) {
    form = "sum";
    eat(sum[0].length);
  } else if (product) {
    form = "product";
    eat(product[0].length);
  } else if (/^[mM]\s*\(/.test(rest)) {
    // Bare m(...) / M(...). The case IS the operator here.
    form = (rest[0] as string) === "m" ? "sum" : "product";
  } else {
    return fail(
      "unexpected-token",
      "Expected Σm(...) or ΠM(...).",
      { start: offset, end: source.length },
    );
  }

  // An `m` after Σ, or an `M` after Π, is decoration — the Σ/Π already said which.
  skipSpace();
  if (/^[mM](?=\s*\()/.test(rest)) eat(1);

  // --- index groups: the first is the term list, `d(...)` groups are don't-cares.
  const indices: number[] = [];
  const dontCares: number[] = [];
  let sawPrimary = false;

  for (;;) {
    skipSpace();
    if (rest === "") break;

    // Separators between groups: `+`, `,`, `·`, `*`, `∪`.
    const sep = /^[+,·*∪]/.exec(rest);
    if (sep) {
      eat(sep[0].length);
      skipSpace();
    }
    if (rest === "") break;

    // A don't-care group: d(...), D(...), Φ(...), φ(...), X(...).
    const dc = /^(d|D|Φ|φ|X|x)\s*\(/.exec(rest);
    const isDontCare = dc !== null;
    if (isDontCare) {
      eat((dc[0] as string).length - 1); // leave the "(" for the group reader
    }

    if (!rest.startsWith("(")) {
      return fail("unexpected-token", 'Expected "(" before an index list.', {
        start: offset,
        end: offset + 1,
      });
    }

    const close = rest.indexOf(")");
    if (close === -1) {
      return fail("unbalanced-paren", 'Missing ")" after the index list.', {
        start: offset,
        end: source.length,
      });
    }

    const body = rest.slice(1, close);
    const groupSpan: Span = { start: offset, end: offset + close + 1 };

    if (/[^\d\s,]/.test(body)) {
      return fail(
        "unexpected-token",
        "An index list may only contain numbers separated by commas.",
        groupSpan,
      );
    }

    const parsed = body
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "")
      .map(Number);

    (isDontCare ? dontCares : indices).push(...parsed);
    if (!isDontCare) sawPrimary = true;
    eat(close + 1);
  }

  if (!sawPrimary) {
    return fail("empty-expression", "No minterms or maxterms were given.", {
      start: 0,
      end: source.length,
    });
  }

  return ok(
    { name, form, indices, dontCares, declaredVariables },
    diagnostics,
  );
}
