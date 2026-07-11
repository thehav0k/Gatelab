"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CircuitBoard, ClipboardCheck, Cpu, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  type MappedDesign,
  type Strategy,
} from "@/lib/simulation/synth";
import { checkCompleteness } from "@/lib/simulation/completeness";
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
 * THE RULE THIS PANEL MUST OBEY: what it SHOWS is what it BUILDS.
 *
 * It used to show a comparison of the three named strategies no matter what rule
 * was active, and then build using the rule's actual gate set. Under an
 * "OR + NOT" rule it would advertise "NAND-only: 2 ICs" and then hand you
 * something else entirely. A panel that lies about its own output is worse than
 * no panel.
 *
 * So: with no restriction, the three-way comparison IS the lesson and is shown.
 * With a rule active, exactly one design is computed — the one under that rule —
 * and that is the one built. If the rule cannot express every function, we refuse
 * and say why, rather than quietly building something that breaks it.
 */
export function BuildCircuit({ min, variables, fn, source }: Props) {
  const router = useRouter();
  const load = useCircuitStore((s) => s.load);
  const setSpec = useSpecStore((s) => s.setSpec);
  const constraint = useConstraint();

  const restricted = constraint.id !== "none";
  const completeness = checkCompleteness(constraint.gates);

  const [override, setOverride] = useState<Strategy | null>(null);

  const { designs, ruled, constant } = useMemo(() => {
    const nl = synthesize(min.expression, variables);
    if (nl.constant !== null) {
      return { designs: [], ruled: null, constant: nl.constant };
    }

    // ONE design, under the rule that is actually active. This is the thing that
    // gets built, so it is the thing that gets shown.
    const ruledDesign: MappedDesign | null =
      restricted && completeness.complete
        ? technologyMap(nl, constraint.strategy, constraint.gates)
        : null;

    return {
      designs: restricted ? [] : compareStrategies(nl),
      ruled: ruledDesign,
      constant: null,
    };
  }, [min, variables, restricted, completeness.complete, constraint.strategy, constraint.gates]);

  if (constant !== null) {
    return (
      <p className="text-muted-foreground text-sm">
        This function is the constant {constant}. There is no circuit to build —
        tie the output {constant === 1 ? "to +5V" : "to GND"}.
      </p>
    );
  }

  // The rule itself is impossible. Refuse, and give the mathematics.
  if (restricted && !completeness.complete) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>“{constraint.name}” cannot build this</AlertTitle>
        <AlertDescription>
          <p>{completeness.reason}</p>
          <p className="mt-1">
            Add a gate to the rule until it becomes universal, and this panel will
            build it.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  const best = designs[0];
  const chosen: MappedDesign | undefined = restricted
    ? (ruled ?? undefined)
    : (designs.find((d) => d.strategy === override) ?? best);

  const build = () => {
    if (!chosen) return;

    const nl = synthesize(min.expression, variables);
    // Exactly the same call that produced `chosen`. If these two ever diverge, the
    // panel is lying about what it builds — which is the bug this replaced.
    const doc = realize(
      restricted
        ? technologyMap(nl, constraint.strategy, constraint.gates)
        : technologyMap(nl, chosen.strategy),
      { outputLabel: "F" },
    );

    setSpec(source);
    // Remember WHAT this board is, so changing the gate rule can rebuild it.
    load(doc, source);
    toast.success(
      `Built with ${chosen.chipCount} IC${chosen.chipCount === 1 ? "" : "s"}`,
      { description: describeDesign(chosen) },
    );
    router.push("/lab");
  };

  return (
    <div className="space-y-3">
      {restricted && chosen ? (
        <div className="space-y-2">
          <div className="border-ring bg-accent flex items-center gap-3 rounded-md border px-3 py-2">
            <Cpu className="text-muted-foreground size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{constraint.name}</p>
              <p className="font-mono text-xs">{describeDesign(chosen)}</p>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            This is the circuit the active rule produces — and the one the button
            below will build. Change the rule from the toolbar to see another.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {designs.map((d) => {
              const isBest = d === best;
              return (
                <button
                  key={d.strategy}
                  type="button"
                  onClick={() => setOverride(d.strategy)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    d === chosen ? "border-ring bg-accent" : "hover:bg-accent/50",
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
          <p className="text-muted-foreground text-xs">
            The comparison IS the lesson: a mixed design usually needs fewer{" "}
            <em>gates</em> but more <em>chips</em>, because those gates are different
            types and you cannot buy half a package.
          </p>
        </>
      )}

      <Button onClick={build} className="w-full" disabled={!chosen}>
        <CircuitBoard />
        Build this circuit in the lab
      </Button>

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

      <p className="text-muted-foreground text-xs">
        Every generated chip gets pin 14 wired to +5V and pin 7 to GND — the step
        that is easiest to forget by hand.
      </p>
    </div>
  );
}
