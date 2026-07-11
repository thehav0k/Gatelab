"use client";

import { toast } from "sonner";
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
import { CONSTRAINTS, violations } from "@/lib/simulation/constraints";
import { cn } from "@/lib/utils";

/**
 * Pick the rule you are working under.
 *
 * "Implement this with NAND gates only" is the exercise, not a footnote — so the
 * rule is chosen BEFORE you build, the palette narrows to match, and "Build it
 * for me" obeys it too.
 */
export function ConstraintMenu() {
  const active = useConstraint();
  const setConstraintId = useWorkspaceStore((s) => s.setConstraintId);
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
                onClick={() => {
                  setConstraintId(c.id);
                  if (broken.length > 0) {
                    toast.warning(`${broken.length} part${broken.length === 1 ? "" : "s"} on the board are not allowed`, {
                      description: broken.map((v) => v.component).join(", "),
                    });
                  } else if (c.note) {
                    toast.info(c.name, { description: c.note, duration: 8000 });
                  }
                }}
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
      </DropdownMenuContent>
    </DropdownMenu>
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
        {broken.length} part{broken.length === 1 ? "" : "s"} not allowed under
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
