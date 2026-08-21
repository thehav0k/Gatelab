import { describe, expect, it } from "vitest";
import { layout } from "./layout";
import { renderSvg } from "./svg";
import {
  BLUEPRINT,
  PRINT,
  SLATE,
  TEXTBOOK,
  THEMES,
  themeByName,
  withOverrides,
} from "./theme";
import type { Diagram } from "./types";
import * as C from "./catalog";
import { rippleCounterDiagram } from "./builders/sequential";

const bus: Diagram = {
  id: "bus",
  title: "Bus & labels",
  caption:
    "A caption long enough to need wrapping onto a second line, which is exactly what the greedy wrapper in svg.ts is for and which nothing else in the suite exercises.",
  notes: ["a note"],
  blocks: [
    C.input("SRC", "A7..A0"),
    C.memory("MEM", 256, 8, { bussed: true, chipSelectActiveLow: true }),
    C.output("D", "D7..D0"),
  ],
  links: [
    { id: "1", from: { block: "SRC", port: "Y" }, to: { block: "MEM", port: "A" }, width: 8, label: "addr" },
    { id: "2", from: { block: "MEM", port: "Q" }, to: { block: "D", port: "A" }, width: 8, style: "dashed" },
  ],
};

const draw = (d: Diagram, theme = TEXTBOOK) => renderSvg(layout(d, theme), theme);

describe("the SVG writer", () => {
  it("emits a bus tick, a wire label and a dashed stroke", () => {
    const svg = draw(bus);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain(">addr<");
    expect(svg).toContain(">8<");
  });

  it("wraps a long caption and prints the notes", () => {
    const svg = draw(bus);
    expect(svg).toContain("• a note");
    expect(svg.match(/wrapper|greedy/g)?.length).toBeGreaterThan(0);
  });

  it("draws a dotted grid, a lined grid, or neither", () => {
    const dots = renderSvg(layout(bus, TEXTBOOK), withOverrides(TEXTBOOK, { grid: "dots" }));
    const lines = renderSvg(layout(bus, TEXTBOOK), withOverrides(TEXTBOOK, { grid: "lines" }));
    const none = draw(bus);
    expect(dots).toContain("stroke-linecap=\"round\"");
    expect(lines.split("M").length).toBeGreaterThan(none.split("M").length);
  });

  it("can turn off arrows, junction dots, port labels and subtitles", () => {
    const bare = withOverrides(TEXTBOOK, {
      showArrows: false,
      showJunctions: false,
      showPortLabels: false,
      showSubtitles: false,
      showTitle: false,
      showCaption: false,
      cornerRadius: 0,
    });
    const svg = renderSvg(layout(bus, bare), bare);
    expect(svg).not.toContain("RAM");
    expect(svg).not.toContain("Bus & labels");
    expect(svg).not.toContain("Q");
  });

  it("adds width and height attributes when a raster scale is asked for", () => {
    const svg = renderSvg(layout(bus, TEXTBOOK), TEXTBOOK, { scale: 2, credit: "Gatelab" });
    expect(svg).toMatch(/ width="\d/);
    expect(svg).toContain("Gatelab");
  });

  it("draws a drop shadow only when the theme asks for one", () => {
    const shadow = withOverrides(TEXTBOOK, { blockShadow: true });
    expect(renderSvg(layout(bus, shadow), shadow)).toContain("feDropShadow");
    expect(draw(bus)).not.toContain("feDropShadow");
  });

  it("draws a frame in the themes that use one", () => {
    expect(draw(bus, PRINT)).toContain(`stroke="${PRINT.frameColor}"`);
    expect(draw(bus, BLUEPRINT)).toContain("M");
  });

  it("renders a timing chart with markers and a caption", () => {
    const d = rippleCounterDiagram({ bits: 3 });
    const svg = draw(d);
    expect(svg).toContain("timing");
    expect(svg).toContain("rolls over");
    expect(svg).toContain(">CLK<");
    expect(svg).not.toContain("NaN");
  });

  it("colours every branch of one fan-out identically", () => {
    const theme = withOverrides(SLATE, { wireColoring: "source" });
    const fan: Diagram = {
      id: "f",
      title: "f",
      blocks: [C.input("S"), C.output("A"), C.output("B")],
      links: [
        { id: "1", from: { block: "S", port: "Y" }, to: { block: "A", port: "A" } },
        { id: "2", from: { block: "S", port: "Y" }, to: { block: "B", port: "A" } },
      ],
    };
    const svg = renderSvg(layout(fan, theme), theme);
    const strokes = [...svg.matchAll(/<path d="M[^"]*" fill="none" stroke="(#[0-9a-f]{6})"/g)].map(
      (m) => m[1],
    );
    expect(new Set(strokes).size).toBe(1);
  });

  it("renders an empty diagram without throwing", () => {
    const empty: Diagram = { id: "e", title: "Nothing", blocks: [], links: [] };
    expect(draw(empty)).toContain("<svg");
  });
});

describe("themes", () => {
  it("looks every preset up by name and falls back to the default", () => {
    for (const t of THEMES) expect(themeByName(t.name)).toBe(t);
    expect(themeByName("no such theme")).toBe(TEXTBOOK);
  });

  it("merges a tone patch one level deep", () => {
    const t = withOverrides(SLATE, {
      wireWidth: 3,
      tones: { msi: { fill: "#000000" } },
    });
    expect(t.wireWidth).toBe(3);
    expect(t.tones.msi.fill).toBe("#000000");
    expect(t.tones.msi.stroke).toBe(SLATE.tones.msi.stroke);
    expect(t.tones.gate).toEqual(SLATE.tones.gate);
  });

  it("returns the base untouched when there is nothing to patch", () => {
    expect(withOverrides(PRINT, {})).toEqual(PRINT);
  });

  it("uses only hex colours, because an exported file has no stylesheet", () => {
    for (const theme of THEMES) {
      const values = [
        theme.background,
        theme.wireColor,
        theme.busColor,
        theme.textColor,
        theme.gridColor,
        ...theme.palette,
        ...Object.values(theme.tones).flatMap((t) => [t.fill, t.stroke, t.text]),
      ];
      for (const v of values) {
        expect(v, `${theme.name}: ${v}`).toMatch(/^(#[0-9a-f]{6}([0-9a-f]{2})?|none)$/i);
      }
    }
  });
});
