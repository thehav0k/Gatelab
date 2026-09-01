import type { PlacedBlock, PlacedDiagram, Point, RoutedLink } from "./layout";
import {
  gateBackX,
  placePorts,
  rotatePoint,
  type Box,
  type PlacedPort,
} from "./measure";
import { colorOfLink, wireColorOf } from "./svg";
import type { DiagramTheme } from "./theme";
import type { Block, Rotation } from "./types";

/**
 * The same drawing, as TikZ.
 *
 * WHY THIS EXISTS AND WHAT IT IS NOT. A report written in LaTeX does not want a
 * PNG of a circuit — the fonts are wrong, the line weights are wrong, and it
 * pixelates in print. It wants a figure made of the same ink as the rest of the
 * document. So this is a THIRD renderer of the one `PlacedDiagram`, alongside
 * the SVG writer, and it draws exactly what that one draws: same geometry, same
 * shapes, same colours.
 *
 * BLOCK CIRCUITS ONLY. Timing charts are deliberately not emitted. A waveform
 * strip is a different kind of figure with its own conventions, and a
 * half-translated one — the blocks in TikZ, the waveforms missing — is worse
 * than an honest omission, so the omission is stated in a comment in the file.
 *
 * TWO DECISIONS WORTH KNOWING ABOUT:
 *
 * `y=-1pt`. A `PlacedDiagram`'s y grows DOWNWARD, TikZ's grows up. Flipping the
 * basis vector rather than negating every number means the coordinates in the
 * .tex file are the same numbers as in the .svg — so a bug can be found by
 * diffing them, and there is no second chance to get a sign wrong.
 *
 * NO `transform shape`. Without it, TikZ transforms a node's POSITION but not
 * the node itself, so every label comes out upright and the right way round
 * inside a rotated block and inside the flipped axis, with nothing to
 * counter-rotate. It is the one place where LaTeX is less work than SVG.
 *
 * SELF-CONTAINED, for the same reason the SVG is: `\usepackage{tikz}` and
 * nothing else. No circuitikz, no arrow libraries, no fonts. A figure that only
 * compiles inside the preamble that generated it is not an export.
 */

export interface LatexOptions {
  /** A whole compilable file rather than a bare `tikzpicture`. Default true. */
  readonly standalone?: boolean;
  /** Uniform `\scalebox` around the picture. 1 means none. */
  readonly scale?: number;
  readonly title?: string;
  readonly caption?: string;
  /** Paint the theme's background behind the drawing. Default false. */
  readonly background?: boolean;
  readonly credit?: string;
}

/** Two decimals, and never `-0`. Same rule as the SVG writer, for diffability. */
const n = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * LaTeX-safe text.
 *
 * The ten special characters, and then the handful of non-ASCII glyphs these
 * diagrams actually produce. `Σm(1,2,4,7)` in a caption is not exotic here — it
 * is what half the labels say — and under pdfLaTeX an unmapped `Σ` is a missing
 * character warning and a hole in the page, which nobody reads the log to find.
 */
const SUBSTITUTIONS: readonly (readonly [RegExp, string])[] = [
  [/([&%$#_{}])/g, "\\$1"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"],
  [/[–—]/g, "--"],
  [/[‘’]/g, "'"],
  [/[“”]/g, "''"],
  [/×/g, "$\\times$"],
  [/·/g, "$\\cdot$"],
  [/≤/g, "$\\leq$"],
  [/≥/g, "$\\geq$"],
  [/≠/g, "$\\neq$"],
  [/⊕/g, "$\\oplus$"],
  [/⊙/g, "$\\odot$"],
  [/→/g, "$\\rightarrow$"],
  [/[Σ∑]/g, "$\\Sigma$"],
  [/Π/g, "$\\Pi$"],
  [/•/g, "$\\bullet$"],
  [/°/g, "$^\\circ$"],
];

/**
 * A backslash cannot simply be substituted first: its replacement contains
 * braces, and the brace rule that follows would escape them, yielding
 * `\textbackslash\{\}` — which typesets as the words rather than the symbol.
 * So it is parked on a character that cannot appear in a label and restored at
 * the end, after every other rule has run.
 */
const PARKED = "\u0000";

export function tex(text: string): string {
  let out = text.split("\\").join(PARKED);
  for (const [pattern, replacement] of SUBSTITUTIONS) out = out.replace(pattern, replacement);
  return out.split(PARKED).join("\\textbackslash{}");
}

// --- colours ----------------------------------------------------------------

/**
 * Colours are DECLARED, not written inline.
 *
 * `\definecolor` up front and a name at each use means a reader can retheme the
 * figure by editing eight lines at the top, which is the single most common
 * thing anybody wants to do to a generated figure — and it keeps the drawing
 * commands readable instead of a wall of hex.
 */
class Palette {
  private readonly names = new Map<string, string>();

  /** A name for this colour, minting one on first sight. */
  of(color: string): string {
    const hex = normalise(color);
    const existing = this.names.get(hex);
    if (existing) return existing;
    const name = `gl${this.names.size}`;
    this.names.set(hex, name);
    return name;
  }

  definitions(): string[] {
    return [...this.names].map(([hex, name]) => `\\definecolor{${name}}{HTML}{${hex}}`);
  }
}

/**
 * A CSS colour as six uppercase hex digits.
 *
 * `#abc` and `#aabbccdd` both reach here — the first from a hand-edited theme,
 * the second from a translucent grid colour — and xcolor's HTML model accepts
 * exactly six digits. Anything it cannot read becomes black, which is visible,
 * rather than a `\definecolor` that fails to compile.
 */
export function normalise(color: string): string {
  const raw = color.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return [...raw].map((c) => c + c).join("").toUpperCase();
  }
  if (/^[0-9a-fA-F]{6,8}$/.test(raw)) return raw.slice(0, 6).toUpperCase();
  return "000000";
}

// --- the renderer -----------------------------------------------------------

export function renderTikz(
  placed: PlacedDiagram,
  theme: DiagramTheme,
  opts: LatexOptions = {},
): string {
  const palette = new Palette();
  const body: string[] = [];

  const title = opts.title ?? (theme.showTitle ? placed.diagram.title : undefined);
  const caption = opts.caption ?? (theme.showCaption ? placed.diagram.caption : undefined);
  const notes = placed.diagram.notes ?? [];

  const titleH = title ? theme.titleSize * 1.6 + 10 : 0;

  if (opts.background === true && theme.background !== "none") {
    body.push(
      `\\fill[${palette.of(theme.background)}] (${n(-theme.padding)},${n(-theme.padding - titleH)}) rectangle (${n(placed.width + theme.padding)},${n(placed.height + theme.padding + noteHeight(notes, caption, theme))});`,
    );
  }

  if (title) {
    body.push(
      node(0, -titleH + theme.titleSize, "base west", text(title, theme.titleSize * 1.15, palette.of(theme.textColor), false, true)),
    );
  }

  for (const link of placed.links) body.push(...wire(link, theme, palette));
  // Placed junctions are components and are always drawn; derived ones are the
  // ones the theme switch is about. Same rule as the SVG, same dots.
  for (const j of placed.junctions) {
    if (!j.placed && !theme.showJunctions) continue;
    body.push(
      `\\fill[${palette.of(j.color ?? wireColorOf(j.colorIndex, theme))}] (${n(j.x)},${n(j.y)}) circle (${n(Math.max(2.4, theme.wireWidth * 1.8))}pt);`,
    );
  }
  for (const b of placed.blocks) body.push(...blockAt(b, theme, palette));

  let cursor = placed.height;
  for (const note of notes) {
    cursor += theme.subtitleSize * 1.6;
    body.push(
      node(0, cursor, "base west", text(`• ${note}`, theme.subtitleSize * 1.1, palette.of(theme.mutedTextColor), false)),
    );
  }
  if (caption) {
    cursor += theme.subtitleSize * 1.5 + 6;
    body.push(
      node(0, cursor, "base west", text(caption, theme.subtitleSize * 1.1, palette.of(theme.mutedTextColor), false)),
    );
  }

  const picture = [
    "\\begin{tikzpicture}[x=1pt,y=-1pt,line cap=round,line join=round]",
    ...palette.definitions().map((d) => `  ${d}`),
    ...body.map((line) => `  ${line}`),
    "\\end{tikzpicture}",
  ];

  const scale = opts.scale ?? 1;
  const scaled =
    scale === 1
      ? picture
      : [`\\scalebox{${n(scale)}}{%`, ...picture.map((l) => `  ${l}`), "}"];

  // Pure ASCII in the comments. TeX skips a comment's bytes without decoding
  // them, so a dash would be harmless here — but these lines get copied into
  // other people's files, and a stray byte in somebody else's encoding is a
  // problem that surfaces a long way from here.
  const header = [
    "% Generated by Gatelab.",
    "% Requires: \\usepackage{tikz} and nothing else - no circuitikz, no libraries.",
  ];
  if (placed.diagram.timing) {
    header.push(
      "% NOTE: this diagram also has a timing chart, which is not part of the LaTeX",
      "% export. Export it as SVG or PNG if you need the waveforms.",
    );
  }
  if (opts.credit) header.push(`% ${opts.credit}`);

  if (opts.standalone === false) return [...header, ...scaled].join("\n");

  return [
    ...header,
    "\\documentclass[tikz,border=6pt]{standalone}",
    "\\usepackage{tikz}",
    "\\begin{document}",
    ...scaled,
    "\\end{document}",
    "",
  ].join("\n");
}

const noteHeight = (
  notes: readonly string[],
  caption: string | undefined,
  theme: DiagramTheme,
): number =>
  notes.length * theme.subtitleSize * 1.6 + (caption ? theme.subtitleSize * 1.5 + 6 : 0);

// --- text -------------------------------------------------------------------

/**
 * A sized, coloured, escaped run of text.
 *
 * The size is set explicitly rather than left to `\small` and friends, because
 * those are relative to the surrounding document and a figure that changes size
 * depending on which section it lands in is not a figure.
 */
function text(
  content: string,
  size: number,
  color: string,
  mono: boolean,
  bold = false,
): string {
  const family = mono ? "\\ttfamily" : "\\sffamily";
  const weight = bold ? "\\bfseries" : "";
  // Family and weight BEFORE the size: both re-select the font, so setting the
  // size last is what makes the size the thing that survives.
  return `{${family}${weight}\\fontsize{${n(size)}}{${n(size * 1.2)}}\\selectfont\\color{${color}}${tex(content)}}`;
}

const node = (x: number, y: number, anchor: string, content: string): string =>
  `\\node[anchor=${anchor},inner sep=0pt] at (${n(x)},${n(y)}) {${content}};`;

// --- wires ------------------------------------------------------------------

function wire(l: RoutedLink, theme: DiagramTheme, palette: Palette): string[] {
  const bus = l.width > 1;
  const color = colorOfLink(l, theme);
  const width = bus ? theme.busWidth : theme.wireWidth;

  const options = [
    palette.of(color),
    `line width=${n(width)}pt`,
    theme.cornerRadius > 0 ? `rounded corners=${n(theme.cornerRadius)}pt` : "",
    l.link.style === "dashed" ? "dashed" : "",
    theme.showArrows ? "->" : "",
  ].filter(Boolean);

  const path = tidy(l.points).map((p) => `(${n(p.x)},${n(p.y)})`).join(" -- ");
  const out = [`\\draw[${options.join(",")}] ${path};`];

  if (bus) out.push(...busTick(l.points, l.width, color, theme, palette));
  if (l.link.label) {
    const mid = l.points[Math.floor(l.points.length / 2)];
    if (mid) {
      out.push(
        node(mid.x, mid.y - 5, "south", text(l.link.label, theme.wireLabelSize, palette.of(theme.mutedTextColor), true)),
      );
    }
  }
  return out;
}

/**
 * Drop repeated and collinear points.
 *
 * `rounded corners` rounds every vertex, and a vertex between two points that
 * are the SAME point has no angle to round: TikZ divides by the segment length
 * and the compile fails with "Dimension too large", from a .tex file that looks
 * perfectly reasonable. The SVG writer never hit this because it checks the
 * radius against the segment before emitting an arc.
 */
function tidy(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  const result: Point[] = [];
  for (let i = 0; i < out.length; i++) {
    const prev = result[result.length - 1];
    const cur = out[i] as Point;
    const next = out[i + 1];
    if (prev && next) {
      const flatX = Math.abs(prev.x - cur.x) < 0.5 && Math.abs(cur.x - next.x) < 0.5;
      const flatY = Math.abs(prev.y - cur.y) < 0.5 && Math.abs(cur.y - next.y) < 0.5;
      if (flatX || flatY) continue;
    }
    result.push(cur);
  }
  return result.length >= 2 ? result : out;
}

/** The slash-and-number, on the longest segment — the same rule as the SVG. */
function busTick(
  points: readonly Point[],
  width: number,
  color: string,
  theme: DiagramTheme,
  palette: Palette,
): string[] {
  let a: Point | undefined;
  let b: Point | undefined;
  let best = -1;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1] as Point;
    const q = points[i] as Point;
    const len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    if (len > best) {
      best = len;
      a = p;
      b = q;
    }
  }
  if (!a || !b) return [];
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const s = 6;
  return [
    `\\draw[${palette.of(color)},line width=${n(theme.wireWidth)}pt] (${n(cx - s * 0.6)},${n(cy + s)}) -- (${n(cx + s * 0.6)},${n(cy - s)});`,
    node(cx + 4, cy - s - 2, "south west", text(String(width), theme.wireLabelSize, palette.of(theme.mutedTextColor), true)),
  ];
}

// --- blocks -----------------------------------------------------------------

/**
 * A point in a block's own upright frame, as a TikZ coordinate on the sheet.
 *
 * ROTATION IS APPLIED HERE, IN TYPESCRIPT — not with a `rotate=` scope.
 *
 * A scope would be shorter, and it is what the SVG writer does with its group
 * transform. But this picture's y basis vector is negative, and whether a TikZ
 * `rotate=90` then reads clockwise or anticlockwise on the page depends on
 * exactly where PGF applies coordinate transformations relative to the basis.
 * Getting it backwards produces a file that is silently wrong and only says so
 * when somebody runs pdflatex — which is the one check this module cannot make.
 * Doing the arithmetic here means the emitted coordinates are just numbers, and
 * numbers cannot be misread.
 *
 * It also gets the labels right for free: with nothing transformed, every
 * `\node` is upright on the page whatever the block is doing.
 */
type Pen = (x: number, y: number) => string;

function penFor(b: PlacedBlock, size: Box): Pen {
  const rotation: Rotation = b.rotation ?? 0;
  return (x, y) => {
    const p = rotatePoint({ x, y }, size, rotation);
    return `(${n(b.x + p.x)},${n(b.y + p.y)})`;
  };
}

function blockAt(b: PlacedBlock, theme: DiagramTheme, palette: Palette): string[] {
  const rotation: Rotation = b.rotation ?? 0;
  // b.w/b.h are the ROTATED extents, so undo the swap to get the block's own.
  const size =
    rotation === 90 || rotation === 270 ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
  const local = placePorts(b.block, size);
  const at = penFor(b, size);

  const inner =
    b.block.kind === "label"
      ? [
          `\\node[anchor=base west,inner sep=0pt] at ${at(0, size.h * 0.75)} {${text(b.block.title, theme.subtitleSize * 1.1, palette.of(theme.mutedTextColor), false)}};`,
        ]
      : b.block.kind === "node"
        ? [] // Its dot comes from the junction pass, with every other dot.
        : b.block.kind === "io"
          ? ioTag(b.block, size, at, theme, palette)
          : b.block.kind === "gate"
            ? gate(b.block, size, at, theme, palette)
            : box(b.block, size, at, theme, palette);

  return [
    ...inner,
    ...stubs(b.block, size, local, at, theme, palette),
    // Which side of its pin a label sits on is decided by the pin's direction
    // AFTER the turn, so these are placed from the ROTATED ports rather than
    // from the block's own frame.
    ...portLabels(b, theme, palette),
  ];
}

function portLabels(
  b: PlacedBlock,
  theme: DiagramTheme,
  palette: Palette,
): string[] {
  if (!theme.showPortLabels || b.block.kind !== "box") return [];
  const size = theme.portLabelSize;
  const inset = 6;
  const out: string[] = [];
  for (const p of b.ports.values()) {
    if (!p.port.label) continue;
    const label = text(p.port.label, size, palette.of(theme.mutedTextColor), true);
    if (p.out.x < 0) out.push(node(p.x + inset, p.y, "west", label));
    else if (p.out.x > 0) out.push(node(p.x - inset, p.y, "east", label));
    else if (p.out.y < 0) out.push(node(p.x, p.y + 2, "north", label));
    else out.push(node(p.x, p.y - 5, "south", label));
  }
  return out;
}

const fillDraw = (
  tone: { fill: string; stroke: string },
  theme: DiagramTheme,
  palette: Palette,
): string =>
  `fill=${palette.of(tone.fill)},draw=${palette.of(tone.stroke)},line width=${n(theme.blockStrokeWidth)}pt`;

function box(
  block: Block,
  size: Box,
  at: Pen,
  theme: DiagramTheme,
  palette: Palette,
): string[] {
  const t = theme.tones[block.tone];
  const hasSub = Boolean(block.subtitle) && theme.showSubtitles;
  const titleY = hasSub ? size.h / 2 - theme.subtitleSize * 0.55 : size.h / 2;
  const corner = theme.blockRadius > 0 ? `,rounded corners=${n(theme.blockRadius)}pt` : "";

  // Title and subtitle are ONE node with two lines, not two nodes. Two nodes
  // are positioned separately, and on a turned block their two positions end
  // up side by side rather than stacked — "2-to-4" and "decoder" printed on top
  // of one another. `align=center` keeps the second line under the first, on
  // the page, whichever way the block is facing.
  const title = text(block.title, theme.titleSize, palette.of(t.text), false, true);
  const label = hasSub
    ? `${title}\\\\${text(block.subtitle as string, theme.subtitleSize, palette.of(theme.mutedTextColor), false)}`
    : title;

  return [
    `\\draw[${fillDraw(t, theme, palette)}${corner}] ${at(0, 0)} rectangle ${at(size.w, size.h)};`,
    `\\node[anchor=center,align=center,inner sep=0pt] at ${at(size.w / 2, titleY)} {${label}};`,
  ];
}

function ioTag(
  block: Block,
  size: Box,
  at: Pen,
  theme: DiagramTheme,
  palette: Palette,
): string[] {
  const t = theme.tones[block.tone];
  const { w, h } = size;
  const c = 8;
  const outward = block.ports.some((p) => p.dir === "out");
  const points: readonly (readonly [number, number])[] = outward
    ? [[0, 0], [w - c, 0], [w, h / 2], [w - c, h], [0, h]]
    : [[c, 0], [w, 0], [w, h], [c, h], [0, h / 2]];
  return [
    `\\draw[${fillDraw(t, theme, palette)}] ${points.map(([x, y]) => at(x, y)).join(" -- ")} -- cycle;`,
    `\\node[anchor=center,inner sep=0pt] at ${at(w / 2 - (outward ? c / 2 : -c / 2), h / 2)} {${text(block.title, theme.titleSize * 0.85, palette.of(t.text), true)}};`,
  ];
}

/**
 * The ANSI gate bodies, as Bézier curves.
 *
 * The control points are the same numbers the SVG writer uses — an OR gate's
 * back bows in by `0.26w`, its nose springs from `0.55w` — because they are the
 * same curve. TikZ's `.. controls ..` is a cubic and SVG's `Q` is a quadratic,
 * so each quadratic control point is converted the standard way (a third of the
 * way from each end towards it) rather than reused directly, which would draw a
 * visibly fatter gate.
 *
 * The AND gate's nose is a half circle written as two Bézier quarters rather
 * than with TikZ's `arc`. `arc` takes ANGLES, and in a picture with a negative
 * y basis vector the sign of an angle is exactly the kind of thing that is
 * silently wrong until somebody runs pdflatex. Béziers are plain coordinates.
 */
function gate(
  block: Block,
  size: Box,
  at: Pen,
  theme: DiagramTheme,
  palette: Palette,
): string[] {
  const t = theme.tones[block.tone];
  const op = block.op ?? "and";
  const inverted = op === "nand" || op === "nor" || op === "xnor" || op === "not";
  const shape =
    op === "and" || op === "nand"
      ? "and"
      : op === "or" || op === "nor" || op === "xor" || op === "xnor"
        ? "or"
        : "not";
  const W = size.w;
  const H = size.h;
  const bubbleR = 4;
  const style = fillDraw(t, theme, palette);
  const curve = (cx: number, cy: number, x: number, y: number, fromX: number, fromY: number) =>
    q(at, fromX, fromY, cx, cy, x, y);

  const out: string[] = [];
  if (shape === "and") {
    const r = H / 2;
    const cx = W * 0.42;
    const cy = H / 2;
    out.push(
      `\\draw[${style}] ${at(0, 0)} -- ${at(cx, 0)} ` +
        `${cubic(at, cx + KAPPA * r, 0, cx + r, cy - KAPPA * r, cx + r, cy)} ` +
        `${cubic(at, cx + r, cy + KAPPA * r, cx + KAPPA * r, H, cx, H)} ` +
        `-- ${at(0, H)} -- cycle;`,
    );
  } else if (shape === "or") {
    out.push(
      `\\draw[${style}] ${at(0, 0)} ${curve(W * 0.55, 2, W * 0.92, H / 2, 0, 0)} ` +
        `${curve(W * 0.55, H - 2, 0, H, W * 0.92, H / 2)} ` +
        `${curve(W * 0.26, H / 2, 0, 0, 0, H)} -- cycle;`,
    );
  } else {
    out.push(
      `\\draw[${style}] ${at(0, 0)} -- ${at(W * 0.7, H / 2)} -- ${at(0, H)} -- cycle;`,
    );
  }

  if (op === "xor" || op === "xnor") {
    out.push(
      `\\draw[draw=${palette.of(t.stroke)},line width=${n(theme.blockStrokeWidth)}pt] ${at(-6, 0)} ${curve(W * 0.2, H / 2, -6, H, -6, 0)};`,
    );
  }

  const tip = shape === "and" ? W * 0.42 + H / 2 : shape === "or" ? W * 0.92 : W * 0.7;
  if (inverted) {
    out.push(`\\draw[${style}] ${at(tip + bubbleR, H / 2)} circle (${n(bubbleR)}pt);`);
  }
  out.push(
    `\\draw[draw=${palette.of(t.stroke)},line width=${n(theme.blockStrokeWidth)}pt] ${at(inverted ? tip + bubbleR * 2 : tip, H / 2)} -- ${at(W, H / 2)};`,
  );
  if (block.title) {
    out.push(
      `\\node[anchor=base,inner sep=0pt] at ${at(W / 2, H + theme.subtitleSize + 2)} {${text(block.title, theme.subtitleSize, palette.of(theme.mutedTextColor), true)}};`,
    );
  }
  return out;
}

/**
 * The control-point ratio that turns a cubic Bézier into a quarter circle, to
 * within a quarter of a percent. Standard, and older than any of this.
 */
const KAPPA = 0.5522847498307936;

/** A cubic Bézier segment from the current point. */
const cubic = (
  at: Pen,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x: number,
  y: number,
): string => `.. controls ${at(c1x, c1y)} and ${at(c2x, c2y)} .. ${at(x, y)}`;

/** A quadratic Bézier, written as the cubic TikZ actually draws. */
const q = (
  at: Pen,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
): string =>
  cubic(
    at,
    x0 + (2 / 3) * (cx - x0),
    y0 + (2 / 3) * (cy - y0),
    x1 + (2 / 3) * (cx - x1),
    y1 + (2 / 3) * (cy - y1),
    x1,
    y1,
  );

function stubs(
  block: Block,
  size: Box,
  local: ReadonlyMap<string, PlacedPort>,
  at: Pen,
  theme: DiagramTheme,
  palette: Palette,
): string[] {
  const t = theme.tones[block.tone];
  const out: string[] = [];
  const bubbleR = 3.2;
  const stroke = `draw=${palette.of(t.stroke)},line width=${n(theme.wireWidth)}pt`;

  for (const p of local.values()) {
    const { x, y, ax, ay } = p;
    // A junction's pin has no stub: the wire meets the dot. Drawing the
    // zero-length line anyway paints a round cap on top of the dot.
    if (x === ax && y === ay) continue;
    const low = p.port.activeLow === true;
    let sx = low ? x + p.out.x * bubbleR * 2 : x;
    const sy = low ? y + p.out.y * bubbleR * 2 : y;
    // An OR gate's back is a curve; the wire has to reach the ink, not the box.
    if (block.kind === "gate" && p.port.side === "left" && !low) {
      sx = Math.max(sx, gateBackX(block.op ?? "and", size, y));
    }
    out.push(`\\draw[${stroke}] ${at(sx, sy)} -- ${at(ax, ay)};`);
    if (low) {
      out.push(
        `\\draw[${fillDraw(t, theme, palette)}] ${at(x + p.out.x * bubbleR, y + p.out.y * bubbleR)} circle (${n(bubbleR)}pt);`,
      );
    }
  }
  return out;
}
