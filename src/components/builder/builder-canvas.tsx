"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { placeDocument, blockAt, blocksIn, linkAt, portAt } from "@/lib/diagram/editor/place";
import { alignNudge } from "@/lib/diagram/editor/align";
import {
  addFromPalette,
  connect,
  dragInstances,
  offsetInstances,
  removeSelection,
} from "@/lib/diagram/editor/ops";
import type { PlacedDiagram, Point } from "@/lib/diagram/layout";
import { renderSvg } from "@/lib/diagram/svg";
import type { DiagramTheme } from "@/lib/diagram/theme";
import type { EditorDocument } from "@/lib/diagram/editor/document";
import { NODE_SIZE } from "@/lib/diagram/measure";
import type { Endpoint } from "@/lib/diagram/types";
import { useBuilderStore } from "@/stores/builder-store";
import { cn } from "@/lib/utils";

/**
 * The canvas.
 *
 * TWO LAYERS, ONE RENDERER. The picture is the SAME SVG string the exporter
 * writes, injected underneath; on top sits a transparent SVG that does nothing
 * but catch pointers and draw selection handles. So there is still exactly one
 * piece of code that knows how a decoder is drawn, and the thing you are
 * dragging is the thing that comes out of the file — which is the property the
 * whole diagram module is built around.
 *
 * The alternative — a React tree of `<rect>`s and `<path>`s for the editor, and
 * a serializer for the export — is two renderers, and two renderers drift.
 *
 * Both layers use the placement's own coordinate system (see `frame: "canvas"`
 * in `svg.ts`), so a hit test is a comparison against the same numbers that were
 * drawn. Any offset between the two would mean clicking a pin an inch from where
 * it appears, and the bug would be invisible until somebody tried to wire
 * something up.
 */

interface Transform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; from: Point; start: Transform }
  /**
   * A drag remembers where the blocks WERE, not where they were last frame.
   * See `dragInstances` — an incremental delta plus a grid snap is what makes a
   * block stick and then jump instead of following the pointer.
   */
  | {
      kind: "drag";
      from: Point;
      origins: ReadonlyMap<string, { x: number; y: number }>;
    }
  | { kind: "marquee"; from: Point; to: Point }
  | { kind: "wire"; from: Endpoint; at: Point; start: Point };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

/**
 * How far the pointer must travel before a press on a pin counts as drawing a
 * wire rather than clicking the thing.
 *
 * Without it there is no way to select a junction: its pin is at its centre, so
 * every press on one starts a wire and a wire is what you get on release.
 */
const WIRE_THRESHOLD = 6;

/** Background and grid for the workspace, kept in step with pan and zoom. */
function sheetStyle(theme: DiagramTheme, view: Transform): React.CSSProperties {
  const base: React.CSSProperties =
    theme.background === "none" ? {} : { backgroundColor: theme.background };
  if (theme.grid === "none") return base;

  const size = theme.gridSize * view.z;
  const dots = theme.grid === "dots";
  return {
    ...base,
    backgroundImage: dots
      ? `radial-gradient(circle at 1px 1px, ${theme.gridColor} 1.2px, transparent 0)`
      : `linear-gradient(to right, ${theme.gridColor} 1px, transparent 1px),
         linear-gradient(to bottom, ${theme.gridColor} 1px, transparent 1px)`,
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };
}

export function BuilderCanvas({
  theme,
  className,
}: {
  theme: DiagramTheme;
  className?: string;
}) {
  const doc = useBuilderStore((s) => s.doc);
  const selection = useBuilderStore((s) => s.selection);
  const selectedLink = useBuilderStore((s) => s.selectedLink);
  const commit = useBuilderStore((s) => s.commit);
  const setDoc = useBuilderStore((s) => s.set);
  const beginStep = useBuilderStore((s) => s.beginStep);
  const select = useBuilderStore((s) => s.select);
  const selectLink = useBuilderStore((s) => s.selectLink);
  const clearSelection = useBuilderStore((s) => s.clearSelection);

  const placed = useMemo(() => placeDocument(doc, theme), [doc, theme]);
  const svg = useMemo(
    () => renderSvg(placed, theme, { frame: "canvas" }),
    [placed, theme],
  );

  const [view, setView] = useState<Transform>({ x: 24, y: 24, z: 1 });
  const [gesture, setGesture] = useState<Gesture>({ kind: "none" });
  const [hoverPort, setHoverPort] = useState<Endpoint | null>(null);
  const host = useRef<HTMLDivElement | null>(null);

  /** A client point in document coordinates. */
  const toDoc = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = host.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - view.x) / view.z,
        y: (clientY - rect.top - view.y) / view.z,
      };
    },
    [view],
  );

  // --- dropping a part from the palette -------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const partId = e.dataTransfer.getData("application/gatelab-part");
    if (!partId) return;
    const at = toDoc(e.clientX, e.clientY);
    const added = addFromPalette(doc, partId, at.x - 40, at.y - 24);
    if (!added) {
      toast.error("That part is not in the palette any more.");
      return;
    }
    commit(added.doc);
    select([added.id]);
  };

  // --- pointer ---------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.altKey) {
      setGesture({ kind: "pan", from: { x: e.clientX, y: e.clientY }, start: view });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const at = toDoc(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);

    // Pins win over bodies: a pin sits ON the border, so whichever is tested
    // first is the one you can never click.
    //
    // Except on a junction, whose pin IS its body — there is nowhere else to
    // press. So a junction you have already selected is dragged, and one you
    // have not is wired from; a press that never moves selects it either way.
    const port = portAt(placed, at, 10 / view.z);
    if (port && !(isJunction(placed, port.block) && selection.includes(port.block))) {
      setGesture({ kind: "wire", from: port, at, start: at });
      return;
    }

    const block = port?.block ?? blockAt(placed, at);
    if (block) {
      const next = e.shiftKey
        ? selection.includes(block)
          ? selection.filter((id) => id !== block)
          : [...selection, block]
        : selection.includes(block)
          ? selection
          : [block];
      select(next);
      beginStep();
      setGesture({ kind: "drag", from: at, origins: originsOf(doc, next) });
      return;
    }

    const link = linkAt(placed, at, 7 / view.z);
    if (link) {
      selectLink(link);
      setGesture({ kind: "none" });
      return;
    }

    if (!e.shiftKey) clearSelection();
    setGesture({ kind: "marquee", from: at, to: at });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const at = toDoc(e.clientX, e.clientY);

    if (gesture.kind === "none") {
      setHoverPort(portAt(placed, at, 10 / view.z));
      return;
    }
    if (gesture.kind === "pan") {
      setView({
        ...gesture.start,
        x: gesture.start.x + (e.clientX - gesture.from.x),
        y: gesture.start.y + (e.clientY - gesture.from.y),
      });
      return;
    }
    if (gesture.kind === "drag") {
      // Absolute, from the positions captured on pointer-down. Anything
      // incremental fights the grid snap.
      const free = e.metaKey || e.ctrlKey;
      let next = dragInstances(
        doc,
        gesture.origins,
        at.x - gesture.from.x,
        at.y - gesture.from.y,
        free,
      );
      if (!free) {
        const ids = [...gesture.origins.keys()];
        const nudge = alignNudge(next, ids, theme);
        next = offsetInstances(next, ids, nudge.dx, nudge.dy);
      }
      // `set`, not `commit`: the step was pushed on pointer-down, so the whole
      // drag collapses into one undo.
      setDoc(next);
      return;
    }
    if (gesture.kind === "marquee") {
      setGesture({ ...gesture, to: at });
      return;
    }
    if (gesture.kind === "wire") {
      setHoverPort(portAt(placed, at, 12 / view.z));
      setGesture({ ...gesture, at });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const at = toDoc(e.clientX, e.clientY);

    if (gesture.kind === "marquee") {
      const inside = blocksIn(placed, {
        x0: gesture.from.x,
        y0: gesture.from.y,
        x1: gesture.to.x,
        y1: gesture.to.y,
      });
      // A marquee that never moved is a click on empty space, not a selection.
      const moved =
        Math.abs(gesture.to.x - gesture.from.x) > 3 ||
        Math.abs(gesture.to.y - gesture.from.y) > 3;
      if (moved) select(e.shiftKey ? [...new Set([...selection, ...inside])] : inside);
    }

    if (gesture.kind === "wire") {
      const moved =
        Math.hypot(at.x - gesture.start.x, at.y - gesture.start.y) * view.z >=
        WIRE_THRESHOLD;
      const target = moved ? portAt(placed, at, 14 / view.z) : null;
      if (target) {
        const result = connect(doc, gesture.from, target);
        if (result.ok) {
          commit(result.doc);
        } else {
          toast.error(result.reason);
        }
      } else if (moved) {
        // Let go over empty space and you get a junction there, wired up.
        //
        // This is what makes two arbitrary POINTS joinable. A wire in this
        // model runs pin to pin, so "somewhere on the sheet" had no
        // representation at all — until it became a block with one pin, which
        // is what a junction dot has always been on paper.
        dropJunction(at);
      } else {
        select([gesture.from.block]);
      }
    }

    setGesture({ kind: "none" });
    setHoverPort(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = host.current?.getBoundingClientRect();
      if (!rect) return;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, view.z * Math.exp(-e.deltaY * 0.002)),
      );
      // Anchor on the pointer: the point under the cursor must not move.
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView({
        z: next,
        x: cx - ((cx - view.x) / view.z) * next,
        y: cy - ((cy - view.y) / view.z) * next,
      });
      return;
    }
    setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  /** Put a junction under the pointer and wire the dangling end to it. */
  const dropJunction = (at: Point) => {
    if (gesture.kind !== "wire") return;
    const added = addFromPalette(doc, "node", at.x - NODE_SIZE / 2, at.y - NODE_SIZE / 2);
    if (!added) return;
    const result = connect(added.doc, gesture.from, { block: added.id, port: "P" });
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    commit(result.doc);
    select([added.id]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setGesture({ kind: "none" });
      clearSelection();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selection.length === 0 && !selectedLink) return;
      e.preventDefault();
      commit(removeSelection(doc, selection, selectedLink ? [selectedLink] : []));
      clearSelection();
    }
  };

  const fit = () => setView({ x: 24, y: 24, z: 1 });

  return (
    <div
      ref={host}
      tabIndex={0}
      role="application"
      aria-label="Circuit canvas"
      className={cn(
        "builder-canvas relative overflow-hidden outline-none",
        theme.background === "none" && "bg-muted/20",
        gesture.kind === "pan" ? "cursor-grabbing" : "cursor-default",
        className,
      )}
      // The workspace IS the paper: it carries the diagram theme's own
      // background and grid, so what you are drawing on is what you will export
      // onto, and panning does not slide a small white page around underneath
      // the blocks.
      style={sheetStyle(theme, view)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDoubleClick={fit}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          width: placed.width,
          height: placed.height,
        }}
      >
        {/* The drawing — the exporter's own bytes. */}
        <div
          className="builder-sheet absolute inset-0"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <Overlay
          placed={placed}
          selection={selection}
          selectedLink={selectedLink}
          gesture={gesture}
          hoverPort={hoverPort}
        />
      </div>

      {Object.keys(doc.instances).length === 0 && <EmptyHint />}

      <div className="text-muted-foreground pointer-events-none absolute right-2 bottom-2 rounded bg-background/70 px-2 py-1 font-mono text-[10px] backdrop-blur">
        {Math.round(view.z * 100)}%
      </div>
    </div>
  );
}

// --- the interaction layer --------------------------------------------------

function Overlay({
  placed,
  selection,
  selectedLink,
  gesture,
  hoverPort,
}: {
  placed: PlacedDiagram;
  selection: readonly string[];
  selectedLink: string | null;
  gesture: Gesture;
  hoverPort: Endpoint | null;
}) {
  const selected = new Set(selection);
  const wireFrom =
    gesture.kind === "wire"
      ? placed.blocks
          .find((b) => b.block.id === gesture.from.block)
          ?.ports.get(gesture.from.port)
      : undefined;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={placed.width}
      height={placed.height}
      viewBox={`0 0 ${placed.width} ${placed.height}`}
    >
      {/* Every pin gets a target. Without them, wiring is a guessing game about
          exactly where a pin ends. */}
      {placed.blocks.map((b) =>
        [...b.ports].map(([id, p]) => {
          const hot = hoverPort?.block === b.block.id && hoverPort.port === id;
          return (
            <circle
              key={`${b.block.id}.${id}`}
              cx={p.ax}
              cy={p.ay}
              r={hot ? 5 : 2.5}
              className={cn(
                "transition-[r]",
                hot ? "fill-logic-high" : "fill-muted-foreground/50",
              )}
            />
          );
        }),
      )}

      {placed.links.map((l) =>
        l.link.id === selectedLink ? (
          <polyline
            key={l.link.id}
            points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
            className="stroke-logic-high"
            strokeWidth={4}
            fill="none"
            strokeOpacity={0.45}
            strokeLinejoin="round"
          />
        ) : null,
      )}

      {placed.blocks
        .filter((b) => selected.has(b.block.id))
        .map((b) => (
          <rect
            key={b.block.id}
            x={b.x - 5}
            y={b.y - 5}
            width={b.w + 10}
            height={b.h + 10}
            rx={6}
            fill="none"
            className="stroke-logic-high"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ))}

      {gesture.kind === "wire" && wireFrom && (
        <line
          x1={wireFrom.ax}
          y1={wireFrom.ay}
          x2={gesture.at.x}
          y2={gesture.at.y}
          className="stroke-logic-high"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
      )}

      {gesture.kind === "marquee" && (
        <rect
          x={Math.min(gesture.from.x, gesture.to.x)}
          y={Math.min(gesture.from.y, gesture.to.y)}
          width={Math.abs(gesture.to.x - gesture.from.x)}
          height={Math.abs(gesture.to.y - gesture.from.y)}
          className="fill-logic-high/10 stroke-logic-high"
          strokeWidth={1}
        />
      )}
    </svg>
  );
}

const isJunction = (placed: PlacedDiagram, id: string): boolean =>
  placed.blocks.find((b) => b.block.id === id)?.block.kind === "node";

const originsOf = (
  doc: EditorDocument,
  ids: readonly string[],
): Map<string, { x: number; y: number }> => {
  const out = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const instance = doc.instances[id];
    if (instance) out.set(id, { x: instance.x, y: instance.y });
  }
  return out;
};

function EmptyHint() {
  return (
    <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="max-w-sm space-y-1.5 text-center text-sm text-pretty">
        <p className="font-medium">Drag a block from the palette to start.</p>
        <p className="text-xs">
          Drag from one pin to another to wire them — or into empty space, and you
          get a junction. Press <kbd className="rounded border px-1">R</kbd> to
          rotate, arrow keys to nudge, and{" "}
          <kbd className="rounded border px-1">G</kbd> to fold a selection into one
          reusable block.
        </p>
      </div>
    </div>
  );
}
