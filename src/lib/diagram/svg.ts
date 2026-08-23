import type { PlacedBlock, PlacedDiagram, Point, RoutedLink } from "./layout";
import {
  gateBackX,
  NODE_SIZE,
  placePorts,
  rotationOffset,
  textWidth,
  type Box,
  type PlacedPort,
} from "./measure";
import type { DiagramTheme } from "./theme";
import type { Block, Rotation, TimingChart } from "./types";

/**
 * The one renderer.
 *
 * WHY A STRING AND NOT REACT
 * --------------------------
 * The obvious build is a React `<svg>` for the screen plus a serializer for the
 * export. That is two renderers, and two renderers drift: the exported file
 * grows a stroke width the on-screen figure does not have, and nobody notices
 * until it is in a submitted report. So there is exactly one, it emits a string,
 * and the viewer injects that same string into the page. What you export is
 * literally the bytes you were looking at.
 *
 * It also has to be a string because it must run in `src/lib` — pure, no DOM
 * (Invariant 3) — which means it is testable in Node, and the tests can assert
 * things like "the exported SVG contains no `var(--` " that a React tree makes
 * awkward to check.
 *
 * SELF-CONTAINED IS A REQUIREMENT, NOT A NICETY. No CSS classes, no custom
 * properties, no external fonts: every colour is an inline hex attribute. An SVG
 * that only renders correctly inside this app is not an export.
 */

export interface RenderOptions {
  /** Draw the diagram's title above the drawing. */
  readonly title?: string;
  readonly caption?: string;
  /** Adds `width`/`height` attributes at a scale factor — needed for PNG raster. */
  readonly scale?: number;
  /** A small credit line in the corner. */
  readonly credit?: string;
  /**
   * `"figure"` (the default) frames the drawing: margin, title, caption, notes.
   *
   * `"canvas"` draws it RAW — no margin, no chrome, and the SVG's user units are
   * the placement's own coordinates. That is what the editor needs, because its
   * hit-testing works in document coordinates and any offset between the two
   * would mean clicking a pin an inch away from where it looks. Not a different
   * renderer: the same block and wire code, differently framed.
   */
  readonly frame?: "figure" | "canvas";
}

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Two decimals. Keeps the file small and, more importantly, byte-reproducible. */
const n = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

export function renderSvg(
  placed: PlacedDiagram,
  theme: DiagramTheme,
  opts: RenderOptions = {},
): string {
  const canvas = opts.frame === "canvas";
  const pad = canvas ? 0 : theme.padding;
  const title = canvas ? undefined : (opts.title ?? (theme.showTitle ? placed.diagram.title : undefined));
  const caption = canvas
    ? undefined
    : (opts.caption ?? (theme.showCaption ? placed.diagram.caption : undefined));

  const titleH = title ? theme.titleSize * 1.6 + 10 : 0;
  const timing = canvas ? undefined : placed.diagram.timing;
  const timingH = timing ? timingHeight(timing, theme) : 0;
  // Notes and captions are wrapped to the DRAWING's width, not left to run off
  // the side of it. An SVG has no overflow to scroll and no reflow — a line that
  // exceeds the viewBox is simply cut off, silently, in the exported file.
  const contentW = Math.max(placed.width, timing ? timingWidth(timing) : 0);
  const captionLines = caption ? wrap(caption, contentW, theme) : [];
  const captionH = captionLines.length * (theme.subtitleSize * 1.5) + (caption ? 10 : 0);
  const noteLines = (canvas ? [] : (placed.diagram.notes ?? [])).flatMap((note, i) =>
    wrap(note, contentW, theme).map((line, k) => ({
      text: k === 0 ? `• ${line}` : `   ${line}`,
      first: k === 0,
      index: i,
    })),
  );
  const notesH = noteLines.length * (theme.subtitleSize * 1.6) + (noteLines.length ? 8 : 0);

  const width = contentW + pad * 2;
  const height = titleH + placed.height + timingH + captionH + notesH + pad * 2;

  const body: string[] = [];

  // --- background -----------------------------------------------------------
  //
  // In CANVAS framing the host paints the background and the grid instead. The
  // sheet is only as big as its contents, so painting it here would put a small
  // white page in the middle of the editor with the workspace showing around it
  // — and worse, panning would move the "paper" out from under the blocks. The
  // host has a viewport; this function does not.
  if (!canvas && theme.background !== "none") {
    body.push(
      `<rect x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${esc(theme.background)}"/>`,
    );
  }
  if (!canvas && theme.grid !== "none") body.push(grid(width, height, theme));
  if (theme.showFrame) {
    body.push(
      `<rect x="4" y="4" width="${n(width - 8)}" height="${n(height - 8)}" fill="none" stroke="${esc(theme.frameColor)}" stroke-width="1"/>`,
    );
  }

  let cursor = pad;
  if (title) {
    body.push(
      `<text x="${n(pad)}" y="${n(cursor + theme.titleSize)}" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.titleSize * 1.15)}" font-weight="600" fill="${esc(theme.textColor)}">${esc(title)}</text>`,
    );
    cursor += titleH;
  }

  // --- the drawing ----------------------------------------------------------
  body.push(`<g transform="translate(${n(pad)} ${n(cursor)})">`);
  for (const l of placed.links) body.push(wire(l, theme));
  if (theme.showJunctions) {
    for (const j of placed.junctions) {
      body.push(
        `<circle cx="${n(j.x)}" cy="${n(j.y)}" r="${n(theme.wireWidth * 1.8)}" fill="${esc(wireColorOf(null, theme))}"/>`,
      );
    }
  }
  for (const b of placed.blocks) body.push(renderBlock(b, theme));
  body.push(`</g>`);
  cursor += placed.height;

  // --- timing strip ---------------------------------------------------------
  if (timing) {
    body.push(
      `<g transform="translate(${n(pad)} ${n(cursor + 8)})">${renderTiming(timing, theme)}</g>`,
    );
    cursor += timingH;
  }

  // --- notes and caption ----------------------------------------------------
  for (const line of noteLines) {
    cursor += theme.subtitleSize * 1.6;
    body.push(
      `<text x="${n(pad)}" y="${n(cursor)}" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.subtitleSize * 1.1)}" fill="${esc(theme.mutedTextColor)}" xml:space="preserve">${esc(line.text)}</text>`,
    );
  }
  if (captionLines.length > 0) cursor += 6;
  for (const line of captionLines) {
    cursor += theme.subtitleSize * 1.5;
    body.push(
      `<text x="${n(pad)}" y="${n(cursor)}" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.subtitleSize * 1.1)}" fill="${esc(theme.mutedTextColor)}">${esc(line)}</text>`,
    );
  }

  if (opts.credit) {
    body.push(
      `<text x="${n(width - pad)}" y="${n(height - 8)}" text-anchor="end" font-family="${esc(theme.fontFamily)}" font-size="9" fill="${esc(theme.mutedTextColor)}">${esc(opts.credit)}</text>`,
    );
  }

  const scale = opts.scale ?? 0;
  const dims =
    scale > 0 ? ` width="${n(width * scale)}" height="${n(height * scale)}"` : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}"${dims} role="img" aria-label="${esc(title ?? placed.diagram.title)}">`,
    defs(theme),
    ...body,
    `</svg>`,
  ].join("");
}

// --- defs -------------------------------------------------------------------

function defs(theme: DiagramTheme): string {
  const marks: string[] = [];
  if (theme.blockShadow) {
    marks.push(
      `<filter id="bshadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-opacity="0.18"/></filter>`,
    );
  }
  return marks.length ? `<defs>${marks.join("")}</defs>` : "";
}

function grid(w: number, h: number, theme: DiagramTheme): string {
  const s = theme.gridSize;
  const parts: string[] = [];
  if (theme.grid === "dots") {
    for (let x = s; x < w; x += s) {
      for (let y = s; y < h; y += s) {
        parts.push(`M${n(x)},${n(y)}h0.6`);
      }
    }
    return `<path d="${parts.join("")}" stroke="${esc(theme.gridColor)}" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  for (let x = s; x < w; x += s) parts.push(`M${n(x)},0V${n(h)}`);
  for (let y = s; y < h; y += s) parts.push(`M0,${n(y)}H${n(w)}`);
  return `<path d="${parts.join("")}" stroke="${esc(theme.gridColor)}" stroke-width="0.8" fill="none"/>`;
}

// --- wires ------------------------------------------------------------------

/**
 * Invariant 8, restated for a static drawing: a wire is coloured by the SIGNAL
 * it carries, never by anything else. Every branch of one fan-out is the same
 * colour, because they are the same net — which is the only reason the colouring
 * helps a reader trace a connection at all.
 */
export function wireColorOf(colorKey: string | null, theme: DiagramTheme): string {
  if (theme.wireColoring === "mono" || colorKey === null) return theme.wireColor;
  let hash = 0;
  for (let i = 0; i < colorKey.length; i++) {
    hash = (hash * 31 + colorKey.charCodeAt(i)) >>> 0;
  }
  const palette = theme.palette.length > 0 ? theme.palette : [theme.wireColor];
  return palette[hash % palette.length] as string;
}

function wire(l: RoutedLink, theme: DiagramTheme): string {
  const bus = l.width > 1;
  const color = bus && theme.wireColoring === "mono"
    ? theme.busColor
    : wireColorOf(l.colorKey, theme);
  const stroke = bus ? theme.busWidth : theme.wireWidth;
  const d = roundedPath(l.points, theme.cornerRadius);

  const parts = [
    `<path d="${d}" fill="none" stroke="${esc(color)}" stroke-width="${n(stroke)}" stroke-linejoin="round" stroke-linecap="round"${
      l.link.style === "dashed" ? ` stroke-dasharray="6 4"` : ""
    }/>`,
  ];

  if (theme.showArrows) parts.push(arrowHead(l.points, color, theme));
  if (bus) parts.push(busTick(l.points, l.width, color, theme));
  if (l.link.label) parts.push(wireLabel(l, theme));
  return parts.join("");
}

/** Quadratic corners. A radius bigger than half a segment would overshoot it. */
function roundedPath(points: readonly Point[], radius: number): string {
  if (points.length === 0) return "";
  const first = points[0] as Point;
  if (points.length < 3 || radius <= 0) {
    return `M${points.map((p) => `${n(p.x)},${n(p.y)}`).join("L")}`;
  }

  const out: string[] = [`M${n(first.x)},${n(first.y)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1] as Point;
    const cur = points[i] as Point;
    const next = points[i + 1] as Point;
    const dIn = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const dOut = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, dIn / 2, dOut / 2);
    if (r < 0.6) {
      out.push(`L${n(cur.x)},${n(cur.y)}`);
      continue;
    }
    const a = { x: cur.x + ((prev.x - cur.x) / dIn) * r, y: cur.y + ((prev.y - cur.y) / dIn) * r };
    const b = { x: cur.x + ((next.x - cur.x) / dOut) * r, y: cur.y + ((next.y - cur.y) / dOut) * r };
    out.push(`L${n(a.x)},${n(a.y)}`);
    out.push(`Q${n(cur.x)},${n(cur.y)} ${n(b.x)},${n(b.y)}`);
  }
  const last = points[points.length - 1] as Point;
  out.push(`L${n(last.x)},${n(last.y)}`);
  return out.join("");
}

function arrowHead(points: readonly Point[], color: string, theme: DiagramTheme): string {
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  if (!end || !before) return "";
  const dx = end.x - before.x;
  const dy = end.y - before.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return "";
  const ux = dx / len;
  const uy = dy / len;
  const size = Math.max(4.5, theme.wireWidth * 3);
  const bx = end.x - ux * size;
  const by = end.y - uy * size;
  const px = -uy * size * 0.45;
  const py = ux * size * 0.45;
  return `<path d="M${n(end.x)},${n(end.y)}L${n(bx + px)},${n(by + py)}L${n(bx - px)},${n(by - py)}Z" fill="${esc(color)}"/>`;
}

/**
 * The slash-and-number that turns four wires into one line.
 *
 * This is not decoration — it is the notation that makes a memory-expansion or
 * an adder diagram readable at all. Sixteen parallel address lines drawn
 * individually is a picture of a haystack.
 */
function busTick(
  points: readonly Point[],
  width: number,
  color: string,
  theme: DiagramTheme,
): string {
  // On the LONGEST segment, at its midpoint.
  //
  // The obvious choice — a fixed fraction along the first segment — puts every
  // tick of a fan-out at almost the same place, because a fan-out's branches all
  // start from one short stub. An address bus feeding eight chips then renders as
  // "4 44 44 44 4" piled on top of itself. The longest segment is different for
  // every branch, so the ticks separate on their own.
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
  if (!a || !b) return "";
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const s = 6;
  return (
    `<path d="M${n(cx - s * 0.6)},${n(cy + s)}L${n(cx + s * 0.6)},${n(cy - s)}" stroke="${esc(color)}" stroke-width="${n(theme.wireWidth)}"/>` +
    `<text x="${n(cx + 4)}" y="${n(cy - s - 2)}" font-family="${esc(theme.monoFamily)}" font-size="${n(theme.wireLabelSize)}" fill="${esc(theme.mutedTextColor)}">${width}</text>`
  );
}

function wireLabel(l: RoutedLink, theme: DiagramTheme): string {
  const mid = l.points[Math.floor(l.points.length / 2)];
  if (!mid || !l.link.label) return "";
  return `<text x="${n(mid.x)}" y="${n(mid.y - 5)}" text-anchor="middle" font-family="${esc(theme.monoFamily)}" font-size="${n(theme.wireLabelSize)}" fill="${esc(theme.mutedTextColor)}">${esc(l.link.label)}</text>`;
}

// --- blocks -----------------------------------------------------------------

/**
 * A block, drawn in ITS OWN upright frame and then turned by the group
 * transform.
 *
 * The ports are re-derived here rather than read off the `PlacedBlock`, and
 * that is the point: `b.ports` are absolute and already rotated, and a body
 * path is not. Mixing the two draws an OR gate upright with its pins down the
 * side. `placePorts` is a pure function of the block and its size, so asking it
 * again costs nothing and cannot disagree with the placement.
 */
function renderBlock(b: PlacedBlock, theme: DiagramTheme): string {
  const rotation = b.rotation ?? 0;
  // b.w/b.h are the ROTATED extents, so undo the swap to get the block's own.
  const size =
    rotation === 90 || rotation === 270 ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
  const local = placePorts(b.block, size);
  const off = rotationOffset(size, rotation);

  const inner =
    b.block.kind === "label"
      ? `<text x="0" y="${n(size.h * 0.75)}" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.subtitleSize * 1.1)}" fill="${esc(theme.mutedTextColor)}">${esc(b.block.title)}</text>`
      : b.block.kind === "node"
        ? nodeBody(theme)
        : b.block.kind === "io"
          ? ioTag(b.block, size, local, theme)
          : b.block.kind === "gate"
            ? gateBody(b.block, size, local, theme)
            : boxBody(b.block, size, local, theme);

  const transform =
    rotation === 0
      ? `translate(${n(b.x)} ${n(b.y)})`
      : `translate(${n(b.x + off.x)} ${n(b.y + off.y)}) rotate(${rotation})`;
  // Pin labels are drawn OUTSIDE the rotated group, in the sheet's own frame.
  //
  // Not a tidiness preference: a label's placement depends on which EDGE its
  // pin is on, and after a turn that is a different edge. Drawn inside, a
  // 180-degree box put every left-hand label outside its own border, reading
  // outwards, because "6px to the right, anchored at the start" is a rule about
  // an upright box. Out here the rule is applied to the rotated pin direction,
  // which is the thing it was always really about.
  return `<g transform="${transform}">${upright(inner, rotation)}</g>${portLabels(b, theme)}`;
}

/**
 * Turn every label back the right way up inside a rotated block.
 *
 * A rotated symbol is what the reader wants; rotated TEXT is not — at 180° the
 * title is upside down, and at 90° a column of port labels has to be read with
 * your head on one side. Every `<text>` this module writes carries its own
 * `x`/`y`, so counter-rotating each one about its own anchor leaves it exactly
 * where the layout put it, only readable.
 *
 * The regex reads this file's OWN output, and only its own: the text content
 * has already been through `esc`, so it can contain no `<`, and the element is
 * always written on one line with `x` first and `y` second.
 */
const TEXT_ELEMENT =
  /<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>(?:[^<]|<tspan[^>]*>[^<]*<\/tspan>)*<\/text>/g;

function upright(body: string, rotation: Rotation): string {
  if (rotation === 0) return body;
  return body.replace(
    TEXT_ELEMENT,
    (element, x: string, y: string) =>
      `<g transform="rotate(${360 - rotation} ${x} ${y})">${element}</g>`,
  );
}

const toneOf = (block: Block, theme: DiagramTheme) => theme.tones[block.tone];

/**
 * A junction: a filled dot, and nothing else.
 *
 * It is deliberately drawn in the WIRE colour rather than a tone's. A junction
 * is not a component — it is a place where wires meet, and painting it like a
 * component would make a drawing look as though it had a part in it that a
 * reader would then go looking for in the parts list.
 */
const nodeBody = (theme: DiagramTheme): string =>
  `<circle cx="${n(NODE_SIZE / 2)}" cy="${n(NODE_SIZE / 2)}" r="${n(Math.max(2.4, theme.wireWidth * 1.8))}" fill="${esc(theme.wireColor)}"/>`;

/** A signal tag: a rectangle with one chamfered end, pointing the way it flows. */
function ioTag(
  block: Block,
  size: Box,
  local: ReadonlyMap<string, PlacedPort>,
  theme: DiagramTheme,
): string {
  const t = toneOf(block, theme);
  const { w, h } = size;
  const c = 8;
  const outward = block.ports.some((p) => p.dir === "out");
  const d = outward
    ? `M0,0H${n(w - c)}L${n(w)},${n(h / 2)}L${n(w - c)},${n(h)}H0Z`
    : `M${n(c)},0H${n(w)}V${n(h)}H${n(c)}L0,${n(h / 2)}Z`;
  return (
    `<path d="${d}" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth)}"/>` +
    `<text x="${n(w / 2 - (outward ? c / 2 : -c / 2))}" y="${n(h / 2)}" dominant-baseline="central" text-anchor="middle" font-family="${esc(theme.monoFamily)}" font-size="${n(theme.titleSize * 0.85)}" fill="${esc(t.text)}">${esc(block.title)}</text>` +
    stubs(block, size, local, theme)
  );
}

/**
 * ANSI distinctive-shape gate bodies.
 *
 * Deliberately the same shapes the lab's `GateSymbol` draws, at this module's
 * own scale. They are duplicated rather than imported because `src/lib` may not
 * import a component (Invariant 3) — and the shapes are a fixed, 60-year-old
 * standard, so the duplication is of something that cannot change.
 */
function gateBody(
  block: Block,
  size: Box,
  local: ReadonlyMap<string, PlacedPort>,
  theme: DiagramTheme,
): string {
  const t = toneOf(block, theme);
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

  const body =
    shape === "and"
      ? `M0,0H${n(W * 0.42)}A${n(H / 2)},${n(H / 2)} 0 0 1 ${n(W * 0.42)},${n(H)}H0Z`
      : shape === "or"
        ? `M0,0Q${n(W * 0.55)},2 ${n(W * 0.92)},${n(H / 2)}Q${n(W * 0.55)},${n(H - 2)} 0,${n(H)}Q${n(W * 0.26)},${n(H / 2)} 0,0Z`
        : `M0,0L${n(W * 0.7)},${n(H / 2)}L0,${n(H)}Z`;

  const tip = shape === "and" ? W * 0.42 + H / 2 : shape === "or" ? W * 0.92 : W * 0.7;

  const parts = [
    `<path d="${body}" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth)}" stroke-linejoin="round"/>`,
  ];
  if (op === "xor" || op === "xnor") {
    parts.push(
      `<path d="M-6,0Q${n(W * 0.2)},${n(H / 2)} -6,${n(H)}" fill="none" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth)}"/>`,
    );
  }
  if (inverted) {
    parts.push(
      `<circle cx="${n(tip + bubbleR)}" cy="${n(H / 2)}" r="${n(bubbleR)}" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth)}"/>`,
    );
  }
  parts.push(
    `<path d="M${n(inverted ? tip + bubbleR * 2 : tip)},${n(H / 2)}H${n(W)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth)}"/>`,
  );
  // A gate's title is written under it — inside the body there is no room, and a
  // shrunk-to-fit label is unreadable at the size these are printed.
  if (block.title) {
    parts.push(
      `<text x="${n(W / 2)}" y="${n(H + theme.subtitleSize + 2)}" text-anchor="middle" font-family="${esc(theme.monoFamily)}" font-size="${n(theme.subtitleSize)}" fill="${esc(theme.mutedTextColor)}">${esc(block.title)}</text>`,
    );
  }
  parts.push(stubs(block, size, local, theme));
  return parts.join("");
}

function boxBody(
  block: Block,
  size: Box,
  local: ReadonlyMap<string, PlacedPort>,
  theme: DiagramTheme,
): string {
  const t = toneOf(block, theme);
  const { w, h } = size;
  const hasSub = Boolean(block.subtitle) && theme.showSubtitles;
  const titleY = hasSub ? h / 2 - theme.subtitleSize * 0.55 : h / 2;

  // The title and the subtitle are ONE text element with a `tspan`, not two
  // elements. They are one paragraph — and when the block is turned, two
  // separately positioned lines each turn about their own anchor and land on
  // top of each other, spelling "2-to-4decoder". A tspan keeps the second line
  // where it belongs: under the first, in the first one's frame.
  const sub = hasSub
    ? `<tspan x="${n(w / 2)}" dy="${n(theme.titleSize * 0.7 + theme.subtitleSize * 0.55)}" font-size="${n(theme.subtitleSize)}" font-weight="400" fill="${esc(theme.mutedTextColor)}">${esc(block.subtitle as string)}</tspan>`
    : "";

  return [
    `<rect x="0" y="0" width="${n(w)}" height="${n(h)}" rx="${n(theme.blockRadius)}" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth)}"${theme.blockShadow ? ` filter="url(#bshadow)"` : ""}/>`,
    `<text x="${n(w / 2)}" y="${n(titleY)}" dominant-baseline="central" text-anchor="middle" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.titleSize)}" font-weight="600" fill="${esc(t.text)}">${esc(block.title)}${sub}</text>`,
    stubs(block, size, local, theme),
  ].join("");
}

/**
 * The pin stubs, their bubbles, and their labels — drawn in the block's own
 * upright frame, which is where the body paths are too.
 */
function stubs(
  block: Block,
  size: Box,
  local: ReadonlyMap<string, PlacedPort>,
  theme: DiagramTheme,
): string {
  const t = toneOf(block, theme);
  const parts: string[] = [];
  const bubbleR = 3.2;

  for (const p of local.values()) {
    const { x, y, ax, ay } = p;
    // A junction's pin has no stub: the wire meets the dot. Drawing the
    // zero-length line anyway paints a round cap on top of the dot.
    if (x === ax && y === ay) continue;
    const low = p.port.activeLow === true;

    // An active-low pin's stub starts past its bubble, so the bubble sits ON the
    // border where it belongs rather than floating in the middle of the wire.
    let sx = low ? x + p.out.x * bubbleR * 2 : x;
    const sy = low ? y + p.out.y * bubbleR * 2 : y;

    // An OR gate's back is a curve, so a pin's `x = 0` is NOT where the symbol
    // is: at mid-height the bow is 7px to the right, and every input wire used
    // to stop short of the body and hang in space. Extend it to the ink.
    if (block.kind === "gate" && p.port.side === "left" && !low) {
      sx = Math.max(sx, gateBackX(block.op ?? "and", size, y));
    }
    parts.push(
      `<path d="M${n(sx)},${n(sy)}L${n(ax)},${n(ay)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.wireWidth)}"/>`,
    );
    if (low) {
      parts.push(
        `<circle cx="${n(x + p.out.x * bubbleR)}" cy="${n(y + p.out.y * bubbleR)}" r="${n(bubbleR)}" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth * 0.9)}"/>`,
      );
    }
  }
  return parts.join("");
}

/**
 * The pin labels, in the SHEET's frame rather than the block's.
 *
 * Which side of the pin the label goes on, and which way it is anchored, is
 * decided by the pin's outward direction AFTER any rotation — so a turned block
 * keeps its labels inside its own border, reading the right way, without the
 * placement rules knowing that rotation exists.
 */
function portLabels(b: PlacedBlock, theme: DiagramTheme): string {
  if (!theme.showPortLabels || b.block.kind !== "box") return "";
  const size = theme.portLabelSize;
  const inset = 6;
  const parts: string[] = [];

  for (const p of b.ports.values()) {
    if (!p.port.label) continue;
    const font = `font-family="${esc(theme.monoFamily)}" font-size="${n(size)}" fill="${esc(theme.mutedTextColor)}"`;
    const label = esc(p.port.label);
    if (p.out.x < 0) {
      parts.push(
        `<text x="${n(p.x + inset)}" y="${n(p.y)}" dominant-baseline="central" ${font}>${label}</text>`,
      );
    } else if (p.out.x > 0) {
      parts.push(
        `<text x="${n(p.x - inset)}" y="${n(p.y)}" text-anchor="end" dominant-baseline="central" ${font}>${label}</text>`,
      );
    } else if (p.out.y < 0) {
      parts.push(
        `<text x="${n(p.x)}" y="${n(p.y + size + 2)}" text-anchor="middle" ${font}>${label}</text>`,
      );
    } else {
      parts.push(
        `<text x="${n(p.x)}" y="${n(p.y - 5)}" text-anchor="middle" ${font}>${label}</text>`,
      );
    }
  }
  return parts.join("");
}

// --- timing -----------------------------------------------------------------

const TIMING_ROW_H = 34;
const TIMING_TOP = 20;
const TIMING_MARKER_H = 18;
const TIMING_TICK_W = 26;
const TIMING_LABEL_W = 58;

/**
 * Measured the same way it is drawn, term by term. When these two drift the
 * caption lands on top of the notes underneath — which is exactly what happened
 * the first time, because the height was a guess and the layout was a sum.
 */
const timingHeight = (t: TimingChart, theme: DiagramTheme): number =>
  TIMING_TOP +
  t.waves.length * TIMING_ROW_H +
  (t.markers && t.markers.length > 0 ? TIMING_MARKER_H : 0) +
  (t.caption ? theme.subtitleSize * 1.8 + 10 : 0) +
  12;

const timingWidth = (t: TimingChart): number => {
  const ticks = Math.max(0, ...t.waves.map((w) => w.values.length));
  return TIMING_LABEL_W + ticks * TIMING_TICK_W + 20;
};

/**
 * A waveform strip.
 *
 * The ripple-counter question is the reason `delay` exists: the whole point of
 * an asynchronous counter is that bit 1 does not change at the clock edge, it
 * changes one gate delay after bit 0 did. Drawing every trace edge-aligned would
 * be drawing a SYNCHRONOUS counter and labelling it asynchronous — which is
 * precisely the misconception the question exists to catch.
 */
function renderTiming(t: TimingChart, theme: DiagramTheme): string {
  const ticks = Math.max(0, ...t.waves.map((w) => w.values.length));
  const parts: string[] = [];
  const x0 = TIMING_LABEL_W;
  const totalH = t.waves.length * TIMING_ROW_H;

  parts.push(
    `<text x="0" y="10" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.subtitleSize * 1.1)}" font-weight="600" fill="${esc(theme.textColor)}">${esc(t.title)}</text>`,
  );

  const top = TIMING_TOP;
  // Tick gridlines, so a reader can count edges without a ruler.
  const gl: string[] = [];
  for (let i = 0; i <= ticks; i++) {
    gl.push(`M${n(x0 + i * TIMING_TICK_W)},${n(top)}V${n(top + totalH)}`);
  }
  parts.push(
    `<path d="${gl.join("")}" stroke="${esc(theme.gridColor === theme.background ? theme.mutedTextColor : theme.gridColor)}" stroke-width="0.7" opacity="0.7"/>`,
  );

  t.waves.forEach((w, row) => {
    const yTop = top + row * TIMING_ROW_H + 6;
    const yBot = yTop + TIMING_ROW_H - 16;
    const color =
      w.tone === "clock"
        ? theme.mutedTextColor
        : theme.wireColoring === "mono"
          ? theme.wireColor
          : (theme.palette[row % Math.max(1, theme.palette.length)] as string);

    parts.push(
      `<text x="${n(TIMING_LABEL_W - 8)}" y="${n((yTop + yBot) / 2)}" text-anchor="end" dominant-baseline="central" font-family="${esc(theme.monoFamily)}" font-size="${n(theme.portLabelSize)}" fill="${esc(theme.textColor)}">${esc(w.label)}</text>`,
    );

    const shift = (w.delay ?? 0) * TIMING_TICK_W;
    const d: string[] = [];
    let prev = w.values[0] ?? 0;
    d.push(`M${n(x0)},${n(prev ? yTop : yBot)}`);
    for (let i = 0; i < w.values.length; i++) {
      const v = w.values[i] as 0 | 1;
      const x = x0 + i * TIMING_TICK_W + (i === 0 ? 0 : shift);
      if (v !== prev) {
        d.push(`L${n(x)},${n(prev ? yTop : yBot)}`);
        d.push(`L${n(x)},${n(v ? yTop : yBot)}`);
        prev = v;
      }
      d.push(`L${n(x0 + (i + 1) * TIMING_TICK_W)},${n(v ? yTop : yBot)}`);
    }
    parts.push(
      `<path d="${d.join("")}" fill="none" stroke="${esc(color)}" stroke-width="${n(theme.wireWidth * 1.2)}" stroke-linejoin="miter"/>`,
    );
  });

  // A marker past the last sample is not a marker, it is a stray dashed line off
  // to the right of the chart with a caption under nothing.
  for (const m of (t.markers ?? []).filter((m) => m.tick <= ticks)) {
    const x = x0 + m.tick * TIMING_TICK_W;
    parts.push(
      `<path d="M${n(x)},${n(top - 4)}V${n(top + totalH + 4)}" stroke="${esc(theme.tones.seq.stroke)}" stroke-width="1" stroke-dasharray="3 3"/>`,
      `<text x="${n(x + 3)}" y="${n(top + totalH + 14)}" font-family="${esc(theme.monoFamily)}" font-size="9" fill="${esc(theme.tones.seq.stroke)}">${esc(m.label)}</text>`,
    );
  }

  if (t.caption) {
    const below = top + totalH + (t.markers && t.markers.length > 0 ? TIMING_MARKER_H : 0) + 18;
    parts.push(
      `<text x="0" y="${n(below)}" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.subtitleSize * 1.1)}" fill="${esc(theme.mutedTextColor)}">${esc(t.caption)}</text>`,
    );
  }
  return parts.join("");
}

// --- text wrapping ----------------------------------------------------------

/** Greedy wrap using the same estimator the block sizer uses. */
function wrap(text: string, width: number, theme: DiagramTheme): string[] {
  const max = Math.max(240, width);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, theme.subtitleSize * 1.1) > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
