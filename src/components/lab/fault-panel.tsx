"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CircleCheck, CircleAlert, Info, OctagonX } from "lucide-react";
import { useCircuitStore } from "@/stores/circuit-store";
import type { Diagnostic } from "@/lib/simulation/diagnostics";

const ICON = {
  error: OctagonX,
  warning: CircleAlert,
  info: Info,
} as const;

/**
 * The fault panel. This is the reason the simulator uses 4-state logic — every
 * message here is one a boolean simulator physically could not produce.
 */
export function FaultPanel() {
  const diagnostics = useCircuitStore((s) => s.diagnostics);
  const nodeCount = useCircuitStore((s) => Object.keys(s.doc.nodes).length);

  if (nodeCount === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Add a gate from the palette to get started.
      </p>
    );
  }

  if (diagnostics.length === 0) {
    return (
      <Alert>
        <CircleCheck className="text-logic-high" />
        <AlertTitle>No faults</AlertTitle>
        <AlertDescription>
          Every input is driven, no outputs are shorted, and the circuit settles.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      {diagnostics.map((d, i) => (
        <FaultAlert key={`${d.code}-${i}`} diagnostic={d} />
      ))}
    </div>
  );
}

function FaultAlert({ diagnostic }: { diagnostic: Diagnostic }) {
  const Icon = ICON[diagnostic.severity];
  return (
    <Alert variant={diagnostic.severity === "error" ? "destructive" : "default"}>
      <Icon />
      <AlertTitle className="font-mono text-xs">{diagnostic.code}</AlertTitle>
      <AlertDescription>{diagnostic.message}</AlertDescription>
    </Alert>
  );
}
