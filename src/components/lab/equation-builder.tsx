"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CircuitBoard, FunctionSquare, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCircuitStore } from "@/stores/circuit-store";
import { useSpecStore } from "@/stores/spec-store";
import { useConstraint } from "@/stores/workspace-store";
import { analyze } from "@/lib/core-engine";
import { format } from "@/lib/core-engine/format";
import { checkCompleteness } from "@/lib/simulation/completeness";
import {
  describeDesign,
  realize,
  synthesize,
  technologyMap,
} from "@/lib/simulation/synth";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "F(A,B,C) = A'B + BC",
  "F(A,B) = A ^ B",
  "F(S,A,B) = S'*A + S*B",
  "F(A,B,C) = Σm(1,3,5,7)",
] as const;

/**
 * Type an equation, get a circuit — WITHOUT LEAVING THE LAB.
 *
 * The lab used to be able to *check* you against a function but not *build* one:
 * for that you had to go back to the theory workspace. But "I want a circuit for
 * this expression" is a lab activity, not an algebra one, and bouncing between
 * pages to get it was pure friction.
 *
 * It runs the same pipeline the theory page does — one parser, one minimizer, one
 * synthesizer — so the circuit you get here is byte-for-byte the circuit you would
 * have got there. And it obeys the active rule, and refuses (with the reason) when
 * that rule cannot express the function at all.
 */
export function EquationBuilder() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("F(A,B,C) = A'B + BC");

  const load = useCircuitStore((s) => s.load);
  const setSpec = useSpecStore((s) => s.setSpec);
  const constraint = useConstraint();

  const restricted = constraint.id !== "none";
  const completeness = checkCompleteness(constraint.gates);

  const preview = useMemo(() => {
    const r = analyze(draft);
    if (!r.ok) {
      return {
        error: r.diagnostics[0]?.message ?? "Could not parse that.",
        design: null,
        minimal: null,
        fn: null,
      };
    }

    const { fn, sop } = r.value;
    const nl = synthesize(sop.expression, fn.variables);

    if (nl.constant !== null) {
      return {
        error: `That is the constant ${nl.constant}. There is no circuit to build.`,
        design: null,
        minimal: null,
        fn: null,
      };
    }
    if (restricted && !completeness.complete) {
      return { error: null, design: null, minimal: format(sop.expression), fn };
    }

    const design = technologyMap(
      nl,
      constraint.strategy,
      restricted ? constraint.gates : undefined,
    );
    return { error: null, design, minimal: format(sop.expression), fn };
  }, [draft, restricted, completeness.complete, constraint.strategy, constraint.gates]);

  const buildable = !!preview.design && !preview.error;

  const build = () => {
    const r = analyze(draft);
    if (!r.ok || !preview.design) return;

    const { fn, sop } = r.value;
    const nl = synthesize(sop.expression, fn.variables);
    const doc = realize(
      technologyMap(nl, constraint.strategy, restricted ? constraint.gates : undefined),
      { outputLabel: "F" },
    );

    // Set the TARGET too, so the board is immediately checkable against the very
    // equation it was built from.
    setSpec(draft.trim());
    load(doc);
    setOpen(false);
    toast.success(
      `Built with ${preview.design.chipCount} IC${preview.design.chipCount === 1 ? "" : "s"}`,
      { description: describeDesign(preview.design) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FunctionSquare />
          <span className="hidden sm:inline">From equation</span>
          <span className="sr-only sm:hidden">Build from an equation</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Build a circuit from an equation</DialogTitle>
          <DialogDescription>
            Minimized, mapped onto real 74xx chips, and wired — without leaving the
            lab.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && buildable) build();
            }}
            placeholder="F(A,B,C) = A'B + BC"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!preview.error}
            className={cn("h-10 font-mono", preview.error && "border-destructive")}
          />

          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setDraft(ex)}
                className="text-muted-foreground hover:bg-accent hover:text-foreground rounded border px-1.5 py-0.5 font-mono text-[11px]"
              >
                {ex}
              </button>
            ))}
          </div>

          {preview.error && (
            <p className="text-destructive text-sm">{preview.error}</p>
          )}

          {/* The rule cannot express this at all. Say so, with the mathematics. */}
          {!preview.error && restricted && !completeness.complete && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>“{constraint.name}” cannot build this</AlertTitle>
              <AlertDescription>{completeness.reason}</AlertDescription>
            </Alert>
          )}

          {preview.minimal && preview.design && (
            <div className="bg-muted/60 space-y-1.5 rounded-md border p-3">
              <div>
                <p className="text-muted-foreground text-xs">Minimal form</p>
                <code className="text-sm">{preview.minimal}</code>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">
                  Will be built as
                  {restricted && (
                    <span className="text-foreground"> · {constraint.name}</span>
                  )}
                </p>
                <code className="text-sm">{describeDesign(preview.design)}</code>
              </div>
            </div>
          )}

          <Button onClick={build} disabled={!buildable} className="w-full">
            <CircuitBoard />
            Build it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
