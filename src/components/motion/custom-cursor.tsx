"use client";

import { useEffect, useRef } from "react";

type Mode = "default" | "link" | "drag" | "text" | "hidden";

export function CustomCursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine) and (hover: hover)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;

    document.documentElement.classList.add("has-custom-cursor");

    const target = { x: innerWidth / 2, y: innerHeight / 2 };
    const ringPos = { x: target.x, y: target.y };
    const vel = { x: 0, y: 0 };
    let raf = 0;
    let mode: Mode = "default";

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      // Background glow follows pointer (read by CSS)
      document.documentElement.style.setProperty("--cursor-x", `${e.clientX}px`);
      document.documentElement.style.setProperty("--cursor-y", `${e.clientY}px`);
      const el = (e.target as Element | null)?.closest?.(
        "[data-cursor], a, button, [role=button], input, textarea, select, [data-native-cursor]",
      ) as HTMLElement | null;

      if (el?.closest("[data-native-cursor]")) {
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

    const nextMode = (m: Mode) => {
      if (m !== mode) {
        mode = m;
        if (ring.current) ring.current.dataset.mode = mode;
        if (dot.current) {
          dot.current.style.opacity = mode === "hidden" ? "0" : "1";
        }
      }
    };

    const onDown = (e: PointerEvent) => {
      if (ring.current) ring.current.dataset.pressed = "1";
      spawnRipple(e.clientX, e.clientY);
    };

    const onUp = () => {
      if (ring.current) delete ring.current.dataset.pressed;
    };

    const onLeave = () => {
      if (ring.current) ring.current.dataset.mode = "hidden";
      if (dot.current) dot.current.style.opacity = "0";
    };

    const onEnter = () => {
      if (ring.current) ring.current.dataset.mode = mode;
      if (dot.current) dot.current.style.opacity = mode === "hidden" ? "0" : "1";
    };

    const tick = () => {
      // critically-damped spring (stiffness 0.14, damping 0.78) — smooth, no overshoot
      vel.x = (vel.x + (target.x - ringPos.x) * 0.14) * 0.78;
      vel.y = (vel.y + (target.y - ringPos.y) * 0.14) * 0.78;
      ringPos.x += vel.x;
      ringPos.y += vel.y;

      // squash/stretch along velocity (clamped), tiny and tasteful
      const speed = Math.min(Math.hypot(vel.x, vel.y) / 40, 0.25);
      const angle = Math.atan2(vel.y, vel.x);

      if (dot.current) {
        dot.current.style.transform = `translate3d(${target.x}px,${target.y}px,0) translate(-50%,-50%)`;
      }
      if (ring.current) {
        ring.current.style.transform = `translate3d(${ringPos.x}px,${ringPos.y}px,0) translate(-50%,-50%) rotate(${angle}rad) scale(${1 + speed},${1 - speed * 0.6})`;
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.documentElement.addEventListener("pointerenter", onEnter);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("has-custom-cursor");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.documentElement.removeEventListener("pointerenter", onEnter);
    };
  }, []);

  return (
    <div className="cursor-layer pointer-events-none fixed inset-0 z-[9999]" aria-hidden>
      <div ref={ring} data-mode="default" className="cursor-ring" />
      <div ref={dot} className="cursor-dot" />
    </div>
  );
}

function spawnRipple(x: number, y: number) {
  const r = document.createElement("span");
  r.className = "click-ripple";
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  document.body.appendChild(r);
  r.addEventListener("animationend", () => r.remove(), { once: true });
}
