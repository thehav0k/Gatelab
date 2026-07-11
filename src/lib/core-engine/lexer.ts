import type { Diagnostic, Span } from "./types";

export type TokenKind =
  | "var"
  | "const"
  | "not" // prefix: ! ~ ¬ NOT
  | "postfix-not" // A' , A′
  | "and" // * . · & ∧ AND
  | "or" // + | ∨ OR
  | "xor" // ^ ⊕ XOR
  | "nand" // NAND
  | "nor" // NOR
  | "xnor" // XNOR ⊙
  | "lparen"
  | "rparen"
  | "comma"
  | "equals"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly span: Span;
  /** Variable name (normalized upper-case), or "0"/"1" for a constant. */
  readonly text: string;
}

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Word operators. Recognized only as a *maximal* alphanumeric run, which is what
 * keeps `A AND B` from lexing as A·N·D·B — see the note on splitIdentifiers.
 */
const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  NOT: "not",
  AND: "and",
  OR: "or",
  XOR: "xor",
  NAND: "nand",
  NOR: "nor",
  XNOR: "xnor",
};

const SYMBOLS: Readonly<Record<string, TokenKind>> = {
  "(": "lparen",
  ")": "rparen",
  ",": "comma",
  "=": "equals",
  "+": "or",
  "|": "or",
  "∨": "or",
  "*": "and",
  ".": "and",
  "·": "and",
  "&": "and",
  "∧": "and",
  "^": "xor",
  "⊕": "xor",
  "⊙": "xnor",
  "!": "not",
  "~": "not",
  "¬": "not",
  "'": "postfix-not",
  "’": "postfix-not", // right single quote — what phones and word processors produce
  "′": "postfix-not", // prime
};

const isLetter = (c: string): boolean => /[A-Za-z]/.test(c);
const isDigit = (c: string): boolean => /[0-9]/.test(c);
const isAlnum = (c: string): boolean => /[A-Za-z0-9]/.test(c);
const isSpace = (c: string): boolean => /\s/.test(c);

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;

  const push = (kind: TokenKind, start: number, end: number, text = ""): void => {
    tokens.push({ kind, span: { start, end }, text });
  };

  while (i < source.length) {
    const c = source[i] as string;

    if (isSpace(c)) {
      i += 1;
      continue;
    }

    // A bare 0 or 1 is a constant. A digit attached to a letter (A1, B2) is part
    // of that identifier and is consumed by the alphanumeric run below.
    if (isDigit(c)) {
      if (c === "0" || c === "1") {
        push("const", i, i + 1, c);
        i += 1;
      } else {
        diagnostics.push({
          code: "unexpected-character",
          message: `"${c}" is not a valid Boolean constant. Use 0 or 1.`,
          span: { start: i, end: i + 1 },
          severity: "error",
        });
        i += 1;
      }
      continue;
    }

    if (isLetter(c)) {
      const start = i;
      while (i < source.length && isAlnum(source[i] as string)) i += 1;
      const word = source.slice(start, i);

      const keyword = KEYWORDS[word.toUpperCase()];
      if (keyword !== undefined) {
        push(keyword, start, i, word.toUpperCase());
      } else {
        for (const id of splitIdentifiers(word, start)) {
          push("var", id.span.start, id.span.end, id.name);
        }
      }
      continue;
    }

    const symbol = SYMBOLS[c];
    if (symbol !== undefined) {
      push(symbol, i, i + 1, c);
      i += 1;
      continue;
    }

    diagnostics.push({
      code: "unexpected-character",
      message: `Unexpected character "${c}".`,
      span: { start: i, end: i + 1 },
      severity: "error",
    });
    i += 1;
  }

  push("eof", source.length, source.length);
  return { tokens, diagnostics };
}

/**
 * Split a maximal alphanumeric run into single-letter-plus-digits identifiers.
 *
 *   "AB"    -> A, B          (juxtaposition is implicit AND)
 *   "A1B2"  -> A1, B2        (digits subscript the preceding letter)
 *   "ABC"   -> A, B, C
 *
 * Why identifiers are one letter and not arbitrary words: juxtaposition means
 * AND in Boolean algebra, so `AB` *must* be two variables. Multi-letter names
 * and implicit AND cannot coexist — you have to give up one, and every textbook
 * gives up multi-letter names.
 *
 * The catch this creates is pitfall #1: a run of "AND" would split to A·N·D, a
 * confidently wrong answer with no error. That is why the caller checks the
 * whole run against KEYWORDS *before* calling this — and why it checks the
 * maximal run rather than a prefix, so a variable named N followed by a variable
 * named D still works.
 */
function splitIdentifiers(
  word: string,
  offset: number,
): { name: string; span: Span }[] {
  const out: { name: string; span: Span }[] = [];
  let i = 0;
  while (i < word.length) {
    const start = i;
    i += 1; // the letter
    while (i < word.length && isDigit(word[i] as string)) i += 1;
    out.push({
      name: word.slice(start, i).toUpperCase(),
      span: { start: offset + start, end: offset + i },
    });
  }
  return out;
}
