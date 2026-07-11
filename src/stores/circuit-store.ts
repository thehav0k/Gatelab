"use client";

import { create } from "zustand";
import { elaborate } from "@/lib/simulation/elaborate";
import { evaluate } from "@/lib/simulation/solver";
import { diagnose, type Diagnostic } from "@/lib/simulation/diagnostics";
import {
  asNodeId,
  asWireId,
  emptyDocument,
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
import { arityOf } from "@/lib/simulation/parts";
import { routeAll, type Route } from "@/lib/simulation/router";
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
type NewNode = SharedDraft extends infer T
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

  addNode: (node: NewNode) => NodeId;
  moveNode: (id: NodeId, pos: Point) => void;
  deleteSelected: () => void;
  select: (ids: readonly NodeId[]) => void;
  toggleSwitch: (id: NodeId) => void;

  clickPin: (ref: PinRef) => void;
  cancelWire: () => void;
  deleteWire: (id: WireId) => void;

  load: (doc: CircuitDocument) => void;
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
function simulate(doc: CircuitDocument): {
  index: NetIndex;
  diagnostics: Diagnostic[];
  routes: ReadonlyMap<string, Route | null>;
} {
  const { index, netlist } = elaborate(doc);

  // Switch states live in the document, so the input vector is read from it
  // rather than held separately — one source of truth.
  const inputs = netlist.inputs.map((port) => {
    const node = doc.nodes[port.node];
    return node?.kind === "switch" ? node.state : 0;
  });

  const state = evaluate(netlist, inputs);
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

  // Routing is derived from the same topology, and runs on the same pass. Wires
  // of one net share an id so the router can merge them into a common trunk
  // instead of running them alongside each other.
  const { paths } = routeAll(doc, (wire) => {
    const netId = index.netOfPin.get(pinKey(wire.a));
    return netId ? (index.ordinalOf.get(netId) ?? 0) + 1 : 0;
  });

  return { index, diagnostics, routes: paths };
}

export const useCircuitStore = create<CircuitState>()((set, get) => {
  /** Commit a topology change: push undo, re-simulate, clear redo. */
  const commit = (doc: CircuitDocument): void => {
    const { doc: prev, past } = get();
    const { index, diagnostics, routes } = simulate(doc);
    set({
      doc,
      past: [...past, prev].slice(-100),
      future: [],
      index,
      diagnostics,
      routes,
    });
  };

  return {
    doc: emptyDocument(),
    selection: [],
    pendingPin: null,
    index: null,
    diagnostics: [],
    routes: new Map(),
    past: [],
    future: [],

    addNode: (partial) => {
      const { doc } = get();
      const id = asNodeId(nextId("n"));
      const label = partial.label ?? defaultLabel(doc, partial);
      const node = { ...partial, id, label } as CircuitNode;
      commit({ ...doc, nodes: { ...doc.nodes, [id]: node } });
      return id;
    },

    // Called on mouseup, not on every mousemove — the drag itself is tracked in a
    // ref and written straight to the SVG transform. Writing x/y to the store at
    // 60fps would re-render the canvas 60 times a second.
    moveNode: (id, pos) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (!node) return;
      commit({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, pos } } });
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
      const wires = Object.fromEntries(
        Object.entries(doc.wires).filter(
          ([, w]) => !gone.has(w.a.node) && !gone.has(w.b.node),
        ),
      );
      set({ selection: [] });
      commit({ nodes, wires });
    },

    select: (ids) => set({ selection: ids }),

    toggleSwitch: (id) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (node?.kind !== "switch") return;
      commit({
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: { ...node, state: node.state === 1 ? 0 : 1 },
        },
      });
    },

    clickPin: (ref) => {
      const { pendingPin, doc } = get();

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
      set({ pendingPin: null });
      commit({
        ...doc,
        wires: { ...doc.wires, [id]: { id, a: pendingPin, b: ref } },
      });
    },

    cancelWire: () => set({ pendingPin: null }),

    deleteWire: (id) => {
      const { doc } = get();
      const wires = { ...doc.wires };
      delete wires[id];
      commit({ ...doc, wires });
    },

    load: (doc) => {
      const { index, diagnostics, routes } = simulate(doc);
      set({ doc, index, diagnostics, routes, past: [], future: [], selection: [], pendingPin: null });
    },

    clear: () => {
      const doc = emptyDocument();
      const { index, diagnostics, routes } = simulate(doc);
      set({ doc, index, diagnostics, routes, past: [], future: [], selection: [], pendingPin: null });
    },

    undo: () => {
      const { past, doc, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      const { index, diagnostics, routes } = simulate(prev);
      set({
        doc: prev,
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
      const { index, diagnostics, routes } = simulate(next);
      set({
        doc: next,
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
});

/** Convenience for the palette. */
export const gateNode = (op: GateOp, pos: Point, arity = 2) => ({
  kind: "gate" as const,
  op,
  arity: arityOf(op, arity),
  pos,
});
