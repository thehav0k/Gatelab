"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ParamValues, Problem } from "@/lib/diagram/problems";
import { useHydrated } from "@/hooks/use-hydrated";
import { useDiagramStore } from "@/stores/diagram-store";

/**
 * The controls that turn one exam question into a family of them.
 *
 * This is the whole reason the catalogue stores a `solve` function rather than a
 * picture. "1-to-16 demultiplexer from 2-to-4 decoders" is a specific instance of
 * "a demultiplexer tree"; move the two numbers and the same reasoning answers a
 * question that was not on the sheet. A student who can change the width is
 * checking whether they understood the construction — which is more than the
 * original question asked them to do.
 */
export function ProblemParams({
  problem,
  values,
}: {
  problem: Problem;
  values: ParamValues;
}) {
  const setParam = useDiagramStore((s) => s.setParam);
  const resetParams = useDiagramStore((s) => s.resetParams);
  const stored = useDiagramStore((s) => s.params[problem.id]);
  const hydrated = useHydrated();

  if (!problem.params || problem.params.length === 0) return null;
  const dirty = hydrated && stored !== undefined && Object.keys(stored).length > 0;

  return (
    <div className="bg-muted/30 rounded-md border p-3">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-xs font-medium">Change the question</h3>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[11px]"
          onClick={() => resetParams(problem.id)}
          disabled={!dirty}
        >
          <RotateCcw className="size-3" />
          As set
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {problem.params.map((param) => {
          const value = values[param.key] ?? param.initial;
          const id = `${problem.id}-${param.key}`;
          return (
            <div key={param.key} className="space-y-1.5">
              <Label htmlFor={id} className="text-xs">
                {param.label}
              </Label>

              {param.kind === "choice" ? (
                <Select
                  value={String(value)}
                  onValueChange={(v) => setParam(problem.id, param.key, v)}
                >
                  <SelectTrigger id={id} className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(param.choices ?? []).map((c) => (
                      <SelectItem key={c.value} value={c.value} className="text-xs">
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : param.kind === "int" ? (
                <Input
                  id={id}
                  type="number"
                  className="h-8 font-mono text-xs"
                  value={String(value)}
                  min={param.min}
                  max={param.max}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (!Number.isFinite(n)) return;
                    // Clamp at the edit, not at solve time. A builder handed a
                    // width of 40 would try to draw a trillion-row truth table,
                    // and the browser would simply stop responding.
                    const clamped = Math.min(
                      param.max ?? Number.MAX_SAFE_INTEGER,
                      Math.max(param.min ?? 0, n),
                    );
                    setParam(problem.id, param.key, clamped);
                  }}
                />
              ) : (
                <Input
                  id={id}
                  className="h-8 font-mono text-xs"
                  value={String(value)}
                  onChange={(e) => setParam(problem.id, param.key, e.target.value)}
                />
              )}

              {param.hint && (
                <p className="text-muted-foreground text-[11px] text-pretty">{param.hint}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
