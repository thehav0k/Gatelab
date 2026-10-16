"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { elaborate } from "@/lib/simulation/elaborate";
import {
  evaluate,
  fromSeqState,
  toSeqState,
  type StoredState,
} from "@/lib/simulation/solver";
import { diagnose, type Diagnostic } from "@/lib/simulation/diagnostics";
import {
  asNodeId,
  asWireId,
  emptyDocument,
  endpointKey,
  holeEnd,
  pinEnd,
  pinKey,
  type CircuitDocument,
  type CircuitNode,
  type NetIndex,
  type NodeDraft as SharedDraft,
  type NodeId,
  type PinRef,
  type Point,
  type WireId,
} from "@/lib/simulation/netlist";
import type { GateOp } from "@/lib/simulation/logic";
import { arityOf, gateInputNames } from "@/lib/simulation/parts";
import { routeAll, type Route } from "@/lib/simulation/router";
import { placeOnBreadboard, seatOnBoard } from "@/lib/simulation/place";
import {
  holeKey,
  isPositiveRail,
  stripOf,
  type BreadboardSpec,
  type HoleRef,
} from "@/lib/simulation/breadboard";
import { getIc } from "@/lib/simulation/ic-library";
import { simStore } from "./sim-store";

/**
 * The circuit DOCUMENT store — topology and geometry. Changes only when the user
 * edits, which is rare compared to simulation ticks.
 *
 * Net values live in a separate store (sim-store) precisely so that flipping one
 * switch does not re-render all 400 SVG nodes. See the note there.
 *
 * Undo/redo is a plain snapshot stack. Circuits are kilobytes; immer patches or
 * zundo would be machinery we do not need.
 */

/** A node draft with the label optional too — the store invents one if omitted. */
export type NewNode = SharedDraft extends infer T
  ? T extends SharedDraft
    ? Omit<T, "label"> & { label?: string }
    : never
  : never;

interface CircuitState {
  doc: CircuitDocument;
  selection: readonly NodeId[];
  /** Pin the user clicked first, while drawing a wire. */
  pendingPin: PinRef | null;
  index: NetIndex | null;
  diagnostics: readonly Diagnostic[];
  /**
   * Wire id -> its routed path, or null when no route exists.
   *
   * DERIVED, exactly like the nets — and deliberately NOT stored in the document.
   * A route is cosmetic: it must never enter undo history (nobody wants to undo a
   * bend), and connectivity must never depend on it. A wire that fails to route is
   * still a wire; the canvas just draws it straight.
   */
  routes: ReadonlyMap<string, Route | null>;

  past: CircuitDocument[];
  future: CircuitDocument[];

  /** How many inputs the next gate dropped from the palette gets (2, 3 or 4). */
  gateInputs: number;
  setGateInputs: (n: number) => void;

  /**
   * Add a part. `null` means the breadboard had no room for it — the caller must
   * say so, because the alternative is a part that exists in the netlist and
   * cannot be seen anywhere on the board.
   */
  addNode: (node: NewNode) => NodeId | null;
  moveNode: (id: NodeId, pos: Point) => void;
  /** Change how many inputs a gate has. Ignored for NOT/BUF (always 1). */
  setGateArity: (id: NodeId, arity: number) => void;
  deleteSelected: () => void;
  select: (ids: readonly NodeId[]) => void;
  toggleSwitch: (id: NodeId) => void;

  /**
   * What every flip-flop is storing, keyed by chip and slot.
   *
   * In the store rather than recomputed because it is the one thing a circuit
   * knows that its document does not — the whole difference between a gate and
   * a flip-flop.
   */
  flopState: StoredState;
  /** Toggle a clock once: one edge. */
  toggleClock: (id: NodeId) => void;
  /** Low, high, low — one complete pulse, so both edges happen. */
  pulseClock: (id: NodeId) => void;
  /** Forget every stored bit, as though the power had just come on. */
  resetState: () => void;

  clickPin: (ref: PinRef) => void;
  /** The breadboard equivalent: click one hole, then another, to lay a jumper. */
  clickHole: (hole: HoleRef) => void;
  pendingHole: HoleRef | null;
  cancelWire: () => void;
  deleteWire: (id: WireId) => void;
  setWireColor: (id: WireId, color?: string) => void;
  activeWireColor: string | null;
  setActiveWireColor: (color: string | null) => void;
  rotateNode: (id: NodeId, delta?: 90 | -90) => void;
  flipNode: (id: NodeId, axis: "x" | "y") => void;
  autoWireIcPower: (nodeId: string) => void;
  /**
   * The SCHEMATIC this board was seated from, kept so the view can switch back.
   *
   * Going to the breadboard is a *realization*, and it throws information away —
   * the schematic's layout has no counterpart on a board. So rather than try to
   * reverse it (which would have to invent a layout the circuit never had), we
   * simply keep the original and hand it back.
   */
  schematic: CircuitDocument | null;
  /** Re-seat the current schematic onto a real breadboard. */
  toBreadboard: (spec?: BreadboardSpec) => readonly string[];
  /** Return to the schematic this board came from. */
  toSchematic: () => boolean;

  /**
   * The expression this board was SYNTHESIZED from, or null if a human wired it.
   *
   * This is what makes it safe to re-synthesize when the gate rule changes. Silently
   * rewriting a circuit somebody built by hand is unforgivable — but a circuit the
   * app generated is not their work, it is the app's answer to a question, and when
   * the question changes ("NAND only now") the answer must change with it.
   *
   * So provenance is not a nicety here: it is exactly the line between "obey the new
   * rule" and "destroy the user's board".
   */
  origin: string | null;

  load: (doc: CircuitDocument, origin?: string | null) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
}

let counter = 0;
const nextId = (prefix: string): string => `${prefix}${(counter += 1)}`;

/** Default labels: switches get A, B, C…; everything else gets a typed serial. */
function defaultLabel(doc: CircuitDocument, node: NewNode): string {
  const existing = Object.values(doc.nodes);

  if (node.kind === "switch") {
    const used = new Set(existing.filter((n) => n.kind === "switch").map((n) => n.label));
    for (let i = 0; i < 26; i++) {
      const name = String.fromCharCode(65 + i);
      if (!used.has(name)) return name;
    }
    return nextId("SW");
  }

  if (node.kind === "led") {
    const n = existing.filter((x) => x.kind === "led").length;
    return n === 0 ? "Q" : `Q${n}`;
  }

  const prefix =
    node.kind === "ic" ? "U" : node.kind === "rail" ? (node.rail === "vcc" ? "V" : "GND") : "G";
  const n = existing.filter((x) => x.kind === node.kind).length + 1;
  return `${prefix}${n}`;
}

/**
 * Rebuild the nets and re-run the simulation.
 *
 * Always a full rebuild — never an in-place net patch (Invariant 1). It is
 * sub-millisecond, and incremental net surgery is where ghost connections come
 * from.
 */
function simulate(
  doc: CircuitDocument,
  stored?: StoredState,
): {
  index: NetIndex;
  diagnostics: Diagnostic[];
  routes: ReadonlyMap<string, Route | null>;
  flopState: StoredState;
} {
  const { index, netlist } = elaborate(doc);

  // Switch states live in the document, so the input vector is read from it
  // rather than held separately — one source of truth.
  const inputs = netlist.inputs.map((port) => {
    const node = doc.nodes[port.node];
    return node?.kind === "switch" ? node.state : 0;
  });

  // Sequential state is carried IN and back OUT. A flip-flop is the one thing
  // here whose output is not a function of the document alone.
  const state = evaluate(netlist, inputs, { state: toSeqState(netlist, stored) });
  const diagnostics = diagnose(doc, index, netlist, state);

  // Push values into the high-frequency store. React does not subscribe to this
  // broadly — the canvas paints from it per-net.
  simStore.setState({
    values: state.values,
    settled: state.settled,
    netOfPin: index.netOfPin,
    ordinalOf: index.ordinalOf,
    tick: simStore.getState().tick + 1,
  });

  // Routing is a SCHEMATIC concern. On a breadboard a jumper is a physical wire
  // between two holes — it arcs over everything, it does not route around
  // obstacles, and pretending otherwise would be drawing a schematic on top of a
  // photograph of a board.
  const routes = doc.board
    ? new Map<string, Route | null>()
    : routeAll(doc, (wire) => {
        const netId = index.netOfEndpoint.get(endpointKey(wire.a));
        return netId ? (index.ordinalOf.get(netId) ?? 0) + 1 : 0;
      }).paths;

  return { index, diagnostics, routes, flopState: fromSeqState(netlist, state.state) };
}

export const useCircuitStore = create<CircuitState>()(
  persist(
    (set, get) => {
  /**
   * Commit a topology change: push undo, re-simulate, clear redo.
   *
   * And DROP THE PROVENANCE. The moment a human adds a gate or cuts a wire, this is
   * no longer the circuit the synthesizer produced, and re-synthesizing it on a rule
   * change would throw their work away. `keepOrigin` is for the edits that change no
   * topology at all — dragging a chip, flipping a switch — where the board is still
   * exactly what was built.
   */
  /** Drive one clock node to a new level and re-simulate. Not an edit. */
  const setClock = (id: NodeId, to: (level: 0 | 1) => 0 | 1): void => {
    const { doc } = get();
    const node = doc.nodes[id];
    if (node?.kind !== "clock") return;
    const level = to(node.state);
    if (level === node.state) return;
    commit(
      { ...doc, nodes: { ...doc.nodes, [id]: { ...node, state: level } } },
      true,
    );
  };

  const commit = (doc: CircuitDocument, keepOrigin = false): void => {
    const { doc: prev, past, origin, flopState } = get();
    // The stored state is carried through every edit. Adding a wire does not
    // make a counter forget what it was counting, and it is keyed by chip and
    // slot so a rebuilt netlist hands each bit back to the flip-flop it came
    // from rather than to whichever one now has that index.
    const next = simulate(doc, flopState);
    set({
      doc,
      past: [...past, prev].slice(-100),
      future: [],
      index: next.index,
      diagnostics: next.diagnostics,
      routes: next.routes,
      flopState: next.flopState,
      origin: keepOrigin ? origin : null,
    });
  };

  return {
    doc: emptyDocument(),
    flopState: {},
    selection: [],
    pendingPin: null,
    pendingHole: null,
    index: null,
    diagnostics: [],
    routes: new Map(),
    schematic: null,
    origin: null,
    gateInputs: 2,
    activeWireColor: null,
    past: [],
    future: [],

    setGateInputs: (n) => set({ gateInputs: Math.min(4, Math.max(2, n)) }),

    addNode: (partial) => {
      const { doc } = get();
      const id = asNodeId(nextId("n"));
      const label = partial.label ?? defaultLabel(doc, partial);
      const node = { ...partial, id, label } as CircuitNode;

      // On a board, a part has to be PLUGGED IN somewhere. Its schematic
      // coordinates mean nothing here — left as they were, the renderer drew
      // the chip at column 420 of a 63-column board and the camera zoomed out
      // to the whole board trying to reach it.
      const placed = doc.board ? seatOnBoard(doc, node, doc.board) : node;
      if (!placed) return null;

      commit({ ...doc, nodes: { ...doc.nodes, [id]: placed } });
      return id;
    },

    // Called on mouseup, not on every mousemove — the drag itself is tracked in a
    // ref and written straight to the SVG transform. Writing x/y to the store at
    // 60fps would re-render the canvas 60 times a second.
    moveNode: (id, pos) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (!node) return;
      // A move is cosmetic. The circuit is still the one that was built.
      commit({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, pos } } }, true);
    },

    setGateArity: (id, arity) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (node?.kind !== "gate") return;
      const next = arityOf(node.op, arity);
      if (next === node.arity) return;
      // Widening a gate is a real topology change — the new input pins start
      // unconnected, so this is NOT a keep-origin edit. Any wire to a pin that no
      // longer exists is dropped when the net index rebuilds.
      const gone = new Set<string>();
      if (next < node.arity) {
        for (let i = next; i < node.arity; i++) gone.add(gateInputNames(node.arity)[i]!);
      }
      const wires = Object.fromEntries(
        Object.entries(doc.wires).filter(([, wire]) => {
          const touches = (e: (typeof wire)["a"]) =>
            e.kind === "pin" && e.ref.node === id && gone.has(e.ref.pin);
          return !touches(wire.a) && !touches(wire.b);
        }),
      );
      commit({ ...doc, wires, nodes: { ...doc.nodes, [id]: { ...node, arity: next } } });
    },

    deleteSelected: () => {
      const { doc, selection } = get();
      if (selection.length === 0) return;

      const gone = new Set<string>(selection);
      const nodes = Object.fromEntries(
        Object.entries(doc.nodes).filter(([id]) => !gone.has(id)),
      );
      // Wires to a deleted node go with it. The nets are rebuilt from scratch
      // afterwards, so there is nothing else to clean up.
      const touches = (e: (typeof doc.wires)[string]["a"]): boolean =>
        e.kind === "pin" && gone.has(e.ref.node);
      const wires = Object.fromEntries(
        Object.entries(doc.wires).filter(([, w]) => !touches(w.a) && !touches(w.b)),
      );
      set({ selection: [] });
      commit({ nodes, wires });
    },

    select: (ids) => set({ selection: ids }),

    toggleSwitch: (id) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (node?.kind !== "switch") return;
      // Flipping a switch is USING the circuit, not editing it.
      commit(
        {
          ...doc,
          nodes: {
            ...doc.nodes,
            [id]: { ...node, state: node.state === 1 ? 0 : 1 },
          },
        },
        true,
      );
    },

    toggleClock: (id) => setClock(id, (level) => (level === 1 ? 0 : 1)),

    /**
     * One complete pulse, as two separate evaluations.
     *
     * It has to be two, not one: a rising-edge part loads on the way up and a
     * falling-edge part on the way down, and a "pulse" that only ever set the
     * level to 1 would leave every '107 in the circuit untouched. Running both
     * halves means one press advances a counter whichever polarity it is.
     */
    pulseClock: (id) => {
      setClock(id, () => 1);
      setClock(id, () => 0);
    },

    /**
     * Power-cycle the memory.
     *
     * Not a document edit — nothing about the circuit changes — so it does not
     * touch the undo stack. It puts every flip-flop back to unknown, which is
     * where a real one starts.
     */
    resetState: () => {
      const { doc } = get();
      const next = simulate(doc, {});
      set({
        flopState: next.flopState,
        index: next.index,
        diagnostics: next.diagnostics,
        routes: next.routes,
      });
    },

    clickPin: (ref) => {
      const { pendingPin, pendingHole, doc } = get();

      if (pendingHole) {
        const id = asWireId(nextId("w"));
        const wireColor = get().activeWireColor ?? undefined;
        set({ pendingHole: null, pendingPin: null });
        commit({
          ...doc,
          wires: {
            ...doc.wires,
            [id]: { id, a: holeEnd(pendingHole), b: pinEnd(ref), ...(wireColor ? { color: wireColor } : {}) },
          },
        });
        return;
      }

      if (!pendingPin) {
        set({ pendingPin: ref });
        return;
      }

      // Clicking the same pin twice cancels.
      if (pinKey(pendingPin) === pinKey(ref)) {
        set({ pendingPin: null });
        return;
      }

      const id = asWireId(nextId("w"));
      const wireColor = get().activeWireColor ?? undefined;
      set({ pendingPin: null });
      commit({
        ...doc,
        wires: {
          ...doc.wires,
          [id]: { id, a: pinEnd(pendingPin), b: pinEnd(ref), ...(wireColor ? { color: wireColor } : {}) },
        },
      });
    },

    clickHole: (hole) => {
      const { pendingPin, pendingHole, doc } = get();

      if (pendingPin) {
        const id = asWireId(nextId("w"));
        let color: string | undefined = get().activeWireColor ?? undefined;
        if (isPositiveRail(hole.row)) {
          color = "#ef4444";
        } else if (hole.row === "-top" || hole.row === "-bottom") {
          color = "#3b82f6";
        }
        set({ pendingPin: null, pendingHole: null });
        commit({
          ...doc,
          wires: {
            ...doc.wires,
            [id]: { id, a: pinEnd(pendingPin), b: holeEnd(hole), ...(color ? { color } : {}) },
          },
        });
        return;
      }

      if (!pendingHole) {
        set({ pendingHole: hole });
        return;
      }
      // Clicking the same hole twice cancels.
      if (holeKey(pendingHole) === holeKey(hole)) {
        set({ pendingHole: null });
        return;
      }
      // A jumper between two holes on the SAME strip does nothing — the metal
      // already connects them. Say so rather than draw a wire that means nothing.
      if (doc.board && stripOf(doc.board, pendingHole) === stripOf(doc.board, hole)) {
        set({ pendingHole: null });
        return;
      }

      let color: string | undefined = get().activeWireColor ?? undefined;
      if (isPositiveRail(pendingHole.row) || isPositiveRail(hole.row)) {
        color = "#ef4444";
      } else if (
        pendingHole.row === "-top" ||
        pendingHole.row === "-bottom" ||
        hole.row === "-top" ||
        hole.row === "-bottom"
      ) {
        color = "#3b82f6";
      }

      const id = asWireId(nextId("w"));
      set({ pendingHole: null });
      commit({
        ...doc,
        wires: {
          ...doc.wires,
          [id]: { id, a: holeEnd(pendingHole), b: holeEnd(hole), ...(color ? { color } : {}) },
        },
      });
    },

    toBreadboard: (spec) => {
      const { doc } = get();
      if (doc.board) return [];

      const { doc: placed, unplaced } = spec
        ? placeOnBreadboard(doc, spec)
        : placeOnBreadboard(doc);
      const { index, diagnostics, routes, flopState } = simulate(placed, get().flopState);
      set({
        doc: placed,
        flopState,
        // Keep the schematic. Seating is a realization, not a translation — the
        // board has no memory of the layout it came from, so the only honest way
        // back is to have kept it.
        schematic: doc,
        index,
        diagnostics,
        routes,
        past: [],
        future: [],
        selection: [],
        pendingPin: null,
        pendingHole: null,
      });
      return unplaced;
    },

    toSchematic: () => {
      const { schematic, doc } = get();
      if (!doc.board) return true; // already there
      if (!schematic) return false; // built on the board; there is nothing to go back to

      const { index, diagnostics, routes, flopState } = simulate(schematic, get().flopState);
      set({
        doc: schematic,
        flopState,
        index,
        diagnostics,
        routes,
        past: [],
        future: [],
        selection: [],
        pendingPin: null,
        pendingHole: null,
      });
      return true;
    },

    cancelWire: () => set({ pendingPin: null, pendingHole: null }),

    deleteWire: (id) => {
      const { doc } = get();
      const wires = { ...doc.wires };
      delete wires[id];
      commit({ ...doc, wires });
    },

    setWireColor: (id, color) => {
      const { doc } = get();
      const wire = doc.wires[id];
      if (!wire) return;
      commit({
        ...doc,
        wires: {
          ...doc.wires,
          [id]: { ...wire, color },
        },
      });
    },

    setActiveWireColor: (color) => set({ activeWireColor: color }),

    rotateNode: (id, delta = 90) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (!node) return;
      const current = node.rotation ?? 0;
      const next = ((((current + delta) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
      commit({
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: { ...node, rotation: next },
        },
      });
    },

    flipNode: (id, axis) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (!node) return;
      const updated =
        axis === "x"
          ? { ...node, flipX: !node.flipX }
          : { ...node, flipY: !node.flipY };
      commit({
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: updated,
        },
      });
    },

    autoWireIcPower: (nodeId) => {
      const { doc } = get();
      const node = doc.nodes[nodeId];
      if (!node || node.kind !== "ic" || !doc.board) return;
      const def = getIc(node.part);
      const pinCount = def?.pins.length ?? 14;
      const col = Math.round(node.pos.x);
      const span = pinCount / 2;

      // Pin 14 (VCC) is in row F at col. Free row on that strip is row J. Nearest positive rail is +top.
      // Pin 7 (GND) is in row E at col + span - 1. Free row on that strip is row A. Nearest ground rail is -bottom.
      const vccHole: HoleRef = { col, row: "J" };
      const vccRail: HoleRef = { col, row: "+top" };
      const gndHole: HoleRef = { col: col + span - 1, row: "A" };
      const gndRail: HoleRef = { col: col + span - 1, row: "-bottom" };

      const w1 = asWireId(nextId("w"));
      const w2 = asWireId(nextId("w"));

      commit({
        ...doc,
        wires: {
          ...doc.wires,
          [w1]: { id: w1, a: holeEnd(vccHole), b: holeEnd(vccRail), color: "#ef4444" },
          [w2]: { id: w2, a: holeEnd(gndHole), b: holeEnd(gndRail), color: "#3b82f6" },
        },
      });
    },

    load: (doc, origin = null) => {
      // A freshly loaded circuit has not been clocked. Carrying the old state in
      // would have its flip-flops start at values from a different circuit.
      const { index, diagnostics, routes, flopState } = simulate(doc, {});
      set({
        doc,
        origin,
        flopState,
        index,
        diagnostics,
        routes,
        // A freshly loaded board did not come from the old one, so the old schematic
        // is not a place it can go "back" to.
        schematic: null,
        past: [],
        future: [],
        selection: [],
        pendingPin: null,
        pendingHole: null,
      });
    },

    clear: () => {
      const doc = emptyDocument();
      const { index, diagnostics, routes, flopState } = simulate(doc, {});
      set({
        doc,
        origin: null,
        flopState,
        schematic: null,
        index,
        diagnostics,
        routes,
        past: [],
        future: [],
        selection: [],
        pendingPin: null,
        pendingHole: null,
      });
    },

    undo: () => {
      const { past, doc, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      const { index, diagnostics, routes, flopState } = simulate(prev, get().flopState);
      set({
        doc: prev,
        flopState,
        past: past.slice(0, -1),
        future: [doc, ...future],
        index,
        diagnostics,
        routes,
        selection: [],
        pendingPin: null,
      });
    },

    redo: () => {
      const { future, doc, past } = get();
      const next = future[0];
      if (!next) return;
      const { index, diagnostics, routes, flopState } = simulate(next, get().flopState);
      set({
        doc: next,
        flopState,
        past: [...past, doc],
        future: future.slice(1),
        index,
        diagnostics,
        routes,
        selection: [],
        pendingPin: null,
      });
    },
      };
    },
    {
      name: "digilab-circuit",

      /**
       * ONLY THE DOCUMENT IS PERSISTED. Nets, routes, diagnostics and simulation
       * values are all DERIVED (Invariants 1 and 6) — storing them would let a
       * stale snapshot outlive the topology it came from, which is precisely the
       * ghost-connection failure the invariants exist to prevent. Undo history is
       * dropped too: nobody expects to reopen a tab and undo yesterday.
       */
      partialize: (s) => ({ doc: s.doc, schematic: s.schematic, origin: s.origin }),

      /**
       * Rehydration must RE-DERIVE, not restore. The document is plain JSON, so it
       * survives the round trip intact; everything else is rebuilt from it exactly
       * as it would be after any other topology change.
       */
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const { index, diagnostics, routes, flopState } = simulate(state.doc, state.flopState);
        useCircuitStore.setState({ index, diagnostics, routes, flopState });
      },
    },
  ),
);

/** Convenience for the palette. */
export const gateNode = (op: GateOp, pos: Point, arity = 2) => ({
  kind: "gate" as const,
  op,
  arity: arityOf(op, arity),
  pos,
});
