import { describe, expect, it } from "vitest";
import { layout } from "./layout";
import { renderSvg } from "./svg";
import { TEXTBOOK, PRINT, SLATE, withOverrides } from "./theme";
import { validate, type Diagram } from "./types";
import * as C from "./catalog";
import {
  gateLevelDiagram,
  decoderImplementation,
  muxImplementation,
  muxResidues,
  residueOf,
} from "./builders/logic";
import { mintermsWhere } from "./builders/kit";

const render = (d: Diagram) => renderSvg(layout(d, TEXTBOOK), TEXTBOOK);

describe("diagram model", () => {
  it("rejects a link naming a port that does not exist", () => {
    const bad: Diagram = {
      id: "bad",
      title: "bad",
      blocks: [C.input("A"), C.output("F")],
      links: [{ id: "x", from: { block: "A", port: "Y" }, to: { block: "F", port: "NOPE" } }],
    };
    expect(validate(bad)).toHaveLength(1);
  });

  it("accepts a well-formed diagram", () => {
    const good: Diagram = {
      id: "good",
      title: "good",
      blocks: [C.input("A"), C.output("F")],
      links: [{ id: "x", from: { block: "A", port: "Y" }, to: { block: "F", port: "A" } }],
    };
    expect(validate(good)).toHaveLength(0);
  });
});

describe("layout", () => {
  it("puts the source left of the sink", () => {
    const d = gateLevelDiagram(
      [{ name: "F", variables: ["A", "B"], minterms: [1, 2] }],
      { id: "t", title: "t" },
    );
    const placed = layout(d, TEXTBOOK);
    const a = placed.blocks.find((b) => b.block.id === "in_A");
    const f = placed.blocks.find((b) => b.block.id === "out_F");
    expect(a).toBeDefined();
    expect(f).toBeDefined();
    expect((a as NonNullable<typeof a>).x).toBeLessThan((f as NonNullable<typeof f>).x);
  });

  it("starts the drawing at the origin", () => {
    const d = decoderImplementation(
      [{ name: "F", variables: ["A", "B", "C"], minterms: [1, 3, 5] }],
      { id: "t", title: "t" },
    );
    const placed = layout(d, TEXTBOOK);
    const minX = Math.min(...placed.blocks.map((b) => b.x));
    const minY = Math.min(...placed.blocks.map((b) => b.y));
    expect(minX).toBeGreaterThanOrEqual(0);
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(placed.width).toBeGreaterThan(0);
    expect(placed.height).toBeGreaterThan(0);
  });

  it("routes every link as an orthogonal polyline", () => {
    const d = decoderImplementation(
      [{ name: "F", variables: ["A", "B", "C"], minterms: [1, 3, 5, 6] }],
      { id: "t", title: "t" },
    );
    for (const l of layout(d, TEXTBOOK).links) {
      expect(l.points.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < l.points.length; i++) {
        const a = l.points[i - 1] as { x: number; y: number };
        const b = l.points[i] as { x: number; y: number };
        const straight = Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6;
        expect(straight).toBe(true);
      }
    }
  });
});

describe("svg export", () => {
  const d = gateLevelDiagram(
    [{ name: "Y", variables: ["A", "B", "C"], minterms: [1, 2, 4, 7] }],
    { id: "t", title: "Full adder sum" },
  );

  it("is self-contained: no CSS variables, no classes, no external refs", () => {
    for (const theme of [TEXTBOOK, SLATE, PRINT]) {
      const svg = renderSvg(layout(d, theme), theme);
      expect(svg).not.toContain("var(--");
      expect(svg).not.toContain("class=");
      expect(svg).not.toContain("http://www.w3.org/1999/xlink");
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });

  it("escapes text that would otherwise break the markup", () => {
    const evil: Diagram = {
      id: "e",
      title: `A & B <script>"x"`,
      blocks: [C.input("A", `<b>&`)],
      links: [],
    };
    const svg = render(evil);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;");
  });

  it("honours the background override, including transparent", () => {
    const opaque = renderSvg(
      layout(d, TEXTBOOK),
      withOverrides(TEXTBOOK, { background: "#ff0000" }),
    );
    expect(opaque).toContain(`<rect x="0" y="0" width=`);
    expect(opaque).toContain(`fill="#ff0000"`);

    // "none" must emit NO backing rectangle at all — a transparent export is the
    // one that drops onto a dark slide without a white slab behind it.
    const clear = renderSvg(
      layout(d, TEXTBOOK),
      withOverrides(TEXTBOOK, { background: "none" }),
    );
    expect(clear).not.toContain(`<rect x="0" y="0" width=`);
  });

  it("recolours one block category without disturbing the others", () => {
    const t = withOverrides(TEXTBOOK, { tones: { msi: { fill: "#123456" } } });
    expect(t.tones.msi.fill).toBe("#123456");
    expect(t.tones.msi.stroke).toBe(TEXTBOOK.tones.msi.stroke);
    expect(t.tones.gate.fill).toBe(TEXTBOOK.tones.gate.fill);
  });
});

describe("shannon residues", () => {
  it("reads off 0, 1, D and D' for the classic n-1 select case", () => {
    // Prime numbers below 16 — the exam's favourite four-variable function.
    const prime = mintermsWhere(4, (v) => [2, 3, 5, 7, 11, 13].includes(v));
    const spec = { name: "f", variables: ["a", "b", "c", "d"], minterms: prime };
    const rows = muxResidues(spec, 3);
    // abc = 000 covers rows 0,1 (neither prime) -> 0; 001 covers 2,3 (both
    // prime) -> 1; 010 covers 4,5 -> only 5 is prime -> d; and so on.
    expect(rows.map((r) => describeResidue(r.residue))).toEqual([
      "0",
      "1",
      "d",
      "d",
      "0",
      "d",
      "d",
      "0",
    ]);
  });

  it("prefers a variable over a general expression when don't-cares allow it", () => {
    const r = residueOf([0, 1, 2, 1], ["c", "d"]);
    expect(r.kind).toBe("var");
  });
});

const describeResidue = (r: ReturnType<typeof residueOf>): string =>
  r.kind === "const" ? String(r.value) : r.kind === "var" ? `${r.name}${r.complemented ? "'" : ""}` : r.text;

describe("mux implementation", () => {
  it("wires every data input of the mux", () => {
    const d = muxImplementation(
      { name: "f", variables: ["a", "b", "c", "d"], minterms: [2, 3, 5, 7, 11, 13] },
      { id: "m", title: "8:1", selectBits: 3 },
    );
    expect(validate(d)).toEqual([]);
    for (let i = 0; i < 8; i++) {
      expect(d.links.some((l) => l.to.block === "MUX" && l.to.port === `D${i}`)).toBe(true);
    }
  });
});
