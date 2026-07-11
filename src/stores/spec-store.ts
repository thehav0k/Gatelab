"use client";

import { create } from "zustand";
import type { BooleanFunction } from "@/lib/core-engine/types";

/**
 * The function the lab is supposed to be building.
 *
 * Set when the user clicks "Build this circuit" (or "Verify against this") in
 * the theory workspace, and read by the lab's Verify panel. This is the only
 * thing the two workspaces share, and it is deliberately just the canonical
 * BooleanFunction — not an expression, not a cover, not a K-map. Everything
 * either side needs can be derived from it.
 */
interface SpecState {
  expected: BooleanFunction | null;
  /** The source text, so the lab can show what it is checking against. */
  source: string | null;
  setSpec: (fn: BooleanFunction, source: string) => void;
  clear: () => void;
}

export const useSpecStore = create<SpecState>()((set) => ({
  expected: null,
  source: null,
  setSpec: (expected, source) => set({ expected, source }),
  clear: () => set({ expected: null, source: null }),
}));
