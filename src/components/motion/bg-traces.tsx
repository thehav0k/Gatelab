"use client";

import { useEffect, useState } from "react";

export function BgTraces() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => {
      setPaused(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return (
    <svg
      className="bg-trace fixed inset-0 -z-10 h-full w-full pointer-events-none opacity-60"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
    >
      {[
        "M0 180H260V300H540",
        "M1200 520H900V420H700",
        "M300 800V640H460V560",
        "M0 660H140V740H360",
      ].map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke="var(--border)" strokeWidth="1" />
          <path
            d={d}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="6 42"
            style={{
              animation: `trace-flow ${6 + i * 1.5}s linear infinite`,
              animationDelay: `${i * -1.2}s`,
              animationPlayState: paused ? "paused" : "running",
            }}
          />
        </g>
      ))}
    </svg>
  );
}
