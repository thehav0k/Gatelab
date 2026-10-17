"use client";

import { useEffect, useRef, useState } from "react";

export function HeroBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let tabHidden = document.visibilityState === "hidden";
    let offscreen = false;

    const updateState = () => {
      setPaused(tabHidden || offscreen);
    };

    const onVisibilityChange = () => {
      tabHidden = document.visibilityState === "hidden";
      updateState();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        offscreen = !entry?.isIntersecting;
        updateState();
      },
      { threshold: 0.05 },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden select-none hero-bg-layer ${
        paused ? "hero-bg-paused" : ""
      }`}
      aria-hidden="true"
    >
      {/* Soft brand-green radial glow */}
      <div className="hero-radial-glow absolute inset-0 pointer-events-none" />

      {/* Faint static dot grid */}
      <div className="hero-dot-grid absolute inset-0 pointer-events-none" />

      {/* Subtle SVG circuit traces with slow signal pulses (18s loop) */}
      <svg
        className="absolute inset-0 h-full w-full pointer-events-none opacity-40 dark:opacity-35"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 800 500"
      >
        <g>
          <path d="M 0 120 H 200 V 240 H 450" fill="none" stroke="var(--border)" strokeWidth="1" />
          <path
            d="M 0 120 H 200 V 240 H 450"
            fill="none"
            stroke="var(--logic-high)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="8 60"
            className="hero-trace-flow trace-1"
          />
        </g>
        <g>
          <path d="M 800 360 H 580 V 260 H 350" fill="none" stroke="var(--border)" strokeWidth="1" />
          <path
            d="M 800 360 H 580 V 260 H 350"
            fill="none"
            stroke="var(--logic-high)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="8 60"
            className="hero-trace-flow trace-2"
          />
        </g>
        <g>
          <path d="M 120 500 V 380 H 280 V 280" fill="none" stroke="var(--border)" strokeWidth="1" />
          <path
            d="M 120 500 V 380 H 280 V 280"
            fill="none"
            stroke="var(--logic-high)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="8 60"
            className="hero-trace-flow trace-3"
          />
        </g>
      </svg>
    </div>
  );
}
