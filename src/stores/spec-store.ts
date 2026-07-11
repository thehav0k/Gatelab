"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { parseInput } from "@/lib/core-engine/canonical";
import type { BooleanFunction } from "@/lib/core-engine/types";

/**
 * The function the lab is supposed to be building.
 *
 * ONLY THE SOURCE TEXT IS STORED. The BooleanFunction is re-derived from it on
 * demand, because it holds a `Uint8Array` — which JSON.stringify silently turns
 * into `{"0":1,"1":0,…}` and never turns back. Persisting the derived object
 * would produce a spec that looks fine and compares wrong.
 *
 * Deriving also means the two workspaces can never disagree about what the
 * function IS: there is one string, and one parser.
 */
interface SpecState {
  source: string | null;
  setSpec: (source: string) => void;
  clear: () => void;
}

export const useSpecStore = create<SpecState>()(
  persist(
    (set) => ({
      source: null,
      setSpec: (source) => set({ source }),
      clear: () => set({ source: null }),
    }),
    { name: "digilab-spec" },
  ),
);

/** The function the lab is checking against, parsed from the stored source. */
export function useExpected(): BooleanFunction | null {
  const source = useSpecStore((s) => s.source);
  return useMemo(() => {
    if (!source) return null;
    const r = parseInput(source);
    return r.ok ? r.value : null;
  }, [source]);
}
