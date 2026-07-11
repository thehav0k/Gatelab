"use client";

import { useCallback, useRef, useState } from "react";
import { useCircuitStore } from "@/stores/circuit-store";
import { logicColor, useNetValue } from "@/stores/sim-store";
import { LOGIC_NAMES } from "@/lib/simulation/logic";
import { GateSymbol } from "./gate-symbol";
import { GATE_W, IO_H, IO_W, GATE_LABELS, pinsOf } from "@/lib/simulation/parts";
import type {
  CircuitNode,
  NodeId,
  PinRef,
  Point,
  Wire,
} from "@/lib/simulation/netlist";
import { pinKey } from "@/lib/simulation/netlist";
import { cn } from "@/lib/utils";

const GRID = 8;
const snap = (v: number): number => Math.round(v / GRID) * GRID;

/** Absolute canvas position of a pin. */
function pinPos(node: CircuitNode, pin: string): Point {
  const spec = pinsOf(node).find((p) => p.name === pin);
  if (!spec) return node.pos;
  return { x: node.pos.x + spec.offset.x, y: node.pos.y + spec.offset.y };
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

  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  /**
   * Drag state lives in a REF, and the node's transform is written straight to
   * the DOM during the gesture. Writing x/y into the store on every mousemove
   * would re-render the whole canvas 60 times a second; the store only hears
   * about it on mouseup.
   */
  const drag = useRef<{
    id: NodeId;
    el: SVGGElement;
    start: Point;
    origin: Point;
    moved: boolean;
  } | null>(null);

  const toCanvas = useCallback((e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return {
      x: vb.x + ((e.clientX - rect.left) / rect.width) * vb.width,
      y: vb.y + ((e.clientY - rect.top) / rect.height) * vb.height,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
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
    [pendingPin, toCanvas],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d || !d.moved) return;

      const p = toCanvas(e);
      moveNode(d.id, {
        x: snap(d.origin.x + (p.x - d.start.x)),
        y: snap(d.origin.y + (p.y - d.start.y)),
      });
    },
    [moveNode, toCanvas],
  );

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 900 560"
      className="bg-card h-full w-full touch-none rounded-md border"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onClick={(e) => {
        if (e.target === svgRef.current) {
          select([]);
          cancelWire();
        }
      }}
    >
      <defs>
        <pattern id="grid" width={GRID * 4} height={GRID * 4} patternUnits="userSpaceOnUse">
          <circle cx={0.5} cy={0.5} r={0.5} className="fill-muted-foreground/25" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />

      {/* Wires first, so nodes sit on top of them. */}
      {Object.values(doc.wires).map((wire) => (
        <WireLine key={wire.id} wire={wire} />
      ))}

      {/* The wire being drawn. */}
      {pendingPin && cursor && <PendingWire from={pendingPin} to={cursor} />}

      {/* Stable insertion order, deliberately.
          It is tempting to sort the selected node last so it paints on top (SVG
          has no z-index). Do NOT: React would then REORDER THE DOM on
          pointerdown, which breaks the pointerdown -> click sequence, and every
          switch silently stops toggling. Overlap is handled by spacing new drops
          apart (palette.tsx) and by letting the user drag nodes. */}
      {Object.values(doc.nodes).map((node) => (
        <NodeView
          key={node.id}
          node={node}
          selected={selection.includes(node.id)}
          pendingPin={pendingPin}
          onPinClick={clickPin}
          onSelect={() => select([node.id])}
          onToggle={() => toggleSwitch(node.id)}
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
  );
}

// ---------------------------------------------------------------------------
// Wires
// ---------------------------------------------------------------------------

function WireLine({ wire }: { wire: Wire }) {
  const doc = useCircuitStore((s) => s.doc);
  const deleteWire = useCircuitStore((s) => s.deleteWire);
  // Subscribes to THIS wire's net only. A switch flip re-renders just the wires
  // whose own value changed, not all of them.
  const value = useNetValue(wire.a);

  const na = doc.nodes[wire.a.node];
  const nb = doc.nodes[wire.b.node];
  if (!na || !nb) return null;

  const a = pinPos(na, wire.a.pin);
  const b = pinPos(nb, wire.b.pin);

  // Orthogonal-ish routing: out, across, in. Good enough until the M6 router.
  const mid = (a.x + b.x) / 2;
  const d = `M ${a.x} ${a.y} L ${mid} ${a.y} L ${mid} ${b.y} L ${b.x} ${b.y}`;
  const color = logicColor(value);

  return (
    <g className="group">
      {/* The glow is a thick translucent halo UNDER a bright core — not an SVG
          filter. Sixty simultaneous feGaussianBlurs would tank the frame rate. */}
      {value === 1 && (
        <path d={d} fill="none" stroke={color} strokeWidth={7} opacity={0.25} />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={2} />
      {/* A 2px stroke is unclickable. This invisible fat copy is the hit target. */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          deleteWire(wire.id);
        }}
      >
        <title>Click to delete this wire</title>
      </path>
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

interface NodeViewProps {
  node: CircuitNode;
  selected: boolean;
  pendingPin: PinRef | null;
  onPinClick: (ref: PinRef) => void;
  onSelect: () => void;
  onToggle: () => void;
  onDragStart: (el: SVGGElement, e: React.PointerEvent) => void;
}

function NodeView({
  node,
  selected,
  pendingPin,
  onPinClick,
  onSelect,
  onToggle,
  onDragStart,
}: NodeViewProps) {
  const ref = useRef<SVGGElement>(null);
  const pins = pinsOf(node);

  return (
    <g
      ref={ref}
      transform={`translate(${node.pos.x} ${node.pos.y})`}
      className="cursor-move"
      onPointerDown={(e) => {
        // Pins handle their own clicks; dragging from a pin would fight wiring.
        if ((e.target as Element).closest("[data-pin]")) return;
        e.stopPropagation();
        onSelect();
        if (ref.current) onDragStart(ref.current, e);
      }}
    >
      {node.kind === "gate" && (
        <GateSymbol
          op={node.op}
          className={cn(
            "fill-card stroke-foreground/70",
            selected && "stroke-ring stroke-2",
          )}
        />
      )}

      {node.kind === "switch" && <SwitchBody node={node} selected={selected} onToggle={onToggle} />}
      {node.kind === "led" && <LedBody node={node} selected={selected} />}
      {node.kind === "rail" && <RailBody node={node} selected={selected} />}
      {node.kind === "ic" && <IcBody node={node} selected={selected} />}

      {/* Label */}
      {node.kind === "gate" && (
        <text
          x={GATE_W / 2}
          y={-6}
          textAnchor="middle"
          className="fill-muted-foreground pointer-events-none font-mono text-[10px]"
        >
          {node.label} · {GATE_LABELS[node.op]}
        </text>
      )}

      {pins.map((spec) => (
        <Pin
          key={spec.name}
          node={node}
          name={spec.name}
          at={spec.offset}
          armed={pendingPin !== null}
          isPending={
            pendingPin !== null &&
            pinKey(pendingPin) === pinKey({ node: node.id, pin: spec.name })
          }
          onClick={() => onPinClick({ node: node.id, pin: spec.name })}
        />
      ))}
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
      {lit && <circle cx={IO_W / 2} cy={IO_H / 2} r={16} fill={color} opacity={0.28} />}
      <circle
        cx={IO_W / 2}
        cy={IO_H / 2}
        r={11}
        style={{ fill: lit ? color : "var(--card)", stroke: color }}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      <text
        x={IO_W / 2}
        y={IO_H + 14}
        textAnchor="middle"
        className="fill-foreground pointer-events-none font-mono text-[11px] font-semibold"
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

function IcBody({
  node,
  selected,
}: {
  node: Extract<CircuitNode, { kind: "ic" }>;
  selected: boolean;
}) {
  // Filled in properly in M4, when the 74xx library lands.
  const pins = pinsOf(node);
  const width = 7 * 24;
  const height = 3 * 24;
  return (
    <g>
      <rect
        width={width}
        height={height}
        rx={3}
        className={cn("fill-card stroke-foreground/70", selected && "stroke-ring stroke-2")}
      />
      <text
        x={width / 2}
        y={height / 2 + 4}
        textAnchor="middle"
        className="fill-foreground pointer-events-none font-mono text-xs"
      >
        {node.label} · {node.part}
      </text>
      <title>{pins.length} pins</title>
    </g>
  );
}
