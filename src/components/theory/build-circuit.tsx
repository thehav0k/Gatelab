"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CircuitBoard, ClipboardCheck, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCircuitStore } from "@/stores/circuit-store";
import { useSpecStore } from "@/stores/spec-store";
import { useConstraint } from "@/stores/workspace-store";
import {
  compareStrategies,
  describeDesign,
  realize,
  synthesize,
  technologyMap,
  type Strategy,
} from "@/lib/simulation/synth";
import type { Minimization } from "@/lib/core-engine/minimizer";
import type { BooleanFunction } from "@/lib/core-engine/types";
import { cn } from "@/lib/utils";

interface Props {
  min: Minimization;
  variables: readonly string[];
  fn: BooleanFunction;
  source: string;
}

/**
 * The bridge from algebra to hardware.
 *
 * Showing all three technology mappings side by side is not a feature for its
 * own sake — the comparison IS the lesson. "Mixed gates: 4 ICs. NAND-only:
 * 2 ICs." is the thing a student is supposed to internalize about why NAND is
 * called a universal gate.
 */
export function BuildCircuit({ min, variables, fn, source }: Props) {
  const router = useRouter();
  const load = useCircuitStore((s) => s.load);
  const setSpec = useSpecStore((s) => s.setSpec);
  const constraint = useConstraint();

  // The constraint is the exercise. If the rule says NAND-only, "build it for me"
  // must produce a NAND-only circuit — a generator that quietly ignores the rule
  // makes the rule worthless.
  const [override, setOverride] = useState<Strategy | null>(null);
  const strategy: Strategy = override ?? constraint.strategy;
  const locked = constraint.id !== "none";

  const { designs, constant } = useMemo(() => {
    const nl = synthesize(min.expression, variables);
    if (nl.constant !== null) return { designs: [], constant: nl.constant };
    return { designs: compareStrategies(nl), constant: null };
  }, [min, variables]);

  if (constant !== null) {
    return (
      <p className="text-muted-foreground text-sm">
        This function is the constant {constant}. There is no circuit to build —
        tie the output {constant === 1 ? "to +5V" : "to GND"}.
      </p>
    );
  }

  const best = designs[0];
  const chosen = designs.find((d) => d.strategy === strategy) ?? best;
  const setStrategy = (s: Strategy) => setOverride(s);

  const build = () => {
    if (!chosen) return;
    const nl = synthesize(min.expression, variables);
    const doc = realize(technologyMap(nl, chosen.strategy), { outputLabel: "F" });
    // Hand the lab the FUNCTION, not the circuit, so Verify checks the built
    // board against the algebra rather than against itself.
    setSpec(source);
    load(doc);
    toast.success(`Built with ${chosen.chipCount} IC${chosen.chipCount === 1 ? "" : "s"}`, {
      description: describeDesign(chosen),
    });
    router.push("/lab");
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {designs.map((d) => {
          const isBest = d === best;
          return (
            <button
              key={d.strategy}
              type="button"
              onClick={() => setStrategy(d.strategy)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                d.strategy === chosen?.strategy
                  ? "border-ring bg-accent"
                  : "hover:bg-accent/50",
              )}
            >
              <Cpu className="text-muted-foreground size-4 shrink-0" />
              <span className="flex-1 font-mono text-xs">{describeDesign(d)}</span>
              {isBest && (
                <Badge variant="secondary" className="shrink-0 font-normal">
                  fewest chips
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      <Button onClick={build} className="w-full" disabled={!chosen}>
        <CircuitBoard />
        Build this circuit in the lab
      </Button>

      {/* The other direction, and the more interesting one: build it yourself and
          have the lab tell you where you went wrong. */}
      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setSpec(source);
          toast.info(`The lab will now check your circuit against ${fn.name}`);
          router.push("/lab");
        }}
      >
        <ClipboardCheck />
        Check a circuit I build myself
      </Button>

      {locked && (
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium">{constraint.name}</span> is
          active, so the circuit will be built with{" "}
          <span className="font-mono">{constraint.parts.join(", ")}</span> only. Pick
          another row above to override it for this build.
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        Every generated chip gets pin 14 wired to +5V and pin 7 to GND — the step
        that is easiest to forget by hand.
      </p>
    </div>
  );
}
