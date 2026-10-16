"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An interactive, live logic circuit demonstration in the hero.
 *
 * Click inputs A or B to flip physical rocker switches and watch the signals
 * propagate through real gates:
 *   - Inverter computes A'
 *   - AND gate computes A · B
 *   - OR gate computes F = A' + (A · B) = A' + B
 *
 * Real 4-state aware rendering, real wire levels, and real output glow.
 */
export function LogicAnimation({ className }: { className?: string }) {
  const [inputA, setInputA] = useState<0 | 1>(0);
  const [inputB, setInputB] = useState<0 | 1>(0);
  const [isAuto, setIsAuto] = useState(true);

  // Auto-cycle through states when auto is enabled
  useEffect(() => {
    if (!isAuto) return;
    const sequence: [0 | 1, 0 | 1][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    let idx = sequence.findIndex(([a, b]) => a === inputA && b === inputB);
    if (idx < 0) idx = 0;

    const interval = setInterval(() => {
      idx = (idx + 1) % sequence.length;
      const [nextA, nextB] = sequence[idx]!;
      setInputA(nextA);
      setInputB(nextB);
    }, 2400);

    return () => clearInterval(interval);
  }, [isAuto, inputA, inputB]);

  // Derived gate outputs
  const notA: 0 | 1 = inputA === 0 ? 1 : 0;
  const andOut: 0 | 1 = inputA === 1 && inputB === 1 ? 1 : 0;
  const outputF: 0 | 1 = notA === 1 || andOut === 1 ? 1 : 0;

  const toggleA = () => {
    setIsAuto(false);
    setInputA((v) => (v === 0 ? 1 : 0));
  };

  const toggleB = () => {
    setIsAuto(false);
    setInputB((v) => (v === 0 ? 1 : 0));
  };

  const reset = () => {
    setInputA(0);
    setInputB(0);
    setIsAuto(true);
  };

  return (
    <div className={cn("flex flex-col select-none", className)}>
      <svg
        viewBox="0 0 450 195"
        className="w-full overflow-visible"
        role="img"
        aria-label="Interactive digital logic circuit demonstration"
      >
        <defs>
          <filter id="glow-led" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* --- WIRES -------------------------------------------------------- */}
        {/* Wire 1: Input A -> NOT gate */}
        <WirePath
          d="M 42 45 L 68 45 L 68 28 L 96 28"
          level={inputA}
          label="A"
        />

        {/* Wire 2: Input A -> AND gate (input 1) */}
        <WirePath
          d="M 42 45 L 68 45 L 68 76 L 96 76"
          level={inputA}
          label="A"
        />

        {/* Wire 3: Input B -> AND gate (input 2) */}
        <WirePath
          d="M 42 135 L 68 135 L 68 96 L 96 96"
          level={inputB}
          label="B"
        />

        {/* Wire 4: NOT gate out -> OR gate (input 1) */}
        <WirePath
          d="M 148 28 L 195 28 L 195 58 L 236 58"
          level={notA}
          label="A'"
        />

        {/* Wire 5: AND gate out -> OR gate (input 2) */}
        <WirePath
          d="M 142 86 L 195 86 L 195 78 L 236 78"
          level={andOut}
          label="A·B"
        />

        {/* Wire 6: OR gate out -> LED */}
        <WirePath
          d="M 292 68 L 375 68"
          level={outputF}
          label="F"
        />

        {/* --- GATES -------------------------------------------------------- */}
        <GateSymbolSvg x={96} y={8} kind="not" outLevel={notA} />
        <GateSymbolSvg x={96} y={66} kind="and" outLevel={andOut} />
        <GateSymbolSvg x={236} y={48} kind="or" outLevel={outputF} />

        {/* --- INTERACTIVE SWITCH A ----------------------------------------- */}
        <g
          className="cursor-pointer group"
          onClick={toggleA}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleA();
            }
          }}
          tabIndex={0}
          role="button"
          aria-label={`Toggle input A, currently ${inputA}`}
        >
          {/* Switch base plate */}
          <rect
            x={6}
            y={30}
            width={34}
            height={30}
            rx={5}
            className="fill-card stroke-border transition-colors group-hover:stroke-logic-high/70"
            strokeWidth={1.5}
          />
          {/* Rocker lever */}
          <motion.rect
            x={10}
            y={34}
            width={26}
            height={22}
            rx={3}
            className={cn("transition-colors duration-150", inputA === 1 ? "fill-logic-high" : "fill-muted")}
            initial={false}
            animate={{
              x: inputA === 1 ? 14 : 10,
            }}
            transition={{ type: "spring", stiffness: 450, damping: 30 }}
          />
          {/* Toggle label */}
          <text
            x={23}
            y={49}
            textAnchor="middle"
            className="font-mono text-[9px] font-bold pointer-events-none fill-foreground"
          >
            {inputA}
          </text>
          <text
            x={23}
            y={22}
            textAnchor="middle"
            className="font-mono text-[10px] font-semibold fill-muted-foreground group-hover:fill-logic-high transition-colors"
          >
            A
          </text>
        </g>

        {/* --- INTERACTIVE SWITCH B ----------------------------------------- */}
        <g
          className="cursor-pointer group"
          onClick={toggleB}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleB();
            }
          }}
          tabIndex={0}
          role="button"
          aria-label={`Toggle input B, currently ${inputB}`}
        >
          {/* Switch base plate */}
          <rect
            x={6}
            y={120}
            width={34}
            height={30}
            rx={5}
            className="fill-card stroke-border transition-colors group-hover:stroke-logic-high/70"
            strokeWidth={1.5}
          />
          {/* Rocker lever */}
          <motion.rect
            x={10}
            y={124}
            width={26}
            height={22}
            rx={3}
            className={cn("transition-colors duration-150", inputB === 1 ? "fill-logic-high" : "fill-muted")}
            initial={false}
            animate={{
              x: inputB === 1 ? 14 : 10,
            }}
            transition={{ type: "spring", stiffness: 450, damping: 30 }}
          />
          {/* Toggle label */}
          <text
            x={23}
            y={139}
            textAnchor="middle"
            className="font-mono text-[9px] font-bold pointer-events-none fill-foreground"
          >
            {inputB}
          </text>
          <text
            x={23}
            y={112}
            textAnchor="middle"
            className="font-mono text-[10px] font-semibold fill-muted-foreground group-hover:fill-logic-high transition-colors"
          >
            B
          </text>
        </g>

        {/* --- OUTPUT INDICATOR (LED) --------------------------------------- */}
        <g transform="translate(390, 68)">
          {/* Glow halo when ON */}
          {outputF === 1 && (
            <motion.circle
              cx={0}
              cy={0}
              r={22}
              style={{ fill: "var(--logic-high)" }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 0.28, scale: 1.15 }}
              transition={{ duration: 0.2 }}
            />
          )}

          {/* Outer ring */}
          <circle
            cx={0}
            cy={0}
            r={14}
            className="stroke-border fill-card"
            strokeWidth={2}
          />

          {/* LED jewel */}
          <circle
            cx={0}
            cy={0}
            r={11}
            className={cn(
              "transition-all duration-150",
              outputF === 1 ? "fill-logic-high" : "fill-muted",
            )}
            filter={outputF === 1 ? "url(#glow-led)" : undefined}
          />

          {/* Value text inside LED */}
          <text
            x={0}
            y={3.5}
            textAnchor="middle"
            className={cn(
              "font-mono text-[10px] font-bold pointer-events-none",
              outputF === 1 ? "fill-background" : "fill-muted-foreground",
            )}
          >
            {outputF}
          </text>

          {/* LED Label */}
          <text
            x={0}
            y={30}
            textAnchor="middle"
            className="font-mono text-[11px] font-bold fill-foreground"
          >
            F
          </text>
        </g>

        {/* Wire logic probe labels on hover / resting */}
        <text
          x={162}
          y={22}
          textAnchor="middle"
          className="font-mono text-[9px] fill-muted-foreground/75"
        >
          NOT A: {notA}
        </text>
        <text
          x={162}
          y={102}
          textAnchor="middle"
          className="font-mono text-[9px] fill-muted-foreground/75"
        >
          A·B: {andOut}
        </text>
      </svg>

      {/* --- CIRCUIT STATUS BAR & INTERACTIVE CONTROLS ----------------------- */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-muted-foreground">Function:</span>
          <span className="font-semibold text-foreground">
            F = A&apos; + A·B ={" "}
            <span className={outputF === 1 ? "text-logic-high" : "text-muted-foreground"}>
              {outputF}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsAuto((v) => !v)}
            title={isAuto ? "Pause Auto-Cycle" : "Resume Auto-Cycle"}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors border",
              isAuto
                ? "bg-logic-high/15 border-logic-high/40 text-logic-high font-semibold"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {isAuto ? <Pause className="size-3" /> : <Play className="size-3" />}
            {isAuto ? "Auto Cycling" : "Manual (Click A/B)"}
          </button>
          {!isAuto && (
            <button
              type="button"
              onClick={reset}
              title="Reset to initial state"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <RotateCcw className="size-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Individual wire segment that glows and pulses when HIGH. */
function WirePath({
  d,
  level,
}: {
  d: string;
  level: 0 | 1;
  label: string;
}) {
  const isHigh = level === 1;

  return (
    <g>
      {/* Background wire track */}
      <path
        d={d}
        fill="none"
        className="stroke-muted-foreground/25"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Live logic state wire overlay */}
      <path
        d={d}
        fill="none"
        stroke={isHigh ? "var(--logic-high)" : "var(--logic-low)"}
        strokeWidth={isHigh ? 2.5 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-150"
        opacity={isHigh ? 1 : 0.45}
      />

      {/* Traveling signal pulse when line is HIGH */}
      {isHigh && (
        <motion.path
          d={d}
          fill="none"
          stroke="var(--logic-high)"
          strokeWidth={3}
          strokeLinecap="round"
          initial={{ pathLength: 0.25, pathOffset: 0 }}
          animate={{ pathOffset: [0, 1] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{ opacity: 0.85 }}
        />
      )}
    </g>
  );
}

/** Standard ANSI/IEC logic gate drawing. */
function GateSymbolSvg({
  x,
  y,
  kind,
  outLevel,
}: {
  x: number;
  y: number;
  kind: "not" | "and" | "or";
  outLevel: 0 | 1;
}) {
  const body =
    kind === "and"
      ? "M0,0 H26 A20,20 0 0 1 26,40 H0 Z"
      : kind === "or"
        ? "M0,0 Q30,2 56,20 Q30,38 0,40 Q16,20 0,0 Z"
        : "M0,0 L42,20 L0,40 Z";

  const isHigh = outLevel === 1;

  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={body}
        className={cn(
          "fill-card stroke-foreground/75 transition-colors",
          isHigh && "stroke-logic-high/70",
        )}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      {kind === "not" && (
        <circle
          cx={47}
          cy={20}
          r={5}
          className={cn(
            "fill-card stroke-foreground/75 transition-colors",
            isHigh && "stroke-logic-high/70",
          )}
          strokeWidth={1.8}
        />
      )}
      <text
        x={kind === "or" ? 22 : kind === "and" ? 15 : 14}
        y={24}
        textAnchor="middle"
        className="fill-muted-foreground pointer-events-none font-mono text-[8px] font-semibold"
      >
        {kind.toUpperCase()}
      </text>
    </g>
  );
}
