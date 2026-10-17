"use client";

import { useEffect, useState } from "react";

interface TraceConfig {
  d: string;
  dur: string;
  delay: string;
  dashArray?: string;
  pulseWidth?: number;
}

interface ViaConfig {
  cx: number;
  cy: number;
  ping?: boolean;
  pingDelay?: string;
}

export function BgTraces() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => {
      setPaused(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Geometric, chamfered PCB digital logic buses routed across standard 1600x1000 viewport
  const TRACES: TraceConfig[] = [
    // Dual Address/Data Bus (Trace 1A & 1B)
    {
      d: "M -20 130 H 320 L 370 180 H 740 V 310 L 790 360 H 1160 L 1210 410 V 660 L 1260 710 H 1620",
      dur: "4.4s",
      delay: "0s",
      dashArray: "64 220",
    },
    {
      d: "M -20 144 H 314 L 364 194 H 726 V 304 L 776 354 H 1146 L 1196 404 V 654 L 1246 704 H 1620",
      dur: "4.4s",
      delay: "-0.5s",
      dashArray: "64 220",
    },
    // Square-Wave Clock Signal Line with digital clock pulses
    {
      d: "M 1620 220 H 1360 L 1310 270 H 1150 V 246 H 1114 V 270 H 1078 V 246 H 1042 V 270 H 860 L 800 210 H 520 L 460 270 H 220",
      dur: "4.2s",
      delay: "-1.8s",
      dashArray: "56 190",
    },
    // Lower interconnect data highway
    {
      d: "M 0 540 H 240 L 300 600 H 520 V 740 L 580 800 H 940 L 1000 860 V 1020",
      dur: "4.8s",
      delay: "-2.6s",
      dashArray: "60 200",
    },
    // Bottom-Right Return Bus
    {
      d: "M 1620 840 H 1380 L 1320 780 H 1060 V 640 L 1000 580 H 700 L 640 520 V 380 L 580 320 H 300",
      dur: "4.6s",
      delay: "-3.3s",
      dashArray: "64 220",
    },
    // Vertical Highway Bus
    {
      d: "M 480 -20 V 170 L 540 230 H 680 V 460 L 620 520 H 360 V 800 L 420 860 H 780",
      dur: "5.1s",
      delay: "-1.2s",
      dashArray: "50 180",
    },
    // Upper-Right Logic Branch
    {
      d: "M 1180 -20 V 130 L 1120 190 H 940 V 350 L 880 410 H 660",
      dur: "4.1s",
      delay: "-3.7s",
      dashArray: "48 160",
    },
    // Diagonal cross-routing
    {
      d: "M 1480 980 V 820 L 1420 760 H 1200 V 600 L 1140 540 H 880",
      dur: "4.7s",
      delay: "-2.1s",
      dashArray: "52 170",
    },
  ];

  // Solder vias / junction test-points at major routing nodes
  const VIAS: ViaConfig[] = [
    { cx: 740, cy: 310, ping: true, pingDelay: "0s" },
    { cx: 1160, cy: 360, ping: true, pingDelay: "-1.4s" },
    { cx: 1210, cy: 660, ping: true, pingDelay: "-2.8s" },
    { cx: 860, cy: 270, ping: true, pingDelay: "-0.9s" },
    { cx: 520, cy: 740, ping: true, pingDelay: "-2.2s" },
    { cx: 1060, cy: 640, ping: true, pingDelay: "-1.7s" },
    { cx: 680, cy: 460, ping: true, pingDelay: "-3.1s" },
    { cx: 370, cy: 180 },
    { cx: 300, cy: 600 },
    { cx: 1000, cy: 860 },
    { cx: 1360, cy: 220 },
    { cx: 1320, cy: 780 },
    { cx: 540, cy: 230 },
    { cx: 940, cy: 350 },
  ];

  return (
    <svg
      className={`bg-trace fixed inset-0 -z-10 h-full w-full pointer-events-none opacity-85 dark:opacity-80 select-none ${
        paused ? "traces-paused" : ""
      }`}
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1600 1000"
    >
      <defs>
        {/* Soft neon bloom filter for glowing pulse streams */}
        <filter id="circuit-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Silkscreen Digital Hardware Silhouettes */}
      <g opacity="0.65" className="text-border">
        {/* DIP-14 Logic IC Silhouette at junction (74LS08 Quad AND) */}
        <g transform="translate(710, 290)">
          <rect
            x="0"
            y="0"
            width="60"
            height="32"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          {/* Chip orientation notch */}
          <path d="M 0 12 A 4 4 0 0 1 0 20" fill="none" stroke="currentColor" strokeWidth="1.2" />
          {/* IC Designation label */}
          <text
            x="32"
            y="19"
            textAnchor="middle"
            fill="currentColor"
            fontSize="8.5"
            fontFamily="var(--font-mono, monospace)"
            fontWeight="600"
            letterSpacing="0.08em"
            opacity="0.8"
          >
            74LS08
          </text>
          {/* 7 top pins & 7 bottom pins */}
          {[6, 14, 22, 30, 38, 46, 54].map((px, idx) => (
            <g key={idx}>
              <line x1={px} y1="-3" x2={px} y2="0" stroke="currentColor" strokeWidth="1.2" />
              <line x1={px} y1="32" x2={px} y2="35" stroke="currentColor" strokeWidth="1.2" />
            </g>
          ))}
        </g>

        {/* Master Clock Crystal Oscillator Footprint */}
        <g transform="translate(1300, 256)">
          <rect
            x="0"
            y="0"
            width="34"
            height="22"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <text
            x="17"
            y="14"
            textAnchor="middle"
            fill="currentColor"
            fontSize="7.5"
            fontFamily="var(--font-mono, monospace)"
            fontWeight="600"
            letterSpacing="0.06em"
            opacity="0.8"
          >
            CLK
          </text>
        </g>
      </g>

      {/* Routed Copper Traces & Flowing Electric Signals */}
      {TRACES.map((trace, i) => (
        <g key={i}>
          {/* Static copper track underlay */}
          <path
            d={trace.d}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1.25"
            strokeOpacity="0.75"
          />

          {/* Blurred neon glow pulse layer */}
          <path
            d={trace.d}
            fill="none"
            stroke="var(--logic-high)"
            strokeWidth={trace.pulseWidth || 4.5}
            strokeLinecap="round"
            strokeDasharray={trace.dashArray || "50 180"}
            filter="url(#circuit-glow)"
            opacity="0.75"
            className="circuit-trace-pulse"
            style={{
              animation: `trace-flow ${trace.dur} linear infinite`,
              animationDelay: trace.delay,
              animationPlayState: paused ? "paused" : "running",
            }}
          />

          {/* Crisp, high-energy core pulse */}
          <path
            d={trace.d}
            fill="none"
            stroke="var(--logic-high)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={trace.dashArray || "50 180"}
            className="circuit-trace-pulse"
            style={{
              animation: `trace-flow ${trace.dur} linear infinite`,
              animationDelay: trace.delay,
              animationPlayState: paused ? "paused" : "running",
            }}
          />
        </g>
      ))}

      {/* Solder Vias and Pulsing Logic Junctions */}
      {VIAS.map((via, idx) => (
        <g key={idx}>
          {/* Outer copper ring */}
          <circle
            cx={via.cx}
            cy={via.cy}
            r="4.5"
            fill="none"
            stroke="var(--border)"
            strokeWidth="1.2"
          />
          {/* Center drill hole with logic-high micro pad */}
          <circle cx={via.cx} cy={via.cy} r="2" fill="var(--logic-high)" opacity="0.8" />

          {/* Rhythmic via pulse wave (expanding ripple when signals pass) */}
          {via.ping && (
            <circle
              cx={via.cx}
              cy={via.cy}
              r="4.5"
              fill="none"
              stroke="var(--logic-high)"
              strokeWidth="1.5"
              className="via-ping"
              style={{
                animationDelay: via.pingDelay || "0s",
                animationPlayState: paused ? "paused" : "running",
              }}
            />
          )}
        </g>
      ))}
    </svg>
  );
}
