import { describe, it, expect, beforeEach } from "vitest";
import { useCircuitStore } from "./circuit-store";
import { asNodeId } from "../lib/simulation/netlist";
import { DEFAULT_BOARD } from "../lib/simulation/breadboard";

describe("autoWireAllIcPower and autoWireIcPower wire restoration", () => {
  beforeEach(() => {
    useCircuitStore.getState().clear();
  });

  const setupPoweredBoard = () => {
    const store = useCircuitStore.getState();
    const spec = DEFAULT_BOARD;
    const icId = asNodeId("ic1");

    store.load({
      nodes: {
        [icId]: {
          id: icId,
          kind: "ic",
          part: "7400",
          label: "U1",
          pos: { x: 14, y: 0 },
        },
      },
      wires: {},
      board: spec,
    });

    const initial = useCircuitStore.getState().autoWireAllIcPower();
    expect(initial.alreadyPowered).toBe(false);
    expect(useCircuitStore.getState().diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toHaveLength(0);
    return icId;
  };

  it("test deleting +5V socket feed wire (w3)", () => {
    setupPoweredBoard();
    const doc = useCircuitStore.getState().doc;
    const vccFeed = Object.values(doc.wires).find(
      (w) => w.a.kind === "pin" && w.a.ref.pin === "VCC",
    );
    expect(vccFeed).toBeDefined();

    // User deletes the +5V power feed wire
    useCircuitStore.getState().deleteWire(vccFeed!.id);

    // Diagnostics should report UNPOWERED_IC because +5V is gone
    const diags = useCircuitStore.getState().diagnostics;
    const unpowered = diags.filter((d) => d.code === "UNPOWERED_IC");
    expect(unpowered.length).toBeGreaterThan(0);

    // Now user clicks Auto-Power
    const res = useCircuitStore.getState().autoWireAllIcPower();
    expect(res.alreadyPowered).toBe(false);
    expect(res.count).toBeGreaterThan(0);

    // And verify the IC is now fully powered again
    expect(useCircuitStore.getState().diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toHaveLength(0);
  });

  it("test autoWireIcPower(nodeId) after deleting +5V socket feed wire", () => {
    const icId = setupPoweredBoard();
    const doc = useCircuitStore.getState().doc;
    const vccFeed = Object.values(doc.wires).find(
      (w) => w.a.kind === "pin" && w.a.ref.pin === "VCC",
    );
    expect(vccFeed).toBeDefined();

    useCircuitStore.getState().deleteWire(vccFeed!.id);

    const wired = useCircuitStore.getState().autoWireIcPower(icId);
    expect(wired).toBe(true);
    expect(useCircuitStore.getState().diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toHaveLength(0);
  });

  it("test deleting GND socket feed wire", () => {
    setupPoweredBoard();
    const doc = useCircuitStore.getState().doc;
    const gndFeed = Object.values(doc.wires).find(
      (w) => w.a.kind === "pin" && w.a.ref.pin === "GND",
    );
    expect(gndFeed).toBeDefined();

    useCircuitStore.getState().deleteWire(gndFeed!.id);

    const diags = useCircuitStore.getState().diagnostics;
    expect(diags.filter((d) => d.code === "UNPOWERED_IC").length).toBeGreaterThan(0);

    const res = useCircuitStore.getState().autoWireAllIcPower();
    expect(res.alreadyPowered).toBe(false);
    expect(res.count).toBeGreaterThan(0);

    expect(useCircuitStore.getState().diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toHaveLength(0);
  });

  it("test deleting top-to-bottom rail bridge wire", () => {
    setupPoweredBoard();
    const doc = useCircuitStore.getState().doc;
    // Find rail bridge wire (connects row +top to +bottom)
    const bridge = Object.values(doc.wires).find(
      (w) =>
        w.a.kind === "hole" &&
        w.b.kind === "hole" &&
        ((w.a.ref.row === "+top" && w.b.ref.row === "+bottom") ||
          (w.a.ref.row === "+bottom" && w.b.ref.row === "+top")),
    );
    expect(bridge).toBeDefined();

    useCircuitStore.getState().deleteWire(bridge!.id);

    const res = useCircuitStore.getState().autoWireAllIcPower();
    expect(res.alreadyPowered).toBe(false);
    expect(res.count).toBeGreaterThan(0);

    // Verify bridge was restored
    const restoredDoc = useCircuitStore.getState().doc;
    const restoredBridge = Object.values(restoredDoc.wires).find(
      (w) =>
        w.a.kind === "hole" &&
        w.b.kind === "hole" &&
        ((w.a.ref.row === "+top" && w.b.ref.row === "+bottom") ||
          (w.a.ref.row === "+bottom" && w.b.ref.row === "+top")),
    );
    expect(restoredBridge).toBeDefined();
  });

  it("test deleting segment bridge wire", () => {
    setupPoweredBoard();
    const doc = useCircuitStore.getState().doc;
    // Find segment bridge wire (across col 32 and 33 on +top)
    const segBridge = Object.values(doc.wires).find(
      (w) =>
        w.a.kind === "hole" &&
        w.b.kind === "hole" &&
        w.a.ref.row === "+top" &&
        w.b.ref.row === "+top" &&
        Math.min(w.a.ref.col, w.b.ref.col) <= 32 &&
        Math.max(w.a.ref.col, w.b.ref.col) >= 33,
    );
    expect(segBridge).toBeDefined();

    useCircuitStore.getState().deleteWire(segBridge!.id);

    const res = useCircuitStore.getState().autoWireAllIcPower();
    expect(res.alreadyPowered).toBe(false);

    // Verify segment bridge was restored
    const restoredDoc = useCircuitStore.getState().doc;
    const restoredSegBridge = Object.values(restoredDoc.wires).find(
      (w) =>
        w.a.kind === "hole" &&
        w.b.kind === "hole" &&
        w.a.ref.row === "+top" &&
        w.b.ref.row === "+top" &&
        Math.min(w.a.ref.col, w.b.ref.col) <= 32 &&
        Math.max(w.a.ref.col, w.b.ref.col) >= 33,
    );
    expect(restoredSegBridge).toBeDefined();
  });

  it("test deleting IC VCC jumper wire (w11)", () => {
    setupPoweredBoard();
    const doc = useCircuitStore.getState().doc;
    const icVccJumper = Object.values(doc.wires).find(
      (w) =>
        w.a.kind === "hole" &&
        w.b.kind === "hole" &&
        w.a.ref.col === 14 &&
        w.a.ref.row === "G",
    );
    expect(icVccJumper).toBeDefined();

    useCircuitStore.getState().deleteWire(icVccJumper!.id);

    const diags = useCircuitStore.getState().diagnostics;
    expect(diags.filter((d) => d.code === "UNPOWERED_IC").length).toBeGreaterThan(0);

    const res = useCircuitStore.getState().autoWireAllIcPower();
    expect(res.alreadyPowered).toBe(false);
    expect(res.count).toBeGreaterThan(0);
    expect(useCircuitStore.getState().diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toHaveLength(0);
  });

  it("test deleting IC GND jumper wire (w12)", () => {
    setupPoweredBoard();
    const doc = useCircuitStore.getState().doc;
    const icGndJumper = Object.values(doc.wires).find(
      (w) =>
        w.a.kind === "hole" &&
        w.b.kind === "hole" &&
        w.a.ref.col === 20 &&
        w.a.ref.row === "D",
    );
    expect(icGndJumper).toBeDefined();

    useCircuitStore.getState().deleteWire(icGndJumper!.id);

    const diags = useCircuitStore.getState().diagnostics;
    expect(diags.filter((d) => d.code === "UNPOWERED_IC").length).toBeGreaterThan(0);

    const res = useCircuitStore.getState().autoWireAllIcPower();
    expect(res.alreadyPowered).toBe(false);
    expect(res.count).toBeGreaterThan(0);
    expect(useCircuitStore.getState().diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toHaveLength(0);
  });

  it("returns alreadyPowered: true when already powered with no missing wires", () => {
    const icId = setupPoweredBoard();

    // Board is fully powered. Calling autoWireAllIcPower should say alreadyPowered
    const allRes = useCircuitStore.getState().autoWireAllIcPower();
    expect(allRes.alreadyPowered).toBe(true);
    expect(allRes.count).toBe(0);

    // autoWireIcPower should also return false
    const singleRes = useCircuitStore.getState().autoWireIcPower(icId);
    expect(singleRes).toBe(false);
  });

  it("handles multiple ICs correctly when power is deleted", () => {
    const store = useCircuitStore.getState();
    const spec = DEFAULT_BOARD;
    const ic1 = asNodeId("ic1");
    const ic2 = asNodeId("ic2");

    store.load({
      nodes: {
        [ic1]: { id: ic1, kind: "ic", part: "7400", label: "U1", pos: { x: 10, y: 0 } },
        [ic2]: { id: ic2, kind: "ic", part: "7404", label: "U2", pos: { x: 25, y: 0 } },
      },
      wires: {},
      board: spec,
    });

    // Auto-power both
    const initRes = store.autoWireAllIcPower();
    expect(initRes.alreadyPowered).toBe(false);
    expect(useCircuitStore.getState().diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toHaveLength(0);

    // Delete U2's VCC wire
    const doc = useCircuitStore.getState().doc;
    const u2Vcc = Object.values(doc.wires).find(
      (w) =>
        w.a.kind === "hole" &&
        w.b.kind === "hole" &&
        w.a.ref.col === 25 &&
        w.a.ref.row === "G",
    );
    expect(u2Vcc).toBeDefined();

    useCircuitStore.getState().deleteWire(u2Vcc!.id);

    // U2 should have UNPOWERED_IC, but U1 is still powered
    const diags = useCircuitStore.getState().diagnostics;
    expect(diags.some((d) => d.code === "UNPOWERED_IC" && d.node === ic2)).toBe(true);
    expect(diags.some((d) => d.code === "UNPOWERED_IC" && d.node === ic1)).toBe(false);

    // Clicking Auto-Power should wire U2
    const res = useCircuitStore.getState().autoWireAllIcPower();
    expect(res.alreadyPowered).toBe(false);
    expect(res.count).toBeGreaterThan(0);
    expect(useCircuitStore.getState().diagnostics.filter((d) => d.code === "UNPOWERED_IC")).toHaveLength(0);
  });
});
