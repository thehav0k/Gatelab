"use client";

import { useTheme } from "next-themes";
import { create } from "zustand";
import { useHydrated } from "@/hooks/use-hydrated";
import { persist } from "zustand/middleware";
import {
  choosePreset,
  restorePreset,
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
 * Overrides are stored as a PATCH rather than as a resolved theme, so that a
 * preset improved in a later release still reaches somebody who had changed one
 * colour in it, and so the panel can say what has been changed.
 *
 * A PRESET SWITCH CLEARS THE PATCH, and this is the whole of the fix for a bug
 * that made the picker look dead. Overrides used to survive the switch — the
 * idea being that "start from Blueprint but make the wires white" should carry
 * across. What it actually produced: change the background once, and from then
 * on every preset you pick changes the NAME in the box and nothing on the page,
 * because the background is most of what a preset is. The control silently
 * stopped doing the one thing it promises.
 *
 * A preset is a whole look, and choosing one is asking for that look. So it is
 * applied, and the patch it replaced is kept in memory for one click of Restore
 * — recoverable, rather than either lost or silently in charge.
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
  /**
   * What a preset switch just replaced. Session-only and deliberately not
   * persisted: it is an undo for the click you just made, not a second set of
   * settings to keep track of.
   */
  discarded: DiagramThemePatch | null;
  setThemeName: (name: string) => void;
  patchTheme: (patch: DiagramThemePatch) => void;
  resetTheme: () => void;
  restoreOverrides: () => void;

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
      discarded: null,

      setThemeName: (themeName) => set((s) => choosePreset(s, themeName)),
      // A deep merge for `tones` specifically: the panel edits one category's one
      // colour at a time, and a shallow spread would drop the other eight.
      patchTheme: (patch) =>
        set((s) => ({
          discarded: null,
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
      resetTheme: () => set({ overrides: {}, discarded: null }),

      restoreOverrides: () => set(restorePreset),

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
    {
      name: "gatelab-diagrams",
      version: 1,
      // `discarded` is an undo for one click and has no business outliving the
      // session — coming back tomorrow to an offer to restore changes you do
      // not remember making is worse than not offering.
      partialize: (s) => ({
        themeName: s.themeName,
        overrides: s.overrides,
        params: s.params,
        lastProblem: s.lastProblem,
        implementation: s.implementation,
      }),
    },
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

/**
 * How many of the user's own changes the last preset switch replaced, or 0.
 *
 * Needs no hydration gate: it is null on the server and on the first client
 * render alike, because it is never persisted.
 */
export function useDiscardedCount(): number {
  const discarded = useDiagramStore((s) => s.discarded);
  return discarded ? Object.keys(discarded).length : 0;
}
