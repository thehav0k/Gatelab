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
  type Wire,
  type WireId,
} from "@/lib/simulation/netlist";
import type { GateOp } from "@/lib/simulation/logic";
import { arityOf, gateInputNames } from "@/lib/simulation/parts";
import { routeAll, type Route } from "@/lib/simulation/router";
import { placeOnBreadboard, seatOnBoard } from "@/lib/simulation/place";
import {
  DEFAULT_BOARD,
  dipHoles,
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
  /** Drive one clock node to a new level. Not an edit (does not pollute undo). */
  setClock: (id: NodeId, to: (level: 0 | 1) => 0 | 1) => void;
  /** Toggle a clock once: one edge. */
  toggleClock: (id: NodeId) => void;
  /** Low, high, low — one complete pulse, so both edges happen. In UI, flashes high for ~120ms. */
  pulseClock: (id: NodeId, sync?: boolean) => void;
  /** Synchronous low, high, low pulse without timers. */
  pulseClockSync: (id: NodeId) => void;
  /** Pulse active-low CLR/RESET switches (1 -> 0 -> 1) or seed flip-flops to 0. */
  pulseClear: () => void;
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
  setLedColor: (id: NodeId, color: string) => void;
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
  const pulseTimers = new Map<NodeId, ReturnType<typeof setTimeout>>();
  const clearAllPulseTimers = (): void => {
    for (const timer of pulseTimers.values()) clearTimeout(timer);
    pulseTimers.clear();
  };

  /** Drive one clock node to a new level and re-simulate. Not an edit. */
  const setClock = (id: NodeId, to: (level: 0 | 1) => 0 | 1): void => {
    const { doc, flopState } = get();
    const node = doc.nodes[id];
    if (node?.kind !== "clock") return;
    const level = to(node.state);
    if (level === node.state) return;
    const nextDoc = {
      ...doc,
      nodes: { ...doc.nodes, [id]: { ...node, state: level } },
    };
    const next = simulate(nextDoc, flopState);
    set({
      doc: nextDoc,
      index: next.index,
      diagnostics: next.diagnostics,
      routes: next.routes,
      flopState: next.flopState,
    });
  };

  const pulseClockSync = (id: NodeId): void => {
    const { doc } = get();
    const node = doc.nodes[id];
    if (node?.kind !== "clock") return;
    const existing = pulseTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      pulseTimers.delete(id);
    }
    if (node.state === 1) {
      setClock(id, () => 0);
    }
    setClock(id, () => 1);
    setClock(id, () => 0);
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

      if (doc.board && node.kind === "ic") {
        const oldCol = Math.round(node.pos.x);
        const newCol = Math.round(pos.x);
        const delta = newCol - oldCol;

        if (delta !== 0) {
          const def = getIc(node.part);
          const pinTotal = def ? def.pins.length : 14;
          const span = pinTotal / 2;
          const terminalRows = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);

          const shiftEndpoint = (end: (typeof doc.wires)[string]["a"]) => {
            if (
              end.kind === "hole" &&
              terminalRows.has(end.ref.row) &&
              end.ref.col >= oldCol &&
              end.ref.col < oldCol + span
            ) {
              return {
                ...end,
                ref: {
                  ...end.ref,
                  col: end.ref.col + delta,
                },
              };
            }
            return end;
          };

          const nextWires: Record<string, Wire> = {};
          for (const [wId, wire] of Object.entries(doc.wires)) {
            nextWires[wId] = {
              ...wire,
              a: shiftEndpoint(wire.a),
              b: shiftEndpoint(wire.b),
            };
          }

          commit(
            {
              ...doc,
              nodes: { ...doc.nodes, [id]: { ...node, pos } },
              wires: nextWires,
            },
            true,
          );
          return;
        }
      }

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
      const deletedIcStrips = new Set<string>();
      if (doc.board) {
        for (const id of selection) {
          const node = doc.nodes[id];
          if (node?.kind === "ic") {
            const def = getIc(node.part);
            const holes = dipHoles({ col: Math.round(node.pos.x) }, def?.pins.length ?? 14);
            for (const h of holes) deletedIcStrips.add(stripOf(doc.board, h));
          }
        }
      }

      const nodes = Object.fromEntries(
        Object.entries(doc.nodes).filter(([id]) => !gone.has(id)),
      );
      const touches = (e: (typeof doc.wires)[string]["a"]): boolean => {
        if (e.kind === "pin") return gone.has(e.ref.node);
        if (doc.board && deletedIcStrips.size > 0) {
          return deletedIcStrips.has(stripOf(doc.board, e.ref));
        }
        return false;
      };
      const wires = Object.fromEntries(
        Object.entries(doc.wires).filter(([, w]) => !touches(w.a) && !touches(w.b)),
      );
      set({ selection: [] });
      commit({ ...doc, nodes, wires });
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

    setClock,
    toggleClock: (id) => setClock(id, (level) => (level === 1 ? 0 : 1)),

    /**
     * One complete pulse, as two separate evaluations.
     *
     * In browser, keeps the high state for ~120ms so the user visibly sees the
     * clock LED indicator and wire glow before returning to low.
     * For synchronous execution (headless/tests), pass sync=true or call pulseClockSync.
     */
    pulseClock: (id, sync = false) => {
      if (sync || typeof window === "undefined") {
        pulseClockSync(id);
        return;
      }
      const { doc } = get();
      const node = doc.nodes[id];
      if (node?.kind !== "clock") return;

      const existing = pulseTimers.get(id);
      if (existing) {
        clearTimeout(existing);
        pulseTimers.delete(id);
      }
      if (node.state === 1) {
        setClock(id, () => 0);
      }
      setClock(id, () => 1);
      const timer = setTimeout(() => {
        pulseTimers.delete(id);
        setClock(id, () => 0);
      }, 120);
      pulseTimers.set(id, timer);
    },

    pulseClockSync,

    pulseClear: () => {
      clearAllPulseTimers();
      const { doc, flopState } = get();
      const clrSwitches = Object.values(doc.nodes).filter(
        (n): n is Extract<CircuitNode, { kind: "switch" }> =>
          n.kind === "switch" && /^(CLR|RESET|RST|CLEAR)/i.test(n.label),
      );
      if (clrSwitches.length > 0) {
        const assertedNodes = { ...doc.nodes };
        for (const sw of clrSwitches) assertedNodes[sw.id] = { ...sw, state: 0 };
        const mid = simulate({ ...doc, nodes: assertedNodes }, flopState);

        const releasedNodes = { ...doc.nodes };
        for (const sw of clrSwitches) releasedNodes[sw.id] = { ...sw, state: 1 };
        const finalDoc = { ...doc, nodes: releasedNodes };
        const next = simulate(finalDoc, mid.flopState);
        set({
          doc: finalDoc,
          index: next.index,
          diagnostics: next.diagnostics,
          routes: next.routes,
          flopState: next.flopState,
        });
        return;
      }

      const { netlist } = elaborate(doc);
      const seeded: Record<string, readonly [0, 0]> = {};
      for (const flop of netlist.flops) {
        seeded[`${flop.owner.node}/${flop.owner.slot}`] = [0, 0];
      }
      const next = simulate(doc, seeded);
      set({
        flopState: next.flopState,
        index: next.index,
        diagnostics: next.diagnostics,
        routes: next.routes,
      });
    },

    resetState: () => {
      clearAllPulseTimers();
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
        let wireColor = get().activeWireColor ?? undefined;
        const targetNode = doc.nodes[ref.node];
        if (!wireColor && targetNode) {
          if (targetNode.kind === "clock") wireColor = "#f59e0b";
          else if (targetNode.kind === "rail" && targetNode.rail === "vcc") wireColor = "#ef4444";
          else if (targetNode.kind === "rail" && targetNode.rail === "gnd") wireColor = "#3b82f6";
        }
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
        const sourceNode = doc.nodes[pendingPin.node];
        if (!color && sourceNode) {
          if (sourceNode.kind === "clock") color = "#f59e0b";
          else if (sourceNode.kind === "rail" && sourceNode.rail === "vcc") color = "#ef4444";
          else if (sourceNode.kind === "rail" && sourceNode.rail === "gnd") color = "#3b82f6";
        } else if (isPositiveRail(hole.row)) {
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
      clearAllPulseTimers();
      const { doc } = get();
      if (doc.board) return [];

      const { doc: placed, unplaced } = spec
        ? placeOnBreadboard(doc, spec, { panelMode: true })
        : placeOnBreadboard(doc, DEFAULT_BOARD, { panelMode: true });
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
      clearAllPulseTimers();
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

    setLedColor: (id, color) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (!node || node.kind !== "led") return;
      commit(
        {
          ...doc,
          nodes: {
            ...doc.nodes,
            [id]: { ...node, color },
          },
        },
        true,
      );
    },

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
      const spec = doc.board;
      const def = getIc(node.part);
      if (!def) return;

      const nextNodes = { ...doc.nodes };
      const nextWires = { ...doc.wires };
      const taken = new Set<string>();

      for (const n of Object.values(nextNodes)) {
        if (n.kind === "ic") {
          const d = getIc(n.part);
          for (const h of dipHoles({ col: Math.round(n.pos.x) }, d?.pins.length ?? 14)) {
            taken.add(`${h.col}/${h.row}`);
          }
        }
      }
      for (const w of Object.values(nextWires)) {
        if (w.a.kind === "hole") taken.add(`${w.a.ref.col}/${w.a.ref.row}`);
        if (w.b.kind === "hole") taken.add(`${w.b.ref.col}/${w.b.ref.row}`);
      }

      const pickFree = (col: number, rows: readonly ("A" | "B" | "C" | "D" | "G" | "H" | "I" | "J")[]): HoleRef => {
        for (const r of rows) {
          if (!taken.has(`${col}/${r}`)) {
            taken.add(`${col}/${r}`);
            return { col, row: r };
          }
        }
        return { col, row: rows[0]! };
      };

      const pickFreeRail = (targetCol: number, row: "+top" | "-top" | "+bottom" | "-bottom"): HoleRef => {
        const targetStrip = stripOf(spec, { col: targetCol, row });
        for (let d = 0; d < spec.columns; d++) {
          for (const c of d === 0 ? [targetCol] : [targetCol + d, targetCol - d]) {
            if (c >= 1 && c <= spec.columns) {
              const cand: HoleRef = { col: c, row };
              if (stripOf(spec, cand) === targetStrip && !taken.has(`${c}/${row}`)) {
                taken.add(`${c}/${row}`);
                return cand;
              }
            }
          }
        }
        return { col: targetCol, row };
      };

      // Ensure +5V and GND trainer rail nodes exist and feed the breadboard rails
      let vccNode = Object.values(nextNodes).find((n) => n.kind === "rail" && n.rail === "vcc");
      if (!vccNode) {
        const id = asNodeId(nextId("n"));
        vccNode = { id, kind: "rail", rail: "vcc", label: "+5V", pos: { x: 0, y: 0 } };
        nextNodes[id] = vccNode;
      }
      let gndNode = Object.values(nextNodes).find((n) => n.kind === "rail" && n.rail === "gnd");
      if (!gndNode) {
        const id = asNodeId(nextId("n"));
        gndNode = { id, kind: "rail", rail: "gnd", label: "GND", pos: { x: 0, y: 0 } };
        nextNodes[id] = gndNode;
      }

      const hasVccFeed = Object.values(nextWires).some(
        (w) =>
          (w.a.kind === "pin" && w.a.ref.node === vccNode.id) ||
          (w.b.kind === "pin" && w.b.ref.node === vccNode.id),
      );
      if (!hasVccFeed) {
        const wFeed = asWireId(nextId("w"));
        const wBridge = asWireId(nextId("w"));
        nextWires[wFeed] = {
          id: wFeed,
          a: pinEnd({ node: vccNode.id, pin: "VCC" }),
          b: holeEnd(pickFreeRail(1, "+top")),
          color: "#ef4444",
        };
        nextWires[wBridge] = {
          id: wBridge,
          a: holeEnd(pickFreeRail(1, "+top")),
          b: holeEnd(pickFreeRail(1, "+bottom")),
          color: "#ef4444",
        };
      }

      const hasGndFeed = Object.values(nextWires).some(
        (w) =>
          (w.a.kind === "pin" && w.a.ref.node === gndNode.id) ||
          (w.b.kind === "pin" && w.b.ref.node === gndNode.id),
      );
      if (!hasGndFeed) {
        const wFeed = asWireId(nextId("w"));
        const wBridge = asWireId(nextId("w"));
        nextWires[wFeed] = {
          id: wFeed,
          a: pinEnd({ node: gndNode.id, pin: "GND" }),
          b: holeEnd(pickFreeRail(1, "-bottom")),
          color: "#3b82f6",
        };
        nextWires[wBridge] = {
          id: wBridge,
          a: holeEnd(pickFreeRail(1, "-top")),
          b: holeEnd(pickFreeRail(1, "-bottom")),
          color: "#3b82f6",
        };
      }

      // Bridge split rail segments if needed
      if (spec.railSegments > 1) {
        const perSegment = Math.ceil(spec.columns / spec.railSegments);
        for (let seg = 1; seg < spec.railSegments; seg++) {
          const cLeft = seg * perSegment;
          const cRight = cLeft + 1;
          if (cRight <= spec.columns) {
            for (const r of ["+top", "-top", "+bottom", "-bottom"] as const) {
              const alreadyBridged = Object.values(nextWires).some(
                (w) =>
                  w.a.kind === "hole" &&
                  w.b.kind === "hole" &&
                  w.a.ref.row === r &&
                  w.b.ref.row === r &&
                  Math.min(w.a.ref.col, w.b.ref.col) <= cLeft &&
                  Math.max(w.a.ref.col, w.b.ref.col) >= cRight,
              );
              if (!alreadyBridged) {
                const wb = asWireId(nextId("w"));
                nextWires[wb] = {
                  id: wb,
                  a: holeEnd(pickFreeRail(cLeft, r)),
                  b: holeEnd(pickFreeRail(cRight, r)),
                  color: isPositiveRail(r) ? "#ef4444" : "#3b82f6",
                };
              }
            }
          }
        }
      }

      const col = Math.round(node.pos.x);
      const holes = dipHoles({ col }, def.pins.length);
      const vccIdx = def.pins.findIndex((p) => p.dir === "pwr");
      const gndIdx = def.pins.findIndex((p) => p.dir === "gnd");
      if (vccIdx === -1 || gndIdx === -1) return;

      const vccLeg = holes[vccIdx]!;
      const gndLeg = holes[gndIdx]!;

      const vccHole = pickFree(vccLeg.col, vccLeg.row === "F" ? ["G", "H", "I", "J"] : ["D", "C", "B", "A"]);
      const vccRail = pickFreeRail(vccLeg.col, vccLeg.row === "F" ? "+top" : "+bottom");
      const gndHole = pickFree(gndLeg.col, gndLeg.row === "E" ? ["D", "C", "B", "A"] : ["G", "H", "I", "J"]);
      const gndRail = pickFreeRail(gndLeg.col, gndLeg.row === "E" ? "-bottom" : "-top");

      const w1 = asWireId(nextId("w"));
      const w2 = asWireId(nextId("w"));
      nextWires[w1] = { id: w1, a: holeEnd(vccHole), b: holeEnd(vccRail), color: "#ef4444" };
      nextWires[w2] = { id: w2, a: holeEnd(gndHole), b: holeEnd(gndRail), color: "#3b82f6" };

      commit({ ...doc, nodes: nextNodes, wires: nextWires });
    },

    load: (doc, origin = null) => {
      clearAllPulseTimers();
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
      clearAllPulseTimers();
      const currentDoc = get().doc;
      const nextDoc = emptyDocument();
      const { index, diagnostics, routes, flopState } = simulate(nextDoc, {});
      set({
        doc: nextDoc,
        origin: null,
        flopState,
        schematic: null,
        index,
        diagnostics,
        routes,
        past: [...get().past, currentDoc],
        future: [],
        selection: [],
        pendingPin: null,
        pendingHole: null,
      });
    },

    undo: () => {
      clearAllPulseTimers();
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
      clearAllPulseTimers();
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
      partialize: (s) => ({
        doc: s.doc,
        schematic: s.schematic,
        origin: s.origin,
        flopState: s.flopState,
      }),

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
