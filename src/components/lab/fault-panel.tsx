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

const HUMAN_TITLES: Record<string, string> = {
  FLOATING_INPUT: "Floating Input",
  UNDRIVEN_NET: "Undriven Net",
  OUTPUT_SHORT: "Shorted Output",
  OUTPUT_TO_OUTPUT: "Conflicting Drivers",
  OUTPUT_DRIVES_RAIL: "Output Shorted to Rail",
  RAIL_SHORT: "Power Rail Short",
  UNPOWERED_IC: "Unpowered IC",
  DANGLING_OUTPUT: "Dangling Output",
  UNUSED_GATE: "Unused Gates",
  OSCILLATION: "Oscillation Detected",
  FLOATING_CLOCK: "Floating Clock Input",
  PRESET_AND_CLEAR: "Preset & Clear Both Active",
  UNINITIALISED_FLOP: "Uninitialized Flip-Flop",
  UNINITIALIZED_FLOP: "Uninitialized Flip-Flop",
};

/**
 * The fault panel. Uses 4-state simulation to detect hardware faults (floating pins,
 * unpowered ICs, bus contention, shorted rails).
 */
export function FaultPanel() {
  const doc = useCircuitStore((s) => s.doc);
  const diagnostics = useCircuitStore((s) => s.diagnostics);
  const nodeCount = Object.keys(doc.nodes).length;

  if (nodeCount === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Add a gate or chip from the palette to get started.
      </p>
    );
  }

  // Check if any LED or output is present in the document
  const hasLeds = Object.values(doc.nodes).some((n) => n.kind === "led");

  // Group repeated FLOATING_INPUT items per chip
  const floatingByNode = new Map<string, Extract<Diagnostic, { code: "FLOATING_INPUT" }>[]>();
  const otherDiagnostics: Diagnostic[] = [];

  for (const d of diagnostics) {
    if (d.code === "FLOATING_INPUT" && d.pins && d.pins.length > 0) {
      const nodeId = d.pins[0]!.node;
      const list = floatingByNode.get(nodeId) ?? [];
      list.push(d);
      floatingByNode.set(nodeId, list);
    } else {
      otherDiagnostics.push(d);
    }
  }

  const items: {
    key: string;
    severity: "error" | "warning" | "info";
    title: string;
    message: string;
  }[] = [];

  for (const [nodeId, list] of floatingByNode) {
    const node = doc.nodes[nodeId];
    const nodeLabel = node?.label ?? nodeId;
    if (list.length > 1) {
      const pinNames = list.flatMap((d) => d.pins.map((p) => p.pin));
      items.push({
        key: `grouped-floating-${nodeId}`,
        severity: "warning",
        title: `Floating Inputs on ${nodeLabel}`,
        message: `${list.length} inputs on ${nodeLabel} are floating: ${pinNames.join(", ")}. TTL inputs float high but pick up noise; tie unused inputs to Vcc or GND.`,
      });
    } else {
      const d = list[0]!;
      items.push({
        key: `floating-${nodeId}`,
        severity: "warning",
        title: "Floating Input",
        message: d.message,
      });
    }
  }

  for (let i = 0; i < otherDiagnostics.length; i++) {
    const d = otherDiagnostics[i]!;
    items.push({
      key: `${d.code}-${i}`,
      severity: d.severity,
      title: HUMAN_TITLES[d.code] ?? d.code,
      message: d.message,
    });
  }

  return (
    <div className="space-y-2">
      {!hasLeds && (
        <Alert variant="default" className="border-amber-500/30 bg-amber-500/5">
          <Info className="text-amber-500" />
          <AlertTitle className="text-xs font-semibold">No Output Observed</AlertTitle>
          <AlertDescription className="text-xs">
            No LED or Output Monitor is connected to observe circuit state.
          </AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <Alert>
          <CircleCheck className="text-logic-high" />
          <AlertTitle className="text-xs font-semibold">No Faults</AlertTitle>
          <AlertDescription className="text-xs">
            Every input is driven, no outputs are shorted, and the circuit settles cleanly.
          </AlertDescription>
        </Alert>
      ) : (
        items.map((item) => {
          const Icon = ICON[item.severity];
          return (
            <Alert
              key={item.key}
              variant={item.severity === "error" ? "destructive" : "default"}
            >
              <Icon />
              <AlertTitle className="text-xs font-semibold">{item.title}</AlertTitle>
              <AlertDescription className="text-xs">{item.message}</AlertDescription>
            </Alert>
          );
        })
      )}
    </div>
  );
}
