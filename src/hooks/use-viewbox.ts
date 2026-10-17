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

/** Convert client coordinates directly into SVG viewBox coordinates using inverse CTM. */
export function clientToSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const res = pt.matrixTransform(ctm.inverse());
    return { x: res.x, y: res.y };
  }
  const r = svg.getBoundingClientRect();
  return {
    x: clientX - r.left,
    y: clientY - r.top,
  };
}

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
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const res = pt.matrixTransform(ctm.inverse());
        return { x: res.x, y: res.y };
      }
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
  const velocity = useRef<{ vx: number; vy: number; lastTime: number; lastX: number; lastY: number }>({
    vx: 0,
    vy: 0,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
  });
  const inertiaRaf = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (inertiaRaf.current) cancelAnimationFrame(inertiaRaf.current);
    };
  }, []);

  const startPan = useCallback(
    (clientX: number, clientY: number) => {
      if (inertiaRaf.current) {
        cancelAnimationFrame(inertiaRaf.current);
        inertiaRaf.current = null;
      }
      velocity.current = { vx: 0, vy: 0, lastTime: performance.now(), lastX: clientX, lastY: clientY };
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

      // Track pan velocity for inertia
      const now = performance.now();
      const dt = Math.max(1, now - velocity.current.lastTime);
      const moveDx = ((clientX - velocity.current.lastX) / r.width) * p.from.w;
      const moveDy = ((clientY - velocity.current.lastY) / r.height) * p.from.h;
      velocity.current = {
        vx: (moveDx / dt) * 16.67,
        vy: (moveDy / dt) * 16.67,
        lastTime: now,
        lastX: clientX,
        lastY: clientY,
      };

      touched.current = true;
      setView({ ...p.from, x: p.from.x - dx, y: p.from.y - dy });
      return true;
    },
    [svgRef],
  );

  const endPan = useCallback((): boolean => {
    const was = pan.current !== null;
    pan.current = null;

    if (
      was &&
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      let vx = velocity.current.vx;
      let vy = velocity.current.vy;
      if (Math.hypot(vx, vy) > 0.5) {
        const step = () => {
          vx *= 0.92;
          vy *= 0.92;
          if (Math.hypot(vx, vy) < 0.05) return;
          setView((v) => ({ ...v, x: v.x - vx, y: v.y - vy }));
          inertiaRaf.current = requestAnimationFrame(step);
        };
        inertiaRaf.current = requestAnimationFrame(step);
      }
    }
    return was;
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const current = nw / view.w;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor));
      if (next === current) return;

      const w = nw / next;
      const h = nh / next;
      const cx = view.x + view.w / 2;
      const cy = view.y + view.h / 2;

      touched.current = true;
      setView({ x: cx - w / 2, y: cy - h / 2, w, h });
    },
    [nw, nh, view, svgRef],
  );

  const zoomIn = useCallback(() => zoomBy(1.25), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.25), [zoomBy]);

  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartView = useRef<ViewBox | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.current.size === 2) {
        const pts = Array.from(activePointers.current.values());
        pinchStartDist.current = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        pinchStartView.current = { ...view };
      }
    },
    [view],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent): boolean => {
      if (!activePointers.current.has(e.pointerId)) return false;
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.current.size === 2 && pinchStartDist.current && pinchStartView.current) {
        const pts = Array.from(activePointers.current.values());
        const currentDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (currentDist > 0 && pinchStartDist.current > 0) {
          const ratio = currentDist / pinchStartDist.current;
          const currentZoom = nw / pinchStartView.current.w;
          const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom * ratio));
          const w = nw / nextZoom;
          const h = nh / nextZoom;
          const cx = (pts[0]!.x + pts[1]!.x) / 2;
          const cy = (pts[0]!.y + pts[1]!.y) / 2;
          const p = toView(cx, cy);
          const svg = svgRef.current;
          if (svg) {
            const r = svg.getBoundingClientRect();
            const fx = (cx - r.left) / r.width;
            const fy = (cy - r.top) / r.height;
            touched.current = true;
            setView({ x: p.x - fx * w, y: p.y - fy * h, w, h });
            return true;
          }
        }
      }
      return false;
    },
    [nw, nh, toView, svgRef],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchStartDist.current = null;
      pinchStartView.current = null;
    }
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
    zoomIn,
    zoomOut,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isPanning: () => pan.current !== null,
  };
}
