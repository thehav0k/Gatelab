"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCircuitStore } from "@/stores/circuit-store";
import {
  logicColor,
  useEndpointValue,
  useNetOrdinal,
  wirePaint,
} from "@/stores/sim-store";
import {
  ALL_ROWS,
  BOARD_PAD,
  DEFAULT_BOARD,
  PITCH,
  ROWS_LOWER,
  ROWS_UPPER,
  boardHeight,
  boardWidth,
  dipHoles,
  holeAt,
  holePoint,
  isPositiveRail,
  isRail,
  sameStrip,
  stripOf,
  type BoardRow,
  type BreadboardSpec,
  type HoleRef,
} from "@/lib/simulation/breadboard";
import {
  asNodeId,
  endpointKey,
  holeEnd,
  pinEnd,
  pinKey,
  type CircuitDocument,
  type CircuitNode,
  type ClockNode,
  type Endpoint,
  type PinRef,
  type Point,
  type Wire,
  type WireId,
} from "@/lib/simulation/netlist";
import { getIc, type IcDefinition } from "@/lib/simulation/ic-library";
import {
  routeBreadboardWires,
  type BoundingBox,
  type BreadboardChannelConfig,
  type RoutedWire,
  type WireRouteInput,
} from "@/lib/simulation/breadboard-router";
import { useViewBox } from "@/hooks/use-viewbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CircuitBoard, Cpu, Eye, EyeOff, Layers, Maximize2, Plus, Radio, Zap } from "lucide-react";
import { toast } from "sonner";
import { useConstraint, useWorkspaceStore } from "@/stores/workspace-store";
import { useSpecStore } from "@/stores/spec-store";
import { rebuildUnder } from "@/lib/simulation/rebuild";
import { PRESETS, buildPreset } from "@/lib/simulation/presets";
import { describeDesign } from "@/lib/simulation/synth";
import { cn } from "@/lib/utils";

export const BOARD_OFFSET_X = 60;
export const BOARD_OFFSET_Y = 110;

const RAIL_ROWS: BoardRow[] = ["+top", "-top", "+bottom", "-bottom"];

export const COLOR_SWATCHES = [
  { label: "Red (+5V)", value: "#ef4444" },
  { label: "Black (GND)", value: "#1f2937" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Green", value: "#10b981" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Orange", value: "#f97316" },
  { label: "Purple", value: "#8b5cf6" },
  { label: "Cyan", value: "#06b6d4" },
];

/**
 * The upgraded breadboard environment:
 * - Full-Screen Digital Logic Trainer Board chassis (+5V, GND, CLK Gen, Input Switches, LED Monitor)
 * - Authentic 5-hole terminal strip connectivity & live 4-state probing
 * - 74xx DIP-14 internal gate X-Ray overlays & Pin-1 orientation ergonomics
 * - Horizontal IC dragging along the center ravine with collision prevention
 * - Safe wire selection, auto-coloring, and deletion UX
 */
export function BreadboardView() {
  const doc = useCircuitStore((s) => s.doc);
  const spec = doc.board ?? DEFAULT_BOARD;

  const clickHole = useCircuitStore((s) => s.clickHole);
  const pendingHole = useCircuitStore((s) => s.pendingHole);
  const clickPin = useCircuitStore((s) => s.clickPin);
  const pendingPin = useCircuitStore((s) => s.pendingPin);
  const cancelWire = useCircuitStore((s) => s.cancelWire);
  const deleteWire = useCircuitStore((s) => s.deleteWire);
  const setWireColor = useCircuitStore((s) => s.setWireColor);
  const setLedColor = useCircuitStore((s) => s.setLedColor);
  const autoWireIcPower = useCircuitStore((s) => s.autoWireIcPower);
  const toggleSwitch = useCircuitStore((s) => s.toggleSwitch);
  const toggleClock = useCircuitStore((s) => s.toggleClock);
  const pulseClock = useCircuitStore((s) => s.pulseClock);
  const pulseClear = useCircuitStore((s) => s.pulseClear);
  const diagnostics = useCircuitStore((s) => s.diagnostics);
  const selection = useCircuitStore((s) => s.selection);
  const select = useCircuitStore((s) => s.select);
  const deleteSelected = useCircuitStore((s) => s.deleteSelected);
  const moveNode = useCircuitStore((s) => s.moveNode);
  const addNode = useCircuitStore((s) => s.addNode);

  const theorySource = useWorkspaceStore((s) => s.theorySource);
  const constraint = useConstraint();
  const setSpec = useSpecStore((s) => s.setSpec);
  const clearSpec = useSpecStore((s) => s.clear);
  const load = useCircuitStore((s) => s.load);
  const toBreadboard = useCircuitStore((s) => s.toBreadboard);
  const toSchematic = useCircuitStore((s) => s.toSchematic);
  const clearCircuit = useCircuitStore((s) => s.clear);

  const [hover, setHover] = useState<HoleRef | null>(null);
  const [hoverSocket, setHoverSocket] = useState<{ point: Point; pin: PinRef; label: string; color: string } | null>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const hoverValue = useEndpointValue(hover ? holeEnd(hover) : null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const selectedWire = selectedWireId ? doc.wires[selectedWireId as WireId] : null;
  const [showXRay, setShowXRay] = useState<boolean>(true);
  const [showAirwires, setShowAirwires] = useState<boolean>(false);
  const [autoHz, setAutoHz] = useState<number | null>(null);

  const nodes = useMemo(() => Object.values(doc.nodes), [doc.nodes]);

  const vccNode = useMemo(
    () => nodes.find((n) => n.kind === "rail" && n.rail === "vcc") ?? null,
    [nodes],
  );
  const gndNode = useMemo(
    () => nodes.find((n) => n.kind === "rail" && n.rail === "gnd") ?? null,
    [nodes],
  );
  const clockNode = useMemo(
    () => nodes.find((n): n is Extract<CircuitNode, { kind: "clock" }> => n.kind === "clock") ?? null,
    [nodes],
  );
  const switchNodes = useMemo(
    () => nodes.filter((n): n is Extract<CircuitNode, { kind: "switch" }> => n.kind === "switch"),
    [nodes],
  );
  const ledNodes = useMemo(
    () => nodes.filter((n): n is Extract<CircuitNode, { kind: "led" }> => n.kind === "led"),
    [nodes],
  );
  const icNodes = useMemo(
    () => nodes.filter((n): n is Extract<CircuitNode, { kind: "ic" }> => n.kind === "ic"),
    [nodes],
  );

  const unpoweredNodes = useMemo(
    () => icNodes.filter((n) => diagnostics.some((d) => d.code === "UNPOWERED_IC" && d.node === n.id)),
    [icNodes, diagnostics],
  );

  // Auto-clock effect: periodic 50% duty cycle square wave at selected frequency
  useEffect(() => {
    if (autoHz === null) return;
    const interval = setInterval(() => {
      const state = useCircuitStore.getState();
      const clks = Object.values(state.doc.nodes).filter(
        (n): n is ClockNode => n.kind === "clock",
      );
      if (clks.length === 0) {
        const id = state.addNode({ kind: "clock", label: "CLK", state: 0, pos: { x: 0, y: 0 } });
        if (id) state.toggleClock(id);
      } else {
        for (const c of clks) state.toggleClock(c.id);
      }
    }, 1000 / (2 * autoHz));
    return () => {
      clearInterval(interval);
      const state = useCircuitStore.getState();
      for (const n of Object.values(state.doc.nodes)) {
        if (n.kind === "clock" && n.state === 1) {
          state.setClock(n.id, () => 0);
        }
      }
    };
  }, [autoHz]);

  // Exact coordinates of all Trainer Panel sockets
  const trainerPinMap = useMemo(() => {
    const map = new Map<string, Point>();
    const register = (pin: PinRef, pt: Point) => {
      map.set(pinKey(pin), pt);
      map.set(`${pin.node}:${pin.pin}`, pt);
    };

    const vccId = vccNode ? vccNode.id : asNodeId("pending_vcc");
    const gndId = gndNode ? gndNode.id : asNodeId("pending_gnd");
    const clkId = clockNode ? clockNode.id : asNodeId("pending_clk");
    register({ node: vccId, pin: "VCC" }, { x: 430, y: 60 });
    register({ node: gndId, pin: "GND" }, { x: 520, y: 60 });
    register({ node: clkId, pin: "Y" }, { x: 850, y: 55 });

    switchNodes.forEach((sw, i) => {
      register({ node: sw.id, pin: "Y" }, { x: 105 + i * 82 + 18, y: 646 });
    });

    ledNodes.forEach((led, i) => {
      register({ node: led.id, pin: "A" }, { x: 945 + i * 66, y: 72 });
    });

    return map;
  }, [vccNode, gndNode, clockNode, switchNodes, ledNodes]);

  // List of all Trainer Panel sockets for magnetic hovering and snapping
  const trainerSocketsList = useMemo(() => {
    const list: { point: Point; pin: PinRef; label: string; color: string }[] = [];
    const vccId = vccNode ? vccNode.id : asNodeId("pending_vcc");
    const gndId = gndNode ? gndNode.id : asNodeId("pending_gnd");
    const clkId = clockNode ? clockNode.id : asNodeId("pending_clk");

    list.push({ point: { x: 430, y: 60 }, pin: { node: vccId, pin: "VCC" }, label: "+5V", color: "#ef4444" });
    list.push({ point: { x: 520, y: 60 }, pin: { node: gndId, pin: "GND" }, label: "GND", color: "#3b82f6" });
    list.push({ point: { x: 850, y: 55 }, pin: { node: clkId, pin: "Y" }, label: "CLK", color: "#f59e0b" });
    switchNodes.forEach((sw, i) => {
      list.push({ point: { x: 105 + i * 82 + 18, y: 646 }, pin: { node: sw.id, pin: "Y" }, label: sw.label, color: "#38bdf8" });
    });
    ledNodes.forEach((led, i) => {
      list.push({ point: { x: 945 + i * 66, y: 72 }, pin: { node: led.id, pin: "A" }, label: led.label, color: led.color ?? "#22c55e" });
    });
    return list;
  }, [vccNode, gndNode, clockNode, switchNodes, ledNodes]);

  const pendingStart = useMemo<Point | null>(() => {
    if (pendingHole) {
      const p = holePoint(pendingHole);
      return { x: BOARD_OFFSET_X + p.x, y: BOARD_OFFSET_Y + p.y };
    }
    if (pendingPin) {
      return (
        trainerPinMap.get(pinKey(pendingPin)) ??
        trainerPinMap.get(`${pendingPin.node}:${pendingPin.pin}`) ??
        null
      );
    }
    return null;
  }, [pendingHole, pendingPin, trainerPinMap]);

  const pendingTarget = useMemo<Point | null>(() => {
    if (!pendingStart) return null;
    if (hoverSocket) return hoverSocket.point;
    if (hover) {
      const p = holePoint(hover);
      return { x: BOARD_OFFSET_X + p.x, y: BOARD_OFFSET_Y + p.y };
    }
    return cursorPos;
  }, [pendingStart, hoverSocket, hover, cursorPos]);

  // Dedicated Manhattan routing channels
  const channelConfig = useMemo<BreadboardChannelConfig>(
    () => ({
      topPanelGutterY: 105,
      upperStripGutterY: 190,
      centerRavineY: 346,
      lowerStripGutterY: 502,
      bottomPanelGutterY: 572,
      laneSpacing: 5,
      cornerRadius: 6,
    }),
    [],
  );

  // IC Obstacle Bounding Boxes for Obstacle Avoidance
  const icObstacles = useMemo<BoundingBox[]>(() => {
    return icNodes.map((ic) => {
      const def = getIc(ic.part);
      const pinTotal = def ? def.pins.length : 14;
      const span = pinTotal / 2;
      const col = Math.round(ic.pos.x);
      const holes = dipHoles({ col }, pinTotal);
      const first = holes[0];
      const last = holes[span - 1];
      if (!first || !last) return { id: ic.id, minX: 0, minY: 0, maxX: 0, maxY: 0 };
      const a = holePoint(first);
      const b = holePoint(last);
      const top = holePoint({ col: first.col, row: "F" }).y;
      const bottom = a.y;
      return {
        id: ic.id,
        minX: BOARD_OFFSET_X + a.x - PITCH / 2 + 2,
        maxX: BOARD_OFFSET_X + b.x + PITCH / 2 - 2,
        minY: BOARD_OFFSET_Y + top - 3,
        maxY: BOARD_OFFSET_Y + bottom + 3,
      };
    });
  }, [icNodes]);

  // Optional custom horizontal channel offset per wire (from dragging)
  const [wireCustomY, setWireCustomY] = useState<Record<string, number>>({});

  // Prepare WireRouteInput[] for all jumpers
  const wireInputs = useMemo<WireRouteInput[]>(() => {
    const list: WireRouteInput[] = [];
    for (const wire of Object.values(doc.wires)) {
      const a = resolveEndpointPoint(wire.a, trainerPinMap, doc.nodes);
      const b = resolveEndpointPoint(wire.b, trainerPinMap, doc.nodes);
      if (!a || !b) continue;
      list.push({
        id: wire.id,
        from: a,
        to: b,
        color: wire.color || "#38bdf8",
        customChannelY: wireCustomY[wire.id],
      });
    }
    return list;
  }, [doc.wires, trainerPinMap, doc.nodes, wireCustomY]);

  // Compute clean, non-overlapping orthogonal routes
  const routedWires = useMemo(() => {
    return routeBreadboardWires(wireInputs, channelConfig, icObstacles);
  }, [wireInputs, channelConfig, icObstacles]);

  const routedWireMap = useMemo(() => {
    const map = new Map<string, RoutedWire>();
    for (const rw of routedWires) {
      map.set(rw.id, rw);
    }
    return map;
  }, [routedWires]);

  // Keyboard shortcuts: X (X-Ray), A (Airwires), Delete/Backspace (Delete wire or IC), Escape (Cancel)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if (e.key === "x" || e.key === "X") {
        setShowXRay((v) => !v);
      } else if (e.key === "a" || e.key === "A") {
        setShowAirwires((v) => !v);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedWireId) {
          deleteWire(selectedWireId as WireId);
          setSelectedWireId(null);
          toast.info("Deleted jumper wire");
        } else if (selection.length > 0) {
          deleteSelected();
          toast.info("Deleted component");
        }
      } else if (e.key === "Escape") {
        setSelectedWireId(null);
        select([]);
        cancelWire();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedWireId, selection, deleteWire, deleteSelected, select, cancelWire]);

  const handleSynthesizeTheory = () => {
    const src = theorySource?.trim() || "F(A,B,C) = A'B + BC";
    const rebuilt = rebuildUnder(src, constraint);
    if (!rebuilt.ok) {
      toast.error("Could not synthesize expression", { description: rebuilt.reason });
      return;
    }
    setSpec(src);
    load(rebuilt.doc, src);
    toBreadboard();
    toast.success("Synthesized onto breadboard", {
      description: describeDesign(rebuilt.design),
    });
  };

  const handleLoadStarterPreset = () => {
    const preset = PRESETS[0];
    if (!preset) return;
    load(buildPreset(preset));
    clearSpec();
    toBreadboard();
    toast.success(`Loaded ${preset.name}`, {
      description: preset.note ?? "Seated on breadboard",
    });
  };

  const handleSwitchToSchematic = () => {
    if (!toSchematic()) {
      clearCircuit();
    }
  };

  const handleInitTrainerDefaults = () => {
    ["A", "B", "C", "D"].forEach((lbl) => {
      addNode({ kind: "switch", label: lbl, state: 0, pos: { x: 0, y: 0 } });
    });
    ["L0", "L1", "L2", "L3"].forEach((lbl) => {
      addNode({ kind: "led", label: lbl, pos: { x: 0, y: 0 } });
    });
    if (!vccNode) addNode({ kind: "rail", rail: "vcc", label: "+5V", pos: { x: 0, y: 0 } });
    if (!gndNode) addNode({ kind: "rail", rail: "gnd", label: "GND", pos: { x: 0, y: 0 } });
    if (!clockNode) addNode({ kind: "clock", label: "CLK", state: 0, pos: { x: 0, y: 0 } });
    toast.success("Initialized Digital Logic Trainer Bench with 4 Switches, 4 LEDs, and Power");
  };

  const handleAddSwitch = () => {
    const letter = String.fromCharCode(65 + (switchNodes.length % 26));
    addNode({ kind: "switch", label: letter, state: 0, pos: { x: 0, y: 0 } });
    toast.success(`Added Switch ${letter}`);
  };

  const handleAddLed = () => {
    const lbl = `L${ledNodes.length}`;
    addNode({ kind: "led", label: lbl, pos: { x: 0, y: 0 } });
    toast.success(`Added LED ${lbl}`);
  };

  const handleVccClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vcc = nodes.find((n) => n.kind === "rail" && n.rail === "vcc");
    if (!vcc) {
      const id = addNode({ kind: "rail", rail: "vcc", label: "+5V", pos: { x: 0, y: 0 } });
      if (id) clickPin({ node: id, pin: "VCC" });
    } else {
      clickPin({ node: vcc.id, pin: "VCC" });
    }
  };

  const handleGndClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const gnd = nodes.find((n) => n.kind === "rail" && n.rail === "gnd");
    if (!gnd) {
      const id = addNode({ kind: "rail", rail: "gnd", label: "GND", pos: { x: 0, y: 0 } });
      if (id) clickPin({ node: id, pin: "GND" });
    } else {
      clickPin({ node: gnd.id, pin: "GND" });
    }
  };

  const handleClockClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const clk = nodes.find((n) => n.kind === "clock");
    if (!clk) {
      const id = addNode({ kind: "clock", label: "CLK", state: 0, pos: { x: 0, y: 0 } });
      if (id) clickPin({ node: id, pin: "Y" });
    } else {
      clickPin({ node: clk.id, pin: "Y" });
    }
  };

  const handlePulse = (e: React.MouseEvent) => {
    e.stopPropagation();
    const clk = nodes.find((n) => n.kind === "clock");
    if (!clk) {
      const id = addNode({ kind: "clock", label: "CLK", state: 0, pos: { x: 0, y: 0 } });
      if (id) pulseClock(id);
    } else {
      pulseClock(clk.id);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    pulseClear();
    toast.info("Cleared flip-flops (state -> 0)");
  };

  const w = boardWidth(spec);
  const h = boardHeight();
  const CHASSIS_W = Math.max(
    BOARD_OFFSET_X * 2 + w,
    945 + (ledNodes.length + 1) * 66 + 40,
    105 + (switchNodes.length + 1) * 82 + 80,
  );
  const CHASSIS_H = BOARD_OFFSET_Y + h + 115;

  /** Fit the camera to the full trainer chassis */
  const natural = useMemo(() => {
    return { x: 0, y: 0, w: Math.max(1200, CHASSIS_W), h: CHASSIS_H };
  }, [CHASSIS_W, CHASSIS_H]);

  const svgRef = useRef<SVGSVGElement>(null);
  const cam = useViewBox(natural, svgRef);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="relative h-full w-full">
      {/* Top Breadboard Action Toolbar */}
      <div className="no-print absolute right-2 top-2 z-10 flex items-center gap-1.5">
        {unpoweredNodes.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-amber-500/50 bg-card/90 text-amber-500 hover:bg-amber-500/10 shadow-xs"
            onClick={() => {
              unpoweredNodes.forEach((n) => autoWireIcPower(n.id));
              toast.success(`Auto-powered ${unpoweredNodes.length} IC${unpoweredNodes.length > 1 ? "s" : ""}`);
            }}
            aria-label={`Auto-wire VCC and GND to power rails for ${unpoweredNodes.length} ICs`}
            title="Auto-wire VCC and GND to power rails for all unpowered ICs"
          >
            <Zap className="size-3.5 mr-1 fill-amber-500" />
            <span>Auto-Power ({unpoweredNodes.length})</span>
          </Button>
        )}
        <Button
          variant={showXRay ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1 shadow-xs"
          onClick={() => setShowXRay((v) => !v)}
          aria-label="Toggle DIP-14 Internal Gate X-Ray View"
          title="Toggle DIP-14 Internal Gate X-Ray View (Hotkey X)"
        >
          {showXRay ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-muted-foreground" />}
          <span>X-Ray</span>
          <kbd className="ml-0.5 rounded bg-muted/40 px-1 text-[11px] font-mono">X</kbd>
        </Button>
        <Button
          variant={showAirwires ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1 shadow-xs"
          onClick={() => setShowAirwires((v) => !v)}
          aria-label="Toggle Unrouted Schematic Airwires Guide"
          title="Toggle Unrouted Schematic Airwires Guide (Hotkey A)"
        >
          <Radio className="size-3.5" />
          <span>Airwires</span>
          <kbd className="ml-0.5 rounded bg-muted/40 px-1 text-[11px] font-mono">A</kbd>
        </Button>
        <div className="flex items-center rounded-md border bg-card/90 shadow-xs h-7 px-1 text-xs font-mono">
          <button
            type="button"
            className="px-1.5 py-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
            onClick={cam.zoomOut}
            aria-label="Zoom Out"
            title="Zoom Out"
          >
            -
          </button>
          <span className="px-1 min-w-[38px] text-center text-[11px] select-none text-muted-foreground">
            {Math.round(cam.zoom * 100)}%
          </span>
          <button
            type="button"
            className="px-1.5 py-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
            onClick={cam.zoomIn}
            aria-label="Zoom In"
            title="Zoom In"
          >
            +
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 shadow-xs"
          onClick={() => cam.reset()}
          aria-label="Fit Breadboard Trainer to Screen"
          title="Fit Breadboard Trainer to Screen"
        >
          <Maximize2 className="size-3.5" />
          <span>Fit</span>
        </Button>
      </div>

      <svg
        ref={svgRef}
        data-native-cursor=""
        viewBox={cam.viewBox}
        preserveAspectRatio="xMidYMid meet"
        className={cn(
          "bg-card h-full w-full touch-none rounded-md border",
          pendingStart ? "cursor-crosshair" : "cursor-default",
        )}
        onWheel={cam.onWheel}
        onPointerDown={(e) => {
          dragStartRef.current = { x: e.clientX, y: e.clientY };
          cam.handlePointerDown(e);
          cam.startPan(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (cam.handlePointerMove(e)) return;
          if (cam.movePan(e.clientX, e.clientY)) return;
          const p = cam.toView(e.clientX, e.clientY);
          setCursorPos(p);

          // Check Trainer Panel sockets first (magnetic snap radius 16px)
          const nearSocket = trainerSocketsList.find(
            (s) => Math.hypot(p.x - s.point.x, p.y - s.point.y) <= 16,
          );
          if (nearSocket) {
            setHoverSocket(nearSocket);
            setHover(null);
            return;
          }
          setHoverSocket(null);

          // Check Breadboard holes (magnetic snap radius 14px)
          const bh = holeAt(spec, p.x - BOARD_OFFSET_X, p.y - BOARD_OFFSET_Y);
          if (bh) {
            const hp = holePoint(bh);
            const dist = Math.hypot(p.x - (BOARD_OFFSET_X + hp.x), p.y - (BOARD_OFFSET_Y + hp.y));
            if (dist <= 14) {
              setHover(bh);
              return;
            }
          }
          setHover(null);
        }}
        onPointerUp={(e) => {
          cam.handlePointerUp(e);
          cam.endPan();
        }}
        onPointerLeave={() => {
          cam.endPan();
          setHover(null);
          setHoverSocket(null);
          setCursorPos(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          if (
            dragStartRef.current &&
            Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y) > 4
          ) {
            return;
          }
          if (hoverSocket) {
            if (hoverSocket.label === "CLK" && !clockNode) {
              const id = addNode({ kind: "clock", label: "CLK", state: 0, pos: { x: 0, y: 0 } });
              if (id) clickPin({ node: id, pin: "Y" });
            } else if (hoverSocket.label === "+5V" && !vccNode) {
              const id = addNode({ kind: "rail", rail: "vcc", label: "+5V", pos: { x: 0, y: 0 } });
              if (id) clickPin({ node: id, pin: "VCC" });
            } else if (hoverSocket.label === "GND" && !gndNode) {
              const id = addNode({ kind: "rail", rail: "gnd", label: "GND", pos: { x: 0, y: 0 } });
              if (id) clickPin({ node: id, pin: "GND" });
            } else {
              clickPin(hoverSocket.pin);
            }
          } else if (hover) {
            clickHole(hover);
          } else {
            setSelectedWireId(null);
            select([]);
            cancelWire();
          }
        }}
      >
        <defs>
          <pattern
            id="holes"
            width={PITCH}
            height={PITCH}
            patternUnits="userSpaceOnUse"
            x={BOARD_PAD}
            y={BOARD_PAD}
          >
            <rect
              x={PITCH / 2 - 3.5}
              y={PITCH / 2 - 3.5}
              width={7}
              height={7}
              rx={1.5}
              className="dark:fill-slate-950 fill-white dark:stroke-zinc-600 stroke-slate-400"
              strokeWidth={0.85}
            />
          </pattern>
        </defs>

        {/* =============================================================== */}
        {/* LAYER 1: Base Chassis & Breadboard Body                          */}
        {/* =============================================================== */}
        <g id="layer-chassis-and-board">
          {/* Digital Logic Trainer Board Chassis Base */}
          <rect
            width={CHASSIS_W}
            height={CHASSIS_H}
            rx={12}
            fill="#020617"
            stroke="#1e293b"
            strokeWidth={2}
          />

          {/* Chassis Metallic Hex Corner Screws */}
          {[
            { x: 16, y: 16 },
            { x: CHASSIS_W - 16, y: 16 },
            { x: 16, y: CHASSIS_H - 16 },
            { x: CHASSIS_W - 16, y: CHASSIS_H - 16 },
          ].map((pos, idx) => (
            <g key={idx} className="pointer-events-none">
              <circle cx={pos.x} cy={pos.y} r={6.5} fill="#334155" stroke="#1e293b" strokeWidth={1} />
              <circle cx={pos.x} cy={pos.y} r={4.5} fill="#475569" />
              <line x1={pos.x - 3} y1={pos.y - 3} x2={pos.x + 3} y2={pos.y + 3} stroke="#0f172a" strokeWidth={1} />
            </g>
          ))}

          {/* Chassis Brand Silk-Screen Title (Silver on Dark Chassis) */}
          <g className="pointer-events-none select-none">
            <text
              x={24}
              y={34}
              fill="#f8fafc"
              className="font-mono text-[13px] font-bold tracking-wider"
            >
              DIGITAL LOGIC TRAINER
            </text>
            <text
              x={24}
              y={50}
              fill="#cbd5e1"
              className="font-mono text-[9px] tracking-wide"
            >
              MODEL 74XX-TTL · 5V BENCH
            </text>
          </g>

          {/* Top-Left: DC Power Supply Module */}
          <g>
            <rect
              x={375}
              y={14}
              width={205}
              height={82}
              rx={6}
              fill="#090d16"
              stroke="#1e293b"
              strokeWidth={1}
            />
            {/* Header row */}
            <text
              x={387}
              y={29}
              fill="#f8fafc"
              className="font-mono text-[9px] font-bold pointer-events-none select-none"
            >
              DC POWER SUPPLY
            </text>
            {/* Status Power LED & ON Label in header */}
            <circle cx={528} cy={26} r={3.5} fill="#10b981" />
            <circle cx={528} cy={26} r={6} fill="#10b981" opacity={0.25} />
            <text
              x={537}
              y={29}
              fill="#34d399"
              className="font-mono text-[8px] font-bold pointer-events-none select-none"
            >
              +5V ON
            </text>
            <line
              x1={375}
              y1={36}
              x2={580}
              y2={36}
              stroke="#1e293b"
              strokeWidth={0.75}
            />
            {/* +5.0V VCC Red Socket */}
            <TrainerSocket
              cx={430}
              cy={60}
              label="+5.0V"
              sublabel="VCC"
              color="#ef4444"
              isArmed={pendingPin !== null && pendingPin.node === vccNode?.id && pendingPin.pin === "VCC"}
              onClick={handleVccClick}
            />
            {/* 0.0V GND Blue Socket */}
            <TrainerSocket
              cx={520}
              cy={60}
              label="0.0V"
              sublabel="GND"
              color="#3b82f6"
              isArmed={pendingPin !== null && pendingPin.node === gndNode?.id && pendingPin.pin === "GND"}
              onClick={handleGndClick}
            />
          </g>

          {/* Top-Center: Pulse / Clock Generator Module */}
          <g>
            <rect
              x={595}
              y={14}
              width={295}
              height={82}
              rx={6}
              fill="#090d16"
              stroke="#1e293b"
              strokeWidth={1}
            />
            <text
              x={605}
              y={28}
              fill="#f8fafc"
              className="font-mono text-[8.5px] font-bold pointer-events-none select-none"
            >
              PULSE / CLK GENERATOR
            </text>
            {/* Manual Single-Pulse Button */}
            <g
              id="trainer-pulse-btn"
              data-testid="trainer-pulse-btn"
              className="cursor-pointer group"
              onClick={handlePulse}
              transform="translate(605, 42)"
            >
              <rect
                width={44}
                height={26}
                rx={4}
                className="fill-primary/90 hover:fill-primary stroke-border"
                strokeWidth={1}
              />
              <text
                x={22}
                y={16.5}
                textAnchor="middle"
                fill="#ffffff"
                className="font-mono text-[9px] font-bold pointer-events-none select-none"
              >
                PULSE
              </text>
            </g>

            {/* Manual Clear Button */}
            <g
              id="trainer-clear-btn"
              data-testid="trainer-clear-btn"
              className="cursor-pointer group"
              onClick={handleClear}
              transform="translate(653, 42)"
            >
              <rect
                width={30}
                height={26}
                rx={4}
                className="fill-slate-800 hover:fill-slate-700 stroke-border"
                strokeWidth={1}
              />
              <text
                x={15}
                y={16.5}
                textAnchor="middle"
                fill="#cbd5e1"
                className="font-mono text-[8.5px] font-bold pointer-events-none select-none"
              >
                CLR
              </text>
            </g>

            {/* Auto frequency buttons (1Hz, 2Hz, 5Hz) */}
            {[1, 2, 5].map((hzVal, i) => (
              <g
                key={hzVal}
                id={`trainer-clk-${hzVal}hz`}
                data-testid={`trainer-clk-${hzVal}hz`}
                className="cursor-pointer group"
                onClick={() => {
                  setAutoHz((curr) => {
                    if (curr === hzVal) return null;
                    const state = useCircuitStore.getState();
                    if (!Object.values(state.doc.nodes).some((n) => n.kind === "clock")) {
                      state.addNode({ kind: "clock", label: "CLK", state: 0, pos: { x: 0, y: 0 } });
                    }
                    return hzVal;
                  });
                }}
                transform={`translate(${687 + i * 32}, 42)`}
              >
                <rect
                  width={28}
                  height={26}
                  rx={4}
                  className={autoHz === hzVal ? "fill-primary" : "fill-slate-800 hover:fill-slate-700"}
                />
                <text
                  x={14}
                  y={16.5}
                  textAnchor="middle"
                  fill={autoHz === hzVal ? "#ffffff" : "#cbd5e1"}
                  className="font-mono text-[9px] font-bold pointer-events-none select-none"
                >
                  {hzVal}Hz
                </text>
              </g>
            ))}

            {/* Clock LED indicator */}
            <g
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                const clk = clockNode;
                if (!clk) {
                  const id = addNode({ kind: "clock", label: "CLK", state: 0, pos: { x: 0, y: 0 } });
                  if (id) {
                    toggleClock(id);
                    return;
                  }
                } else {
                  toggleClock(clk.id);
                }
              }}
            >
              {clockNode?.state === 1 && (
                <circle
                  cx={788}
                  cy={55}
                  r={9}
                  fill="#f59e0b"
                  opacity={0.35}
                  className="pointer-events-none"
                />
              )}
              <circle
                cx={788}
                cy={55}
                r={5.5}
                fill={clockNode?.state === 1 ? "#f59e0b" : "#475569"}
              />
              <text
                x={788}
                y={70}
                textAnchor="middle"
                fill={clockNode?.state === 1 ? "#f59e0b" : "#94a3b8"}
                className="font-mono text-[7.5px] font-semibold pointer-events-none select-none"
              >
                {clockNode?.state === 1 ? "HIGH" : "LOW"}
              </text>
            </g>

            {/* CLK Socket */}
            <TrainerSocket
              cx={850}
              cy={55}
              label="CLK"
              sublabel="OUT"
              color="#f59e0b"
              isArmed={pendingPin !== null && pendingPin.node === clockNode?.id && pendingPin.pin === "Y"}
              onClick={handleClockClick}
            />
          </g>

          {/* Top-Right: Logic Indicators (Output Monitor LEDs) */}
          <g>
            <rect
              x={905}
              y={8}
              width={CHASSIS_W - 925}
              height={88}
              rx={6}
              fill="#090d16"
              stroke="#1e293b"
              strokeWidth={1}
            />
            {/* Header row */}
            <text
              x={918}
              y={21}
              fill="#94a3b8"
              className="font-mono text-[8px] font-bold tracking-wider pointer-events-none select-none uppercase"
            >
              LOGIC INDICATORS (OUTPUT MONITOR)
            </text>
            {/* Dedicated + LED Button in Top-Right Header */}
            <g
              className="cursor-pointer group"
              onClick={handleAddLed}
              transform={`translate(${CHASSIS_W - 82}, 12)`}
            >
              <rect
                width={54}
                height={17}
                rx={4}
                className="fill-slate-800 hover:fill-slate-700 stroke-slate-700 transition-colors"
                strokeWidth={1}
              />
              <text
                x={27}
                y={11.5}
                textAnchor="middle"
                fill="#f8fafc"
                className="font-mono text-[8px] font-semibold pointer-events-none select-none"
              >
                + LED
              </text>
            </g>
            <line
              x1={905}
              y1={25}
              x2={CHASSIS_W - 20}
              y2={25}
              stroke="#1e293b"
              strokeWidth={0.75}
            />
            {ledNodes.map((led, i) => (
              <TrainerLed
                key={led.id}
                led={led}
                cx={945 + i * 66}
                cy={52}
                isArmed={pendingPin !== null && pendingPin.node === led.id && pendingPin.pin === "A"}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  clickPin({ node: led.id, pin: "A" });
                }}
                onColorChange={(color) => setLedColor(led.id, color)}
              />
            ))}
          </g>

          {/* Center: Solderless Breadboard Base & Body */}
          <g transform={`translate(${BOARD_OFFSET_X}, ${BOARD_OFFSET_Y})`}>
            <rect width={w} height={h} rx={6} className="dark:fill-zinc-900 fill-slate-100 dark:stroke-zinc-700 stroke-slate-300" strokeWidth={1} />
            <rect width={w} height={h} fill="transparent" />
            <BoardBody spec={spec} />
          </g>

          {/* Bottom: Logic Input Switches (Data Switches) */}
          <g>
            <rect
              x={60}
              y={595}
              width={w}
              height={88}
              rx={6}
              fill="#090d16"
              stroke="#1e293b"
              strokeWidth={1}
            />
            {/* Header row */}
            <text
              x={78}
              y={611}
              fill="#f8fafc"
              className="font-mono text-[9px] font-bold pointer-events-none select-none"
            >
              LOGIC INPUT SWITCHES (DATA LEVEL)
            </text>
            {/* Dedicated + Input Button in Header */}
            <g
              className="cursor-pointer group"
              onClick={handleAddSwitch}
              transform={`translate(${w - 2}, 601)`}
            >
              <rect
                width={56}
                height={19}
                rx={3.5}
                className="fill-slate-800 hover:fill-slate-700 stroke-slate-700 transition-colors"
                strokeWidth={1}
              />
              <text
                x={28}
                y={12.5}
                textAnchor="middle"
                fill="#f8fafc"
                className="font-mono text-[8.5px] font-semibold pointer-events-none select-none"
              >
                + Input
              </text>
            </g>
            <line
              x1={65}
              y1={618}
              x2={65 + w}
              y2={618}
              stroke="#1e293b"
              strokeWidth={0.75}
            />
            {switchNodes.map((sw, i) => (
              <TrainerSwitch
                key={sw.id}
                sw={sw}
                cx={105 + i * 82}
                cy={642}
                isArmed={pendingPin !== null && pendingPin.node === sw.id && pendingPin.pin === "Y"}
                onToggle={() => toggleSwitch(sw.id)}
                onSocketClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  clickPin({ node: sw.id, pin: "Y" });
                }}
              />
            ))}
          </g>
        </g>

        {/* =============================================================== */}
        {/* LAYER 2: Strip Continuity Highlights & Wiring Guides             */}
        {/* =============================================================== */}
        <g id="layer-strip-highlights" transform={`translate(${BOARD_OFFSET_X}, ${BOARD_OFFSET_Y})`}>
          {hover && <StripHighlight spec={spec} hole={hover} doc={doc} />}
          {showAirwires && <AirwiresGuide doc={doc} spec={spec} />}
          {pendingHole && (
            <circle
              cx={holePoint(pendingHole).x}
              cy={holePoint(pendingHole).y}
              r={6}
              fill="none"
              className="stroke-ring"
              strokeWidth={2}
            />
          )}
        </g>

        {/* =============================================================== */}
        {/* LAYER 3: IC Chip Bodies & Orientation Notch/Dot                 */}
        {/* =============================================================== */}
        <g id="layer-ic-bodies" transform={`translate(${BOARD_OFFSET_X}, ${BOARD_OFFSET_Y})`}>
          {icNodes.map((node) => (
            <SeatedIc
              key={node.id}
              node={node}
              spec={spec}
              otherIcs={icNodes}
              isSelected={selection.includes(node.id)}
              showXRay={showXRay}
              renderPart="body"
              onSelect={() => select([node.id])}
              onDelete={() => deleteSelected()}
              onAutoPower={(nodeId) => autoWireIcPower(nodeId)}
              onMove={(newCol: number) => moveNode(node.id, { x: newCol, y: 0 })}
              camZoom={cam.zoom}
            />
          ))}
        </g>

        {/* =============================================================== */}
        {/* LAYER 4: Jumper Wires & Pending Rubberband Wire                 */}
        {/* =============================================================== */}
        <g id="layer-wires">
          {Object.values(doc.wires).map((wire) => (
            <Jumper
              key={wire.id}
              wire={wire}
              routedWire={routedWireMap.get(wire.id)}
              isSelected={selectedWireId === wire.id}
              toView={cam.toView}
              onSelect={() => {
                select([]);
                setSelectedWireId((curr) => (curr === wire.id ? null : wire.id));
              }}
              onDelete={() => {
                deleteWire(wire.id);
                setSelectedWireId(null);
                toast.info("Deleted jumper wire");
              }}
              onColorChange={(color) => {
                setWireColor(wire.id, color);
                toast.success("Wire color updated");
              }}
              onChannelDrag={(newY) => {
                setWireCustomY((prev) => ({ ...prev, [wire.id]: newY }));
              }}
            />
          ))}

          {/* Pending Wire Rubberband */}
          {pendingStart && pendingTarget && (
            <g className="pointer-events-none">
              <line
                x1={pendingStart.x}
                y1={pendingStart.y}
                x2={pendingTarget.x}
                y2={pendingTarget.y}
                className="stroke-primary"
                strokeWidth={2.5}
                strokeDasharray="4 4"
                strokeLinecap="round"
              />
              <circle
                cx={pendingTarget.x}
                cy={pendingTarget.y}
                r={3.5}
                fill="var(--color-primary, #38bdf8)"
                opacity={0.8}
              />
            </g>
          )}
        </g>

        {/* =============================================================== */}
        {/* LAYER 5: IC Labels, Part Badges, & Action Pills (Above Wires)   */}
        {/* =============================================================== */}
        <g id="layer-ic-labels-and-xray" transform={`translate(${BOARD_OFFSET_X}, ${BOARD_OFFSET_Y})`}>
          {icNodes.map((node) => (
            <SeatedIc
              key={node.id}
              node={node}
              spec={spec}
              otherIcs={icNodes}
              isSelected={selection.includes(node.id)}
              showXRay={showXRay}
              renderPart="overlay"
              onSelect={() => select([node.id])}
              onDelete={() => deleteSelected()}
              onAutoPower={(nodeId) => autoWireIcPower(nodeId)}
              onMove={(newCol: number) => moveNode(node.id, { x: newCol, y: 0 })}
              camZoom={cam.zoom}
            />
          ))}
        </g>

        {/* =============================================================== */}
        {/* LAYER 6: Interactive Reticles & Snap Rings                      */}
        {/* =============================================================== */}
        <g id="layer-interactive-handles" className="pointer-events-none">
          {hover && (
            <circle
              cx={BOARD_OFFSET_X + holePoint(hover).x}
              cy={BOARD_OFFSET_Y + holePoint(hover).y}
              r={6.5}
              fill="none"
              stroke={logicColor(hoverValue)}
              strokeWidth={1.75}
            />
          )}
          {hoverSocket && (
            <circle
              cx={hoverSocket.point.x}
              cy={hoverSocket.point.y}
              r={12}
              fill="none"
              stroke={hoverSocket.color}
              strokeWidth={2}
              strokeDasharray="3 2"
            />
          )}
        </g>

        {/* =============================================================== */}
        {/* LAYER 7: Topmost Floating Logic Probe & Socket Tooltip Cards    */}
        {/* =============================================================== */}
        <g id="layer-topmost-tooltips">
          {hover && (
            <ProbeTooltipCard
              spec={spec}
              hole={hover}
              doc={doc}
              boardOffsetX={BOARD_OFFSET_X}
              boardOffsetY={BOARD_OFFSET_Y}
            />
          )}
          {hoverSocket && (
            <SocketTooltipCard
              socket={hoverSocket}
              doc={doc}
              chassisWidth={CHASSIS_W}
            />
          )}
        </g>
      </svg>

      {/* Docked Selected Wire Action HUD (Off-board, non-obscuring) */}
      {selectedWire && (
        <div className="no-print absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg border border-border bg-card/95 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className="text-muted-foreground font-medium">Wire:</span>
            <span className="font-semibold text-foreground">{selectedWire.id}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Color:</span>
            {COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                onClick={() => {
                  setWireColor(selectedWire.id, swatch.value);
                  toast.success(`Wire color set to ${swatch.label}`);
                }}
                style={{ backgroundColor: swatch.value }}
                className={cn(
                  "size-4 rounded-full border border-background/50 transition-transform duration-150 hover:scale-125 cursor-pointer",
                  (selectedWire.color || "#38bdf8") === swatch.value &&
                    "ring-2 ring-primary ring-offset-1 ring-offset-background scale-110",
                )}
                title={swatch.label}
              />
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="destructive"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              deleteWire(selectedWire.id);
              setSelectedWireId(null);
              toast.info("Deleted jumper wire");
            }}
          >
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => setSelectedWireId(null)}
            title="Deselect (Esc)"
          >
            ✕
          </Button>
        </div>
      )}

      {/* Bottom Camera Toolbar */}
      <div className="no-print absolute right-2 bottom-2 z-10 flex items-center gap-1">
        <span className="text-muted-foreground bg-card/80 rounded px-1.5 py-0.5 font-mono text-[10px]">
          {Math.round(cam.zoom * 100)}%
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={cam.reset}
          title="Fit to circuit"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      </div>

      {/* Empty State Banner */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <Card className="pointer-events-auto w-full max-w-md border-dashed shadow-xl backdrop-blur-xs bg-card/95">
            <CardHeader className="text-center pb-3">
              <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CircuitBoard className="size-5" />
              </div>
              <CardTitle className="text-base font-semibold">Breadboard is Empty</CardTitle>
              <CardDescription className="text-xs">
                No components or IC chips are seated on this board yet. Get started in one click:
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-1">
              <Button
                variant="default"
                size="sm"
                onClick={handleSynthesizeTheory}
                className="justify-start gap-2 h-9"
              >
                <Cpu className="size-4 shrink-0 text-amber-300" />
                <span className="truncate">
                  Synthesize from Theory: <span className="font-mono text-xs opacity-90">{theorySource}</span>
                </span>
              </Button>
              <Button
                id="btn-load-starter"
                variant="outline"
                size="sm"
                onClick={handleLoadStarterPreset}
                className="justify-start gap-2 h-9"
              >
                <Cpu className="size-4 shrink-0" />
                <span>Load Starter 74xx Preset ({PRESETS[0]?.name ?? "Half Adder"})</span>
              </Button>
              <Button
                id="btn-init-trainer"
                variant="outline"
                size="sm"
                onClick={handleInitTrainerDefaults}
                className="justify-start gap-2 h-9 text-primary border-primary/30 hover:bg-primary/10"
              >
                <Plus className="size-4 shrink-0" />
                <span>Initialize Trainer Bench (4 Switches, 4 LEDs, Power)</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSwitchToSchematic}
                className="justify-start gap-2 h-9 text-muted-foreground hover:text-foreground"
              >
                <Layers className="size-4 shrink-0" />
                <span>Switch to Schematic View</span>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trainer Chassis Sockets, LEDs, and Switches
// ---------------------------------------------------------------------------

interface TrainerSocketProps {
  cx: number;
  cy: number;
  label?: string | undefined;
  sublabel?: string | undefined;
  color: string;
  isArmed?: boolean | undefined;
  onClick: (e: React.MouseEvent) => void;
}

function TrainerSocket({
  cx,
  cy,
  label,
  sublabel,
  color,
  isArmed,
  onClick,
}: TrainerSocketProps) {
  return (
    <g
      className="cursor-pointer group"
      onClick={onClick}
      transform={`translate(${cx}, ${cy})`}
    >
      {/* Armed wiring pulsating ring */}
      {isArmed && (
        <circle
          cx={0}
          cy={0}
          r={14}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="4 3"
          className="animate-spin [transform-box:fill-box] origin-center"
          opacity={0.85}
        />
      )}

      {/* Outer metallic threaded ring */}
      <circle cx={0} cy={0} r={11} fill="#1e293b" stroke="#334155" strokeWidth={1} />

      {/* Colored insulated bezel / bushing */}
      <circle cx={0} cy={0} r={8.5} fill={color} opacity={0.9} />
      <circle cx={0} cy={0} r={8.5} fill="none" stroke="#ffffff" strokeWidth={0.5} opacity={0.3} />

      {/* Inner metal socket contact & hole */}
      <circle cx={0} cy={0} r={5} fill="#0f172a" />
      <circle cx={0} cy={0} r={3.2} fill="#020617" />
      <circle cx={0} cy={0} r={1.5} fill="#38bdf8" opacity={0.3} />

      {/* Label above or below if provided */}
      {label && (
        <text
          x={0}
          y={-14}
          textAnchor="middle"
          className="fill-foreground font-mono text-[9px] font-bold pointer-events-none select-none"
        >
          {label}
        </text>
      )}
      {sublabel && (
        <text
          x={0}
          y={20}
          textAnchor="middle"
          className="fill-muted-foreground font-mono text-[8.5px] font-semibold pointer-events-none select-none"
        >
          {sublabel}
        </text>
      )}
    </g>
  );
}

const LED_COLORS: { name: string; value: string }[] = [
  { name: "Green", value: "#22c55e" },
  { name: "Red", value: "#ef4444" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Purple", value: "#a855f7" },
  { name: "White", value: "#f8fafc" },
];

interface TrainerLedProps {
  led: Extract<CircuitNode, { kind: "led" }>;
  cx: number;
  cy: number;
  isArmed?: boolean | undefined;
  onClick: (e: React.MouseEvent) => void;
  onColorChange: (color: string) => void;
}

function TrainerLed({
  led,
  cx,
  cy,
  isArmed,
  onClick,
  onColorChange,
}: TrainerLedProps) {
  const value = useEndpointValue(pinEnd({ node: led.id, pin: "A" }));
  const lit = value === 1;
  const isFault = value === 3;
  const chosenColor = led.color ?? "#22c55e";

  const cycleColor = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currIdx = LED_COLORS.findIndex((c) => c.value === chosenColor);
    const next = LED_COLORS[(currIdx + 1) % LED_COLORS.length]!;
    onColorChange(next.value);
    toast.success(`LED ${led.label} set to ${next.name}`);
  };

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Label and interactive color dot */}
      <text
        x={-5}
        y={-14}
        textAnchor="middle"
        fill="#f8fafc"
        className="font-mono text-[9px] font-bold pointer-events-none select-none"
      >
        {led.label}
      </text>

      {/* Color switcher swatch dot */}
      <circle
        cx={12}
        cy={-17}
        r={3.5}
        fill={chosenColor}
        stroke="#ffffff"
        strokeWidth={0.75}
        className="cursor-pointer hover:scale-125 [transform-box:fill-box] origin-center transition-transform"
        onClick={cycleColor}
      >
        <title>Click to change LED color ({LED_COLORS.map(c => c.name).join(", ")})</title>
      </circle>

      {/* Radial glow if HIGH */}
      {lit && (
        <>
          <circle cx={0} cy={0} r={16} fill={chosenColor} opacity={0.3} />
          <circle cx={0} cy={0} r={11} fill={chosenColor} opacity={0.5} />
        </>
      )}

      {/* Bezel */}
      <circle cx={0} cy={0} r={9} fill="#0f172a" stroke="#334155" strokeWidth={1} />

      {/* Fault warning ring */}
      {isFault && (
        <circle cx={0} cy={0} r={10} fill="none" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 2" />
      )}

      {/* Jewel lens: ON = full vivid color, OFF = darkened translucent lens tinted in chosen color */}
      <circle
        cx={0}
        cy={0}
        r={7}
        fill={chosenColor}
        fillOpacity={lit ? 1 : 0.32}
        stroke={lit ? "#ffffff" : chosenColor}
        strokeWidth={lit ? 0.75 : 0.5}
      />
      {/* Center specular highlight */}
      <ellipse
        cx={-2}
        cy={-2}
        rx={2.2}
        ry={1.4}
        fill="#ffffff"
        opacity={lit ? 0.85 : 0.28}
      />

      {/* 4-state indicator badge */}
      <text
        x={0}
        y={14}
        textAnchor="middle"
        fill={lit ? chosenColor : isFault ? "#ef4444" : "#94a3b8"}
        className="font-mono text-[8.5px] font-bold pointer-events-none select-none"
      >
        {value === 1 ? "1" : value === 0 ? "0" : value === 2 ? "Z" : "X"}
      </text>

      {/* Input banana socket */}
      <g transform="translate(0, 24)">
        <TrainerSocket
          cx={0}
          cy={0}
          color={chosenColor}
          isArmed={isArmed}
          onClick={onClick}
        />
      </g>
    </g>
  );
}

interface TrainerSwitchProps {
  sw: Extract<CircuitNode, { kind: "switch" }>;
  cx: number;
  cy: number;
  isArmed?: boolean | undefined;
  onToggle: () => void;
  onSocketClick: (e: React.MouseEvent) => void;
}

function TrainerSwitch({
  sw,
  cx,
  cy,
  isArmed,
  onToggle,
  onSocketClick,
}: TrainerSwitchProps) {
  const on = sw.state === 1;

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Switch Label */}
      <text
        x={0}
        y={-14}
        textAnchor="middle"
        className="fill-foreground font-mono text-[10px] font-bold pointer-events-none select-none"
      >
        {sw.label}
      </text>

      {/* LEFT ZONE: Physical Toggle Switch (centered at x = -18) */}
      <g
        data-testid={`trainer-switch-toggle-${sw.label}`}
        className="cursor-pointer group"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {/* Invisible enlarged hit target for reliable clicking */}
        <rect
          x={-34}
          y={-18}
          width={32}
          height={44}
          fill="transparent"
        />
        {/* Toggle switch plate / slot */}
        <rect
          x={-28}
          y={-10}
          width={20}
          height={22}
          rx={3}
          className="fill-slate-800 stroke-slate-700 group-hover:stroke-slate-500 transition-colors"
          strokeWidth={1}
        />
        {/* Switch bat/lever */}
        <rect
          x={-25}
          y={on ? -8 : 2}
          width={14}
          height={9}
          rx={2}
          fill={on ? "#10b981" : "#475569"}
          stroke={on ? "#34d399" : "#64748b"}
          strokeWidth={0.5}
        />
        {/* Mini status LED */}
        <circle
          cx={-18}
          cy={-15}
          r={2.5}
          fill={on ? "#10b981" : "#334155"}
          stroke={on ? "#34d399" : "#1e293b"}
          strokeWidth={0.5}
        />
        {/* Logic state text badge (1 / 0) */}
        <text
          x={-18}
          y={20}
          textAnchor="middle"
          fill={on ? "#10b981" : "#94a3b8"}
          className="font-mono text-[8px] font-bold pointer-events-none select-none"
        >
          {on ? "1" : "0"}
        </text>
      </g>

      {/* RIGHT ZONE: Banana Wire Output Socket (centered at x = +18) */}
      <g transform="translate(18, 4)">
        <text
          x={0}
          y={-14}
          textAnchor="middle"
          fill="#94a3b8"
          className="font-mono text-[8px] font-bold pointer-events-none select-none"
        >
          OUT
        </text>
        <TrainerSocket
          cx={0}
          cy={0}
          color="#38bdf8"
          isArmed={isArmed}
          onClick={onSocketClick}
        />
      </g>
    </g>
  );
}

/** The static board: strip bands, the centre channel, the rail lines. */
function BoardBody({ spec }: { spec: BreadboardSpec }) {
  const w = boardWidth(spec);

  const yOf = (row: BoardRow): number => holePoint({ col: 1, row }).y;

  const upper = yOf("J") - PITCH / 2;
  const upperH = yOf("F") + PITCH / 2 - upper;
  const lower = yOf("E") - PITCH / 2;
  const lowerH = yOf("A") + PITCH / 2 - lower;

  const channelY = yOf("F") + PITCH / 2;
  const channelH = yOf("E") - PITCH / 2 - channelY;

  return (
    <g>
      <rect x={0} y={upper} width={w} height={upperH} fill="url(#holes)" />
      <rect x={0} y={lower} width={w} height={lowerH} fill="url(#holes)" />

      {/* The centre channel. */}
      <rect
        x={0}
        y={channelY}
        width={w}
        height={channelH}
        className="dark:fill-zinc-950/80 fill-slate-200/90 dark:stroke-zinc-800 stroke-slate-300"
        strokeWidth={0.75}
      />

      {/* Power rails: a hole field, plus the coloured stripe printed beside it. */}
      {RAIL_ROWS.map((row) => {
        const y = holePoint({ col: 1, row }).y;
        const positive = isPositiveRail(row);
        return (
          <g key={row}>
            <rect
              x={0}
              y={y - PITCH / 2}
              width={w}
              height={PITCH}
              fill="url(#holes)"
            />
            <line
              x1={4}
              y1={y}
              x2={w - 4}
              y2={y}
              style={{
                stroke: positive ? "var(--wire-1)" : "var(--wire-6)",
              }}
              strokeWidth={2}
              opacity={0.75}
            />
            <text
              x={6}
              y={y + 3.5}
              className="dark:fill-slate-100 fill-slate-900 pointer-events-none font-mono text-[11px] font-bold"
            >
              {positive ? "+" : "−"}
            </text>
            <text
              x={w - 14}
              y={y + 3.5}
              className="dark:fill-slate-100 fill-slate-900 pointer-events-none font-mono text-[11px] font-bold"
            >
              {positive ? "+" : "−"}
            </text>
          </g>
        );
      })}

      {/* Rail breaks */}
      {Array.from({ length: spec.railSegments - 1 }, (_, i) => {
        const perSegment = Math.ceil(spec.columns / spec.railSegments);
        const x = BOARD_PAD + (i + 1) * perSegment * PITCH;
        return (
          <g key={i}>
            {RAIL_ROWS.map((row) => {
              const y = holePoint({ col: 1, row }).y;
              return (
                <line
                  key={row}
                  x1={x - PITCH / 2}
                  y1={y - 5}
                  x2={x - PITCH / 2}
                  y2={y + 5}
                  className="stroke-muted-foreground"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        );
      })}

      {/* Row letters on both ends for effortless strip identification */}
      {ALL_ROWS.map((row) => {
        const y = holePoint({ col: 1, row }).y + 3.5;
        return (
          <g key={row} className="pointer-events-none select-none">
            <text
              x={8}
              y={y}
              className="dark:fill-slate-100 fill-slate-900 font-mono text-[9.5px] font-bold"
            >
              {row}
            </text>
            <text
              x={w - 14}
              y={y}
              className="dark:fill-slate-100 fill-slate-900 font-mono text-[9.5px] font-bold"
            >
              {row}
            </text>
          </g>
        );
      })}

      {/* Column numbers at top and bottom */}
      {Array.from({ length: spec.columns }, (_, i) => i + 1)
        .filter((c) => c % 5 === 0 || c === 1)
        .map((col) => {
          const ptTop = holePoint({ col, row: "J" });
          const ptBot = holePoint({ col, row: "A" });
          return (
            <g key={col} className="pointer-events-none select-none">
              <text
                x={ptTop.x}
                y={ptTop.y - PITCH / 2 - 3}
                textAnchor="middle"
                className="dark:fill-slate-100 fill-slate-900 font-mono text-[9px] font-bold"
              >
                {col}
              </text>
              <text
                x={ptBot.x}
                y={ptBot.y + PITCH / 2 + 10}
                textAnchor="middle"
                className="dark:fill-slate-100 fill-slate-900 font-mono text-[9px] font-bold"
              >
                {col}
              </text>
            </g>
          );
        })}
    </g>
  );
}

/** Detects if any IC pin or component is seated in the hovered strip. */
interface AttachedPin {
  readonly nodeLabel: string;
  readonly part: string;
  readonly pinNumber: number;
  readonly pinName: string;
  readonly isPower: boolean;
  readonly isGnd: boolean;
  readonly isNc: boolean;
}

function getAttachedPin(doc: CircuitDocument, spec: BreadboardSpec, hole: HoleRef): AttachedPin | null {
  const strip = stripOf(spec, hole);
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === "ic") {
      const def = getIc(node.part);
      if (!def) continue;
      const col = Math.round(node.pos.x);
      const span = def.pins.length / 2;
      // Pins 1..span in row E (lower strip L)
      if (strip.startsWith("col:") && strip.endsWith(":L")) {
        const c = hole.col;
        if (c >= col && c < col + span) {
          const pinIdx = c - col;
          const pinNumber = pinIdx + 1;
          const pinName = def.pinNames[pinIdx] ?? `${pinNumber}`;
          return {
            nodeLabel: node.label,
            part: node.part,
            pinNumber,
            pinName,
            isPower: pinName === "VCC",
            isGnd: pinName === "GND",
            isNc: pinName === "NC",
          };
        }
      }
      // Pins span+1..pinCount in row F (upper strip U)
      if (strip.startsWith("col:") && strip.endsWith(":U")) {
        const c = hole.col;
        if (c >= col && c < col + span) {
          const pinIdx = def.pins.length - 1 - (c - col);
          const pinNumber = pinIdx + 1;
          const pinName = def.pinNames[pinIdx] ?? `${pinNumber}`;
          return {
            nodeLabel: node.label,
            part: node.part,
            pinNumber,
            pinName,
            isPower: pinName === "VCC",
            isGnd: pinName === "GND",
            isNc: pinName === "NC",
          };
        }
      }
    } else if (node.boardRow && Math.round(node.pos.x) === hole.col) {
      const nodeStrip = stripOf(spec, { col: Math.round(node.pos.x), row: node.boardRow });
      if (nodeStrip === strip) {
        return {
          nodeLabel: node.label,
          part: node.kind.toUpperCase(),
          pinNumber: 1,
          pinName: node.label,
          isPower: node.kind === "rail" && node.rail === "vcc",
          isGnd: node.kind === "rail" && node.rail === "gnd",
          isNc: false,
        };
      }
    }
  }
  return null;
}

/** Renders the metallic tie-bar and continuity strip highlight halos on the breadboard. */
function StripHighlight({
  spec,
  hole,
}: {
  spec: BreadboardSpec;
  hole: HoleRef;
  doc?: CircuitDocument;
}) {
  const value = useEndpointValue(holeEnd(hole));
  const color = logicColor(value);

  const mates: HoleRef[] = [];
  let stripBox: { x: number; y: number; w: number; h: number } | null = null;

  if (isRail(hole.row)) {
    const perSegment = Math.ceil(spec.columns / spec.railSegments);
    const segment = Math.floor((hole.col - 1) / perSegment);
    const startCol = segment * perSegment + 1;
    const endCol = Math.min(spec.columns, (segment + 1) * perSegment);
    for (let c = startCol; c <= endCol; c++) {
      mates.push({ col: c, row: hole.row });
    }
    const pStart = holePoint({ col: startCol, row: hole.row });
    const pEnd = holePoint({ col: endCol, row: hole.row });
    stripBox = {
      x: pStart.x - PITCH / 2 + 2,
      y: pStart.y - PITCH / 2 + 2,
      w: pEnd.x - pStart.x + PITCH - 4,
      h: PITCH - 4,
    };
  } else {
    const isLower = (ROWS_LOWER as readonly string[]).includes(hole.row);
    const rows = isLower ? ROWS_LOWER : ROWS_UPPER;
    for (const r of rows) {
      mates.push({ col: hole.col, row: r });
    }
    const topRow = isLower ? "E" : "J";
    const bottomRow = isLower ? "A" : "F";
    const pTop = holePoint({ col: hole.col, row: topRow });
    const pBottom = holePoint({ col: hole.col, row: bottomRow });
    const minY = Math.min(pTop.y, pBottom.y);
    const maxY = Math.max(pTop.y, pBottom.y);
    stripBox = {
      x: pTop.x - PITCH / 2 + 2,
      y: minY - PITCH / 2 + 2,
      w: PITCH - 4,
      h: maxY - minY + PITCH - 4,
    };
  }

  return (
    <g className="pointer-events-none">
      {stripBox && (
        <rect
          x={stripBox.x}
          y={stripBox.y}
          width={stripBox.w}
          height={stripBox.h}
          rx={5}
          fill={color}
          opacity={0.16}
          stroke={color}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}

      {mates.map((m) => {
        const q = holePoint(m);
        return (
          <circle
            key={`${m.col}${m.row}`}
            cx={q.x}
            cy={q.y}
            r={5.5}
            fill={color}
            opacity={0.35}
          />
        );
      })}
    </g>
  );
}

/** Topmost floating 4-state logic probe badge card for inspected breadboard holes. */
function ProbeTooltipCard({
  spec,
  hole,
  doc,
  boardOffsetX,
  boardOffsetY,
}: {
  spec: BreadboardSpec;
  hole: HoleRef;
  doc: CircuitDocument;
  boardOffsetX: number;
  boardOffsetY: number;
}) {
  const value = useEndpointValue(holeEnd(hole));
  const p = holePoint(hole);
  const color = logicColor(value);
  const attached = useMemo(() => getAttachedPin(doc, spec, hole), [doc, spec, hole]);

  const badgeW = attached ? 210 : 165;
  const badgeH = attached ? 48 : 34;
  const boardW = boardWidth(spec);
  const badgeX = Math.min(boardW - badgeW - 12, Math.max(12, p.x - badgeW / 2)) + boardOffsetX;
  const badgeY = (p.y < 80 ? p.y + 22 : p.y - badgeH - 16) + boardOffsetY;

  const rowName = isRail(hole.row)
    ? isPositiveRail(hole.row)
      ? "+5V Rail"
      : "GND Rail"
    : `Row ${hole.row}`;

  return (
    <g transform={`translate(${badgeX}, ${badgeY})`} className="pointer-events-none select-none">
      <rect
        width={badgeW}
        height={badgeH}
        rx={6}
        fill="#090d16"
        stroke="#334155"
        strokeWidth={1}
        style={{ filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.65))" }}
      />
      <text
        x={10}
        y={14}
        fill="#f8fafc"
        className="font-mono text-[9px] font-semibold"
      >
        {isRail(hole.row) ? rowName : `Col ${hole.col} · ${rowName}`}
        <tspan fill="#94a3b8" className="font-normal"> ({hole.col}{hole.row})</tspan>
      </text>

      {attached && (
        <text
          x={10}
          y={28}
          fill="#f8fafc"
          className="font-mono text-[8.5px]"
        >
          <tspan fill={attached.isPower ? "#ef4444" : attached.isGnd ? "#3b82f6" : "#38bdf8"}>
            ⚡ {attached.nodeLabel}
          </tspan>
          <tspan fill="#94a3b8"> ({attached.part})</tspan>
          <tspan fill="#f1f5f9" className="font-semibold"> P{attached.pinNumber}:{attached.pinName}</tspan>
        </text>
      )}

      {/* 4-State Level Pill */}
      <g transform={`translate(${badgeW - 54}, ${attached ? 24 : 9})`}>
        <rect
          width={46}
          height={16}
          rx={4}
          fill={color}
          opacity={0.25}
          stroke={color}
          strokeWidth={0.75}
        />
        <circle cx={6} cy={8} r={2.5} fill={color} />
        <text
          x={13}
          y={11.5}
          fill={color}
          className="font-mono text-[8px] font-bold"
        >
          {value === 1 ? "1:HIGH" : value === 0 ? "0:LOW" : value === 2 ? "Z:HIZ" : "X:FLT"}
        </text>
      </g>
    </g>
  );
}

/** Topmost floating tooltip card for inspected Trainer Panel sockets. */
function SocketTooltipCard({
  socket,
  doc,
  chassisWidth = 1400,
}: {
  socket: { point: Point; pin: PinRef; label: string; color: string };
  doc: CircuitDocument;
  chassisWidth?: number | undefined;
}) {
  const value = useEndpointValue(pinEnd(socket.pin));
  const node = doc.nodes[socket.pin.node];
  const color = logicColor(value);

  const title =
    socket.pin.pin === "VCC"
      ? "DC POWER SUPPLY (+5V)"
      : socket.pin.pin === "GND"
        ? "DC POWER SUPPLY (0V GND)"
        : node?.kind === "clock" || socket.label === "CLK" || socket.pin.pin === "CLK"
          ? "PULSE / CLK GENERATOR (CLK)"
          : node?.kind === "switch"
            ? `LOGIC INPUT SWITCH (${node.label})`
            : node?.kind === "led"
              ? `LOGIC INDICATOR LED (${node.label})`
              : socket.pin.node;

  const cardW = 190;
  const cardH = 34;
  const cardX = Math.max(10, Math.min(chassisWidth - cardW - 10, socket.point.x - cardW / 2));
  const cardY = socket.point.y > 500 ? socket.point.y - cardH - 16 : socket.point.y + 16;

  return (
    <g transform={`translate(${cardX}, ${cardY})`} className="pointer-events-none select-none">
      <rect
        width={cardW}
        height={cardH}
        rx={6}
        fill="#090d16"
        stroke="#334155"
        strokeWidth={1}
        style={{ filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.65))" }}
      />
      <text x={8} y={14} fill="#f8fafc" className="font-mono text-[9px] font-bold">
        {title}
      </text>
      <text x={8} y={26} fill="#94a3b8" className="font-mono text-[8px]">
        Terminal Pin: {socket.pin.pin}
      </text>
      <g transform={`translate(${cardW - 48}, 9)`}>
        <rect width={40} height={16} rx={3} fill={color} opacity={0.25} stroke={color} strokeWidth={0.75} />
        <circle cx={6} cy={8} r={2.5} fill={color} />
        <text x={12} y={11.5} fill={color} className="font-mono text-[8px] font-bold">
          {value === 1 ? "1:HIGH" : value === 0 ? "0:LOW" : value === 2 ? "Z:HIZ" : "X:FLT"}
        </text>
      </g>
    </g>
  );
}



// ---------------------------------------------------------------------------
// Parts & 74xx DIP Components
// ---------------------------------------------------------------------------


/** Authentic DIP-14 with Pin-1 notch, pinout numbers/names, NC indicators, X-Ray mode, and ravine dragging. */
function SeatedIc({
  node,
  spec,
  otherIcs,
  isSelected,
  showXRay,
  renderPart,
  onSelect,
  onDelete,
  onAutoPower,
  onMove,
  camZoom,
}: {
  node: Extract<CircuitNode, { kind: "ic" }>;
  spec: BreadboardSpec;
  otherIcs: Extract<CircuitNode, { kind: "ic" }>[];
  isSelected: boolean;
  showXRay: boolean;
  renderPart?: "body" | "overlay" | undefined;
  onSelect: () => void;
  onDelete: () => void;
  onAutoPower: (nodeId: string) => void;
  onMove: (newCol: number) => void;
  camZoom: number;
}) {
  const [dragCol, setDragCol] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; initialCol: number; active: boolean }>({
    startX: 0,
    initialCol: Math.round(node.pos.x),
    active: false,
  });

  const def = getIc(node.part);
  const diagnostics = useCircuitStore((s) => s.diagnostics);
  const isUnpowered = diagnostics.some((d) => d.code === "UNPOWERED_IC" && d.node === node.id);

  if (!def) return null;

  const pinTotal = def.pins.length;
  const span = pinTotal / 2;
  const currentCol = dragCol ?? Math.round(node.pos.x);
  const holes = dipHoles({ col: currentCol }, pinTotal);
  const first = holes[0];
  const last = holes[span - 1];
  if (!first || !last) return null;

  const a = holePoint(first);
  const b = holePoint(last);
  const top = holePoint({ col: first.col, row: "F" }).y;
  const bottom = a.y;

  const bodyX = a.x - PITCH / 2 + 2;
  const bodyY = top - 3;
  const bodyW = b.x - a.x + PITCH - 4;
  const bodyH = bottom - top + 6;
  const midX = (a.x + b.x) / 2;
  const midY = (top + bottom) / 2;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      initialCol: Math.round(node.pos.x),
      active: true,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const deltaCols = Math.round((dx / camZoom) / PITCH);
    const desiredCol = Math.max(1, Math.min(spec.columns - span + 1, dragRef.current.initialCol + deltaCols));

    // Collision check: prevent overlapping other ICs seated in the center ravine
    const collides = otherIcs.some((other) => {
      if (other.id === node.id) return false;
      const otherDef = getIc(other.part);
      const otherSpan = otherDef ? otherDef.pins.length / 2 : 7;
      const otherCol = Math.round(other.pos.x);
      return desiredCol < otherCol + otherSpan && desiredCol + span > otherCol;
    });

    if (!collides) {
      setDragCol(desiredCol);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (dragCol !== null && dragCol !== Math.round(node.pos.x)) {
      onMove(dragCol);
      toast.success(`Moved ${node.label} to column ${dragCol}`);
    }
    setDragCol(null);
  };

  if (renderPart === "overlay") {
    return (
      <g>
        {/* Part & instance text label with opaque pill */}
        {(() => {
          const pillText = `${node.part} · ${node.label}`;
          const pillW = Math.max(82, pillText.length * 6.5 + 16);
          return (
            <g
              transform={`translate(${(a.x + b.x) / 2}, ${midY + (showXRay ? -22 : 4)})`}
              className="pointer-events-none"
            >
              <rect
                x={-pillW / 2}
                y={-10}
                width={pillW}
                height={20}
                rx={4}
                fill="#090d16"
                stroke="#334155"
                strokeWidth={0.75}
              />
              <text
                x={0}
                y={3.5}
                textAnchor="middle"
                fill="#f8fafc"
                className="font-mono text-[10px] font-bold select-none tracking-tight"
              >
                {pillText}
              </text>
            </g>
          );
        })()}

        {/* Floating Action Pill on Selected IC */}
        {isSelected && (
          <g
            transform={`translate(${midX - 55}, ${bodyY - 26})`}
            className="cursor-default pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <rect
              width={110}
              height={22}
              rx={4}
              className="fill-card/95 stroke-border"
              strokeWidth={1}
              style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))" }}
            />
            <g
              className="cursor-pointer group/pwr"
              onClick={() => {
                onAutoPower(node.id);
                toast.success(`Auto-powered ${node.label}`);
              }}
            >
              <rect
                x={3}
                y={3}
                width={48}
                height={16}
                rx={3}
                className="fill-amber-500/20 hover:fill-amber-500/35"
              />
              <text
                x={27}
                y={14.5}
                textAnchor="middle"
                className="fill-amber-500 font-mono text-[8.5px] font-bold pointer-events-none"
              >
                ⚡ +PWR
              </text>
            </g>
            <g
              className="cursor-pointer group/del"
              onClick={() => {
                onDelete();
                toast.info(`Deleted ${node.label}`);
              }}
            >
              <rect
                x={55}
                y={3}
                width={52}
                height={16}
                rx={3}
                className="fill-destructive/20 hover:fill-destructive/35"
              />
              <text
                x={81}
                y={14.5}
                textAnchor="middle"
                className="fill-destructive font-mono text-[8.5px] font-bold pointer-events-none"
              >
                DELETE
              </text>
            </g>
          </g>
        )}
      </g>
    );
  }

  return (
    <g>
      {/* Selection halo */}
      {isSelected && (
        <rect
          x={bodyX - 4}
          y={bodyY - 4}
          width={bodyW + 8}
          height={bodyH + 8}
          rx={7}
          fill="none"
          stroke="var(--color-primary, #38bdf8)"
          strokeWidth={2}
          strokeDasharray="4 2"
          opacity={0.8}
        />
      )}

      {/* IC Body */}
      <rect
        x={bodyX}
        y={bodyY}
        width={bodyW}
        height={bodyH}
        rx={4}
        className={cn(
          "cursor-grab active:cursor-grabbing",
          showXRay ? "fill-card/35 stroke-foreground/40" : "fill-foreground stroke-background",
        )}
        strokeWidth={showXRay ? 1 : 0.5}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Pin 1 semicircle notch on the left edge */}
      <path
        d={`M ${bodyX} ${midY - 7} A 7 7 0 0 1 ${bodyX} ${midY + 7}`}
        className={showXRay ? "fill-foreground/20 stroke-foreground/30" : "fill-background/40"}
      />

      {/* Pin 1 orientation dot (indented near Pin 1 bottom-left) */}
      <circle
        cx={a.x - 3}
        cy={bottom - 8}
        r={2.5}
        className={showXRay ? "fill-primary/60" : "fill-background/70"}
      />

      {/* Render labels here only if not separated into overlay layer */}
      {renderPart === undefined && (
        <>
          <text
            x={(a.x + b.x) / 2}
            y={midY + (showXRay ? -22 : 4)}
            textAnchor="middle"
            className={showXRay ? "fill-foreground font-mono text-[10px] font-bold pointer-events-none" : "fill-background font-mono text-[11px] font-semibold pointer-events-none"}
          >
            {node.part} · {node.label}
          </text>

          {isSelected && (
            <g
              transform={`translate(${midX - 55}, ${bodyY - 26})`}
              className="cursor-default pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <rect
                width={110}
                height={22}
                rx={4}
                className="fill-card/95 stroke-border"
                strokeWidth={1}
                style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))" }}
              />
              <g
                className="cursor-pointer group/pwr"
                onClick={() => {
                  onAutoPower(node.id);
                  toast.success(`Auto-powered ${node.label}`);
                }}
              >
                <rect
                  x={3}
                  y={3}
                  width={48}
                  height={16}
                  rx={3}
                  className="fill-amber-500/20 hover:fill-amber-500/35"
                />
                <text
                  x={27}
                  y={14.5}
                  textAnchor="middle"
                  className="fill-amber-500 font-mono text-[8.5px] font-bold pointer-events-none"
                >
                  ⚡ +PWR
                </text>
              </g>
              <g
                className="cursor-pointer group/del"
                onClick={() => {
                  onDelete();
                  toast.info(`Deleted ${node.label}`);
                }}
              >
                <rect
                  x={55}
                  y={3}
                  width={52}
                  height={16}
                  rx={3}
                  className="fill-destructive/20 hover:fill-destructive/35"
                />
                <text
                  x={81}
                  y={14.5}
                  textAnchor="middle"
                  className="fill-destructive font-mono text-[8.5px] font-bold pointer-events-none"
                >
                  DELETE
                </text>
              </g>
            </g>
          )}
        </>
      )}

      {/* X-Ray Internal Gate Schematics */}
      {showXRay && (
        <IcXRay
          def={def}
          holes={holes}
          top={top}
          bottom={bottom}
        />
      )}

      {/* Legs, Pin numbers, and functional names */}
      {holes.map((hole, i) => {
        const pinNum = i + 1;
        const pinSpec = def.pins[i];
        const isNc = pinSpec?.dir === "nc";
        const pinName = def.pinNames[i] ?? `${pinNum}`;
        const isUpper = pinNum > pinTotal / 2;
        const pt = holePoint(hole);

        return (
          <g key={i}>
            <IcLeg hole={hole} isNc={isNc} />
            <text
              x={pt.x}
              y={isUpper ? pt.y + 11.5 : pt.y - 7.5}
              textAnchor="middle"
              className={`font-mono text-[8px] font-bold pointer-events-none ${
                isNc
                  ? "fill-red-400 font-bold"
                  : pinName === "VCC"
                  ? "fill-red-400 font-bold"
                  : pinName === "GND"
                  ? "fill-blue-400 font-bold"
                  : showXRay
                  ? "fill-muted-foreground"
                  : "fill-background/90"
              }`}
            >
              {isNc ? "NC" : pinName}
            </text>
          </g>
        );
      })}

      {/* Unpowered IC Fault Badge & Quick Auto-Wire Button */}
      {isUnpowered && !isSelected && (
        <g
          className="cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onAutoPower(node.id);
            toast.success(`Auto-powered ${node.label} (${node.part})`);
          }}
        >
          <rect
            x={(a.x + b.x) / 2 - 58}
            y={midY - 9}
            width={116}
            height={18}
            rx={4}
            className="fill-red-600/95 stroke-red-400"
            strokeWidth={1}
            style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}
          />
          <text
            x={(a.x + b.x) / 2}
            y={midY + 3.5}
            textAnchor="middle"
            fill="#ffffff"
            className="font-mono text-[8.5px] font-bold"
          >
            ⚠️ UNPOWERED · AUTO-WIRE
          </text>
        </g>
      )}
    </g>
  );
}

/** Renders internal logic gates inside the semi-transparent DIP package in X-Ray view. */
function IcXRay({
  def,
  holes,
  top,
  bottom,
}: {
  def: IcDefinition;
  holes: HoleRef[];
  top: number;
  bottom: number;
}) {
  const pinPointMap = useMemo(() => {
    const map = new Map<number, { x: number; y: number }>();
    holes.forEach((h, i) => {
      map.set(i + 1, holePoint(h));
    });
    return map;
  }, [holes]);

  const pinNumberByName = useMemo(() => {
    const map = new Map<string, number>();
    def.pins.forEach((p, i) => {
      map.set(p.name, i + 1);
    });
    return map;
  }, [def.pins]);

  const midY = (top + bottom) / 2;

  return (
    <g className="pointer-events-none">
      {def.cells.map((cell) => {
        const outPinNum = pinNumberByName.get(cell.outputPin);
        if (!outPinNum) return null;
        const outPt = pinPointMap.get(outPinNum);
        if (!outPt) return null;

        const inPinNums = cell.inputPins
          .map((p) => pinNumberByName.get(p))
          .filter((n): n is number => typeof n === "number");
        if (inPinNums.length === 0) return null;

        const inPts = inPinNums
          .map((n) => pinPointMap.get(n))
          .filter((p): p is { x: number; y: number } => Boolean(p));
        if (inPts.length === 0) return null;

        const avgInX = inPts.reduce((s, p) => s + p.x, 0) / inPts.length;
        const gateX = (avgInX + outPt.x) / 2;

        const isLower = outPinNum <= def.pins.length / 2;
        const gateY = def.cells.length <= 2 ? midY : isLower ? midY + 11 : midY - 11;

        const facesRight = outPt.x >= avgInX;

        return (
          <XRayGate
            key={cell.slot}
            op={cell.op}
            slot={cell.slot}
            cx={gateX}
            cy={gateY}
            facesRight={facesRight}
            inPoints={inPts}
            outPoint={outPt}
            outputHole={holes[outPinNum - 1]!}
            inputHoles={inPinNums.map((n) => holes[n - 1]!)}
          />
        );
      })}

      {def.flops.map((flop) => {
        const qPinNum = pinNumberByName.get(flop.qPin);
        const clkPinNum = pinNumberByName.get(flop.clockPin);
        if (!qPinNum || !clkPinNum) return null;
        const qPt = pinPointMap.get(qPinNum);
        const clkPt = pinPointMap.get(clkPinNum);
        if (!qPt || !clkPt) return null;
        const qHole = holes[qPinNum - 1]!;
        const boxX = (qPt.x + clkPt.x) / 2 - 11;
        const boxY = midY - 8;
        return (
          <g key={`flop-${flop.slot}`}>
            <XRayLead from={clkPt} to={{ x: boxX + 11, y: boxY + 8 }} hole={holes[clkPinNum - 1]!} />
            <XRayLead from={qPt} to={{ x: boxX + 11, y: boxY + 8 }} hole={qHole} />
            <rect
              x={boxX}
              y={boxY}
              width={22}
              height={16}
              rx={2.5}
              fill="rgba(15, 23, 42, 0.88)"
              stroke="#38bdf8"
              strokeWidth={1}
            />
            <text
              x={boxX + 11}
              y={boxY + 10.5}
              textAnchor="middle"
              fill="#f8fafc"
              className="font-mono text-[7.5px] font-bold"
            >
              {flop.kind.toUpperCase()}
              {flop.slot}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XRayGate({
  op,
  slot,
  cx,
  cy,
  facesRight,
  inPoints,
  outPoint,
  outputHole,
  inputHoles,
}: {
  op: string;
  slot: number;
  cx: number;
  cy: number;
  facesRight: boolean;
  inPoints: { x: number; y: number }[];
  outPoint: { x: number; y: number };
  outputHole: HoleRef;
  inputHoles: HoleRef[];
}) {
  const outVal = useEndpointValue(holeEnd(outputHole));
  const outColor = logicColor(outVal);

  const gateW = 18;
  const dir = facesRight ? 1 : -1;
  const outTipX = cx + dir * (gateW / 2);
  const inBackX = cx - dir * (gateW / 2);

  return (
    <g>
      {/* Input leads */}
      {inPoints.map((pt, i) => {
        const hole = inputHoles[i];
        if (!hole) return null;
        return (
          <XRayLead
            key={i}
            from={pt}
            to={{ x: inBackX, y: cy + (i === 0 ? -3 : i === 1 ? 3 : 0) }}
            hole={hole}
          />
        );
      })}

      {/* Output lead */}
      <line
        x1={outTipX}
        y1={cy}
        x2={outPoint.x}
        y2={outPoint.y}
        stroke={outColor}
        strokeWidth={1.2}
        opacity={0.85}
      />

      {/* Gate Symbol Body */}
      <g transform={facesRight ? undefined : `translate(${cx * 2}, 0) scale(-1, 1)`}>
        <GateSymbol op={op} cx={cx} cy={cy} outColor={outColor} />
      </g>

      {/* Slot number */}
      <text
        x={cx}
        y={cy + 3}
        textAnchor="middle"
        className="fill-foreground/80 font-mono text-[8px] font-bold"
      >
        {slot}
      </text>
    </g>
  );
}

function XRayLead({
  from,
  to,
  hole,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  hole: HoleRef;
}) {
  const val = useEndpointValue(holeEnd(hole));
  const color = logicColor(val);
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={color}
      strokeWidth={1.2}
      opacity={0.8}
    />
  );
}

function GateSymbol({
  op,
  cx,
  cy,
  outColor,
}: {
  op: string;
  cx: number;
  cy: number;
  outColor: string;
}) {
  const isNand = op === "nand";
  const isNor = op === "nor";
  const isAnd = op === "and" || isNand;
  const isOr = op === "or" || isNor;
  const isXor = op === "xor";
  const isNot = op === "not";

  if (isAnd) {
    return (
      <g>
        <path
          d={`M ${cx - 8} ${cy - 6} H ${cx} A 6 6 0 0 1 ${cx} ${cy + 6} H ${cx - 8} Z`}
          fill="rgba(15, 23, 42, 0.75)"
          stroke={outColor}
          strokeWidth={1.2}
        />
        {isNand && (
          <circle cx={cx + 8} cy={cy} r={2} fill="none" stroke={outColor} strokeWidth={1} />
        )}
      </g>
    );
  }

  if (isOr || isNor) {
    return (
      <g>
        <path
          d={`M ${cx - 8} ${cy - 6} Q ${cx - 3} ${cy} ${cx - 8} ${cy + 6} Q ${cx + 2} ${cy + 5} ${cx + 7} ${cy} Q ${cx + 2} ${cy - 5} ${cx - 8} ${cy - 6} Z`}
          fill="rgba(15, 23, 42, 0.75)"
          stroke={outColor}
          strokeWidth={1.2}
        />
        {isNor && (
          <circle cx={cx + 9} cy={cy} r={2} fill="none" stroke={outColor} strokeWidth={1} />
        )}
      </g>
    );
  }

  if (isXor) {
    return (
      <g>
        <path
          d={`M ${cx - 11} ${cy - 6} Q ${cx - 6} ${cy} ${cx - 11} ${cy + 6}`}
          fill="none"
          stroke={outColor}
          strokeWidth={1.2}
        />
        <path
          d={`M ${cx - 8} ${cy - 6} Q ${cx - 3} ${cy} ${cx - 8} ${cy + 6} Q ${cx + 2} ${cy + 5} ${cx + 7} ${cy} Q ${cx + 2} ${cy - 5} ${cx - 8} ${cy - 6} Z`}
          fill="rgba(15, 23, 42, 0.75)"
          stroke={outColor}
          strokeWidth={1.2}
        />
      </g>
    );
  }

  if (isNot) {
    return (
      <g>
        <path
          d={`M ${cx - 6} ${cy - 5} L ${cx + 4} ${cy} L ${cx - 6} ${cy + 5} Z`}
          fill="rgba(15, 23, 42, 0.75)"
          stroke={outColor}
          strokeWidth={1.2}
        />
        <circle cx={cx + 6} cy={cy} r={2} fill="none" stroke={outColor} strokeWidth={1} />
      </g>
    );
  }

  return (
    <rect
      x={cx - 7}
      y={cy - 5}
      width={14}
      height={10}
      rx={2}
      fill="rgba(15, 23, 42, 0.75)"
      stroke={outColor}
      strokeWidth={1.2}
    />
  );
}

function IcLeg({ hole, isNc }: { hole: HoleRef; isNc?: boolean }) {
  const value = useEndpointValue(holeEnd(hole));
  const p = holePoint(hole);
  if (isNc) {
    return (
      <g className="pointer-events-none">
        <circle cx={p.x} cy={p.y} r={3} fill="#ef4444" opacity={0.4} />
        <line x1={p.x - 2.5} y1={p.y - 2.5} x2={p.x + 2.5} y2={p.y + 2.5} stroke="#ef4444" strokeWidth={1} />
        <line x1={p.x - 2.5} y1={p.y + 2.5} x2={p.x + 2.5} y2={p.y - 2.5} stroke="#ef4444" strokeWidth={1} />
      </g>
    );
  }
  return (
    <circle cx={p.x} cy={p.y} r={3} style={{ fill: logicColor(value) }} />
  );
}

// ---------------------------------------------------------------------------
// Jumper Wires & Manhattan Orthogonal Routing
// ---------------------------------------------------------------------------

function resolveEndpointPoint(
  end: Endpoint,
  trainerPinMap: Map<string, Point>,
  nodes: Record<string, CircuitNode>,
): Point | null {
  if (end.kind === "pin") {
    const key = pinKey(end.ref);
    return trainerPinMap.get(key) ?? trainerPinMap.get(`${end.ref.node}:${end.ref.pin}`) ?? null;
  }
  if (end.kind === "hole") {
    // If a circuit was seated with proxy switches/leds/rails, redirect to the trainer panel socket
    for (const node of Object.values(nodes)) {
      if (node.boardRow && Math.round(node.pos.x) === end.ref.col) {
        const isLower = ["A", "B", "C", "D", "E"].includes(end.ref.row);
        const nodeLower = ["A", "B", "C", "D", "E"].includes(node.boardRow);
        const isUpper = ["F", "G", "H", "I", "J"].includes(end.ref.row);
        const nodeUpper = ["F", "G", "H", "I", "J"].includes(node.boardRow);

        if ((isLower && nodeLower) || (isUpper && nodeUpper) || end.ref.row === node.boardRow) {
          if (node.kind === "switch") {
            const pt = trainerPinMap.get(pinKey({ node: node.id, pin: "Y" })) ?? trainerPinMap.get(`${node.id}:Y`);
            if (pt) return pt;
          } else if (node.kind === "clock") {
            const pt = trainerPinMap.get(pinKey({ node: node.id, pin: "Y" })) ?? trainerPinMap.get(`${node.id}:Y`);
            if (pt) return pt;
          } else if (node.kind === "led") {
            const pt = trainerPinMap.get(pinKey({ node: node.id, pin: "A" })) ?? trainerPinMap.get(`${node.id}:A`);
            if (pt) return pt;
          } else if (node.kind === "rail") {
            const pName = node.rail === "vcc" ? "VCC" : "GND";
            const pt = trainerPinMap.get(pinKey({ node: node.id, pin: pName })) ?? trainerPinMap.get(`${node.id}:${pName}`);
            if (pt) return pt;
          }
        }
      }
    }
    const hp = holePoint(end.ref);
    return {
      x: BOARD_OFFSET_X + hp.x,
      y: BOARD_OFFSET_Y + hp.y,
    };
  }
  return null;
}

/** Jumper wire with Manhattan orthogonal channel routing, crossing halos, safe selection, and drag handle. */
function Jumper({
  wire,
  routedWire,
  isSelected,
  onSelect,
  onDelete,
  onChannelDrag,
  toView,
}: {
  wire: Wire;
  routedWire?: RoutedWire | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onColorChange: (color?: string) => void;
  onChannelDrag?: ((newY: number) => void) | undefined;
  toView?: ((clientX: number, clientY: number) => { x: number; y: number }) | undefined;
}) {
  const value = useEndpointValue(wire.a);
  const ordinal = useNetOrdinal(wire.a);

  if (!routedWire) return null;

  const paint = wirePaint(value, ordinal);
  const color = wire.color || paint.color;
  const d = routedWire.svgPath;
  const points = routedWire.points;
  const pStart = points[0]!;
  const pEnd = points[points.length - 1]!;
  const handlePoint = routedWire.handlePoint;

  const isDarkWire =
    color === "#000000" ||
    color === "#1f2937" ||
    color === "#111827" ||
    color === "#0f172a" ||
    color === "#1e293b" ||
    color === "#0b0f17";

  return (
    <g className="group">
      {/* 1. Wide invisible hit area for effortless clicking and Alt+Click deletion */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          if (e.altKey) {
            onDelete();
          } else {
            onSelect();
          }
        }}
      >
        <title>Click to select jumper · Alt+Click to delete</title>
      </path>

      {/* 2. Enhanced multi-layer selection halo for instant visual clarity */}
      {isSelected && (
        <>
          <path
            d={d}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={11}
            opacity={0.35}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={d}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={6.5}
            opacity={0.85}
            strokeDasharray="6 4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {/* 3. Logic HIGH glow */}
      {paint.glow && !isSelected && (
        <path d={d} fill="none" stroke={color} strokeWidth={8} opacity={0.25} />
      )}

      {/* 4. Crossing halo (bridge overpass effect for intersecting jumpers) */}
      <path
        d={d}
        fill="none"
        stroke={isDarkWire ? "#475569" : "#0b0f17"}
        strokeWidth={isSelected ? 6.5 : 5.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 5. High-contrast outline for black/dark wires in Dark Mode */}
      {isDarkWire && (
        <path
          d={d}
          fill="none"
          className="dark:stroke-slate-300 stroke-slate-500"
          strokeWidth={isSelected ? 5.5 : 4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      )}

      {/* 6. Colored wire insulation core */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isSelected ? 3.5 : 2.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={paint.dashed ? "6 4" : undefined}
        opacity={paint.dim ? 0.75 : 1}
      />

      {/* 7. End contacts */}
      {[pStart, pEnd].map((p, i) => (
        <g key={i}>
          {isSelected && (
            <circle
              cx={p.x}
              cy={p.y}
              r={6.5}
              fill="none"
              stroke="var(--color-primary, #38bdf8)"
              strokeWidth={1.75}
            />
          )}
          <circle cx={p.x} cy={p.y} r={3} fill={color} />
        </g>
      ))}

      {/* 8. Draggable horizontal channel handle when selected */}
      {isSelected && onChannelDrag && (
        <circle
          cx={handlePoint.x}
          cy={handlePoint.y}
          r={5.5}
          fill="#ffffff"
          stroke={color}
          strokeWidth={2}
          className="cursor-ns-resize hover:scale-125 [transform-box:fill-box] origin-center transition-transform"
          onPointerDown={(e) => {
            e.stopPropagation();
            const onPointerMove = (ev: PointerEvent) => {
              if (toView) {
                const pt = toView(ev.clientX, ev.clientY);
                const snappedY = Math.round(pt.y / 2) * 2;
                onChannelDrag(snappedY);
              }
            };
            const onPointerUp = () => {
              window.removeEventListener("pointermove", onPointerMove);
              window.removeEventListener("pointerup", onPointerUp);
            };
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
          }}
        >
          <title>Drag up/down to adjust wire bend (snaps to grid)</title>
        </circle>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Airwires (Rat's Nest) Guide
// ---------------------------------------------------------------------------

function AirwiresGuide({
  doc,
  spec,
}: {
  doc: CircuitDocument;
  spec: BreadboardSpec;
}) {
  const index = useCircuitStore((s) => s.index);
  const schematic = useCircuitStore((s) => s.schematic);

  if (!schematic || !index) return null;

  const unroutedPairs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];

  for (const wire of Object.values(schematic.wires)) {
    if (wire.a.kind !== "pin" || wire.b.kind !== "pin") continue;

    const nodeA = doc.nodes[wire.a.ref.node];
    const nodeB = doc.nodes[wire.b.ref.node];
    if (!nodeA || !nodeB) continue;

    let holeA: HoleRef | null = null;
    if (nodeA.kind === "ic") {
      const defA = getIc(nodeA.part);
      const pinsA = defA?.pins.map((p) => p.name) ?? [];
      const idx = pinsA.indexOf(wire.a.ref.pin);
      if (idx >= 0) {
        const holes = dipHoles({ col: Math.round(nodeA.pos.x) }, defA?.pins.length ?? 14);
        holeA = holes[idx] ?? null;
      }
    } else if (nodeA.boardRow) {
      holeA = { col: Math.round(nodeA.pos.x), row: nodeA.boardRow };
    }

    let holeB: HoleRef | null = null;
    if (nodeB.kind === "ic") {
      const defB = getIc(nodeB.part);
      const pinsB = defB?.pins.map((p) => p.name) ?? [];
      const idx = pinsB.indexOf(wire.b.ref.pin);
      if (idx >= 0) {
        const holes = dipHoles({ col: Math.round(nodeB.pos.x) }, defB?.pins.length ?? 14);
        holeB = holes[idx] ?? null;
      }
    } else if (nodeB.boardRow) {
      holeB = { col: Math.round(nodeB.pos.x), row: nodeB.boardRow };
    }

    if (!holeA || !holeB) continue;
    if (sameStrip(spec, holeA, holeB)) continue;

    const netA = index.netOfEndpoint.get(endpointKey(holeEnd(holeA)));
    const netB = index.netOfEndpoint.get(endpointKey(holeEnd(holeB)));
    if (netA && netB && netA === netB) continue;

    unroutedPairs.push({ a: holePoint(holeA), b: holePoint(holeB) });
  }

  if (unroutedPairs.length === 0) return null;

  return (
    <g className="pointer-events-none">
      {unroutedPairs.map((pair, idx) => (
        <line
          key={idx}
          x1={pair.a.x}
          y1={pair.a.y}
          x2={pair.b.x}
          y2={pair.b.y}
          stroke="var(--color-primary, #38bdf8)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          opacity={0.65}
        />
      ))}
    </g>
  );
}
