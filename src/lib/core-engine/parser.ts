import { lex, type Token, type TokenKind } from "./lexer";
import {
  mkConst,
  mkNary,
  mkNot,
  mkVar,
  spanning,
  type Expr,
  type NaryOp,
} from "./ast";
import { err, ok, type Diagnostic, type EngineResult, type Span } from "./types";

/**
 * Recursive-descent parser. No third-party expression libraries.
 *
 * Grammar (EBNF):
 *
 *   input    = [ header "=" ] or ;
 *   header   = var [ "(" var { "," var } ")" ] ;
 *   or       = xor { ( "+" | "NOR" ) xor } ;
 *   xor      = and { ( "^" | "XNOR" ) and } ;
 *   and      = unary { [ "*" | "NAND" ] unary } ;      (* juxtaposition = AND *)
 *   unary    = { "!" } postfix ;
 *   postfix  = primary { "'" } ;
 *   primary  = var | "0" | "1" | "(" or ")" ;
 *
 * Precedence, tightest first: NOT > AND > XOR > OR.
 *
 * The placement of XOR is the only debatable one, and it follows Verilog
 * (`~`, `&`, `^`, `|`) and the C-family. It also makes the common reading of
 * `AB ^ CD` come out as `(A·B) ^ (C·D)` rather than `A·(B^C)·D`, which is what
 * anyone writing that expression means.
 *
 * Within a level, the associative operator flattens into one n-ary node while
 * its non-associative sibling (NOR at the OR level, and so on) stays a
 * left-nested binary — see the comment in ast.ts for why that distinction is
 * load-bearing rather than cosmetic.
 */

export interface ParsedExpression {
  readonly ast: Expr;
  readonly name: string;
  /**
   * From an `F(A,B,C) = ...` header. Pins both arity and variable order, which
   * is worth having: neither is reliably inferable from the expression alone
   * (`F(A,B,C) = A + B` is a 3-variable function whose text mentions two).
   */
  readonly declaredVariables: readonly string[] | null;
}

/** Tokens that can begin a `unary` — i.e. that trigger an implicit AND. */
const STARTS_UNARY: ReadonlySet<TokenKind> = new Set<TokenKind>([
  "var",
  "const",
  "lparen",
  "not",
]);

class ParseError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

export function parse(source: string): EngineResult<ParsedExpression> {
  const { tokens, diagnostics } = lex(source);
  if (diagnostics.some((d) => d.severity === "error")) return err(diagnostics);

  if (source.trim() === "") {
    return err([
      {
        code: "empty-expression",
        message: "Enter a Boolean expression.",
        span: { start: 0, end: source.length },
        severity: "error",
      },
    ]);
  }

  try {
    return ok(new Parser(tokens).parseInput(), diagnostics);
  } catch (e) {
    if (e instanceof ParseError) return err([...diagnostics, e.diagnostic]);
    throw e;
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  // --- token helpers -------------------------------------------------------

  private peek(): Token {
    // The lexer always appends an EOF token, so this index is always in range.
    return this.tokens[this.pos] as Token;
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private advance(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.pos += 1;
    return t;
  }

  private fail(
    code: Diagnostic["code"],
    message: string,
    span: Span = this.peek().span,
  ): never {
    throw new ParseError({ code, message, span, severity: "error" });
  }

  // --- entry ---------------------------------------------------------------

  parseInput(): ParsedExpression {
    const header = this.tryParseHeader();
    const ast = this.parseOr();

    if (!this.at("eof")) {
      const t = this.peek();
      if (t.kind === "rparen") {
        this.fail("unbalanced-paren", 'Unmatched ")".');
      }
      this.fail("unexpected-token", `Unexpected "${t.text}".`);
    }

    return {
      ast,
      name: header?.name ?? "F",
      declaredVariables: header?.variables ?? null,
    };
  }

  /**
   * An `F =` or `F(A,B,C) =` prefix, if one is present. Detected by scanning
   * ahead for a top-level `=` rather than by speculative parsing, so that a
   * plain expression never pays for the lookahead.
   */
  private tryParseHeader(): { name: string; variables: string[] | null } | null {
    const eq = this.tokens.findIndex((t) => t.kind === "equals");
    if (eq === -1) return null;

    if (!this.at("var")) {
      this.fail(
        "unexpected-token",
        "A definition must start with a function name, e.g. F(A,B) = A + B.",
      );
    }
    const name = this.advance().text;

    let variables: string[] | null = null;
    if (this.at("lparen")) {
      this.advance();
      variables = [];
      for (;;) {
        if (!this.at("var")) {
          this.fail("unexpected-token", "Expected a variable name.");
        }
        variables.push(this.advance().text);
        if (this.at("comma")) {
          this.advance();
          continue;
        }
        break;
      }
      if (!this.at("rparen")) {
        this.fail("unbalanced-paren", 'Expected ")" after the variable list.');
      }
      this.advance();
    }

    if (!this.at("equals")) {
      this.fail("unexpected-token", 'Expected "=" after the function name.');
    }
    this.advance();
    return { name, variables };
  }

  // --- precedence levels ---------------------------------------------------

  private parseOr(): Expr {
    return this.parseBinaryLevel("or", "nor", () => this.parseXor());
  }

  private parseXor(): Expr {
    return this.parseBinaryLevel("xor", "xnor", () => this.parseAnd());
  }

  /**
   * One precedence level holding an associative operator and its
   * non-associative sibling. The associative one accumulates into a flat n-ary
   * node; hitting the non-associative one flushes that accumulation into a
   * single operand and starts a left-nested binary. Both are left-associative,
   * so `A + B NOR C` is `NOR(OR(A, B), C)`.
   */
  private parseBinaryLevel(
    assoc: NaryOp,
    nonAssoc: NaryOp,
    sub: () => Expr,
  ): Expr {
    let operands: Expr[] = [sub()];

    const flush = (): Expr => {
      const first = operands[0] as Expr;
      if (operands.length === 1) return first;
      const last = operands[operands.length - 1] as Expr;
      return mkNary(assoc, operands, spanning(first.span, last.span));
    };

    while (this.at(assoc) || this.at(nonAssoc)) {
      if (this.at(assoc)) {
        this.advance();
        operands.push(sub());
      } else {
        this.advance();
        const left = flush();
        const right = sub();
        operands = [mkNary(nonAssoc, [left, right], spanning(left.span, right.span))];
      }
    }

    return flush();
  }

  /**
   * AND level, plus implicit AND: two adjacent operands with no operator between
   * them (`AB`, `A(B+C)`, `A'B`) are a product. Detected by asking whether the
   * next token could *begin* an operand.
   */
  private parseAnd(): Expr {
    let operands: Expr[] = [this.parseUnary()];

    const flush = (): Expr => {
      const first = operands[0] as Expr;
      if (operands.length === 1) return first;
      const last = operands[operands.length - 1] as Expr;
      return mkNary("and", operands, spanning(first.span, last.span));
    };

    for (;;) {
      if (this.at("and")) {
        this.advance();
        operands.push(this.parseUnary());
      } else if (this.at("nand")) {
        this.advance();
        const left = flush();
        const right = this.parseUnary();
        operands = [mkNary("nand", [left, right], spanning(left.span, right.span))];
      } else if (STARTS_UNARY.has(this.peek().kind)) {
        operands.push(this.parseUnary()); // juxtaposition
      } else {
        break;
      }
    }

    return flush();
  }

  private parseUnary(): Expr {
    if (this.at("not")) {
      const t = this.advance();
      const operand = this.parseUnary();
      return mkNot(operand, spanning(t.span, operand.span));
    }
    return this.parsePostfix();
  }

  /** `A''` is legal and is a double negation; the minimizer folds it later. */
  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    while (this.at("postfix-not")) {
      const t = this.advance();
      e = mkNot(e, spanning(e.span, t.span));
    }
    return e;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    switch (t.kind) {
      case "var":
        this.advance();
        return mkVar(t.text, t.span);

      case "const":
        this.advance();
        return mkConst(t.text === "1" ? 1 : 0, t.span);

      case "lparen": {
        this.advance();
        const inner = this.parseOr();
        if (!this.at("rparen")) {
          this.fail("unbalanced-paren", 'Missing ")".');
        }
        const close = this.advance();
        return { ...inner, span: spanning(t.span, close.span) };
      }

      case "eof":
        this.fail("unexpected-end", "The expression ends with a missing operand.");
        break;

      default:
        this.fail(
          "missing-operand",
          `Expected a variable, constant, or "(" — found "${t.text}".`,
        );
    }
  }
}
