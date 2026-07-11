import { describe, expect, it } from "vitest";
import { lex } from "./lexer";

const kinds = (src: string): string[] =>
  lex(src)
    .tokens.filter((t) => t.kind !== "eof")
    .map((t) => t.kind);

const texts = (src: string): string[] =>
  lex(src)
    .tokens.filter((t) => t.kind === "var")
    .map((t) => t.text);

describe("lex", () => {
  it("splits juxtaposed letters into separate variables", () => {
    expect(kinds("AB")).toEqual(["var", "var"]);
    expect(texts("ABC")).toEqual(["A", "B", "C"]);
  });

  it("keeps digits attached to the preceding letter as a subscript", () => {
    expect(texts("A1B2")).toEqual(["A1", "B2"]);
    expect(texts("X0")).toEqual(["X0"]);
  });

  it("normalizes variable case", () => {
    expect(texts("ab")).toEqual(["A", "B"]);
  });

  // Pitfall #1. `A AND B` lexed naively becomes A·N·D·B — a confidently wrong
  // answer with no error anywhere. This is the regression test for that.
  it("recognizes word operators instead of splitting them into variables", () => {
    expect(kinds("A AND B")).toEqual(["var", "and", "var"]);
    expect(kinds("A NAND B")).toEqual(["var", "nand", "var"]);
    expect(kinds("A or B")).toEqual(["var", "or", "var"]);
    expect(kinds("NOT A")).toEqual(["not", "var"]);
    expect(kinds("A XNOR B")).toEqual(["var", "xnor", "var"]);
  });

  it("still allows N and D as ordinary variables when they stand alone", () => {
    expect(texts("A N D B")).toEqual(["A", "N", "D", "B"]);
  });

  it("accepts every spelling of each operator", () => {
    expect(kinds("A+B")).toEqual(["var", "or", "var"]);
    expect(kinds("A|B")).toEqual(["var", "or", "var"]);
    expect(kinds("A*B")).toEqual(["var", "and", "var"]);
    expect(kinds("A.B")).toEqual(["var", "and", "var"]);
    expect(kinds("A·B")).toEqual(["var", "and", "var"]);
    expect(kinds("A&B")).toEqual(["var", "and", "var"]);
    expect(kinds("A^B")).toEqual(["var", "xor", "var"]);
    expect(kinds("A⊕B")).toEqual(["var", "xor", "var"]);
    expect(kinds("!A")).toEqual(["not", "var"]);
    expect(kinds("~A")).toEqual(["not", "var"]);
    expect(kinds("¬A")).toEqual(["not", "var"]);
    expect(kinds("A'")).toEqual(["var", "postfix-not"]);
  });

  it("accepts the curly apostrophe that phones and word processors produce", () => {
    expect(kinds("A’")).toEqual(["var", "postfix-not"]);
  });

  it("lexes 0 and 1 as constants but rejects other digits", () => {
    expect(kinds("0+1")).toEqual(["const", "or", "const"]);
    expect(lex("7").diagnostics[0]?.code).toBe("unexpected-character");
  });

  it("reports unknown characters with their exact span", () => {
    const { diagnostics } = lex("A $ B");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.span).toEqual({ start: 2, end: 3 });
  });

  it("gives each split identifier its own span", () => {
    const vars = lex("AB").tokens.filter((t) => t.kind === "var");
    expect(vars.map((t) => t.span)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ]);
  });
});
