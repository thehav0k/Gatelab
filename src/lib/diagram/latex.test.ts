import { describe, expect, it } from "vitest";
import { layout } from "./layout";
import { normalise, renderTikz, tex } from "./latex";
import { PRINT, TEXTBOOK } from "./theme";
import type { Diagram } from "./types";
import * as C from "./catalog";
import { emptyDocument } from "./editor/document";
import { addFromPalette, connect, rotateInstances, setValues } from "./editor/ops";
import { placeDocument } from "./editor/place";

const simple: Diagram = {
  id: "simple",
  title: "Σm(1,2,4) — a 2×2 example",
  caption: "A caption with 100% specials & {braces}.",
  notes: ["A note with an under_score."],
  blocks: [
    C.input("A", "A"),
    C.gate("G", "or", 3, "U1"),
    C.decoder("D", 2, { enable: true, enableActiveLow: true }),
    C.output("F", "F"),
    C.note("N", "annotation"),
  ],
  links: [
    { id: "1", from: { block: "A", port: "Y" }, to: { block: "G", port: "A" } },
    { id: "2", from: { block: "G", port: "Y" }, to: { block: "D", port: "A0" } },
    { id: "3", from: { block: "D", port: "Y0" }, to: { block: "F", port: "A" }, width: 4, label: "bus" },
  ],
};

const drawn = () => renderTikz(layout(simple, TEXTBOOK), TEXTBOOK);

describe("LaTeX escaping", () => {
  it("escapes every character TeX would eat", () => {
    expect(tex("100% & $x$ _a_ #1 {b} ~ ^")).toBe(
      "100\\% \\& \\$x\\$ \\_a\\_ \\#1 \\{b\\} \\textasciitilde{} \\textasciicircum{}",
    );
  });

  it("turns a backslash into a command rather than a new escape", () => {
    // The order matters: escaping backslashes AFTER the others would re-escape
    // the backslashes those substitutions had just introduced.
    expect(tex("a\\b")).toBe("a\\textbackslash{}b");
  });

  it("maps the non-ASCII glyphs these diagrams actually produce", () => {
    expect(tex("Σm(0) × 2 ≤ 3 – 1")).toBe("$\\Sigma$m(0) $\\times$ 2 $\\leq$ 3 -- 1");
  });
});

describe("colour normalisation", () => {
  it("expands shorthand and uppercases", () => {
    expect(normalise("#abc")).toBe("AABBCC");
  });

  it("drops an alpha channel, which xcolor's HTML model cannot take", () => {
    expect(normalise("#11223344")).toBe("112233");
  });

  it("falls back to black rather than emitting a colour that will not compile", () => {
    expect(normalise("rebeccapurple")).toBe("000000");
  });
});

describe("renderTikz", () => {
  it("produces a compilable-looking standalone document", () => {
    const out = drawn();
    expect(out).toContain("\\documentclass[tikz,border=6pt]{standalone}");
    expect(out).toContain("\\begin{document}");
    expect(out).toContain("\\end{document}");
    expect(count(out, "\\begin{tikzpicture}")).toBe(1);
    expect(count(out, "\\begin{tikzpicture}")).toBe(count(out, "\\end{tikzpicture}"));
  });

  it("emits a figure with no preamble when asked for one", () => {
    const out = renderTikz(layout(simple, TEXTBOOK), TEXTBOOK, { standalone: false });
    expect(out).not.toContain("\\documentclass");
    expect(out).not.toContain("\\begin{document}");
    expect(out).toContain("\\begin{tikzpicture}");
  });

  it("names every colour before it is used", () => {
    const out = drawn();
    for (const use of out.matchAll(/(?:fill|draw|color)=(gl\d+)/g)) {
      const name = use[1] as string;
      const defined = out.indexOf(`\\definecolor{${name}}`);
      expect(defined, `${name} is used but never defined`).toBeGreaterThan(-1);
      expect(defined).toBeLessThan(use.index);
    }
  });

  it("declares nothing but tikz", () => {
    const out = drawn();
    expect(out).toContain("\\usepackage{tikz}");
    expect(out).not.toContain("\\usepackage{circuitikz}");
    expect(out).not.toContain("\\usetikzlibrary");
    // The SVG's own rule, restated: nothing may depend on the page it came from.
    expect(out).not.toContain("var(--");
  });

  it("escapes the title, the caption and the notes", () => {
    const out = drawn();
    expect(out).toContain("100\\%");
    expect(out).toContain("under\\_score");
    expect(out).toContain("$\\Sigma$m(1,2,4)");
  });

  it("transforms nothing, so no TikZ convention can be misread", () => {
    // Rotation, shifting and scaling are all done in TypeScript and emitted as
    // plain numbers. The alternative is a `rotate=` scope whose handedness
    // depends on where PGF applies the transformation relative to this
    // picture's negative y basis — a question that only pdflatex can settle,
    // and this module cannot run pdflatex.
    const out = drawn();
    expect(out).not.toContain("\\begin{scope}");
    expect(out).not.toContain("rotate=");
    expect(out).not.toContain("shift=");
    // Every block still gets drawn.
    for (const title of ["U1", "2-to-4", "annotation"]) expect(out).toContain(title);
  });

  it("draws a bus with its width printed", () => {
    const out = drawn();
    expect(out).toMatch(new RegExp(`line width=${TEXTBOOK.busWidth}pt`));
    expect(out).toContain("bus");
  });

  it("has no repeated point, which is what breaks rounded corners", () => {
    const out = drawn();
    for (const path of out.matchAll(/\\draw\[[^\]]*\] ((?:\(-?[\d.]+,-?[\d.]+\) -- )+\(-?[\d.]+,-?[\d.]+\));/g)) {
      const points = (path[1] as string).split(" -- ");
      for (let i = 1; i < points.length; i++) {
        expect(points[i], "a zero-length segment").not.toBe(points[i - 1]);
      }
    }
  });

  it("turns the geometry itself rather than asking TikZ to", () => {
    let doc = emptyDocument("Turned");
    const d = addFromPalette(doc, "decoder", 40, 40);
    doc = rotateInstances(d!.doc, [d!.id], 90, TEXTBOOK);
    const placed = placeDocument(doc, TEXTBOOK, { tight: true });
    const out = renderTikz(placed, TEXTBOOK);
    expect(out).not.toContain("rotate");

    // A left-hand pin is now on the TOP edge, and its stub runs upward — which
    // is only visible in the coordinates, since nothing was transformed.
    const block = placed.blocks[0]!;
    const a0 = block.ports.get("A0")!;
    expect(a0.out).toEqual({ x: 0, y: -1 });
    expect(out).toContain(`(${round(a0.x)},${round(a0.y)}) -- (${round(a0.ax)},${round(a0.ay)})`);
  });

  it("says so when it has dropped a timing chart", () => {
    const timed: Diagram = {
      ...simple,
      timing: { title: "t", waves: [{ label: "Q0", values: [0, 1] }] },
    };
    expect(renderTikz(layout(timed, TEXTBOOK), TEXTBOOK)).toContain(
      "not part of the LaTeX",
    );
    expect(drawn()).not.toContain("not part of the LaTeX");
  });

  it("wraps in a scalebox only when a scale was asked for", () => {
    const placed = layout(simple, TEXTBOOK);
    expect(renderTikz(placed, TEXTBOOK, { scale: 1 })).not.toContain("\\scalebox");
    expect(renderTikz(placed, TEXTBOOK, { scale: 0.7 })).toContain("\\scalebox{0.7}");
  });

  it("paints a background only on request, and never a transparent one", () => {
    const placed = layout(simple, PRINT);
    expect(renderTikz(placed, PRINT, { background: true })).toContain("rectangle");
    const clear = { ...PRINT, background: "none" };
    const out = renderTikz(placed, clear, { background: true });
    expect(out.startsWith("% Generated")).toBe(true);
    expect(out).not.toMatch(/\\fill\[gl\d+\] \([^)]*\) rectangle/);
  });

  it("draws a junction as a dot and no wire through it", () => {
    let doc = emptyDocument("Junction");
    const i = addFromPalette(doc, "input", 20, 40)!;
    doc = i.doc;
    const j = addFromPalette(doc, "node", 200, 40)!;
    doc = j.doc;
    const wired = connect(doc, { block: i.id, port: "Y" }, { block: j.id, port: "P" });
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;
    const out = renderTikz(placeDocument(wired.doc, TEXTBOOK, { tight: true }), TEXTBOOK);
    expect(out).toMatch(/\\fill\[gl\d+\] \([\d.]+,[\d.]+\) circle/);
  });

  it("reaches the curved back of an OR gate, not its bounding box", () => {
    const orGate = (op: "or" | "and") => {
      let doc = emptyDocument("Gate");
      const g = addFromPalette(doc, "gate", 40, 40)!;
      doc = setValues(g.doc, g.id, { op, inputs: 2 }).doc;
      const out = renderTikz(placeDocument(doc, TEXTBOOK, { tight: true }), TEXTBOOK);
      // Every horizontal two-point stub, by length.
      return [...out.matchAll(
        /\\draw\[draw=gl\d+,line width=[\d.]+pt\] \((-?[\d.]+),(-?[\d.]+)\) -- \((-?[\d.]+),\2\);/g,
      )].map((m) => Math.abs(Number(m[1]) - Number(m[3])));
    };

    // An AND gate's back is flat, so every stub is exactly the stub length. An
    // OR gate's is bowed, and its two input wires have to run FURTHER to reach
    // the ink — which is the whole bug: they used to stop at the bounding box
    // and hang in space.
    expect(orGate("and").filter((d) => d > 14.5)).toHaveLength(0);
    expect(orGate("or").filter((d) => d > 14.5)).toHaveLength(2);
  });
});

describe("renderTikz, the rest of the palette", () => {
  const variants: Diagram = {
    id: "variants",
    title: "Variants",
    blocks: [
      C.gate("N", "not", 1, "inv"),
      C.gate("X", "xor", 2),
      C.mux("M", 2, { enable: true, complementOutput: true }),
      C.constant("V", 1),
      C.junction("J"),
    ],
    links: [
      { id: "1", from: { block: "V", port: "Y" }, to: { block: "N", port: "A" } },
      { id: "2", from: { block: "N", port: "Y" }, to: { block: "J", port: "P" }, style: "dashed", label: "n" },
      { id: "3", from: { block: "J", port: "P" }, to: { block: "M", port: "D0" } },
      { id: "4", from: { block: "X", port: "Y" }, to: { block: "M", port: "D1" } },
    ],
  };

  it("draws a NOT as a triangle and an XOR with its second arc", () => {
    const out = renderTikz(layout(variants, TEXTBOOK), TEXTBOOK);
    // Three points and a close: the inverter body.
    expect(out).toMatch(
      /\(-?[\d.]+,-?[\d.]+\) -- \(-?[\d.]+,-?[\d.]+\) -- \(-?[\d.]+,-?[\d.]+\) -- cycle/,
    );
    // An OR body is three curves; the XOR's extra arc is a fourth.
    expect(count(out, ".. controls")).toBeGreaterThanOrEqual(4);
    expect(out).not.toContain("arc[");
  });

  it("puts a bubble on an active-low pin, on the border", () => {
    const out = renderTikz(layout(variants, TEXTBOOK), TEXTBOOK);
    expect(out).toMatch(/circle \(3\.2pt\)/);
  });

  it("labels a wire and dashes it when it was drawn that way", () => {
    const out = renderTikz(layout(variants, TEXTBOOK), TEXTBOOK);
    expect(out).toContain("dashed");
    expect(out).toContain("}n}};");
  });

  it("drops the arrowheads and the junction dots when the theme says to", () => {
    const plain = { ...TEXTBOOK, showArrows: false, showJunctions: false, cornerRadius: 0, blockRadius: 0 };
    const out = renderTikz(layout(variants, plain), plain);
    expect(out).not.toContain(",->]");
    expect(out).not.toContain("rounded corners");
  });

  it("honours a colour set on one wire, in the same hex the SVG uses", () => {
    const painted: Diagram = {
      ...variants,
      links: variants.links.map((l, i) => (i === 0 ? { ...l, color: "#FF0000" } : l)),
    };
    const out = renderTikz(layout(painted, TEXTBOOK), TEXTBOOK);
    expect(out).toMatch(/\\definecolor\{gl\d+\}\{HTML\}\{FF0000\}/);
  });

  it("draws a junction dot where the wires actually meet", () => {
    const fan: Diagram = {
      id: "fan",
      title: "fan",
      blocks: [
        C.input("S", "S"),
        C.gate("G", "and", 2),
        C.gate("H", "and", 2),
      ],
      links: [
        { id: "1", from: { block: "S", port: "Y" }, to: { block: "G", port: "A" } },
        { id: "2", from: { block: "S", port: "Y" }, to: { block: "H", port: "A" } },
      ],
    };
    const placed = layout(fan, TEXTBOOK);
    expect(placed.junctions).toHaveLength(1);
    const out = renderTikz(placed, TEXTBOOK);
    const dot = placed.junctions[0]!;
    expect(out).toContain(`(${dot.x},${dot.y}) circle`);
  });

  it("uses the bus colour on a monochrome theme and a signal colour otherwise", () => {
    const mono = { ...TEXTBOOK, wireColoring: "mono" as const };
    const bussed: Diagram = {
      ...variants,
      links: [{ ...variants.links[0]!, width: 4 }],
    };
    expect(renderTikz(layout(bussed, mono), mono)).toContain("\\definecolor");
    const rainbow = { ...TEXTBOOK, wireColoring: "source" as const };
    expect(renderTikz(layout(bussed, rainbow), rainbow)).toContain("\\draw[");
  });

  it("hides the pin labels when the theme hides them", () => {
    const bare = { ...TEXTBOOK, showPortLabels: false, showSubtitles: false, showTitle: false, showCaption: false };
    const out = renderTikz(layout(variants, bare), bare);
    expect(out).not.toContain("anchor=east");
    expect(out).not.toContain("Variants");
  });
});

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const round = (v: number): string => String(Math.round(v * 100) / 100);
