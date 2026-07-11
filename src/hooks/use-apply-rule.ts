"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useCircuitStore } from "@/stores/circuit-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getConstraint, violations } from "@/lib/simulation/constraints";
import { rebuildUnder } from "@/lib/simulation/rebuild";
import { describeDesign } from "@/lib/simulation/synth";
import type { GateOp } from "@/lib/simulation/logic";

/**
 * Choosing a rule, and what the board does about it.
 *
 * Changing the rule used to change NOTHING on the canvas. The palette narrowed and
 * a warning appeared, but the 7408 you were looking at stayed a 7408 after you said
 * "NAND only" — so the filter looked broken, because from where the user sits it
 * was: the one thing they were looking at did not respond.
 *
 * The fix is not "always rewrite the board", which would be far worse. It turns on
 * PROVENANCE:
 *
 *   - The app BUILT this board from an equation → the board is the app's answer to
 *     a question. The rule changed the question, so re-synthesize and show the new
 *     answer. This is the case the user was complaining about, and now the chips
 *     visibly change — on the schematic and on the breadboard both.
 *
 *   - A HUMAN wired this board → it is their work, and it is not ours to rewrite.
 *     Report what the new rule forbids and let them decide. Silently rebuilding here
 *     would delete an afternoon's work behind a menu click.
 *
 *   - The rule is IMPOSSIBLE (XOR only cannot make an AND) → refuse, keep the board
 *     that works, and say which property traps it.
 */
export function useApplyRule() {
  const setConstraintId = useWorkspaceStore((s) => s.setConstraintId);
  const setCustomGates = useWorkspaceStore((s) => s.setCustomGates);

  return useCallback(
    (id: string, customGates?: readonly GateOp[]) => {
      if (customGates) setCustomGates([...customGates]);
      setConstraintId(id);

      const constraint = getConstraint(id, customGates);
      const { doc, origin, load, toBreadboard } = useCircuitStore.getState();
      const onBoard = !!doc.board;

      // --- a board the app built: re-synthesize it under the new rule ---
      if (origin) {
        const rebuilt = rebuildUnder(origin, constraint);

        if (!rebuilt.ok) {
          toast.error(`“${constraint.name}” cannot build this`, {
            description: rebuilt.reason,
            duration: 9000,
          });
          return;
        }

        load(rebuilt.doc, origin);
        // A board stays a board. Switching the rule should not also throw you back
        // to the schematic — you were looking at the breadboard for a reason.
        if (onBoard) toBreadboard();

        toast.success(`Rebuilt under “${constraint.name}”`, {
          description: describeDesign(rebuilt.design),
        });
        return;
      }

      // --- a board someone wired by hand: report, never rewrite ---
      const broken = violations(doc, constraint);
      if (broken.length > 0) {
        toast.warning(
          `${broken.length} part${broken.length === 1 ? "" : "s"} on the board are not allowed`,
          { description: broken.map((v) => v.component).join(", ") },
        );
        return;
      }

      if (constraint.note) {
        toast.info(constraint.name, { description: constraint.note, duration: 8000 });
      }
    },
    [setConstraintId, setCustomGates],
  );
}
