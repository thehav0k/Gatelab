/**
 * The BLOCK DIAGRAM model.
 *
 * WHY THIS IS NOT THE `CircuitDocument` FROM `simulation/netlist.ts`
 * -----------------------------------------------------------------
 * That document models a board you could actually build: 4-state values, nets
 * rebuilt by union-find, power pins you can forget to wire, faults. It is the
 * right model for "here is a breadboard, did you wire it correctly".
 *
 * It is the WRONG model for the thing an exam question asks for. "Implement a
 * 1-to-16 demultiplexer using 2-to-4 decoders" wants five labelled boxes, not
 * 96 gates; and "show the external connections for a 64x8 memory from 16x4
 * chips" wants an address bus drawn as one line with a slash and a `6` on it,
 * not six wires. The whole content of the answer is the DECOMPOSITION — which
 * boxes, what is inside them, what connects to what — and flattening it to
 * gates destroys exactly the information being examined.
 *
 * So this is a second, deliberately smaller model: boxes with named ports, and
 * links between ports. No values, no simulation, no nets. It cannot tell you a
 * pin is floating, and it is not trying to; the lab already does that.
 *
 * THE SEAM: a `Diagram` is pure data. `layout.ts` places it, `svg.ts` draws it,
 * and `theme.ts` colours it — three separate passes, so the same diagram can be
 * re-themed and re-exported without being rebuilt, and so every builder in
 * `builders/` only has to know about boxes and links.
 */

/** Which edge of a block a port lives on. */
export type Side = "left" | "right" | "top" | "bottom";

export type PortDirection = "in" | "out";

/**
 * Semantic category of a block. This is NOT a colour — it is what the block
 * *is*, and the theme maps it to a colour. Keeping the two apart is what lets a
 * user recolour "all the decoders" without the builders knowing anything about
 * paint.
 */
export type BlockTone =
  | "input"
  | "output"
  | "gate"
  | "msi"
  | "arith"
  | "seq"
  | "memory"
  | "bus"
  | "note";

export interface Port {
  /** Unique within its block. Links refer to this, never to the label. */
  readonly id: string;
  /** What is printed next to it: `A0`, `EN`, `Y3`, `CLK`. */
  readonly label: string;
  readonly side: Side;
  readonly dir: PortDirection;
  /** Draws an inversion bubble and (by convention) an overbar-ish label. */
  readonly activeLow?: boolean;
  /** Bus width. >1 draws a thick line with a slash and the width printed. */
  readonly width?: number;
  /** Pushes a visual gap ABOVE this port — separates `A1 A0` from `E`. */
  readonly gapBefore?: boolean;
  /**
   * A pin with no direction of its own — a junction dot.
   *
   * `dir` is still required because every consumer reads it, but for a pin like
   * this it is a placeholder: which end of a link is the SOURCE is decided by
   * the OTHER end, in `connect()`. A junction between a gate output and three
   * gate inputs is downstream of the output and upstream of the inputs, and no
   * single `dir` can say both.
   */
  readonly bidirectional?: boolean;
}

/**
 * A block. `kind` decides what is drawn:
 *   box   — a labelled rectangle. The MSI parts, memories, registers.
 *   gate  — an ANSI distinctive-shape gate body, reusing the lab's symbols.
 *   io    — a small tag for a top-level input/output signal.
 *   label — free text with no body and no ports. Annotations, bus names.
 *   node  — a junction dot: one pin, at the centre, facing nowhere.
 *
 * `node` is what makes a wire between two arbitrary POINTS expressible. Every
 * other block is a thing with an interface; a junction is a place on the sheet
 * where wires meet, which is a real part of every hand-drawn schematic and had
 * no representation here at all. Modelling it as a block rather than as a
 * special kind of link keeps one rule — a wire runs from a pin to a pin — and
 * means the router, the exporter and undo/redo needed no changes to support it.
 */
export type BlockKind = "box" | "gate" | "io" | "label" | "node";

/** The gate operators a `gate` block may take. Mirrors `simulation/logic.ts`. */
export type DiagramGateOp =
  | "and"
  | "or"
  | "nand"
  | "nor"
  | "xor"
  | "xnor"
  | "not"
  | "buf";

export interface Block {
  readonly id: string;
  readonly kind: BlockKind;
  /** The big line inside the box: `U1`, `74138`, `MUX 8:1`. */
  readonly title: string;
  /** The small line under it: `3-to-8 decoder`. Omitted on gates and IO tags. */
  readonly subtitle?: string;
  readonly tone: BlockTone;
  readonly ports: readonly Port[];
  /** `gate` blocks only. */
  readonly op?: DiagramGateOp;
  /**
   * Layout hint: pin this block to a specific column. Used for the input and
   * output rails, which must line up even when the dataflow depth says
   * otherwise (a `Cin` that only feeds the last adder still belongs on the left).
   */
  readonly column?: number;
  /** Layout hint: preferred vertical order inside its column. Lower is higher. */
  readonly row?: number;
}

/**
 * How far a block is turned, clockwise, in degrees.
 *
 * Four values and not an arbitrary angle, because a block diagram is drawn on a
 * grid and its wires are orthogonal: a symbol at 37° has no pin a horizontal
 * wire can meet. Rotation is a property of a PLACEMENT, never of a `Block` —
 * the block is what the thing is, the rotation is how it happens to be sitting.
 */
export type Rotation = 0 | 90 | 180 | 270;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** Normalise any multiple of 90 (including negatives) into a `Rotation`. */
export const asRotation = (deg: number): Rotation =>
  (((Math.round(deg / 90) * 90) % 360 + 360) % 360) as Rotation;

export interface Endpoint {
  readonly block: string;
  readonly port: string;
}

export interface Link {
  readonly id: string;
  readonly from: Endpoint;
  readonly to: Endpoint;
  /** Printed on the wire. Use sparingly — a labelled wire is a loud wire. */
  readonly label?: string;
  /** Bus width; >1 draws it thick with a slash tick. */
  readonly width?: number;
  readonly style?: "solid" | "dashed";
  /**
   * An explicit colour, overriding whatever the theme would have chosen.
   *
   * Automatic per-signal colouring is right almost always and wrong exactly
   * when the reader needs one wire to stand out — the carry chain, the enable,
   * the one line the paragraph underneath is about. A `#rrggbb` here, and
   * nothing else in the theme has to change.
   */
  readonly color?: string;
}

/**
 * A whole answer's worth of picture.
 *
 * `notes` are the sentences that belong WITH the drawing — "every decoder's
 * enable comes from the stage above it" — not the full explanation, which lives
 * on the solution beside it.
 */
export interface Diagram {
  readonly id: string;
  readonly title: string;
  readonly caption?: string;
  readonly blocks: readonly Block[];
  readonly links: readonly Link[];
  readonly notes?: readonly string[];
  /**
   * Drawn as a waveform strip under the blocks. A timing diagram IS the answer
   * to some questions (Q30), and it shares the theme and the exporter with
   * everything else, so it rides along on the same object.
   */
  readonly timing?: TimingChart;
}

// --- timing ----------------------------------------------------------------

/**
 * A waveform. `values` is one sample per tick — the renderer draws the edges
 * between them, so a ripple counter's propagation delay is expressed by SHIFTING
 * a trace right, not by inventing a sub-tick sample rate.
 */
export interface Waveform {
  readonly label: string;
  /** One 0/1 per tick. */
  readonly values: readonly (0 | 1)[];
  /** Fractional-tick rightward shift, for drawing ripple propagation delay. */
  readonly delay?: number;
  readonly tone?: "clock" | "signal" | "derived";
}

export interface TimingChart {
  readonly title: string;
  readonly waves: readonly Waveform[];
  /** Vertical dashed markers at these tick positions, with a caption. */
  readonly markers?: readonly { readonly tick: number; readonly label: string }[];
  readonly caption?: string;
}

/**
 * Every link must name ports that exist. Builders generate links in loops, and a
 * typo'd port id would otherwise render as a silently missing wire — the single
 * most damaging failure mode for a diagram whose whole job is to be correct.
 */
export function validate(diagram: Diagram): string[] {
  const errors: string[] = [];
  const byId = new Map(diagram.blocks.map((b) => [b.id, b]));

  for (const b of diagram.blocks) {
    const seen = new Set<string>();
    for (const p of b.ports) {
      if (seen.has(p.id)) errors.push(`${diagram.id}: block ${b.id} has duplicate port ${p.id}`);
      seen.add(p.id);
    }
  }

  for (const l of diagram.links) {
    for (const [role, e] of [["from", l.from], ["to", l.to]] as const) {
      const b = byId.get(e.block);
      if (!b) {
        errors.push(`${diagram.id}: link ${l.id} ${role} unknown block ${e.block}`);
        continue;
      }
      if (!b.ports.some((p) => p.id === e.port)) {
        errors.push(`${diagram.id}: link ${l.id} ${role} unknown port ${e.block}.${e.port}`);
      }
    }
  }
  return errors;
}
