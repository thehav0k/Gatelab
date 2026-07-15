"use client";

import { useMemo } from "react";
import { GateSymbol } from "@/components/lab/gate-symbol";
import { GATE_W, GATE_H, IO_W, IO_H, pinsOf } from "@/lib/simulation/parts";
import { dipWidth, dipHeight } from "@/lib/simulation/ic-library";
import type { CircuitDocument, CircuitNode, Point } from "@/lib/simulation/netlist";

/**
 * A read-only picture of a circuit.
 *
 * The lab's canvas is 680 lines of pan, zoom, drag, wiring and live simulation,
 * all bound to the circuit store. Theory needs none of that — it wants to SHOW a
 * circuit it just synthesized, not let you edit the lab's board. So this is a
 * plain, store-free renderer: nodes at their positions, wires as straight lines.
 *
 * Routing is deliberately not done here. A route is cosmetic (invariant 6), and a
 * straight line between two pins is a perfectly honest picture of a connection —
 * this is a diagram, not a board you have to solder.
 */

function nodeSize(node: CircuitNode): { w: number; h: number } {
  switch (node.kind) {
    case "gate":
      return { w: GATE_W, h: GATE_H };
    case "ic":
      return { w: dipWidth(pinsOf(node).length), h: dipHeight() };
    case "switch":
    case "rail":
      return { w: IO_W, h: IO_H };
    case "led":
      return { w: IO_H, h: IO_H };
  }
}

function pinPos(node: CircuitNode, pin: string): Point {
  const spec = pinsOf(node).find((p) => p.name === pin);
  if (!spec) return node.pos;
  return { x: node.pos.x + spec.offset.x, y: node.pos.y + spec.offset.y };
}

export function StaticSchematic({
  doc,
  className,
  maxHeight = 420,
}: {
  doc: CircuitDocument;
  className?: string;
  maxHeight?: number;
}) {
  const { viewBox, empty } = useMemo(() => {
    const nodes = Object.values(doc.nodes);
    if (nodes.length === 0) return { viewBox: "0 0 100 100", empty: true };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const { w, h } = nodeSize(n);
      x0 = Math.min(x0, n.pos.x);
      y0 = Math.min(y0, n.pos.y);
      x1 = Math.max(x1, n.pos.x + w);
      y1 = Math.max(y1, n.pos.y + h);
    }
    const pad = 40;
    return {
      viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`,
      empty: false,
    };
  }, [doc]);

  if (empty) return null;

  return (
    <svg
      viewBox={viewBox}
      className={className}
      style={{ maxHeight, width: "100%" }}
      role="img"
      aria-label="circuit schematic"
    >
      {/* wires under nodes */}
      {Object.values(doc.wires).map((wire) => {
        if (wire.a.kind !== "pin" || wire.b.kind !== "pin") return null;
        const na = doc.nodes[wire.a.ref.node];
        const nb = doc.nodes[wire.b.ref.node];
        if (!na || !nb) return null;
        const a = pinPos(na, wire.a.ref.pin);
        const b = pinPos(nb, wire.b.ref.pin);
        return (
          <line
            key={wire.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-muted-foreground/60"
            strokeWidth={1.5}
          />
        );
      })}

      {Object.values(doc.nodes).map((node) => (
        <Node key={node.id} node={node} />
      ))}
    </svg>
  );
}

function Node({ node }: { node: CircuitNode }) {
  const { x, y } = node.pos;

  if (node.kind === "gate") {
    return (
      <g transform={`translate(${x} ${y})`}>
        <g className="fill-card stroke-foreground/80" strokeWidth={1.5}>
          <GateSymbol op={node.op} />
        </g>
        {pinsOf(node).map((p) => (
          <circle
            key={p.name}
            cx={p.offset.x}
            cy={p.offset.y}
            r={2}
            className="fill-muted-foreground"
          />
        ))}
      </g>
    );
  }

  if (node.kind === "switch") {
    return (
      <g transform={`translate(${x} ${y})`}>
        <rect
          width={IO_W}
          height={IO_H}
          rx={4}
          className="fill-card stroke-foreground/70"
          strokeWidth={1.5}
        />
        <text
          x={IO_W / 2}
          y={IO_H / 2}
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-foreground font-mono"
          fontSize={13}
        >
          {node.label}
        </text>
      </g>
    );
  }

  if (node.kind === "led") {
    return (
      <g transform={`translate(${x} ${y})`}>
        <circle
          cx={IO_H / 2}
          cy={IO_H / 2}
          r={IO_H / 2 - 2}
          className="fill-card stroke-foreground/70"
          strokeWidth={1.5}
        />
        <text
          x={IO_H / 2}
          y={IO_H + 12}
          textAnchor="middle"
          className="fill-muted-foreground font-mono"
          fontSize={12}
        >
          {node.label}
        </text>
      </g>
    );
  }

  if (node.kind === "rail") {
    const vcc = node.rail === "vcc";
    return (
      <g transform={`translate(${x} ${y})`}>
        <text
          x={IO_W / 2}
          y={vcc ? IO_H + 12 : -4}
          textAnchor="middle"
          className={vcc ? "fill-logic-high font-mono" : "fill-muted-foreground font-mono"}
          fontSize={12}
        >
          {vcc ? "+5V" : "GND"}
        </text>
        <line
          x1={IO_W / 2 - 10}
          y1={vcc ? IO_H : 0}
          x2={IO_W / 2 + 10}
          y2={vcc ? IO_H : 0}
          className={vcc ? "stroke-logic-high" : "stroke-muted-foreground"}
          strokeWidth={2}
        />
      </g>
    );
  }

  // IC: a labelled box with numbered pin stubs.
  const pins = pinsOf(node);
  const w = dipWidth(pins.length);
  const h = dipHeight();
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={4} className="fill-card stroke-foreground/70" strokeWidth={1.5} />
      <text
        x={w / 2}
        y={h / 2}
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-foreground font-mono"
        fontSize={13}
      >
        {node.label}
      </text>
      {pins.map((p) => (
        <circle
          key={p.name}
          cx={p.offset.x}
          cy={p.offset.y}
          r={2}
          className="fill-muted-foreground"
        />
      ))}
    </g>
  );
}
