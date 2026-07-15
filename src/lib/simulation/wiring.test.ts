import { describe, expect, it } from "vitest";
import { describeWiring, formatPin } from "./wiring";
import { realize, synthesize, technologyMap } from "./synth";
import { parse } from "@/lib/core-engine/parser";

function docFor(expr: string, variables: string[], discrete = false) {
  const ast = parse(expr);
  if (!ast.ok) throw new Error("bad fixture");
  const nl = synthesize(ast.value.ast, variables);
  return realize(technologyMap(nl, "mixed"), { discrete });
}

describe("describeWiring", () => {
  it("lists every multi-pin net with a driver and its loads", () => {
    const w = describeWiring(docFor("A*B + C", ["A", "B", "C"]));
    expect(w.nets.length).toBeGreaterThan(0);
    // Every net that made the list is a real connection: at least two pins.
    for (const net of w.nets) {
      expect(net.drivers.length + net.loads.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives IC pins their DIP numbers, and gate pins none", () => {
    const ic = describeWiring(docFor("A*B", ["A", "B"]));
    const allPins = ic.nets.flatMap((n) => [...n.drivers, ...n.loads]);
    // The 7408 pins carry real DIP numbers.
    expect(allPins.some((p) => /^U\d/.test(p.nodeLabel) && p.number > 0)).toBe(true);

    const gates = describeWiring(docFor("A*B", ["A", "B"], true));
    const gatePins = gates.nets
      .flatMap((n) => [...n.drivers, ...n.loads])
      .filter((p) => /^G\d/.test(p.nodeLabel));
    expect(gatePins.every((p) => p.number === 0)).toBe(true);
  });

  it("always wires Vcc and GND to the chips", () => {
    const w = describeWiring(docFor("A*B", ["A", "B"]));
    expect(w.nets.some((n) => n.kind === "vcc")).toBe(true);
    expect(w.nets.some((n) => n.kind === "gnd")).toBe(true);
    expect(w.icCount).toBeGreaterThan(0);
  });

  it("formats a pin the way a datasheet reads", () => {
    expect(formatPin({ nodeLabel: "U1", pin: "2A", number: 3, role: "load" })).toBe(
      "U1 pin 3 (2A)",
    );
    expect(formatPin({ nodeLabel: "G1", pin: "Y", number: 0, role: "driver" })).toBe(
      "G1.Y",
    );
  });

  it("counts what is on the board", () => {
    const w = describeWiring(docFor("A^B", ["A", "B"]));
    expect(w.icCount).toBeGreaterThan(0);
    expect(w.wireCount).toBeGreaterThan(0);
  });
});
