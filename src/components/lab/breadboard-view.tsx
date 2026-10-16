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
  endpointKey,
  holeEnd,
  pinEnd,
  pinKey,
  type CircuitDocument,
  type CircuitNode,
  type Endpoint,
  type Point,
  type Wire,
  type WireId,
} from "@/lib/simulation/netlist";
import { getIc, type IcDefinition } from "@/lib/simulation/ic-library";
import { useViewBox } from "@/hooks/use-viewbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CircuitBoard, Cpu, Eye, EyeOff, Layers, Maximize2, Plus, Radio, Sparkles, Zap } from "lucide-react";
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
  const autoWireIcPower = useCircuitStore((s) => s.autoWireIcPower);
  const toggleSwitch = useCircuitStore((s) => s.toggleSwitch);
  const toggleClock = useCircuitStore((s) => s.toggleClock);
  const pulseClock = useCircuitStore((s) => s.pulseClock);
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
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
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

  // Auto-clock effect
  useEffect(() => {
    if (autoHz === null) return;
    const interval = setInterval(() => {
      const state = useCircuitStore.getState();
      const clk = Object.values(state.doc.nodes).find((n) => n.kind === "clock");
      if (clk) {
        state.pulseClock(clk.id);
      }
    }, 1000 / autoHz);
    return () => clearInterval(interval);
  }, [autoHz]);

  // Coordinates of all trainer sockets
  const trainerPinMap = useMemo(() => {
    const map = new Map<string, Point>();
    if (vccNode) map.set(`${vccNode.id}:VCC`, { x: 480, y: 62 });
    if (gndNode) map.set(`${gndNode.id}:GND`, { x: 540, y: 62 });
    if (clockNode) map.set(`${clockNode.id}:CLK`, { x: 850, y: 60 });

    switchNodes.forEach((sw, i) => {
      map.set(`${sw.id}:Q`, { x: 105 + i * 82, y: 668 });
    });

    ledNodes.forEach((led, i) => {
      map.set(`${led.id}:A`, { x: 950 + i * 68, y: 72 });
    });

    nodes.forEach((n) => {
      if (n.boardRow) {
        const hp = holePoint({ col: Math.round(n.pos.x), row: n.boardRow });
        const pWorld = { x: BOARD_OFFSET_X + hp.x, y: BOARD_OFFSET_Y + hp.y };
        if (n.kind === "switch") map.set(`${n.id}:Q`, pWorld);
        if (n.kind === "clock") map.set(`${n.id}:CLK`, pWorld);
        if (n.kind === "led") map.set(`${n.id}:A`, pWorld);
        if (n.kind === "rail") map.set(`${n.id}:${n.rail === "vcc" ? "VCC" : "GND"}`, pWorld);
      }
    });

    return map;
  }, [vccNode, gndNode, clockNode, switchNodes, ledNodes, nodes]);

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
      if (id) clickPin({ node: id, pin: "CLK" });
    } else {
      clickPin({ node: clk.id, pin: "CLK" });
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

  const w = boardWidth(spec);
  const h = boardHeight();
  const CHASSIS_W = BOARD_OFFSET_X * 2 + w;
  const CHASSIS_H = BOARD_OFFSET_Y + h + 115;

  /** Fit the camera to the full trainer chassis */
  const natural = useMemo(() => {
    return { x: 0, y: 0, w: Math.max(1200, CHASSIS_W), h: CHASSIS_H };
  }, [CHASSIS_W, CHASSIS_H]);

  const svgRef = useRef<SVGSVGElement>(null);
  const cam = useViewBox(natural, svgRef);

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
          title="Toggle DIP-14 Internal Gate X-Ray View (Hotkey X)"
        >
          {showXRay ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-muted-foreground" />}
          <span>X-Ray</span>
          <kbd className="ml-0.5 rounded bg-muted/40 px-1 text-[9px] font-mono">X</kbd>
        </Button>
        <Button
          variant={showAirwires ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1 shadow-xs"
          onClick={() => setShowAirwires((v) => !v)}
          title="Toggle Unrouted Schematic Airwires Guide (Hotkey A)"
        >
          <Radio className="size-3.5" />
          <span>Airwires</span>
          <kbd className="ml-0.5 rounded bg-muted/40 px-1 text-[9px] font-mono">A</kbd>
        </Button>
      </div>

      <svg
        ref={svgRef}
        viewBox={cam.viewBox}
        preserveAspectRatio="xMinYMid meet"
        className="bg-card h-full w-full touch-none rounded-md border"
        onWheel={cam.onWheel}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.shiftKey) cam.startPan(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (cam.movePan(e.clientX, e.clientY)) return;
          const p = cam.toView(e.clientX, e.clientY);
          const bh = holeAt(spec, p.x - BOARD_OFFSET_X, p.y - BOARD_OFFSET_Y);
          setHover(bh);
        }}
        onPointerUp={() => cam.endPan()}
        onPointerLeave={() => {
          cam.endPan();
          setHover(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (hover) {
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
              className="fill-background/90 stroke-foreground/25"
              strokeWidth={0.75}
            />
          </pattern>
        </defs>

        {/* --- Digital Logic Trainer Board Chassis Base --- */}
        <rect
          width={CHASSIS_W}
          height={CHASSIS_H}
          rx={12}
          className="fill-slate-950 stroke-border"
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

        {/* Chassis Brand Silk-Screen Title */}
        <g className="pointer-events-none">
          <text
            x={24}
            y={34}
            className="fill-foreground font-mono text-[13px] font-bold tracking-wider"
          >
            DIGITAL LOGIC TRAINER
          </text>
          <text
            x={24}
            y={50}
            className="fill-muted-foreground font-mono text-[9px] tracking-wide"
          >
            MODEL 74XX-TTL · 5V BENCH
          </text>
        </g>

        {/* Top-Left: DC Power Supply Module */}
        <g>
          <rect
            x={400}
            y={14}
            width={180}
            height={82}
            rx={6}
            className="fill-card/75 stroke-border"
            strokeWidth={1}
          />
          <text
            x={410}
            y={28}
            className="fill-muted-foreground font-mono text-[8.5px] font-bold pointer-events-none"
          >
            DC POWER SUPPLY
          </text>
          {/* Status Power LED */}
          <circle cx={425} cy={60} r={4} fill="#10b981" />
          <text
            x={434}
            y={63}
            className="fill-emerald-400 font-mono text-[8.5px] font-semibold pointer-events-none"
          >
            +5.0V ON
          </text>
          {/* +5V Socket */}
          <TrainerSocket
            cx={480}
            cy={60}
            label="+5V"
            sublabel="VCC"
            color="#ef4444"
            isArmed={pendingPin !== null && pendingPin.node === vccNode?.id && pendingPin.pin === "VCC"}
            onClick={handleVccClick}
          />
          {/* GND Socket */}
          <TrainerSocket
            cx={540}
            cy={60}
            label="GND"
            sublabel="0V"
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
            className="fill-card/75 stroke-border"
            strokeWidth={1}
          />
          <text
            x={605}
            y={28}
            className="fill-muted-foreground font-mono text-[8.5px] font-bold pointer-events-none"
          >
            PULSE / CLK GENERATOR
          </text>
          {/* Manual Single-Pulse Button */}
          <g
            className="cursor-pointer group"
            onClick={handlePulse}
            transform="translate(605, 42)"
          >
            <rect
              width={48}
              height={26}
              rx={4}
              className="fill-primary/90 hover:fill-primary stroke-border"
              strokeWidth={1}
            />
            <text
              x={24}
              y={16.5}
              textAnchor="middle"
              fill="#ffffff"
              className="font-mono text-[9px] font-bold pointer-events-none"
            >
              PULSE
            </text>
          </g>

          {/* Auto frequency buttons (1Hz, 2Hz, 5Hz) */}
          {[1, 2, 5].map((hzVal, i) => (
            <g
              key={hzVal}
              className="cursor-pointer group"
              onClick={() => setAutoHz((curr) => (curr === hzVal ? null : hzVal))}
              transform={`translate(${660 + i * 36}, 42)`}
            >
              <rect
                width={32}
                height={26}
                rx={4}
                className={autoHz === hzVal ? "fill-primary" : "fill-muted hover:fill-accent"}
              />
              <text
                x={16}
                y={16.5}
                textAnchor="middle"
                className={cn(
                  "font-mono text-[9px] font-bold pointer-events-none",
                  autoHz === hzVal ? "fill-primary-foreground" : "fill-foreground",
                )}
              >
                {hzVal}Hz
              </text>
            </g>
          ))}

          {/* Clock LED indicator */}
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
            className="fill-muted-foreground font-mono text-[7.5px] font-semibold pointer-events-none"
          >
            {clockNode?.state === 1 ? "HIGH" : "LOW"}
          </text>

          {/* CLK Socket */}
          <TrainerSocket
            cx={850}
            cy={55}
            label="CLK"
            sublabel="OUT"
            color="#f59e0b"
            isArmed={pendingPin !== null && pendingPin.node === clockNode?.id && pendingPin.pin === "CLK"}
            onClick={handleClockClick}
          />
        </g>

        {/* Top-Right: Logic Indicators (Output Monitor LEDs) */}
        <g>
          <rect
            x={905}
            y={14}
            width={CHASSIS_W - 925}
            height={82}
            rx={6}
            className="fill-card/75 stroke-border"
            strokeWidth={1}
          />
          <text
            x={915}
            y={28}
            className="fill-muted-foreground font-mono text-[8.5px] font-bold pointer-events-none"
          >
            LOGIC INDICATORS (OUTPUT MONITOR)
          </text>
          {ledNodes.map((led, i) => (
            <TrainerLed
              key={led.id}
              led={led}
              cx={945 + i * 66}
              cy={48}
              isArmed={pendingPin !== null && pendingPin.node === led.id && pendingPin.pin === "A"}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                clickPin({ node: led.id, pin: "A" });
              }}
            />
          ))}
          <g
            className="cursor-pointer group"
            onClick={handleAddLed}
            transform={`translate(${945 + ledNodes.length * 66 + 8}, 36)`}
          >
            <rect
              width={56}
              height={24}
              rx={4}
              className="fill-muted/80 hover:fill-muted stroke-border"
              strokeWidth={1}
            />
            <text
              x={28}
              y={15}
              textAnchor="middle"
              className="fill-foreground font-mono text-[9px] font-semibold pointer-events-none"
            >
              + LED
            </text>
          </g>
        </g>

        {/* --- Center: Solderless Breadboard --- */}
        <g transform={`translate(${BOARD_OFFSET_X}, ${BOARD_OFFSET_Y})`}>
          <rect width={w} height={h} rx={6} className="fill-muted stroke-border" />
          <rect width={w} height={h} fill="transparent" />

          <BoardBody spec={spec} />

          {/* Airwires (Rat's Nest) Guide */}
          {showAirwires && <AirwiresGuide doc={doc} spec={spec} />}

          {/* Seated Parts with Horizontal Drag and Action Pill */}
          {nodes.map((node) => (
            <SeatedPart
              key={node.id}
              node={node}
              spec={spec}
              otherIcs={icNodes}
              isSelected={selection.includes(node.id)}
              showXRay={showXRay}
              onSelect={() => select([node.id])}
              onDelete={() => deleteSelected()}
              onAutoPower={(nodeId) => autoWireIcPower(nodeId)}
              onToggle={() =>
                node.kind === "clock" ? toggleClock(node.id) : toggleSwitch(node.id)
              }
              onMove={(newCol: number) => moveNode(node.id, { x: newCol, y: 0 })}
              camZoom={cam.zoom}
            />
          ))}

          {/* Hovered hole continuity halo & live 4-state logic probe badge */}
          {hover && <HoleCursor spec={spec} hole={hover} doc={doc} />}

          {/* Pending hole ring */}
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

        {/* --- Bottom: Logic Input Switches (Data Switches) --- */}
        <g>
          <rect
            x={60}
            y={595}
            width={w}
            height={88}
            rx={6}
            className="fill-card/75 stroke-border"
            strokeWidth={1}
          />
          <text
            x={75}
            y={610}
            className="fill-muted-foreground font-mono text-[8.5px] font-bold pointer-events-none"
          >
            LOGIC INPUT SWITCHES (DATA LEVEL)
          </text>
          {switchNodes.map((sw, i) => (
            <TrainerSwitch
              key={sw.id}
              sw={sw}
              cx={105 + i * 82}
              cy={642}
              isArmed={pendingPin !== null && pendingPin.node === sw.id && pendingPin.pin === "Q"}
              onToggle={() => toggleSwitch(sw.id)}
              onSocketClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                clickPin({ node: sw.id, pin: "Q" });
              }}
            />
          ))}
          <g
            className="cursor-pointer group"
            onClick={handleAddSwitch}
            transform={`translate(${105 + switchNodes.length * 82 + 8}, 630)`}
          >
            <rect
              width={62}
              height={26}
              rx={4}
              className="fill-muted/80 hover:fill-muted stroke-border"
              strokeWidth={1}
            />
            <text
              x={31}
              y={16.5}
              textAnchor="middle"
              className="fill-foreground font-mono text-[9px] font-semibold pointer-events-none"
            >
              + Input
            </text>
          </g>
        </g>

        {/* --- Jumpers (Routed across Chassis & Breadboard) --- */}
        {Object.values(doc.wires).map((wire) => (
          <Jumper
            key={wire.id}
            wire={wire}
            isSelected={selectedWireId === wire.id}
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
            trainerPinMap={trainerPinMap}
          />
        ))}

        {/* Pending jumper line being drawn */}
        {pendingHole && hover && (
          <line
            x1={BOARD_OFFSET_X + holePoint(pendingHole).x}
            y1={BOARD_OFFSET_Y + holePoint(pendingHole).y}
            x2={BOARD_OFFSET_X + holePoint(hover).x}
            y2={BOARD_OFFSET_Y + holePoint(hover).y}
            className="stroke-foreground/60"
            strokeWidth={2.5}
            strokeDasharray="4 4"
          />
        )}
        {pendingPin && hover && trainerPinMap.get(pinKey(pendingPin)) && (
          <line
            x1={trainerPinMap.get(pinKey(pendingPin))!.x}
            y1={trainerPinMap.get(pinKey(pendingPin))!.y}
            x2={BOARD_OFFSET_X + holePoint(hover).x}
            y2={BOARD_OFFSET_Y + holePoint(hover).y}
            className="stroke-foreground/60"
            strokeWidth={2.5}
            strokeDasharray="4 4"
          />
        )}
      </svg>

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
                <Sparkles className="size-4 shrink-0 text-amber-300" />
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
          className="animate-spin"
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
          className="fill-muted-foreground font-mono text-[7.5px] font-medium pointer-events-none select-none"
        >
          {sublabel}
        </text>
      )}
    </g>
  );
}

interface TrainerLedProps {
  led: Extract<CircuitNode, { kind: "led" }>;
  cx: number;
  cy: number;
  isArmed?: boolean | undefined;
  onClick: (e: React.MouseEvent) => void;
}

function TrainerLed({
  led,
  cx,
  cy,
  isArmed,
  onClick,
}: TrainerLedProps) {
  const value = useEndpointValue(pinEnd({ node: led.id, pin: "A" }));
  const lit = value === 1;
  const col = logicColor(value);

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Label */}
      <text
        x={0}
        y={-14}
        textAnchor="middle"
        className="fill-foreground font-mono text-[9px] font-bold pointer-events-none"
      >
        {led.label}
      </text>

      {/* Glow if HIGH */}
      {lit && (
        <circle cx={0} cy={0} r={14} fill={col} opacity={0.35} />
      )}

      {/* Bezel */}
      <circle cx={0} cy={0} r={9} fill="#1e293b" stroke="#334155" strokeWidth={1} />
      {/* Jewel lens */}
      <circle
        cx={0}
        cy={0}
        r={7}
        fill={lit ? col : "#1e293b"}
        stroke={col}
        strokeWidth={1}
      />
      {/* Dome reflection highlight */}
      <ellipse cx={-2.5} cy={-2.5} rx={2} ry={1.2} fill="#ffffff" opacity={lit ? 0.6 : 0.2} />

      {/* 4-state indicator badge */}
      <text
        x={0}
        y={14}
        textAnchor="middle"
        fill={col}
        className="font-mono text-[7.5px] font-bold pointer-events-none"
      >
        {value === 1 ? "1" : value === 0 ? "0" : value === 2 ? "Z" : "X"}
      </text>

      {/* Input banana socket */}
      <g transform="translate(0, 24)">
        <TrainerSocket
          cx={0}
          cy={0}
          color="#10b981"
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
      {/* Label */}
      <text
        x={0}
        y={-14}
        textAnchor="middle"
        className="fill-foreground font-mono text-[10px] font-bold pointer-events-none"
      >
        {sw.label}
      </text>

      {/* Mini status LED */}
      <circle
        cx={-18}
        cy={0}
        r={3.5}
        fill={on ? "#10b981" : "#334155"}
        stroke={on ? "#34d399" : "#1e293b"}
        strokeWidth={0.75}
      />

      {/* Toggle switch body */}
      <g
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {/* Toggle switch plate / slot */}
        <rect
          x={-10}
          y={-11}
          width={20}
          height={22}
          rx={3}
          className="fill-slate-800 stroke-slate-700"
          strokeWidth={1}
        />
        {/* Switch bat/lever */}
        <rect
          x={-7}
          y={on ? -9 : 1}
          width={14}
          height={9}
          rx={2}
          fill={on ? "#10b981" : "#475569"}
          stroke={on ? "#34d399" : "#64748b"}
          strokeWidth={0.5}
        />
      </g>

      {/* Logic state text */}
      <text
        x={18}
        y={3}
        fill={on ? "#10b981" : "#94a3b8"}
        className="font-mono text-[8px] font-bold pointer-events-none select-none"
      >
        {on ? "1" : "0"}
      </text>

      {/* Output banana socket */}
      <g transform="translate(0, 26)">
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
        className="fill-background/80 stroke-border"
        strokeWidth={0.5}
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
              y={y + 3}
              className="fill-foreground/80 pointer-events-none font-mono text-[10px] font-semibold"
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

      {/* Row letters and column numbers */}
      {ALL_ROWS.map((row) => (
        <text
          key={row}
          x={8}
          y={holePoint({ col: 1, row }).y + 3}
          className="fill-foreground/70 pointer-events-none font-mono text-[9px] font-medium"
        >
          {row}
        </text>
      ))}
      {Array.from({ length: spec.columns }, (_, i) => i + 1)
        .filter((c) => c % 5 === 0 || c === 1)
        .map((col) => (
          <text
            key={col}
            x={holePoint({ col, row: "J" }).x}
            y={holePoint({ col, row: "J" }).y - PITCH / 2 - 3}
            textAnchor="middle"
            className="fill-foreground/70 pointer-events-none font-mono text-[9px] font-medium"
          >
            {col}
          </text>
        ))}
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

/** Highlights the hovered hole, its whole electrical strip, and displays the 4-state logic probe badge. */
function HoleCursor({
  spec,
  hole,
  doc,
}: {
  spec: BreadboardSpec;
  hole: HoleRef;
  doc: CircuitDocument;
}) {
  const value = useEndpointValue(holeEnd(hole));
  const p = holePoint(hole);
  const color = logicColor(value);
  const attached = useMemo(() => getAttachedPin(doc, spec, hole), [doc, spec, hole]);

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

  // Floating probe badge position
  const badgeW = attached ? 200 : 160;
  const badgeH = attached ? 46 : 32;
  const boardW = boardWidth(spec);
  const badgeX = Math.min(boardW - badgeW - 12, Math.max(12, p.x - badgeW / 2));
  const badgeY = p.y < 80 ? p.y + 18 : p.y - badgeH - 14;

  const rowName = isRail(hole.row)
    ? isPositiveRail(hole.row)
      ? "+5V Rail"
      : "GND Rail"
    : `Row ${hole.row}`;

  return (
    <g className="pointer-events-none">
      {/* Strip backdrop metallic tie-bar */}
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

      {/* Halos on all connected holes in strip */}
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

      {/* Target hole cursor */}
      <circle
        cx={p.x}
        cy={p.y}
        r={7}
        fill="none"
        stroke={color}
        strokeWidth={2}
      />
      <circle
        cx={p.x}
        cy={p.y}
        r={2.5}
        fill={color}
      />

      {/* Floating 4-State Logic Probe Card */}
      <g transform={`translate(${badgeX}, ${badgeY})`}>
        <rect
          width={badgeW}
          height={badgeH}
          rx={6}
          className="fill-card/95 stroke-border"
          strokeWidth={1}
          filter="drop-shadow(0 4px 6px rgba(0,0,0,0.35))"
        />
        <text
          x={10}
          y={14}
          className="fill-foreground font-mono text-[9px] font-semibold"
        >
          {isRail(hole.row) ? rowName : `Col ${hole.col} · ${rowName}`}
          <tspan className="fill-muted-foreground font-normal"> ({hole.col}{hole.row})</tspan>
        </text>

        {attached && (
          <text
            x={10}
            y={27}
            className="fill-foreground/90 font-mono text-[8.5px]"
          >
            <tspan fill={attached.isPower ? "#ef4444" : attached.isGnd ? "#3b82f6" : "var(--color-primary, #38bdf8)"}>
              ⚡ {attached.nodeLabel}
            </tspan>
            <tspan className="fill-muted-foreground"> ({attached.part})</tspan>
            <tspan className="font-semibold"> P{attached.pinNumber}:{attached.pinName}</tspan>
          </text>
        )}

        {/* 4-State Level Pill */}
        <g transform={`translate(${badgeW - 56}, ${attached ? 24 : 10})`}>
          <rect
            width={48}
            height={16}
            rx={4}
            fill={color}
            opacity={0.2}
            stroke={color}
            strokeWidth={0.75}
          />
          <circle cx={7} cy={8} r={3} fill={color} />
          <text
            x={14}
            y={11.5}
            fill={color}
            className="font-mono text-[8.5px] font-bold"
          >
            {value === 1 ? "1:HIGH" : value === 0 ? "0:LOW" : value === 2 ? "Z:HIZ" : "X:FLT"}
          </text>
        </g>
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Parts & 74xx DIP Components
// ---------------------------------------------------------------------------

function SeatedPart({
  node,
  spec,
  otherIcs,
  isSelected,
  showXRay,
  onSelect,
  onDelete,
  onAutoPower,
  onToggle,
  onMove,
  camZoom,
}: {
  node: CircuitNode;
  spec: BreadboardSpec;
  otherIcs: Extract<CircuitNode, { kind: "ic" }>[];
  isSelected: boolean;
  showXRay: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onAutoPower: (nodeId: string) => void;
  onToggle: () => void;
  onMove: (newCol: number) => void;
  camZoom: number;
}) {
  if (node.kind === "ic") {
    return (
      <SeatedIc
        node={node}
        spec={spec}
        otherIcs={otherIcs}
        isSelected={isSelected}
        showXRay={showXRay}
        onSelect={onSelect}
        onDelete={onDelete}
        onAutoPower={onAutoPower}
        onMove={onMove}
        camZoom={camZoom}
      />
    );
  }
  if (!node.boardRow) return null;

  const hole = { col: Math.round(node.pos.x), row: node.boardRow };
  if (hole.col < 1 || hole.col > spec.columns) return null;

  if (node.kind === "switch") {
    return <SeatedSwitch node={node} hole={hole} onToggle={onToggle} />;
  }
  if (node.kind === "clock") {
    return <SeatedClock node={node} hole={hole} onToggle={onToggle} />;
  }
  if (node.kind === "led") return <SeatedLed node={node} hole={hole} />;
  if (node.kind === "rail") return <SeatedRail node={node} hole={hole} />;
  return null;
}

/** Authentic DIP-14 with Pin-1 notch, pinout numbers/names, NC indicators, X-Ray mode, and ravine dragging. */
function SeatedIc({
  node,
  spec,
  otherIcs,
  isSelected,
  showXRay,
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

      {/* Part & instance text label */}
      <text
        x={(a.x + b.x) / 2}
        y={midY + (showXRay ? -22 : 4)}
        textAnchor="middle"
        className={showXRay ? "fill-foreground font-mono text-[10px] font-bold pointer-events-none" : "fill-background font-mono text-[11px] font-semibold pointer-events-none"}
      >
        {node.part} · {node.label}
      </text>

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
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.35))"
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
              y={isUpper ? pt.y + 11 : pt.y - 7}
              textAnchor="middle"
              className={`font-mono text-[7px] font-semibold pointer-events-none ${
                isNc
                  ? "fill-red-400 font-bold"
                  : pinName === "VCC"
                  ? "fill-red-400 font-bold"
                  : pinName === "GND"
                  ? "fill-blue-400 font-bold"
                  : showXRay
                  ? "fill-muted-foreground"
                  : "fill-background/80"
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
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.4))"
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
        className="fill-foreground/80 font-mono text-[7px] font-bold"
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

const labelDy = (row: BoardRow): number =>
  (UPPER_BANK as readonly string[]).includes(row) ? 18 : -13;

const UPPER_BANK: BoardRow[] = ["F", "G", "H", "I", "J"];

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

function SeatedSwitch({
  node,
  hole,
  onToggle,
}: {
  node: Extract<CircuitNode, { kind: "switch" }>;
  hole: HoleRef;
  onToggle: () => void;
}) {
  const p = holePoint(hole);
  const on = node.state === 1;
  return (
    <g
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <rect
        x={p.x - 9}
        y={p.y - 9}
        width={18}
        height={18}
        rx={3}
        className="fill-card stroke-foreground/70"
      />
      <rect
        x={p.x - 6}
        y={on ? p.y - 6 : p.y}
        width={12}
        height={6}
        rx={1.5}
        style={{ fill: on ? "var(--logic-high)" : "var(--logic-low)" }}
      />
      <text
        x={p.x}
        y={p.y + (labelDy(hole.row) > 0 ? 20 : -13)}
        textAnchor="middle"
        className="fill-foreground pointer-events-none font-mono text-[10px] font-semibold"
      >
        {node.label}
      </text>
    </g>
  );
}

function SeatedClock({
  node,
  hole,
  onToggle,
}: {
  node: Extract<CircuitNode, { kind: "clock" }>;
  hole: HoleRef;
  onToggle: () => void;
}) {
  const p = holePoint(hole);
  const high = node.state === 1;
  return (
    <g
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <rect
        x={p.x - 9}
        y={p.y - 9}
        width={18}
        height={18}
        rx={3}
        className="fill-card stroke-foreground/70"
      />
      <path
        d={`M${p.x - 6},${p.y + 4} H${p.x - 2} V${p.y - 4} H${p.x + 2} V${p.y + 4} H${p.x + 6}`}
        fill="none"
        style={{ stroke: high ? "var(--logic-high)" : "var(--logic-low)" }}
        strokeWidth={1.6}
      />
      <text
        x={p.x}
        y={p.y + labelDy(hole.row)}
        textAnchor="middle"
        className="fill-foreground pointer-events-none font-mono text-[10px] font-semibold"
      >
        {node.label}
      </text>
    </g>
  );
}

function SeatedLed({
  node,
  hole,
}: {
  node: Extract<CircuitNode, { kind: "led" }>;
  hole: HoleRef;
}) {
  const value = useEndpointValue(holeEnd(hole));
  const p = holePoint(hole);
  const lit = value === 1;
  const color = logicColor(value);

  return (
    <g className="pointer-events-none">
      {lit && <circle cx={p.x} cy={p.y} r={12} fill={color} opacity={0.3} />}
      <circle
        cx={p.x}
        cy={p.y}
        r={7}
        style={{ fill: lit ? color : "var(--card)", stroke: color }}
        strokeWidth={1.5}
      />
      <text
        x={p.x}
        y={p.y + labelDy(hole.row)}
        textAnchor="middle"
        className="fill-foreground font-mono text-[10px] font-semibold"
      >
        {node.label}
      </text>
    </g>
  );
}

function SeatedRail({
  node,
  hole,
}: {
  node: Extract<CircuitNode, { kind: "rail" }>;
  hole: HoleRef;
}) {
  const p = holePoint(hole);
  const vcc = node.rail === "vcc";
  return (
    <g className="pointer-events-none">
      <circle
        cx={p.x}
        cy={p.y}
        r={5}
        style={{ fill: vcc ? "var(--logic-x)" : "var(--logic-low)" }}
      />
      <text
        x={p.x + 8}
        y={p.y + 3}
        className="fill-foreground font-mono text-[9px] font-semibold"
      >
        {vcc ? "+5V" : "GND"}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Jumper Wires & Safe Selection UX
// ---------------------------------------------------------------------------

function resolveEndpointPoint(
  end: Endpoint,
  trainerPinMap: Map<string, Point>,
): Point | null {
  if (end.kind === "hole") {
    const hp = holePoint(end.ref);
    return {
      x: BOARD_OFFSET_X + hp.x,
      y: BOARD_OFFSET_Y + hp.y,
    };
  }
  if (end.kind === "pin") {
    const key = pinKey(end.ref);
    const p = trainerPinMap.get(key);
    if (p) return p;
    return null;
  }
  return null;
}

const COLOR_SWATCHES = [
  { label: "Red (+5V)", value: "#ef4444" },
  { label: "Dark Gray (GND)", value: "#1f2937" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Green", value: "#10b981" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Orange", value: "#f97316" },
  { label: "Purple", value: "#8b5cf6" },
  { label: "Cyan", value: "#06b6d4" },
];

/** Jumper wire with safe selection, floating color/delete pill, and Alt+Click instant removal. */
function Jumper({
  wire,
  isSelected,
  onSelect,
  onDelete,
  onColorChange,
  trainerPinMap,
}: {
  wire: Wire;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onColorChange: (color?: string) => void;
  trainerPinMap: Map<string, Point>;
}) {
  const value = useEndpointValue(wire.a);
  const ordinal = useNetOrdinal(wire.a);

  const a = resolveEndpointPoint(wire.a, trainerPinMap);
  const b = resolveEndpointPoint(wire.b, trainerPinMap);

  if (!a || !b) return null;

  const paint = wirePaint(value, ordinal);
  const color = wire.color || paint.color;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const sag = Math.min(36, Math.max(12, dist * 0.16));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + sag;
  const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;

  return (
    <g className="group">
      {/* Selection halo */}
      {isSelected && (
        <path
          d={d}
          fill="none"
          stroke="var(--color-primary, #38bdf8)"
          strokeWidth={8}
          opacity={0.45}
          strokeDasharray="6 4"
        />
      )}

      {/* Logic HIGH glow */}
      {paint.glow && !isSelected && (
        <path d={d} fill="none" stroke={color} strokeWidth={8} opacity={0.25} />
      )}

      {/* Main wire core */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isSelected ? 3.5 : 3}
        strokeLinecap="round"
        strokeDasharray={paint.dashed ? "6 4" : undefined}
        opacity={paint.dim ? 0.75 : 1}
      />

      {/* Wide hit area for safe single-click select and Alt+Click delete */}
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

      {/* Plugged end holes / socket contacts */}
      {[a, b].map((p, i) => (
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

      {/* Floating Action Pill on Selected Wire */}
      {isSelected && (
        <g
          transform={`translate(${mx - 85}, ${Math.max(10, my - 30)})`}
          className="cursor-default pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <rect
            width={170}
            height={26}
            rx={5}
            className="fill-card/95 stroke-border"
            strokeWidth={1}
            filter="drop-shadow(0 4px 6px rgba(0,0,0,0.35))"
          />

          <circle cx={11} cy={13} r={4} fill={logicColor(value)} />
          <text
            x={19}
            y={16.5}
            fill={logicColor(value)}
            className="font-mono text-[9px] font-bold"
          >
            {value === 1 ? "1" : value === 0 ? "0" : value === 2 ? "Z" : "X"}
          </text>

          {COLOR_SWATCHES.map((swatch, idx) => (
            <circle
              key={swatch.value}
              cx={38 + idx * 12}
              cy={13}
              r={4}
              fill={swatch.value}
              className="cursor-pointer hover:stroke-foreground hover:stroke-1"
              onClick={() => onColorChange(swatch.value)}
            >
              <title>{swatch.label}</title>
            </circle>
          ))}

          <g
            className="cursor-pointer group/del"
            onClick={onDelete}
          >
            <rect
              x={145}
              y={4}
              width={18}
              height={18}
              rx={3}
              className="fill-destructive/80 group-hover/del:fill-destructive"
            />
            <text
              x={154}
              y={16.5}
              textAnchor="middle"
              fill="#ffffff"
              className="font-bold text-[11px] pointer-events-none"
            >
              ×
            </text>
          </g>
        </g>
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
