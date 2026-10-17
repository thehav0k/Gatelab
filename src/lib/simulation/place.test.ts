import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { placeOnBreadboard, seatOnBoard, stripOfPin, breadboardToSchematic } from "./place";
import { realize, synthesize, technologyMap, type Strategy } from "./synth";
import { verify } from "./verify";
import { elaborate } from "./elaborate";
import { evaluate, initialState } from "./solver";
import { diagnose } from "./diagnostics";
import { dipHoles, stripOf, DEFAULT_BOARD } from "./breadboard";
import { pinsOf } from "./parts";
import { parseInput } from "@/lib/core-engine/canonical";
import { minimize } from "@/lib/core-engine/minimizer";
import { arbFunction } from "@/lib/core-engine/testing/arbitraries";
import type { BooleanFunction } from "@/lib/core-engine/types";
import { circuit } from "./testing/build";
import { asNodeId, type CircuitDocument, type CircuitNode } from "./netlist";
import { getSequentialPreset } from "./sequential-presets";

const fnOf = (src: string): BooleanFunction => {
  const r = parseInput(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => d.message).join("; "));
  return r.value;
};

/** Synthesize a function, then seat it on a real board. */
const board = (fn: BooleanFunction, strategy: Strategy = "mixed"): CircuitDocument =>
  placeOnBreadboard(
    realize(technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), strategy)),
  ).doc;

describe("placeOnBreadboard", () => {
  it("seats the chips straddling the centre channel", () => {
    const doc = board(fnOf("F(A,B,C) = A'B + BC"));
    const ics = Object.values(doc.nodes).filter((n) => n.kind === "ic");
    expect(ics.length).toBeGreaterThan(0);

    for (const ic of ics) {
      const holes = dipHoles({ col: Math.round(ic.pos.x) }, pinsOf(ic).length);
      const lower = holes.slice(0, 7);
      const upper = holes.slice(7);
      expect(lower.every((h) => h.row === "E"), ic.label).toBe(true);
      expect(upper.every((h) => h.row === "F"), ic.label).toBe(true);
    }
  });

  /**
   * THE PHYSICAL RULE. A chip's leg is IN a hole, so a jumper cannot also be in
   * that hole — it has to use one of the other four on the same strip. Break this
   * and you have drawn a picture of a breadboard, not modelled one: the
   * simulation would pass and the student could not build the thing.
   */
  it("never plugs a jumper into a hole a chip's leg already occupies", () => {
    const doc = board(fnOf("F(A,B,C) = A'B + BC"));

    const legs = new Set<string>();
    for (const node of Object.values(doc.nodes)) {
      if (node.kind !== "ic") continue;
      for (const h of dipHoles({ col: Math.round(node.pos.x) }, pinsOf(node).length)) {
        legs.add(`${h.col}/${h.row}`);
      }
    }

    for (const wire of Object.values(doc.wires)) {
      for (const end of [wire.a, wire.b]) {
        if (end.kind !== "hole") continue;
        expect(
          legs.has(`${end.ref.col}/${end.ref.row}`),
          `jumper ${wire.id} shares a hole with a chip leg`,
        ).toBe(false);
      }
    }
  });

  it("still lands each jumper on the RIGHT strip", () => {
    // The jumper must be electrically where the leg is, just not in the same hole.
    const doc = board(fnOf("F(A,B) = A*B"));
    const spec = DEFAULT_BOARD;

    // Every wire is hole-to-hole on a placed board.
    for (const wire of Object.values(doc.wires)) {
      expect(wire.a.kind).toBe("hole");
      expect(wire.b.kind).toBe("hole");
    }

    // And each chip's Vcc leg shares a strip with something that reaches a rail.
    const ic = Object.values(doc.nodes).find((n) => n.kind === "ic")!;
    const holes = dipHoles({ col: Math.round(ic.pos.x) }, pinsOf(ic).length);
    const vccLeg = holes[13]!; // pin 14
    const vccStrip = stripOf(spec, vccLeg);

    const touches = Object.values(doc.wires).some((w) =>
      [w.a, w.b].some((e) => e.kind === "hole" && stripOf(spec, e.ref) === vccStrip),
    );
    expect(touches).toBe(true);
  });

  it("builds a board with no faults", () => {
    const doc = board(fnOf("F(A,B,C) = A'B + BC"));
    const { index, netlist } = elaborate(doc);
    const state = evaluate(netlist, netlist.inputs.map(() => 0 as const));
    const errors = diagnose(doc, index, netlist, state).filter(
      (d) => d.severity === "error",
    );
    expect(errors.map((e) => e.message)).toEqual([]);
  });
});

describe("when it does not fit", () => {
  /**
   * A part seated past the last column is not "somewhere off to the right" — it is
   * NOWHERE. Reporting it matters: a silently off-board part presents as a
   * mysterious dead output, which is precisely the kind of lie this app exists to
   * stop telling.
   */
  it("reports parts that run off the end of a small board", () => {
    const fn = fnOf("F(A,B,C,D) = Σm(1,3,7,11,15)");
    const schematic = realize(
      technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), "mixed"),
    );

    const tiny = { columns: 12, railSegments: 2 };
    const { unplaced } = placeOnBreadboard(schematic, tiny);
    expect(unplaced.length).toBeGreaterThan(0);
  });

  it("keeps a chip that does fit, even when a later one does not", () => {
    const fn = fnOf("F(A,B,C,D) = Σm(1,3,7,11,15)");
    const schematic = realize(
      technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), "mixed"),
    );

    const { doc, unplaced } = placeOnBreadboard(schematic, {
      columns: 14,
      railSegments: 2,
    });
    const seated = Object.values(doc.nodes).filter((n) => n.kind === "ic");
    expect(seated.length).toBeGreaterThan(0);
    expect(unplaced.length).toBeGreaterThan(0);
  });
});

describe("stripOfPin", () => {
  it("names the strip a chip's pin is plugged into", () => {
    const doc = board(fnOf("F(A,B) = A*B"));
    const ic = Object.values(doc.nodes).find((n) => n.kind === "ic")!;

    const vcc = stripOfPin(doc, { node: ic.id, pin: "VCC" });
    const pin1 = stripOfPin(doc, { node: ic.id, pin: "1A" });

    expect(vcc).not.toBeNull();
    // Vcc is across the channel from pin 1, so a DIFFERENT strip.
    expect(vcc).not.toBe(pin1);
  });

  it("names the strip a seated switch is in", () => {
    const doc = board(fnOf("F(A,B) = A*B"));
    const sw = Object.values(doc.nodes).find((n) => n.kind === "switch")!;
    expect(stripOfPin(doc, { node: sw.id, pin: "Y" })).not.toBeNull();
  });

  it("returns null off a board, or for a pin that does not exist", () => {
    const schematic = realize(
      technologyMap(synthesize(minimize(fnOf("F(A,B) = A*B"), "sop").expression, ["A", "B"]), "mixed"),
    );
    const ic = Object.values(schematic.nodes).find((n) => n.kind === "ic")!;
    // No board: nothing is plugged into anything.
    expect(stripOfPin(schematic, { node: ic.id, pin: "VCC" })).toBeNull();

    const placed = board(fnOf("F(A,B) = A*B"));
    const placedIc = Object.values(placed.nodes).find((n) => n.kind === "ic")!;
    expect(stripOfPin(placed, { node: placedIc.id, pin: "NOPE" })).toBeNull();
  });
});

describe("the placed board is the same circuit", () => {
  /**
   * THE ACCEPTANCE GATE. A board seated from a synthesized design must verify
   * against the ORIGINAL ALGEBRA — through five holes of shorted metal, a split
   * power rail, and a chip straddling the centre channel.
   *
   * Nothing in the solver, the diagnostics, or the verification bridge changed to
   * make this work. That is Invariant 1 paying for itself.
   */
  it.each(["mixed", "nand-only", "nor-only"] as const)(
    "a %s board verifies against the function it was built from",
    (strategy) => {
      for (const src of ["F(A,B) = A*B", "F(A,B,C) = A'B + BC", "F(A,B) = A ^ B"]) {
        const fn = fnOf(src);
        const result = verify(board(fn, strategy), fn);
        expect(result.error, `${src} / ${strategy}`).toBeNull();
        expect(result.ok, `${src} / ${strategy}`).toBe(true);
      }
    },
  );

  it("verifies over random functions", () => {
    fc.assert(
      fc.property(arbFunction({ minVars: 1, maxVars: 3 }), (fn) => {
        if (minimize(fn, "sop").trace.degenerate) return;
        const result = verify(board(fn), fn);
        expect(result.error).toBeNull();
        expect(result.ok, JSON.stringify(result.mismatches)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it("gives the same truth table as the schematic it came from", () => {
    const fn = fnOf("F(A,B,C) = A'B + BC");
    const schematic = realize(
      technologyMap(synthesize(minimize(fn, "sop").expression, fn.variables), "mixed"),
    );
    const placed = placeOnBreadboard(schematic).doc;

    const rowsOf = (doc: CircuitDocument) =>
      verify(doc, fn).rows.map((r) => r.actual);

    expect(rowsOf(placed)).toEqual(rowsOf(schematic));
  });
});


describe("seating a part onto a board that is already built", () => {
  /** A board with one 7486 on it, seated the normal way. */
  const seated = (): CircuitDocument => {
    const built = circuit().ic("U1", "7486").build();
    return placeOnBreadboard(built).doc;
  };

  const node = (over: Partial<CircuitNode> & Pick<CircuitNode, "kind">) =>
    ({ id: "new", label: "X", pos: { x: 420, y: 260 }, ...over }) as CircuitNode;

  it("gives a chip real board columns instead of its schematic pixels", () => {
    // THE BUG THIS EXISTS FOR: clicking 7400 in the palette while the board was
    // on screen added the chip with `pos.x = 420` still on it — a pixel offset
    // read as a column, so the renderer drew it at column 420 of a 63-column
    // board. The part was in the netlist, raised faults, and was nowhere to be
    // seen.
    const doc = seated();
    const placed = seatOnBoard(doc, node({ kind: "ic", part: "7400" }), DEFAULT_BOARD);
    expect(placed).not.toBeNull();
    expect(placed!.pos.x).toBeGreaterThanOrEqual(1);
    expect(placed!.pos.x).toBeLessThanOrEqual(DEFAULT_BOARD.columns);
  });

  it("does not seat a chip on top of one already there", () => {
    const doc = seated();
    const existing = Object.values(doc.nodes).find((n) => n.kind === "ic")!;
    const span = pinsOf(existing).length / 2;
    const placed = seatOnBoard(doc, node({ kind: "ic", part: "7400" }), DEFAULT_BOARD)!;
    const newSpan = 7;
    const a = [existing.pos.x, existing.pos.x + span - 1];
    const b = [placed.pos.x, placed.pos.x + newSpan - 1];
    expect(b[1]! < a[0]! || b[0]! > a[1]!).toBe(true);
  });

  it("keeps switches and LEDs off the breadboard strips (in trainer panel)", () => {
    const doc = seated();
    const sw = seatOnBoard(doc, node({ kind: "switch", state: 0 }), DEFAULT_BOARD)!;
    const led = seatOnBoard(doc, node({ kind: "led" }), DEFAULT_BOARD)!;
    expect(sw.boardRow).toBeUndefined();
    expect(led.boardRow).toBeUndefined();
    expect(sw.pos).toEqual({ x: 0, y: 0 });
    expect(led.pos).toEqual({ x: 0, y: 0 });
  });

  it("refuses rather than putting a chip off the end of the board", () => {
    const tiny = { ...DEFAULT_BOARD, columns: 4 };
    const doc = placeOnBreadboard(circuit().ic("U1", "7486").build(), tiny).doc;
    expect(seatOnBoard(doc, node({ kind: "ic", part: "7400" }), tiny)).toBeNull();
  });

  it("seats a gate primitive onto the board by mapping it to its 74xx IC", () => {
    const doc = seated();
    const andGate = seatOnBoard(doc, node({ kind: "gate", op: "and", arity: 2 }), DEFAULT_BOARD)!;
    expect(andGate).not.toBeNull();
    expect(andGate.kind).toBe("ic");
    expect((andGate as Extract<CircuitNode, { kind: "ic" }>).part).toBe("7408");
    expect(andGate.pos.x).toBeGreaterThan(0);

    const tiny = { ...DEFAULT_BOARD, columns: 4 };
    expect(seatOnBoard(doc, node({ kind: "gate", op: "or", arity: 2 }), tiny)).toBeNull();
  });

  describe("panelMode", () => {
    it("does not create power rails or power jumpers by default without autoPower", () => {
      const doc = circuit().ic("U1", "7400").build();
      const { doc: placed } = placeOnBreadboard(doc, DEFAULT_BOARD, { panelMode: true });
      const { index, netlist } = elaborate(placed);
      const st = evaluate(netlist, netlist.inputs.map(() => 0 as const));
      const unpowered = diagnose(placed, index, netlist, st).filter((d) => d.code === "UNPOWERED_IC");
      expect(unpowered).toHaveLength(1);
      // No rail jumpers
      const railWires = Object.values(placed.wires).filter(
        (w) =>
          (w.a.kind === "hole" && (w.a.ref.row.startsWith("+") || w.a.ref.row.startsWith("-"))) ||
          (w.b.kind === "hole" && (w.b.ref.row.startsWith("+") || w.b.ref.row.startsWith("-"))),
      );
      expect(railWires).toHaveLength(0);
    });

    it("wires breadboard rails to VCC and GND without proxy switch/LED on-board holes", () => {
      const schematic = realize(
        technologyMap(
          synthesize(minimize(fnOf("F(A,B,C) = A'B + BC"), "sop").expression, ["A", "B", "C"]),
          "mixed",
        ),
      );
      const { doc } = placeOnBreadboard(schematic, DEFAULT_BOARD, { panelMode: true, autoPower: true });

      // No switches or LEDs should have boardRow set (they live in trainer panels)
      for (const n of Object.values(doc.nodes)) {
        if (n.kind === "switch" || n.kind === "led") {
          expect(n.boardRow).toBeUndefined();
        }
      }

      // Wires from switches and to LEDs connect via pinEnd
      const pinWires = Object.values(doc.wires).filter(
        (w) => w.a.kind === "pin" || w.b.kind === "pin",
      );
      expect(pinWires.length).toBeGreaterThan(0);

      // ICs are auto-powered
      const ics = Object.values(doc.nodes).filter((n) => n.kind === "ic");
      expect(ics.length).toBeGreaterThan(0);

      // Verify the circuit computes correctly and ICs are powered without UNPOWERED_IC faults
      const { index, netlist } = elaborate(doc);
      const state = evaluate(netlist, netlist.inputs.map(() => 0 as const));
      const unpowered = diagnose(doc, index, netlist, state).filter(
        (d) => d.code === "UNPOWERED_IC",
      );
      expect(unpowered).toHaveLength(0);
    });

    it("preserves VCC logic tie-off wires for sequential circuits on breadboard", () => {
      const doc = getSequentialPreset("ripple-2")!.build();
      const { doc: placed } = placeOnBreadboard(doc, DEFAULT_BOARD, { panelMode: true, autoPower: true });
      const { index, netlist } = elaborate(placed);
      const state = evaluate(netlist, netlist.inputs.map(() => 0 as const));
      const floating = diagnose(placed, index, netlist, state).filter(
        (d) => d.code === "FLOATING_INPUT",
      );
      expect(floating.map((f) => f.message)).toEqual([]);
    });

    it("simulates and counts correctly on a breadboard-seated sequential circuit", () => {
      const doc = getSequentialPreset("ripple-2")!.build();
      const { doc: placed } = placeOnBreadboard(doc, DEFAULT_BOARD, { panelMode: true, autoPower: true });
      const { netlist } = elaborate(placed);
      let state = initialState(netlist);
      const clrIdx = netlist.inputs.findIndex((p) => p.label === "CLR");
      const vector = (clr: number) =>
        netlist.inputs.map((_, i) => (i === clrIdx ? (clr as 0 | 1) : 0));

      // Reset first with CLR=0
      state = evaluate(netlist, vector(0), { state, clocks: netlist.clocks.map(() => 0) }).state;
      // Release CLR=1
      state = evaluate(netlist, vector(1), { state, clocks: netlist.clocks.map(() => 0) }).state;

      const readQ = (vals: Uint8Array) => {
        const q0 = vals[netlist.outputs.find((o) => o.label === "Q0")!.net];
        const q1 = vals[netlist.outputs.find((o) => o.label === "Q1")!.net];
        return `${q1}${q0}`;
      };

      const counts: string[] = [];
      for (let i = 0; i < 4; i++) {
        state = evaluate(netlist, vector(1), { state, clocks: netlist.clocks.map(() => 1) }).state;
        const res = evaluate(netlist, vector(1), { state, clocks: netlist.clocks.map(() => 0) });
        state = res.state;
        counts.push(readQ(res.values));
      }
      expect(counts).toEqual(["01", "10", "11", "00"]);
    });

    it("auto-powers 14-pin and 16-pin chips correctly without assuming corner pins (LAB-02)", () => {
      // 74LS76A has VCC on pin 5 (row E) and GND on pin 13 (row F)
      const doc76 = circuit().ic("U1", "74LS76A").build();
      const { doc: placed76 } = placeOnBreadboard(doc76, DEFAULT_BOARD, { panelMode: true, autoPower: true });
      const { index: idx76, netlist: nl76 } = elaborate(placed76);
      const st76 = evaluate(nl76, nl76.inputs.map(() => 0 as const));
      const unpowered76 = diagnose(placed76, idx76, nl76, st76).filter((d) => d.code === "UNPOWERED_IC");
      expect(unpowered76).toHaveLength(0);

      // Verify 14-pin 7400
      const doc00 = circuit().ic("U1", "7400").build();
      const { doc: placed00 } = placeOnBreadboard(doc00, DEFAULT_BOARD, { panelMode: true, autoPower: true });
      const { index: idx00, netlist: nl00 } = elaborate(placed00);
      const st00 = evaluate(nl00, nl00.inputs.map(() => 0 as const));
      const unpowered00 = diagnose(placed00, idx00, nl00, st00).filter((d) => d.code === "UNPOWERED_IC");
      expect(unpowered00).toHaveLength(0);

      // Verify 16-pin 74174 and 74175
      for (const part of ["74174", "74175"]) {
        const doc = circuit().ic("U1", part).build();
        const { doc: placed } = placeOnBreadboard(doc, DEFAULT_BOARD, { panelMode: true, autoPower: true });
        const { index, netlist } = elaborate(placed);
        const st = evaluate(netlist, netlist.inputs.map(() => 0 as const));
        const unpowered = diagnose(placed, index, netlist, st).filter((d) => d.code === "UNPOWERED_IC");
        expect(unpowered).toHaveLength(0);
      }
    });
  });
});

describe("breadboardToSchematic", () => {
  it("preserves switch and clock states from breadboard", () => {
    const schematic = circuit()
      .switch("sw1", 0)
      .clock("clk1", 0)
      .led("led1")
      .wire("sw1", "Q", "led1", "A")
      .build();

    const { doc: placed } = placeOnBreadboard(schematic, DEFAULT_BOARD, { panelMode: true });

    // Flip switch and clock on breadboard
    const modifiedBoard = {
      ...placed,
      nodes: {
        ...placed.nodes,
        sw1: { ...placed.nodes.sw1!, state: 1 as const },
        clk1: { ...placed.nodes.clk1!, state: 1 as const },
      },
    };

    const backToSchematic = breadboardToSchematic(modifiedBoard, schematic);
    const swNode = backToSchematic.nodes.sw1;
    expect(swNode?.kind).toBe("switch");
    if (swNode?.kind === "switch") expect(swNode.state).toBe(1);

    const clkNode = backToSchematic.nodes.clk1;
    expect(clkNode?.kind).toBe("clock");
    if (clkNode?.kind === "clock") expect(clkNode.state).toBe(1);
  });

  it("preserves power rails and IC power connections without UNPOWERED_IC faults", () => {
    const schematic = circuit().ic("U1", "7400").build();
    const { doc: placed } = placeOnBreadboard(schematic, DEFAULT_BOARD, {
      panelMode: true,
      autoPower: true,
    });

    const backToSchematic = breadboardToSchematic(placed, schematic);
    expect(backToSchematic.board).toBeNull();

    // Check power rails exist in schematic
    const rails = Object.values(backToSchematic.nodes).filter((n) => n.kind === "rail");
    expect(rails.length).toBeGreaterThanOrEqual(2);

    // Verify simulate & diagnose on the resulting schematic
    const { index, netlist } = elaborate(backToSchematic);
    const st = evaluate(netlist, netlist.inputs.map(() => 0 as const));
    const unpowered = diagnose(backToSchematic, index, netlist, st).filter(
      (d) => d.code === "UNPOWERED_IC",
    );
    expect(unpowered).toHaveLength(0);
  });

  it("retains authored schematic positions for existing components and places new ones cleanly", () => {
    const schematic = circuit()
      .switch("sw1", 0)
      .ic("U1", "7408")
      .build();

    // Author custom positions
    const authoredSchematic = {
      ...schematic,
      nodes: {
        ...schematic.nodes,
        sw1: { ...schematic.nodes.sw1!, pos: { x: 96, y: 128 } },
        U1: { ...schematic.nodes.U1!, pos: { x: 320, y: 192 } },
      },
    };

    const { doc: placed } = placeOnBreadboard(authoredSchematic, DEFAULT_BOARD, { panelMode: true });

    // Add a new LED while on breadboard
    const modifiedBoard = {
      ...placed,
      nodes: {
        ...placed.nodes,
        led_new: { id: asNodeId("led_new"), kind: "led" as const, label: "L1", pos: { x: 0, y: 0 } },
      },
    };

    const backToSchematic = breadboardToSchematic(modifiedBoard, authoredSchematic);
    expect(backToSchematic.nodes.sw1?.pos).toEqual({ x: 96, y: 128 });
    expect(backToSchematic.nodes.U1?.pos).toEqual({ x: 320, y: 192 });
    expect(backToSchematic.nodes.led_new?.pos.x).toBeGreaterThan(0);
    expect(backToSchematic.nodes.led_new?.pos.y).toBeGreaterThan(0);
  });

  it("derives a complete valid schematic when schematicDoc is null", () => {
    // Board built from scratch without a previous schematic
    const scratchDoc = circuit()
      .switch("A", 1)
      .ic("U1", "7408")
      .led("L0")
      .build();

    const { doc: placed } = placeOnBreadboard(scratchDoc, DEFAULT_BOARD, {
      panelMode: true,
      autoPower: true,
    });

    const derivedSchematic = breadboardToSchematic(placed, null);
    expect(derivedSchematic.board).toBeNull();
    expect(Object.keys(derivedSchematic.nodes)).toHaveLength(Object.keys(placed.nodes).length);
    expect(Object.keys(derivedSchematic.wires).length).toBeGreaterThan(0);

    const { index, netlist } = elaborate(derivedSchematic);
    const st = evaluate(netlist, netlist.inputs.map(() => 0 as const));
    const unpowered = diagnose(derivedSchematic, index, netlist, st).filter(
      (d) => d.code === "UNPOWERED_IC",
    );
    expect(unpowered).toHaveLength(0);
  });
});



