"use client";

import { useEffect } from "react";
import { CircuitCanvas } from "@/components/lab/circuit-canvas";
import { Palette } from "@/components/lab/palette";
import { FaultPanel } from "@/components/lab/fault-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCircuitStore } from "@/stores/circuit-store";
import { Redo2, Trash2, Undo2 } from "lucide-react";

export default function LabPage() {
  const undo = useCircuitStore((s) => s.undo);
  const redo = useCircuitStore((s) => s.redo);
  const clear = useCircuitStore((s) => s.clear);
  const deleteSelected = useCircuitStore((s) => s.deleteSelected);
  const canUndo = useCircuitStore((s) => s.past.length > 0);
  const canRedo = useCircuitStore((s) => s.future.length > 0);
  const pendingPin = useCircuitStore((s) => s.pendingPin);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-6 py-6">
      <header className="mb-4 flex items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Practical Lab</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {pendingPin
              ? "Now click a second pin to complete the wire — or press Escape."
              : "Click a pin, then another, to wire them. Click a switch to toggle it; click a wire to delete it."}
          </p>
        </div>

        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={undo} disabled={!canUndo}>
            <Undo2 /> Undo
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={!canRedo}>
            <Redo2 /> Redo
          </Button>
          <Button variant="outline" size="sm" onClick={clear}>
            <Trash2 /> Clear
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[190px_1fr_320px]">
        <Card className="min-h-0 overflow-auto py-0">
          <Palette />
        </Card>

        <div className="min-h-[560px]">
          <CircuitCanvas />
        </div>

        <Card className="min-h-0 overflow-auto py-0">
          <CardHeader className="pt-4">
            <CardTitle className="text-base">Faults</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="px-0">
            <FaultPanel />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
