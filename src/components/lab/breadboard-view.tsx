"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useCircuitStore } from "@/stores/circuit-store";
import { logicColor, useEndpointValue } from "@/stores/sim-store";
import { LOGIC_NAMES, type Logic } from "@/lib/simulation/logic";
import {
  ALL_ROWS,
  BOARD_PAD,
  PITCH,
  boardHeight,
  boardWidth,
  dipHoles,
  holeAt,
  holePoint,
  isPositiveRail,
  isRail,
  stripOf,
  type BoardRow,
  type BreadboardSpec,
  type HoleRef,
} from "@/lib/simulation/breadboard";
import { holeEnd, type CircuitNode, type Point, type Wire } from "@/lib/simulation/netlist";
import { getIc } from "@/lib/simulation/ic-library";

const RAIL_ROWS: BoardRow[] = ["+top", "-top", "+bottom", "-bottom"];

/**
 * The breadboard.
 *
 * PERFORMANCE NOTE THAT DRIVES THE STRUCTURE: a 63-column board has ~880 holes.
 * Emitting one <circle> each would be 880 DOM nodes for a field that never
 * changes and is never hit-tested by identity — "which hole did I click" is O(1)
 * arithmetic from (x, y), not a lookup. So the hole field is a single <rect>
 * filled with an SVG <pattern>: one node, resolution-independent.
 *
 * Only the things that actually change — chips, parts, jumpers, and the hole
 * currently under the cursor — are real elements.
 */
export function BreadboardView() {
  const doc = useCircuitStore((s) => s.doc);
  const spec = doc.board;

  const clickHole = useCircuitStore((s) => s.clickHole);
  const pendingHole = useCircuitStore((s) => s.pendingHole);
  const cancelWire = useCircuitStore((s) => s.cancelWire);
  const toggleSwitch = useCircuitStore((s) => s.toggleSwitch);

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<HoleRef | null>(null);

  const toBoard = useCallback((e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return {
      x: vb.x + ((e.clientX - rect.left) / rect.width) * vb.width,
      y: vb.y + ((e.clientY - rect.top) / rect.height) * vb.height,
    };
  }, []);

  const nodes = useMemo(() => Object.values(doc.nodes), [doc.nodes]);

  if (!spec) return null;

  const w = boardWidth(spec);
  const h = boardHeight();

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      className="bg-card h-full w-full touch-none rounded-md border"
      onPointerMove={(e) => {
        const p = toBoard(e);
        setHover(holeAt(spec, p.x, p.y));
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const p = toBoard(e);
        const hole = holeAt(spec, p.x, p.y);
        if (hole) clickHole(hole);
        else cancelWire();
      }}
    >
      <defs>
        {/* The whole hole field, as ONE node. See the note above. */}
        <pattern
          id="holes"
          width={PITCH}
          height={PITCH}
          patternUnits="userSpaceOnUse"
          x={BOARD_PAD}
          y={BOARD_PAD}
        >
          <rect
            x={PITCH / 2 - 3}
            y={PITCH / 2 - 3}
            width={6}
            height={6}
            rx={1.5}
            className="fill-background stroke-border"
            strokeWidth={0.75}
          />
        </pattern>
      </defs>

      <rect width={w} height={h} rx={6} className="fill-muted/40 stroke-border" />

      <BoardBody spec={spec} />

      {/* Jumpers, under the parts. */}
      {Object.values(doc.wires).map((wire) => (
        <Jumper key={wire.id} wire={wire} />
      ))}

      {nodes.map((node) => (
        <SeatedPart
          key={node.id}
          node={node}
          spec={spec}
          onToggle={() => toggleSwitch(node.id)}
        />
      ))}

      {/* The hole under the cursor, and the jumper being drawn. */}
      {pendingHole && hover && (
        <line
          x1={holePoint(pendingHole).x}
          y1={holePoint(pendingHole).y}
          x2={holePoint(hover).x}
          y2={holePoint(hover).y}
          className="stroke-foreground/50"
          strokeWidth={2.5}
          strokeDasharray="4 4"
        />
      )}
      {hover && <HoleCursor spec={spec} hole={hover} />}
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
    </svg>
  );
}

/** The static board: strip bands, the centre channel, the rail lines. */
function BoardBody({ spec }: { spec: BreadboardSpec }) {
  const w = boardWidth(spec);

  // Faint bands behind each half, so the channel reads as a real separation.
  //
  // Mind the row order: the upper strip runs J..F DOWN to the channel, and the
  // lower strip runs E..A AWAY from it. E and F are the two rows flanking the gap
  // — that adjacency is what a DIP straddles. Computing these spans the other way
  // round produces a NEGATIVE height, which the browser rejects outright.
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

      {/* The centre channel. This gap is what a DIP straddles, and it is the
          reason the chip's two rows of pins land on different strips. */}
      <rect
        x={0}
        y={channelY}
        width={w}
        height={channelH}
        className="fill-background/60"
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
                stroke: positive ? "var(--logic-x)" : "var(--logic-low)",
              }}
              strokeWidth={1}
              opacity={0.35}
            />
            <text
              x={6}
              y={y + 3}
              className="fill-muted-foreground pointer-events-none font-mono text-[9px]"
            >
              {positive ? "+" : "−"}
            </text>
          </g>
        );
      })}

      {/* The rail break. Drawing it is not decoration: a jumper on the left half
          does NOT power a chip wired to the right half, and the student has to be
          able to see where the metal stops. */}
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

      {/* Row letters and column numbers, as printed on a real board. */}
      {ALL_ROWS.map((row) => (
        <text
          key={row}
          x={8}
          y={holePoint({ col: 1, row }).y + 3}
          className="fill-muted-foreground pointer-events-none font-mono text-[8px]"
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
            className="fill-muted-foreground pointer-events-none font-mono text-[8px]"
          >
            {col}
          </text>
        ))}
    </g>
  );
}

/** Highlights the hovered hole AND its whole strip — the thing you must see. */
function HoleCursor({ spec, hole }: { spec: BreadboardSpec; hole: HoleRef }) {
  const value = useEndpointValue(holeEnd(hole));
  const p = holePoint(hole);
  const strip = stripOf(spec, hole);

  // Every hole on the same strip is the SAME NET. Showing that on hover is the
  // single most useful thing this view can do — it is exactly the fact people get
  // wrong when they wire a real board.
  const mates: HoleRef[] = [];
  if (isRail(hole.row)) {
    for (let c = 1; c <= spec.columns; c++) {
      const other = { col: c, row: hole.row };
      if (stripOf(spec, other) === strip) mates.push(other);
    }
  } else {
    for (const row of ALL_ROWS) {
      const other = { col: hole.col, row };
      if (stripOf(spec, other) === strip) mates.push(other);
    }
  }

  return (
    <g className="pointer-events-none">
      {mates.map((m) => {
        const q = holePoint(m);
        return (
          <circle
            key={`${m.col}${m.row}`}
            cx={q.x}
            cy={q.y}
            r={5}
            style={{ fill: logicColor(value) }}
            opacity={0.28}
          />
        );
      })}
      <circle
        cx={p.x}
        cy={p.y}
        r={6}
        fill="none"
        style={{ stroke: logicColor(value) }}
        strokeWidth={2}
      />
      <text
        x={p.x}
        y={p.y - 10}
        textAnchor="middle"
        className="fill-foreground font-mono text-[9px]"
      >
        {hole.col}
        {hole.row} · {LOGIC_NAMES[value as Logic]}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function SeatedPart({
  node,
  spec,
  onToggle,
}: {
  node: CircuitNode;
  spec: BreadboardSpec;
  onToggle: () => void;
}) {
  if (node.kind === "ic") return <SeatedIc node={node} />;
  if (!node.boardRow) return null;

  const hole = { col: Math.round(node.pos.x), row: node.boardRow };
  if (hole.col < 1 || hole.col > spec.columns) return null;

  if (node.kind === "switch") {
    return <SeatedSwitch node={node} hole={hole} onToggle={onToggle} />;
  }
  if (node.kind === "led") return <SeatedLed node={node} hole={hole} />;
  if (node.kind === "rail") return <SeatedRail node={node} hole={hole} />;
  return null; // a bare gate primitive has no physical package to seat
}

function SeatedIc({ node }: { node: Extract<CircuitNode, { kind: "ic" }> }) {
  const def = getIc(node.part);
  if (!def) return null;

  const holes = dipHoles({ col: Math.round(node.pos.x) }, def.pins.length);
  const first = holes[0];
  const last = holes[6];
  if (!first || !last) return null;

  const a = holePoint(first);
  const b = holePoint(last);
  // The body spans the channel, from row F's holes down to row E's.
  const top = holePoint({ col: first.col, row: "F" }).y;
  const bottom = a.y;

  return (
    <g className="pointer-events-none">
      <rect
        x={a.x - PITCH / 2 + 2}
        y={top - 3}
        width={b.x - a.x + PITCH - 4}
        height={bottom - top + 6}
        rx={3}
        className="fill-foreground/85 stroke-background"
        strokeWidth={0.5}
      />
      {/* The pin-1 notch. */}
      <circle cx={a.x} cy={(top + bottom) / 2} r={3} className="fill-background/40" />
      <text
        x={(a.x + b.x) / 2}
        y={(top + bottom) / 2 + 4}
        textAnchor="middle"
        className="fill-background font-mono text-[11px] font-semibold"
      >
        {node.part} · {node.label}
      </text>

      {/* The legs, coloured by the value on the strip each one is plugged into. */}
      {holes.map((hole, i) => (
        <IcLeg key={i} hole={hole} />
      ))}
    </g>
  );
}

function IcLeg({ hole }: { hole: HoleRef }) {
  const value = useEndpointValue(holeEnd(hole));
  const p = holePoint(hole);
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
        y={p.y + 20}
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
        y={p.y - 12}
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

/** A jumper wire between two holes. Drawn with a slight sag, like a real one. */
function Jumper({ wire }: { wire: Wire }) {
  const deleteWire = useCircuitStore((s) => s.deleteWire);
  const value = useEndpointValue(wire.a);

  if (wire.a.kind !== "hole" || wire.b.kind !== "hole") return null;

  const a = holePoint(wire.a.ref);
  const b = holePoint(wire.b.ref);
  const color = logicColor(value);

  // A real jumper arcs. The sag also separates parallel runs, which a straight
  // line would stack on top of each other illegibly.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sag = Math.min(28, Math.hypot(dx, dy) * 0.18);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + sag;
  const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;

  return (
    <g className="group">
      {value === 1 && (
        <path d={d} fill="none" stroke={color} strokeWidth={7} opacity={0.22} />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
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
        <title>Click to remove this jumper</title>
      </path>
      {/* The plugged ends. */}
      {[a, b].map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}
    </g>
  );
}
