import {
  DEFAULT_BOARD,
  dipHoles,
  stripOf,
  type BoardRow,
  type BreadboardSpec,
  type HoleRef,
} from "./breadboard";
import {
  asWireId,
  holeEnd,
  pinKey,
  type CircuitDocument,
  type CircuitNode,
  type Endpoint,
  type PinRef,
  type Wire,
} from "./netlist";
import { getIc } from "./ic-library";
import { pinsOf } from "./parts";

/**
 * Seat a schematic circuit onto a breadboard.
 *
 * Takes the document the synthesizer produced (chips, switches, LEDs, rails,
 * pin-to-pin wires) and re-expresses it physically: chips straddling the centre
 * channel, parts plugged into strips, and every wire redrawn as a jumper between
 * two HOLES.
 *
 * THE RULE THAT MAKES THIS PHYSICAL RATHER THAN A DRAWING: you cannot plug a
 * jumper into a hole a chip's leg is already in. A strip has five holes; the leg
 * takes one, and the jumper has to go in one of the other four. Get that wrong
 * and you have drawn a picture of a breadboard rather than modelled one — the
 * simulation would work and the student would be unable to build it.
 */

export interface PlacementResult {
  readonly doc: CircuitDocument;
  /** Wires that could not be seated (a part ran off the end of the board). */
  readonly unplaced: readonly string[];
}

/** Rows a jumper may use, per half, in the order we prefer them. */
const LOWER_FREE: BoardRow[] = ["A", "B", "C", "D", "E"];
const UPPER_FREE: BoardRow[] = ["J", "I", "H", "G", "F"];

export function placeOnBreadboard(
  source: CircuitDocument,
  spec: BreadboardSpec = DEFAULT_BOARD,
): PlacementResult {
  const nodes: Record<string, CircuitNode> = {};
  const wires: Record<string, Wire> = {};
  const unplaced: string[] = [];

  /** Which hole each schematic pin ends up in. */
  const holeOfPin = new Map<string, HoleRef>();
  /** Holes already physically occupied — a leg, or a jumper end. */
  const taken = new Set<string>();

  const occupy = (hole: HoleRef): void => {
    taken.add(`${hole.col}/${hole.row}`);
  };
  const isTaken = (hole: HoleRef): boolean =>
    taken.has(`${hole.col}/${hole.row}`);

  const all = Object.values(source.nodes);
  const ics = all.filter((n) => n.kind === "ic");
  const rails = all.filter((n) => n.kind === "rail");
  const switches = all.filter((n) => n.kind === "switch");
  const leds = all.filter((n) => n.kind === "led");

  // --- 1. chips, left to right across the channel ---------------------------
  let col = 2;
  for (const ic of ics) {
    const pins = pinsOf(ic);
    const span = pins.length / 2;
    if (col + span - 1 > spec.columns) {
      unplaced.push(ic.id);
      continue;
    }

    nodes[ic.id] = { ...ic, pos: { x: col, y: 0 } };

    const holes = dipHoles({ col }, pins.length);
    pins.forEach((spec_, i) => {
      const hole = holes[i];
      if (!hole) return;
      holeOfPin.set(pinKey({ node: ic.id, pin: spec_.name }), hole);
      occupy(hole); // the chip's leg is IN this hole; no jumper may share it
    });

    col += span + 2; // a two-column gutter so jumpers have somewhere to land
  }

  // --- 2. rails ------------------------------------------------------------
  for (const rail of rails) {
    const row: BoardRow = rail.rail === "vcc" ? "+top" : "-top";
    const hole: HoleRef = { col: 1, row };
    nodes[rail.id] = { ...rail, pos: { x: 1, y: 0 }, boardRow: row };
    for (const spec_ of pinsOf(rail)) {
      holeOfPin.set(pinKey({ node: rail.id, pin: spec_.name }), hole);
    }
    occupy(hole);
  }

  // --- 3. switches along the bottom, LEDs along the top --------------------
  const seatSingle = (node: CircuitNode, at: number, row: BoardRow): void => {
    // A part seated past the last column is not "somewhere off to the right" — it
    // is NOWHERE. Report it, rather than let its pin silently float and present as
    // a mysterious dead output.
    if (at < 1 || at > spec.columns) {
      unplaced.push(node.id);
      return;
    }
    const hole: HoleRef = { col: at, row };
    nodes[node.id] = { ...node, pos: { x: at, y: 0 }, boardRow: row };
    for (const spec_ of pinsOf(node)) {
      holeOfPin.set(pinKey({ node: node.id, pin: spec_.name }), hole);
    }
    occupy(hole);
  };

  // CRITICALLY, these go in columns to the RIGHT of every chip.
  //
  // Seating them from column 2 (as the chips are) put switch A on column 2 row E —
  // the very strip the chip's pin 1 leg is in — and the LED on 2F, which is the
  // Vcc strip. The switch drove the chip's input directly and the LED shorted the
  // supply. A strip is a strip: two parts in one column are WIRED TOGETHER,
  // whether you meant it or not. That is the whole hazard of a real breadboard,
  // and the placer has to respect it.
  switches.forEach((sw, i) => seatSingle(sw, col + i * 2, "A"));
  col += switches.length * 2 + 1;
  leds.forEach((led, i) => seatSingle(led, col + i * 2, "J"));
  col += leds.length * 2 + 1;

  // --- 4. every schematic wire becomes a jumper between two FREE holes ------
  //
  // This is the physical step. A wire connected pin X to pin Y; on the board, X's
  // leg is in some hole, and the jumper must go into a DIFFERENT hole on the same
  // strip. Four remain per strip, and we hand them out here.
  const freeHoleOn = (hole: HoleRef): HoleRef | null => {
    const strip = stripOf(spec, hole);

    // Rails are long; any untaken hole in the same segment will do.
    if (strip.startsWith("rail:")) {
      for (let c = 1; c <= spec.columns; c++) {
        const candidate: HoleRef = { col: c, row: hole.row };
        if (stripOf(spec, candidate) === strip && !isTaken(candidate)) {
          return candidate;
        }
      }
      return null;
    }

    const rows = (LOWER_FREE as readonly string[]).includes(hole.row)
      ? LOWER_FREE
      : UPPER_FREE;
    for (const row of rows) {
      const candidate: HoleRef = { col: hole.col, row };
      if (!isTaken(candidate)) return candidate;
    }
    return null; // the strip is full — five holes, all used
  };

  let w = 0;
  const jumper = (a: HoleRef, b: HoleRef): void => {
    const id = asWireId(`bb${++w}`);
    occupy(a);
    occupy(b);
    wires[id] = { id, a: holeEnd(a), b: holeEnd(b) };
  };

  const endpointHole = (end: Endpoint): HoleRef | null =>
    end.kind === "hole" ? end.ref : (holeOfPin.get(pinKey(end.ref)) ?? null);

  for (const wire of Object.values(source.wires)) {
    const legA = endpointHole(wire.a);
    const legB = endpointHole(wire.b);
    if (!legA || !legB) {
      unplaced.push(wire.id);
      continue;
    }

    // Two legs already on the same strip are ALREADY connected — the metal does it.
    // A jumper would be redundant, and a jumper from a hole to itself is nonsense.
    if (stripOf(spec, legA) === stripOf(spec, legB)) continue;

    const a = freeHoleOn(legA);
    const b = freeHoleOn(legB);
    if (!a || !b) {
      unplaced.push(wire.id);
      continue;
    }
    jumper(a, b);
  }

  return { doc: { nodes, wires, board: spec }, unplaced };
}

/** The strip a pin's leg sits on, for the UI. */
export const stripOfPin = (
  doc: CircuitDocument,
  ref: PinRef,
): string | null => {
  const node = doc.nodes[ref.node];
  if (!node || !doc.board) return null;
  const pins = pinsOf(node);
  const i = pins.findIndex((p) => p.name === ref.pin);
  if (i < 0) return null;

  if (node.kind === "ic") {
    const def = getIc(node.part);
    const holes = dipHoles({ col: Math.round(node.pos.x) }, def?.pins.length ?? 14);
    const hole = holes[i];
    return hole ? stripOf(doc.board, hole) : null;
  }
  if (!node.boardRow) return null;
  return stripOf(doc.board, { col: Math.round(node.pos.x), row: node.boardRow });
};
