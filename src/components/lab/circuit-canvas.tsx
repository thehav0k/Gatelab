"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCircuitStore } from "@/stores/circuit-store";
import {
  logicColor,
  useEndpointValue,
  useNetOrdinal,
  useNetValue,
  wirePaint,
} from "@/stores/sim-store";
import { LOGIC_NAMES, LX } from "@/lib/simulation/logic";
import { GateSymbol } from "./gate-symbol";
import {
  IO_H,
  IO_W,
  GATE_LABELS,
  pinsOf,
  nodeDimensions,
  getPinWorldPosition,
} from "@/lib/simulation/parts";
import { dipHeight, dipWidth, getIc } from "@/lib/simulation/ic-library";
import type {
  CircuitNode,
  NodeId,
  PinRef,
  Point,
  Wire,
  WireId,
} from "@/lib/simulation/netlist";
import { pinKey } from "@/lib/simulation/netlist";
import { holePoint } from "@/lib/simulation/breadboard";
import { footprint } from "@/lib/simulation/router";
import { cn } from "@/lib/utils";
import { useViewBox } from "@/hooks/use-viewbox";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";

const GRID = 8;
const snap = (v: number): number => Math.round(v / GRID) * GRID;

const COLOR_SWATCHES = [
  { label: "Red (+5V)", value: "#ef4444" },
  { label: "Black (GND)", value: "#1f2937" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Green", value: "#10b981" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Orange", value: "#f97316" },
  { label: "Purple", value: "#8b5cf6" },
  { label: "Cyan", value: "#06b6d4" },
];

/** Absolute canvas position of a pin taking into account rotation and flip transforms. */
function pinPos(node: CircuitNode, pin: string): Point {
  return getPinWorldPosition(node, pin) ?? node.pos;
}

export function CircuitCanvas() {
  const doc = useCircuitStore((s) => s.doc);
  const selection = useCircuitStore((s) => s.selection);
  const pendingPin = useCircuitStore((s) => s.pendingPin);
  const clickPin = useCircuitStore((s) => s.clickPin);
  const cancelWire = useCircuitStore((s) => s.cancelWire);
  const select = useCircuitStore((s) => s.select);
  const moveNode = useCircuitStore((s) => s.moveNode);
  const toggleSwitch = useCircuitStore((s) => s.toggleSwitch);
  const toggleClock = useCircuitStore((s) => s.toggleClock);
  const rotateNode = useCircuitStore((s) => s.rotateNode);
  const flipNode = useCircuitStore((s) => s.flipNode);
  const deleteSelected = useCircuitStore((s) => s.deleteSelected);
  const deleteWire = useCircuitStore((s) => s.deleteWire);
  const setWireColor = useCircuitStore((s) => s.setWireColor);

  const [cursor, setCursor] = useState<Point | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<WireId | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if (selection.length > 0) {
        const selId = selection[0]!;
        if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          rotateNode(selId, e.shiftKey ? -90 : 90);
        } else if (e.key === "h" || e.key === "H") {
          e.preventDefault();
          flipNode(selId, "x");
        } else if (e.key === "v" || e.key === "V") {
          e.preventDefault();
          flipNode(selId, "y");
        }
      }
      if (selectedWireId && (e.key === "Delete" || e.key === "Backspace")) {
        deleteWire(selectedWireId);
        setSelectedWireId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, selectedWireId, rotateNode, flipNode, deleteWire]);

  /** Fit the camera to whatever is actually on the canvas. */
  const bounds = useMemo(() => {
    const nodes = Object.values(doc.nodes);
    if (nodes.length === 0) return { x: 0, y: 0, w: 900, h: 560 };

    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of nodes) {
      const f = footprint(n);
      x0 = Math.min(x0, f.x);
      y0 = Math.min(y0, f.y);
      x1 = Math.max(x1, f.x + f.w);
      y1 = Math.max(y1, f.y + f.h);
    }
    const pad = 70;
    const w = Math.max(520, x1 - x0 + pad * 2);
    const h = Math.max(340, y1 - y0 + pad * 2);
    return { x: x0 - pad, y: y0 - pad, w, h };
  }, [doc.nodes]);

  const svgRef = useRef<SVGSVGElement>(null);
  const cam = useViewBox(bounds, svgRef);

  /**
   * Drag state lives in a REF, and the node's transform is written straight to
   * the DOM during the gesture.
   */
  const drag = useRef<{
    id: NodeId;
    el: SVGGElement;
    start: Point;
    origin: Point;
    moved: boolean;
  } | null>(null);

  const toCanvas = useCallback(
    (e: { clientX: number; clientY: number }): Point => cam.toView(e.clientX, e.clientY),
    [cam],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (cam.movePan(e.clientX, e.clientY)) return;

      const p = toCanvas(e);
      if (pendingPin) setCursor(p);

      const d = drag.current;
      if (!d) return;
      const next = {
        x: snap(d.origin.x + (p.x - d.start.x)),
        y: snap(d.origin.y + (p.y - d.start.y)),
      };
      d.moved = true;
      d.el.setAttribute("transform", `translate(${next.x} ${next.y})`);
    },
    [pendingPin, toCanvas, cam],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (cam.endPan()) return;

      const d = drag.current;
      drag.current = null;
      if (!d || !d.moved) return;

      const p = toCanvas(e);
      moveNode(d.id, {
        x: snap(d.origin.x + (p.x - d.start.x)),
        y: snap(d.origin.y + (p.y - d.start.y)),
      });
    },
    [moveNode, toCanvas, cam],
  );

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        data-native-cursor=""
        viewBox={cam.viewBox}
        className={cn(
          "bg-card h-full w-full touch-none rounded-md border",
          pendingPin ? "cursor-crosshair" : "cursor-default",
        )}
        onWheel={cam.onWheel}
        onPointerDown={(e) => {
          if (e.target === svgRef.current || (e.target as Element).id === "grid-bg") {
            cam.startPan(e.clientX, e.clientY);
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={(e) => {
          if (e.target === svgRef.current || (e.target as Element).id === "grid-bg") {
            select([]);
            setSelectedWireId(null);
            cancelWire();
          }
        }}
      >
        <defs>
          <pattern id="grid" width={GRID * 4} height={GRID * 4} patternUnits="userSpaceOnUse">
            <circle cx={0.5} cy={0.5} r={0.5} className="fill-muted-foreground/25" />
          </pattern>
        </defs>
        <rect id="grid-bg" x={-4000} y={-4000} width={9000} height={9000} fill="url(#grid)" />

        {/* Wires first, so nodes sit on top of them. */}
        {Object.values(doc.wires).map((wire) => (
          <WireLine
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
            }}
            onColorChange={(color) => {
              setWireColor(wire.id, color);
            }}
          />
        ))}

        {/* The wire being drawn. */}
        {pendingPin && cursor && <PendingWire from={pendingPin} to={cursor} />}

        {/* Transformed Nodes with Action Pill on Selection */}
        {Object.values(doc.nodes).map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={selection.includes(node.id)}
            pendingPin={pendingPin}
            onPinClick={clickPin}
            onSelect={() => {
              setSelectedWireId(null);
              select([node.id]);
            }}
            onToggle={() =>
              node.kind === "clock" ? toggleClock(node.id) : toggleSwitch(node.id)
            }
            onRotateCw={() => rotateNode(node.id, 90)}
            onRotateCcw={() => rotateNode(node.id, -90)}
            onFlipH={() => flipNode(node.id, "x")}
            onFlipV={() => flipNode(node.id, "y")}
            onDelete={() => deleteSelected()}
            onDragStart={(el, e) => {
              drag.current = {
                id: node.id,
                el,
                start: toCanvas(e),
                origin: node.pos,
                moved: false,
              };
            }}
          />
        ))}
      </svg>

      <div className="no-print absolute right-2 bottom-2 flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={cam.zoomOut}
          title="Zoom out"
          aria-label="Zoom out"
        >
          -
        </Button>
        <span className="text-muted-foreground bg-card/80 rounded px-1.5 py-0.5 font-mono text-[11px]">
          {Math.round(cam.zoom * 100)}%
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={cam.zoomIn}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={cam.reset}
          title="Fit to circuit"
          aria-label="Fit to circuit"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wires
// ---------------------------------------------------------------------------

/** Corner radius on wire bends. Purely cosmetic; real jumpers do not fold sharp. */
const BEND_R = 5;

function wireOffset(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 3) - 1) * 2.5; // -2.5, 0, or 2.5 px
}

/** Round the corners of an orthogonal polyline with subtle parallel offset. */
function orthPath(points: readonly Point[], offset = 0): string {
  if (points.length < 2) return "";

  // Apply subtle parallel offset to intermediate path points
  const pts = points.map((p, i) => {
    if (i === 0 || i === points.length - 1 || offset === 0) return p;
    const prev = points[i - 1]!;
    const next = points[i + 1]!;
    const isHorizIn = Math.abs(p.y - prev.y) < 2;
    const isHorizOut = Math.abs(next.y - p.y) < 2;
    if (isHorizIn && isHorizOut) return { x: p.x, y: p.y + offset };
    if (!isHorizIn && !isHorizOut) return { x: p.x + offset, y: p.y };
    return {
      x: isHorizIn ? p.x : p.x + offset,
      y: isHorizIn ? p.y + offset : p.y,
    };
  });

  const first = pts[0] as Point;
  let d = `M ${first.x} ${first.y}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1] as Point;
    const cur = pts[i] as Point;
    const next = pts[i + 1] as Point;

    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(BEND_R, inLen / 2, outLen / 2);
    if (r < 1) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }

    const ax = cur.x - Math.sign(cur.x - prev.x) * r;
    const ay = cur.y - Math.sign(cur.y - prev.y) * r;
    const bx = cur.x + Math.sign(next.x - cur.x) * r;
    const by = cur.y + Math.sign(next.y - cur.y) * r;

    d += ` L ${ax} ${ay} Q ${cur.x} ${cur.y} ${bx} ${by}`;
  }

  const last = pts[pts.length - 1] as Point;
  return `${d} L ${last.x} ${last.y}`;
}

function WireLine({
  wire,
  isSelected,
  onSelect,
  onDelete,
  onColorChange,
}: {
  wire: Wire;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onColorChange: (color?: string) => void;
}) {
  const doc = useCircuitStore((s) => s.doc);
  const route = useCircuitStore((s) => s.routes.get(wire.id));
  const value = useEndpointValue(wire.a);
  const ordinal = useNetOrdinal(wire.a);

  const endpointPos = (end: typeof wire.a): Point | null => {
    if (end.kind === "hole") return holePoint(end.ref);
    const node = doc.nodes[end.ref.node];
    return node ? pinPos(node, end.ref.pin) : null;
  };

  const a = endpointPos(wire.a);
  const b = endpointPos(wire.b);
  if (!a || !b) return null;

  const unrouted = !route;
  const offset = wireOffset(wire.id);
  const d = route ? orthPath(route, offset) : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

  const paint = wirePaint(value, ordinal);
  const color = wire.color || paint.color;

  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  return (
    <g className="group">
      {/* Selection halo */}
      {isSelected && (
        <path
          d={d}
          fill="none"
          stroke="var(--color-primary, #38bdf8)"
          strokeWidth={4}
          opacity={0.35}
          strokeDasharray="6 4"
        />
      )}

      {paint.glow && !unrouted && !isSelected && (
        <path d={d} fill="none" stroke={color} strokeWidth={4.5} opacity={0.25} />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isSelected ? 3 : paint.glow ? 2.4 : 2}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={unrouted ? "5 4" : paint.dashed ? "6 3" : undefined}
        opacity={unrouted ? 0.55 : paint.dim ? 0.62 : 1}
        className={value === LX ? "animate-[signal-pulse_1.8s_ease-in-out_infinite]" : undefined}
      />
      {value === 1 && !unrouted && Object.keys(doc.wires).length <= 60 && (
        <path
          d={d}
          fill="none"
          stroke="var(--signal-1, var(--color-logic-high))"
          strokeWidth={paint.glow ? 2.6 : 2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          style={{
            strokeDashoffset: 0,
            transition: "stroke-dashoffset 160ms linear",
          }}
        />
      )}
      {/* A 2px stroke is unclickable. This invisible fat copy is the hit target. */}
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
        <title>Click to select wire · Alt+Click to delete</title>
      </path>

      {/* Floating Action Pill on Selected Wire */}
      {isSelected && (
        <g
          transform={`translate(${mx - 74}, ${Math.max(10, my - 28)})`}
          className="cursor-default pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <rect
            width={148}
            height={26}
            rx={5}
            className="fill-card/95 stroke-border"
            strokeWidth={1}
            style={{ filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.35))" }}
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
              cx={40 + idx * 11}
              cy={13}
              r={4}
              fill={swatch.value}
              className="cursor-pointer hover:stroke-foreground hover:stroke-1"
              onClick={() => onColorChange(swatch.value)}
            >
              <title>{swatch.label}</title>
            </circle>
          ))}

          <g className="cursor-pointer group/del" onClick={onDelete}>
            <rect
              x={125}
              y={4}
              width={18}
              height={18}
              rx={3}
              className="fill-destructive/80 group-hover/del:fill-destructive"
            />
            <text
              x={134}
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

function PendingWire({ from, to }: { from: PinRef; to: Point }) {
  const doc = useCircuitStore((s) => s.doc);
  const node = doc.nodes[from.node];
  if (!node) return null;
  const a = pinPos(node, from.pin);
  return (
    <line
      x1={a.x}
      y1={a.y}
      x2={to.x}
      y2={to.y}
      className="stroke-foreground/50"
      strokeWidth={2}
      strokeDasharray="4 4"
    />
  );
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function NodeActionPill({
  wRot,
  onRotateCw,
  onRotateCcw,
  onFlipH,
  onFlipV,
  onDelete,
}: {
  wRot: number;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onDelete: () => void;
}) {
  const pillW = 120;
  const pillH = 26;
  const pillX = wRot / 2 - pillW / 2;
  const pillY = -44;

  return (
    <g
      transform={`translate(${pillX}, ${pillY})`}
      className="cursor-default pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <rect
        width={pillW}
        height={pillH}
        rx={5}
        className="fill-card/95 stroke-border"
        strokeWidth={1}
        style={{ filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.3))" }}
      />
      {/* Rotate CW */}
      <g
        role="button"
        tabIndex={0}
        aria-label="Rotate 90 degrees clockwise (R)"
        className="cursor-pointer hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary rounded"
        onClick={onRotateCw}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onRotateCw();
          }
        }}
        transform="translate(8, 5)"
      >
        <rect width={16} height={16} rx={3} fill="transparent" />
        <path
          d="M 12 3 A 5 5 0 1 0 13 8 M 13 3 L 13 6 L 10 6"
          fill="none"
          stroke="var(--color-primary, #38bdf8)"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <title>Rotate 90° CW (R)</title>
      </g>

      {/* Rotate CCW */}
      <g
        role="button"
        tabIndex={0}
        aria-label="Rotate 90 degrees counter-clockwise (Shift+R)"
        className="cursor-pointer hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary rounded"
        onClick={onRotateCcw}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onRotateCcw();
          }
        }}
        transform="translate(32, 5)"
      >
        <rect width={16} height={16} rx={3} fill="transparent" />
        <path
          d="M 4 3 A 5 5 0 1 1 3 8 M 3 3 L 3 6 L 6 6"
          fill="none"
          stroke="var(--color-primary, #38bdf8)"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <title>Rotate 90° CCW (Shift+R)</title>
      </g>

      {/* Flip H */}
      <g
        role="button"
        tabIndex={0}
        aria-label="Flip horizontally (H)"
        className="cursor-pointer hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary rounded"
        onClick={onFlipH}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onFlipH();
          }
        }}
        transform="translate(56, 5)"
      >
        <rect width={16} height={16} rx={3} fill="transparent" />
        <path
          d="M 8 2 L 8 14 M 2 8 L 6 5 L 6 11 Z M 14 8 L 10 5 L 10 11 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <title>Flip Horizontal (H)</title>
      </g>

      {/* Flip V */}
      <g
        role="button"
        tabIndex={0}
        aria-label="Flip vertically (V)"
        className="cursor-pointer hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary rounded"
        onClick={onFlipV}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onFlipV();
          }
        }}
        transform="translate(78, 5)"
      >
        <rect width={16} height={16} rx={3} fill="transparent" />
        <path
          d="M 2 8 L 14 8 M 8 2 L 5 6 L 11 6 Z M 8 14 L 5 10 L 11 10 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <title>Flip Vertical (V)</title>
      </g>

      {/* Delete */}
      <g
        role="button"
        tabIndex={0}
        aria-label="Delete component (Delete/Backspace)"
        className="cursor-pointer group/del focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive rounded"
        onClick={onDelete}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onDelete();
          }
        }}
        transform="translate(100, 4)"
      >
        <rect
          width={18}
          height={18}
          rx={3}
          className="fill-destructive/80 group-hover/del:fill-destructive"
        />
        <text
          x={9}
          y={13}
          textAnchor="middle"
          fill="#ffffff"
          className="font-bold text-[11px] pointer-events-none select-none"
        >
          ×
        </text>
        <title>Delete component (Del)</title>
      </g>
    </g>
  );
}

interface NodeViewProps {
  node: CircuitNode;
  selected: boolean;
  pendingPin: PinRef | null;
  onPinClick: (ref: PinRef) => void;
  onSelect: () => void;
  onToggle: () => void;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onDelete: () => void;
  onDragStart: (el: SVGGElement, e: React.PointerEvent) => void;
}

function NodeView({
  node,
  selected,
  pendingPin,
  onPinClick,
  onSelect,
  onToggle,
  onRotateCw,
  onRotateCcw,
  onFlipH,
  onFlipV,
  onDelete,
  onDragStart,
}: NodeViewProps) {
  const ref = useRef<SVGGElement>(null);
  const pins = pinsOf(node);

  const dims = nodeDimensions(node);
  const rot = node.rotation ?? 0;
  const fx = node.flipX ?? false;
  const fy = node.flipY ?? false;
  const isPerp = rot === 90 || rot === 270;
  const wRot = isPerp ? dims.h : dims.w;
  const hRot = isPerp ? dims.w : dims.h;

  const bodyTransform =
    rot === 0 && !fx && !fy
      ? undefined
      : `translate(${wRot / 2} ${hRot / 2}) rotate(${rot}) scale(${fx ? -1 : 1} ${fy ? -1 : 1}) translate(${-dims.w / 2} ${-dims.h / 2})`;

  return (
    <g
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={`${node.label ?? node.kind} component`}
      transform={`translate(${node.pos.x} ${node.pos.y})`}
      className="cursor-move group focus-visible:outline-hidden"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onPointerDown={(e) => {
        // Pins handle their own clicks; dragging from a pin would fight wiring.
        if ((e.target as Element).closest("[data-pin]")) return;
        e.stopPropagation();
        onSelect();
        if (ref.current) onDragStart(ref.current, e);
      }}
    >
      {/* Selection Border & Focus Ring */}
      {selected ? (
        <rect
          x={-4}
          y={-4}
          width={wRot + 8}
          height={hRot + 8}
          rx={6}
          fill="none"
          stroke="var(--color-primary, #38bdf8)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          className="pointer-events-none"
        />
      ) : (
        <rect
          x={-4}
          y={-4}
          width={wRot + 8}
          height={hRot + 8}
          rx={6}
          fill="none"
          stroke="var(--color-primary, #38bdf8)"
          strokeWidth={1.5}
          className="pointer-events-none opacity-0 group-focus-visible:opacity-100"
        />
      )}

      {/* Floating Action Pill */}
      {selected && (
        <NodeActionPill
          wRot={wRot}
          onRotateCw={onRotateCw}
          onRotateCcw={onRotateCcw}
          onFlipH={onFlipH}
          onFlipV={onFlipV}
          onDelete={onDelete}
        />
      )}

      {/* Rotated & Flipped Component Body */}
      <g transform={bodyTransform}>
        {node.kind === "gate" && (
          <GateSymbol
            op={node.op}
            arity={node.arity}
            className={cn(
              "fill-card stroke-foreground/70",
              selected && "stroke-ring stroke-2",
            )}
          />
        )}

        {node.kind === "switch" && (
          <SwitchBody node={node} selected={selected} onToggle={onToggle} />
        )}
        {node.kind === "clock" && (
          <ClockBody node={node} selected={selected} onToggle={onToggle} />
        )}
        {node.kind === "led" && <LedBody node={node} selected={selected} />}
        {node.kind === "rail" && <RailBody node={node} selected={selected} />}
        {node.kind === "ic" && <IcBody node={node} selected={selected} />}
      </g>

      {/* Upright Label */}
      {node.kind === "gate" && (
        <text
          x={wRot / 2}
          y={-6}
          textAnchor="middle"
          className="fill-muted-foreground pointer-events-none font-mono text-[10px]"
        >
          {node.label} · {GATE_LABELS[node.op]}
        </text>
      )}

      {/* Transformed Pins with Pin-Accurate World Coordinates */}
      {pins.map((spec) => {
        const pinWorld = getPinWorldPosition(node, spec.name) ?? {
          x: node.pos.x + spec.offset.x,
          y: node.pos.y + spec.offset.y,
        };
        const localAt = {
          x: pinWorld.x - node.pos.x,
          y: pinWorld.y - node.pos.y,
        };
        return (
          <Pin
            key={spec.name}
            node={node}
            name={spec.name}
            at={localAt}
            armed={pendingPin !== null}
            isPending={
              pendingPin !== null &&
              pinKey(pendingPin) === pinKey({ node: node.id, pin: spec.name })
            }
            onClick={() => onPinClick({ node: node.id, pin: spec.name })}
          />
        );
      })}
    </g>
  );
}

function Pin({
  node,
  name,
  at,
  armed,
  isPending,
  onClick,
}: {
  node: CircuitNode;
  name: string;
  at: Point;
  armed: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  const value = useNetValue({ node: node.id, pin: name });

  return (
    <g
      data-pin={`${node.id}:${name}`}
      // The resolved 4-state level, in the DOM. Makes the canvas inspectable
      // without colour-sniffing — for tests, for debugging, and for a11y.
      data-value={LOGIC_NAMES[value]}
      className="cursor-crosshair"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* Visible dot… */}
      <circle
        cx={at.x}
        cy={at.y}
        r={3.5}
        style={{ fill: logicColor(value) }}
        className={cn(isPending && "stroke-ring", "stroke-[1.5]")}
      />
      {/* …and a fat transparent grab target over it. Free hit-testing is one of
          the main reasons this canvas is SVG and not Canvas2D. */}
      <circle
        cx={at.x}
        cy={at.y}
        r={10}
        fill="transparent"
        className={cn(armed && "hover:fill-ring/20")}
      >
        <title>
          {node.label}.{name}
        </title>
      </circle>
    </g>
  );
}

// --- bodies ----------------------------------------------------------------

/**
 * A clock source.
 *
 * Drawn as a square wave rather than as a switch with a different label,
 * because it behaves differently and the picture should say so: a switch is a
 * level you set, and this is a thing that produces EDGES. Clicking it advances
 * one edge; the panel below the canvas runs it.
 */
function ClockBody({
  node,
  selected,
  onToggle,
}: {
  node: Extract<CircuitNode, { kind: "clock" }>;
  selected: boolean;
  onToggle: () => void;
}) {
  const high = node.state === 1;
  const level = high ? "var(--logic-high)" : "var(--logic-low)";
  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="cursor-pointer"
    >
      <rect
        width={IO_W}
        height={IO_H}
        rx={5}
        className={cn("fill-card stroke-foreground/70", selected && "stroke-ring stroke-2")}
      />
      {/* One cycle of a square wave, with the half it is currently in filled. */}
      <path
        d={`M6,${IO_H - 8} H14 V8 H24 V${IO_H - 8} H32 V8 H38`}
        fill="none"
        stroke={level}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text
        x={IO_W / 2}
        y={-6}
        textAnchor="middle"
        className="fill-foreground pointer-events-none font-mono text-[11px] font-semibold"
      >
        {node.label}
      </text>
    </g>
  );
}

function SwitchBody({
  node,
  selected,
  onToggle,
}: {
  node: Extract<CircuitNode, { kind: "switch" }>;
  selected: boolean;
  onToggle: () => void;
}) {
  const on = node.state === 1;
  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="cursor-pointer"
    >
      <rect
        width={IO_W}
        height={IO_H}
        rx={5}
        className={cn("fill-card stroke-foreground/70", selected && "stroke-ring stroke-2")}
      />
      <rect
        x={on ? IO_W / 2 - 2 : 4}
        y={4}
        width={IO_W / 2 - 2}
        height={IO_H - 8}
        rx={3}
        style={{ fill: on ? "var(--logic-high)" : "var(--logic-low)" }}
      />
      <text
        x={IO_W / 2}
        y={-6}
        textAnchor="middle"
        className="fill-foreground pointer-events-none font-mono text-[11px] font-semibold"
      >
        {node.label}
      </text>
    </g>
  );
}

function LedBody({
  node,
  selected,
}: {
  node: Extract<CircuitNode, { kind: "led" }>;
  selected: boolean;
}) {
  const value = useNetValue({ node: node.id, pin: "A" });
  const color = logicColor(value);
  const lit = value === 1;

  return (
    <g>
      {/* Blurred glow circle with animated opacity */}
      <circle
        cx={IO_W / 2}
        cy={IO_H / 2}
        r={18}
        fill={color}
        className="pointer-events-none transition-opacity duration-120"
        style={{
          opacity: lit ? 0.35 : 0,
          filter: "blur(4px)",
        }}
      />
      <circle
        cx={IO_W / 2}
        cy={IO_H / 2}
        r={11}
        className="transition-colors duration-120"
        style={{ fill: lit ? color : "var(--card)", stroke: color }}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      <text
        x={IO_W / 2}
        y={IO_H + 14}
        textAnchor="middle"
        className="fill-foreground pointer-events-none font-mono text-[11px] font-semibold select-none"
      >
        {node.label}
      </text>
    </g>
  );
}

function RailBody({
  node,
  selected,
}: {
  node: Extract<CircuitNode, { kind: "rail" }>;
  selected: boolean;
}) {
  const vcc = node.rail === "vcc";
  const y = vcc ? IO_H : 0;
  return (
    <g>
      <line
        x1={4}
        y1={y}
        x2={IO_W - 4}
        y2={y}
        style={{ stroke: vcc ? "var(--logic-high)" : "var(--logic-low)" }}
        strokeWidth={selected ? 4 : 3}
        strokeLinecap="round"
      />
      <line
        x1={IO_W / 2}
        y1={vcc ? 6 : IO_H - 6}
        x2={IO_W / 2}
        y2={y}
        style={{ stroke: vcc ? "var(--logic-high)" : "var(--logic-low)" }}
        strokeWidth={2}
      />
      <text
        x={IO_W / 2}
        y={vcc ? 2 : IO_H + 12}
        textAnchor="middle"
        className="fill-muted-foreground pointer-events-none font-mono text-[10px]"
      >
        {vcc ? "+5V" : "GND"}
      </text>
    </g>
  );
}

/**
 * A real DIP package: notch on the left, pin 1 bottom-left, numbering running
 * counter-clockwise. The numbers are not decoration — the whole point of the
 * lab is that "connect pin 14 to +5V" means something you can act on.
 */
function IcBody({
  node,
  selected,
}: {
  node: Extract<CircuitNode, { kind: "ic" }>;
  selected: boolean;
}) {
  const def = getIc(node.part);
  if (!def) return null;

  const pins = pinsOf(node);
  const width = dipWidth(pins.length);
  const height = dipHeight();

  return (
    <g>
      <rect
        width={width}
        height={height}
        rx={3}
        className={cn(
          "fill-muted stroke-foreground/70",
          selected && "stroke-ring stroke-2",
        )}
      />

      {/* The orientation notch. Without it, "pin 1" is meaningless. */}
      <path
        d={`M 0 ${height / 2 - 8} A 8 8 0 0 0 0 ${height / 2 + 8} Z`}
        className="fill-card stroke-foreground/70"
      />

      <text
        x={width / 2}
        y={height / 2 - 2}
        textAnchor="middle"
        className="fill-foreground pointer-events-none font-mono text-[13px] font-semibold"
      >
        {def.part}
      </text>
      <text
        x={width / 2}
        y={height / 2 + 12}
        textAnchor="middle"
        className="fill-muted-foreground pointer-events-none font-mono text-[9px]"
      >
        {node.label}
      </text>

      {/* Pin numbers and names, printed on the package like the real thing. */}
      {pins.map((spec) => {
        const bottom = spec.offset.y > 0;
        const isNegative = spec.name.includes("CLR") || spec.name.includes("PRE");
        const displayName = spec.name.replace(/QN$/, "Q̄").replace(/^QN$/, "Q̄");
        return (
          <g key={spec.name} className="pointer-events-none">
            <text
              x={spec.offset.x}
              y={bottom ? height - 6 : 11}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[8px]"
            >
              {spec.number}
            </text>
            {/*
              The pin NAME is printed outside the package, which is also where
              the wires leaving that pin run — on a dense board the two land on
              top of each other and neither can be read. `paint-order: stroke`
              with a stroke in the canvas colour draws a halo behind the glyphs
              first, so the label sits on the wire instead of in it.
            */}
            <text
              x={spec.offset.x}
              y={bottom ? height + 13 : -6}
              textAnchor="middle"
              stroke="var(--card)"
              strokeWidth={2}
              strokeLinejoin="round"
              style={{
                paintOrder: "stroke",
                textDecoration: isNegative ? "overline" : undefined,
              }}
              className={cn(
                "font-mono tracking-tight",
                displayName.length >= 4 ? "text-[6.5px]" : "text-[7.5px]",
                spec.dir === "pwr" && "fill-logic-high",
                spec.dir === "gnd" && "fill-logic-low",
                spec.dir === "out" && "fill-foreground/80",
                spec.dir === "in" && "fill-muted-foreground",
              )}
            >
              {displayName}
            </text>
          </g>
        );
      })}
    </g>
  );
}
