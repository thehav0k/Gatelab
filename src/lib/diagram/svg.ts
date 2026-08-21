import type { PlacedBlock, PlacedDiagram, Point, RoutedLink } from "./layout";
import { STUB, textWidth } from "./measure";
import type { DiagramTheme } from "./theme";
import type { Block, TimingChart } from "./types";

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
  const pad = theme.padding;
  const title = opts.title ?? (theme.showTitle ? placed.diagram.title : undefined);
  const caption = opts.caption ?? (theme.showCaption ? placed.diagram.caption : undefined);

  const titleH = title ? theme.titleSize * 1.6 + 10 : 0;
  const timing = placed.diagram.timing;
  const timingH = timing ? timingHeight(timing, theme) : 0;
  // Notes and captions are wrapped to the DRAWING's width, not left to run off
  // the side of it. An SVG has no overflow to scroll and no reflow — a line that
  // exceeds the viewBox is simply cut off, silently, in the exported file.
  const contentW = Math.max(placed.width, timing ? timingWidth(timing) : 0);
  const captionLines = caption ? wrap(caption, contentW, theme) : [];
  const captionH = captionLines.length * (theme.subtitleSize * 1.5) + (caption ? 10 : 0);
  const noteLines = (placed.diagram.notes ?? []).flatMap((note, i) =>
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
  if (theme.background !== "none") {
    body.push(
      `<rect x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${esc(theme.background)}"/>`,
    );
  }
  if (theme.grid !== "none") body.push(grid(width, height, theme));
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
function wireColorOf(colorKey: string | null, theme: DiagramTheme): string {
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

function renderBlock(b: PlacedBlock, theme: DiagramTheme): string {
  const g = (inner: string): string =>
    `<g transform="translate(${n(b.x)} ${n(b.y)})">${inner}</g>`;

  switch (b.block.kind) {
    case "label":
      return g(
        `<text x="0" y="${n(b.h * 0.75)}" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.subtitleSize * 1.1)}" fill="${esc(theme.mutedTextColor)}">${esc(b.block.title)}</text>`,
      );
    case "io":
      return g(ioTag(b, theme));
    case "gate":
      return g(gateBody(b, theme));
    case "box":
      return g(boxBody(b, theme));
  }
}

const toneOf = (block: Block, theme: DiagramTheme) => theme.tones[block.tone];

/** A signal tag: a rectangle with one chamfered end, pointing the way it flows. */
function ioTag(b: PlacedBlock, theme: DiagramTheme): string {
  const t = toneOf(b.block, theme);
  const { w, h } = b;
  const c = 8;
  const outward = b.block.ports.some((p) => p.dir === "out");
  const d = outward
    ? `M0,0H${n(w - c)}L${n(w)},${n(h / 2)}L${n(w - c)},${n(h)}H0Z`
    : `M${n(c)},0H${n(w)}V${n(h)}H${n(c)}L0,${n(h / 2)}Z`;
  return (
    `<path d="${d}" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth)}"/>` +
    `<text x="${n(w / 2 - (outward ? c / 2 : -c / 2))}" y="${n(h / 2)}" dominant-baseline="central" text-anchor="middle" font-family="${esc(theme.monoFamily)}" font-size="${n(theme.titleSize * 0.85)}" fill="${esc(t.text)}">${esc(b.block.title)}</text>` +
    stubs(b, theme)
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
function gateBody(b: PlacedBlock, theme: DiagramTheme): string {
  const t = toneOf(b.block, theme);
  const op = b.block.op ?? "and";
  const inverted = op === "nand" || op === "nor" || op === "xnor" || op === "not";
  const shape =
    op === "and" || op === "nand"
      ? "and"
      : op === "or" || op === "nor" || op === "xor" || op === "xnor"
        ? "or"
        : "not";
  const W = b.w;
  const H = b.h;
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
  if (b.block.title) {
    parts.push(
      `<text x="${n(W / 2)}" y="${n(H + theme.subtitleSize + 2)}" text-anchor="middle" font-family="${esc(theme.monoFamily)}" font-size="${n(theme.subtitleSize)}" fill="${esc(theme.mutedTextColor)}">${esc(b.block.title)}</text>`,
    );
  }
  parts.push(stubs(b, theme));
  return parts.join("");
}

function boxBody(b: PlacedBlock, theme: DiagramTheme): string {
  const t = toneOf(b.block, theme);
  const { w, h } = b;
  const hasSub = Boolean(b.block.subtitle) && theme.showSubtitles;
  const titleY = hasSub ? h / 2 - theme.subtitleSize * 0.55 : h / 2;

  const parts = [
    `<rect x="0" y="0" width="${n(w)}" height="${n(h)}" rx="${n(theme.blockRadius)}" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth)}"${theme.blockShadow ? ` filter="url(#bshadow)"` : ""}/>`,
    `<text x="${n(w / 2)}" y="${n(titleY)}" dominant-baseline="central" text-anchor="middle" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.titleSize)}" font-weight="600" fill="${esc(t.text)}">${esc(b.block.title)}</text>`,
  ];
  if (hasSub) {
    parts.push(
      `<text x="${n(w / 2)}" y="${n(h / 2 + theme.titleSize * 0.7)}" dominant-baseline="central" text-anchor="middle" font-family="${esc(theme.fontFamily)}" font-size="${n(theme.subtitleSize)}" fill="${esc(theme.mutedTextColor)}">${esc(b.block.subtitle as string)}</text>`,
    );
  }
  parts.push(stubs(b, theme));
  return parts.join("");
}

/**
 * The pin stubs, their bubbles, and their labels — drawn in the block's local
 * frame, which is why they need the block's own placed ports offset back.
 */
function stubs(b: PlacedBlock, theme: DiagramTheme): string {
  const t = toneOf(b.block, theme);
  const parts: string[] = [];
  const bubbleR = 3.2;

  for (const p of b.ports.values()) {
    const x = p.x - b.x;
    const y = p.y - b.y;
    const ax = p.ax - b.x;
    const ay = p.ay - b.y;
    const low = p.port.activeLow === true;

    // An active-low pin's stub starts past its bubble, so the bubble sits ON the
    // border where it belongs rather than floating in the middle of the wire.
    const sx = low ? x + p.out.x * bubbleR * 2 : x;
    const sy = low ? y + p.out.y * bubbleR * 2 : y;
    parts.push(
      `<path d="M${n(sx)},${n(sy)}L${n(ax)},${n(ay)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.wireWidth)}"/>`,
    );
    if (low) {
      parts.push(
        `<circle cx="${n(x + p.out.x * bubbleR)}" cy="${n(y + p.out.y * bubbleR)}" r="${n(bubbleR)}" fill="${esc(t.fill)}" stroke="${esc(t.stroke)}" stroke-width="${n(theme.blockStrokeWidth * 0.9)}"/>`,
      );
    }

    if (!theme.showPortLabels || b.block.kind !== "box" || !p.port.label) continue;

    const inset = 6;
    const size = theme.portLabelSize;
    if (p.port.side === "left") {
      parts.push(
        `<text x="${n(x + inset)}" y="${n(y)}" dominant-baseline="central" font-family="${esc(theme.monoFamily)}" font-size="${n(size)}" fill="${esc(theme.mutedTextColor)}">${esc(p.port.label)}</text>`,
      );
    } else if (p.port.side === "right") {
      parts.push(
        `<text x="${n(x - inset)}" y="${n(y)}" text-anchor="end" dominant-baseline="central" font-family="${esc(theme.monoFamily)}" font-size="${n(size)}" fill="${esc(theme.mutedTextColor)}">${esc(p.port.label)}</text>`,
      );
    } else if (p.port.side === "top") {
      parts.push(
        `<text x="${n(x)}" y="${n(y + size + 2)}" text-anchor="middle" font-family="${esc(theme.monoFamily)}" font-size="${n(size)}" fill="${esc(theme.mutedTextColor)}">${esc(p.port.label)}</text>`,
      );
    } else {
      parts.push(
        `<text x="${n(x)}" y="${n(y - 5)}" text-anchor="middle" font-family="${esc(theme.monoFamily)}" font-size="${n(size)}" fill="${esc(theme.mutedTextColor)}">${esc(p.port.label)}</text>`,
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
