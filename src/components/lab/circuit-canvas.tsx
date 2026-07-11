"use client";

import { useCallback, useRef, useState } from "react";
import { useCircuitStore } from "@/stores/circuit-store";
import { logicColor, useEndpointValue, useNetValue } from "@/stores/sim-store";
import { LOGIC_NAMES } from "@/lib/simulation/logic";
import { GateSymbol } from "./gate-symbol";
import { GATE_W, IO_H, IO_W, GATE_LABELS, pinsOf } from "@/lib/simulation/parts";
import { dipHeight, dipWidth, getIc } from "@/lib/simulation/ic-library";
import type {
  CircuitNode,
  NodeId,
  PinRef,
  Point,
  Wire,
} from "@/lib/simulation/netlist";
import { pinKey } from "@/lib/simulation/netlist";
import { holePoint } from "@/lib/simulation/breadboard";
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

/** Corner radius on wire bends. Purely cosmetic; real jumpers do not fold sharp. */
const BEND_R = 5;

/** Round the corners of an orthogonal polyline. */
function orthPath(points: readonly Point[]): string {
  if (points.length < 2) return "";
  const first = points[0] as Point;
  let d = `M ${first.x} ${first.y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1] as Point;
    const cur = points[i] as Point;
    const next = points[i + 1] as Point;

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

  const last = points[points.length - 1] as Point;
  return `${d} L ${last.x} ${last.y}`;
}

function WireLine({ wire }: { wire: Wire }) {
  const doc = useCircuitStore((s) => s.doc);
  const deleteWire = useCircuitStore((s) => s.deleteWire);
  const route = useCircuitStore((s) => s.routes.get(wire.id));
  // Subscribes to THIS wire's net only. A switch flip re-renders just the wires
  // whose own value changed, not all of them.
  const value = useEndpointValue(wire.a);

  const endpointPos = (end: typeof wire.a): Point | null => {
    if (end.kind === "hole") return holePoint(end.ref);
    const node = doc.nodes[end.ref.node];
    return node ? pinPos(node, end.ref.pin) : null;
  };

  const a = endpointPos(wire.a);
  const b = endpointPos(wire.b);
  if (!a || !b) return null;

  // A route is cosmetic (see router.ts). When there is none, the wire still
  // exists and still conducts — we just draw it as a dashed straight air-wire and
  // say so, rather than pretending it isn't there.
  const unrouted = !route;
  const d = route ? orthPath(route) : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const color = logicColor(value);

  return (
    <g className="group">
      {/* The glow is a thick translucent halo UNDER a bright core — not an SVG
          filter. Sixty simultaneous feGaussianBlurs would tank the frame rate. */}
      {value === 1 && !unrouted && (
        <path d={d} fill="none" stroke={color} strokeWidth={7} opacity={0.25} />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={unrouted ? "5 4" : undefined}
        opacity={unrouted ? 0.6 : 1}
      />
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
        <title>
          {unrouted
            ? "No clean route — connected, but drawn straight. Click to delete."
            : "Click to delete this wire"}
        </title>
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
            <text
              x={spec.offset.x}
              y={bottom ? height + 14 : -6}
              textAnchor="middle"
              className={cn(
                "font-mono text-[8px]",
                spec.dir === "pwr" && "fill-logic-high",
                spec.dir === "gnd" && "fill-logic-low",
                spec.dir === "out" && "fill-foreground/80",
                spec.dir === "in" && "fill-muted-foreground",
              )}
            >
              {spec.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
