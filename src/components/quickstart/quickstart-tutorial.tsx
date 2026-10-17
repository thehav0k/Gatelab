"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConstraint, useWorkspaceStore } from "@/stores/workspace-store";
import { useSpecStore } from "@/stores/spec-store";
import { useCircuitStore } from "@/stores/circuit-store";
import { rebuildUnder } from "@/lib/simulation/rebuild";
import { cn } from "@/lib/utils";

interface StageTutorial {
  id: "theory" | "diagram" | "lab" | "report";
  stepNumber: string;
  title: string;
  route: string;
  badge: string;
  summary: string;
  steps: { title: string; detail: string; shortcut?: string }[];
  proTip: string;
  ctaLabel: string;
}

const STAGES: readonly StageTutorial[] = [
  {
    id: "theory",
    stepNumber: "01",
    title: "Theory View — Derive & Minimize Boolean Functions",
    route: "/theory",
    badge: "Algebra · K-Map · Quine–McCluskey",
    summary:
      "Start with a Boolean expression, minterm list, or interactive truth table (up to 8 variables), or design a synchronous sequential counter with J-K, D, or T flip-flop excitation tables.",
    steps: [
      {
        title: "Enter an Expression or Toggle Truth Table Rows",
        detail:
          "Type an expression such as F(A,B,C) = A'C + BC or Σm(1,3,5,7) + d(2), or click output cells in the Truth Table / K-map directly to cycle between 0, 1, and X (Don't-Care).",
      },
      {
        title: "Inspect the K-Map & Quine–McCluskey Reduction",
        detail:
          "Switch between 'How it was derived', 'K-map' (color-coded prime implicant loops), and 'Tabular method' (step-by-step binary minterm grouping and essential prime implicant coverage).",
      },
      {
        title: "Select Allowed Gate Constraints & Send to Lab",
        detail:
          "Click 'All parts' to restrict synthesis to NAND-only (7400), NOR-only (7402), or standard 74xx ICs, then click 'Build it' to synthesize and load the circuit into the Practical Lab.",
      },
    ],
    proTip:
      "Notice a minimal SOP expression like F = A·C' + B·C? In the Lab Timing Panel, you'll see why discarding the consensus term A·B creates a static-1 hazard glitch!",
    ctaLabel: "Try Stage 1 in Theory View",
  },
  {
    id: "diagram",
    stepNumber: "02",
    title: "Diagram Workbench — Block Schematics & LaTeX TikZ Export",
    route: "/diagram",
    badge: "Schematics · Custom ICs · SVG/PNG/TikZ",
    summary:
      "Draft high-level architectural block diagrams, auto-synthesize equations using gates, decoders, or multiplexers, and export crisp vector figures for lab reports and academic papers.",
    steps: [
      {
        title: "Place Gates, MSI Blocks, or Auto-Synthesize from Equations",
        detail:
          "Drag components from the left palette (Adders, Muxes, Decoders, Comparators, ALUs, Flip-Flops) or open the right-hand 'Equation' tab to auto-wire any Boolean function onto the canvas.",
      },
      {
        title: "Fold Sub-Circuits into Reusable Custom IC Blocks",
        detail:
          "Select multiple gates or blocks on the canvas and press G to collapse them into a labeled hierarchical IC package.",
        shortcut: "G",
      },
      {
        title: "Customize Visual Styling & Export to LaTeX TikZ / SVG / PNG",
        detail:
          "Use the 'Style' tab to adjust grid lines, wire corner rounding, and drop shadows, then click 'Export' to download native LaTeX TikZ (.tex), Vector SVG, or 4× High-DPI PNG.",
      },
    ],
    proTip:
      "Need to include a circuit schematic in an IEEE or university LaTeX report? Use 'Export → LaTeX TikZ (.tex)' for native vector rendering that matches your document font.",
    ctaLabel: "Open Diagram Workbench",
  },
  {
    id: "lab",
    stepNumber: "03",
    title: "Practical Lab — 4-State Schematic & 74xx Breadboard Simulator",
    route: "/lab",
    badge: "74xx TTL · Breadboard · X-Ray · Oscilloscope",
    summary:
      "Wire real 74xx series DIP integrated circuits on a synchronized Schematic or 5V Digital Logic Trainer Breadboard with live 4-state (0, 1, Z, X) probing and unit-delay hazard detection.",
    steps: [
      {
        title: "Seat 74xx DIP Chips & Connect Power Rails",
        detail:
          "In Breadboard view, DIP packages straddle the center ravine (pins 1..N/2 in row E, pins N/2+1..N in row F). Click 'Auto-Power' to wire +5V (VCC) and GND rails and bridge the column 32/33 midpoint split.",
        shortcut: "X / A",
      },
      {
        title: "Wire Trainer Switches, Clock & LEDs via Free Strip Holes",
        detail:
          "Click a Trainer Switch's blue OUT socket, then click one of the 4 free holes (rows A–D or G–J) in the target IC pin's column. Click any jumper to recolor it or drag its white handle to adjust its routing lane.",
        shortcut: "Alt+Click",
      },
      {
        title: "Initialize Flip-Flops (CLR) & Inspect the Timing Waveform",
        detail:
          "For sequential counters (74LS107A, 74LS76A, 7474, 74175), click 'CLR' first to clear the power-up unknown (X) state to 0, then click 'PULSE' or '1Hz–5Hz'. Expand the bottom 'Timing' drawer to inspect waveforms and static hazards.",
        shortcut: "F / ]",
      },
    ],
    proTip:
      "Press 'X' on the breadboard to enable X-Ray Mode—you'll see the internal logic gates inside every 74xx chip so you never confuse 7402 (Pin 1 = Output 1Y) with 7400 (Pin 1 = Input 1A).",
    ctaLabel: "Launch Practical Lab with Demo Circuit",
  },
  {
    id: "report",
    stepNumber: "04",
    title: "Verification & Report — Exhaustive 2ⁿ Hardware Diffing",
    route: "/report",
    badge: "2ⁿ Sweep · Fault Doctor · Printable Report",
    summary:
      "Automatically sweep all 2ⁿ input combinations through your wired circuit, compare every output against your derived Boolean specification, and generate a complete verification dossier.",
    steps: [
      {
        title: "Match Switch Labels to Function Variables",
        detail:
          "Ensure your input switches carry the exact variable names of your function (e.g., A, B, C or S, D0, D1) and at least one LED is connected to mark the output net.",
      },
      {
        title: "Diagnose Hardware Mistakes with the Fault Inspector",
        detail:
          "Open the right-hand 'Inspect' drawer (shortcut ']') to view pin-level electrical errors (unpowered ICs, Vcc-to-GND rail shorts, multi-driver contention, floating inputs) and root-cause hypotheses (swapped input wires, inverted gate types).",
        shortcut: "]",
      },
      {
        title: "Review & Print the Verification Report",
        detail:
          "Click 'Report' in the top bar (or navigate to /report) to view the side-by-side derived algebra, K-map, schematic/breadboard snapshot, and full 2ⁿ pass/fail verification matrix.",
      },
    ],
    proTip:
      "If your truth table fails on a few rows, check the Hypothesis banner first—GateLab automatically tests whether swapping two input wires (e.g., A and B) or inverting the output makes your circuit 100% valid!",
    ctaLabel: "Open Verification Report",
  },
];

export function QuickstartTutorial({ onClose }: { onClose?: () => void }) {
  const [activeTab, setActiveTab] = useState<StageTutorial["id"]>("theory");
  const router = useRouter();

  const setTheorySource = useWorkspaceStore((s) => s.setTheorySource);
  const constraint = useConstraint();
  const setSpec = useSpecStore((s) => s.setSpec);
  const load = useCircuitStore((s) => s.load);
  const toBreadboard = useCircuitStore((s) => s.toBreadboard);

  const handleLaunchStage = (stage: StageTutorial) => {
    const demoExpr = "F(A,B,C) = A'C + BC";
    if (stage.id === "lab" || stage.id === "report") {
      const rebuilt = rebuildUnder(demoExpr, constraint);
      if (rebuilt.ok) {
        setTheorySource(demoExpr);
        setSpec(demoExpr);
        load(rebuilt.doc, demoExpr);
        if (stage.id === "lab") {
          toBreadboard();
        }
      }
    }
    onClose?.();
    router.push(stage.route);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[11px]">
              INTERACTIVE QUICKSTART
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              4-Stage End-to-End Digital Logic Pipeline
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight mt-1">
            From Boolean Algebra to a Verified 74xx Breadboard in 4 Steps
          </h2>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as StageTutorial["id"])}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto gap-1.5 bg-muted/60 p-1.5">
          {STAGES.map((stage) => (
            <TabsTrigger
              key={stage.id}
              value={stage.id}
              className="flex items-center justify-start gap-2 px-3 py-2 text-left data-[state=active]:bg-background data-[state=active]:shadow-xs"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/15 font-mono text-xs font-bold text-primary">
                {stage.stepNumber}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold capitalize">{stage.id}</div>
                <div className="truncate text-[10px] text-muted-foreground font-mono">
                  {stage.route}
                </div>
              </div>
            </TabsTrigger>
          ))}
        </TabsList>

        {STAGES.map((stage) => (
          <TabsContent key={stage.id} value={stage.id} className="mt-4">
            <Card className="overflow-hidden border-border/80">
              <div className="grid lg:grid-cols-12">
                {/* Left Column: Visual Demonstration SVG Canvas */}
                <div className="lg:col-span-5 bg-slate-950 p-5 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-sky-400">
                      STAGE {stage.stepNumber} VISUAL DEMO
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px] border-slate-700 text-slate-300">
                      {stage.badge}
                    </Badge>
                  </div>

                  <div className="my-auto py-2">
                    <StageVisualDemo stageId={stage.id} />
                  </div>

                  <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200/90 leading-relaxed">
                    <strong className="font-mono uppercase text-amber-400 mr-1">Lab Tip:</strong>
                    {stage.proTip}
                  </div>
                </div>

                {/* Right Column: Step-by-Step Walkthrough */}
                <div className="lg:col-span-7 p-5 flex flex-col justify-between">
                  <div>
                    <CardHeader className="p-0 pb-4">
                      <CardTitle className="text-lg">{stage.title}</CardTitle>
                      <CardDescription className="text-xs leading-relaxed mt-1">
                        {stage.summary}
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="p-0 space-y-3.5">
                      {stage.steps.map((s, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-3 rounded-lg border bg-card/50 p-3"
                        >
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary mt-0.5">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-xs font-semibold text-foreground">
                                {s.title}
                              </h4>
                              {s.shortcut && (
                                <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                  {s.shortcut}
                                </kbd>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                              {s.detail}
                            </p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </div>

                  <div className="mt-5 pt-4 border-t flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {STAGES.map((st, idx) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setActiveTab(st.id)}
                          className={cn(
                            "h-2 rounded-full transition-all cursor-pointer",
                            activeTab === st.id
                              ? "w-6 bg-primary"
                              : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60",
                          )}
                          aria-label={`Go to Stage ${idx + 1}`}
                        />
                      ))}
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleLaunchStage(stage)}
                      className="gap-1.5 font-medium"
                    >
                      <Play className="size-3.5" />
                      <span>{stage.ctaLabel}</span>
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** Custom SVG visual demonstrations for each of the 4 stages. */
function StageVisualDemo({ stageId }: { stageId: StageTutorial["id"] }) {
  if (stageId === "theory") {
    return (
      <svg viewBox="0 0 360 190" className="w-full h-auto rounded border border-slate-800 bg-slate-900/90" aria-label="Theory K-Map demonstration">
        {/* K-Map Grid */}
        <text x="16" y="24" fill="#94a3b8" className="font-mono text-[9px] font-bold">
          K-MAP: F(A,B,C) = A&apos;C + BC
        </text>
        <text x="18" y="46" fill="#64748b" className="font-mono text-[8px]">A \ BC</text>
        {["00", "01", "11", "10"].map((bc, i) => (
          <text key={bc} x={64 + i * 34} y="46" textAnchor="middle" fill="#cbd5e1" className="font-mono text-[8.5px] font-bold">
            {bc}
          </text>
        ))}
        {["0", "1"].map((a, r) => (
          <g key={a}>
            <text x="34" y={70 + r * 34} textAnchor="middle" fill="#cbd5e1" className="font-mono text-[8.5px] font-bold">
              {a}
            </text>
            {[0, 1, 2, 3].map((c) => {
              const val = (r === 0 && (c === 1 || c === 2)) || (r === 1 && c === 2) ? 1 : 0;
              return (
                <g key={c}>
                  <rect
                    x={47 + c * 34}
                    y={52 + r * 34}
                    width="34"
                    height="34"
                    fill={val === 1 ? "rgba(16, 185, 129, 0.12)" : "rgba(15, 23, 42, 0.8)"}
                    stroke="#334155"
                    strokeWidth="1"
                  />
                  <text
                    x={64 + c * 34}
                    y={73 + r * 34}
                    textAnchor="middle"
                    fill={val === 1 ? "#34d399" : "#64748b"}
                    className="font-mono text-[11px] font-bold"
                  >
                    {val}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
        {/* Prime Implicant Loop 1: A'C (row 0, cols 01 & 11) */}
        <rect x="84" y="56" width="62" height="26" rx="12" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="3 2" />
        {/* Prime Implicant Loop 2: BC (col 11, rows 0 & 1) */}
        <rect x="118" y="55" width="28" height="62" rx="12" fill="none" stroke="#f59e0b" strokeWidth="2" />
        {/* Arrow to minimal equation */}
        <line x1="196" y1="86" x2="222" y2="86" stroke="#38bdf8" strokeWidth="1.5" />
        <polygon points="222,82 230,86 222,90" fill="#38bdf8" />
        {/* Synthesized Minimal Equation Card */}
        <rect x="234" y="48" width="114" height="78" rx="6" fill="#090d16" stroke="#1e293b" strokeWidth="1.2" />
        <text x="242" y="65" fill="#94a3b8" className="font-mono text-[8px] uppercase">Minimal SOP</text>
        <text x="242" y="83" fill="#38bdf8" className="font-mono text-[10px] font-bold">A&apos;·C</text>
        <text x="268" y="83" fill="#f8fafc" className="font-mono text-[10px] font-bold">+</text>
        <text x="278" y="83" fill="#f59e0b" className="font-mono text-[10px] font-bold">B·C</text>
        <text x="242" y="102" fill="#10b981" className="font-mono text-[8px]">✓ 2 Prime Implicants</text>
        <text x="242" y="115" fill="#cbd5e1" className="font-mono text-[8px]">→ 1× 7404, 1× 7408, 1× 7432</text>
        {/* Bottom Formula Bar */}
        <rect x="16" y="142" width="332" height="34" rx="5" fill="#090d16" stroke="#334155" />
        <text x="26" y="163" fill="#f8fafc" className="font-mono text-[10px]">
          Σm(1, 3, 7) → <tspan fill="#34d399" fontWeight="bold">Build in Practical Lab →</tspan>
        </text>
      </svg>
    );
  }

  if (stageId === "diagram") {
    return (
      <svg viewBox="0 0 360 190" className="w-full h-auto rounded border border-slate-800 bg-slate-900/90" aria-label="Diagram block export demonstration">
        <text x="16" y="24" fill="#94a3b8" className="font-mono text-[9px] font-bold">
          DIAGRAM WORKBENCH: BLOCK &amp; TIKZ EXPORT
        </text>
        {/* Input terminals */}
        <rect x="20" y="48" width="28" height="20" rx="3" fill="#090d16" stroke="#38bdf8" strokeWidth="1.2" />
        <text x="34" y="61" textAnchor="middle" fill="#38bdf8" className="font-mono text-[9px] font-bold">A</text>
        <rect x="20" y="88" width="28" height="20" rx="3" fill="#090d16" stroke="#38bdf8" strokeWidth="1.2" />
        <text x="34" y="101" textAnchor="middle" fill="#38bdf8" className="font-mono text-[9px] font-bold">B</text>
        <rect x="20" y="128" width="28" height="20" rx="3" fill="#090d16" stroke="#f59e0b" strokeWidth="1.2" />
        <text x="34" y="141" textAnchor="middle" fill="#f59e0b" className="font-mono text-[9px] font-bold">Cin</text>
        {/* Orthogonal Wires */}
        <path d="M 48 58 H 105" stroke="#38bdf8" strokeWidth="2" fill="none" />
        <path d="M 48 98 H 105" stroke="#38bdf8" strokeWidth="2" fill="none" />
        <path d="M 48 138 H 80 V 118 H 105" stroke="#f59e0b" strokeWidth="2" fill="none" />
        {/* Custom Grouped Full Adder Block */}
        <rect x="105" y="42" width="110" height="92" rx="6" fill="#090d16" stroke="#10b981" strokeWidth="1.5" />
        <text x="160" y="64" textAnchor="middle" fill="#10b981" className="font-mono text-[9px] font-bold">FULL ADDER</text>
        <text x="160" y="78" textAnchor="middle" fill="#64748b" className="font-mono text-[7.5px]">Custom Group (G)</text>
        <text x="113" y="61" fill="#cbd5e1" className="font-mono text-[8px]">A</text>
        <text x="113" y="101" fill="#cbd5e1" className="font-mono text-[8px]">B</text>
        <text x="113" y="121" fill="#cbd5e1" className="font-mono text-[8px]">Cin</text>
        <text x="207" y="72" textAnchor="end" fill="#34d399" className="font-mono text-[8px]">SUM</text>
        <text x="207" y="112" textAnchor="end" fill="#f59e0b" className="font-mono text-[8px]">Cout</text>
        {/* Output Wires & Export Badges */}
        <path d="M 215 69 H 255" stroke="#10b981" strokeWidth="2" fill="none" />
        <path d="M 215 109 H 255" stroke="#f59e0b" strokeWidth="2" fill="none" />
        <rect x="255" y="50" width="90" height="80" rx="5" fill="#090d16" stroke="#334155" />
        <text x="300" y="68" textAnchor="middle" fill="#f8fafc" className="font-mono text-[8.5px] font-bold">EXPORT FORMATS</text>
        <text x="300" y="85" textAnchor="middle" fill="#38bdf8" className="font-mono text-[8px]">• LaTeX TikZ (.tex)</text>
        <text x="300" y="100" textAnchor="middle" fill="#34d399" className="font-mono text-[8px]">• Vector SVG</text>
        <text x="300" y="115" textAnchor="middle" fill="#f59e0b" className="font-mono text-[8px]">• 4× High-DPI PNG</text>
      </svg>
    );
  }

  if (stageId === "lab") {
    return (
      <svg viewBox="0 0 360 190" className="w-full h-auto rounded border border-slate-800 bg-slate-900/90" aria-label="Trainer Breadboard X-Ray demonstration">
        <text x="16" y="22" fill="#94a3b8" className="font-mono text-[9px] font-bold">
          TRAINER BREADBOARD: STRIP &amp; DIP-14 SEATING (X-RAY ON)
        </text>
        {/* Top +5V and GND Rails */}
        <line x1="20" y1="36" x2="340" y2="36" stroke="#ef4444" strokeWidth="2" />
        <text x="10" y="39" fill="#ef4444" className="font-mono text-[9px] font-bold">+</text>
        <line x1="20" y1="48" x2="340" y2="48" stroke="#3b82f6" strokeWidth="2" />
        <text x="10" y="51" fill="#3b82f6" className="font-mono text-[9px] font-bold">−</text>
        {/* Highlighted 5-hole strip on Pin 1 (Col 3, Rows A-E) */}
        <rect x="84" y="112" width="16" height="58" rx="4" fill="rgba(56, 189, 248, 0.2)" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" />
        <text x="18" y="138" fill="#38bdf8" className="font-mono text-[8px]">5-Hole Strip</text>
        <text x="18" y="149" fill="#94a3b8" className="font-mono text-[7.5px]">(Rows A–E shorted)</text>
        {/* Center Ravine */}
        <rect x="20" y="92" width="320" height="16" fill="#020617" stroke="#1e293b" />
        {/* Seated DIP-14 IC Straddling Rows F and E */}
        <rect x="82" y="74" width="144" height="52" rx="4" fill="rgba(15, 23, 42, 0.85)" stroke="#94a3b8" strokeWidth="1.2" />
        <path d="M 82 94 A 6 6 0 0 1 82 106" fill="#334155" />
        <circle cx="90" cy="118" r="2.5" fill="#38bdf8" />
        <text x="154" y="96" textAnchor="middle" fill="#f8fafc" className="font-mono text-[9.5px] font-bold">
          7400 · U1 (X-RAY)
        </text>
        <text x="154" y="110" textAnchor="middle" fill="#34d399" className="font-mono text-[7.5px]">
          Pin 14 → +5V | Pin 7 → GND
        </text>
        {/* Power Jumpers */}
        <path d="M 92 64 V 36" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="92" cy="64" r="3" fill="#ef4444" />
        <circle cx="92" cy="36" r="3" fill="#ef4444" />
        <path d="M 218 142 V 48" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="218" cy="142" r="3" fill="#3b82f6" />
        <circle cx="218" cy="48" r="3" fill="#3b82f6" />
        {/* Signal Jumper from Trainer Switch A */}
        <path d="M 48 175 H 92 V 154" stroke="#38bdf8" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="92" cy="154" r="3" fill="#38bdf8" />
        <rect x="20" y="164" width="32" height="20" rx="3" fill="#090d16" stroke="#10b981" />
        <text x="36" y="177" textAnchor="middle" fill="#10b981" className="font-mono text-[8px] font-bold">SW A=1</text>
        {/* Callout Legend */}
        <rect x="238" y="68" width="106" height="96" rx="5" fill="#090d16" stroke="#334155" />
        <text x="246" y="84" fill="#f8fafc" className="font-mono text-[8px] font-bold">BREADBOARD RULES</text>
        <text x="246" y="99" fill="#38bdf8" className="font-mono text-[7.5px]">1. Leg in Row E/F</text>
        <text x="246" y="113" fill="#34d399" className="font-mono text-[7.5px]">2. Wire in A–D / G–J</text>
        <text x="246" y="127" fill="#ef4444" className="font-mono text-[7.5px]">3. Power VCC &amp; GND</text>
        <text x="246" y="141" fill="#f59e0b" className="font-mono text-[7.5px]">4. Press X for X-Ray</text>
        <text x="246" y="155" fill="#cbd5e1" className="font-mono text-[7.5px]">5. Alt+Click deletes</text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 360 190" className="w-full h-auto rounded border border-slate-800 bg-slate-900/90" aria-label="Verification 2^n sweep demonstration">
      <text x="16" y="22" fill="#94a3b8" className="font-mono text-[9px] font-bold">
        VERIFICATION BRIDGE: 2ⁿ SWEEP &amp; FAULT HYPOTHESIS
      </text>
      {/* Truth Table Diff Matrix */}
      <rect x="16" y="34" width="185" height="142" rx="5" fill="#090d16" stroke="#334155" />
      <text x="26" y="50" fill="#94a3b8" className="font-mono text-[8px] font-bold">
        m   A  B  C  | EXP  ACT  STATUS
      </text>
      <line x1="20" y1="56" x2="195" y2="56" stroke="#1e293b" />
      {[
        { m: 0, bits: "0  0  0", exp: "0", act: "0" },
        { m: 1, bits: "0  0  1", exp: "1", act: "1" },
        { m: 2, bits: "0  1  0", exp: "0", act: "0" },
        { m: 3, bits: "0  1  1", exp: "1", act: "1" },
        { m: 7, bits: "1  1  1", exp: "1", act: "1" },
      ].map((r, i) => (
        <text key={r.m} x="26" y={72 + i * 21} fill="#cbd5e1" className="font-mono text-[8.5px]">
          {r.m}   {r.bits}  |  {r.exp}    {r.act}   <tspan fill="#10b981" fontWeight="bold">✓ PASS</tspan>
        </text>
      ))}
      {/* Diagnostic & Hypothesis Cards */}
      <rect x="210" y="34" width="136" height="66" rx="5" fill="rgba(16, 185, 129, 0.1)" stroke="#10b981" />
      <text x="220" y="52" fill="#34d399" className="font-mono text-[9px] font-bold">✓ 8 / 8 ROWS VERIFIED</text>
      <text x="220" y="68" fill="#cbd5e1" className="font-mono text-[7.5px]">Wired 74xx circuit</text>
      <text x="220" y="80" fill="#cbd5e1" className="font-mono text-[7.5px]">matches derived SOP</text>
      <text x="220" y="92" fill="#38bdf8" className="font-mono text-[7.5px]">0 static hazards</text>
      <rect x="210" y="108" width="136" height="68" rx="5" fill="#090d16" stroke="#f59e0b" strokeWidth="1" />
      <text x="220" y="124" fill="#f59e0b" className="font-mono text-[8px] font-bold">FAULT DOCTOR CHECKS:</text>
      <text x="220" y="138" fill="#94a3b8" className="font-mono text-[7.5px]">• Unpowered 74xx DIPs</text>
      <text x="220" y="150" fill="#94a3b8" className="font-mono text-[7.5px]">• Swapped Input Wires</text>
      <text x="220" y="162" fill="#94a3b8" className="font-mono text-[7.5px]">• Inverted Gate Logic</text>
    </svg>
  );
}
