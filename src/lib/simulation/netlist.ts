import type { GateOp, Strength } from "./logic";
import {
  DEFAULT_BOARD,
  allHoles,
  dipHoles,
  holeKey,
  stripOf,
  type BoardRow,
  type BreadboardSpec,
  type HoleRef,
} from "./breadboard";

/**
 * The circuit document, and the electrical nets derived from it.
 *
 * INVARIANT 1: NETS ARE N-ARY, DERIVED, AND NEVER AUTHORED.
 *
 * A `Wire` is what the user drew. It is a connectivity *assertion* between two
 * endpoints, it is what undo/redo operates on, and its routed path is cosmetic.
 *
 * A `Net` is an equipotential set of pins — everything shorted together. It is
 * recomputed from scratch by union-find on every topology change, and it is
 * where the resolved value, the driver list, and every fault predicate live.
 *
 * Why not point-to-point `source -> target` edges (which is what every graph
 * library would hand you)?
 *   - A Vcc rail is ONE node with fifty connections, not fifty edges.
 *   - An edge has nowhere to store a resolved value or "this net has 2 drivers".
 *   - Every consumer — solver, diagnostics, hover-highlight, the router — would
 *     re-derive the transitive closure independently, with subtly different bugs.
 *   - Every fault we detect (floating input, output short, Vcc/GND collision) is
 *     a one-line predicate over a net's member set. With edges, each one is a
 *     graph traversal.
 *
 * And the corollary that costs people days: DO NOT "optimize" the rebuild into
 * an in-place update. Deleting one wire from a four-wire star may or may not
 * split the net; adding one may merge two large ones. Incremental net surgery is
 * where ghost connections come from — the simulator says two pins are connected
 * and the canvas shows no wire between them. A full rebuild is O(n·α) and takes
 * well under a millisecond.
 *
 * This is also exactly what makes the deferred v2 breadboard purely additive: a
 * 5-hole column strip is just another set of endpoints seeded into the same
 * union-find, and nothing downstream changes.
 */

// --- branded ids so a NodeId can never be passed where a NetId is wanted ----
export type NodeId = string & { readonly __brand: "NodeId" };
export type NetId = string & { readonly __brand: "NetId" };
export type WireId = string & { readonly __brand: "WireId" };

export const asNodeId = (s: string): NodeId => s as NodeId;
export const asNetId = (s: string): NetId => s as NetId;
export const asWireId = (s: string): WireId => s as WireId;

export interface Point {
  readonly x: number;
  readonly y: number;
}

// --- pins -------------------------------------------------------------------

export type PinDirection = "in" | "out" | "pwr" | "gnd" | "nc";

export interface PinSpec {
  /** Physical package pin number, 1-based. 0 for schematic primitives. */
  readonly number: number;
  /** '1A', '1Y', 'VCC', 'GND', 'A', 'Y' … */
  readonly name: string;
  readonly dir: PinDirection;
  readonly strength: Strength;
  /** Offset from the node's origin, in canvas units. */
  readonly offset: Point;
}

export interface PinRef {
  readonly node: NodeId;
  readonly pin: string;
}

/** Separator is explicit: a stray whitespace char here silently corrupts every
 *  net lookup, and the failure looks like "this pin does not exist". */
const PIN_KEY_SEP = "::";

export const pinKey = (p: PinRef): string => `${p.node}${PIN_KEY_SEP}${p.pin}`;

/**
 * A wire endpoint.
 *
 * On a schematic it is always a PIN. On a breadboard a jumper runs hole-to-hole,
 * so it may be a HOLE — and that is the only structural change the board needed.
 * Everything else about it (nets, solver, diagnostics, verification) is untouched,
 * because a hole is just one more thing to seed into the same union-find.
 */
export type Endpoint =
  | { readonly kind: "pin"; readonly ref: PinRef }
  | { readonly kind: "hole"; readonly ref: HoleRef };

export const pinEnd = (ref: PinRef): Endpoint => ({ kind: "pin", ref });
export const holeEnd = (ref: HoleRef): Endpoint => ({ kind: "hole", ref });

export const endpointKey = (e: Endpoint): string =>
  e.kind === "pin" ? pinKey(e.ref) : `h${PIN_KEY_SEP}${holeKey(e.ref)}`;

// --- nodes ------------------------------------------------------------------

interface NodeBase {
  readonly id: NodeId;
  readonly label: string;
  /** Schematic: canvas units. Breadboard: `x` is the COLUMN the part sits in. */
  readonly pos: Point;
  /** Breadboard only: the row a single-pin part is seated in. ICs straddle E/F. */
  readonly boardRow?: BoardRow;
}

/** A schematic gate primitive: AND, OR, NOT… Ideal, so no power pins. */
export interface GateNode extends NodeBase {
  readonly kind: "gate";
  readonly op: GateOp;
  readonly arity: number;
}

/** A 74xx DIP package. Its gates and pinout come from the IC library. */
export interface IcNode extends NodeBase {
  readonly kind: "ic";
  readonly part: string;
}

export interface SwitchNode extends NodeBase {
  readonly kind: "switch";
  readonly state: 0 | 1;
}

export interface LedNode extends NodeBase {
  readonly kind: "led";
}

/** A power rail symbol. Drives at `supply` strength. */
export interface RailNode extends NodeBase {
  readonly kind: "rail";
  readonly rail: "vcc" | "gnd";
}

export type CircuitNode = GateNode | IcNode | SwitchNode | LedNode | RailNode;

/**
 * A node before it has an id.
 *
 * The Omit must DISTRIBUTE over the union. A plain `Omit<CircuitNode, "id">`
 * collapses the union to its COMMON keys, so `state`, `rail`, `op` and `part`
 * all silently vanish and a SwitchNode becomes indistinguishable from a
 * RailNode. This has bitten twice; it lives here now.
 */
export type NodeDraft = CircuitNode extends infer T
  ? T extends CircuitNode
    ? Omit<T, "id">
    : never
  : never;

// --- wires ------------------------------------------------------------------

export interface Wire {
  readonly id: WireId;
  readonly a: Endpoint;
  readonly b: Endpoint;
  /**
   * Router output. PURELY VISUAL — electrical connectivity must never depend on
   * routing success. A wire that fails to route is still a wire, and its net is
   * still merged; the UI just draws it as a straight air-wire.
   */
  readonly path?: readonly Point[];
}

export interface CircuitDocument {
  readonly nodes: Readonly<Record<string, CircuitNode>>;
  readonly wires: Readonly<Record<string, Wire>>;
  /**
   * Null = schematic mode. Set = breadboard mode, in which a node's `pos.x` is a
   * COLUMN and its `pos.y` is unused for ICs (they always straddle the channel).
   */
  readonly board?: BreadboardSpec | null;
}

export const emptyDocument = (): CircuitDocument => ({
  nodes: {},
  wires: {},
  board: null,
});

export const emptyBoard = (): CircuitDocument => ({
  nodes: {},
  wires: {},
  board: DEFAULT_BOARD,
});

// --- nets -------------------------------------------------------------------

export interface Net {
  readonly id: NetId;
  readonly kind: "signal" | "vcc" | "gnd";
  readonly pins: readonly PinRef[];
  /** Pins that can drive: outputs and rails. */
  readonly drivers: readonly PinRef[];
  /** Pins that read: gate inputs, LEDs. */
  readonly loads: readonly PinRef[];
  /** Set when the net shorts Vcc to GND — refuse to simulate it. */
  readonly railShort: boolean;
}

export interface NetIndex {
  readonly nets: readonly Net[];
  /** Stable ordinal per net — the index into the solver's value buffers. */
  readonly ordinalOf: ReadonlyMap<NetId, number>;
  /**
   * endpointKey -> NetId. A pin absent from this map is connected to nothing.
   *
   * `netOfPin` and `netOfEndpoint` are the SAME map: endpointKey() on a pin
   * returns exactly pinKey(), so a hole and a pin can share one index without any
   * of the existing call sites changing.
   */
  readonly netOfPin: ReadonlyMap<string, NetId>;
  readonly netOfEndpoint: ReadonlyMap<string, NetId>;
  readonly vcc: NetId | null;
  readonly gnd: NetId | null;
}

/** Everything the netlist builder needs to know about a node's pins. */
export type PinResolver = (node: CircuitNode) => readonly PinSpec[];

/**
 * Union-find (disjoint set) with union-by-rank and path compression.
 * Near-linear; the whole rebuild is comfortably sub-millisecond.
 */
class DisjointSet {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  add(key: string): void {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.rank.set(key, 0);
    }
  }

  find(key: string): string {
    let root = key;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    // Path compression.
    let cur = key;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;

    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  keys(): string[] {
    return [...this.parent.keys()];
  }
}

/**
 * Rebuild the electrical nets from the document. Called on EVERY topology
 * change — never incrementally patched. See the header comment.
 */
export function buildNetIndex(
  doc: CircuitDocument,
  pinsOf: PinResolver,
): NetIndex {
  const dsu = new DisjointSet();
  const specOf = new Map<string, { spec: PinSpec; ref: PinRef }>();

  // 1. Every pin of every node is a potential net member, even if unwired —
  //    an unconnected input pin still needs to be reportable as floating.
  for (const node of Object.values(doc.nodes)) {
    for (const spec of pinsOf(node)) {
      const ref: PinRef = { node: node.id, pin: spec.name };
      const key = pinKey(ref);
      dsu.add(key);
      specOf.set(key, { spec, ref });
    }
  }

  // 2. THE BREADBOARD. Seed the board's own shorts before any wire is looked at.
  //
  //    This is the whole integration, and it is why Invariant 1 was written the
  //    way it was: a strip is a set of holes that are already shorted, so we just
  //    union them. Nothing downstream — solver, diagnostics, verification — knows
  //    or cares that a board exists.
  if (doc.board) {
    const byStrip = new Map<string, string[]>();
    for (const hole of allHoles(doc.board)) {
      const key = endpointKey(holeEnd(hole));
      dsu.add(key);
      const strip = stripOf(doc.board, hole);
      const bucket = byStrip.get(strip);
      if (bucket) bucket.push(key);
      else byStrip.set(strip, [key]);
    }
    // Every hole on a strip is shorted to every other hole on that strip. Note
    // what is NOT here: any union across the centre channel. A-E and F-J are
    // different strips, which is exactly what lets a DIP straddle the gap without
    // shorting its own pins together.
    for (const holes of byStrip.values()) {
      const first = holes[0] as string;
      for (const key of holes) dsu.union(first, key);
    }

    // 3. A component seated on the board occupies holes, and its pins are shorted
    //    to whatever else is in them.
    for (const node of Object.values(doc.nodes)) {
      for (const seat of seatOf(node, pinsOf)) {
        const pinK = pinKey(seat.pin);
        const holeK = endpointKey(holeEnd(seat.hole));
        if (!specOf.has(pinK)) continue;
        dsu.add(holeK);
        dsu.union(pinK, holeK);
      }
    }
  }

  // 4. Each wire shorts its two endpoints together.
  for (const wire of Object.values(doc.wires)) {
    const ka = endpointKey(wire.a);
    const kb = endpointKey(wire.b);
    // Ignore a wire to a PIN that no longer exists (its node was deleted). A hole
    // always exists for as long as the board does.
    const exists = (e: Endpoint, key: string): boolean =>
      e.kind === "hole" ? true : specOf.has(key);
    if (!exists(wire.a, ka) || !exists(wire.b, kb)) continue;

    dsu.add(ka);
    dsu.add(kb);
    dsu.union(ka, kb);
  }

  // 3. Group members by root. THIS is where nets come into existence.
  const groups = new Map<string, string[]>();
  for (const key of dsu.keys()) {
    const root = dsu.find(key);
    const bucket = groups.get(root);
    if (bucket) bucket.push(key);
    else groups.set(root, [key]);
  }

  // Sort roots so ordinals are reproducible across rebuilds — the solver's
  // Uint8Array indices must not shuffle just because a Map iterated differently.
  const roots = [...groups.keys()].sort();

  const nets: Net[] = [];
  const ordinalOf = new Map<NetId, number>();
  const netOfPin = new Map<string, NetId>();
  let vcc: NetId | null = null;
  let gnd: NetId | null = null;

  roots.forEach((root, ordinal) => {
    const id = asNetId(`net:${ordinal}`);
    const memberKeys = groups.get(root) as string[];

    const pins: PinRef[] = [];
    const drivers: PinRef[] = [];
    const loads: PinRef[] = [];
    let touchesVcc = false;
    let touchesGnd = false;

    for (const key of memberKeys) {
      // Every member of the net is indexed, whether it is a pin or a bare hole.
      // A hole with nothing in it is still a real endpoint — it has a value, it
      // can be probed, and a jumper can be plugged into it.
      netOfPin.set(key, id);

      const entry = specOf.get(key);
      if (!entry) continue; // a hole: no pin spec, so it drives and loads nothing
      const { spec, ref } = entry;

      pins.push(ref);

      switch (spec.dir) {
        case "out":
          drivers.push(ref);
          break;
        case "in":
          loads.push(ref);
          break;
        case "pwr":
          drivers.push(ref);
          touchesVcc = true;
          break;
        case "gnd":
          drivers.push(ref);
          touchesGnd = true;
          break;
        case "nc":
          break;
      }
    }

    // A net carrying both rails is a dead short. Flag it and refuse to give it a
    // value — the value would be a lie either way.
    const railShort = touchesVcc && touchesGnd;
    const kind = railShort
      ? "signal"
      : touchesVcc
        ? "vcc"
        : touchesGnd
          ? "gnd"
          : "signal";

    if (!railShort && touchesVcc) vcc = id;
    if (!railShort && touchesGnd) gnd = id;

    ordinalOf.set(id, ordinal);
    nets.push({ id, kind, pins, drivers, loads, railShort });
  });

  return { nets, ordinalOf, netOfPin, netOfEndpoint: netOfPin, vcc, gnd };
}

/**
 * Which hole each pin of a seated component occupies.
 *
 * An IC straddles the centre channel — see dipHoles. Everything else (switches,
 * LEDs, rails) is a single-pin part that sits in one hole.
 */
export function seatOf(
  node: CircuitNode,
  pinsOf: PinResolver,
): { pin: PinRef; hole: HoleRef }[] {
  const pins = pinsOf(node);
  const col = Math.round(node.pos.x);

  if (node.kind === "ic") {
    const holes = dipHoles({ col }, pins.length);
    return pins
      .map((spec, i) => {
        const hole = holes[i];
        return hole ? { pin: { node: node.id, pin: spec.name }, hole } : null;
      })
      .filter((x): x is { pin: PinRef; hole: HoleRef } => x !== null);
  }

  // A one-pin part occupies a single hole, named by its column and boardRow.
  if (!node.boardRow) return [];
  const row = node.boardRow;
  return pins.map((spec) => ({
    pin: { node: node.id, pin: spec.name },
    hole: { col, row },
  }));
}

/** The net a pin sits on, or null if that pin does not exist. */
export const netOf = (index: NetIndex, ref: PinRef): NetId | null =>
  index.netOfPin.get(pinKey(ref)) ?? null;

export function netById(index: NetIndex, id: NetId): Net | undefined {
  return index.nets.find((n) => n.id === id);
}
