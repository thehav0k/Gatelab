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
  const aura = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cursorEnabled) {
      document.documentElement.classList.add("has-custom-cursor");
    } else {
      document.documentElement.classList.remove("has-custom-cursor");
    }

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const ringPos = { x: target.x, y: target.y };
    const vel = { x: 0, y: 0 };
    let raf = 0;
    let mode: Mode = "default";

    const updateCoordinates = (x: number, y: number) => {
      target.x = x;
      target.y = y;
      document.documentElement.style.setProperty("--cursor-x", `${x}px`);
      document.documentElement.style.setProperty("--cursor-y", `${y}px`);
    };

    const nextMode = (m: Mode) => {
      if (m !== mode) {
        mode = m;
        if (ring.current) ring.current.dataset.mode = mode;
        if (dot.current) {
          dot.current.style.opacity = mode === "hidden" ? "0" : "1";
        }
        if (aura.current) {
          aura.current.style.opacity = mode === "hidden" ? "0" : "1";
        }
      }
    };

    const onPointerMove = (e: PointerEvent | MouseEvent) => {
      updateCoordinates(e.clientX, e.clientY);

      if (!cursorEnabled) return;

      const el = (e.target as Element | null)?.closest?.(
        "[data-cursor], a, button, [role=button], input, textarea, select, [data-native-cursor], .builder-canvas, .diagram-viewport",
      ) as HTMLElement | null;

      if (el?.closest("[data-native-cursor], .builder-canvas, .diagram-viewport")) {
        nextMode("hidden");
        return;
      }

      const next: Mode = !el
        ? "default"
        : el.dataset.cursor
          ? (el.dataset.cursor as Mode)
          : el.matches("input, textarea")
            ? "text"
            : "link";
      nextMode(next);
    };

    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      updateCoordinates(e.clientX, e.clientY);
      if (cursorEnabled && ring.current) {
        ring.current.dataset.pressed = "1";
      }
      spawnRipple(e.clientX, e.clientY);
    };

    const onPointerUp = () => {
      if (ring.current) delete ring.current.dataset.pressed;
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        updateCoordinates(touch.clientX, touch.clientY);
        spawnRipple(touch.clientX, touch.clientY);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        updateCoordinates(touch.clientX, touch.clientY);
      }
    };

    const onLeave = () => {
      if (ring.current) ring.current.dataset.mode = "hidden";
      if (dot.current) dot.current.style.opacity = "0";
      if (aura.current) aura.current.style.opacity = "0";
    };

    const onEnter = () => {
      if (ring.current) ring.current.dataset.mode = mode;
      if (dot.current) dot.current.style.opacity = mode === "hidden" ? "0" : "1";
      if (aura.current) aura.current.style.opacity = mode === "hidden" ? "0" : "1";
    };

    const tick = () => {
      if (!cursorEnabled) return;

      vel.x = (vel.x + (target.x - ringPos.x) * 0.14) * 0.78;
      vel.y = (vel.y + (target.y - ringPos.y) * 0.14) * 0.78;
      ringPos.x += vel.x;
      ringPos.y += vel.y;

      const speed = Math.min(Math.hypot(vel.x, vel.y) / 40, 0.25);
      const angle = Math.atan2(vel.y, vel.x);

      if (dot.current) {
        dot.current.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
      }
      if (aura.current) {
        aura.current.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
      }
      if (ring.current) {
        ring.current.style.transform = `translate3d(${ringPos.x}px,${ringPos.y}px,0) translate(-50%,-50%) rotate(${angle}rad) scale(${1 + speed},${1 - speed * 0.6})`;
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("mousemove", onPointerMove, { passive: true });
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
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mousemove", onPointerMove);
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
      <div ref={aura} className="cursor-aura" />
      <div ref={ring} data-mode="default" className="cursor-ring" />
      <div ref={dot} className="cursor-dot" />
    </div>
  );
}
