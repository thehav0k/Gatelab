import { describe, expect, it } from "vitest";
import {
  blockOf,
  deserialize,
  rotationOf,
  emptyDocument,
  portsOf,
  pruneLinks,
  serialize,
  toDiagram,
  type EditorDocument,
} from "./document";
import {
  addFromPalette,
  clearRotations,
  connect,
  deleteCustomPart,
  dragInstances,
  duplicate,
  group,
  moveInstances,
  offsetInstances,
  removeSelection,
  rotateInstances,
  setLink,
  setRotation,
  setValues,
  ungroup,
} from "./ops";
import { alignNudge } from "./align";
import { CATEGORY_ORDER, PARTS, getPart, partDefaults, pinList } from "./parts";
import { placeDocument, blockAt, blocksIn, linkAt, portAt, portPositions } from "./place";
import { routeLink } from "./route";
import { TEMPLATES, getTemplate } from "./templates";
import { TEXTBOOK } from "../theme";
import { validate } from "../types";
import { measure, placePorts, placeRotatedPorts, rotatedSize } from "../measure";
import { renderSvg } from "../svg";

// --- a small circuit used by several tests ---------------------------------

function halfAdderDoc() {
  let doc = emptyDocument("Half adder");
  const a = addFromPalette(doc, "input", 40, 40);
  doc = a!.doc;
  const b = addFromPalette(doc, "input", 40, 120);
  doc = b!.doc;
  const x = addFromPalette(doc, "gate", 240, 40);
  doc = x!.doc;
  doc = setValues(doc, x!.id, { op: "xor" }).doc;
  const s = addFromPalette(doc, "output", 440, 40);
  doc = s!.doc;

  doc = connect(doc, { block: a!.id, port: "Y" }, { block: x!.id, port: "A" }).ok
    ? (connect(doc, { block: a!.id, port: "Y" }, { block: x!.id, port: "A" }) as { doc: EditorDocument }).doc
    : doc;
  return { doc, a: a!.id, b: b!.id, x: x!.id, s: s!.id };
}

const wire = (doc: EditorDocument, from: [string, string], to: [string, string]) => {
  const r = connect(doc, { block: from[0], port: from[1] }, { block: to[0], port: to[1] });
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};

const place = (doc: EditorDocument, partId: string, x: number, y: number) => {
  const r = addFromPalette(doc, partId, x, y);
  if (!r) throw new Error(`no part ${partId}`);
  return r;
};

// ---------------------------------------------------------------------------

describe("the parts registry", () => {
  it("builds every part at its defaults, with unique ports", () => {
    for (const part of PARTS) {
      const block = part.build("x", partDefaults(part));
      expect(block.id, part.id).toBe("x");
      // A gate is allowed no title — its SHAPE is the label. A box is not.
      if (block.kind === "box") expect(block.title.length, part.id).toBeGreaterThan(0);
      const ids = new Set(block.ports.map((p) => p.id));
      expect(ids.size, `${part.id} has duplicate port ids`).toBe(block.ports.length);
      // Every part must be measurable and placeable, or the canvas cannot draw it.
      const size = measure(block, TEXTBOOK);
      expect(size.w).toBeGreaterThan(0);
      expect(placePorts(block, size).size).toBe(block.ports.length);
    }
  });

  it("puts every part in a category the palette knows how to show", () => {
    for (const part of PARTS) expect(CATEGORY_ORDER).toContain(part.category);
  });

  it("rebuilds a part when its parameters change", () => {
    const decoder = getPart("decoder");
    expect(decoder).toBeDefined();
    const two = decoder!.build("d", { ...partDefaults(decoder!), addr: 2 });
    const three = decoder!.build("d", { ...partDefaults(decoder!), addr: 3 });
    expect(two.ports.filter((p) => p.id.startsWith("Y"))).toHaveLength(4);
    expect(three.ports.filter((p) => p.id.startsWith("Y"))).toHaveLength(8);
  });

  it("reads a hand-typed pin list, marking a trailing apostrophe active low", () => {
    const ports = pinList("A, B', CE", "left", "in");
    expect(ports.map((p) => p.id)).toEqual(["A", "B", "CE"]);
    expect(ports[1]?.activeLow).toBe(true);
    expect(ports[0]?.activeLow).toBeUndefined();
  });

  it("never drops a duplicated pin name — it disambiguates it", () => {
    const ports = pinList("EN, EN", "left", "in");
    expect(ports).toHaveLength(2);
    expect(new Set(ports.map((p) => p.id)).size).toBe(2);
  });
});

describe("placing and moving", () => {
  it("snaps to the grid and never goes negative", () => {
    let doc = emptyDocument();
    const added = place(doc, "gate", 37, 61);
    doc = added.doc;
    expect(doc.instances[added.id]?.x).toBe(40);
    expect(doc.instances[added.id]?.y).toBe(64);

    doc = moveInstances(doc, [added.id], -1000, -1000);
    expect(doc.instances[added.id]).toMatchObject({ x: 0, y: 0 });
  });

  it("gives every instance a fresh id, even after deletions", () => {
    let doc = emptyDocument();
    const first = place(doc, "gate", 0, 0);
    doc = removeSelection(first.doc, [first.id]);
    const second = place(doc, "gate", 0, 0);
    expect(second.id).not.toBe(first.id);
  });
});

describe("wiring", () => {
  it("orients the link so the output is the source", () => {
    const built = halfAdderDoc();
    // Wired input-first on purpose; the link must come out output-first.
    const r = connect(
      built.doc,
      { block: built.x, port: "B" },
      { block: built.b, port: "Y" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const link = r.doc.links[r.id];
    expect(link?.from.block).toBe(built.b);
    expect(link?.to.block).toBe(built.x);
  });

  it("refuses a pin wired to itself and a duplicate pair", () => {
    const built = halfAdderDoc();
    const self = connect(
      built.doc,
      { block: built.x, port: "A" },
      { block: built.x, port: "A" },
    );
    expect(self.ok).toBe(false);

    const again = connect(
      built.doc,
      { block: built.a, port: "Y" },
      { block: built.x, port: "A" },
    );
    expect(again.ok).toBe(false);
  });

  /**
   * A shared bus is several drivers on one pin, and it is what a memory diagram
   * looks like. This used to be forbidden, and the effect was that three of the
   * four chips in a bank silently lost their connection to the data bus.
   */
  it("allows a second wire into the same pin — a bus is not a mistake", () => {
    const built = halfAdderDoc();
    const r = connect(
      built.doc,
      { block: built.b, port: "Y" },
      { block: built.x, port: "A" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const intoA = Object.values(r.doc.links).filter(
      (l) => l.to.block === built.x && l.to.port === "A",
    );
    expect(intoA).toHaveLength(2);
  });

  it("marks the link as a bus when either pin is one", () => {
    let doc = emptyDocument();
    const mem = place(doc, "memory", 0, 0);
    doc = mem.doc;
    const out = place(doc, "output", 400, 0);
    doc = out.doc;
    const r = connect(doc, { block: mem.id, port: "Q" }, { block: out.id, port: "A" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.links[r.id]?.width).toBe(8);
  });
});

describe("changing parameters", () => {
  it("prunes the wires whose pins no longer exist, and says how many", () => {
    let doc = emptyDocument();
    const dec = place(doc, "decoder", 0, 0);
    doc = dec.doc;
    doc = setValues(doc, dec.id, { addr: 3 }).doc;
    const out = place(doc, "output", 400, 0);
    doc = out.doc;
    doc = wire(doc, [dec.id, "Y7"], [out.id, "A"]);
    expect(Object.keys(doc.links)).toHaveLength(1);

    // Y7 only exists on a 3-line decoder.
    const narrowed = setValues(doc, dec.id, { addr: 2 });
    expect(narrowed.removedLinks).toBe(1);
    expect(Object.keys(narrowed.doc.links)).toHaveLength(0);
  });

  it("leaves wires alone when the change does not remove their pins", () => {
    let doc = emptyDocument();
    const dec = place(doc, "decoder", 0, 0);
    doc = dec.doc;
    const out = place(doc, "output", 400, 0);
    doc = out.doc;
    doc = wire(doc, [dec.id, "Y0"], [out.id, "A"]);
    expect(setValues(doc, dec.id, { addr: 4 }).removedLinks).toBe(0);
  });
});

describe("duplicate", () => {
  it("copies the blocks and the wires wholly inside the selection", () => {
    const built = halfAdderDoc();
    const copy = duplicate(built.doc, [built.a, built.x]);
    expect(copy.ids).toHaveLength(2);
    // The A -> XOR wire is inside the selection, so it is copied.
    expect(Object.keys(copy.doc.links)).toHaveLength(2);
  });

  it("does not copy a wire that leaves the selection", () => {
    const built = halfAdderDoc();
    const copy = duplicate(built.doc, [built.x]);
    expect(Object.keys(copy.doc.links)).toHaveLength(1);
  });
});

describe("grouping into a reusable block", () => {
  /** Input A -> XOR -> Output S, plus a second input feeding the XOR. */
  function wired() {
    const built = halfAdderDoc();
    let doc = wire(built.doc, [built.b, "Y"], [built.x, "B"]);
    doc = wire(doc, [built.x, "Y"], [built.s, "A"]);
    return { ...built, doc };
  }

  it("turns the IO tags inside the selection into the block's pins", () => {
    const w = wired();
    const g = group(w.doc, [w.a, w.b, w.x, w.s], "XOR block");
    expect(g.ok).toBe(true);
    if (!g.ok) return;

    const instance = g.doc.instances[g.id];
    expect(instance?.part.startsWith("custom:")).toBe(true);
    const block = blockOf(g.doc, instance!);
    expect(block?.title).toBe("XOR block");
    // Two inputs on the left, one output on the right — the tags that were inside.
    expect(block?.ports.filter((p) => p.dir === "in")).toHaveLength(2);
    expect(block?.ports.filter((p) => p.dir === "out")).toHaveLength(1);
    expect(block?.ports.every((p) => (p.dir === "in" ? p.side === "left" : p.side === "right"))).toBe(true);

    // The originals are gone from the canvas and the inner wires with them.
    expect(Object.keys(g.doc.instances)).toHaveLength(1);
    expect(Object.keys(g.doc.links)).toHaveLength(0);
  });

  it("keeps a wire that crossed the boundary, landing it on a new pin", () => {
    const w = wired();
    // Group only the gate. Three wires cross its boundary: A->A, B->B, Y->S.
    const g = group(w.doc, [w.x], "Just the gate");
    expect(g.ok).toBe(true);
    if (!g.ok) return;

    expect(Object.keys(g.doc.links)).toHaveLength(3);
    for (const link of Object.values(g.doc.links)) {
      const touchesGroup = link.from.block === g.id || link.to.block === g.id;
      expect(touchesGroup).toBe(true);
    }
    // Every rewired endpoint must name a pin the new block actually has.
    expect(validate(toDiagram(g.doc))).toEqual([]);
  });

  it("gives one pin to a fan-out, because it is one signal", () => {
    let doc = emptyDocument();
    const src = place(doc, "input", 0, 0);
    doc = src.doc;
    const g1 = place(doc, "gate", 200, 0);
    doc = g1.doc;
    const g2 = place(doc, "gate", 200, 120);
    doc = g2.doc;
    doc = wire(doc, [src.id, "Y"], [g1.id, "A"]);
    doc = wire(doc, [src.id, "Y"], [g2.id, "A"]);

    // Group the two gates: both boundary wires come from the SAME outer pin, so
    // they arrive at two different inner pins and therefore two ports.
    const both = group(doc, [g1.id, g2.id], "Pair");
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    const block = blockOf(both.doc, both.doc.instances[both.id]!);
    expect(block?.ports.filter((p) => p.dir === "in")).toHaveLength(2);

    // Group the SOURCE instead: its one pin feeds two wires, and that is one port.
    const single = group(doc, [src.id], "Source");
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    const srcBlock = blockOf(single.doc, single.doc.instances[single.id]!);
    expect(srcBlock?.ports).toHaveLength(1);
    expect(Object.keys(single.doc.links)).toHaveLength(2);
  });

  it("refuses a selection with no interface to expose", () => {
    let doc = emptyDocument();
    const lonely = place(doc, "gate", 0, 0);
    doc = lonely.doc;
    const g = group(doc, [lonely.id], "Nothing");
    expect(g.ok).toBe(false);
  });

  it("can be placed more than once — that is the whole point", () => {
    const w = wired();
    const g = group(w.doc, [w.a, w.b, w.x, w.s], "XOR block");
    expect(g.ok).toBe(true);
    if (!g.ok) return;

    const customId = g.doc.instances[g.id]!.part;
    const second = addFromPalette(g.doc, customId, 400, 400);
    expect(second).not.toBeNull();
    const doc = second!.doc;
    expect(Object.keys(doc.instances)).toHaveLength(2);
    expect(blockOf(doc, doc.instances[second!.id]!)?.title).toBe("XOR block");
    expect(validate(toDiagram(doc))).toEqual([]);
  });
});

describe("ungrouping", () => {
  it("puts the contents back and reconnects the outside world", () => {
    const built = halfAdderDoc();
    let doc = wire(built.doc, [built.b, "Y"], [built.x, "B"]);
    doc = wire(doc, [built.x, "Y"], [built.s, "A"]);

    const g = group(doc, [built.x], "Gate");
    expect(g.ok).toBe(true);
    if (!g.ok) return;

    const back = ungroup(g.doc, g.id);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    // Same shape as before: four blocks, three wires, all endpoints resolvable.
    expect(Object.keys(back.doc.instances)).toHaveLength(4);
    expect(Object.keys(back.doc.links)).toHaveLength(3);
    expect(validate(toDiagram(back.doc))).toEqual([]);

    // And the gate really is a gate again, not a box.
    const gate = Object.values(back.doc.instances).find((i) => i.part === "gate");
    expect(gate).toBeDefined();
  });

  it("survives a round trip through group and ungroup", () => {
    const built = halfAdderDoc();
    let doc = wire(built.doc, [built.b, "Y"], [built.x, "B"]);
    doc = wire(doc, [built.x, "Y"], [built.s, "A"]);
    const before = toDiagram(doc);

    const g = group(doc, [built.a, built.x], "Half");
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const back = ungroup(g.doc, g.id);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    const after = toDiagram(back.doc);
    expect(after.blocks).toHaveLength(before.blocks.length);
    expect(after.links).toHaveLength(before.links.length);
    expect(validate(after)).toEqual([]);
  });

  it("dissolves an IO tag that an outside wire has taken the place of", () => {
    // Build [Input P -> NOT] , group it so the block has one input pin, then
    // drive that pin from outside and take it apart again.
    let doc = emptyDocument();
    const p = place(doc, "input", 0, 0);
    doc = p.doc;
    const inv = place(doc, "gate", 200, 0);
    doc = inv.doc;
    doc = setValues(doc, inv.id, { op: "not" }).doc;
    doc = wire(doc, [p.id, "Y"], [inv.id, "A"]);

    const g = group(doc, [p.id, inv.id], "Inverter");
    expect(g.ok).toBe(true);
    if (!g.ok) return;

    const driver = place(g.doc, "input", 0, 300);
    let outer = driver.doc;
    const pin = blockOf(outer, outer.instances[g.id]!)!.ports.find((x) => x.dir === "in")!;
    outer = wire(outer, [driver.id, "Y"], [g.id, pin.id]);

    const back = ungroup(outer, g.id);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    // The inner Input tag is gone — the outside driver stands in its place — and
    // the outside driver now feeds the gate directly. Two tags would have meant
    // two things driving one net.
    const inputs = Object.values(back.doc.instances).filter((i) => i.part === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.id).toBe(driver.id);

    const links = Object.values(back.doc.links);
    expect(links).toHaveLength(1);
    expect(links[0]?.from.block).toBe(driver.id);
    expect(validate(toDiagram(back.doc))).toEqual([]);
  });

  it("dissolves an OUTPUT tag the same way, from the other side", () => {
    // [NOT -> Output F] grouped, then the block's output pin driven onward. On
    // ungrouping, whatever fed the tag inside must reach the outside consumer.
    let doc = emptyDocument();
    const inv = place(doc, "gate", 0, 0);
    doc = inv.doc;
    doc = setValues(doc, inv.id, { op: "not" }).doc;
    const f = place(doc, "output", 200, 0);
    doc = f.doc;
    doc = wire(doc, [inv.id, "Y"], [f.id, "A"]);

    const g = group(doc, [inv.id, f.id], "Inverter");
    expect(g.ok).toBe(true);
    if (!g.ok) return;

    const sink = place(g.doc, "output", 600, 0);
    let outer = sink.doc;
    const pin = blockOf(outer, outer.instances[g.id]!)!.ports.find((x) => x.dir === "out")!;
    outer = wire(outer, [g.id, pin.id], [sink.id, "A"]);

    const back = ungroup(outer, g.id);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    // The inner Output tag is gone; the gate drives the outside sink directly.
    const outputs = Object.values(back.doc.instances).filter((i) => i.part === "output");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.id).toBe(sink.id);
    const links = Object.values(back.doc.links);
    expect(links).toHaveLength(1);
    expect(links[0]?.to.block).toBe(sink.id);
    expect(validate(toDiagram(back.doc))).toEqual([]);
  });

  it("keeps an IO tag that nothing outside was wired to", () => {
    let doc = emptyDocument();
    const p = place(doc, "input", 0, 0);
    doc = p.doc;
    const inv = place(doc, "gate", 200, 0);
    doc = inv.doc;
    doc = wire(doc, [p.id, "Y"], [inv.id, "A"]);

    const g = group(doc, [p.id, inv.id], "Inverter");
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const back = ungroup(g.doc, g.id);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(Object.values(back.doc.instances).filter((i) => i.part === "input")).toHaveLength(1);
    expect(Object.keys(back.doc.links)).toHaveLength(1);
  });

  it("refuses to forget a custom part that is still on the canvas", () => {
    const built = halfAdderDoc();
    const doc = wire(built.doc, [built.x, "Y"], [built.s, "A"]);
    const g = group(doc, [built.x], "Gate");
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const customId = g.doc.instances[g.id]!.part.slice(7);
    expect(deleteCustomPart(g.doc, customId).ok).toBe(false);

    const emptied = removeSelection(g.doc, [g.id]);
    expect(deleteCustomPart(emptied, customId).ok).toBe(true);
  });
});

describe("serialisation", () => {
  it("round-trips a document", () => {
    const built = halfAdderDoc();
    const round = deserialize(serialize(built.doc));
    expect("doc" in round).toBe(true);
    if (!("doc" in round)) return;
    expect(round.doc.instances).toEqual(built.doc.instances);
    expect(round.doc.links).toEqual(built.doc.links);
  });

  it("refuses a file that is not a diagram, rather than blanking the canvas", () => {
    expect(deserialize("not json")).toHaveProperty("error");
    expect(deserialize('{"hello":1}')).toHaveProperty("error");
    expect(deserialize('{"format":"something.else","document":{}}')).toHaveProperty("error");
    expect(deserialize('{"format":"gatelab.diagram.v1","document":{}}')).toHaveProperty("error");
  });
});

describe("placement and hit testing", () => {
  it("draws at the authored positions, with the origin pinned", () => {
    const built = halfAdderDoc();
    const placed = placeDocument(built.doc, TEXTBOOK);
    const gate = placed.blocks.find((b) => b.block.id === built.x);
    expect(gate?.x).toBe(built.doc.instances[built.x]?.x);
    expect(gate?.y).toBe(built.doc.instances[built.x]?.y);
  });

  it("crops to the content when asked for a figure", () => {
    const built = halfAdderDoc();
    const tight = placeDocument(built.doc, TEXTBOOK, { tight: true, margin: 10 });
    const minX = Math.min(...tight.blocks.map((b) => b.x));
    expect(minX).toBe(10);
  });

  it("finds the pin, the block and the wire under a point", () => {
    const built = halfAdderDoc();
    const placed = placeDocument(built.doc, TEXTBOOK);
    const gate = placed.blocks.find((b) => b.block.id === built.x);
    expect(gate).toBeDefined();

    const pin = gate!.ports.get("A")!;
    expect(portAt(placed, { x: pin.ax, y: pin.ay })).toEqual({ block: built.x, port: "A" });
    expect(portAt(placed, { x: pin.ax + 400, y: pin.ay })).toBeNull();

    expect(blockAt(placed, { x: gate!.x + 4, y: gate!.y + 4 })).toBe(built.x);
    expect(blockAt(placed, { x: -50, y: -50 })).toBeNull();

    const routed = placed.links[0]!;
    const mid = routed.points[1]!;
    expect(linkAt(placed, mid)).toBe(routed.link.id);
    expect(linkAt(placed, { x: mid.x, y: mid.y + 300 })).toBeNull();
  });

  it("selects the blocks inside a marquee", () => {
    const built = halfAdderDoc();
    const placed = placeDocument(built.doc, TEXTBOOK);
    const all = blocksIn(placed, { x0: -10, y0: -10, x1: 10000, y1: 10000 });
    expect(all.sort()).toEqual([built.a, built.b, built.s, built.x].sort());
    expect(blocksIn(placed, { x0: 9000, y0: 9000, x1: 9500, y1: 9500 })).toEqual([]);
  });

  it("renders through the same writer the catalogue uses", () => {
    const built = halfAdderDoc();
    const svg = renderSvg(placeDocument(built.doc, TEXTBOOK), TEXTBOOK, { frame: "canvas" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("NaN");
    // Canvas framing draws no title BLOCK and no margin, so the drawing sits in
    // the document's own coordinates and a click lands where it looks like it
    // should. (The title survives as the accessible name, which is not drawn.)
    expect(svg).toContain(`transform="translate(0 0)"`);
    expect(svg).not.toContain(`font-weight="600"`);
  });
});

describe("the interactive router", () => {
  const right = { x: 0, y: 0, out: { x: 1, y: 0 }, block: "a" };
  const left = (x: number, y: number) => ({ x, y, out: { x: -1, y: 0 }, block: "b" });

  it("draws a straight line when the pins already line up", () => {
    const path = routeLink(right, left(300, 0), []);
    expect(path).toHaveLength(2);
  });

  it("keeps every segment orthogonal", () => {
    const path = routeLink(right, left(300, 160), []);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      expect(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5).toBe(true);
    }
  });

  it("goes around a block rather than through it", () => {
    const wall = { id: "w", x: 100, y: -60, w: 60, h: 120 };
    const through = routeLink(right, left(300, 0), [wall]);
    const hits = through.some((p, i) => {
      if (i === 0) return false;
      const a = through[i - 1]!;
      const x0 = Math.min(a.x, p.x);
      const x1 = Math.max(a.x, p.x);
      const y0 = Math.min(a.y, p.y);
      const y1 = Math.max(a.y, p.y);
      return x0 < wall.x + wall.w - 1 && wall.x + 1 < x1 && y0 < wall.y + wall.h - 1 && wall.y + 1 < y1;
    });
    expect(hits).toBe(false);
  });

  it("does not detour around the block its own pin is on", () => {
    // The anchor is already a stub's length outside the border, so a wire
    // leaving it never enters the block — no detour, straight across.
    const own = { id: "a", x: -80, y: -20, w: 80, h: 40 };
    expect(routeLink(right, left(300, 0), [own])).toHaveLength(2);
  });

  /**
   * The select lines of a multiplexer come in underneath it. Before the target
   * block counted as an obstacle, the wire dropped vertically straight through
   * the body — and because blocks are painted over wires, it looked like the
   * line stopped at the top edge and a disconnected stub appeared below.
   */
  it("goes around a block to reach a pin on its underside", () => {
    const body = { id: "b", x: 100, y: -60, w: 120, h: 120 };
    const path = routeLink(
      right,
      { x: 160, y: 60 + 16, out: { x: 0, y: 1 }, block: "b" },
      [body],
    );
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const c = path[i]!;
      const x0 = Math.min(a.x, c.x);
      const x1 = Math.max(a.x, c.x);
      const y0 = Math.min(a.y, c.y);
      const y1 = Math.max(a.y, c.y);
      const through =
        x0 < body.x + body.w - 1 &&
        body.x + 1 < x1 &&
        y0 < body.y + body.h - 1 &&
        body.y + 1 < y1;
      expect(through, `segment ${i} cuts the block`).toBe(false);
    }
  });

  it("routes out of a top or bottom pin into a side pin", () => {
    // A flip-flop's clock leaving downward, or a mux select leaving upward.
    const down = { x: 0, y: 0, out: { x: 0, y: 1 }, block: "a" };
    const path = routeLink(down, left(200, 200), []);
    expect(path.length).toBeGreaterThan(2);
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1]!;
      const q = path[i]!;
      expect(Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5).toBe(true);
    }
  });

  it("routes between two vertical pins", () => {
    const down = { x: 0, y: 0, out: { x: 0, y: 1 }, block: "a" };
    const up = { x: 200, y: 300, out: { x: 0, y: -1 }, block: "b" };
    const path = routeLink(down, up, []);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 200, y: 300 });
  });

  it("routes backwards to a pin behind the source", () => {
    const path = routeLink(right, left(-200, 0), []);
    expect(path.length).toBeGreaterThan(2);
    expect(path[path.length - 1]).toEqual({ x: -200, y: 0 });
    // And it leaves the pin the way the pin faces before turning round.
    expect((path[1] as { x: number }).x).toBeGreaterThan(0);
  });

  it("is orthogonal for every combination of pin directions", () => {
    // The candidate shapes are generated rather than listed per case, and this
    // is what that buys: the pairs nobody thought about — a top pin to a bottom
    // pin, anything involving a junction — cannot fall through to a diagonal.
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 0, y: 0 },
    ];
    for (const a of dirs) {
      for (const b of dirs) {
        for (const [tx, ty] of [[200, 120], [-200, 120], [-200, -120], [0, 160], [180, 0]]) {
          const path = routeLink(
            { x: 0, y: 0, out: a, block: "a" },
            { x: tx as number, y: ty as number, out: b, block: "b" },
            [],
          );
          expect(path[0]).toEqual({ x: 0, y: 0 });
          expect(path[path.length - 1]).toEqual({ x: tx, y: ty });
          for (let i = 1; i < path.length; i++) {
            const p = path[i - 1]!;
            const q = path[i]!;
            const ok = Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5;
            expect(ok, `diagonal from ${JSON.stringify(a)} to ${JSON.stringify(b)}`).toBe(true);
          }
        }
      }
    }
  });

  it("steps aside rather than running on top of a wire already drawn", () => {
    const from = { x: 0, y: 0, out: { x: 1, y: 0 }, block: "a" };
    const to = { x: 200, y: 80, out: { x: -1, y: 0 }, block: "b" };
    const alone = routeLink(from, to, []);
    const shared = routeLink(from, to, [], {
      key: "mine",
      // Somebody else's wire lying exactly along the turn this route wants.
      occupied: alone.slice(1).map((b, i) => ({ a: alone[i]!, b, key: "theirs" })),
    });
    expect(shared).not.toEqual(alone);
  });

  it("lets one signal's own fan-out share a lane, because it is one wire", () => {
    const from = { x: 0, y: 0, out: { x: 1, y: 0 }, block: "a" };
    const to = { x: 200, y: 80, out: { x: -1, y: 0 }, block: "b" };
    const alone = routeLink(from, to, []);
    const same = routeLink(from, to, [], {
      key: "mine",
      occupied: alone.slice(1).map((b, i) => ({ a: alone[i]!, b, key: "mine" })),
    });
    expect(same).toEqual(alone);
  });

  it("ignores occupancy once there is far too much of it to be worth the time", () => {
    const from = { x: 0, y: 0, out: { x: 1, y: 0 }, block: "a" };
    const to = { x: 200, y: 80, out: { x: -1, y: 0 }, block: "b" };
    const alone = routeLink(from, to, []);
    const one = alone.slice(1).map((b, i) => ({ a: alone[i]!, b, key: "theirs" }));
    const flood = Array.from({ length: 5000 }, (_, i) => one[i % one.length]!);
    expect(routeLink(from, to, [], { key: "mine", occupied: flood })).toEqual(alone);
  });

  it("reaches a junction exactly, with no stub and no imposed direction", () => {
    const junction = { x: 200, y: 90, out: { x: 0, y: 0 }, block: "j" };
    const path = routeLink(right, junction, []);
    expect(path[path.length - 1]).toEqual({ x: 200, y: 90 });
    expect(path.length).toBeGreaterThan(1);
  });
});

describe("link integrity", () => {
  it("drops nothing from a healthy document", () => {
    const built = halfAdderDoc();
    expect(pruneLinks(built.doc).removed).toBe(0);
    expect(pruneLinks(built.doc).doc).toBe(built.doc);
  });

  it("reports the ports an instance currently has", () => {
    let doc = emptyDocument();
    const ff = place(doc, "flipflop", 0, 0);
    doc = ff.doc;
    expect(portsOf(doc, doc.instances[ff.id]!).map((p) => p.id)).toContain("QN");
    doc = setValues(doc, ff.id, { complement: false }).doc;
    expect(portsOf(doc, doc.instances[ff.id]!).map((p) => p.id)).not.toContain("QN");
  });
});

describe("templates", () => {
  /**
   * A template is built by calling the same operations the UI calls, so a wire
   * to a pin that does not exist throws while building rather than rendering as
   * a silently missing connection. This is the test that makes that guarantee
   * mean something.
   */
  for (const template of TEMPLATES) {
    it(`${template.name} builds, validates and draws`, () => {
      const doc = template.build();
      expect(Object.keys(doc.instances).length).toBeGreaterThan(1);
      expect(Object.keys(doc.links).length).toBeGreaterThan(0);
      expect(validate(toDiagram(doc))).toEqual([]);

      const placed = placeDocument(doc, TEXTBOOK);
      expect(placed.links).toHaveLength(Object.keys(doc.links).length);
      const svg = renderSvg(placed, TEXTBOOK, { frame: "canvas" });
      expect(svg).not.toContain("NaN");
      expect(svg).not.toContain("undefined");
    });
  }

  it("has unique ids and is reachable by id", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(getTemplate("half-adder")?.name).toBe("Half adder");
    expect(getTemplate("nope")).toBeUndefined();
  });

  it("produces documents that can then be grouped like any other", () => {
    const doc = getTemplate("half-adder")!.build();
    const g = group(doc, Object.keys(doc.instances), "Half adder");
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const block = blockOf(g.doc, g.doc.instances[g.id]!);
    // Two inputs and two outputs — the tags that were inside it.
    expect(block?.ports.filter((p) => p.dir === "in")).toHaveLength(2);
    expect(block?.ports.filter((p) => p.dir === "out")).toHaveLength(2);
  });
});

/**
 * The defensive paths.
 *
 * Every one of these is reachable from the UI — a saved file from an older build,
 * an undo that removed the block a panel is still pointing at, a custom part
 * deleted while an instance of it survives. They must return something sane
 * rather than throw, because a thrown error in the editor takes the canvas down
 * and the user's work with it.
 */
describe("edge cases", () => {
  it("returns null for an instance whose part no longer exists", () => {
    const doc: EditorDocument = {
      ...emptyDocument(),
      instances: { b1: { id: "b1", part: "no-such-part", values: {}, x: 0, y: 0 } },
    };
    expect(blockOf(doc, doc.instances.b1!)).toBeNull();
    expect(portsOf(doc, doc.instances.b1!)).toEqual([]);
    // …and it simply does not appear in the drawing, rather than crashing it.
    expect(toDiagram(doc).blocks).toEqual([]);
    expect(placeDocument(doc, TEXTBOOK).blocks).toEqual([]);
  });

  it("returns null for a custom instance whose definition was lost", () => {
    const doc: EditorDocument = {
      ...emptyDocument(),
      instances: { b1: { id: "b1", part: "custom:gone", values: {}, x: 0, y: 0 } },
    };
    expect(blockOf(doc, doc.instances.b1!)).toBeNull();
  });

  it("drops a link whose endpoint block is missing", () => {
    const built = halfAdderDoc();
    const orphaned: EditorDocument = {
      ...built.doc,
      links: {
        ...built.doc.links,
        ghost: {
          id: "ghost",
          from: { block: "nope", port: "Y" },
          to: { block: built.x, port: "B" },
        },
      },
    };
    expect(toDiagram(orphaned).links.some((l) => l.id === "ghost")).toBe(false);
    expect(pruneLinks(orphaned).removed).toBe(1);
  });

  it("refuses to place a part that is not in the registry", () => {
    expect(addFromPalette(emptyDocument(), "not-a-part", 0, 0)).toBeNull();
    expect(addFromPalette(emptyDocument(), "custom:missing", 0, 0)).toBeNull();
  });

  it("ignores operations naming an instance that is gone", () => {
    const doc = emptyDocument();
    expect(moveInstances(doc, ["ghost"], 10, 10)).toEqual(doc);
    // A move of nothing, or of zero, returns the very same object — which is
    // what stops a no-op drag from pushing an undo step.
    expect(moveInstances(doc, [], 10, 10)).toBe(doc);
    expect(moveInstances(doc, ["ghost"], 0, 0)).toBe(doc);
    expect(setValues(doc, "ghost", { a: 1 })).toEqual({ doc, removedLinks: 0 });
    expect(duplicate(doc, ["ghost"]).ids).toEqual([]);
    expect(group(doc, ["ghost"], "x").ok).toBe(false);
    expect(ungroup(doc, "ghost").ok).toBe(false);
  });

  it("refuses to ungroup something that is not a group", () => {
    const built = halfAdderDoc();
    expect(ungroup(built.doc, built.x).ok).toBe(false);
  });

  it("refuses to wire a pin that has gone", () => {
    const built = halfAdderDoc();
    expect(connect(built.doc, { block: built.a, port: "NOPE" }, { block: built.x, port: "B" }).ok).toBe(false);
    expect(connect(built.doc, { block: "ghost", port: "Y" }, { block: built.x, port: "B" }).ok).toBe(false);
  });

  it("leaves a link alone when asked to patch one that is gone", () => {
    const built = halfAdderDoc();
    expect(setLink(built.doc, "ghost", { label: "x" })).toBe(built.doc);
  });

  it("derives an id counter for a document saved without one", () => {
    const built = halfAdderDoc();
    const older = JSON.stringify({
      format: "gatelab.diagram.v1",
      document: { ...built.doc, seq: undefined },
    });
    const parsed = deserialize(older);
    expect("doc" in parsed).toBe(true);
    if (!("doc" in parsed)) return;
    // High enough that the next id cannot collide with an existing one.
    const highest = Math.max(
      ...Object.keys(parsed.doc.instances).map((k) => Number.parseInt(k.slice(1), 10)),
    );
    expect(parsed.doc.seq).toBeGreaterThan(highest);
    const added = addFromPalette(parsed.doc, "gate", 0, 0);
    expect(parsed.doc.instances[added!.id]).toBeUndefined();
  });

  it("survives a document with no title", () => {
    const parsed = deserialize(
      JSON.stringify({
        format: "gatelab.diagram.v1",
        document: { instances: {}, links: {}, customParts: {}, seq: 0 },
      }),
    );
    expect("doc" in parsed).toBe(true);
    if (!("doc" in parsed)) return;
    expect(parsed.doc.title.length).toBeGreaterThan(0);
  });

  it("still routes when a wire has nowhere sensible to go", () => {
    // Two pins on top of each other, boxed in on every side.
    const walls = Array.from({ length: 4 }, (_, i) => ({
      id: `w${i}`,
      x: -100 + i * 50,
      y: -100,
      w: 40,
      h: 200,
    }));
    const path = routeLink(
      { x: 0, y: 0, out: { x: 1, y: 0 }, block: "a" },
      { x: 0, y: 0, out: { x: -1, y: 0 }, block: "b" },
      walls,
    );
    expect(path.length).toBeGreaterThanOrEqual(2);
  });
});


// --- rotation ---------------------------------------------------------------

describe("rotation", () => {
  const decoderDoc = () => {
    const doc = emptyDocument("Turn");
    const d = addFromPalette(doc, "decoder", 40, 40);
    return { doc: d!.doc, id: d!.id };
  };

  it("is absent until something is turned, so an old file still means what it said", () => {
    const { doc, id } = decoderDoc();
    expect(doc.instances[id]!.rotation).toBeUndefined();
    expect(rotationOf(doc.instances[id]!)).toBe(0);
  });

  it("swaps the placed extents at a quarter turn and not at a half", () => {
    const { doc, id } = decoderDoc();
    const upright = placeDocument(doc, TEXTBOOK).blocks[0]!;
    const quarter = placeDocument(rotateInstances(doc, [id], 90, TEXTBOOK), TEXTBOOK).blocks[0]!;
    const half = placeDocument(rotateInstances(doc, [id], 180, TEXTBOOK), TEXTBOOK).blocks[0]!;
    expect([quarter.w, quarter.h]).toEqual([upright.h, upright.w]);
    expect([half.w, half.h]).toEqual([upright.w, upright.h]);
  });

  it("turns a left-hand pin onto the top edge, facing up", () => {
    const { doc, id } = decoderDoc();
    const placed = placeDocument(rotateInstances(doc, [id], 90, TEXTBOOK), TEXTBOOK);
    const block = placed.blocks[0]!;
    const a0 = block.ports.get("A0")!;
    expect(a0.out).toEqual({ x: 0, y: -1 });
    expect(a0.y).toBeCloseTo(block.y, 5);
    expect(a0.ay).toBeLessThan(a0.y);
  });

  it("keeps the centre still to within a grid step, so a turn is not also a move", () => {
    const { doc, id } = decoderDoc();
    const before = placeDocument(doc, TEXTBOOK).blocks[0]!;
    const after = placeDocument(rotateInstances(doc, [id], 90, TEXTBOOK), TEXTBOOK).blocks[0]!;
    // Exactly still would mean landing off the grid, which is worse: a turned
    // block has to keep lining up with everything that was not turned.
    expect(Math.abs(after.x + after.w / 2 - (before.x + before.w / 2))).toBeLessThanOrEqual(4);
    expect(Math.abs(after.y + after.h / 2 - (before.y + before.h / 2))).toBeLessThanOrEqual(4);
  });

  it("comes back to where it started after four turns", () => {
    const { doc, id } = decoderDoc();
    let turned = doc;
    for (let i = 0; i < 4; i++) turned = rotateInstances(turned, [id], 90, TEXTBOOK);
    expect(rotationOf(turned.instances[id]!)).toBe(0);
    expect(turned.instances[id]!.x).toBe(doc.instances[id]!.x);
    expect(turned.instances[id]!.y).toBe(doc.instances[id]!.y);
  });

  it("normalises a negative turn instead of storing one", () => {
    const { doc, id } = decoderDoc();
    expect(rotationOf(rotateInstances(doc, [id], -90, TEXTBOOK).instances[id]!)).toBe(270);
  });

  it("sets an absolute angle, and doing it twice changes nothing", () => {
    const { doc, id } = decoderDoc();
    const once = setRotation(doc, id, 180, TEXTBOOK);
    expect(setRotation(once, id, 180, TEXTBOOK)).toBe(once);
  });

  it("is cleared by arranging, because a laid-out sheet is an upright one", () => {
    const { doc, id } = decoderDoc();
    const turned = rotateInstances(doc, [id], 90, TEXTBOOK);
    const upright = clearRotations(turned);
    expect("rotation" in upright.instances[id]!).toBe(false);
    // And nothing to do when nothing is turned.
    expect(clearRotations(upright)).toBe(upright);
  });

  it("leaves everything else alone", () => {
    const { doc, id } = decoderDoc();
    expect(rotateInstances(doc, [], 90, TEXTBOOK)).toBe(doc);
    expect(rotateInstances(doc, [id], 360, TEXTBOOK)).toBe(doc);
    expect(rotateInstances(doc, ["nobody"], 90, TEXTBOOK)).toBe(doc);
  });

  it("rotates the port geometry without moving the ports relative to the body", () => {
    const block = blockOf(emptyDocument(), {
      id: "b", part: "mux", values: { sel: 2 }, x: 0, y: 0,
    })!;
    const size = measure(block, TEXTBOOK);
    const upright = placePorts(block, size);
    const turned = placeRotatedPorts(block, size, 270);
    const box = rotatedSize(size, 270);
    for (const [id, p] of turned) {
      const own = upright.get(id)!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(box.w);
      expect(p.y).toBeLessThanOrEqual(box.h);
      // A turn is a rigid motion: the distance from the block's centre cannot change.
      const before = Math.hypot(own.x - size.w / 2, own.y - size.h / 2);
      const after = Math.hypot(p.x - box.w / 2, p.y - box.h / 2);
      expect(after).toBeCloseTo(before, 5);
    }
  });

  it("draws a turned block inside a rotated group with its text put back upright", () => {
    const { doc, id } = decoderDoc();
    const svg = renderSvg(placeDocument(rotateInstances(doc, [id], 90, TEXTBOOK), TEXTBOOK), TEXTBOOK);
    expect(svg).toContain("rotate(90)");
    expect(svg).toContain("rotate(270");
    // Every label is counter-rotated by exactly the block's own turn.
    for (const g of svg.matchAll(/rotate\((\d+) /g)) expect(g[1]).toBe("270");
  });
});

// --- dragging ---------------------------------------------------------------

describe("dragging", () => {
  const twoBlocks = () => {
    let doc = emptyDocument("Drag");
    const a = addFromPalette(doc, "input", 40, 40)!;
    doc = a.doc;
    const b = addFromPalette(doc, "gate", 240, 40)!;
    return { doc: b.doc, a: a.id, b: b.id };
  };

  const origins = (doc: EditorDocument, ids: string[]) =>
    new Map(ids.map((id) => [id, { x: doc.instances[id]!.x, y: doc.instances[id]!.y }]));

  it("places from the ORIGIN, so a run of small moves does not drift", () => {
    const { doc, a } = twoBlocks();
    const from = origins(doc, [a]);
    // Three three-pixel steps. Applied incrementally against the grid each of
    // them would round away to nothing; against the origin they add up to nine.
    let stepwise = doc;
    for (const d of [3, 6, 9]) stepwise = dragInstances(stepwise, from, d, 0);
    expect(stepwise.instances[a]!.x).toBe(48);
    expect(dragInstances(doc, from, 9, 0).instances[a]!.x).toBe(48);
  });

  it("snaps to the grid, and does not when told not to", () => {
    const { doc, a } = twoBlocks();
    const from = origins(doc, [a]);
    expect(dragInstances(doc, from, 5, 5).instances[a]!.x).toBe(48);
    expect(dragInstances(doc, from, 5, 5, true).instances[a]!.x).toBe(45);
  });

  it("never lets a block off the top or left of the sheet", () => {
    const { doc, a } = twoBlocks();
    const moved = dragInstances(doc, origins(doc, [a]), -900, -900, true);
    expect(moved.instances[a]).toMatchObject({ x: 0, y: 0 });
  });

  it("moves a whole selection together", () => {
    const { doc, a, b } = twoBlocks();
    const moved = dragInstances(doc, origins(doc, [a, b]), 80, 0);
    expect(moved.instances[a]!.x).toBe(120);
    expect(moved.instances[b]!.x).toBe(320);
  });

  it("offsets exactly, off the grid, for arrow keys and the magnet", () => {
    const { doc, a } = twoBlocks();
    expect(offsetInstances(doc, [a], 1, -3).instances[a]).toMatchObject({ x: 41, y: 37 });
    expect(offsetInstances(doc, [a], 0, 0)).toBe(doc);
    expect(offsetInstances(doc, [], 5, 5)).toBe(doc);
  });
});

// --- the alignment magnet ---------------------------------------------------

describe("the alignment magnet", () => {
  /** An input tag and a gate, wired, with the gate `off` pixels out of line. */
  const pair = (off: number) => {
    let doc = emptyDocument("Align");
    const a = addFromPalette(doc, "input", 40, 100)!;
    doc = a.doc;
    const g = addFromPalette(doc, "gate", 240, 100 + off)!;
    doc = g.doc;
    const wired = connect(doc, { block: a.id, port: "Y" }, { block: g.id, port: "A" });
    if (!wired.ok) throw new Error(wired.reason);
    return { doc: wired.doc, moving: g.id };
  };

  const gap = (doc: EditorDocument, moving: string) => {
    const ports = portPositions(doc, TEXTBOOK);
    const a = [...ports].find(([k]) => k.endsWith(".Y"))![1];
    const b = ports.get(`${moving}.A`)!;
    return b.ay - a.ay;
  };

  it("closes a gap small enough to be an accident", () => {
    const { doc, moving } = pair(4);
    const before = gap(doc, moving);
    expect(before).not.toBe(0);
    const nudge = alignNudge(doc, [moving], TEXTBOOK);
    expect(nudge.dy).toBe(-before);
    expect(nudge.dx).toBe(0);
  });

  it("leaves a gap big enough to be deliberate", () => {
    const { doc, moving } = pair(60);
    expect(alignNudge(doc, [moving], TEXTBOOK)).toEqual({ dx: 0, dy: 0 });
  });

  it("says nothing about a wire whose two ends both move", () => {
    const { doc, moving } = pair(4);
    const both = Object.keys(doc.instances);
    expect(alignNudge(doc, both, TEXTBOOK)).toEqual({ dx: 0, dy: 0 });
    expect(alignNudge(doc, [], TEXTBOOK)).toEqual({ dx: 0, dy: 0 });
    expect(alignNudge(doc, [moving], TEXTBOOK).dy).not.toBe(0);
  });

  it("takes the offset that straightens the most wires, not the smallest one", () => {
    // Three input tags into one gate, placed so that two of them are 4px above
    // their pin and the third is 1px below its own. A "smallest wins" rule
    // would take the 1 and leave two wires bent; the majority is the answer.
    let doc = emptyDocument("Consensus");
    const g = addFromPalette(doc, "gate", 300, 100)!;
    doc = setValues(g.doc, g.id, { inputs: 3 }).doc;

    const pinY = (port: string) => portPositions(doc, TEXTBOOK).get(`${g.id}.${port}`)!.ay;
    for (const [port, want] of [["A", -4], ["B", -4], ["C", 1]] as const) {
      const target = pinY(port) + want;
      const tag = addFromPalette(doc, "input", 40, 0)!;
      doc = tag.doc;
      // An input tag's pin is at its own vertical centre.
      const at = portPositions(doc, TEXTBOOK).get(`${tag.id}.Y`)!;
      doc = offsetInstances(doc, [tag.id], 0, target - at.ay);
      const r = connect(doc, { block: tag.id, port: "Y" }, { block: g.id, port: port });
      if (!r.ok) throw new Error(r.reason);
      doc = r.doc;
    }

    expect(alignNudge(doc, [g.id], TEXTBOOK).dy).toBe(-4);
  });

  it("lines up a vertical pair on the other axis", () => {
    // A multiplexer's select lines leave downward. Two muxes fed from one
    // decoder underneath want to be lined up left-to-right, not top-to-bottom.
    let doc = emptyDocument("Vertical");
    const a = addFromPalette(doc, "mux", 40, 40)!;
    doc = a.doc;
    const b = addFromPalette(doc, "mux", 40, 300)!;
    doc = b.doc;
    doc = offsetInstances(doc, [b.id], 5, 0);
    const r = connect(doc, { block: a.id, port: "S0" }, { block: b.id, port: "S0" });
    if (!r.ok) throw new Error(r.reason);
    const nudge = alignNudge(r.doc, [b.id], TEXTBOOK);
    expect(nudge.dx).toBe(-5);
    expect(nudge.dy).toBe(0);
  });

  it("takes a junction's axis from the pin at the far end", () => {
    // A junction faces nowhere, so on its own it cannot say whether a wire
    // wants to be level or plumb. The pin it is wired to can.
    let doc = emptyDocument("Junction align");
    const g = addFromPalette(doc, "gate", 40, 40)!;
    doc = g.doc;
    const j = addFromPalette(doc, "node", 240, 40)!;
    doc = j.doc;
    // Three pixels out of line: an accident, not a decision.
    const ports0 = portPositions(doc, TEXTBOOK);
    doc = offsetInstances(doc, [j.id], 0, ports0.get(`${g.id}.Y`)!.ay - ports0.get(`${j.id}.P`)!.ay + 3);
    const r = connect(doc, { block: g.id, port: "Y" }, { block: j.id, port: "P" });
    if (!r.ok) throw new Error(r.reason);
    const gap = () => {
      const ports = portPositions(r.doc, TEXTBOOK);
      return ports.get(`${j.id}.P`)!.ay - ports.get(`${g.id}.Y`)!.ay;
    };
    expect(gap()).toBe(3);
    expect(alignNudge(r.doc, [j.id], TEXTBOOK).dy).toBe(-gap());
    // And from the other side: the gate moving instead of the junction.
    expect(alignNudge(r.doc, [g.id], TEXTBOOK).dy).toBe(gap());
  });

  it("has nothing to say about a wire that turns a corner", () => {
    // A gate's output into a flip-flop's CLOCK, on the underside: no shift of
    // either block can make that one straight, and pretending otherwise would
    // drag blocks around for nothing.
    let doc = emptyDocument("Corner");
    const g = addFromPalette(doc, "gate", 40, 40)!;
    doc = g.doc;
    const ff = addFromPalette(doc, "flipflop", 240, 140)!;
    doc = ff.doc;
    const r = connect(doc, { block: g.id, port: "Y" }, { block: ff.id, port: "CLK" });
    if (!r.ok) throw new Error(r.reason);
    expect(alignNudge(r.doc, [ff.id], TEXTBOOK)).toEqual({ dx: 0, dy: 0 });
  });
});

// --- junctions --------------------------------------------------------------

describe("junctions", () => {
  const withJunction = () => {
    let doc = emptyDocument("Junction");
    const g = addFromPalette(doc, "gate", 40, 40)!;
    doc = g.doc;
    const j = addFromPalette(doc, "node", 240, 60)!;
    doc = j.doc;
    const out = addFromPalette(doc, "output", 400, 60)!;
    doc = out.doc;
    return { doc, gate: g.id, junction: j.id, out: out.id };
  };

  it("takes its direction from the other end, whichever way it was drawn", () => {
    const { doc, gate, junction } = withJunction();
    const forward = connect(doc, { block: gate, port: "Y" }, { block: junction, port: "P" });
    const backward = connect(doc, { block: junction, port: "P" }, { block: gate, port: "Y" });
    expect(forward.ok && Object.values(forward.doc.links)[0]!.from.block).toBe(gate);
    expect(backward.ok && Object.values(backward.doc.links)[0]!.from.block).toBe(gate);
  });

  it("is the source when the other end is an input", () => {
    const { doc, junction, out } = withJunction();
    const r = connect(doc, { block: out, port: "A" }, { block: junction, port: "P" });
    expect(r.ok && Object.values(r.doc.links)[0]!.from.block).toBe(junction);
  });

  it("keeps the drawn order between two junctions, which is all there is to go on", () => {
    let doc = emptyDocument("Two");
    const a = addFromPalette(doc, "node", 40, 40)!;
    doc = a.doc;
    const b = addFromPalette(doc, "node", 200, 40)!;
    doc = b.doc;
    const r = connect(b.doc, { block: b.id, port: "P" }, { block: a.id, port: "P" });
    expect(r.ok && Object.values(r.doc.links)[0]!.from.block).toBe(b.id);
  });

  it("is a point, not a body: a wire may pass straight through where it sits", () => {
    const { doc, gate, junction, out } = withJunction();
    let wired = doc;
    for (const [from, to] of [
      [{ block: gate, port: "Y" }, { block: junction, port: "P" }],
      [{ block: junction, port: "P" }, { block: out, port: "A" }],
    ] as const) {
      const r = connect(wired, from, to);
      if (!r.ok) throw new Error(r.reason);
      wired = r.doc;
    }
    const placed = placeDocument(wired, TEXTBOOK);
    // Both wires end exactly ON the dot rather than standing off it.
    const dot = placed.blocks.find((b) => b.block.id === junction)!;
    const centre = { x: dot.x + dot.w / 2, y: dot.y + dot.h / 2 };
    for (const link of placed.links) {
      const ends = [link.points[0]!, link.points[link.points.length - 1]!];
      const touches = ends.some(
        (p) => Math.abs(p.x - centre.x) < 0.5 && Math.abs(p.y - centre.y) < 0.5,
      );
      expect(touches).toBe(true);
    }
  });

  it("draws as a dot and carries no pin label", () => {
    const { doc, junction } = withJunction();
    const block = blockOf(doc, doc.instances[junction]!)!;
    expect(block.kind).toBe("node");
    expect(block.ports).toHaveLength(1);
    expect(renderSvg(placeDocument(doc, TEXTBOOK), TEXTBOOK)).toContain("<circle");
  });
});
