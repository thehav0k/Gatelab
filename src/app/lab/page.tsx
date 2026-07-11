"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileText, Redo2, Trash2, Undo2 } from "lucide-react";

import { CircuitCanvas } from "@/components/lab/circuit-canvas";
import { BreadboardView } from "@/components/lab/breadboard-view";
import { Palette } from "@/components/lab/palette";
import { FaultPanel } from "@/components/lab/fault-panel";
import { VerifyPanel } from "@/components/lab/verify-panel";
import { WaveformPanel } from "@/components/lab/waveform-panel";
import { PresetMenu } from "@/components/lab/preset-menu";
import { EquationBuilder } from "@/components/lab/equation-builder";
import { ConstraintMenu, ConstraintViolations } from "@/components/lab/constraint-menu";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

import { useCircuitStore } from "@/stores/circuit-store";
import { useExpected } from "@/stores/spec-store";

export default function LabPage() {
  const undo = useCircuitStore((s) => s.undo);
  const redo = useCircuitStore((s) => s.redo);
  const clear = useCircuitStore((s) => s.clear);
  const deleteSelected = useCircuitStore((s) => s.deleteSelected);
  const canUndo = useCircuitStore((s) => s.past.length > 0);
  const canRedo = useCircuitStore((s) => s.future.length > 0);
  const pendingPin = useCircuitStore((s) => s.pendingPin);
  const pendingHole = useCircuitStore((s) => s.pendingHole);
  const errorCount = useCircuitStore(
    (s) => s.diagnostics.filter((d) => d.severity === "error").length,
  );

  const expected = useExpected();
  const onBoard = useCircuitStore((s) => !!s.doc.board);
  const toBreadboard = useCircuitStore((s) => s.toBreadboard);
  const toSchematic = useCircuitStore((s) => s.toSchematic);
  const hasSchematic = useCircuitStore((s) => s.schematic !== null);
  const hasNodes = useCircuitStore((s) => Object.keys(s.doc.nodes).length > 0);

  const [showTiming, setShowTiming] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if (e.key === "Backspace" || e.key === "Delete") deleteSelected();
      if (e.key === "Escape") useCircuitStore.getState().cancelWire();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, undo, redo]);

  const hint = pendingHole
    ? "Now click a second hole to lay the jumper — or press Escape."
    : pendingPin
      ? "Now click a second pin to complete the wire — or press Escape."
      : onBoard
        ? "Click a hole, then another, to lay a jumper. Hover any hole to see the whole strip it shorts to."
        : "Click a pin, then another, to wire them. Click a switch to toggle it; click a wire to delete it.";

  /**
   * The view switch is BIDIRECTIONAL now.
   *
   * Seating a schematic on a board is a *realization*: it throws the schematic's
   * layout away, because a board has no such thing. Rather than try to reverse
   * that — which would mean inventing a layout the circuit never had — the store
   * simply keeps the original schematic and hands it back. A board built from
   * scratch has no schematic to return to, and the toggle says so rather than
   * pretending.
   */
  const switchView = (v: string) => {
    if (!v) return;

    if (v === "board" && !onBoard) {
      if (!hasNodes) {
        toast.error("Build or load a circuit first.");
        return;
      }
      const unplaced = toBreadboard();
      if (unplaced.length > 0) {
        toast.warning(
          `${unplaced.length} part${unplaced.length === 1 ? "" : "s"} did not fit on the board`,
        );
      } else {
        toast.success("Seated on a breadboard", {
          description:
            "Hover a hole to see its whole strip light up — every hole on a strip is one net.",
        });
      }
      return;
    }

    if (v === "schematic" && onBoard) {
      if (!toSchematic()) {
        toast.error("This board was not seated from a schematic", {
          description: "There is no layout to go back to.",
        });
        return;
      }
      toast.info("Back to the schematic", {
        description: "Jumpers you added on the board are not carried back.",
      });
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-[1800px] flex-col px-4 py-4">
      {/* --- toolbar --------------------------------------------------------- */}
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Practical Lab</h1>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{hint}</p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={onBoard ? "board" : "schematic"}
            onValueChange={switchView}
          >
            <ToggleGroupItem value="schematic" disabled={onBoard && !hasSchematic}>
              Schematic
            </ToggleGroupItem>
            <ToggleGroupItem value="board">Breadboard</ToggleGroupItem>
          </ToggleGroup>

          <ConstraintMenu />
          <PresetMenu />
          <EquationBuilder />

          <Separator orientation="vertical" className="h-6" />

          <Button variant="outline" size="sm" onClick={undo} disabled={!canUndo}>
            <Undo2 />
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={!canRedo}>
            <Redo2 />
          </Button>
          <Button variant="outline" size="sm" onClick={clear}>
            <Trash2 />
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/report">
              <FileText /> Report
            </Link>
          </Button>
        </div>
      </header>

      {/* --- workspace: fills the viewport, three columns, no page scroll ----- */}
      <div className="grid min-h-0 flex-1 grid-cols-[180px_1fr_340px] gap-3">
        <Card className="min-h-0 overflow-hidden py-0">
          <ScrollArea className="h-full">
            <Palette />
          </ScrollArea>
        </Card>

        <div className="flex min-h-0 flex-col gap-3">
          {/* The canvas takes ALL the room left over. It used to be pinned to a
              fixed min-height, which meant a big board was squeezed into a letterbox
              while the page grew a scrollbar underneath it. */}
          <div className="min-h-0 flex-1">
            {onBoard ? <BreadboardView /> : <CircuitCanvas />}
          </div>

          <Card className="shrink-0 overflow-hidden py-0">
            <button
              type="button"
              onClick={() => setShowTiming((v) => !v)}
              className="hover:bg-accent/50 flex w-full items-center gap-2 px-4 py-2 text-left"
            >
              <span className="text-sm font-medium">Timing</span>
              <span className="text-muted-foreground text-xs">
                unit-delay, Gray-code sweep
              </span>
              <span className="text-muted-foreground ml-auto text-xs">
                {showTiming ? "hide" : "show"}
              </span>
            </button>
            {showTiming && (
              <>
                <Separator />
                <CardContent className="max-h-[260px] overflow-auto px-0">
                  <WaveformPanel />
                </CardContent>
              </>
            )}
          </Card>
        </div>

        <Card className="min-h-0 overflow-hidden py-0">
          <Tabs
            defaultValue={expected ? "verify" : "faults"}
            className="flex h-full flex-col gap-0"
          >
            <CardHeader className="shrink-0 pt-3 pb-2">
              <TabsList className="w-full">
                <TabsTrigger value="faults" className="flex-1">
                  Faults
                  {errorCount > 0 && (
                    <Badge variant="destructive" className="ml-1.5 px-1.5">
                      {errorCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="verify" className="flex-1">
                  Verify
                </TabsTrigger>
              </TabsList>
            </CardHeader>
            <Separator />
            <CardContent className="min-h-0 flex-1 px-0">
              <ScrollArea className="h-full">
                <TabsContent value="faults" className="p-3 pt-3">
                  <ConstraintViolations />
                  <FaultPanel />
                </TabsContent>
                <TabsContent value="verify">
                  <VerifyPanel />
                </TabsContent>
              </ScrollArea>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
