"use client";

import { Filter, TriangleAlert } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCircuitStore } from "@/stores/circuit-store";
import { useConstraint, useWorkspaceStore } from "@/stores/workspace-store";
import { useApplyRule } from "@/hooks/use-apply-rule";
import { CONSTRAINTS, CUSTOM_ID, violations } from "@/lib/simulation/constraints";
import { checkCompleteness } from "@/lib/simulation/completeness";
import { GATE_LABELS } from "@/lib/simulation/parts";
import type { GateOp } from "@/lib/simulation/logic";
import { cn } from "@/lib/utils";

const PICKABLE: GateOp[] = ["and", "or", "not", "nand", "nor", "xor", "xnor"];

/**
 * Pick the rule you are working under.
 *
 * "Implement this with NAND gates only" is the exercise, not a footnote — so the
 * rule is chosen BEFORE you build, the palette narrows to match, and "Build it
 * for me" obeys it too.
 */
export function ConstraintMenu() {
  const active = useConstraint();
  const applyRule = useApplyRule();
  const doc = useCircuitStore((s) => s.doc);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter />
          {active.id === "none" ? "All parts" : active.name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Allowed components</DropdownMenuLabel>
        {CONSTRAINTS.map((c, i) => {
          const broken = violations(doc, c);
          return (
            <div key={c.id}>
              {i === 1 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={() => applyRule(c.id)}
                className="flex-col items-start"
              >
                <span className="flex w-full items-center gap-2">
                  <span className={cn("font-medium", c.id === active.id && "text-logic-high")}>
                    {c.name}
                  </span>
                  {broken.length > 0 && (
                    <Badge variant="outline" className="ml-auto text-[10px] font-normal">
                      {broken.length} on board
                    </Badge>
                  )}
                </span>
                <span className="text-muted-foreground text-xs">{c.description}</span>
              </DropdownMenuItem>
            </div>
          );
        })}

        <DropdownMenuSeparator />
        <CustomRule />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Pick any gate set you like — and be told, immediately, whether it can actually
 * express every Boolean function.
 *
 * This is the part that makes the filter honest. "Build it with XOR only" is a
 * perfectly reasonable thing for a teacher to say and a completely impossible
 * thing to do: XOR is affine, affine functions compose to affine functions, and
 * AND is not one. Post's criterion settles it, and the verdict is shown live as
 * you tick the boxes — so nobody spends an afternoon hunting for a circuit that
 * provably does not exist.
 */
function CustomRule() {
  const gates = useWorkspaceStore((s) => s.customGates);
  const activeId = useWorkspaceStore((s) => s.constraintId);
  const applyRule = useApplyRule();

  const check = checkCompleteness(gates);

  const toggle = (op: GateOp) => {
    const next = gates.includes(op) ? gates.filter((g) => g !== op) : [...gates, op];
    // Same path as picking a preset: a generated board rebuilds, a hand-wired one
    // is reported on and left alone.
    applyRule(CUSTOM_ID, next);
  };

  return (
    <div className="px-2 py-1.5">
      <p className="mb-1.5 text-xs font-medium">
        Custom
        {activeId === CUSTOM_ID && (
          <span className="text-logic-high ml-1.5 text-[10px]">active</span>
        )}
      </p>

      <div
        className="mb-2 flex flex-wrap gap-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="group"
      >
        {PICKABLE.map((op) => (
          <button
            key={op}
            type="button"
            onClick={() => toggle(op)}
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
              gates.includes(op)
                ? "border-ring bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            {GATE_LABELS[op]}
          </button>
        ))}
      </div>

      {/* The verdict, live. */}
      <p
        className={cn(
          "text-[10px] leading-snug",
          check.complete ? "text-logic-high" : "text-logic-z",
        )}
      >
        {check.complete
          ? "Universal — every Boolean function can be built from these."
          : `Not universal — ${check.reason}`}
      </p>
    </div>
  );
}

/**
 * What is on the board that the current rule forbids.
 *
 * Switching rules mid-build must not silently invalidate the work — nor silently
 * bless it. Report, and let the student decide.
 */
export function ConstraintViolations() {
  const active = useConstraint();
  const doc = useCircuitStore((s) => s.doc);
  const broken = violations(doc, active);

  if (broken.length === 0) return null;

  return (
    <Alert variant="destructive" className="mb-3">
      <TriangleAlert />
      <AlertTitle>
        {broken.length} part{broken.length === 1 ? "" : "s"} not allowed under{" "}
        &ldquo;{active.name}&rdquo;
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 space-y-0.5 text-xs">
          {broken.map((v) => (
            <li key={v.nodeId}>{v.message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
