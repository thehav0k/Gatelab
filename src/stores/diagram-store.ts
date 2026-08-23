"use client";

import { useTheme } from "next-themes";
import { create } from "zustand";
import { useHydrated } from "@/hooks/use-hydrated";
import { persist } from "zustand/middleware";
import {
  SLATE,
  TEXTBOOK,
  themeByName,
  withOverrides,
  type DiagramTheme,
  type DiagramThemePatch,
} from "@/lib/diagram/theme";
import type { ParamValue, ParamValues } from "@/lib/diagram/problems";
import type { Implementation } from "@/lib/diagram/editor/synthesize";

/**
 * What the diagram workspace remembers between visits.
 *
 * TWO THINGS, AND THEY ARE KEPT APART ON PURPOSE.
 *
 * The STYLE is global: somebody who has set up a black-and-white print theme for
 * their lab report wants it on the next figure too, not just on the one they were
 * looking at. Storing it per diagram would mean restyling every single answer.
 *
 * The PARAMETERS are per problem: "width = 8" means something different on the
 * comparator and on the memory expansion, and carrying a value across would
 * silently answer the wrong question.
 *
 * Overrides are stored as a PATCH rather than as a resolved theme, so that
 * switching preset keeps the two adjustments you made and improving a preset in
 * a later release actually reaches people who had customised it.
 */
/**
 * "Follow the app's own light/dark setting."
 *
 * The default, because the alternative is a white slab in the middle of a dark
 * page. It is only a DEFAULT: the moment somebody picks a preset — most likely
 * Print, for a report that is going to be black on white regardless of how they
 * like their screen — that choice wins and stops tracking anything.
 */
export const AUTO = "auto";

interface DiagramState {
  themeName: string;
  overrides: DiagramThemePatch;
  setThemeName: (name: string) => void;
  patchTheme: (patch: DiagramThemePatch) => void;
  resetTheme: () => void;

  /** problem id -> the parameter values it was last solved with. */
  params: Record<string, ParamValues>;
  setParam: (problemId: string, key: string, value: ParamValue) => void;
  resetParams: (problemId: string) => void;

  /** Last problem opened, so the page comes back where you left it. */
  lastProblem: string | null;
  setLastProblem: (id: string) => void;

  /** How the builder's synthesis panel should implement a function. */
  implementation: Implementation;
  setImplementation: (i: Implementation) => void;
}

export const useDiagramStore = create<DiagramState>()(
  persist(
    (set) => ({
      themeName: AUTO,
      overrides: {},
      setThemeName: (themeName) => set({ themeName }),
      // A deep merge for `tones` specifically: the panel edits one category's one
      // colour at a time, and a shallow spread would drop the other eight.
      patchTheme: (patch) =>
        set((s) => ({
          overrides: {
            ...s.overrides,
            ...patch,
            ...(patch.tones
              ? {
                  tones: mergeTones(s.overrides.tones, patch.tones),
                }
              : {}),
          },
        })),
      resetTheme: () => set({ overrides: {} }),

      params: {},
      setParam: (problemId, key, value) =>
        set((s) => ({
          params: {
            ...s.params,
            [problemId]: { ...(s.params[problemId] ?? {}), [key]: value },
          },
        })),
      resetParams: (problemId) =>
        set((s) => {
          const next = { ...s.params };
          delete next[problemId];
          return { params: next };
        }),

      lastProblem: null,
      setLastProblem: (lastProblem) => set({ lastProblem }),

      implementation: "gates",
      setImplementation: (implementation) => set({ implementation }),
    }),
    { name: "gatelab-diagrams", version: 1 },
  ),
);

type Tones = NonNullable<DiagramThemePatch["tones"]>;

function mergeTones(base: Tones | undefined, patch: Tones): Tones {
  const out: Tones = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (!value) continue;
    const k = key as keyof Tones;
    out[k] = { ...(out[k] ?? {}), ...value };
  }
  return out;
}

/**
 * The resolved theme — preset plus overrides. Everything drawing reads this.
 *
 * `resolvedTheme` is undefined on the server AND on the client's first render —
 * that is how next-themes avoids a hydration mismatch, and it is why the auto
 * case must fall back to the light preset rather than guess. The figure swaps a
 * frame later, which is the same behaviour as the rest of the page.
 */
export function useDiagramTheme(): DiagramTheme {
  const name = useDiagramStore((s) => s.themeName);
  const overrides = useDiagramStore((s) => s.overrides);
  const { resolvedTheme } = useTheme();
  const hydrated = useHydrated();

  // Before hydration BOTH the saved preset and the resolved light/dark setting
  // are unknowable on the server, so the first render must not consult either —
  // it renders the plain default, and the real theme arrives a frame later.
  if (!hydrated) return TEXTBOOK;

  const base =
    name === AUTO ? (resolvedTheme === "dark" ? SLATE : TEXTBOOK) : themeByName(name);
  return withOverrides(base, overrides);
}

/** The preset name to SHOW in the picker — SSR-safe, like the theme itself. */
export function useDiagramThemeName(): string {
  const name = useDiagramStore((s) => s.themeName);
  return useHydrated() ? name : AUTO;
}

/** Has the user changed anything away from the preset? SSR-safe. */
export function useThemeIsCustomised(): boolean {
  const overrides = useDiagramStore((s) => s.overrides);
  return useHydrated() && Object.keys(overrides).length > 0;
}
