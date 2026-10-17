import {
  DEFAULT_BOARD,
  ROWS_UPPER,
  dipHoles,
  stripOf,
  type BoardRow,
  type BreadboardSpec,
  type HoleRef,
} from "./breadboard";
import {
  asNodeId,
  asWireId,
  buildNetIndex,
  holeEnd,
  pinEnd,
  pinKey,
  type CircuitDocument,
  type CircuitNode,
  type Endpoint,
  type PinRef,
  type RailNode,
  type Wire,
  type WireId,
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

export interface PlaceBreadboardOptions {
  /**
   * When true, seats circuit for the Digital Logic Trainer Board:
   * - Inputs (switches/clocks) and outputs (LEDs) stay in the trainer chassis panels,
   *   with wires connecting directly between panel sockets and the IC strip holes.
   */
  readonly panelMode?: boolean;
  /**
   * When true, automatically wires VCC and GND power rails, rail bridges,
   * and jumpers to IC power pins. Default is false (power rails are not created by default).
   */
  readonly autoPower?: boolean;
}

/** The five rows of each half, in board order. */
const LOWER_FREE: BoardRow[] = ["A", "B", "C", "D", "E"];
const UPPER_FREE: BoardRow[] = ["J", "I", "H", "G", "F"];

/**
 * The free rows of a strip, NEAREST THE LEG FIRST.
 *
 * A fixed order put every jumper end in the lower half on row A, because A came
 * first and A was always free — a dozen wires stacked along one line at the
 * bottom of the board, crossing each other and everything else, when four other
 * rows of the same strip sat empty. Taking the nearest free row instead spreads
 * them over the strip and makes each jumper shorter, which is also what a person
 * with a box of jumper wire does.
 */
function nearestRows(leg: BoardRow): BoardRow[] {
  const half = (LOWER_FREE as readonly string[]).includes(leg) ? LOWER_FREE : UPPER_FREE;
  const home = half.indexOf(leg);
  return [...half]
    .filter((row) => row !== leg)
    .sort((a, b) => Math.abs(half.indexOf(a) - home) - Math.abs(half.indexOf(b) - home));
}

export function placeOnBreadboard(
  source: CircuitDocument,
  spec: BreadboardSpec = DEFAULT_BOARD,
  options: PlaceBreadboardOptions = {},
): PlacementResult {
  const panelMode = options.panelMode ?? false;
  const autoPower = options.autoPower ?? false;
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
  const switches = all.filter((n) => n.kind === "switch" || n.kind === "clock");
  const leds = all.filter((n) => n.kind === "led");
  const gates = all.filter((n) => n.kind === "gate");
  for (const g of gates) {
    unplaced.push(g.id);
  }

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

  const connectedStrips = new Map<string, Set<string>>();
  const linkStrips = (s1: string, s2: string): void => {
    if (!connectedStrips.has(s1)) connectedStrips.set(s1, new Set([s1]));
    if (!connectedStrips.has(s2)) connectedStrips.set(s2, new Set([s2]));
    const merged = new Set([
      ...(connectedStrips.get(s1) ?? []),
      ...(connectedStrips.get(s2) ?? []),
    ]);
    for (const s of merged) connectedStrips.set(s, merged);
  };

  const freeHoleOn = (hole: HoleRef): HoleRef | null => {
    const strip = stripOf(spec, hole);

    // Rails are long; find nearest untaken hole in the same segment to hole.col
    if (strip.startsWith("rail:")) {
      const maxDist = Math.max(hole.col - 1, spec.columns - hole.col);
      for (let dist = 0; dist <= maxDist; dist++) {
        const cols = dist === 0 ? [hole.col] : [hole.col + dist, hole.col - dist];
        for (const c of cols) {
          if (c >= 1 && c <= spec.columns) {
            const candidate: HoleRef = { col: c, row: hole.row };
            if (stripOf(spec, candidate) === strip && !isTaken(candidate)) {
              return candidate;
            }
          }
        }
      }
      return null;
    }

    for (const row of nearestRows(hole.row)) {
      const candidate: HoleRef = { col: hole.col, row };
      if (!isTaken(candidate)) return candidate;
    }

    // Fallback for high-fanout pins (>4 jumpers): find a free hole on any strip
    // already shorted to this strip via an earlier jumper.
    const peers = connectedStrips.get(strip);
    if (peers) {
      for (const peer of peers) {
        if (peer === strip || !peer.startsWith("col:")) continue;
        const [, colStr, half] = peer.split(":");
        const peerCol = Number(colStr);
        const rows = half === "L" ? LOWER_FREE : UPPER_FREE;
        for (const r of rows) {
          const cand: HoleRef = { col: peerCol, row: r };
          if (!isTaken(cand)) return cand;
        }
      }
    }

    return null; // the strip is full — five holes, all used
  };

  let w = 0;
  const jumper = (a: HoleRef, b: HoleRef, color?: string): void => {
    const id = asWireId(`bb${++w}`);
    occupy(a);
    occupy(b);
    linkStrips(stripOf(spec, a), stripOf(spec, b));
    wires[id] = { id, a: holeEnd(a), b: holeEnd(b), ...(color ? { color } : {}) };
  };

  const wirePinToHole = (pin: PinRef, hole: HoleRef, color?: string): void => {
    const id = asWireId(`bb${++w}`);
    occupy(hole);
    wires[id] = { id, a: pinEnd(pin), b: holeEnd(hole), ...(color ? { color } : {}) };
  };

  if (panelMode) {
    if (autoPower) {
      // --- 2. In Trainer Panel mode: VCC and GND from DC Power Supply ---
      let vccNode = rails.find((r) => r.rail === "vcc");
      let gndNode = rails.find((r) => r.rail === "gnd");
      if (!vccNode) {
        vccNode = { id: asNodeId("vcc"), kind: "rail", rail: "vcc", label: "+5V", pos: { x: 0, y: 0 } };
      }
      if (!gndNode) {
        gndNode = { id: asNodeId("gnd"), kind: "rail", rail: "gnd", label: "GND", pos: { x: 0, y: 0 } };
      }
      nodes[vccNode.id] = vccNode;
      nodes[gndNode.id] = gndNode;

      // Connect +5V socket to top positive rail (col 1, +top) and bridge to +bottom
      const vccTop: HoleRef = { col: 1, row: "+top" };
      const vccBottom: HoleRef = { col: 1, row: "+bottom" };
      wirePinToHole({ node: vccNode.id, pin: "VCC" }, vccTop, "#ef4444");
      jumper(vccTop, vccBottom, "#ef4444");

      // Connect GND socket to bottom ground rail (col 1, -bottom) and bridge to -top
      const gndTop: HoleRef = { col: 1, row: "-top" };
      const gndBottom: HoleRef = { col: 1, row: "-bottom" };
      wirePinToHole({ node: gndNode.id, pin: "GND" }, gndBottom, "#3b82f6");
      jumper(gndTop, gndBottom, "#3b82f6");

      // Bridge power rails across segment boundaries if split
      if (spec.railSegments > 1) {
        const perSegment = Math.ceil(spec.columns / spec.railSegments);
        for (let seg = 1; seg < spec.railSegments; seg++) {
          const cLeft = seg * perSegment;
          const cRight = cLeft + 1;
          if (cRight <= spec.columns) {
            jumper({ col: cLeft, row: "+top" }, { col: cRight, row: "+top" }, "#ef4444");
            jumper({ col: cLeft, row: "-top" }, { col: cRight, row: "-top" }, "#3b82f6");
            jumper({ col: cLeft, row: "+bottom" }, { col: cRight, row: "+bottom" }, "#ef4444");
            jumper({ col: cLeft, row: "-bottom" }, { col: cRight, row: "-bottom" }, "#3b82f6");
          }
        }
      }

      // Auto-power every seated IC based on actual VCC and GND pins (LAB-02)
      for (const ic of ics) {
        if (unplaced.includes(ic.id)) continue;
        const def = getIc(ic.part);
        if (!def) continue;
        const icCol = Math.round(nodes[ic.id]!.pos.x);
        const holes = dipHoles({ col: icCol }, def.pins.length);
        const vccIdx = def.pins.findIndex((p) => p.dir === "pwr");
        const gndIdx = def.pins.findIndex((p) => p.dir === "gnd");
        if (vccIdx === -1 || gndIdx === -1) continue;

        const vccLeg = holes[vccIdx]!;
        const gndLeg = holes[gndIdx]!;

        const vccHole = freeHoleOn({ col: vccLeg.col, row: vccLeg.row });
        const vccRail = freeHoleOn({ col: vccLeg.col, row: vccLeg.row === "F" ? "+top" : "+bottom" });
        if (vccHole && vccRail) {
          jumper(vccHole, vccRail, "#ef4444");
        }

        const gndHole = freeHoleOn({ col: gndLeg.col, row: gndLeg.row });
        const gndRail =
          freeHoleOn({ col: gndLeg.col, row: gndLeg.row === "E" ? "-bottom" : "-top" }) ??
          freeHoleOn({ col: gndLeg.col, row: gndLeg.row === "E" ? "-top" : "-bottom" });
        if (gndHole && gndRail) {
          jumper(gndHole, gndRail, "#3b82f6");
        }
      }
    } else {
      for (const rail of rails) {
        nodes[rail.id] = { ...rail, pos: { x: 0, y: 0 } };
      }
    }

    // Switches and LEDs stay in the trainer chassis panels (pos {0, 0}, no boardRow)
    for (const sw of switches) {
      nodes[sw.id] = { ...sw, pos: { x: 0, y: 0 } };
    }
    for (const led of leds) {
      nodes[led.id] = { ...led, pos: { x: 0, y: 0 } };
    }

    // Schematic wires: route between panel sockets and IC pin strips
    for (const wire of Object.values(source.wires)) {
      const pinA = wire.a.kind === "pin" ? wire.a.ref : null;
      const pinB = wire.b.kind === "pin" ? wire.b.ref : null;
      const isSwitchA = pinA !== null && switches.some((s) => s.id === pinA.node);
      const isSwitchB = pinB !== null && switches.some((s) => s.id === pinB.node);
      const isLedA = pinA !== null && leds.some((l) => l.id === pinA.node);
      const isLedB = pinB !== null && leds.some((l) => l.id === pinB.node);

      if ((isSwitchA || isLedA) && (isSwitchB || isLedB)) {
        // Direct socket-to-socket wire between trainer chassis controls (e.g. switch -> LED)
        wires[wire.id] = wire;
        continue;
      }

      if (isSwitchA && !isSwitchB && pinA) {
        const targetLeg = wire.b.kind === "hole" ? wire.b.ref : (pinB ? (holeOfPin.get(pinKey(pinB)) ?? null) : null);
        if (!targetLeg) { unplaced.push(wire.id); continue; }
        const targetHole = freeHoleOn(targetLeg);
        if (!targetHole) { unplaced.push(wire.id); continue; }
        const srcNode = source.nodes[pinA.node];
        const defaultColor = srcNode?.kind === "clock" ? "#f59e0b" : "#38bdf8";
        wirePinToHole(pinA, targetHole, wire.color || defaultColor);
        continue;
      }
      if (isSwitchB && !isSwitchA && pinB) {
        const targetLeg = wire.a.kind === "hole" ? wire.a.ref : (pinA ? (holeOfPin.get(pinKey(pinA)) ?? null) : null);
        if (!targetLeg) { unplaced.push(wire.id); continue; }
        const targetHole = freeHoleOn(targetLeg);
        if (!targetHole) { unplaced.push(wire.id); continue; }
        const srcNode = source.nodes[pinB.node];
        const defaultColor = srcNode?.kind === "clock" ? "#f59e0b" : "#38bdf8";
        wirePinToHole(pinB, targetHole, wire.color || defaultColor);
        continue;
      }
      if (isLedA && !isLedB && pinA) {
        const sourceLeg = wire.b.kind === "hole" ? wire.b.ref : (pinB ? (holeOfPin.get(pinKey(pinB)) ?? null) : null);
        if (!sourceLeg) { unplaced.push(wire.id); continue; }
        const sourceHole = freeHoleOn(sourceLeg);
        if (!sourceHole) { unplaced.push(wire.id); continue; }
        wirePinToHole(pinA, sourceHole, wire.color || "#10b981");
        continue;
      }
      if (isLedB && !isLedA && pinB) {
        const sourceLeg = wire.a.kind === "hole" ? wire.a.ref : (pinA ? (holeOfPin.get(pinKey(pinA)) ?? null) : null);
        if (!sourceLeg) { unplaced.push(wire.id); continue; }
        const sourceHole = freeHoleOn(sourceLeg);
        if (!sourceHole) { unplaced.push(wire.id); continue; }
        wirePinToHole(pinB, sourceHole, wire.color || "#10b981");
        continue;
      }

      const isRailA = pinA !== null && rails.some((r) => r.id === pinA.node);
      const isRailB = pinB !== null && rails.some((r) => r.id === pinB.node);

      // Skip wires bridging rails directly since power rails are auto-bridged (lines 181-206)
      if (isRailA && isRailB) {
        continue;
      }

      const isPowerPin = (pin: PinRef | null): boolean => {
        if (!pin) return false;
        const n = nodes[pin.node] ?? source.nodes[pin.node];
        if (n?.kind === "ic") {
          const def = getIc(n.part);
          const p = def?.pins.find((sp) => sp.name === pin.pin);
          return p?.dir === "pwr" || p?.dir === "gnd";
        }
        return false;
      };

      // Skip wires to IC power pins (VCC pin 14 / GND pin 7) since chips are auto-powered (lines 208-235)
      if (autoPower && (isPowerPin(pinA) || isPowerPin(pinB))) {
        continue;
      }

      const ensureRailFeed = (railNode: CircuitNode, isVcc: boolean) => {
        const hasFeed = Object.values(wires).some(
          (w) =>
            (w.a.kind === "pin" && w.a.ref.node === railNode.id) ||
            (w.b.kind === "pin" && w.b.ref.node === railNode.id),
        );
        if (!hasFeed) {
          if (isVcc) {
            const vccTop: HoleRef = freeHoleOn({ col: 1, row: "+top" }) ?? { col: 1, row: "+top" };
            const vccBottom: HoleRef = freeHoleOn({ col: 1, row: "+bottom" }) ?? { col: 1, row: "+bottom" };
            wirePinToHole({ node: railNode.id, pin: "VCC" }, vccTop, "#ef4444");
            jumper(vccTop, vccBottom, "#ef4444");
          } else {
            const gndTop: HoleRef = freeHoleOn({ col: 1, row: "-top" }) ?? { col: 1, row: "-top" };
            const gndBottom: HoleRef = freeHoleOn({ col: 1, row: "-bottom" }) ?? { col: 1, row: "-bottom" };
            wirePinToHole({ node: railNode.id, pin: "GND" }, gndBottom, "#3b82f6");
            jumper(gndTop, gndBottom, "#3b82f6");
          }

          if (spec.railSegments > 1) {
            const perSegment = Math.ceil(spec.columns / spec.railSegments);
            for (let seg = 1; seg < spec.railSegments; seg++) {
              const cLeft = seg * perSegment;
              const cRight = cLeft + 1;
              if (cRight <= spec.columns) {
                if (isVcc) {
                  jumper({ col: cLeft, row: "+top" }, { col: cRight, row: "+top" }, "#ef4444");
                  jumper({ col: cLeft, row: "+bottom" }, { col: cRight, row: "+bottom" }, "#ef4444");
                } else {
                  jumper({ col: cLeft, row: "-top" }, { col: cRight, row: "-top" }, "#3b82f6");
                  jumper({ col: cLeft, row: "-bottom" }, { col: cRight, row: "-bottom" }, "#3b82f6");
                }
              }
            }
          }
        }
      };

      // Preserve logic tie-off wires between power rails and signal pins (e.g. 1J/1K tied to VCC)
      if (isRailA && !isRailB && pinA) {
        const railNode = nodes[pinA.node] ?? source.nodes[pinA.node];
        const isVcc = railNode?.kind === "rail" ? railNode.rail === "vcc" : pinA.pin === "VCC";
        const color = wire.color || (isVcc ? "#ef4444" : "#3b82f6");
        if (railNode) ensureRailFeed(railNode, isVcc);

        if (isLedB && pinB) {
          const railRow: BoardRow = isVcc ? "+top" : "-bottom";
          const railHole = freeHoleOn({ col: 1, row: railRow });
          if (railHole) {
            wirePinToHole(pinB, railHole, color);
          } else {
            unplaced.push(wire.id);
          }
          continue;
        }

        const targetLeg = wire.b.kind === "hole"
          ? wire.b.ref
          : (pinB ? (holeOfPin.get(pinKey(pinB)) ?? null) : null);
        if (!targetLeg) {
          unplaced.push(wire.id);
          continue;
        }
        const pinHole = freeHoleOn(targetLeg);
        if (!pinHole) {
          unplaced.push(wire.id);
          continue;
        }
        const isUpper = (ROWS_UPPER as readonly string[]).includes(targetLeg.row);
        const railRow: BoardRow = isUpper
          ? (isVcc ? "+top" : "-top")
          : (isVcc ? "+bottom" : "-bottom");
        const railHole = freeHoleOn({ col: targetLeg.col, row: railRow });
        if (!railHole) {
          unplaced.push(wire.id);
          continue;
        }
        jumper(pinHole, railHole, color);
        continue;
      }

      if (isRailB && !isRailA && pinB) {
        const railNode = nodes[pinB.node] ?? source.nodes[pinB.node];
        const isVcc = railNode?.kind === "rail" ? railNode.rail === "vcc" : pinB.pin === "VCC";
        const color = wire.color || (isVcc ? "#ef4444" : "#3b82f6");
        if (railNode) ensureRailFeed(railNode, isVcc);

        if (isLedA && pinA) {
          const railRow: BoardRow = isVcc ? "+top" : "-bottom";
          const railHole = freeHoleOn({ col: 1, row: railRow });
          if (railHole) {
            wirePinToHole(pinA, railHole, color);
          } else {
            unplaced.push(wire.id);
          }
          continue;
        }

        const targetLeg = wire.a.kind === "hole"
          ? wire.a.ref
          : (pinA ? (holeOfPin.get(pinKey(pinA)) ?? null) : null);
        if (!targetLeg) {
          unplaced.push(wire.id);
          continue;
        }
        const pinHole = freeHoleOn(targetLeg);
        if (!pinHole) {
          unplaced.push(wire.id);
          continue;
        }
        const isUpper = (ROWS_UPPER as readonly string[]).includes(targetLeg.row);
        const railRow: BoardRow = isUpper
          ? (isVcc ? "+top" : "-top")
          : (isVcc ? "+bottom" : "-bottom");
        const railHole = freeHoleOn({ col: targetLeg.col, row: railRow });
        if (!railHole) {
          unplaced.push(wire.id);
          continue;
        }
        jumper(pinHole, railHole, color);
        continue;
      }

      // Check if wire was to an IC pin or rail
      const endpointHole = (end: typeof wire.a): HoleRef | null =>
        end.kind === "hole" ? end.ref : (holeOfPin.get(pinKey(end.ref)) ?? null);

      const legA = endpointHole(wire.a);
      const legB = endpointHole(wire.b);
      if (!legA || !legB) {
        unplaced.push(wire.id);
        continue;
      }
      if (stripOf(spec, legA) === stripOf(spec, legB)) continue;

      const a = freeHoleOn(legA);
      const b = freeHoleOn(legB);
      if (!a || !b) {
        unplaced.push(wire.id);
        continue;
      }
      jumper(a, b, wire.color);
    }
  } else {
    // Legacy standalone breadboard mode (for place.test.ts)
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

    switches.forEach((sw, i) => seatSingle(sw, col + i * 2, "A"));
    col += switches.length * 2 + 1;
    leds.forEach((led, i) => seatSingle(led, col + i * 2, "J"));
    col += leds.length * 2 + 1;

    // --- 4. every schematic wire becomes a jumper between two FREE holes ------
    const endpointHole = (end: Endpoint): HoleRef | null =>
      end.kind === "hole" ? end.ref : (holeOfPin.get(pinKey(end.ref)) ?? null);

    for (const wire of Object.values(source.wires)) {
      const legA = endpointHole(wire.a);
      const legB = endpointHole(wire.b);
      if (!legA || !legB) {
        unplaced.push(wire.id);
        continue;
      }

      if (stripOf(spec, legA) === stripOf(spec, legB)) continue;

      const a = freeHoleOn(legA);
      const b = freeHoleOn(legB);
      if (!a || !b) {
        unplaced.push(wire.id);
        continue;
      }
      jumper(a, b, wire.color);
    }
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


// --- seating one new part ---------------------------------------------------

/**
 * Where a part added to a board that is ALREADY seated should go.
 *
 * `placeOnBreadboard` lays out a whole circuit at once. This is the other case,
 * and it was missing entirely: clicking 7400 in the palette while the breadboard
 * is on screen added the chip to the netlist with its SCHEMATIC coordinates
 * still on it. `pos.x` was a pixel offset like 420, so the renderer drew the
 * chip at column 420 of a 63-column board — off the sheet — and the camera,
 * which sizes itself from the rightmost column in use, zoomed out to the full
 * board to try to contain it. The part existed, raised faults, and could not be
 * seen or reached. A part you cannot see is worse than one you cannot add.
 *
 * Returns `null` when the board has no room, which the caller must report:
 * silently adding an unseatable part is exactly the bug this replaces.
 */
export function seatOnBoard(
  doc: CircuitDocument,
  node: CircuitNode,
  spec: BreadboardSpec = DEFAULT_BOARD,
): CircuitNode | null {
  const seated = Object.values(doc.nodes);

  /** Column spans the chips occupy, plus a column of gutter on each side. */
  const chipSpans: [number, number][] = [];
  for (const other of seated) {
    if (other.kind !== "ic") continue;
    const span = pinsOf(other).length / 2;
    const start = Math.round(other.pos.x);
    chipSpans.push([start - 1, start + span]);
  }
  const clearOfChips = (from: number, to: number): boolean =>
    chipSpans.every(([a, b]) => to < a || from > b);

  if (node.kind === "gate") {
    const GATE_TO_IC: Record<string, string> = {
      and: "7408",
      or: "7432",
      not: "7404",
      nand: "7400",
      nor: "7402",
      xor: "7486",
      xnor: "74266",
    };
    const part = GATE_TO_IC[node.op] ?? "7408";
    const icNode: CircuitNode = {
      id: node.id,
      kind: "ic",
      part,
      label: part,
      pos: { x: 0, y: 0 },
    };
    const span = pinsOf(icNode).length / 2;
    for (let col = 2; col + span - 1 <= spec.columns; col++) {
      if (clearOfChips(col, col + span - 1)) return { ...icNode, pos: { x: col, y: 0 } };
    }
    return null;
  }

  if (node.kind === "ic") {
    const span = pinsOf(node).length / 2;
    for (let col = 2; col + span - 1 <= spec.columns; col++) {
      if (clearOfChips(col, col + span - 1)) return { ...node, pos: { x: col, y: 0 } };
    }
    return null;
  }

  // Switches, clocks, LEDs, and rails reside in the trainer panels and are not seated onto breadboard strips (LAB-03)
  const next = { ...node, pos: { x: 0, y: 0 } };
  delete (next as { boardRow?: unknown }).boardRow;
  return next;
}

/**
 * Convert or synchronize a breadboard circuit back into a schematic document.
 *
 * Guarantees:
 * 1. Switch and clock active states (`state: 0 | 1`) are retained from the breadboard.
 * 2. Power rails (+5V / GND) and IC power connections (VCC / GND) are preserved into
 *    the schematic so chips remain powered without UNPOWERED_IC diagnostics or power resets.
 * 3. All components currently on the board are retained; authored schematic positions
 *    from `schematicDoc` are preserved, while newly added breadboard parts are assigned
 *    clean, non-overlapping canvas positions.
 * 4. Netlist connectivity established by jumpers and strips is preserved as pin-to-pin
 *    schematic wires. Existing schematic wires are kept if their pins remain shorted.
 * 5. If `schematicDoc` is null, derives a valid schematic layout and wiring from scratch.
 */
export function breadboardToSchematic(
  boardDoc: CircuitDocument,
  schematicDoc?: CircuitDocument | null,
): CircuitDocument {
  if (!boardDoc.board) return boardDoc;

  const snap8 = (v: number) => Math.round(v / 8) * 8;

  // 1. Synchronize Nodes
  const schematicNodes = schematicDoc && !schematicDoc.board ? schematicDoc.nodes : {};
  const resultNodes: Record<string, CircuitNode> = {};

  const unplacedInputs: CircuitNode[] = [];
  const unplacedOutputs: CircuitNode[] = [];
  const unplacedRails: CircuitNode[] = [];
  const unplacedLogic: CircuitNode[] = [];

  for (const [id, node] of Object.entries(boardDoc.nodes)) {
    const baseNode: CircuitNode = { ...node };
    delete (baseNode as { boardRow?: unknown }).boardRow;

    const sNode = schematicNodes[id];
    if (sNode) {
      resultNodes[id] = {
        ...baseNode,
        pos: sNode.pos,
        ...(sNode.rotation !== undefined ? { rotation: sNode.rotation } : {}),
        ...(sNode.flipX !== undefined ? { flipX: sNode.flipX } : {}),
        ...(sNode.flipY !== undefined ? { flipY: sNode.flipY } : {}),
        ...(node.kind === "switch" || node.kind === "clock" ? { state: node.state } : {}),
      };
    } else {
      if (node.kind === "switch" || node.kind === "clock") {
        unplacedInputs.push(baseNode);
      } else if (node.kind === "led") {
        unplacedOutputs.push(baseNode);
      } else if (node.kind === "rail") {
        unplacedRails.push(baseNode);
      } else {
        unplacedLogic.push(baseNode);
      }
    }
  }

  // Place unplaced inputs (switches, clocks) on the left (x = 40)
  const inputNodes = Object.values(resultNodes).filter(
    (n) => n.kind === "switch" || n.kind === "clock",
  );
  let nextInputY =
    inputNodes.length > 0
      ? Math.max(...inputNodes.map((n) => n.pos.y)) + 72
      : 64;
  for (const node of unplacedInputs) {
    resultNodes[node.id] = {
      ...node,
      pos: { x: 40, y: snap8(nextInputY) },
    };
    nextInputY += 72;
  }

  // Place unplaced rails (+5V, GND) at top
  const railNodes = Object.values(resultNodes).filter((n) => n.kind === "rail");
  let nextRailX =
    railNodes.length > 0
      ? Math.max(...railNodes.map((n) => n.pos.x)) + 80
      : 240;
  for (const node of unplacedRails) {
    resultNodes[node.id] = {
      ...node,
      pos: { x: snap8(nextRailX), y: 32 },
    };
    nextRailX += 80;
  }

  // Place unplaced logic (ICs, gates) in center
  const logicNodes = Object.values(resultNodes).filter(
    (n) => n.kind === "ic" || n.kind === "gate",
  );
  let logicCount = logicNodes.length;
  for (const node of unplacedLogic) {
    const col = logicCount % 2;
    const row = Math.floor(logicCount / 2);
    const x = snap8(224 + col * 240);
    const y = snap8(120 + row * 168);
    resultNodes[node.id] = {
      ...node,
      pos: { x, y },
    };
    logicCount++;
  }

  // Place unplaced outputs (LEDs) on right
  const allCurrentNodes = Object.values(resultNodes);
  const maxX =
    allCurrentNodes.length > 0
      ? Math.max(...allCurrentNodes.map((n) => n.pos.x))
      : 500;
  const ledX = snap8(Math.max(680, maxX + 160));
  const existingLeds = Object.values(resultNodes).filter((n) => n.kind === "led");
  let nextLedY =
    existingLeds.length > 0
      ? Math.max(...existingLeds.map((n) => n.pos.y)) + 72
      : 64;
  for (const node of unplacedOutputs) {
    resultNodes[node.id] = {
      ...node,
      pos: { x: ledX, y: snap8(nextLedY) },
    };
    nextLedY += 72;
  }

  // 2. Netlist & Wires
  const netIndex = buildNetIndex(boardDoc, pinsOf);

  const parent = new Map<string, string>();
  const addPin = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };
  const findPin = (k: string): string => {
    let root = k;
    while (parent.get(root) && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let cur = k;
    while (parent.get(cur) && parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const unionPins = (a: string, b: string) => {
    addPin(a);
    addPin(b);
    const ra = findPin(a);
    const rb = findPin(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const resultWires: Record<string, Wire> = {};
  const existingIds = new Set<string>();

  // Preserve existing schematic wires if both pins are still shorted on the board
  if (schematicDoc && !schematicDoc.board && schematicDoc.wires) {
    for (const wire of Object.values(schematicDoc.wires)) {
      if (wire.a.kind !== "pin" || wire.b.kind !== "pin") continue;
      const refA = wire.a.ref;
      const refB = wire.b.ref;
      if (!resultNodes[refA.node] || !resultNodes[refB.node]) continue;

      const keyA = pinKey(refA);
      const keyB = pinKey(refB);
      const netA = netIndex.netOfPin.get(keyA);
      const netB = netIndex.netOfPin.get(keyB);

      if (netA !== undefined && netA === netB) {
        resultWires[wire.id] = wire;
        existingIds.add(wire.id);
        unionPins(keyA, keyB);
      }
    }
  }

  let wireCounter = 1;
  const genWireId = (): WireId => {
    while (existingIds.has(`w_s${wireCounter}`)) {
      wireCounter++;
    }
    const id = asWireId(`w_s${wireCounter++}`);
    existingIds.add(id);
    return id;
  };

  // Add missing wires for all nets on the breadboard
  for (const net of netIndex.nets) {
    const validPins = net.pins.filter((p) => {
      const node = resultNodes[p.node];
      if (!node) return false;
      return pinsOf(node).some((spec) => spec.name === p.pin);
    });

    if (validPins.length < 2) continue;

    for (const p of validPins) {
      addPin(pinKey(p));
    }

    const compMap = new Map<string, PinRef[]>();
    for (const p of validPins) {
      const root = findPin(pinKey(p));
      const list = compMap.get(root);
      if (list) list.push(p);
      else compMap.set(root, [p]);
    }

    if (compMap.size <= 1) continue;

    // Pick anchor pin
    let anchorPin: PinRef | null = null;
    if (net.kind === "vcc") {
      anchorPin =
        validPins.find(
          (p) =>
            resultNodes[p.node]?.kind === "rail" &&
            (resultNodes[p.node] as RailNode).rail === "vcc",
        ) ?? null;
    } else if (net.kind === "gnd") {
      anchorPin =
        validPins.find(
          (p) =>
            resultNodes[p.node]?.kind === "rail" &&
            (resultNodes[p.node] as RailNode).rail === "gnd",
        ) ?? null;
    }

    if (!anchorPin) {
      anchorPin =
        validPins.find((p) => {
          const spec = pinsOf(resultNodes[p.node]!).find((s) => s.name === p.pin);
          return spec?.dir === "out" || spec?.dir === "pwr" || spec?.dir === "gnd";
        }) ?? validPins[0]!;
    }

    const anchorKey = pinKey(anchorPin);
    const anchorRoot = findPin(anchorKey);

    let netColor: string | undefined = undefined;
    if (net.kind === "vcc" || anchorPin.pin === "VCC") {
      netColor = "#ef4444";
    } else if (net.kind === "gnd" || anchorPin.pin === "GND") {
      netColor = "#3b82f6";
    } else if (resultNodes[anchorPin.node]?.kind === "clock") {
      netColor = "#f59e0b";
    }

    for (const [compRoot, pinsInComp] of compMap.entries()) {
      if (compRoot === anchorRoot) continue;

      const targetPin =
        pinsInComp.find((p) => {
          const spec = pinsOf(resultNodes[p.node]!).find((s) => s.name === p.pin);
          return spec?.dir === "in";
        }) ?? pinsInComp[0]!;

      const wireId = genWireId();
      resultWires[wireId] = {
        id: wireId,
        a: pinEnd(anchorPin),
        b: pinEnd(targetPin),
        ...(netColor ? { color: netColor } : {}),
      };

      unionPins(anchorKey, pinKey(targetPin));
    }
  }

  return {
    nodes: resultNodes,
    wires: resultWires,
    board: null,
  };
}
