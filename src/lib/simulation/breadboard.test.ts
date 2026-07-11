import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD,
  allHoles,
  dipFits,
  dipHoles,
  holeAt,
  holeKey,
  holePoint,
  inBounds,
  isPositiveRail,
  isRail,
  parseHoleKey,
  sameStrip,
  stripOf,
  type HoleRef,
} from "./breadboard";
import { buildNetIndex, endpointKey, holeEnd, pinKey } from "./netlist";
import { pinsOf } from "./parts";
import { elaborate } from "./elaborate";
import { evaluate } from "./solver";
import { diagnose } from "./diagnostics";
import { L0, L1, LZ, type Logic } from "./logic";
import { circuit, ref } from "./testing/build";
import type { CircuitDocument } from "./netlist";

const B = DEFAULT_BOARD;
const h = (col: number, row: HoleRef["row"]): HoleRef => ({ col, row });

describe("strips — the three facts that make a breadboard a breadboard", () => {
  it("shorts A–E within a column", () => {
    expect(sameStrip(B, h(5, "A"), h(5, "C"))).toBe(true);
    expect(sameStrip(B, h(5, "A"), h(5, "E"))).toBe(true);
  });

  it("shorts F–J within a column, separately", () => {
    expect(sameStrip(B, h(5, "F"), h(5, "J"))).toBe(true);
  });

  /**
   * THE CENTRE CHANNEL. A–E and F–J are NOT connected, and that gap is the whole
   * point of the board: a DIP straddles it, so its left-hand pins and right-hand
   * pins land on DIFFERENT strips. Short the channel and every gate on the chip is
   * wired input-to-output.
   */
  it("does NOT short across the centre channel", () => {
    expect(sameStrip(B, h(5, "E"), h(5, "F"))).toBe(false);
    expect(sameStrip(B, h(5, "A"), h(5, "J"))).toBe(false);
  });

  it("does not short one column to the next", () => {
    expect(sameStrip(B, h(5, "A"), h(6, "A"))).toBe(false);
  });

  /**
   * Real boards BREAK their power rails at the midpoint. A simulator that models a
   * rail as one continuous net produces a circuit that works on screen and does
   * nothing on the bench — which is exactly the class of lie this app exists to
   * stop telling.
   */
  it("breaks the power rails at the midpoint", () => {
    const small = { columns: 30, railSegments: 2 };
    expect(sameStrip(small, h(1, "+top"), h(14, "+top"))).toBe(true);
    expect(sameStrip(small, h(1, "+top"), h(16, "+top"))).toBe(false);

    // …and on the real 63-column board the break is past column 32.
    expect(sameStrip(B, h(1, "+top"), h(32, "+top"))).toBe(true);
    expect(sameStrip(B, h(1, "+top"), h(33, "+top"))).toBe(false);
  });

  it("keeps + and - rails apart, and top from bottom", () => {
    expect(sameStrip(B, h(1, "+top"), h(1, "-top"))).toBe(false);
    expect(sameStrip(B, h(1, "+top"), h(1, "+bottom"))).toBe(false);
  });

  it("gives every strip a distinct id", () => {
    expect(stripOf(B, h(5, "A"))).not.toBe(stripOf(B, h(5, "F")));
  });
});

describe("DIP seating", () => {
  /**
   * A DIP straddles the channel: pins 1..7 in row E, pins 8..14 in row F running
   * back the other way — which is the counter-clockwise numbering printed on the
   * package. Pin 8 ends up directly across from pin 7, and pin 14 across from
   * pin 1, which is why Vcc and GND sit at opposite corners.
   */
  it("puts pins 1–7 in row E and 8–14 in row F, counter-clockwise", () => {
    const holes = dipHoles({ col: 10 }, 14);

    expect(holes[0]).toEqual(h(10, "E")); // pin 1
    expect(holes[6]).toEqual(h(16, "E")); // pin 7  (GND)
    expect(holes[7]).toEqual(h(16, "F")); // pin 8  — across from pin 7
    expect(holes[13]).toEqual(h(10, "F")); // pin 14 (Vcc) — across from pin 1
  });

  it("lands each side of the chip on a DIFFERENT strip", () => {
    const holes = dipHoles({ col: 10 }, 14);
    const pin1 = holes[0]!;
    const pin14 = holes[13]!;
    // Same column, opposite sides of the channel. If these shorted, Vcc would be
    // wired to pin 1 and the chip would be destroyed.
    expect(pin1.col).toBe(pin14.col);
    expect(sameStrip(B, pin1, pin14)).toBe(false);
  });

  it("knows when a chip runs off the end of the board", () => {
    expect(dipFits(B, { col: 50 }, 14)).toBe(true);
    expect(dipFits(B, { col: 60 }, 14)).toBe(false); // needs cols 60–66, board is 63
  });
});

describe("helpers", () => {
  it("enumerates every hole on the board exactly once", () => {
    const small = { columns: 4, railSegments: 2 };
    const holes = allHoles(small);
    // 4 columns x (10 terminal rows + 4 rail rows) = 56.
    expect(holes).toHaveLength(4 * 14);
    expect(new Set(holes.map(holeKey)).size).toBe(holes.length);
  });

  it("round-trips a hole key", () => {
    expect(parseHoleKey(holeKey(h(7, "C")))).toEqual(h(7, "C"));
    expect(parseHoleKey("nonsense")).toBeNull();
  });

  it("knows what is on the board", () => {
    expect(inBounds(B, h(1, "A"))).toBe(true);
    expect(inBounds(B, h(63, "A"))).toBe(true);
    expect(inBounds(B, h(64, "A"))).toBe(false);
    expect(inBounds(B, h(0, "A"))).toBe(false);
  });

  it("identifies rails", () => {
    expect(isRail("+top")).toBe(true);
    expect(isRail("A")).toBe(false);
    expect(isPositiveRail("+bottom")).toBe(true);
    expect(isPositiveRail("-bottom")).toBe(false);
  });
});

describe("hole geometry", () => {
  it("round-trips a hole to a point and back", () => {
    for (const hole of [h(1, "A"), h(15, "J"), h(30, "+top"), h(7, "-bottom")]) {
      const p = holePoint(hole);
      expect(holeAt(B, p.x, p.y)).toEqual(hole);
    }
  });

  it("returns null off the board", () => {
    expect(holeAt(B, -100, -100)).toBeNull();
  });

  it("opens a visible gap at the centre channel", () => {
    const e = holePoint(h(1, "E")).y;
    const f = holePoint(h(1, "F")).y;
    const d = holePoint(h(1, "D")).y;
    // E to F is a bigger jump than D to E — that gap IS the channel.
    expect(Math.abs(e - f)).toBeGreaterThan(Math.abs(e - d));
  });

  /**
   * REGRESSION. Rows E and F must be the two rows FLANKING the channel, because a
   * DIP's pins sit in exactly those two and the distance between them IS the
   * 0.3-inch package width.
   *
   * Ordering the lower half A..E downward instead puts row A beside the channel,
   * and every chip renders seven rows tall — which is what it did.
   */
  it("puts E and F on either side of the channel, one DIP-width apart", () => {
    const spanEF = Math.abs(holePoint(h(1, "E")).y - holePoint(h(1, "F")).y);

    // Nothing is closer to row F than row E is.
    for (const row of ["A", "B", "C", "D"] as const) {
      const span = Math.abs(holePoint(h(1, row)).y - holePoint(h(1, "F")).y);
      expect(span, `${row} is closer to F than E is`).toBeGreaterThan(spanEF);
    }
    // Nothing on the upper half is closer to row E than row F is.
    for (const row of ["G", "H", "I", "J"] as const) {
      const span = Math.abs(holePoint(h(1, row)).y - holePoint(h(1, "E")).y);
      expect(span, `${row} is closer to E than F is`).toBeGreaterThan(spanEF);
    }
  });
});

// ---------------------------------------------------------------------------
// The integration: a board is just more endpoints in the same union-find.
// ---------------------------------------------------------------------------

const run = (doc: CircuitDocument, inputs: (0 | 1)[] = []) => {
  const { index, netlist } = elaborate(doc);
  const state = evaluate(netlist, inputs);
  const diagnostics = diagnose(doc, index, netlist, state);

  const atPin = (node: string, pin: string): Logic => {
    const id = index.netOfPin.get(pinKey(ref(node, pin)));
    if (id === undefined) throw new Error(`no pin ${node}.${pin}`);
    return state.values[index.ordinalOf.get(id) as number] as Logic;
  };
  const atHole = (col: number, row: HoleRef["row"]): Logic => {
    const id = index.netOfEndpoint.get(endpointKey(holeEnd(h(col, row))));
    if (id === undefined) throw new Error(`no hole ${col}${row}`);
    return state.values[index.ordinalOf.get(id) as number] as Logic;
  };

  return { index, state, diagnostics, atPin, atHole };
};

describe("nets on a breadboard", () => {
  it("makes every hole in a column strip one net", () => {
    const doc = circuit().board().build();
    const index = buildNetIndex(doc, pinsOf);

    const a = index.netOfEndpoint.get(endpointKey(holeEnd(h(5, "A"))));
    const c = index.netOfEndpoint.get(endpointKey(holeEnd(h(5, "C"))));
    const f = index.netOfEndpoint.get(endpointKey(holeEnd(h(5, "F"))));

    expect(a).toBe(c);
    expect(a).not.toBe(f); // the channel
  });

  /**
   * The demonstration that Invariant 1 paid off. A seated chip's pins are shorted
   * to whatever else is in their holes — and NOTHING in the solver, the
   * diagnostics, or the verification bridge had to change to make that work.
   */
  it("shorts a seated chip's pin to everything else in its hole's strip", () => {
    const doc = circuit().board().ic("U1", "7408").seat("U1", 10, "E").build();
    const index = buildNetIndex(doc, pinsOf);

    // Pin 1 lands in hole 10E, so it is on the 10-lower strip, along with 10A–10D.
    const pin1 = index.netOfPin.get(pinKey(ref("U1", "1A")));
    const hole10a = index.netOfEndpoint.get(endpointKey(holeEnd(h(10, "A"))));
    expect(pin1).toBe(hole10a);

    // …and pin 14 (Vcc) is across the channel, on a DIFFERENT net.
    const pin14 = index.netOfPin.get(pinKey(ref("U1", "VCC")));
    expect(pin14).not.toBe(pin1);
  });

  it("powers a chip through the rails, exactly as on a real board", () => {
    // Seat a 7408 at column 10. Pin 14 (Vcc) is at 10F, pin 7 (GND) at 16E.
    const doc = circuit()
      .board()
      .ic("U1", "7408")
      .seat("U1", 10, "E")
      .rail("V1", "vcc")
      .seat("V1", 1, "+top")
      .rail("G0", "gnd")
      .seat("G0", 1, "-top")
      // Jumper the rails to the chip's power holes.
      .jumper(2, "+top", 10, "F") // +5V -> pin 14
      .jumper(2, "-top", 16, "E") // GND -> pin 7
      .build();

    const { diagnostics, atPin } = run(doc);
    expect(diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toEqual([]);
    expect(atPin("U1", "VCC")).toBe(L1);
    expect(atPin("U1", "GND")).toBe(L0);
  });

  /**
   * THE MISTAKE THE SPLIT RAIL EXISTS TO CATCH. The chip is powered from the LEFT
   * half of the + rail, but the jumper is in the RIGHT half — which on a real
   * board is a different piece of metal. The chip gets nothing.
   */
  it("does NOT power a chip across a rail break", () => {
    const doc = circuit()
      .board()
      .ic("U1", "7408")
      .seat("U1", 10, "E")
      .rail("V1", "vcc")
      .seat("V1", 45, "+top") // right-hand rail segment, past the break
      .rail("G0", "gnd")
      .seat("G0", 45, "-top")
      .jumper(2, "+top", 10, "F") // jumper taken from the LEFT segment
      .jumper(2, "-top", 16, "E")
      .build();

    const { diagnostics } = run(doc);
    expect(diagnostics.map((d) => d.code)).toContain("UNPOWERED_IC");
  });

  it("computes AND on a chip wired up entirely through holes", () => {
    const doc = circuit()
      .board()
      .ic("U1", "7408")
      .seat("U1", 10, "E")
      .rail("V1", "vcc")
      .seat("V1", 1, "+top")
      .rail("G0", "gnd")
      .seat("G0", 1, "-top")
      .jumper(2, "+top", 10, "F") // pin 14 -> +5V
      .jumper(2, "-top", 16, "E") // pin 7  -> GND
      .switch("A")
      .seat("A", 3, "A")
      .switch("B")
      .seat("B", 5, "A")
      .led("Q")
      .seat("Q", 7, "A")
      .jumper(3, "B", 10, "A") // switch A -> pin 1 (10E strip)
      .jumper(5, "B", 11, "A") // switch B -> pin 2 (11E strip)
      .jumper(12, "A", 7, "B") // pin 3 (out) -> LED
      .build();

    const table: [[0 | 1, 0 | 1], Logic][] = [
      [[0, 0], L0],
      [[0, 1], L0],
      [[1, 0], L0],
      [[1, 1], L1],
    ];
    for (const [inputs, want] of table) {
      const { atPin } = run(doc, inputs);
      expect(atPin("Q", "A"), `A=${inputs[0]} B=${inputs[1]}`).toBe(want);
    }
  });

  it("still floats an unwired hole — a bare strip is not a 0", () => {
    const doc = circuit().board().build();
    const { atHole } = run(doc);
    expect(atHole(20, "C")).toBe(LZ);
  });
});
