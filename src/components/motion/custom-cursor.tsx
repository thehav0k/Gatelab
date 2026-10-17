"use client";

import { useEffect, useRef } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";

type Mode = "default" | "link" | "drag" | "text" | "hidden";

let lastRippleTime = 0;
let lastRipplePos = { x: 0, y: 0 };

function spawnRipple(x: number, y: number) {
  const now = performance.now();
  if (now - lastRippleTime < 80 && Math.hypot(x - lastRipplePos.x, y - lastRipplePos.y) < 15) {
    return;
  }
  lastRippleTime = now;
  lastRipplePos = { x, y };

  const r = document.createElement("span");
  r.className = "click-ripple";
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  document.body.appendChild(r);
  r.addEventListener("animationend", () => r.remove(), { once: true });
}

export function CustomCursor() {
  const isFine = useMediaQuery("(pointer: fine) and (hover: hover)");
  const prefersReduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const cursorEnabled = isFine && !prefersReduced;

  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cursorEnabled) {
      document.documentElement.classList.add("has-custom-cursor");
    } else {
      document.documentElement.classList.remove("has-custom-cursor");
      document.documentElement.classList.remove("over-canvas");
    }

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const ringPos = { x: target.x, y: target.y };
    const vel = { x: 0, y: 0 };
    let raf = 0;
    let mode: Mode = "default";

    const nextMode = (m: Mode) => {
      if (m !== mode) {
        mode = m;
        if (ring.current) ring.current.dataset.mode = mode;
        if (dot.current) {
          dot.current.style.opacity = mode === "hidden" ? "0" : "1";
        }
      }
    };

    const isCanvasElement = (el: Element | null): boolean => {
      if (!el) return false;
      return Boolean(
        el.closest(
          "[data-native-cursor], .builder-canvas, .diagram-viewport, .diagram-figure, svg.bg-card",
        ),
      );
    };

    const onPointerMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;

      if (!cursorEnabled) return;

      const targetEl = e.target as Element | null;
      if (isCanvasElement(targetEl)) {
        document.documentElement.classList.add("over-canvas");
        nextMode("hidden");
        return;
      }

      document.documentElement.classList.remove("over-canvas");

      const el = targetEl?.closest(
        "[data-cursor], a, button, [role=button], input, textarea, select, label",
      ) as HTMLElement | null;

      const next: Mode = !el
        ? "default"
        : el.dataset.cursor
          ? (el.dataset.cursor as Mode)
          : el.matches("input, textarea")
            ? "text"
            : "link";
      nextMode(next);
    };

    const onPointerDown = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      const targetEl = e.target as Element | null;
      const onCanvas = isCanvasElement(targetEl);

      if (cursorEnabled && ring.current && !onCanvas) {
        ring.current.dataset.pressed = "1";
      }
      if (!onCanvas) {
        spawnRipple(e.clientX, e.clientY);
      }
    };

    const onPointerUp = () => {
      if (ring.current) delete ring.current.dataset.pressed;
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        target.x = touch.clientX;
        target.y = touch.clientY;
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!isCanvasElement(targetEl)) {
          spawnRipple(touch.clientX, touch.clientY);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        target.x = touch.clientX;
        target.y = touch.clientY;
      }
    };

    const onLeave = () => {
      document.documentElement.classList.remove("over-canvas");
      if (ring.current) ring.current.dataset.mode = "hidden";
      if (dot.current) dot.current.style.opacity = "0";
    };

    const onEnter = () => {
      if (ring.current) ring.current.dataset.mode = mode;
      if (dot.current) dot.current.style.opacity = mode === "hidden" ? "0" : "1";
    };

    const tick = () => {
      if (!cursorEnabled) return;

      vel.x = (vel.x + (target.x - ringPos.x) * 0.18) * 0.72;
      vel.y = (vel.y + (target.y - ringPos.y) * 0.18) * 0.72;
      ringPos.x += vel.x;
      ringPos.y += vel.y;

      const speed = Math.min(Math.hypot(vel.x, vel.y) / 36, 0.22);
      const angle = Math.atan2(vel.y, vel.x);

      if (dot.current) {
        dot.current.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
      }
      if (ring.current) {
        ring.current.style.transform = `translate3d(${ringPos.x}px,${ringPos.y}px,0) translate(-50%,-50%) rotate(${angle}rad) scale(${1 + speed},${1 - speed * 0.6})`;
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.documentElement.addEventListener("pointerenter", onEnter);

    if (cursorEnabled) {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.documentElement.classList.remove("has-custom-cursor");
      document.documentElement.classList.remove("over-canvas");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.documentElement.removeEventListener("pointerenter", onEnter);
    };
  }, [cursorEnabled]);

  if (!cursorEnabled) {
    return null;
  }

  return (
    <div className="cursor-layer pointer-events-none fixed inset-0 z-[9999]" aria-hidden>
      <div ref={ring} data-mode="default" className="cursor-ring" />
      <div ref={dot} className="cursor-dot" />
    </div>
  );
}
