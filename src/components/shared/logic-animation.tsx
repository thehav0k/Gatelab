"use client";

import { motion } from "framer-motion";

/**
 * The landing animation: a signal actually propagating through a gate network.
 *
 * Deliberately not a decorative spinner. It shows the one thing the whole app is
 * about — a value entering on the left, taking two different paths of different
 * lengths, and arriving at the output. The wire that lights up late is the same
 * unequal-path-delay that makes a static hazard, which is the lesson buried in
 * the timing panel.
 *
 * Pure SVG, pure CSS/Framer transforms. No canvas, no images.
 */

const WIRE = {
  hidden: { pathLength: 0, opacity: 0.25 },
  shown: { pathLength: 1, opacity: 1 },
} as const;

export function LogicAnimation({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 440 200"
      className={className}
      role="img"
      aria-label="A signal propagating through a small gate network"
    >
      <defs>
        <linearGradient id="pulse" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--logic-high)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--logic-high)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--logic-high)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* --- input switches ------------------------------------------------- */}
      {[
        { y: 50, label: "A" },
        { y: 140, label: "B" },
      ].map((p, i) => (
        <g key={p.label}>
          <motion.rect
            x={10}
            y={p.y - 12}
            width={26}
            height={24}
            rx={4}
            className="fill-card stroke-foreground/40"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.15, duration: 0.4 }}
          />
          <motion.rect
            x={15}
            y={p.y - 7}
            width={16}
            height={14}
            rx={2}
            animate={{ fill: ["var(--logic-low)", "var(--logic-high)", "var(--logic-high)"] }}
            transition={{
              duration: 3.2,
              times: [0, 0.18, 1],
              repeat: Infinity,
              repeatDelay: 0.4,
              delay: i * 0.25,
            }}
          />
          <text
            x={23}
            y={p.y + 30}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {p.label}
          </text>
        </g>
      ))}

      {/* --- wires ----------------------------------------------------------- */}
      {[
        // A and B into the AND gate — the SHORT path.
        "M 36 50 L 70 50 L 70 80 L 90 80",
        "M 36 140 L 70 140 L 70 100 L 90 100",
        // A through the inverter — the LONG path, and the whole point.
        "M 36 50 L 60 50 L 60 30 L 90 30",
        // Both into the OR.
        "M 140 30 L 190 30 L 190 60 L 230 60",
        "M 136 90 L 190 90 L 190 80 L 230 80",
        // OR out to the LED.
        "M 286 70 L 372 70",
      ].map((d, i) => (
        <g key={d}>
          <motion.path
            d={d}
            fill="none"
            className="stroke-foreground/25"
            strokeWidth={2}
            initial="hidden"
            animate="shown"
            variants={WIRE}
            transition={{ delay: 0.2 + i * 0.12, duration: 0.5 }}
          />
          {/* The travelling pulse. Later wires light later — the signal has
              further to go, which is exactly what a propagation delay IS. */}
          <motion.path
            d={d}
            fill="none"
            stroke="var(--logic-high)"
            strokeWidth={2.5}
            strokeLinecap="round"
            initial={{ pathLength: 0, pathOffset: 0, opacity: 0 }}
            animate={{ pathLength: [0, 0.35, 0], pathOffset: [0, 0.65, 1], opacity: [0, 1, 0] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              repeatDelay: 2.5,
              delay: 0.6 + i * 0.28,
              ease: "easeInOut",
            }}
          />
        </g>
      ))}

      {/* --- gates ----------------------------------------------------------- */}
      <Gate x={90} y={10} kind="not" delay={0.5} />
      <Gate x={90} y={70} kind="and" delay={0.6} />
      <Gate x={230} y={50} kind="or" delay={0.8} />

      {/* --- output LED ------------------------------------------------------ */}
      <motion.circle
        cx={388}
        cy={70}
        r={15}
        style={{ stroke: "var(--logic-high)" }}
        strokeWidth={2}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{
          opacity: 1,
          scale: 1,
          fill: ["var(--card)", "var(--logic-high)", "var(--logic-high)", "var(--card)"],
        }}
        transition={{
          opacity: { delay: 1, duration: 0.4 },
          scale: { delay: 1, duration: 0.4 },
          fill: {
            duration: 3.6,
            times: [0, 0.42, 0.85, 1],
            repeat: Infinity,
            delay: 1.4,
          },
        }}
      />
      <motion.circle
        cx={388}
        cy={70}
        r={25}
        style={{ fill: "var(--logic-high)" }}
        animate={{ opacity: [0, 0.28, 0.28, 0] }}
        transition={{
          duration: 3.6,
          times: [0, 0.42, 0.85, 1],
          repeat: Infinity,
          delay: 1.4,
        }}
      />
      <text
        x={388}
        y={104}
        textAnchor="middle"
        className="fill-muted-foreground font-mono text-[10px]"
      >
        F
      </text>
    </svg>
  );
}

function Gate({
  x,
  y,
  kind,
  delay,
}: {
  x: number;
  y: number;
  kind: "and" | "or" | "not";
  delay: number;
}) {
  const body =
    kind === "and"
      ? "M0,0 H26 A20,20 0 0 1 26,40 H0 Z"
      : kind === "or"
        ? "M0,0 Q30,2 56,20 Q30,38 0,40 Q16,20 0,0 Z"
        : "M0,0 L40,20 L0,40 Z";

  // The translate goes on a PLAIN <g>, and only the animated properties go on the
  // motion one. Framer writes `style.transform` to drive `scale`, and an inline
  // style beats a presentation attribute — so putting both on the same element
  // silently discards the translate and stacks every gate at the origin.
  return (
    <g transform={`translate(${x} ${y})`}>
    <motion.g
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.45, ease: "easeOut" }}
      style={{ transformOrigin: "center" }}
    >
      <path d={body} className="fill-card stroke-foreground/70" strokeWidth={2} />
      {kind === "not" && (
        <circle cx={45} cy={20} r={5} className="fill-card stroke-foreground/70" strokeWidth={2} />
      )}
      <text
        x={kind === "or" ? 22 : kind === "and" ? 15 : 12}
        y={24}
        textAnchor="middle"
        className="fill-muted-foreground pointer-events-none font-mono text-[8px]"
      >
        {kind.toUpperCase()}
      </text>
    </motion.g>
    </g>
  );
}
