"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pan and zoom for an SVG canvas, driven by the viewBox.
 *
 * The viewBox is the right lever, because it is a CAMERA: nothing in the document
 * moves, and no coordinate anywhere else has to know about it. Panning by
 * transforming a root <g> instead would mean every hit-test, every pin position
 * and every router cell had to compensate for the transform.
 *
 * Zoom is anchored on the cursor — you zoom into the thing you are pointing at,
 * not into the middle of the frame.
 */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

/**
 * The caller owns the ref and passes it in, rather than the hook handing one back.
 * Returning a ref object from a hook and then spreading it onto `ref=` reads, to
 * the React lint rules, like touching a ref during render — and the rule is right
 * to be suspicious, so we simply do not do it.
 */
export function useViewBox(
  natural: ViewBox,
  svgRef: React.RefObject<SVGSVGElement | null>,
) {
  const [view, setView] = useState<ViewBox>(natural);

  const { x: nx, y: ny, w: nw, h: nh } = natural;

  /**
   * Re-frame when the content's natural size changes (a chip added, a board
   * seated) — but only while the user has not taken manual control. Snapping the
   * camera back under someone who deliberately zoomed in is infuriating.
   *
   * Depending on the four scalars rather than the object avoids re-firing on every
   * render just because the caller built a fresh literal.
   */
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setView({ x: nx, y: ny, w: nw, h: nh });
  }, [nx, ny, nw, nh]);

  const reset = useCallback(() => {
    touched.current = false;
    setView({ x: nx, y: ny, w: nw, h: nh });
  }, [nx, ny, nw, nh]);

  /** A client point, in current view coordinates. */
  const toView = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const r = svg.getBoundingClientRect();
      return {
        x: view.x + ((clientX - r.left) / r.width) * view.w,
        y: view.y + ((clientY - r.top) / r.height) * view.h,
      };
    },
    [view, svgRef],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const svg = svgRef.current;
      if (!svg) return;

      const current = nw / view.w;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, current * Math.exp(-e.deltaY * 0.0015)),
      );
      if (next === current) return;

      const w = nw / next;
      const h = nh / next;

      // Anchor on the cursor: the point under the pointer must not move.
      const p = toView(e.clientX, e.clientY);
      const r = svg.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;

      touched.current = true;
      setView({ x: p.x - fx * w, y: p.y - fy * h, w, h });
    },
    [view, toView, nw, nh, svgRef],
  );

  const pan = useRef<{ x: number; y: number; from: ViewBox } | null>(null);

  const startPan = useCallback(
    (clientX: number, clientY: number) => {
      pan.current = { x: clientX, y: clientY, from: { ...view } };
    },
    [view],
  );

  const movePan = useCallback(
    (clientX: number, clientY: number): boolean => {
      const p = pan.current;
      const svg = svgRef.current;
      if (!p || !svg) return false;

      const r = svg.getBoundingClientRect();
      const dx = ((clientX - p.x) / r.width) * p.from.w;
      const dy = ((clientY - p.y) / r.height) * p.from.h;

      touched.current = true;
      setView({ ...p.from, x: p.from.x - dx, y: p.from.y - dy });
      return true;
    },
    [svgRef],
  );

  const endPan = useCallback((): boolean => {
    const was = pan.current !== null;
    pan.current = null;
    return was;
  }, []);

  return {
    viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
    zoom: nw / view.w,
    reset,
    toView,
    onWheel,
    startPan,
    movePan,
    endPan,
    isPanning: () => pan.current !== null,
  };
}
