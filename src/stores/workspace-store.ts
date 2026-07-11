"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CONSTRAINT, getConstraint, type Constraint } from "@/lib/simulation/constraints";

/**
 * Workspace state that must survive navigation and reload.
 *
 * The theory expression lives HERE rather than in the theory page's `useState`,
 * because a page's local state dies the moment you navigate away — so walking to
 * the lab and back used to throw away whatever you had typed. It is a document,
 * not a widget, and documents belong in a store.
 *
 * The component constraint lives here too: it governs both workspaces (the
 * palette filters by it, and the synthesizer is steered by it), so it cannot
 * belong to either one.
 */
interface WorkspaceState {
  /** The expression in the theory input box. */
  theorySource: string;
  setTheorySource: (s: string) => void;

  constraintId: string;
  setConstraintId: (id: string) => void;
}

export const DEFAULT_SOURCE = "F(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)";

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      theorySource: DEFAULT_SOURCE,
      setTheorySource: (theorySource) => set({ theorySource }),

      constraintId: DEFAULT_CONSTRAINT.id,
      setConstraintId: (constraintId) => set({ constraintId }),
    }),
    { name: "gatelab-workspace" },
  ),
);

/** The active component constraint. */
export function useConstraint(): Constraint {
  return getConstraint(useWorkspaceStore((s) => s.constraintId));
}
