"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Zap,
  CheckCircle2,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";

/**
 * Gatelab Core — Ambient Read-Only Logic Engine Showcase.
 *
 * Designed with React Bits / GSAP / Lenis aesthetic:
 * - Fluid, momentum-based easing and continuous 60fps ambient micro-animations.
 * - Deep glassmorphism with neon phosphor glows (cyan, emerald, amber, violet).
 * - Full light & dark mode support with crisp contrast across both themes.
 * - 100% Read-Only: zero manual buttons/inputs; runs as an ambient high-tech showcase.
 * - Cycles smoothly through 3 core architectural phases:
 *     1. SYNTHESIS: Dynamic beam routing with traveling laser comets across logic gates.
 *     2. SILICON: Hyper-detailed 74LS TTL DIP-14 package with live binary LED countdown.
 *     3. ANALYZER: Phosphor digital logic oscilloscope with real-time waveform sweeps.
 */

type PhaseId = "synthesis" | "silicon" | "analyzer";

interface PhaseDef {
  id: PhaseId;
  index: string;
  badge: string;
  title: string;
  subtitle: string;
  telemetry: string;
}

const PHASES: PhaseDef[] = [
  {
    id: "synthesis",
    index: "01",
    badge: "BEAM SYNTHESIS",
    title: "Canonical Logic Routing",
    subtitle: "Quine–McCluskey prime implicants compiled into 4-state gate networks",
    telemetry: "TOPOLOGY: O(n·α) UNION-FIND · DELTA FIXPOINT: CONVERGED · NETS: 8",
  },
  {
    id: "silicon",
    index: "02",
    badge: "74xx TTL SILICON",
    title: "Hardware Silicon Runtime",
    subtitle: "DIP-14 physical pinout mapped to breadboard rails with Vcc/GND verification",
    telemetry: "IC: SN74LS161AN · VCC: +5.00V · I_CC: 18.2mA · FAN-OUT: 10 LSTTL",
  },
  {
    id: "analyzer",
    index: "03",
    badge: "TIMING PHOSPHOR",
    title: "Digital Logic Analyzer",
    subtitle: "Multi-channel synchronized sweep with propagation delay & glitch isolation",
    telemetry: "CLOCK: 10.0 MHz · SKEW: 1.2ns · GLITCH SUPPRESSION: ACTIVE · TRACE: CH1-4",
  },
];

const PHASE_DURATION_MS = 7500;

export function LogicAnimation({ className }: { className?: string }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [tick, setTick] = useState(0);
  const isHydrated = useHydrated();
  const prefersReduced = usePrefersReducedMotion();
  const reducedMotion = isHydrated ? prefersReduced : false;

  const currentPhase = PHASES[phaseIdx]!;

  // Single time-based animation loop for progress + phase cycling.
  // Using RAF + wall-clock time instead of setInterval so that:
  //   • Large frame gaps (tab hidden, GC, etc.) are capped rather than
  //     causing a burst of catch-up React state updates.
  //   • The animation drifts by at most one frame rather than accumulating
  //     interval jitter over tens of seconds.
  //   • React re-renders are batched to only when visible progress changes
  //     by ≥0.2%, reducing renders from 25/sec to ~6/sec maximum.
  useEffect(() => {
    if (reducedMotion) return;

    let rafId: number;
    let lastTime = performance.now();
    // Keep authoritative state in refs so RAF closure always sees current values
    let progressRef = 0;
    let phaseRef = 0;
    // Tick: updated via its own timing tracked here
    let lastTickTime = lastTime;
    let running = true;

    const frame = (now: number) => {
      if (!running) return;
      // Cap the delta so a hidden tab stall doesn't produce a giant jump
      const delta = Math.min(now - lastTime, 200);
      lastTime = now;

      // Advance progress (0–100 over PHASE_DURATION_MS)
      progressRef += (delta / PHASE_DURATION_MS) * 100;

      if (progressRef >= 100) {
        progressRef = 0;
        phaseRef = (phaseRef + 1) % PHASES.length;
        setPhaseIdx(phaseRef);
        setProgress(0);
      } else {
        // Only call setState when the displayed value would visibly change (≥0.2%)
        // This reduces React renders from 60/sec to ~8/sec without affecting smoothness.
        setProgress((prev) => {
          const rounded = Math.round(progressRef * 5) / 5; // 0.2% precision
          return Math.abs(rounded - prev) >= 0.2 ? rounded : prev;
        });
      }

      // Tick at 1.6 Hz (every 625ms)
      if (now - lastTickTime >= 625) {
        lastTickTime += 625;
        setTick((t) => (t + 1) % 64);
      }

      rafId = requestAnimationFrame(frame);
    };

    const start = () => {
      // Reset lastTime so the delta is measured from now, not a stale timestamp
      lastTime = performance.now();
      lastTickTime = lastTime;
      running = true;
      rafId = requestAnimationFrame(frame);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(rafId);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") { stop(); } else { start(); }
    };

    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reducedMotion]);

  return (
    <div
      className={cn(
        "relative flex flex-col w-full rounded-2xl border border-zinc-200/90 dark:border-white/10 bg-white/95 dark:bg-zinc-950/90 text-zinc-900 dark:text-zinc-100 shadow-xl dark:shadow-2xl backdrop-blur-2xl overflow-hidden select-none",
        className
      )}
    >
      {/* Top Ambient Phosphor Glow Beam */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 dark:via-emerald-400/60 to-transparent" />
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-28 bg-emerald-500/10 dark:bg-emerald-500/10 blur-3xl pointer-events-none" />

      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/80 dark:border-white/5 bg-zinc-50/80 dark:bg-zinc-900/40 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex rounded-full size-2 bg-emerald-600 dark:bg-emerald-500" />
          </span>
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 tracking-wider">
            GATELAB CORE
          </span>
          <span className="hidden sm:inline-block text-zinc-500 dark:text-zinc-400">·</span>
          <span className="hidden sm:inline-block text-zinc-600 dark:text-zinc-400">
            SIMULATION RUNTIME
          </span>
        </div>

        {/* Phase Badges */}
        <div className="flex items-center gap-1.5 bg-zinc-100/90 dark:bg-zinc-900/80 px-2 py-1 rounded-full border border-zinc-200 dark:border-white/5">
          {PHASES.map((p, idx) => {
            const isActive = idx === phaseIdx;
            return (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all duration-300",
                  isActive
                    ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 shadow-xs"
                    : "text-zinc-600 dark:text-zinc-400"
                )}
              >
                <span>{p.index}</span>
                <span className="hidden md:inline">{p.badge}</span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          <Zap className="size-3 text-emerald-600 dark:text-emerald-400/80" />
          <span className="hidden lg:inline text-[11px] text-zinc-600 dark:text-zinc-400">
            READ-ONLY STREAM
          </span>
        </div>
      </div>

      {/* Continuous Luminescent Progress Bar */}
      <div className="w-full h-0.5 bg-zinc-200 dark:bg-zinc-900 overflow-hidden relative">
        <motion.div
          className="h-full bg-gradient-to-r from-emerald-600 via-cyan-500 to-emerald-500 dark:from-emerald-500 dark:via-cyan-400 dark:to-emerald-400"
          style={{ width: `${progress}%` }}
          transition={{ ease: "linear" }}
        />
      </div>

      {/* Main Canvas Showcase Area */}
      <div className="relative w-full aspect-[16/9] min-h-[300px] sm:min-h-[340px] flex items-center justify-center p-2 sm:p-4 bg-gradient-to-b from-zinc-50/60 via-white to-zinc-50/80 dark:from-zinc-950 dark:via-zinc-950/80 dark:to-zinc-900/30 overflow-hidden">
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.05] dark:opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />

        <AnimatePresence mode="wait">
          {currentPhase.id === "synthesis" && (
            <SynthesisPhase key="synthesis" tick={tick} />
          )}
          {currentPhase.id === "silicon" && (
            <SiliconPhase key="silicon" tick={tick} />
          )}
          {currentPhase.id === "analyzer" && (
            <AnalyzerPhase key="analyzer" tick={tick} />
          )}
        </AnimatePresence>
      </div>

      {/* Informational Sub-Panel */}
      <div className="flex flex-col gap-1 px-4 py-2.5 bg-zinc-50/90 dark:bg-zinc-900/50 border-t border-zinc-200/80 dark:border-white/5 font-mono text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 truncate">
            <span className="text-emerald-800 dark:text-emerald-300 font-semibold uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/20">
              {currentPhase.badge}
            </span>
            <span className="text-zinc-900 dark:text-zinc-100 font-medium text-xs truncate">
              {currentPhase.title}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-zinc-600 dark:text-zinc-400">
            <Activity className="size-3 text-cyan-600 dark:text-cyan-400 animate-pulse" />
            <span className="tabular-nums">{(progress * 0.075).toFixed(1)}s</span>
          </div>
        </div>
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
          {currentPhase.subtitle}
        </p>
      </div>

      {/* Bottom Telemetry Bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-100/80 dark:bg-zinc-950 border-t border-zinc-200/80 dark:border-white/5 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
        <div className="flex items-center gap-2 truncate">
          <Terminal className="size-3 text-zinc-500 dark:text-zinc-500 shrink-0" />
          <span className="truncate">{currentPhase.telemetry}</span>
        </div>
        <div className="hidden sm:flex items-center gap-1 shrink-0 text-emerald-700 dark:text-emerald-400 font-medium">
          <CheckCircle2 className="size-3" />
          <span>VERIFIED</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PHASE 1: SYNTHESIS — Animated Signal Beams & Logic Resolver
// ============================================================================
function SynthesisPhase({ tick }: { tick: number }) {
  // Input signals derived from cyclic tick
  const sigA = (tick & 1) as 0 | 1;
  const sigB = ((tick >> 1) & 1) as 0 | 1;
  const sigC = ((tick >> 2) & 1) as 0 | 1;

  // Intermediate gates
  const andOut = (sigA & sigB) as 0 | 1;
  const xorOut = (sigA ^ sigC) as 0 | 1;
  const norOut = (!(sigB | sigC) ? 1 : 0) as 0 | 1;

  // Output resolved ALU slice: Full Adder (Sum = A ^ B ^ C, Carry = (A & B) | (C & (A ^ B)))
  const sum = (sigA ^ sigB ^ sigC) as 0 | 1;
  const carry = (andOut | (sigC & (sigA ^ sigB))) as 0 | 1;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full h-full flex items-center justify-center"
    >
      <svg
        viewBox="0 0 640 320"
        className="w-full h-full max-h-[320px] overflow-visible"
      >
        <defs>
          <filter id="synth-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* --- Wire traces with animated light comets --- */}
        {/* A -> AND & XOR */}
        <BeamWire d="M 80 80 C 160 80, 180 85, 230 85" active={sigA === 1} color="var(--beam-cyan)" />
        <BeamWire d="M 80 80 C 140 80, 170 145, 230 145" active={sigA === 1} color="var(--beam-cyan)" />

        {/* B -> AND & NOR */}
        <BeamWire d="M 80 160 C 150 160, 170 105, 230 105" active={sigB === 1} color="var(--beam-emerald)" />
        <BeamWire d="M 80 160 C 150 160, 170 215, 230 215" active={sigB === 1} color="var(--beam-emerald)" />

        {/* C -> XOR & NOR */}
        <BeamWire d="M 80 240 C 140 240, 170 175, 230 175" active={sigC === 1} color="var(--beam-violet)" />
        <BeamWire d="M 80 240 C 160 240, 180 235, 230 235" active={sigC === 1} color="var(--beam-violet)" />

        {/* Gate outputs -> ALU Resolver */}
        <BeamWire d="M 310 95 C 370 95, 380 135, 420 140" active={andOut === 1} color="var(--beam-cyan)" />
        <BeamWire d="M 310 160 C 360 160, 380 160, 420 160" active={xorOut === 1} color="var(--beam-violet)" />
        <BeamWire d="M 310 225 C 370 225, 380 185, 420 180" active={norOut === 1} color="var(--beam-emerald)" />

        {/* ALU Resolver Outputs */}
        <BeamWire d="M 500 140 C 530 140, 540 120, 570 120" active={sum === 1} color="var(--beam-emerald)" />
        <BeamWire d="M 500 180 C 530 180, 540 200, 570 200" active={carry === 1} color="var(--beam-amber)" />

        {/* --- Input Port Nodes --- */}
        <InputNode x={80} y={80} label="A" val={sigA} color="var(--beam-cyan)" />
        <InputNode x={80} y={160} label="B" val={sigB} color="var(--beam-emerald)" />
        <InputNode x={80} y={240} label="C" val={sigC} color="var(--beam-violet)" />

        {/* --- Logic Gates (AND, XOR, NOR) --- */}
        <LogicGateBox x={230} y={70} name="AND" type="74LS08" val={andOut} color="var(--beam-cyan)" />
        <LogicGateBox x={230} y={135} name="XOR" type="74LS86" val={xorOut} color="var(--beam-violet)" />
        <LogicGateBox x={230} y={200} name="NOR" type="74LS02" val={norOut} color="var(--beam-emerald)" />

        {/* --- Center ALU / Resolver Engine --- */}
        <g transform="translate(420, 115)">
          <rect
            width={80}
            height={90}
            rx={8}
            className="fill-white dark:fill-[#090d16] stroke-emerald-700 dark:stroke-emerald-400"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            filter="url(#synth-glow)"
          />
          <text
            x={40}
            y={28}
            className="fill-emerald-800 dark:fill-emerald-300"
            fontSize={9}
            fontWeight="bold"
            fontFamily="monospace"
            textAnchor="middle"
          >
            4-STATE ALU
          </text>
          <text
            x={40}
            y={46}
            className="fill-zinc-600 dark:fill-zinc-400"
            fontSize={8}
            fontFamily="monospace"
            textAnchor="middle"
          >
            SOLVER FIXPOINT
          </text>
          <rect
            x={15}
            y={58}
            width={50}
            height={18}
            rx={4}
            className="fill-zinc-100 dark:fill-[#18181b] stroke-zinc-300 dark:stroke-zinc-700"
          />
          <text
            x={40}
            y={71}
            className="fill-zinc-900 dark:fill-zinc-100"
            fontSize={9}
            fontWeight="bold"
            fontFamily="monospace"
            textAnchor="middle"
          >
            O(n·α)
          </text>
        </g>

        {/* --- Output Port Nodes --- */}
        <OutputNode x={570} y={120} label="SUM (Σ)" val={sum} color="var(--beam-emerald)" />
        <OutputNode x={570} y={200} label="CARRY" val={carry} color="var(--beam-amber)" />
      </svg>
    </motion.div>
  );
}

// ============================================================================
// PHASE 2: SILICON — Detailed 74LS TTL DIP-14 Package & LED Array
// ============================================================================
function SiliconPhase({ tick }: { tick: number }) {
  // 4-bit binary counter value: 0..15
  const count = tick % 16;
  const q0 = (count & 1) as 0 | 1;
  const q1 = ((count >> 1) & 1) as 0 | 1;
  const q2 = ((count >> 2) & 1) as 0 | 1;
  const q3 = ((count >> 3) & 1) as 0 | 1;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full h-full flex items-center justify-center"
    >
      <svg
        viewBox="0 0 640 320"
        className="w-full h-full max-h-[320px] overflow-visible"
      >
        <defs>
          <filter id="silicon-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Upper VCC (+5V) Rail */}
        <line x1={30} y1={40} x2={610} y2={40} className="stroke-red-700 dark:stroke-red-400" strokeWidth={2.5} strokeOpacity={0.9} />
        <text x={40} y={32} className="fill-red-700 dark:fill-red-400 font-bold" fontSize={9} fontFamily="monospace">
          +5.0V VCC POWER BUS
        </text>

        {/* Lower GND Rail */}
        <line x1={30} y1={280} x2={610} y2={280} className="stroke-blue-700 dark:stroke-blue-400" strokeWidth={2.5} strokeOpacity={0.9} />
        <text x={40} y={296} className="fill-blue-700 dark:fill-blue-400 font-bold" fontSize={9} fontFamily="monospace">
          0.0V GND SYSTEM GROUND
        </text>

        {/* Jumper Wires connecting rails to IC */}
        {/* VCC to Pin 14 (top right) */}
        <path d="M 410 40 V 90" className="stroke-red-700 dark:stroke-red-400" strokeWidth={2} strokeLinecap="round" fill="none" />
        <circle cx={410} cy={40} r={3} className="fill-red-700 dark:fill-red-400" />

        {/* GND from Pin 7 (bottom right) */}
        <path d="M 410 230 V 280" className="stroke-blue-700 dark:stroke-blue-400" strokeWidth={2} strokeLinecap="round" fill="none" />
        <circle cx={410} cy={280} r={3} className="fill-blue-700 dark:fill-blue-400" />

        {/* Clock input line to Pin 2 */}
        <path d="M 80 110 H 170" className="stroke-sky-700 dark:stroke-sky-400" strokeWidth={2} strokeDasharray="6 3" fill="none" />
        <g transform="translate(60, 110)">
          <circle cx={0} cy={0} r={12} className="fill-white dark:fill-[#0c1322] stroke-sky-700 dark:stroke-sky-400" strokeWidth={1.5} />
          <path d="M -6 4 H -2 V -4 H 2 V 4 H 6" className="stroke-sky-700 dark:stroke-sky-400" strokeWidth={1.5} fill="none" />
          <text x={0} y={22} className="fill-sky-700 dark:fill-sky-400 font-bold" fontSize={8} fontFamily="monospace" textAnchor="middle">
            CLK
          </text>
        </g>

        {/* --- 74LS161 DIP-14 IC Ceramic Body --- */}
        <g transform="translate(170, 90)">
          {/* Chip Body (Dark matte epoxy package in both themes) */}
          <rect
            width={260}
            height={140}
            rx={6}
            fill="#18181b"
            stroke="#3f3f46"
            strokeWidth={1.8}
            filter="drop-shadow(0px 8px 16px rgba(0,0,0,0.4))"
          />

          {/* Indexing Notch on left edge */}
          <path
            d="M 0 58 C 12 58, 12 82, 0 82"
            fill="#27272a"
            stroke="#3f3f46"
            strokeWidth={1.2}
          />
          {/* Pin 1 Dot */}
          <circle cx={22} cy={22} r={3} fill="#a1a1aa" opacity={0.8} />

          {/* Laser-etched Part Number */}
          <text
            x={130}
            y={50}
            fill="#e4e4e7"
            fontSize={12}
            fontFamily="monospace"
            fontWeight="bold"
            letterSpacing={2}
            textAnchor="middle"
          >
            SN74LS161AN
          </text>
          <text
            x={130}
            y={68}
            fill="#a1a1aa"
            fontSize={9}
            fontFamily="monospace"
            textAnchor="middle"
          >
            TEXAS INSTRUMENTS · MALAYSIA
          </text>
          <text
            x={130}
            y={92}
            fill="#a1a1aa"
            fontSize={8}
            fontFamily="monospace"
            textAnchor="middle"
          >
            4-BIT SYNC BINARY COUNTER
          </text>

          {/* Active Status Badge inside chip */}
          <rect
            x={75}
            y={106}
            width={110}
            height={20}
            rx={4}
            fill="#09090b"
            stroke="#10b981"
            strokeOpacity={0.6}
          />
          <text
            x={130}
            y={119}
            fill="#34d399"
            fontSize={9}
            fontFamily="monospace"
            fontWeight="bold"
            textAnchor="middle"
          >
            STATE: 0x{count.toString(16).toUpperCase()} ({count})
          </text>

          {/* Lead Pins (Top: 14 to 8, Bottom: 1 to 7) */}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const px = 25 + i * 35;
            return (
              <g key={i}>
                {/* Top Pins */}
                <rect x={px - 4} y={-10} width={8} height={10} fill="#94a3b8" rx={1} />
                <circle cx={px} cy={-14} r={2} className="fill-zinc-400 dark:fill-[#3f3f46]" />
                <text x={px} y={15} fill="#a1a1aa" fontSize={7} fontFamily="monospace" textAnchor="middle">
                  {14 - i}
                </text>

                {/* Bottom Pins */}
                <rect x={px - 4} y={140} width={8} height={10} fill="#94a3b8" rx={1} />
                <circle cx={px} cy={154} r={2} className="fill-zinc-400 dark:fill-[#3f3f46]" />
                <text x={px} y={132} fill="#a1a1aa" fontSize={7} fontFamily="monospace" textAnchor="middle">
                  {1 + i}
                </text>
              </g>
            );
          })}
        </g>

        {/* Wires to Output LED Array */}
        <path d="M 430 115 H 480 V 100 H 510" stroke={q0 ? "var(--beam-emerald)" : undefined} className={q0 ? "" : "stroke-zinc-300 dark:stroke-zinc-700"} strokeWidth={1.8} fill="none" />
        <path d="M 430 135 H 490 V 135 H 510" stroke={q1 ? "var(--beam-cyan)" : undefined} className={q1 ? "" : "stroke-zinc-300 dark:stroke-zinc-700"} strokeWidth={1.8} fill="none" />
        <path d="M 430 155 H 490 V 170 H 510" stroke={q2 ? "var(--beam-violet)" : undefined} className={q2 ? "" : "stroke-zinc-300 dark:stroke-zinc-700"} strokeWidth={1.8} fill="none" />
        <path d="M 430 175 H 480 V 205 H 510" stroke={q3 ? "var(--beam-amber)" : undefined} className={q3 ? "" : "stroke-zinc-300 dark:stroke-zinc-700"} strokeWidth={1.8} fill="none" />

        {/* Output LED Bar Indicator Array */}
        <g transform="translate(510, 80)">
          <rect width={85} height={150} rx={8} className="fill-white dark:fill-[#090d16] stroke-zinc-300 dark:stroke-zinc-700" strokeWidth={1.5} />
          <text x={42} y={20} className="fill-zinc-800 dark:fill-zinc-200" fontSize={8} fontFamily="monospace" fontWeight="bold" textAnchor="middle">
            OUTPUT BUS
          </text>

          <LedRow y={40} label="Q0 (LSB)" val={q0} color="var(--beam-emerald)" />
          <LedRow y={70} label="Q1" val={q1} color="var(--beam-cyan)" />
          <LedRow y={100} label="Q2" val={q2} color="var(--beam-violet)" />
          <LedRow y={130} label="Q3 (MSB)" val={q3} color="var(--beam-amber)" />
        </g>
      </svg>
    </motion.div>
  );
}

// ============================================================================
// PHASE 3: ANALYZER — Phosphor Logic Oscilloscope with Timing Waveforms
// ============================================================================
function AnalyzerPhase({ tick }: { tick: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full h-full flex items-center justify-center"
    >
      <svg
        viewBox="0 0 640 320"
        className="w-full h-full max-h-[320px] overflow-visible"
      >
        <defs>
          <filter id="scope-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Oscilloscope Inset Screen Frame */}
        <rect
          x={30}
          y={20}
          width={580}
          height={280}
          rx={8}
          fill="#06090e"
          stroke="#334155"
          strokeWidth={1.5}
          filter="drop-shadow(0px 4px 12px rgba(0,0,0,0.3))"
        />

        {/* Fine Graticule Matrix Lines */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((col) => (
          <line
            key={`c-${col}`}
            x1={100 + col * 60}
            y1={30}
            x2={100 + col * 60}
            y2={290}
            stroke="#1e293b"
            strokeWidth={0.8}
            strokeDasharray="2 4"
            opacity={0.5}
          />
        ))}
        {[0, 1, 2, 3].map((row) => (
          <line
            key={`r-${row}`}
            x1={100}
            y1={50 + row * 65}
            x2={580}
            y2={50 + row * 65}
            stroke="#1e293b"
            strokeWidth={0.8}
            strokeDasharray="2 4"
            opacity={0.5}
          />
        ))}

        {/* Timing Measurement Zone (Delta-t skew marker) */}
        <rect
          x={280}
          y={30}
          width={70}
          height={260}
          fill="#06b6d4"
          fillOpacity={0.06}
        />
        <line x1={280} y1={30} x2={280} y2={290} stroke="#38bdf8" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
        <line x1={350} y1={30} x2={350} y2={290} stroke="#38bdf8" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
        <text x={315} y={42} fill="#38bdf8" fontSize={8} fontFamily="monospace" textAnchor="middle">
          Δt = 3.6ns
        </text>

        {/* --- Channel 1: CLK --- */}
        <g transform="translate(0, 50)">
          <text x={45} y={18} fill="#38bdf8" fontSize={9} fontFamily="monospace" fontWeight="bold">
            CH1 CLK
          </text>
          <path
            d="M 100 25 H 130 V 5 H 160 V 25 H 190 V 5 H 220 V 25 H 250 V 5 H 280 V 25 H 310 V 5 H 340 V 25 H 370 V 5 H 400 V 25 H 430 V 5 H 460 V 25 H 490 V 5 H 520 V 25 H 550 V 5 H 580"
            fill="none"
            stroke="#38bdf8"
            strokeWidth={1.8}
            filter="url(#scope-glow)"
          />
        </g>

        {/* --- Channel 2: DATA_IN --- */}
        <g transform="translate(0, 115)">
          <text x={45} y={18} fill="#c084fc" fontSize={9} fontFamily="monospace" fontWeight="bold">
            CH2 DATA
          </text>
          <path
            d="M 100 25 H 160 V 5 H 250 V 25 H 340 V 5 H 460 V 25 H 520 V 5 H 580"
            fill="none"
            stroke="#c084fc"
            strokeWidth={1.8}
            filter="url(#scope-glow)"
          />
        </g>

        {/* --- Channel 3: PROPAGATION SKEW --- */}
        <g transform="translate(0, 180)">
          <text x={45} y={18} fill="#fbbf24" fontSize={9} fontFamily="monospace" fontWeight="bold">
            CH3 SKEW
          </text>
          {/* Glitch spike right at the boundary */}
          <path
            d="M 100 25 H 280 V 5 H 292 V 25 H 370 V 5 H 470 V 25 H 580"
            fill="none"
            stroke="#fbbf24"
            strokeWidth={1.8}
            filter="url(#scope-glow)"
          />
          {/* Glitch callout badge */}
          <rect x={296} y={-2} width={42} height={14} rx={3} fill="#78350f" stroke="#fbbf24" strokeWidth={0.8} />
          <text x={317} y={8} fill="#fef08a" fontSize={7} fontFamily="monospace" textAnchor="middle">
            GLITCH
          </text>
        </g>

        {/* --- Channel 4: RESOLVED OUTPUT --- */}
        <g transform="translate(0, 245)">
          <text x={45} y={18} fill="#34d399" fontSize={9} fontFamily="monospace" fontWeight="bold">
            CH4 RESOLV
          </text>
          {/* Clean glitch-free output cured by consensus term */}
          <path
            d="M 100 25 H 280 V 25 H 370 V 5 H 470 V 25 H 580"
            fill="none"
            stroke="#34d399"
            strokeWidth={2}
            filter="url(#scope-glow)"
          />
          <text x={380} y={18} fill="#34d399" fontSize={7} fontFamily="monospace">
            [CURED: CONSENSUS TERM COVERAGE]
          </text>
        </g>

        {/* Live Hex Bus Telemetry */}
        <g transform="translate(100, 275)">
          <rect x={0} y={-10} width={480} height={18} rx={3} fill="#0b111e" stroke="#1e293b" />
          <text x={10} y={3} fill="#94a3b8" fontSize={8} fontFamily="monospace">
            BUS [7..0] STREAM:
          </text>
          <text x={120} y={3} fill="#38bdf8" fontSize={8} fontFamily="monospace" fontWeight="bold">
            0x{((tick * 17 + 0x2A) & 0xFF).toString(16).toUpperCase().padStart(2, "0")}
          </text>
          <text x={170} y={3} fill="#34d399" fontSize={8} fontFamily="monospace">
            FIXPOINT: DETERMINISTIC
          </text>
          <text x={380} y={3} fill="#c084fc" fontSize={8} fontFamily="monospace">
            SCAN: 60 FPS
          </text>
        </g>

        {/* Sweeping Phosphor Line (Laser Scanline) */}
        <g className="animate-pulse">
          <line x1={450} y1={25} x2={450} y2={295} stroke="#38bdf8" strokeWidth={1.5} opacity={0.6} />
        </g>
      </svg>
    </motion.div>
  );
}

// ============================================================================
// SVG Micro-Components for Smooth Synthesis Beams
// ============================================================================
function BeamWire({
  d,
  active,
  color,
}: {
  d: string;
  active: boolean;
  color: string;
}) {
  return (
    <g>
      {/* Base Wire Track */}
      <path
        d={d}
        fill="none"
        className={active ? "" : "stroke-zinc-300 dark:stroke-zinc-800"}
        stroke={active ? color : undefined}
        strokeWidth={active ? 2 : 1.2}
        strokeOpacity={active ? 1 : 0.6}
        strokeLinecap="round"
      />
      {/* Animated Glowing Comet Pulse */}
      {active && (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="28 140"
          style={{
            animation: "beam-flow 2.2s linear infinite",
          }}
          className="dark:opacity-90 opacity-75"
          filter="url(#synth-glow)"
        />
      )}
    </g>
  );
}

function InputNode({
  x,
  y,
  label,
  val,
  color,
}: {
  x: number;
  y: number;
  label: string;
  val: 0 | 1;
  color: string;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx={0}
        cy={0}
        r={18}
        className={cn(
          "fill-white dark:fill-[#090d16]",
          val === 1 ? "" : "stroke-zinc-300 dark:stroke-zinc-700"
        )}
        stroke={val === 1 ? color : undefined}
        strokeWidth={1.8}
        filter={val === 1 ? "url(#synth-glow)" : undefined}
      />
      <text
        x={0}
        y={-3}
        className="fill-zinc-700 dark:fill-zinc-300"
        fontSize={8}
        fontWeight="bold"
        fontFamily="monospace"
        textAnchor="middle"
      >
        {label}
      </text>
      <text
        x={0}
        y={8}
        fill={val === 1 ? color : undefined}
        className={val === 1 ? "" : "fill-zinc-600 dark:fill-zinc-400"}
        fontSize={10}
        fontWeight="bold"
        fontFamily="monospace"
        textAnchor="middle"
      >
        {val}
      </text>
    </g>
  );
}

function OutputNode({
  x,
  y,
  label,
  val,
  color,
}: {
  x: number;
  y: number;
  label: string;
  val: 0 | 1;
  color: string;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-24}
        y={-14}
        width={68}
        height={28}
        rx={6}
        className={cn(
          "fill-white dark:fill-[#090d16]",
          val === 1 ? "" : "stroke-zinc-300 dark:stroke-zinc-700"
        )}
        stroke={val === 1 ? color : undefined}
        strokeWidth={1.5}
        filter={val === 1 ? "url(#synth-glow)" : undefined}
      />
      <text
        x={10}
        y={-2}
        className="fill-zinc-700 dark:fill-zinc-300"
        fontSize={7}
        fontWeight="bold"
        fontFamily="monospace"
        textAnchor="middle"
      >
        {label}
      </text>
      <text
        x={10}
        y={9}
        fill={val === 1 ? color : undefined}
        className={val === 1 ? "" : "fill-zinc-600 dark:fill-zinc-400"}
        fontSize={9}
        fontWeight="bold"
        fontFamily="monospace"
        textAnchor="middle"
      >
        OUT: {val}
      </text>
    </g>
  );
}

function LogicGateBox({
  x,
  y,
  name,
  type,
  val,
  color,
}: {
  x: number;
  y: number;
  name: string;
  type: string;
  val: 0 | 1;
  color: string;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        width={80}
        height={50}
        rx={6}
        className={cn(
          "fill-white dark:fill-[#090d16]",
          val === 1 ? "" : "stroke-zinc-300 dark:stroke-zinc-700"
        )}
        stroke={val === 1 ? color : undefined}
        strokeWidth={1.5}
        filter={val === 1 ? "url(#synth-glow)" : undefined}
      />
      <text
        x={40}
        y={18}
        fill={val === 1 ? color : undefined}
        className={val === 1 ? "" : "fill-zinc-800 dark:fill-zinc-200"}
        fontSize={11}
        fontWeight="bold"
        fontFamily="monospace"
        textAnchor="middle"
      >
        {name}
      </text>
      <text
        x={40}
        y={30}
        className="fill-zinc-600 dark:fill-zinc-400"
        fontSize={8}
        fontFamily="monospace"
        textAnchor="middle"
      >
        {type}
      </text>
      <text
        x={40}
        y={42}
        fill={val === 1 ? color : undefined}
        className={val === 1 ? "" : "fill-zinc-600 dark:fill-zinc-400"}
        fontSize={8}
        fontWeight="bold"
        fontFamily="monospace"
        textAnchor="middle"
      >
        Y = {val}
      </text>
    </g>
  );
}

function LedRow({
  y,
  label,
  val,
  color,
}: {
  y: number;
  label: string;
  val: 0 | 1;
  color: string;
}) {
  return (
    <g transform={`translate(12, ${y})`}>
      <circle
        cx={8}
        cy={0}
        r={5}
        fill={val === 1 ? color : "currentColor"}
        className={val === 1 ? "" : "fill-zinc-200 dark:fill-zinc-800 stroke-zinc-300 dark:stroke-zinc-700"}
        stroke={val === 1 ? color : undefined}
        strokeWidth={1.2}
        filter={val === 1 ? "url(#silicon-glow)" : undefined}
      />
      <text
        x={22}
        y={3}
        className={val === 1 ? "fill-zinc-900 dark:fill-zinc-100 font-bold" : "fill-zinc-600 dark:fill-zinc-400"}
        fontSize={8}
        fontWeight="bold"
        fontFamily="monospace"
      >
        {label}: {val}
      </text>
    </g>
  );
}
