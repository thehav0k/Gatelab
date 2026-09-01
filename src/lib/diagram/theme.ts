import type { BlockTone } from "./types";

/**
 * How a diagram is PAINTED, kept entirely separate from what it IS.
 *
 * Why this is its own file rather than a handful of Tailwind classes on the
 * renderer: the export is the product. A student pastes these into a lab report
 * that is black-on-white, or into slides that are white-on-navy, and a diagram
 * that can only be drawn in one palette is a diagram they have to redraw by hand.
 *
 * So every colour the renderer can emit is a field here, the renderer reads
 * NOTHING else, and the exported SVG is byte-for-byte what is on screen.
 *
 * NOTE ON COLOUR SPACE. Everything here is `#rrggbb`, never an `oklch()` token
 * and never a `var(--…)`. Two reasons, both learned the hard way elsewhere in
 * this codebase: the `@theme inline` block does not emit `--color-*` custom
 * properties at all (see AGENTS.md), and an exported SVG opened as a file has no
 * stylesheet behind it — a `var()` there resolves to nothing and the shape comes
 * out invisible, with no error. Hex is the only thing that survives the round
 * trip into someone else's document.
 */

export interface ToneColors {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
}

/**
 * `"source"` colours a wire by the SIGNAL it carries — every branch of one
 * fan-out the same hue, which is the only thing that makes the colouring useful
 * for tracing a connection.
 *
 * There used to be a third value, `"kind"`, which nothing implemented and
 * nothing offered: it behaved exactly like `"source"` if you ever set it, which
 * is the worst kind of option.
 */
export type WireColoring = "mono" | "source";

export interface DiagramTheme {
  readonly name: string;

  // --- page ---
  /** `"none"` exports with a transparent background — right for dark slides. */
  readonly background: string;
  readonly grid: "none" | "dots" | "lines";
  readonly gridColor: string;
  readonly gridSize: number;
  readonly padding: number;

  // --- type ---
  readonly fontFamily: string;
  readonly monoFamily: string;
  readonly titleSize: number;
  readonly subtitleSize: number;
  readonly portLabelSize: number;
  readonly wireLabelSize: number;

  // --- blocks ---
  readonly blockRadius: number;
  readonly blockStrokeWidth: number;
  readonly tones: Readonly<Record<BlockTone, ToneColors>>;
  readonly showSubtitles: boolean;
  readonly showPortLabels: boolean;
  /** A soft drop shadow under every box. Off for print. */
  readonly blockShadow: boolean;

  // --- wires ---
  readonly wireColoring: WireColoring;
  readonly wireColor: string;
  readonly busColor: string;
  readonly wireWidth: number;
  readonly busWidth: number;
  /** Cycled when `wireColoring` is not `"mono"`. */
  readonly palette: readonly string[];
  readonly showJunctions: boolean;
  readonly showArrows: boolean;
  /** Radius of the rounded corner on an orthogonal bend. 0 = square corners. */
  readonly cornerRadius: number;

  // --- frame ---
  readonly showTitle: boolean;
  readonly showCaption: boolean;
  readonly showFrame: boolean;
  readonly frameColor: string;
  readonly textColor: string;
  readonly mutedTextColor: string;
}

const SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/** Shared shape/type metrics. Only colours differ between presets. */
const METRICS = {
  grid: "none" as const,
  gridSize: 20,
  padding: 28,
  fontFamily: SANS,
  monoFamily: MONO,
  titleSize: 14,
  subtitleSize: 10,
  portLabelSize: 10,
  wireLabelSize: 10,
  blockRadius: 6,
  blockStrokeWidth: 1.6,
  blockShadow: false,
  showSubtitles: true,
  showPortLabels: true,
  wireWidth: 1.6,
  busWidth: 3,
  showJunctions: true,
  showArrows: true,
  cornerRadius: 5,
  showTitle: true,
  showCaption: true,
  showFrame: false,
};

const tone = (fill: string, stroke: string, text: string): ToneColors => ({
  fill,
  stroke,
  text,
});

/**
 * The default. Reads as a textbook figure: white page, near-black line work, one
 * accent hue per block category so a decoder is never mistaken for a register.
 */
export const TEXTBOOK: DiagramTheme = {
  ...METRICS,
  name: "Textbook",
  background: "#ffffff",
  gridColor: "#e8e8ec",
  textColor: "#111318",
  mutedTextColor: "#5c6470",
  frameColor: "#d4d7de",
  wireColoring: "mono",
  wireColor: "#2b3038",
  busColor: "#2b3038",
  // Ordered so that CONSECUTIVE slots are far apart in hue, not sorted by it.
  // Signals are handed slots in order, so neighbouring wires get neighbouring
  // slots — and the previous order put burnt orange next to amber, which at
  // 1.6px reads as one colour and defeats the entire point of colouring by
  // signal. Every adjacent pair here is at least 80 degrees apart.
  palette: [
    "#c2410c", "#1d4ed8", "#15803d", "#be185d",
    "#0e7490", "#b45309", "#6d28d9", "#334155",
  ],
  tones: {
    input: tone("#f1f5f9", "#64748b", "#0f172a"),
    output: tone("#f1f5f9", "#64748b", "#0f172a"),
    gate: tone("#ffffff", "#1f2937", "#0f172a"),
    msi: tone("#eff6ff", "#2563eb", "#1e3a8a"),
    arith: tone("#f0fdf4", "#16a34a", "#14532d"),
    seq: tone("#fefce8", "#ca8a04", "#713f12"),
    memory: tone("#faf5ff", "#9333ea", "#4c1d95"),
    bus: tone("#f8fafc", "#94a3b8", "#334155"),
    note: tone("#ffffff00", "#00000000", "#5c6470"),
  },
};

/** Matches the app in dark mode, so the on-screen figure is not a white slab. */
export const SLATE: DiagramTheme = {
  ...METRICS,
  name: "Slate",
  background: "#0f1116",
  gridColor: "#1c1f27",
  textColor: "#e8eaef",
  mutedTextColor: "#98a0ad",
  frameColor: "#2a2f3a",
  wireColoring: "source",
  wireColor: "#9aa3b2",
  busColor: "#c3cad6",
  // Interleaved by hue, for the same reason as the Textbook palette.
  palette: [
    "#f87171", "#22d3ee", "#fbbf24", "#a78bfa",
    "#4ade80", "#f472b6", "#60a5fa", "#fb923c",
  ],
  tones: {
    input: tone("#1a1e26", "#7c8798", "#e8eaef"),
    output: tone("#1a1e26", "#7c8798", "#e8eaef"),
    gate: tone("#161a21", "#c8cfda", "#e8eaef"),
    msi: tone("#132033", "#60a5fa", "#cfe3ff"),
    arith: tone("#10261a", "#4ade80", "#c9f7d8"),
    seq: tone("#2a2110", "#fbbf24", "#fdeec2"),
    memory: tone("#211433", "#a78bfa", "#e2d5ff"),
    bus: tone("#171b22", "#7c8798", "#c8cfda"),
    note: tone("#00000000", "#00000000", "#98a0ad"),
  },
};

/**
 * For a printed lab report and for photocopiers. No fills, no colour, heavier
 * line work — which is also the only version that survives being faxed, and
 * university submission portals are closer to fax than anyone admits.
 */
export const PRINT: DiagramTheme = {
  ...METRICS,
  name: "Print (mono)",
  background: "#ffffff",
  gridColor: "#eeeeee",
  textColor: "#000000",
  mutedTextColor: "#444444",
  frameColor: "#000000",
  blockRadius: 2,
  blockStrokeWidth: 1.8,
  cornerRadius: 0,
  wireColoring: "mono",
  wireColor: "#000000",
  busColor: "#000000",
  wireWidth: 1.6,
  busWidth: 3.2,
  palette: ["#000000"],
  showFrame: true,
  tones: {
    input: tone("#ffffff", "#000000", "#000000"),
    output: tone("#ffffff", "#000000", "#000000"),
    gate: tone("#ffffff", "#000000", "#000000"),
    msi: tone("#ffffff", "#000000", "#000000"),
    arith: tone("#ffffff", "#000000", "#000000"),
    seq: tone("#ffffff", "#000000", "#000000"),
    memory: tone("#ffffff", "#000000", "#000000"),
    bus: tone("#ffffff", "#000000", "#000000"),
    note: tone("#ffffff00", "#00000000", "#000000"),
  },
};

/** Drafting paper. Popular for slides, and the grid is doing real work here. */
export const BLUEPRINT: DiagramTheme = {
  ...METRICS,
  name: "Blueprint",
  background: "#0b3a63",
  grid: "lines",
  gridColor: "#14507f",
  gridSize: 24,
  textColor: "#eaf3ff",
  mutedTextColor: "#a9c9e8",
  frameColor: "#5b96c9",
  blockRadius: 2,
  wireColoring: "mono",
  wireColor: "#dbeafe",
  busColor: "#ffffff",
  palette: ["#dbeafe"],
  showFrame: true,
  tones: {
    input: tone("#0b3a6300", "#bcd9f5", "#eaf3ff"),
    output: tone("#0b3a6300", "#bcd9f5", "#eaf3ff"),
    gate: tone("#0b3a6300", "#eaf3ff", "#eaf3ff"),
    msi: tone("#0e4a7d", "#bcd9f5", "#eaf3ff"),
    arith: tone("#0e4a7d", "#bcd9f5", "#eaf3ff"),
    seq: tone("#0e4a7d", "#bcd9f5", "#eaf3ff"),
    memory: tone("#0e4a7d", "#bcd9f5", "#eaf3ff"),
    bus: tone("#0e4a7d", "#bcd9f5", "#eaf3ff"),
    note: tone("#00000000", "#00000000", "#a9c9e8"),
  },
};

export const THEMES: readonly DiagramTheme[] = [TEXTBOOK, SLATE, PRINT, BLUEPRINT];

export const themeByName = (name: string): DiagramTheme =>
  THEMES.find((t) => t.name === name) ?? TEXTBOOK;

/**
 * Apply a partial override on top of a preset.
 *
 * `tones` is merged one level deep on purpose: the style panel edits a single
 * category's fill, and a shallow spread would drop the other eight.
 */
export function withOverrides(
  base: DiagramTheme,
  patch: DiagramThemePatch,
): DiagramTheme {
  const { tones, ...rest } = patch;
  const merged: DiagramTheme = { ...base, ...rest };
  if (!tones) return merged;
  const nextTones = { ...merged.tones };
  for (const [key, value] of Object.entries(tones)) {
    if (!value) continue;
    const k = key as BlockTone;
    nextTones[k] = { ...nextTones[k], ...value };
  }
  return { ...merged, tones: nextTones };
}

export type DiagramThemePatch = Partial<Omit<DiagramTheme, "tones">> & {
  readonly tones?: Partial<Record<BlockTone, Partial<ToneColors>>>;
};

export const TONE_LABELS: Readonly<Record<BlockTone, string>> = {
  input: "Inputs",
  output: "Outputs",
  gate: "Gates",
  msi: "MSI blocks",
  arith: "Arithmetic",
  seq: "Sequential",
  memory: "Memory",
  bus: "Buses",
  note: "Annotations",
};
