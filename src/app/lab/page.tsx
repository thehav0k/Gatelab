"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Boxes, ChevronDown, FileText, Maximize2, Minimize2, Redo2, Stethoscope, Trash2, Undo2 } from "lucide-react";

import { CircuitCanvas } from "@/components/lab/circuit-canvas";
import { BreadboardView } from "@/components/lab/breadboard-view";
import { Palette } from "@/components/lab/palette";
import { FaultPanel } from "@/components/lab/fault-panel";
import { VerifyPanel } from "@/components/lab/verify-panel";
import { WaveformPanel } from "@/components/lab/waveform-panel";
import { PresetMenu } from "@/components/lab/preset-menu";
import { EquationBuilder } from "@/components/lab/equation-builder";
import { ConstraintMenu, ConstraintViolations } from "@/components/lab/constraint-menu";
import { ClockPanel } from "@/components/lab/clock-panel";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { useCircuitStore } from "@/stores/circuit-store";
import { useExpected } from "@/stores/spec-store";
import type { BooleanFunction } from "@/lib/core-engine/types";
import { cn } from "@/lib/utils";

const WIRE_COLORS = [
  { label: "Red (+5V)", value: "#ef4444" },
  { label: "Black (GND)", value: "#1f2937" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Green", value: "#10b981" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Orange", value: "#f97316" },
  { label: "Purple", value: "#8b5cf6" },
  { label: "Cyan", value: "#06b6d4" },
];

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia("(min-width: 1280px)");
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => (typeof window !== "undefined" ? window.matchMedia("(min-width: 1280px)").matches : false),
    () => false,
  );
}

export default function LabPage() {
  const isDesktop = useIsDesktop();
  const expected = useExpected();
  const undo = useCircuitStore((s) => s.undo);
  const redo = useCircuitStore((s) => s.redo);
  const clear = useCircuitStore((s) => s.clear);
  const deleteSelected = useCircuitStore((s) => s.deleteSelected);
  const canUndo = useCircuitStore((s) => s.past.length > 0);
  const canRedo = useCircuitStore((s) => s.future.length > 0);
  const pendingPin = useCircuitStore((s) => s.pendingPin);
  const pendingHole = useCircuitStore((s) => s.pendingHole);
  const activeWireColor = useCircuitStore((s) => s.activeWireColor);
  const setActiveWireColor = useCircuitStore((s) => s.setActiveWireColor);
  const errorCount = useCircuitStore(
    (s) => s.diagnostics.filter((d) => d.severity === "error").length,
  );

  const onBoard = useCircuitStore((s) => !!s.doc.board);
  const toBreadboard = useCircuitStore((s) => s.toBreadboard);
  const toSchematic = useCircuitStore((s) => s.toSchematic);
  const hasSchematic = useCircuitStore((s) => s.schematic !== null);
  const hasNodes = useCircuitStore((s) => Object.keys(s.doc.nodes).length > 0);
  const hasFlops = useCircuitStore((s) =>
    Object.values(s.doc.nodes).some((n) => n.kind === "clock") ||
    Object.keys(s.flopState).length > 0,
  );

  const [timingChoice, setTimingChoice] = useState<boolean | null>(null);
  const showTiming = timingChoice ?? false;

  const [partsOpen, setPartsOpen] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarUserChoice, setRightSidebarUserChoice] = useState<boolean | null>(null);
  const rightSidebarOpen = rightSidebarUserChoice ?? (isDesktop || Boolean(expected));
  const setRightSidebarOpen = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      setRightSidebarUserChoice((prev) => {
        const current = prev ?? (isDesktop || Boolean(expected));
        return typeof action === "function" ? action(current) : action;
      });
    },
    [isDesktop, expected],
  );
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if ((e.key === "Backspace" || e.key === "Delete") && !onBoard) {
        deleteSelected();
      }
      if (e.key === "Escape") {
        if (isZenMode) setIsZenMode(false);
        else if (!onBoard) useCircuitStore.getState().cancelWire();
      }
      if (e.key === "f" || e.key === "F") {
        setIsZenMode((v) => !v);
      }
      if (e.key === "[" || e.key.toLowerCase() === "b") {
        setLeftSidebarOpen((v) => !v);
      }
      if (e.key === "]") {
        setRightSidebarOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, undo, redo, isZenMode, onBoard, setRightSidebarOpen, setLeftSidebarOpen]);

  const [prevExpected, setPrevExpected] = useState<BooleanFunction | null>(null);
  if (expected && expected !== prevExpected) {
    setPrevExpected(expected);
    setRightSidebarUserChoice(true);
  }

  const hint = pendingHole
    ? "Now click a second hole to lay the jumper — or press Escape."
    : pendingPin
      ? "Now click a second pin to complete the wire — or press Escape."
      : onBoard
        ? "Click a hole, then another, to lay a jumper. Click a wire to select it (Alt+Click or Delete/Backspace to delete a wire). Hover any hole to probe."
        : "Click a pin, then another, to wire them. Click a switch to toggle it; Alt+Click or Delete/Backspace to delete a wire.";

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
        toBreadboard();
        return;
      }
      const unplaced = toBreadboard();
      if (unplaced.length > 0) {
        const schematicDoc = useCircuitStore.getState().schematic;
        const partNames = unplaced
          .map((id) => schematicDoc?.nodes[id]?.label || id)
          .join(", ");
        toast.warning(
          `${unplaced.length} part${unplaced.length === 1 ? "" : "s"} did not fit: ${partNames}`,
          {
            description:
              "The breadboard ran out of space. You can switch back to schematic or simplify the circuit.",
            duration: 8000,
            action: {
              label: "Back to schematic",
              onClick: () => switchView("schematic"),
            },
          },
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
        if (!hasNodes) {
          useCircuitStore.getState().clear();
          return;
        }
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

  /**
   * The workspace, on a phone.
   *
   * A 180px palette, a canvas and a 340px inspector do not fit side by side on a
   * 390px screen, and the old fixed `grid-cols-[180px_1fr_340px]` did not even try
   * — it just squeezed the canvas down to a sliver between two columns that were
   * themselves too narrow to read.
   *
   * So below `lg` the two side columns become sheets. The canvas gets the whole
   * screen, which is the only element that genuinely needs it, and the palette and
   * the inspector are one tap away. The desktop layout is untouched.
   */
  const inspector = (
    <Tabs
      defaultValue={expected ? "verify" : "faults"}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <CardHeader className="shrink-0 px-3 pt-3 pb-2">
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
  );

  return (
    <div
      className={cn(
        "flex w-full overflow-hidden flex-col bg-background transition-[padding,margin] duration-200 [transition-timing-function:var(--ease-out-expo)]",
        isZenMode
          ? "fixed inset-0 z-50 h-screen w-screen p-0 m-0"
          : "h-[calc(100dvh-3.5rem)] px-2 py-2 sm:px-3 sm:py-2.5",
      )}
    >
      {/* Floating Exit Zen Button in Top-Right Corner */}
      {isZenMode && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsZenMode(false)}
          title="Exit Zen Fullscreen Mode (Esc or F)"
          className="fixed top-3 right-3 z-50 h-8 gap-1.5 bg-background/85 hover:bg-background backdrop-blur-md border shadow-lg text-xs transition-transform hover:scale-105"
        >
          <Minimize2 className="size-3.5 text-foreground" />
          <span className="font-medium text-foreground">Exit Zen</span>
          <kbd className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono font-medium rounded border border-border bg-muted text-muted-foreground shadow-2xs">
            Esc
          </kbd>
        </Button>
      )}

      {/* --- toolbar (hidden in Zen mode) ------------------------------------ */}
      {!isZenMode && (
        <header className="mb-2 flex flex-wrap items-center gap-2 sm:gap-2.5">
        <div className={cn("min-w-0 flex-1 lg:flex-initial", headerCollapsed && "hidden")}>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
              Practical Lab
            </h1>
            <button
              type="button"
              onClick={() => setHeaderCollapsed(true)}
              title="Compact Toolbar (Hide Banner)"
              aria-label="Compact Toolbar"
              className="text-[11px] text-muted-foreground hover:text-foreground hidden sm:inline-block cursor-pointer px-1 rounded border"
            >
              Compact
            </button>
          </div>
          {/* The hint is a whole sentence. On a phone it would eat the toolbar. */}
          <p className="text-muted-foreground mt-0.5 hidden truncate text-xs sm:block">
            {hint}
          </p>
        </div>

        {headerCollapsed && (
          <button
            type="button"
            onClick={() => setHeaderCollapsed(false)}
            title="Expand Banner"
            aria-label="Expand Banner"
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer px-2 py-1 rounded border flex items-center gap-1"
          >
            <span className="font-semibold text-foreground">Lab</span>
            <span className="text-[11px]">▼</span>
          </button>
        )}

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 lg:ml-auto">
          {/* Zen Fullscreen Mode Toggle */}
          <Button
            variant={isZenMode ? "secondary" : "outline"}
            size="sm"
            onClick={() => setIsZenMode((v) => !v)}
            title="Toggle Zen Fullscreen Mode (Hotkey F or Esc)"
            aria-label="Toggle Zen Fullscreen Mode"
            className="h-8 gap-1.5 text-xs shadow-xs"
          >
            {isZenMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            <span className="hidden xl:inline">{isZenMode ? "Exit Zen" : "Zen Mode"}</span>
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono font-medium rounded border border-border bg-muted text-muted-foreground shadow-2xs">
              F
            </kbd>
          </Button>

          {/* Desktop Left Sidebar Toggle */}
          <Button
            variant={leftSidebarOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setLeftSidebarOpen((v) => !v)}
            title="Toggle Parts Sidebar (B or [)"
            aria-label="Toggle Parts Sidebar"
            className="hidden lg:flex gap-1.5 h-8 text-xs"
          >
            <Boxes className="size-3.5" />
            <span className="hidden xl:inline">Parts</span>
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono font-medium rounded border border-border bg-muted text-muted-foreground shadow-2xs">
              [
            </kbd>
          </Button>

          {/* Wire Color Pre-Selection Swatches */}
          <div className="hidden xl:flex items-center gap-1 px-2 py-1 rounded-md border bg-card/60 shadow-xs h-8">
            <span className="text-[11px] text-muted-foreground mr-0.5 font-medium">Wire:</span>
            <button
              type="button"
              onClick={() => setActiveWireColor(null)}
              title="Automatic Wire Color"
              aria-label="Automatic wire color"
              className={cn(
                "px-1.5 py-0.5 text-[11px] rounded font-mono font-medium transition-colors",
                activeWireColor === null
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Auto
            </button>
            {WIRE_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setActiveWireColor(c.value)}
                title={c.label}
                aria-label={c.label}
                style={{ backgroundColor: c.value }}
                className={cn(
                  "size-3.5 rounded-full transition-transform duration-150 border border-background/50 hover:scale-125 cursor-pointer",
                  activeWireColor === c.value &&
                    "ring-2 ring-foreground ring-offset-1 ring-offset-background scale-110",
                )}
              />
            ))}
          </div>

          {/* --- the two side panels, as sheets, below lg / xl --- */}
          <Sheet open={partsOpen} onOpenChange={setPartsOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="lg:hidden" aria-label="Open parts palette">
                <Boxes className="size-3.5" /> <span className="hidden sm:inline">Parts</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0">
              <SheetHeader className="pb-0">
                <SheetTitle>Parts</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-full">
                <Palette onPlace={() => setPartsOpen(false)} />
              </ScrollArea>
            </SheetContent>
          </Sheet>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="xl:hidden" aria-label="Open faults and verification drawer">
                <Stethoscope className="size-3.5" />
                <span className="hidden sm:inline">Check</span>
                {errorCount > 0 && (
                  <Badge variant="destructive" className="ml-1 px-1.5">
                    {errorCount}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex w-[340px] flex-col p-0 sm:w-[380px]">
              <SheetHeader className="sr-only">
                <SheetTitle>Faults and verification</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1">{inspector}</div>
            </SheetContent>
          </Sheet>

          {/* Desktop Right Inspector Toggle */}
          <Button
            variant={rightSidebarOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setRightSidebarOpen((v) => !v)}
            title="Toggle Faults & Verification Inspector (])"
            aria-label="Toggle Faults & Verification Inspector"
            className="hidden xl:flex gap-1.5 h-8 text-xs"
          >
            <Stethoscope className="size-3.5" />
            <span className="hidden 2xl:inline">Inspect</span>
            {errorCount > 0 && (
              <Badge variant="destructive" className="ml-0.5 px-1.5 text-[11px]">
                {errorCount}
              </Badge>
            )}
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono font-medium rounded border border-border bg-muted text-muted-foreground shadow-2xs">
              ]
            </kbd>
          </Button>

          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={onBoard ? "board" : "schematic"}
            onValueChange={switchView}
            className="border shadow-2xs p-0.5 rounded-lg"
          >
            <ToggleGroupItem
              id="toggle-schematic"
              value="schematic"
              disabled={onBoard && !hasSchematic}
              className={cn("px-2.5 text-xs font-medium", !onBoard && "bg-secondary text-secondary-foreground font-semibold")}
            >
              Schematic
            </ToggleGroupItem>
            <ToggleGroupItem
              id="toggle-breadboard"
              value="board"
              className={cn("px-2.5 text-xs font-medium", onBoard && "bg-secondary text-secondary-foreground font-semibold")}
            >
              Breadboard
            </ToggleGroupItem>
          </ToggleGroup>

          <ConstraintMenu />
          <PresetMenu />
          <EquationBuilder />

          <Separator orientation="vertical" className="hidden h-5 sm:block" />

          <Button variant="outline" size="sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 className="size-3.5" />
            <span className="sr-only">Undo</span>
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Redo2 className="size-3.5" />
            <span className="sr-only">Redo</span>
          </Button>

          <Separator orientation="vertical" className="hidden h-5 sm:block" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!hasNodes) return;
              const nodeCount = Object.keys(useCircuitStore.getState().doc.nodes).length;
              if (nodeCount > 5 && typeof window !== "undefined") {
                if (!window.confirm(`Clear circuit with ${nodeCount} parts? This can be undone with Ctrl+Z.`)) {
                  return;
                }
              }
              clear();
              toast("Circuit cleared — Undo", {
                action: {
                  label: "Undo",
                  onClick: () => undo(),
                },
              });
            }}
            title="Clear circuit (Destructive, Undoable with Ctrl+Z)"
            aria-label="Clear circuit"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <Trash2 className="size-3.5" />
            <span className="sr-only">Clear</span>
          </Button>

          <Separator orientation="vertical" className="hidden h-5 sm:block" />

          <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs shadow-xs" title="Export Circuit Report" aria-label="Export Circuit Report">
            <Link href="/report">
              <FileText className="size-3.5" />
              <span className="hidden sm:inline">Report</span>
            </Link>
          </Button>
        </div>
      </header>
      )}

      {/* --- workspace: full-viewport with collapsible sidebars -------------------- */}
      <div className={cn("flex min-h-0 flex-1 overflow-hidden", !isZenMode && "gap-2.5")}>
        {leftSidebarOpen && !isZenMode && (
          <Card className="hidden min-h-0 w-[210px] shrink-0 overflow-hidden py-0 lg:block shadow-xs">
            <ScrollArea className="h-full">
              <Palette />
            </ScrollArea>
          </Card>
        )}

        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !isZenMode && "gap-2")}>
          <div className="min-h-0 flex-1">
            {onBoard ? <BreadboardView /> : <CircuitCanvas />}
          </div>

          {(!onBoard || hasFlops) && !isZenMode && <ClockPanel />}

          {!isZenMode && (
            <Card className="shrink-0 overflow-hidden py-0 shadow-xs">
              <button
                type="button"
                onClick={() => setTimingChoice(!showTiming)}
                aria-expanded={showTiming}
                aria-controls="timing-diagram-content"
                className="hover:bg-accent/50 flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left cursor-pointer h-7 select-none transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-semibold text-foreground">Timing</span>
                </div>
                <span className="text-muted-foreground hidden text-[11px] sm:inline font-mono">
                  Engine: {hasFlops ? "clock-driven" : "unit-delay, Gray-code sweep"}
                </span>
                <span className="text-muted-foreground ml-auto flex items-center gap-1 text-[11px] font-medium">
                  <span>{showTiming ? "Hide Timing Diagram" : "Show Timing Diagram"}</span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform duration-200 [transition-timing-function:var(--ease-out-expo)]",
                      showTiming && "rotate-180",
                    )}
                  />
                </span>
              </button>
              <div
                id="timing-diagram-content"
                className={cn(
                  "grid transition-[grid-template-rows] duration-220 [transition-timing-function:var(--ease-out-expo)]",
                  showTiming ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <Separator />
                  <CardContent className="max-h-[160px] overflow-auto px-0 sm:max-h-[220px]">
                    <WaveformPanel />
                  </CardContent>
                </div>
              </div>
            </Card>
          )}
        </div>

        {rightSidebarOpen && !isZenMode && (
          <Card className="hidden min-h-0 w-[340px] shrink-0 overflow-hidden py-0 xl:block shadow-xs">
            {inspector}
          </Card>
        )}
      </div>
    </div>
  );
}
