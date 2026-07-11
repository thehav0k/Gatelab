"use client";

import { createStore, useStore } from "zustand";
import { LZ, type Logic } from "@/lib/simulation/logic";
import { endpointKey, pinEnd, type Endpoint, type NetId, type PinRef } from "@/lib/simulation/netlist";

/**
 * The high-frequency store: net values.
 *
 * Deliberately a VANILLA zustand store, not a hook-first one. The point is that
 * it can be read from outside React entirely, so the canvas can repaint wire
 * colours without a single React render.
 *
 * Why this is separate from the circuit store at all: if topology and values
 * lived together and components subscribed broadly, flipping one switch would
 * re-render every SVG node on the board. Here, a component subscribes to ONE
 * net (`useNetValue`), so a switch flip re-renders only the handful of elements
 * whose own value actually changed.
 */

interface SimStoreState {
  values: Uint8Array;
  settled: boolean;
  netOfPin: ReadonlyMap<string, NetId>;
  ordinalOf: ReadonlyMap<NetId, number>;
  /** Bumped on every simulation pass, for anything that wants a coarse signal. */
  tick: number;
}

export const simStore = createStore<SimStoreState>(() => ({
  values: new Uint8Array(0),
  settled: true,
  netOfPin: new Map(),
  ordinalOf: new Map(),
  tick: 0,
}));

/** The value on a pin. Subscribes to that pin's net ONLY. */
export function useNetValue(ref: PinRef | null): Logic {
  return useEndpointValue(ref ? pinEnd(ref) : null);
}

/**
 * The value on any endpoint — a pin, or a hole on the breadboard. One lookup
 * serves both, because endpointKey() on a pin IS pinKey().
 */
export function useEndpointValue(end: Endpoint | null): Logic {
  return useStore(simStore, (s) => {
    if (!end) return LZ;
    const net = s.netOfPin.get(endpointKey(end));
    if (net === undefined) return LZ;
    const ordinal = s.ordinalOf.get(net);
    if (ordinal === undefined) return LZ;
    return (s.values[ordinal] ?? LZ) as Logic;
  });
}

/** Read a pin's value without subscribing — for event handlers and rAF loops. */
export function peekNetValue(ref: PinRef): Logic {
  const s = simStore.getState();
  const net = s.netOfPin.get(endpointKey(pinEnd(ref)));
  if (net === undefined) return LZ;
  const ordinal = s.ordinalOf.get(net);
  if (ordinal === undefined) return LZ;
  return (s.values[ordinal] ?? LZ) as Logic;
}

/** Distinct hues, cycled by net ordinal. */
const WIRE_COLORS = 8;

export interface WirePaint {
  /** Stroke colour. */
  readonly color: string;
  /** Draw the bright halo under the core. */
  readonly glow: boolean;
  /** Fade it back — a LOW wire is real, but it is not the one carrying signal. */
  readonly dim: boolean;
  /** Dash it — a floating net is not a connection you can rely on. */
  readonly dashed: boolean;
}

/**
 * HOW A WIRE IS PAINTED, and the rule that governs it.
 *
 * Colouring purely by logic level made every LOW wire the same dark slate — and
 * on a dark canvas they simply vanished. Fourteen wires were on screen and you
 * could see four. Worse, you could not trace a connection: every HIGH wire was
 * the same green.
 *
 * So a wire takes the colour of its NET, cycled through eight distinct hues —
 * which is exactly why real jumper wire is multicoloured, and for exactly the
 * same reason: so you can follow one connection across a crowded board.
 *
 * BUT THE FAULT COLOURS ARE NOT NEGOTIABLE. A floating (Z) or conflicting (X)
 * net keeps its own unmistakable colour and its own dashing, because a wire that
 * is broken must never be able to look like a wire that is working. Net identity
 * is a convenience; Z and X are the product.
 */
export function wirePaint(value: Logic, netOrdinal: number | null): WirePaint {
  if (value === 2) {
    return { color: "var(--logic-z)", glow: false, dim: false, dashed: true };
  }
  if (value === 3) {
    return { color: "var(--logic-x)", glow: false, dim: false, dashed: false };
  }

  const hue = netOrdinal === null ? 1 : (netOrdinal % WIRE_COLORS) + 1;
  return {
    color: `var(--wire-${hue})`,
    glow: value === 1,
    dim: value === 0,
    dashed: false,
  };
}

/** The ordinal of the net an endpoint sits on — its stable colour index. */
export function useNetOrdinal(end: Endpoint | null): number | null {
  return useStore(simStore, (s) => {
    if (!end) return null;
    const net = s.netOfPin.get(endpointKey(end));
    if (net === undefined) return null;
    return s.ordinalOf.get(net) ?? null;
  });
}

/** The CSS custom property for a logic level. Raw --logic-* token, not --color-*. */
export function logicColor(v: Logic): string {
  switch (v) {
    case 1:
      return "var(--logic-high)";
    case 0:
      return "var(--logic-low)";
    case 2:
      return "var(--logic-z)";
    default:
      return "var(--logic-x)";
  }
}
