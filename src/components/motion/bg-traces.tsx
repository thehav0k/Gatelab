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
      className={`bg-trace fixed inset-0 -z-10 h-full w-full pointer-events-none opacity-40 dark:opacity-30 select-none ${
        paused ? "traces-paused" : ""
      }`}
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1440 900"
    >
      {[
        { d: "M 0 180 H 280 V 320 H 640", dur: "16s", delay: "0s" },
        { d: "M 1440 520 H 1100 V 400 H 820", dur: "18s", delay: "-5s" },
        { d: "M 260 900 V 740 H 480 V 600", dur: "20s", delay: "-10s" },
        { d: "M 0 720 H 160 V 800 H 380", dur: "17s", delay: "-8s" },
        { d: "M 1440 220 H 1240 V 360 H 980", dur: "19s", delay: "-3s" },
      ].map((trace, i) => (
        <g key={i}>
          <path d={trace.d} fill="none" stroke="var(--border)" strokeWidth="1" />
          <path
            d={trace.d}
            fill="none"
            stroke="var(--logic-high)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="8 60"
            className="circuit-trace-pulse"
            style={{
              animation: `trace-flow ${trace.dur} linear infinite`,
              animationDelay: trace.delay,
              animationPlayState: paused ? "paused" : "running",
            }}
          />
        </g>
      ))}
    </svg>
  );
}
