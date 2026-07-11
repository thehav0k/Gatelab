"use client";

import { toast } from "sonner";
import { BookOpen, Table2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  FUNCTION_LIBRARY,
  LIBRARY_GROUPS,
  blankTruthTable,
} from "@/lib/core-engine/library";

/**
 * The classic circuits, and a blank truth table.
 *
 * Both are just SOURCE STRINGS handed to the same input box. A preset is not a
 * special mode — it is a function like any other, which is what lets you minimize
 * it, see its K-map, and build it exactly as you would your own.
 */
export function FunctionLibrary({
  onPick,
}: {
  onPick: (source: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <BookOpen /> Classic circuits
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] w-96 overflow-auto">
          {LIBRARY_GROUPS.map((group, i) => (
            <div key={group}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{group}</DropdownMenuLabel>
              {FUNCTION_LIBRARY.filter((f) => f.group === group).map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  className="flex-col items-start"
                  onClick={() => {
                    onPick(f.source);
                    toast.info(f.name, { description: f.note, duration: 9000 });
                  }}
                >
                  <span className="font-medium">{f.name}</span>
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {f.source}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* "I do not have an expression, I have a spec." */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Table2 /> Blank truth table
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Start from a truth table</DropdownMenuLabel>
          <p className="text-muted-foreground px-2 pb-2 text-xs">
            Click the output column to cycle each row 0 → 1 → X. The expression,
            the K-map and the circuit all follow from it.
          </p>
          {[2, 3, 4].map((n) => (
            <DropdownMenuItem
              key={n}
              onClick={() => {
                onPick(blankTruthTable(n));
                toast.info(`Blank ${n}-variable truth table`, {
                  description:
                    "Every row starts at 0. Click a value in the output column to set it.",
                });
              }}
            >
              {n} variables
              <span className="text-muted-foreground ml-auto font-mono text-xs">
                {1 << n} rows
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
