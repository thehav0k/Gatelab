import { describe, expect, it } from "vitest";
import { buildNetIndex, netOf, pinKey } from "./netlist";
import { pinsOf } from "./parts";
import { circuit, ref } from "./testing/build";

const index = (doc: Parameters<typeof buildNetIndex>[0]) =>
  buildNetIndex(doc, pinsOf);

describe("buildNetIndex — nets are N-ary", () => {
  it("merges a chain of wires into ONE net, not two edges", () => {
    // G1.Y — G2.A, and G2.A — L1.A. All three pins are one electrical node.
    const doc = circuit()
      .gate("G1", "and")
      .gate("G2", "not")
      .led("L1")
      .wire("G1", "Y", "G2", "A")
      .wire("G2", "A", "L1", "A")
      .build();

    const idx = index(doc);
    const net = netOf(idx, ref("G1", "Y"));
    expect(net).not.toBeNull();
    expect(netOf(idx, ref("G2", "A"))).toBe(net);
    expect(netOf(idx, ref("L1", "A"))).toBe(net);

    const found = idx.nets.find((n) => n.id === net)!;
    expect(found.pins).toHaveLength(3);
    expect(found.drivers).toHaveLength(1); // only G1.Y drives
    expect(found.loads).toHaveLength(2); // G2.A and L1.A read
  });

  /**
   * THE REGRESSION TEST for Invariant 1.
   *
   * Deleting one wire from a chain may or may not split the net. Any code path
   * that "updates the net in place" gets this wrong and leaves a ghost
   * connection — the simulator insists two pins are connected while the canvas
   * shows no wire between them, which is close to undebuggable.
   *
   * The fix is to never patch: rebuild from the wire list every time.
   */
  it("SPLITS a net back into two when the middle wire is deleted", () => {
    const b = circuit()
      .gate("G1", "and")
      .gate("G2", "not")
      .led("L1")
      .wire("G1", "Y", "G2", "A") // w1
      .wire("G2", "A", "L1", "A"); // w2

    const joined = index(b.build());
    expect(netOf(joined, ref("G1", "Y"))).toBe(netOf(joined, ref("L1", "A")));

    const split = index(b.removeWire("w2").build());
    expect(netOf(split, ref("G1", "Y"))).not.toBe(netOf(split, ref("L1", "A")));
  });

  it("gives every unwired pin its own net, so a floating input is still reportable", () => {
    const doc = circuit().gate("G1", "and").build();
    const idx = index(doc);
    // A, B, Y — three pins, three separate nets.
    expect(idx.nets).toHaveLength(3);
    for (const net of idx.nets) expect(net.pins).toHaveLength(1);
  });

  it("survives a wire whose node was deleted", () => {
    const doc = circuit()
      .gate("G1", "and")
      .wire("G1", "Y", "GONE", "A")
      .build();
    expect(() => index(doc)).not.toThrow();
  });

  it("assigns reproducible ordinals across rebuilds", () => {
    const doc = circuit()
      .gate("G1", "and")
      .gate("G2", "or")
      .wire("G1", "Y", "G2", "A")
      .build();

    const a = index(doc);
    const b = index(doc);
    expect([...a.ordinalOf.entries()]).toEqual([...b.ordinalOf.entries()]);
  });
});

describe("buildNetIndex — rails", () => {
  it("classifies a net touching a Vcc rail as the vcc net", () => {
    const doc = circuit()
      .rail("V1", "vcc")
      .gate("G1", "and")
      .wire("V1", "VCC", "G1", "A")
      .build();

    const idx = index(doc);
    expect(idx.vcc).not.toBeNull();
    expect(netOf(idx, ref("G1", "A"))).toBe(idx.vcc);
    const net = idx.nets.find((n) => n.id === idx.vcc)!;
    expect(net.kind).toBe("vcc");
    expect(net.drivers).toHaveLength(1); // the rail itself drives
  });

  // A rail is a single node with many connections. This is precisely what a
  // point-to-point edge model cannot express without inventing N phantom edges.
  it("puts many pins on ONE Vcc net", () => {
    const doc = circuit()
      .rail("V1", "vcc")
      .gate("G1", "and")
      .gate("G2", "and")
      .gate("G3", "and")
      .wire("V1", "VCC", "G1", "A")
      .wire("V1", "VCC", "G2", "A")
      .wire("V1", "VCC", "G3", "A")
      .build();

    const idx = index(doc);
    const net = idx.nets.find((n) => n.id === idx.vcc)!;
    expect(net.pins).toHaveLength(4); // the rail + three gate inputs
  });

  it("flags a net carrying both Vcc and GND as a dead short", () => {
    const doc = circuit()
      .rail("V1", "vcc")
      .rail("G0", "gnd")
      .wire("V1", "VCC", "G0", "GND")
      .build();

    const idx = index(doc);
    expect(idx.nets.some((n) => n.railShort)).toBe(true);
    // A shorted net must not masquerade as a usable supply.
    expect(idx.vcc).toBeNull();
    expect(idx.gnd).toBeNull();
  });
});

describe("pinKey", () => {
  it("is stable and distinguishes pins of the same node", () => {
    expect(pinKey(ref("U1", "A"))).not.toBe(pinKey(ref("U1", "B")));
    expect(pinKey(ref("U1", "A"))).toBe(pinKey(ref("U1", "A")));
  });
});
