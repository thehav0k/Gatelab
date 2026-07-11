import type { GateOp, Strength } from "./logic";

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

// --- nodes ------------------------------------------------------------------

interface NodeBase {
  readonly id: NodeId;
  readonly label: string;
  readonly pos: Point;
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

// --- wires ------------------------------------------------------------------

export interface Wire {
  readonly id: WireId;
  readonly a: PinRef;
  readonly b: PinRef;
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
}

export const emptyDocument = (): CircuitDocument => ({ nodes: {}, wires: {} });

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
  /** pinKey -> NetId. A pin absent from this map is connected to nothing. */
  readonly netOfPin: ReadonlyMap<string, NetId>;
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

  // 2. Each wire shorts its two endpoints together.
  for (const wire of Object.values(doc.wires)) {
    const ka = pinKey(wire.a);
    const kb = pinKey(wire.b);
    // Ignore a wire to a pin that no longer exists (the node was deleted).
    if (!specOf.has(ka) || !specOf.has(kb)) continue;
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
      const entry = specOf.get(key);
      if (!entry) continue;
      const { spec, ref } = entry;

      pins.push(ref);
      netOfPin.set(key, id);

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

  return { nets, ordinalOf, netOfPin, vcc, gnd };
}

/** The net a pin sits on, or null if that pin does not exist. */
export const netOf = (index: NetIndex, ref: PinRef): NetId | null =>
  index.netOfPin.get(pinKey(ref)) ?? null;

export function netById(index: NetIndex, id: NetId): Net | undefined {
  return index.nets.find((n) => n.id === id);
}
