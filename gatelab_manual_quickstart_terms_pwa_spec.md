# GateLab Online — Manual Overhaul, Visual Quickstart Tutorial, Browser Terms Gate & Mobile PWA Specification

**Target Platform:** [GateLab Online](https://gatelab-online.vercel.app/)  
**Repository / Stack:** Next.js App Router · TypeScript · Tailwind CSS · Zustand (`circuit-store.ts`, `sim-store.ts`, `workspace-store.ts`, `spec-store.ts`) · Lucide React  
**Maintainer:** [@thehav0k](https://github.com/thehav0k) (`asifksifat@gmail.com`)

---

## 1\. Manual Overhaul Aligns Documentation with the Upgraded Simulator and Trainer Bench

An audit of `src/app/lab/page.tsx`, `src/components/lab/breadboard-view.tsx`, `src/stores/circuit-store.ts`, `src/lib/simulation/ic-library.ts`, `src/lib/simulation/timing.ts`, and `src/lib/simulation/verify.ts` reveals 10 specific areas where the User Manual ([`https://gatelab-online.vercel.app/manual`](https://gatelab-online.vercel.app/manual) / `src/app/manual/page.tsx`) and navigation header (`src/components/site-header.tsx`) need to be updated to match the current codebase and QA fixes.

### 1.1 Summary of Required Changes in `src/app/manual/page.tsx` and `src/components/site-header.tsx`

| Change ID | Target File / Section | What Is Outdated or Missing | Exact Update Required |
| :---- | :---- | :---- | :---- |
| **MAN-01** | `site-header.tsx` & `manual/page.tsx` (Header Navigation) | The top navbar numbers the workflow stages `1. Theory`, `2. Diagram`, `3. Lab`, `4. Report`, and places `Manual` right beside them without separation (`UX-02`). | Add a vertical divider (`<Separator orientation="vertical" className="h-4" />`) between `4. Report` and `Manual`, or group `Manual` and `Quickstart` beside `Feedback` on the right side of the header. |
| **MAN-02** | `manual/page.tsx` (Wire Selection & Deletion Controls) | The manual states *"click a wire to delete it"* (`UX-02`). In `breadboard-view.tsx` (lines 1184–1194), clicking a wire now **selects** it and opens the docked **Selected Wire Action HUD**, while `Alt + Click` or `Delete` / `Backspace` deletes it. | Update all wiring instructions and shortcut tables to explain: **Click wire** \= Select wire (opens Color Swatch HUD \+ draggable bend handle); **`Alt + Click`** or **`Delete` / `Backspace`** \= Delete wire; **Drag white circle handle** \= Adjust horizontal Manhattan routing channel (`snappedY`). |
| **MAN-03** | `manual/page.tsx` (Digital Logic Trainer Chassis) | The manual describes a bare breadboard, whereas `breadboard-view.tsx` now renders the full **MODEL 74XX-TTL · 5V BENCH Digital Logic Trainer** chassis with four integrated hardware modules. | Add a dedicated subsection documenting the four Trainer Bench modules: **DC Power Supply** (`+5.0V VCC`, `0.0V GND`), **Pulse / CLK Generator** (`PULSE`, `CLR`, `1Hz`/`2Hz`/`5Hz`, `CLK OUT`), **Logic Indicators** (`+ LED`, 7-color lens cycler, `0/1/Z/X` badge), and **Logic Input Switches** (`+ Input`, toggle levers, `OUT` banana sockets). |
| **MAN-04** | `manual/page.tsx` (16-Pin DIPs & Non-Corner Power Pins) | The manual assumes all DIPs are 14-pin packages with `Pin 14 = VCC` and `Pin 7 = GND` (`LAB-02`). However, `ic-library.ts` includes 16-pin sequential chips (`74174`, `74175`, `74LS76A`), and `74LS76A` puts `VCC` on **Pin 5** and `GND` on **Pin 13**. | Add a **74xx Pinout Exceptions & Power Table** highlighting: (a) `7402` left-side output-first pins (`Pin 1 = 1Y`), (b) `7404` right-side reversed pins (`Pin 8 = 4Y`), (c) `7410`/`7411`/`7427` wrapped Gate 1 (`Pins 1, 2, 13 -> 12`), (d) `7420`/`7421`/`7430` `NC` pins (red `✕`), (e) `74174`/`74175` 16-pin corner supply (`Pin 16 = VCC`, `Pin 8 = GND`), and (f) **`74LS76A` center supply (`Pin 5 = VCC`, `Pin 13 = GND`)**. |
| **MAN-05** | `manual/page.tsx` (Split Power Rails & `⚡ Auto-Power`) | Real breadboards—and `DEFAULT_BOARD` in `breadboard.ts` (`columns: 63, railSegments: 2`)—break the `+top`, `-top`, `+bottom`, and `-bottom` power rails at the midpoint (between columns 32 and 33). | Document the **Midpoint Rail Break** (indicated by vertical tick marks between columns 32 and 33\) and explain how to bridge segments manually or use the **`⚡ Auto-Power`** button (top toolbar or selected IC pill) to automatically wire and bridge `+5V` and `GND` for all seated ICs. |
| **MAN-06** | `manual/page.tsx` (X-Ray Mode, Airwires, & IC Dragging) | Missing documentation for `Show X-Ray (X)`, `Show Airwires (A)`, and horizontal IC dragging along the center ravine (`LAB-04`). | Document **X-Ray Mode (`X`)** (renders live logic-colored internal gates and flip-flop blocks inside each DIP package), **Airwires (`A`)** (shows unrouted dashed rat's-nest lines from a synthesized schematic), and **Ravine Dragging** (dragging an IC horizontally automatically shifts its attached strip jumpers in `circuit-store.ts`). |
| **MAN-07** | `manual/page.tsx` (Sequential Power-Up `X` State & `CLR`) | Students frequently wonder why counters (`74LS107A`, `74LS76A`, `7474`, `74175`) output red `X` on power-up and refuse to count (`sequential.ts`, `waveform-panel.tsx`). | Explain **Why Flip-Flops Power Up at `X` (Unknown)**: real bistables power up in an indeterminate state, and toggling `X` yields `X`. Document that users must click **`CLR`** on the Trainer Clock module, **`Clear (0)`** in the Clock Panel, or **`Initialize (Clear → 0)`** in the Timing Panel to reset flip-flops to `0` before pulsing the clock. |
| **MAN-08** | `manual/page.tsx` (Unit-Delay Palindromic Gray-Code Sweep) | The Timing Panel documentation does not explain the dual-engine design in `timing.ts` (`simulateTimed` vs. `simulateClocked`) or why the sweep is capped at `MAX_SWEEP_INPUTS = 7`. | Document both timing engines: (1) **Combinational Unit-Delay Engine**: runs a forward-then-reverse **Gray-code counter** (changing 1 bit per step) with selectable gate delay (`1`, `2`, or `3` ticks) to isolate true **logic hazards** from unavoidable function hazards, capped at 7 inputs (256 held steps); (2) **Clocked Sequential Engine**: runs 18 clock cycles while holding input switches steady. |
| **MAN-09** | `manual/page.tsx` (Verification Bridge & Fault Hypotheses) | Missing details on how `verify.ts` matches switches to variables, handles Don't-Cares (`d`), detects feedback loops, and caps sweeps at 16 inputs. | Document the **Variable-Label Alignment Rule** (switches are matched by label name, e.g., `S, A, B`, not alphabetical order, up to 16 variables), **Tarjan SCC Feedback Detection** (flags latches/loops as non-combinational), and the 5 automated fault hypotheses (`UNPOWERED_IC`, `FLOATING_INPUT`, `output-inverted`, `output-stuck`, `inputs-swapped`). |
| **MAN-10** | `manual/page.tsx` (Complete Keyboard & Touch Reference) | Missing several shortcuts added in `lab/page.tsx` and `breadboard-view.tsx` (`[`, `]`, `F`, `X`, `A`, `R`, `Shift+R`, `H`, `V`, `Esc`, and Undo on Clear). | Replace the shortcut table with the complete, unified keyboard and touch gesture matrix covering Schematic, Breadboard, and Diagram views. |

---

### 1.2 Drop-In Replacement Content & Code for `src/app/manual/page.tsx` Updates

Below is the structured JSX/content block to integrate into `src/app/manual/page.tsx` so every hardware rule, pinout exception, and simulator invariant is documented clearly:

// src/components/manual/manual-updated-sections.tsx

"use client";

import { AlertTriangle, Cpu, Eye, HelpCircle, Keyboard, Radio, ShieldAlert, Zap } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

export function ManualHardwareAndSimulatorSections() {

  return (

    \<div className="space-y-8"\>

      {/\* 1\. Digital Logic Trainer Chassis & Breadboard Architecture \*/}

      \<Card className="border-border/80"\>

        \<CardHeader\>

          \<div className="flex items-center gap-2"\>

            \<Cpu className="size-5 text-primary" /\>

            \<CardTitle className="text-lg"\>Digital Logic Trainer Bench (MODEL 74XX-TTL)\</CardTitle\>

          \</div\>

          \<CardDescription\>

            The Practical Lab Breadboard view emulates a complete 5V hardware trainer bench surrounding a 63-column solderless breadboard.

          \</CardDescription\>

        \</CardHeader\>

        \<CardContent className="space-y-4 text-sm leading-relaxed"\>

          \<div className="grid gap-4 md:grid-cols-2"\>

            \<div className="rounded-md border p-3.5 bg-card/50"\>

              \<h4 className="font-mono text-xs font-bold uppercase tracking-wider text-red-400 mb-1.5"\>

                1\. DC Power Supply (+5.0V VCC \&amp; 0.0V GND)

              \</h4\>

              \<p className="text-muted-foreground text-xs"\>

                Located at the top-left of the chassis. Click the red \<code className="font-mono text-foreground"\>+5.0V (VCC)\</code\> or blue{" "}

                \<code className="font-mono text-foreground"\>0.0V (GND)\</code\> banana socket and click any breadboard rail hole to feed power. Or click{" "}

                \<code className="font-mono text-amber-400"\>⚡ Auto-Power\</code\> in the top toolbar to automatically wire power rails, bridge split segments, and connect every seated IC\&apos;s supply pins.

              \</p\>

            \</div\>

            \<div className="rounded-md border p-3.5 bg-card/50"\>

              \<h4 className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400 mb-1.5"\>

                2\. Pulse / Clock Generator (PULSE, CLR, 1Hz–5Hz)

              \</h4\>

              \<p className="text-muted-foreground text-xs"\>

                Wire the amber \<code className="font-mono text-foreground"\>CLK OUT\</code\> socket to your flip-flop clock pins. Click{" "}

                \<code className="font-mono text-foreground"\>PULSE\</code\> to fire one complete \<code className="font-mono"\>0 → 1 → 0\</code\> pulse (advancing both rising-edge and falling-edge ICs),{" "}

                \<code className="font-mono text-foreground"\>CLR\</code\> to reset flip-flops to \<code className="font-mono"\>0\</code\>, or{" "}

                \<code className="font-mono text-foreground"\>1Hz / 2Hz / 5Hz\</code\> for free-running oscillation.

              \</p\>

            \</div\>

            \<div className="rounded-md border p-3.5 bg-card/50"\>

              \<h4 className="font-mono text-xs font-bold uppercase tracking-wider text-sky-400 mb-1.5"\>

                3\. Logic Input Switches (Bottom Panel)

              \</h4\>

              \<p className="text-muted-foreground text-xs"\>

                Click the physical bat lever on the left of any switch to toggle its logic state between \<code className="font-mono text-emerald-400"\>1 (HIGH)\</code\> and{" "}

                \<code className="font-mono text-slate-400"\>0 (LOW)\</code\>. Click its blue \<code className="font-mono text-foreground"\>OUT\</code\> banana socket on the right to run a jumper wire to the breadboard. Use{" "}

                \<code className="font-mono text-foreground"\>+ Input\</code\> to add switches (\<code className="font-mono"\>A..Z\</code\>).

              \</p\>

            \</div\>

            \<div className="rounded-md border p-3.5 bg-card/50"\>

              \<h4 className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1.5"\>

                4\. Logic Indicators / Output Monitor (Top-Right)

              \</h4\>

              \<p className="text-muted-foreground text-xs"\>

                Each LED displays a live 4-state digital badge (\<code className="font-mono"\>0\</code\>, \<code className="font-mono"\>1\</code\>,{" "}

                \<code className="font-mono text-amber-400"\>Z\</code\> floating, or \<code className="font-mono text-red-400"\>X\</code\> conflict/unknown). Click the small colored dot beside any LED label to cycle through 7 lens colors (Green, Red, Amber, Blue, Cyan, Purple, White).

              \</p\>

            \</div\>

          \</div\>

          \<div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs"\>

            \<p className="font-semibold text-amber-300 flex items-center gap-1.5 mb-1"\>

              \<AlertTriangle className="size-4 shrink-0" /\>

              Three Physical Breadboard Rules Modelled Strictly by GateLab:

            \</p\>

            \<ul className="list-disc pl-5 space-y-1 text-muted-foreground"\>

              \<li\>

                \<strong\>5-Hole Vertical Terminal Strips:\</strong\> Within each column (\<code className="font-mono"\>1–63\</code\>), holes \<code className="font-mono"\>A–E\</code\> are shorted together, and holes \<code className="font-mono"\>F–J\</code\> are shorted together. They never meet across the center ravine.

              \</li\>

              \<li\>

                \<strong\>One Physical Leg or Jumper Per Hole:\</strong\> An IC leg occupies row \<code className="font-mono"\>E\</code\> (pins \<code className="font-mono"\>1..N/2\</code\>) and row \<code className="font-mono"\>F\</code\> (pins \<code className="font-mono"\>N/2+1..N\</code\>). Connect your jumper wires into the remaining 4 free holes (\<code className="font-mono"\>A–D\</code\> or \<code className="font-mono"\>G–J\</code\>) of that column.

              \</li\>

              \<li\>

                \<strong\>Midpoint Power Rail Split:\</strong\> Just like a physical 63-column breadboard, the \<code className="font-mono"\>+top\</code\>, \<code className="font-mono"\>-top\</code\>, \<code className="font-mono"\>+bottom\</code\>, and \<code className="font-mono"\>-bottom\</code\> rails break between \<strong\>Column 32 and Column 33\</strong\>. Bridge the midpoint with jumpers (or click \<code className="font-mono"\>⚡ Auto-Power\</code\>) when placing ICs on the right half of the board.

              \</li\>

            \</ul\>

          \</div\>

        \</CardContent\>

      \</Card\>

      {/\* 2\. 74xx Series TTL Pinout Reference & Non-Standard Traps \*/}

      \<Card className="border-border/80"\>

        \<CardHeader\>

          \<CardTitle className="text-lg"\>74xx TTL Integrated Circuit Catalog \&amp; Pinout Exceptions\</CardTitle\>

          \<CardDescription\>

            Not all 74xx DIP packages share the 7400 pinout. Press \<kbd className="px-1.5 py-0.5 text-xs font-mono border rounded bg-muted"\>X\</kbd\> on the breadboard to toggle live internal X-Ray gate views.

          \</CardDescription\>

        \</CardHeader\>

        \<CardContent\>

          \<div className="overflow-x-auto"\>

            \<table className="w-full text-left border-collapse text-xs font-mono"\>

              \<thead\>

                \<tr className="border-b text-muted-foreground"\>

                  \<th className="py-2 pr-3"\>Part\</th\>

                  \<th className="py-2 px-3"\>Function\</th\>

                  \<th className="py-2 px-3"\>Package\</th\>

                  \<th className="py-2 px-3"\>VCC / GND\</th\>

                  \<th className="py-2 pl-3"\>Critical Pinout Note / Datasheet Trap\</th\>

                \</tr\>

              \</thead\>

              \<tbody className="divide-y"\>

                \<tr\>

                  \<td className="py-2 pr-3 font-bold text-primary"\>7400 / 7408 / 7432 / 7486\</td\>

                  \<td className="py-2 px-3 font-sans"\>Quad 2-in NAND / AND / OR / XOR\</td\>

                  \<td className="py-2 px-3"\>DIP-14\</td\>

                  \<td className="py-2 px-3"\>Pin 14 / Pin 7\</td\>

                  \<td className="py-2 pl-3 font-sans text-muted-foreground"\>Standard layout: Pins 1,2→3 (Gate 1); 4,5→6 (Gate 2); 9,10→8 (Gate 3); 12,13→11 (Gate 4).\</td\>

                \</tr\>

                \<tr className="bg-amber-500/5"\>

                  \<td className="py-2 pr-3 font-bold text-amber-400"\>7402\</td\>

                  \<td className="py-2 px-3 font-sans"\>Quad 2-in NOR\</td\>

                  \<td className="py-2 px-3"\>DIP-14\</td\>

                  \<td className="py-2 px-3"\>Pin 14 / Pin 7\</td\>

                  \<td className="py-2 pl-3 font-sans text-amber-200/90"\>\<strong\>Output-First Trap:\</strong\> Pin 1 is \<code className="font-mono"\>1Y\</code\> (inputs on Pins 2, 3); Pin 4 is \<code className="font-mono"\>2Y\</code\> (inputs on Pins 5, 6).\</td\>

                \</tr\>

                \<tr\>

                  \<td className="py-2 pr-3 font-bold text-primary"\>7404\</td\>

                  \<td className="py-2 px-3 font-sans"\>Hex Inverter (NOT)\</td\>

                  \<td className="py-2 px-3"\>DIP-14\</td\>

                  \<td className="py-2 px-3"\>Pin 14 / Pin 7\</td\>

                  \<td className="py-2 pl-3 font-sans text-muted-foreground"\>Left side: 1→2, 3→4, 5→6. Right side reverses: 9→8, 11→10, 13→12.\</td\>

                \</tr\>

                \<tr\>

                  \<td className="py-2 pr-3 font-bold text-primary"\>7410 / 7411 / 7427\</td\>

                  \<td className="py-2 px-3 font-sans"\>Triple 3-in NAND / AND / NOR\</td\>

                  \<td className="py-2 px-3"\>DIP-14\</td\>

                  \<td className="py-2 px-3"\>Pin 14 / Pin 7\</td\>

                  \<td className="py-2 pl-3 font-sans text-muted-foreground"\>Gate 1 wraps across the notch: inputs on Pins 1, 2, 13 → output \<code className="font-mono"\>1Y\</code\> on Pin 12.\</td\>

                \</tr\>

                \<tr\>

                  \<td className="py-2 pr-3 font-bold text-primary"\>7420 / 7421 / 7430\</td\>

                  \<td className="py-2 px-3 font-sans"\>Dual 4-in \&amp; Single 8-in Gates\</td\>

                  \<td className="py-2 px-3"\>DIP-14\</td\>

                  \<td className="py-2 px-3"\>Pin 14 / Pin 7\</td\>

                  \<td className="py-2 pl-3 font-sans text-muted-foreground"\>Contains \<code className="font-mono text-red-400"\>NC\</code\> (No Connect) pins: Pins 3, 11 on 7420/7421; Pins 9, 10, 13 on 7430 (output \<code className="font-mono"\>1Y\</code\> on Pin 8).\</td\>

                \</tr\>

                \<tr\>

                  \<td className="py-2 pr-3 font-bold text-primary"\>7474 / 74LS107A\</td\>

                  \<td className="py-2 px-3 font-sans"\>Dual D (+Edge) / Dual JK (-Edge)\</td\>

                  \<td className="py-2 px-3"\>DIP-14\</td\>

                  \<td className="py-2 px-3"\>Pin 14 / Pin 7\</td\>

                  \<td className="py-2 pl-3 font-sans text-muted-foreground"\>Active-low async \<code className="font-mono"\>CLR\</code\> (and \<code className="font-mono"\>PRE\</code\> on 7474\) must be tied HIGH (\<code className="font-mono"\>+5V\</code\>) for normal clocking.\</td\>

                \</tr\>

                \<tr className="bg-red-500/5"\>

                  \<td className="py-2 pr-3 font-bold text-red-400"\>74LS76A\</td\>

                  \<td className="py-2 px-3 font-sans"\>Dual JK (-Edge) with PRE/CLR\</td\>

                  \<td className="py-2 px-3"\>DIP-16\</td\>

                  \<td className="py-2 px-3 font-bold text-red-400"\>Pin 5 / Pin 13\</td\>

                  \<td className="py-2 pl-3 font-sans text-red-200/90"\>\<strong\>Non-Corner Supply Trap:\</strong\> 16-pin package where \<code className="font-mono"\>VCC\</code\> is Pin 5 and \<code className="font-mono"\>GND\</code\> is Pin 13 (Pin 16 is \<code className="font-mono"\>1K\</code\>, Pin 8 is \<code className="font-mono"\>2CLR\</code\>).\</td\>

                \</tr\>

                \<tr\>

                  \<td className="py-2 pr-3 font-bold text-primary"\>74175 / 74174\</td\>

                  \<td className="py-2 px-3 font-sans"\>Quad / Hex D Register (+Edge)\</td\>

                  \<td className="py-2 px-3"\>DIP-16\</td\>

                  \<td className="py-2 px-3"\>Pin 16 / Pin 8\</td\>

                  \<td className="py-2 pl-3 font-sans text-muted-foreground"\>16-pin register packages sharing common \<code className="font-mono"\>CLK\</code\> (Pin 9\) and active-low \<code className="font-mono"\>CLR\</code\> (Pin 1).\</td\>

                \</tr\>

              \</tbody\>

            \</table\>

          \</div\>

        \</CardContent\>

      \</Card\>

    \</div\>

  );

}

---

## 2\. Interactive Visual Quickstart & Step-by-Step Tutorial System

To give new and returning users an immediate, hands-on onboarding experience across **Theory (`/theory`)**, **Diagram Workbench (`/diagram`)**, **Practical Lab (`/lab`)**, and **Verification Report (`/report`)**, we add a reusable `QuickstartTutorial` component (`src/components/quickstart/quickstart-tutorial.tsx`) that can be rendered:

1. Inside a **Quickstart Tab / Section** at the top of `/manual` (`src/app/manual/page.tsx`)  
2. Inside a **Global Quickstart Modal** triggered from the header (`Quickstart` button) or the empty-state cards in `/lab`.

Each of the 4 stages includes:

- **Custom Inline SVG Visual Demonstrations** showing the exact visual mechanics (K-map prime implicant loops, Equation-to-Schematic block synthesis, DIP-14 breadboard strip & rail seating, and \$2^n\$ Truth Table diffing).  
- **Numbered Action Steps** with exact keyboard shortcuts and pin names.  
- **"Launch Stage with Example" One-Click Action Button** that pre-loads a working circuit/expression into `workspace-store`, `spec-store`, and `circuit-store` and navigates directly to that route.

### 2.1 Complete Code for `src/components/quickstart/quickstart-tutorial.tsx`

"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import {

  ArrowRight,

  BookOpen,

  CheckCircle2,

  CircuitBoard,

  Cpu,

  FileCheck2,

  Layers,

  Play,

  Sparkles,

  Zap,

} from "lucide-react";

import { Button } from "@/components/ui/button";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useWorkspaceStore } from "@/stores/workspace-store";

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

  steps: { title: string; detail: string; shortcut?: string }\[\];

  proTip: string;

  ctaLabel: string;

}

const STAGES: readonly StageTutorial\[\] \= \[

  {

    id: "theory",

    stepNumber: "01",

    title: "Theory View — Derive & Minimize Boolean Functions",

    route: "/theory",

    badge: "Algebra · K-Map · Quine–McCluskey",

    summary:

      "Start with a Boolean expression, minterm list, or interactive truth table (up to 8 variables), or design a synchronous sequential counter with J-K, D, or T flip-flop excitation tables.",

    steps: \[

      {

        title: "Enter an Expression or Toggle Truth Table Rows",

        detail:

          "Type an expression such as F(A,B,C) \= A'C \+ BC or Σm(1,3,5,7) \+ d(2), or click output cells in the Truth Table / K-map directly to cycle between 0, 1, and X (Don't-Care).",

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

    \],

    proTip:

      "Notice a minimal SOP expression like F \= A·C' \+ B·C? In the Lab Timing Panel, you'll see why discarding the consensus term A·B creates a static-1 hazard glitch\!",

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

    steps: \[

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

    \],

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

    steps: \[

      {

        title: "Seat 74xx DIP Chips & Connect Power Rails",

        detail:

          "In Breadboard view, DIP packages straddle the center ravine (pins 1..N/2 in row E, pins N/2+1..N in row F). Click '⚡ Auto-Power' to wire \+5V (VCC) and GND rails and bridge the column 32/33 midpoint split.",

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

        shortcut: "F / \]",

      },

    \],

    proTip:

      "Press 'X' on the breadboard to enable X-Ray Mode—you'll see the internal logic gates inside every 74xx chip so you never confuse 7402 (Pin 1 \= Output 1Y) with 7400 (Pin 1 \= Input 1A).",

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

    steps: \[

      {

        title: "Match Switch Labels to Function Variables",

        detail:

          "Ensure your input switches carry the exact variable names of your function (e.g., A, B, C or S, D0, D1) and at least one LED is connected to mark the output net.",

      },

      {

        title: "Diagnose Hardware Mistakes with the Fault Inspector",

        detail:

          "Open the right-hand 'Inspect' drawer (shortcut '\]') to view pin-level electrical errors (unpowered ICs, Vcc-to-GND rail shorts, multi-driver contention, floating inputs) and root-cause hypotheses (swapped input wires, inverted gate types).",

        shortcut: "\]",

      },

      {

        title: "Review & Print the Verification Report",

        detail:

          "Click 'Report' in the top bar (or navigate to /report) to view the side-by-side derived algebra, K-map, schematic/breadboard snapshot, and full 2ⁿ pass/fail verification matrix.",

      },

    \],

    proTip:

      "If your truth table fails on a few rows, check the Hypothesis banner first—GateLab automatically tests whether swapping two input wires (e.g., A and B) or inverting the output makes your circuit 100% valid\!",

    ctaLabel: "Open Verification Report",

  },

\];

export function QuickstartTutorial({ onClose }: { onClose?: () \=\> void }) {

  const \[activeTab, setActiveTab\] \= useState\<StageTutorial\["id"\]\>("theory");

  const router \= useRouter();

  const setTheorySource \= useWorkspaceStore((s) \=\> s.setTheorySource);

  const constraint \= useWorkspaceStore((s) \=\> s.constraint);

  const setSpec \= useSpecStore((s) \=\> s.setSpec);

  const load \= useCircuitStore((s) \=\> s.load);

  const toBreadboard \= useCircuitStore((s) \=\> s.toBreadboard);

  const handleLaunchStage \= (stage: StageTutorial) \=\> {

    const demoExpr \= "F(A,B,C) \= A'C \+ BC";

    if (stage.id \=== "lab" || stage.id \=== "report") {

      const rebuilt \= rebuildUnder(demoExpr, constraint);

      if (rebuilt.ok) {

        setTheorySource(demoExpr);

        setSpec(demoExpr);

        load(rebuilt.doc, demoExpr);

        if (stage.id \=== "lab") {

          toBreadboard();

        }

      }

    }

    onClose?.();

    router.push(stage.route);

  };

  return (

    \<div className="space-y-6"\>

      \<div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"\>

        \<div\>

          \<div className="flex items-center gap-2"\>

            \<Badge variant="secondary" className="font-mono text-\[11px\]"\>

              INTERACTIVE QUICKSTART

            \</Badge\>

            \<span className="text-xs text-muted-foreground font-mono"\>

              4-Stage End-to-End Digital Logic Pipeline

            \</span\>

          \</div\>

          \<h2 className="text-xl font-bold tracking-tight mt-1"\>

            From Boolean Algebra to a Verified 74xx Breadboard in 4 Steps

          \</h2\>

        \</div\>

      \</div\>

      \<Tabs

        value={activeTab}

        onValueChange={(v) \=\> setActiveTab(v as StageTutorial\["id"\])}

        className="w-full"

      \>

        \<TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto gap-1.5 bg-muted/60 p-1.5"\>

          {STAGES.map((stage) \=\> (

            \<TabsTrigger

              key={stage.id}

              value={stage.id}

              className="flex items-center justify-start gap-2 px-3 py-2 text-left data-\[state=active\]:bg-background data-\[state=active\]:shadow-xs"

            \>

              \<span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/15 font-mono text-xs font-bold text-primary"\>

                {stage.stepNumber}

              \</span\>

              \<div className="min-w-0"\>

                \<div className="truncate text-xs font-semibold capitalize"\>{stage.id}\</div\>

                \<div className="truncate text-\[10px\] text-muted-foreground font-mono"\>

                  {stage.route}

                \</div\>

              \</div\>

            \</TabsTrigger\>

          ))}

        \</TabsList\>

        {STAGES.map((stage) \=\> (

          \<TabsContent key={stage.id} value={stage.id} className="mt-4"\>

            \<Card className="overflow-hidden border-border/80"\>

              \<div className="grid lg:grid-cols-12"\>

                {/\* Left Column: Visual Demonstration SVG Canvas \*/}

                \<div className="lg:col-span-5 bg-slate-950 p-5 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800"\>

                  \<div className="flex items-center justify-between mb-3"\>

                    \<span className="font-mono text-\[11px\] font-bold uppercase tracking-wider text-sky-400"\>

                      STAGE {stage.stepNumber} VISUAL DEMO

                    \</span\>

                    \<Badge variant="outline" className="font-mono text-\[10px\] border-slate-700 text-slate-300"\>

                      {stage.badge}

                    \</Badge\>

                  \</div\>

                  \<div className="my-auto py-2"\>

                    \<StageVisualDemo stageId={stage.id} /\>

                  \</div\>

                  \<div className="mt-4 rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-\[11px\] text-amber-200/90 leading-relaxed"\>

                    \<strong className="font-mono uppercase text-amber-400 mr-1"\>Lab Tip:\</strong\>

                    {stage.proTip}

                  \</div\>

                \</div\>

                {/\* Right Column: Step-by-Step Walkthrough \*/}

                \<div className="lg:col-span-7 p-5 flex flex-col justify-between"\>

                  \<div\>

                    \<CardHeader className="p-0 pb-4"\>

                      \<CardTitle className="text-lg"\>{stage.title}\</CardTitle\>

                      \<CardDescription className="text-xs leading-relaxed mt-1"\>

                        {stage.summary}

                      \</CardDescription\>

                    \</CardHeader\>

                    \<CardContent className="p-0 space-y-3.5"\>

                      {stage.steps.map((s, idx) \=\> (

                        \<div

                          key={idx}

                          className="flex items-start gap-3 rounded-lg border bg-card/50 p-3"

                        \>

                          \<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary mt-0.5"\>

                            {idx \+ 1}

                          \</span\>

                          \<div className="min-w-0 flex-1"\>

                            \<div className="flex items-center justify-between gap-2"\>

                              \<h4 className="text-xs font-semibold text-foreground"\>

                                {s.title}

                              \</h4\>

                              {s.shortcut && (

                                \<kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-\[10px\] text-muted-foreground"\>

                                  {s.shortcut}

                                \</kbd\>

                              )}

                            \</div\>

                            \<p className="text-xs text-muted-foreground mt-1 leading-relaxed"\>

                              {s.detail}

                            \</p\>

                          \</div\>

                        \</div\>

                      ))}

                    \</CardContent\>

                  \</div\>

                  \<div className="mt-5 pt-4 border-t flex flex-wrap items-center justify-between gap-2"\>

                    \<div className="flex items-center gap-1.5"\>

                      {STAGES.map((st, idx) \=\> (

                        \<button

                          key={st.id}

                          type="button"

                          onClick={() \=\> setActiveTab(st.id)}

                          className={cn(

                            "h-2 rounded-full transition-all cursor-pointer",

                            activeTab \=== st.id ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60",

                          )}

                          aria-label={\`Go to Stage \${idx \+ 1}\`}

                        /\>

                      ))}

                    \</div\>

                    \<Button

                      size="sm"

                      onClick={() \=\> handleLaunchStage(stage)}

                      className="gap-1.5 font-medium"

                    \>

                      \<Play className="size-3.5" /\>

                      \<span\>{stage.ctaLabel}\</span\>

                      \<ArrowRight className="size-3.5" /\>

                    \</Button\>

                  \</div\>

                \</div\>

              \</div\>

            \</Card\>

          \</TabsContent\>

        ))}

      \</Tabs\>

    \</div\>

  );

}

/\*\* Custom SVG visual demonstrations for each of the 4 stages. \*/

function StageVisualDemo({ stageId }: { stageId: StageTutorial\["id"\] }) {

  if (stageId \=== "theory") {

    return (

      \<svg viewBox="0 0 360 190" className="w-full h-auto rounded border border-slate-800 bg-slate-900/90"\>

        {/\* K-Map Grid \*/}

        \<text x="16" y="24" fill="\#94a3b8" className="font-mono text-\[9px\] font-bold"\>

          K-MAP: F(A,B,C) \= A\&apos;C \+ BC

        \</text\>

        \<text x="18" y="46" fill="\#64748b" className="font-mono text-\[8px\]"\>A \\ BC\</text\>

        {\["00", "01", "11", "10"\].map((bc, i) \=\> (

          \<text key={bc} x={64 \+ i \* 34} y="46" textAnchor="middle" fill="\#cbd5e1" className="font-mono text-\[8.5px\] font-bold"\>

            {bc}

          \</text\>

        ))}

        {\["0", "1"\].map((a, r) \=\> (

          \<g key={a}\>

            \<text x="34" y={70 \+ r \* 34} textAnchor="middle" fill="\#cbd5e1" className="font-mono text-\[8.5px\] font-bold"\>

              {a}

            \</text\>

            {\[0, 1, 2, 3\].map((c) \=\> {

              const val \= (r \=== 0 && (c \=== 1 || c \=== 2)) || (r \=== 1 && c \=== 2\) ? 1 : 0;

              return (

                \<g key={c}\>

                  \<rect

                    x={47 \+ c \* 34}

                    y={52 \+ r \* 34}

                    width="34"

                    height="34"

                    fill={val \=== 1 ? "rgba(16, 185, 129, 0.12)" : "rgba(15, 23, 42, 0.8)"}

                    stroke="\#334155"

                    strokeWidth="1"

                  /\>

                  \<text

                    x={64 \+ c \* 34}

                    y={73 \+ r \* 34}

                    textAnchor="middle"

                    fill={val \=== 1 ? "\#34d399" : "\#64748b"}

                    className="font-mono text-\[11px\] font-bold"

                  \>

                    {val}

                  \</text\>

                \</g\>

              );

            })}

          \</g\>

        ))}

        {/\* Prime Implicant Loop 1: A'C (row 0, cols 01 & 11\) \*/}

        \<rect x="84" y="56" width="62" height="26" rx="12" fill="none" stroke="\#38bdf8" strokeWidth="2" strokeDasharray="3 2" /\>

        {/\* Prime Implicant Loop 2: BC (col 11, rows 0 & 1\) \*/}

        \<rect x="118" y="55" width="28" height="62" rx="12" fill="none" stroke="\#f59e0b" strokeWidth="2" /\>

        {/\* Arrow to minimal equation \*/}

        \<line x1="196" y1="86" x2="222" y2="86" stroke="\#38bdf8" strokeWidth="1.5" /\>

        \<polygon points="222,82 230,86 222,90" fill="\#38bdf8" /\>

        {/\* Synthesized Minimal Equation Card \*/}

        \<rect x="234" y="48" width="114" height="78" rx="6" fill="\#090d16" stroke="\#1e293b" strokeWidth="1.2" /\>

        \<text x="242" y="65" fill="\#94a3b8" className="font-mono text-\[8px\] uppercase"\>Minimal SOP\</text\>

        \<text x="242" y="83" fill="\#38bdf8" className="font-mono text-\[10px\] font-bold"\>A\&apos;·C\</text\>

        \<text x="268" y="83" fill="\#f8fafc" className="font-mono text-\[10px\] font-bold"\>+\</text\>

        \<text x="278" y="83" fill="\#f59e0b" className="font-mono text-\[10px\] font-bold"\>B·C\</text\>

        \<text x="242" y="102" fill="\#10b981" className="font-mono text-\[8px\]"\>✓ 2 Prime Implicants\</text\>

        \<text x="242" y="115" fill="\#cbd5e1" className="font-mono text-\[8px\]"\>→ 1× 7404, 1× 7408, 1× 7432\</text\>

        {/\* Bottom Formula Bar \*/}

        \<rect x="16" y="142" width="332" height="34" rx="5" fill="\#090d16" stroke="\#334155" /\>

        \<text x="26" y="163" fill="\#f8fafc" className="font-mono text-\[10px\]"\>

          Σm(1, 3, 7\) → \<tspan fill="\#34d399" font-weight="bold"\>Build in Practical Lab →\</tspan\>

        \</text\>

      \</svg\>

    );

  }

  if (stageId \=== "diagram") {

    return (

      \<svg viewBox="0 0 360 190" className="w-full h-auto rounded border border-slate-800 bg-slate-900/90"\>

        \<text x="16" y="24" fill="\#94a3b8" className="font-mono text-\[9px\] font-bold"\>

          DIAGRAM WORKBENCH: BLOCK \&amp; TIKZ EXPORT

        \</text\>

        {/\* Input terminals \*/}

        \<rect x="20" y="48" width="28" height="20" rx="3" fill="\#090d16" stroke="\#38bdf8" strokeWidth="1.2" /\>

        \<text x="34" y="61" textAnchor="middle" fill="\#38bdf8" className="font-mono text-\[9px\] font-bold"\>A\</text\>

        \<rect x="20" y="88" width="28" height="20" rx="3" fill="\#090d16" stroke="\#38bdf8" strokeWidth="1.2" /\>

        \<text x="34" y="101" textAnchor="middle" fill="\#38bdf8" className="font-mono text-\[9px\] font-bold"\>B\</text\>

        \<rect x="20" y="128" width="28" height="20" rx="3" fill="\#090d16" stroke="\#f59e0b" strokeWidth="1.2" /\>

        \<text x="34" y="141" textAnchor="middle" fill="\#f59e0b" className="font-mono text-\[9px\] font-bold"\>Cin\</text\>

        {/\* Orthogonal Wires \*/}

        \<path d="M 48 58 H 105" stroke="\#38bdf8" strokeWidth="2" fill="none" /\>

        \<path d="M 48 98 H 105" stroke="\#38bdf8" strokeWidth="2" fill="none" /\>

        \<path d="M 48 138 H 80 V 118 H 105" stroke="\#f59e0b" strokeWidth="2" fill="none" /\>

        {/\* Custom Grouped Full Adder Block \*/}

        \<rect x="105" y="42" width="110" height="92" rx="6" fill="\#090d16" stroke="\#10b981" strokeWidth="1.5" /\>

        \<text x="160" y="64" textAnchor="middle" fill="\#10b981" className="font-mono text-\[9px\] font-bold"\>FULL ADDER\</text\>

        \<text x="160" y="78" textAnchor="middle" fill="\#64748b" className="font-mono text-\[7.5px\]"\>Custom Group (G)\</text\>

        \<text x="113" y="61" fill="\#cbd5e1" className="font-mono text-\[8px\]"\>A\</text\>

        \<text x="113" y="101" fill="\#cbd5e1" className="font-mono text-\[8px\]"\>B\</text\>

        \<text x="113" y="121" fill="\#cbd5e1" className="font-mono text-\[8px\]"\>Cin\</text\>

        \<text x="207" y="72" textAnchor="end" fill="\#34d399" className="font-mono text-\[8px\]"\>SUM\</text\>

        \<text x="207" y="112" textAnchor="end" fill="\#f59e0b" className="font-mono text-\[8px\]"\>Cout\</text\>

        {/\* Output Wires & Export Badges \*/}

        \<path d="M 215 69 H 255" stroke="\#10b981" strokeWidth="2" fill="none" /\>

        \<path d="M 215 109 H 255" stroke="\#f59e0b" strokeWidth="2" fill="none" /\>

        \<rect x="255" y="50" width="90" height="80" rx="5" fill="\#090d16" stroke="\#334155" /\>

        \<text x="300" y="68" textAnchor="middle" fill="\#f8fafc" className="font-mono text-\[8.5px\] font-bold"\>EXPORT FORMATS\</text\>

        \<text x="300" y="85" textAnchor="middle" fill="\#38bdf8" className="font-mono text-\[8px\]"\>• LaTeX TikZ (.tex)\</text\>

        \<text x="300" y="100" textAnchor="middle" fill="\#34d399" className="font-mono text-\[8px\]"\>• Vector SVG\</text\>

        \<text x="300" y="115" textAnchor="middle" fill="\#f59e0b" className="font-mono text-\[8px\]"\>• 4× High-DPI PNG\</text\>

      \</svg\>

    );

  }

  if (stageId \=== "lab") {

    return (

      \<svg viewBox="0 0 360 190" className="w-full h-auto rounded border border-slate-800 bg-slate-900/90"\>

        \<text x="16" y="22" fill="\#94a3b8" className="font-mono text-\[9px\] font-bold"\>

          TRAINER BREADBOARD: STRIP \&amp; DIP-14 SEATING (X-RAY ON)

        \</text\>

        {/\* Top \+5V and GND Rails \*/}

        \<line x1="20" y1="36" x2="340" y2="36" stroke="\#ef4444" strokeWidth="2" /\>

        \<text x="10" y="39" fill="\#ef4444" className="font-mono text-\[9px\] font-bold"\>+\</text\>

        \<line x1="20" y1="48" x2="340" y2="48" stroke="\#3b82f6" strokeWidth="2" /\>

        \<text x="10" y="51" fill="\#3b82f6" className="font-mono text-\[9px\] font-bold"\>−\</text\>

        {/\* Highlighted 5-hole strip on Pin 1 (Col 3, Rows A-E) \*/}

        \<rect x="84" y="112" width="16" height="58" rx="4" fill="rgba(56, 189, 248, 0.2)" stroke="\#38bdf8" strokeWidth="1" strokeDasharray="2 2" /\>

        \<text x="18" y="138" fill="\#38bdf8" className="font-mono text-\[8px\]"\>5-Hole Strip\</text\>

        \<text x="18" y="149" fill="\#94a3b8" className="font-mono text-\[7.5px\]"\>(Rows A–E shorted)\</text\>

        {/\* Center Ravine \*/}

        \<rect x="20" y="92" width="320" height="16" fill="\#020617" stroke="\#1e293b" /\>

        {/\* Seated DIP-14 IC Straddling Rows F and E \*/}

        \<rect x="82" y="74" width="144" height="52" rx="4" fill="rgba(15, 23, 42, 0.85)" stroke="\#94a3b8" strokeWidth="1.2" /\>

        \<path d="M 82 94 A 6 6 0 0 1 82 106" fill="\#334155" /\>

        \<circle cx="90" cy="118" r="2.5" fill="\#38bdf8" /\>

        \<text x="154" y="96" textAnchor="middle" fill="\#f8fafc" className="font-mono text-\[9.5px\] font-bold"\>

          7400 · U1 (X-RAY)

        \</text\>

        \<text x="154" y="110" textAnchor="middle" fill="\#34d399" className="font-mono text-\[7.5px\]"\>

          Pin 14 → \+5V | Pin 7 → GND

        \</text\>

        {/\* Power Jumpers: Pin 14 (Top-Left, Col 3\) to \+5V; Pin 7 (Bottom-Right, Col 9\) to GND \*/}

        \<path d="M 92 64 V 36" stroke="\#ef4444" strokeWidth="2.5" strokeLinecap="round" /\>

        \<circle cx="92" cy="64" r="3" fill="\#ef4444" /\>

        \<circle cx="92" cy="36" r="3" fill="\#ef4444" /\>

        \<path d="M 218 142 V 48" stroke="\#3b82f6" strokeWidth="2.5" strokeLinecap="round" /\>

        \<circle cx="218" cy="142" r="3" fill="\#3b82f6" /\>

        \<circle cx="218" cy="48" r="3" fill="\#3b82f6" /\>

        {/\* Signal Jumper from Trainer Switch A into free hole Row B of Pin 1's strip \*/}

        \<path d="M 48 175 H 92 V 154" stroke="\#38bdf8" strokeWidth="2.5" fill="none" strokeLinecap="round" /\>

        \<circle cx="92" cy="154" r="3" fill="\#38bdf8" /\>

        \<rect x="20" y="164" width="32" height="20" rx="3" fill="\#090d16" stroke="\#10b981" /\>

        \<text x="36" y="177" textAnchor="middle" fill="\#10b981" className="font-mono text-\[8px\] font-bold"\>SW A=1\</text\>

        {/\* Callout Legend \*/}

        \<rect x="238" y="68" width="106" height="96" rx="5" fill="\#090d16" stroke="\#334155" /\>

        \<text x="246" y="84" fill="\#f8fafc" className="font-mono text-\[8px\] font-bold"\>BREADBOARD RULES\</text\>

        \<text x="246" y="99" fill="\#38bdf8" className="font-mono text-\[7.5px\]"\>1. Leg in Row E/F\</text\>

        \<text x="246" y="113" fill="\#34d399" className="font-mono text-\[7.5px\]"\>2. Wire in A–D / G–J\</text\>

        \<text x="246" y="127" fill="\#ef4444" className="font-mono text-\[7.5px\]"\>3. Power VCC \&amp; GND\</text\>

        \<text x="246" y="141" fill="\#f59e0b" className="font-mono text-\[7.5px\]"\>4. Press X for X-Ray\</text\>

        \<text x="246" y="155" fill="\#cbd5e1" className="font-mono text-\[7.5px\]"\>5. Alt+Click deletes\</text\>

      \</svg\>

    );

  }

  return (

    \<svg viewBox="0 0 360 190" className="w-full h-auto rounded border border-slate-800 bg-slate-900/90"\>

      \<text x="16" y="22" fill="\#94a3b8" className="font-mono text-\[9px\] font-bold"\>

        VERIFICATION BRIDGE: 2ⁿ SWEEP \&amp; FAULT HYPOTHESIS

      \</text\>

      {/\* Truth Table Diff Matrix \*/}

      \<rect x="16" y="34" width="185" height="142" rx="5" fill="\#090d16" stroke="\#334155" /\>

      \<text x="26" y="50" fill="\#94a3b8" className="font-mono text-\[8px\] font-bold"\>

        m   A  B  C  | EXP  ACT  STATUS

      \</text\>

      \<line x1="20" y1="56" x2="195" y2="56" stroke="\#1e293b" /\>

      {\[

        { m: 0, bits: "0  0  0", exp: "0", act: "0", ok: true },

        { m: 1, bits: "0  0  1", exp: "1", act: "1", ok: true },

        { m: 2, bits: "0  1  0", exp: "0", act: "0", ok: true },

        { m: 3, bits: "0  1  1", exp: "1", act: "1", ok: true },

        { m: 7, bits: "1  1  1", exp: "1", act: "1", ok: true },

      \].map((r, i) \=\> (

        \<text key={r.m} x="26" y={72 \+ i \* 21} fill="\#cbd5e1" className="font-mono text-\[8.5px\]"\>

          {r.m}   {r.bits}  |  {r.exp}    {r.act}   \<tspan fill="\#10b981" font-weight="bold"\>✓ PASS\</tspan\>

        \</text\>

      ))}

      {/\* Diagnostic & Hypothesis Cards \*/}

      \<rect x="210" y="34" width="136" height="66" rx="5" fill="rgba(16, 185, 129, 0.1)" stroke="\#10b981" /\>

      \<text x="220" y="52" fill="\#34d399" className="font-mono text-\[9px\] font-bold"\>✓ 8 / 8 ROWS VERIFIED\</text\>

      \<text x="220" y="68" fill="\#cbd5e1" className="font-mono text-\[7.5px\]"\>Wired 74xx circuit\</text\>

      \<text x="220" y="80" fill="\#cbd5e1" className="font-mono text-\[7.5px\]"\>matches derived SOP\</text\>

      \<text x="220" y="92" fill="\#38bdf8" className="font-mono text-\[7.5px\]"\>0 static hazards\</text\>

      \<rect x="210" y="108" width="136" height="68" rx="5" fill="\#090d16" stroke="\#f59e0b" strokeWidth="1" /\>

      \<text x="220" y="124" fill="\#f59e0b" className="font-mono text-\[8px\] font-bold"\>FAULT DOCTOR CHECKS:\</text\>

      \<text x="220" y="138" fill="\#94a3b8" className="font-mono text-\[7.5px\]"\>• Unpowered 74xx DIPs\</text\>

      \<text x="220" y="150" fill="\#94a3b8" className="font-mono text-\[7.5px\]"\>• Swapped Input Wires\</text\>

      \<text x="220" y="162" fill="\#94a3b8" className="font-mono text-\[7.5px\]"\>• Inverted Gate Logic\</text\>

    \</svg\>

  );

}

---

## 3\. Client-Side Execution Terms & Conditions and Minimum Browser/Hardware Gate

Because GateLab executes **100% of its computation inside the user's browser**—including NP-hard Quine–McCluskey prime implicant reduction, double-buffered 4-state delta-cycle simulation (`solver.ts`), unit-delay palindromic Gray-code timing sweeps (`timing.ts`), and up to \$2^{16} \= 65,536\$-vector exhaustive verification sweeps (`verify.ts`)—the platform needs:

1. **A clear Terms & Conditions agreement** covering local browser execution, zero cloud storage/liability, hardware electrical safety disclaimers, and minimum system requirements.  
2. **An automated Minimum System & Browser Capability Check (`TermsAndSystemGateModal`)** that verifies the user's browser and hardware on first visit and requires explicit acceptance before entering the simulator.

### 3.1 Minimum System & Browser Requirements Specification

| Requirement Category | Minimum Specification | Recommended Specification | Why GateLab Requires It |
| :---- | :---- | :---- | :---- |
| **Web Browser Engine** | Chromium 105+, Firefox 110+, Safari 16.4+, or Edge 105+ | Latest Chrome, Edge, Firefox, or Safari | Requires CSS `[transform-box:fill-box]`, SVG `getScreenCTM()`, Pointer Events API, and ES2020 `BigInt` / `Uint8Array`. |
| **Processor (CPU)** | 2 logical cores (`navigator.hardwareConcurrency >= 2`) | 4+ logical cores | Runs double-buffered delta-cycle fixpoint loops (`256` cycles/step), Tarjan SCC graph passes, and \$2^{16}\$ verification sweeps on the client thread. |
| **System Memory (RAM)** | 2 GB device RAM (≥ 256 MB available tab heap) | 4 GB+ device RAM | Holds typed-array netlist buffers (`Uint8Array`), 100-step undo/redo document snapshots, and multi-channel SVG waveform samples. |
| **Local Storage** | `window.localStorage` enabled (≥ 5 MB quota) | `localStorage` \+ Cache Storage API enabled (for offline PWA) | Persists the live circuit (`digilab-circuit`), flip-flop sequential state, active specifications, and Terms acceptance locally. |
| **Display & Input** | ≥ 360px CSS viewport width; Mouse, Trackpad, or Touch screen | ≥ 1280px (`xl`) widescreen display or landscape tablet | Full 63-column breadboard \+ sidebars fit side-by-side at `≥ 1280px`; mobile/tablet viewports use slide-over drawers and pinch-to-zoom. |

### 3.2 Complete Code for `src/components/legal/terms-and-system-gate.tsx`

Mount `<TermsAndSystemGate />` inside `src/app/layout.tsx` so it runs once on initial visit, checks the browser environment automatically, and provides a permanent **Terms & System Check** trigger in the footer/manual.

"use client";

import { useEffect, useMemo, useState } from "react";

import { CheckCircle2, Cpu, HardDrive, MonitorCheck, ShieldCheck, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";

import { cn } from "@/lib/utils";

const STORAGE\_KEY \= "gatelab-terms-accepted-v1";

interface CapabilityCheck {

  id: string;

  label: string;

  detail: string;

  status: "pass" | "warn" | "fail";

}

function runBrowserDiagnostics(): CapabilityCheck\[\] {

  if (typeof window \=== "undefined") return \[\];

  // 1\. TypedArrays & ES2020 Simulation Engine Primitives

  const hasTypedArrays \=

    typeof Uint8Array \!== "undefined" &&

    typeof Int32Array \!== "undefined" &&

    typeof BigInt \!== "undefined";

  // 2\. LocalStorage Persistence Check

  let hasStorage \= false;

  try {

    const testKey \= "\_\_gatelab\_probe\_\_";

    window.localStorage.setItem(testKey, "1");

    window.localStorage.removeItem(testKey);

    hasStorage \= true;

  } catch {

    hasStorage \= false;

  }

  // 3\. SVG & Pointer Event Support for Schematic/Breadboard Canvas

  const hasSvgAndPointer \=

    typeof SVGSVGElement \!== "undefined" && typeof window.PointerEvent \!== "undefined";

  // 4\. Logical CPU Cores & Device Memory

  const cores \= navigator.hardwareConcurrency ?? 2;

  const memoryGb \= (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  return \[

    {

      id: "engine",

      label: "4-State Simulation Engine (TypedArrays & ES2020)",

      detail: hasTypedArrays

        ? "Uint8Array, Int32Array & BigInt verified for delta-cycle solver"

        : "Missing required JavaScript TypedArray support",

      status: hasTypedArrays ? "pass" : "fail",

    },

    {

      id: "svg-pointer",

      label: "Interactive SVG Vector Canvas & Pointer Events",

      detail: hasSvgAndPointer

        ? "Hardware-accelerated SVG CTM & unified Mouse/Touch PointerEvents active"

        : "Browser lacks full PointerEvent or SVG matrix support",

      status: hasSvgAndPointer ? "pass" : "fail",

    },

    {

      id: "storage",

      label: "Client-Side Workspace Persistence (localStorage)",

      detail: hasStorage

        ? "Local persistence active (circuits stay 100% on your device)"

        : "localStorage is blocked (private browsing or strict cookie settings)",

      status: hasStorage ? "pass" : "warn",

    },

    {

      id: "hardware",

      label: "Device Compute Capacity (2ⁿ Sweep & Hazard Timing)",

      detail: \`\${cores} logical CPU core\${cores \=== 1 ? "" : "s"} detected\${

        memoryGb ? \` · \~\${memoryGb} GB RAM\` : ""

      } (Min: 2 cores)\`,

      status: cores \>= 2 ? "pass" : "warn",

    },

  \];

}

export function TermsAndSystemGate() {

  const \[mounted, setMounted\] \= useState(false);

  const \[open, setOpen\] \= useState(false);

  const \[checked, setChecked\] \= useState(false);

  useEffect(() \=\> {

    setMounted(true);

    try {

      const accepted \= window.localStorage.getItem(STORAGE\_KEY);

      if (accepted \!== "true") {

        setOpen(true);

      }

    } catch {

      setOpen(true);

    }

  }, \[\]);

  const checks \= useMemo(() \=\> (mounted ? runBrowserDiagnostics() : \[\]), \[mounted\]);

  const hasCriticalFailure \= checks.some((c) \=\> c.status \=== "fail");

  const handleAccept \= () \=\> {

    if (\!checked || hasCriticalFailure) return;

    try {

      window.localStorage.setItem(STORAGE\_KEY, "true");

    } catch {

      // Proceed for current session even if storage is restricted

    }

    setOpen(false);

  };

  if (\!mounted || \!open) return null;

  return (

    \<div

      role="dialog"

      aria-modal="true"

      aria-labelledby="gatelab-terms-title"

      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"

    \>

      \<div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"\>

        {/\* Header \*/}

        \<div className="border-b bg-muted/40 px-5 py-4 flex items-center justify-between"\>

          \<div className="flex items-center gap-2.5"\>

            \<div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary"\>

              \<ShieldCheck className="size-5" /\>

            \</div\>

            \<div\>

              \<h2 id="gatelab-terms-title" className="text-base font-bold tracking-tight"\>

                GateLab Client-Side Execution Terms \&amp; System Verification

              \</h2\>

              \<p className="text-xs text-muted-foreground font-mono"\>

                100% In-Browser Execution · Zero Cloud Uploads · Hardware Requirements Check

              \</p\>

            \</div\>

          \</div\>

          \<Badge variant="outline" className="font-mono text-\[10px\]"\>

            v1.0 LOCAL ENGINE

          \</Badge\>

        \</div\>

        {/\* Body \*/}

        \<div className="max-h-\[70vh\] overflow-y-auto p-5 space-y-4 text-xs leading-relaxed"\>

          {/\* Live Browser & Hardware Diagnostic Scorecard \*/}

          \<div className="rounded-md border bg-background/60 p-3.5 space-y-2.5"\>

            \<div className="flex items-center justify-between"\>

              \<span className="font-mono text-\[11px\] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5"\>

                \<MonitorCheck className="size-4 text-emerald-400" /\>

                Automated Browser \&amp; Device Compatibility Check

              \</span\>

              \<Badge

                variant={hasCriticalFailure ? "destructive" : "secondary"}

                className="font-mono text-\[10px\]"

              \>

                {hasCriticalFailure ? "MINIMUM REQUIREMENTS NOT MET" : "MINIMUM CONDITIONS MET"}

              \</Badge\>

            \</div\>

            \<div className="grid gap-2 sm:grid-cols-2"\>

              {checks.map((c) \=\> (

                \<div

                  key={c.id}

                  className="flex items-start gap-2 rounded border border-border/60 bg-card p-2.5"

                \>

                  {c.status \=== "pass" ? (

                    \<CheckCircle2 className="size-4 shrink-0 text-emerald-400 mt-0.5" /\>

                  ) : (

                    \<AlertTriangle

                      className={cn(

                        "size-4 shrink-0 mt-0.5",

                        c.status \=== "warn" ? "text-amber-400" : "text-red-400",

                      )}

                    /\>

                  )}

                  \<div className="min-w-0"\>

                    \<div className="font-semibold text-foreground text-\[11px\]"\>{c.label}\</div\>

                    \<div className="text-\[10px\] text-muted-foreground font-mono mt-0.5"\>

                      {c.detail}

                    \</div\>

                  \</div\>

                \</div\>

              ))}

            \</div\>

          \</div\>

          {/\* Terms & Conditions Clauses \*/}

          \<div className="rounded-md border bg-muted/20 p-3.5 space-y-2.5 text-muted-foreground"\>

            \<h3 className="font-mono text-\[11px\] font-bold uppercase tracking-wider text-foreground"\>

              Terms and Conditions of Local Browser Execution

            \</h3\>

            \<ol className="list-decimal pl-4 space-y-1.5"\>

              \<li\>

                \<strong className="text-foreground"\>100% Client-Side Execution \&amp; Data Privacy:\</strong\>{" "}

                GateLab runs entirely inside your local web browser. All Boolean algebra minimizations, schematics, breadboard layouts, and verification reports are computed on your device and saved exclusively in your browser\&apos;s local storage (\<code className="font-mono text-foreground"\>digilab-circuit\</code\>). Nothing you build is uploaded to any external server. You are solely responsible for exporting (\<code className="font-mono text-foreground"\>.json\</code\>) and backing up your work before clearing browser data.

              \</li\>

              \<li\>

                \<strong className="text-foreground"\>Local Compute \&amp; Minimum Device Conditions:\</strong\>{" "}

                Exhaustive truth-table verification sweeps up to \<code className="font-mono text-foreground"\>2¹⁶ \= 65,536\</code\> input vectors and unit-delay Gray-code hazard analysis utilize your device\&apos;s CPU and RAM. By proceeding, you confirm that your device meets the minimum system requirements above and accept that large combinational or oscillating feedback circuits execute using local browser resources.

              \</li\>

              \<li\>

                \<strong className="text-foreground"\>Hardware Simulation Scope \&amp; Bench Safety Disclaimer:\</strong\>{" "}

                GateLab models logic behavior, pinouts, and 4-state nets (\<code className="font-mono"\>0, 1, Z, X\</code\>) from standard 74xx TTL datasheets. It does not model analog voltage droop, current-limiting resistors, thermal dissipation, or real-world component damage. Always verify physical power polarity (+5.0V VCC vs. GND) and series LED resistors before energizing real hardware on a physical lab bench.

              \</li\>

              \<li\>

                \<strong className="text-foreground"\>No Warranty (\&ldquo;As-Is\&rdquo; Educational Provision):\</strong\>{" "}

                GateLab is provided free of charge on an \&ldquo;AS IS\&rdquo; basis for educational and engineering design use without warranties of any kind.

              \</li\>

            \</ol\>

          \</div\>

          {/\* Explicit Agreement Checkbox \*/}

          \<label className="flex items-start gap-2.5 cursor-pointer select-none rounded-md border border-primary/30 bg-primary/5 p-3"\>

            \<input

              type="checkbox"

              checked={checked}

              onChange={(e) \=\> setChecked(e.target.checked)}

              className="mt-0.5 size-4 rounded border-border accent-primary cursor-pointer"

            /\>

            \<span className="text-xs text-foreground font-medium"\>

              I understand that GateLab executes 100% locally in my web browser with zero server uploads, confirm that my device and browser meet the minimum operating conditions above, and agree to the Terms and Conditions.

            \</span\>

          \</label\>

        \</div\>

        {/\* Footer \*/}

        \<div className="border-t bg-muted/40 px-5 py-3 flex items-center justify-end gap-2"\>

          \<Button

            size="sm"

            disabled={\!checked || hasCriticalFailure}

            onClick={handleAccept}

            className="font-semibold"

          \>

            Agree \&amp; Launch GateLab

          \</Button\>

        \</div\>

      \</div\>

    \</div\>

  );

}

---

## 4\. Converting GateLab into an Offline-Capable Mobile & Desktop PWA

Because GateLab has **zero backend dependencies**, it is an ideal candidate for a **Progressive Web App (PWA)** that installs onto Android, iOS/iPadOS, Windows, macOS, and Linux devices and runs **100% offline** in classrooms and hardware labs.

To make the PWA genuinely usable on mobile phones and tablets, we pair the PWA manifest and offline Service Worker with **multi-touch pinch-to-zoom and single-finger pan fixes (`XBR-01`)** in `src/hooks/use-viewbox.ts`.

### 4.1 Step 1 — Native Next.js Web App Manifest (`src/app/manifest.ts`)

Create `src/app/manifest.ts` so Next.js automatically serves `/manifest.webmanifest` and injects the manifest link into `<head>`:

// src/app/manifest.ts

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {

  return {

    name: "GateLab — Boolean Algebra & 74xx TTL Breadboard Simulator",

    short\_name: "GateLab",

    description:

      "Derive minimal Boolean functions, draw block schematics, wire 74xx TTL chips on a virtual breadboard, and verify 2^n truth tables 100% in your browser.",

    start\_url: "/",

    scope: "/",

    display: "standalone",

    orientation: "any",

    background\_color: "\#020617",

    theme\_color: "\#020617",

    categories: \["education", "utilities", "developer tools"\],

    icons: \[

      {

        src: "/icons/icon-192.png",

        sizes: "192x192",

        type: "image/png",

        purpose: "any",

      },

      {

        src: "/icons/icon-512.png",

        sizes: "512x512",

        type: "image/png",

        purpose: "maskable",

      },

      {

        src: "/icons/icon.svg",

        sizes: "any",

        type: "image/svg+xml",

        purpose: "any",

      },

    \],

    shortcuts: \[

      {

        name: "1. Theory & K-Map",

        short\_name: "Theory",

        description: "Derive Boolean functions, truth tables, and K-maps",

        url: "/theory",

      },

      {

        name: "2. Diagram Workbench",

        short\_name: "Diagram",

        description: "Build schematics and export LaTeX TikZ / SVG",

        url: "/diagram",

      },

      {

        name: "3. Practical 74xx Lab",

        short\_name: "Lab",

        description: "Simulate 74xx TTL chips on schematic or breadboard",

        url: "/lab",

      },

      {

        name: "User Manual & Quickstart",

        short\_name: "Manual",

        description: "74xx pinout tables, shortcuts, and quickstart guide",

        url: "/manual",

      },

    \],

  };

}

### 4.2 Step 2 — Offline-First Service Worker (`public/sw.js`)

Create `public/sw.js` to pre-cache all 6 routes (`/`, `/theory`, `/diagram`, `/lab`, `/report`, `/manual`) and use a **Network-First with Cache Fallback** strategy for navigation and **Stale-While-Revalidate** for static JS/CSS/font bundles (`_next/static/*`):

// public/sw.js

const CACHE\_NAME \= "gatelab-offline-v1";

const APP\_SHELL\_ROUTES \= \[

  "/",

  "/theory",

  "/diagram",

  "/lab",

  "/report",

  "/manual",

  "/manifest.webmanifest",

\];

self.addEventListener("install", (event) \=\> {

  event.waitUntil(

    caches

      .open(CACHE\_NAME)

      .then((cache) \=\> cache.addAll(APP\_SHELL\_ROUTES))

      .then(() \=\> self.skipWaiting()),

  );

});

self.addEventListener("activate", (event) \=\> {

  event.waitUntil(

    caches

      .keys()

      .then((keys) \=\>

        Promise.all(

          keys

            .filter((key) \=\> key \!== CACHE\_NAME)

            .map((oldKey) \=\> caches.delete(oldKey)),

        ),

      )

      .then(() \=\> self.clients.claim()),

  );

});

self.addEventListener("fetch", (event) \=\> {

  const { request } \= event;

  if (request.method \!== "GET") return;

  const url \= new URL(request.url);

  if (url.origin \!== self.location.origin) return;

  // Stale-while-revalidate for Next.js static chunks, fonts, and icons

  if (

    url.pathname.startsWith("/\_next/static/") ||

    url.pathname.startsWith("/icons/") ||

    url.pathname.endsWith(".svg") ||

    url.pathname.endsWith(".png") ||

    url.pathname.endsWith(".woff2")

  ) {

    event.respondWith(

      caches.open(CACHE\_NAME).then(async (cache) \=\> {

        const cached \= await cache.match(request);

        const networkFetch \= fetch(request)

          .then((response) \=\> {

            if (response && response.status \=== 200\) {

              cache.put(request, response.clone());

            }

            return response;

          })

          .catch(() \=\> cached);

        return cached || networkFetch;

      }),

    );

    return;

  }

  // Network-first with offline cache fallback for HTML/RSC route navigations

  event.respondWith(

    fetch(request)

      .then((response) \=\> {

        if (response && response.status \=== 200\) {

          const copy \= response.clone();

          caches.open(CACHE\_NAME).then((cache) \=\> cache.put(request, copy));

        }

        return response;

      })

      .catch(async () \=\> {

        const cache \= await caches.open(CACHE\_NAME);

        const cachedResponse \= await cache.match(request);

        if (cachedResponse) return cachedResponse;

        if (request.mode \=== "navigate") {

          return (await cache.match("/lab")) || (await cache.match("/"));

        }

        return new Response("Offline", { status: 503 });

      }),

  );

});

### 4.3 Step 3 — Mobile & Desktop PWA Install Button \+ iOS Safari Guide (`src/components/pwa/install-pwa-button.tsx`)

This component registers `/sw.js`, listens for `beforeinstallprompt` on Android/Chrome/Edge, detects iOS/iPadOS Safari to show a step-by-step **"Share → Add to Home Screen"** popover, and displays an offline-ready badge when installed:

"use client";

import { useEffect, useState } from "react";

import { Download, Share, Smartphone, CheckCircle2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {

  readonly platforms: string\[\];

  readonly userChoice: Promise\<{ outcome: "accepted" | "dismissed"; platform: string }\>;

  prompt(): Promise\<void\>;

}

export function InstallPwaButton() {

  const \[deferredPrompt, setDeferredPrompt\] \= useState\<BeforeInstallPromptEvent | null\>(null);

  const \[isInstalled, setIsInstalled\] \= useState(false);

  const \[isIosSafari, setIsIosSafari\] \= useState(false);

  const \[showIosGuide, setShowIosGuide\] \= useState(false);

  useEffect(() \=\> {

    if (typeof window \=== "undefined") return;

    // Register offline Service Worker

    if ("serviceWorker" in navigator) {

      navigator.serviceWorker.register("/sw.js").catch(() \=\> {

        // Ignore registration errors in dev mode

      });

    }

    // Check if already running in standalone PWA mode

    const standalone \=

      window.matchMedia("(display-mode: standalone)").matches ||

      (window.navigator as Navigator & { standalone?: boolean }).standalone \=== true;

    if (standalone) {

      setIsInstalled(true);

      return;

    }

    // Detect iOS / iPadOS Safari where beforeinstallprompt is not fired

    const ua \= window.navigator.userAgent.toLowerCase();

    const isIos \= /iphone|ipad|ipod/.test(ua) || (navigator.platform \=== "MacIntel" && navigator.maxTouchPoints \> 1);

    const isSafari \= /safari/.test(ua) && \!/chrome|crios|fxios|edgios/.test(ua);

    if (isIos && isSafari) {

      setIsIosSafari(true);

    }

    const onBeforeInstallPrompt \= (e: Event) \=\> {

      e.preventDefault();

      setDeferredPrompt(e as BeforeInstallPromptEvent);

    };

    const onAppInstalled \= () \=\> {

      setIsInstalled(true);

      setDeferredPrompt(null);

      toast.success("GateLab installed\! You can now launch it offline from your home screen.");

    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    window.addEventListener("appinstalled", onAppInstalled);

    return () \=\> {

      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);

      window.removeEventListener("appinstalled", onAppInstalled);

    };

  }, \[\]);

  if (isInstalled) {

    return (

      \<span

        className="hidden sm:inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-\[10px\] text-emerald-400"

        title="GateLab PWA is installed and ready for offline use"

      \>

        \<CheckCircle2 className="size-3" /\>

        \<span\>Offline App\</span\>

      \</span\>

    );

  }

  if (\!deferredPrompt && \!isIosSafari) return null;

  const handleInstallClick \= async () \=\> {

    if (deferredPrompt) {

      await deferredPrompt.prompt();

      const choice \= await deferredPrompt.userChoice;

      if (choice.outcome \=== "accepted") {

        setDeferredPrompt(null);

      }

      return;

    }

    if (isIosSafari) {

      setShowIosGuide((v) \=\> \!v);

    }

  };

  return (

    \<div className="relative"\>

      \<Button

        variant="outline"

        size="sm"

        onClick={handleInstallClick}

        className="h-8 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"

        title="Install GateLab as an offline app on your phone, tablet, or desktop"

      \>

        \<Download className="size-3.5" /\>

        \<span className="hidden sm:inline"\>Install App\</span\>

      \</Button\>

      {showIosGuide && (

        \<div className="absolute right-0 top-10 z-50 w-72 rounded-lg border bg-card p-3.5 shadow-xl text-xs space-y-2"\>

          \<div className="flex items-center justify-between"\>

            \<span className="font-semibold flex items-center gap-1.5 text-foreground"\>

              \<Smartphone className="size-4 text-primary" /\>

              Install on iPhone / iPad

            \</span\>

            \<button

              type="button"

              onClick={() \=\> setShowIosGuide(false)}

              className="text-muted-foreground hover:text-foreground"

            \>

              \<X className="size-3.5" /\>

            \</button\>

          \</div\>

          \<ol className="list-decimal pl-4 space-y-1.5 text-muted-foreground"\>

            \<li\>

              Tap the Safari \<strong className="text-foreground"\>Share\</strong\> button{" "}

              \<Share className="inline size-3.5 text-sky-400" /\> in your browser bar.

            \</li\>

            \<li\>

              Scroll down and tap \<strong className="text-foreground"\>\&ldquo;Add to Home Screen\&rdquo;\</strong\>.

            \</li\>

            \<li\>

              Tap \<strong className="text-foreground"\>Add\</strong\> to launch GateLab full-screen with offline support.

            \</li\>

          \</ol\>

        \</div\>

      )}

    \</div\>

  );

}

### 4.4 Step 4 — Mobile Touch Pinch-to-Zoom & Single-Finger Pan in `src/hooks/use-viewbox.ts`

To make the PWA genuinely usable on mobile phones and tablets (resolving `XBR-01`), update `src/hooks/use-viewbox.ts` so two-finger touch gestures smoothly pinch-zoom around the midpoint between fingers, and single-finger dragging on empty canvas/breadboard areas pans the camera:

// Drop-in multi-touch pinch-zoom and primary-drag panning handlers for src/hooks/use-viewbox.ts

const activePointers \= useRef\<Map\<number, { x: number; y: number }\>\>(new Map());

const lastPinchDist \= useRef\<number | null\>(null);

const handlePointerDown \= useCallback((e: React.PointerEvent\<SVGSVGElement\>) \=\> {

  activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.current.size \=== 2\) {

    const pts \= \[...activePointers.current.values()\];

    lastPinchDist.current \= Math.hypot(pts\[1\]\!.x \- pts\[0\]\!.x, pts\[1\]\!.y \- pts\[0\]\!.y);

  }

}, \[\]);

const handlePointerMove \= useCallback(

  (e: React.PointerEvent\<SVGSVGElement\>): boolean \=\> {

    if (\!activePointers.current.has(e.pointerId)) return false;

    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size \=== 2\) {

      const pts \= \[...activePointers.current.values()\];

      const dist \= Math.hypot(pts\[1\]\!.x \- pts\[0\]\!.x, pts\[1\]\!.y \- pts\[0\]\!.y);

      if (lastPinchDist.current && lastPinchDist.current \> 8\) {

        const scale \= dist / lastPinchDist.current;

        const midX \= (pts\[0\]\!.x \+ pts\[1\]\!.x) / 2;

        const midY \= (pts\[0\]\!.y \+ pts\[1\]\!.y) / 2;

        zoomAtPoint(scale, midX, midY);

      }

      lastPinchDist.current \= dist;

      return true;

    }

    return false;

  },

  \[zoomAtPoint\],

);

const handlePointerUp \= useCallback((e: React.PointerEvent\<SVGSVGElement\>) \=\> {

  activePointers.current.delete(e.pointerId);

  if (activePointers.current.size \< 2\) {

    lastPinchDist.current \= null;

  }

}, \[\]);

---

## 5\. Master Implementation Prompt for Antigravity

Copy and paste the prompt block below directly into **Antigravity** to implement all four deliverables cleanly across the GateLab repository:

You are working on the GateLab repository (Next.js App Router, TypeScript, Tailwind CSS, Zustand, Lucide React). Implement the following 4 cohesive upgrades across the codebase while preserving all existing simulation invariants (\`buildNetIndex\` union-find, \`evaluate\` double-buffered delta-cycle solver, \`simulateTimed\` Gray-code sweep, and \`verify\` 2^n bridge):

\#\#\# Task 1: Overhaul \`/manual\` (\`src/app/manual/page.tsx\`) and Header Navigation (\`src/components/site-header.tsx\`)

1\. In \`src/components/site-header.tsx\`, visually separate \`Manual\` from the 4 numbered workflow stages (\`1. Theory\`, \`2. Diagram\`, \`3. Lab\`, \`4. Report\`) using a vertical \`\<Separator orientation="vertical" className="h-4" /\>\` or group \`Manual\` and a new \`Quickstart\` trigger on the right beside \`Feedback\`.

2\. In \`src/app/manual/page.tsx\`, update all outdated wiring and shortcut instructions:

   \- Clarify that clicking a wire in the Lab or Breadboard \*\*selects\*\* it (opening the docked Selected Wire Action HUD to change wire color or delete it, and exposing the white draggable horizontal channel handle), while \*\*\`Alt \+ Click\`\*\* or \*\*\`Delete\` / \`Backspace\`\*\* deletes a wire.

   \- Document the \*\*MODEL 74XX-TTL · 5V BENCH Digital Logic Trainer\*\* chassis modules:

     \- \*\*DC Power Supply (\`+5.0V VCC\` & \`0.0V GND\`)\*\* and the \*\*\`⚡ Auto-Power\`\*\* button.

     \- \*\*Pulse / Clock Generator (\`PULSE\`, \`CLR\`, \`1Hz\`, \`2Hz\`, \`5Hz\`, \`CLK OUT\`)\*\*.

     \- \*\*Logic Indicators (\`+ LED\`, 7-color lens cycler dot, \`0/1/Z/X\` 4-state readout)\*\*.

     \- \*\*Logic Input Switches (\`+ Input\`, physical toggle bat lever, \`OUT\` banana socket)\*\*.

   \- Document the \*\*3 Physical Breadboard Rules\*\*: 5-hole vertical strips (\`A–E\` and \`F–J\` separated by the center ravine), 1 leg/jumper per hole (\`E\`/\`F\` for IC legs, \`A–D\` and \`G–J\` for jumpers), and the \*\*Column 32/33 Midpoint Power Rail Break\*\*.

   \- Add the \*\*74xx TTL Pinout & Exceptions Table\*\* covering all 17 ICs (\`7400\`–\`74175\`), explicitly warning about:

     \- \`7402\` left-half output-first pins (\`Pin 1 \= 1Y\`, \`Pin 4 \= 2Y\`)

     \- \`7404\` right-half reversed pins (\`Pin 8 \= 4Y\`)

     \- \`7410\` / \`7411\` / \`7427\` wrapped Gate 1 (\`Pins 1, 2, 13 \-\> Pin 12\`)

     \- \`7420\` / \`7421\` / \`7430\` \`NC\` pins (marked with red \`✕\`)

     \- \`74174\` / \`74175\` 16-pin corner supply (\`Pin 16 \= VCC\`, \`Pin 8 \= GND\`)

     \- \*\*\`74LS76A\` 16-pin non-corner center supply (\`Pin 5 \= VCC\`, \`Pin 13 \= GND\`)\*\*

   \- Document \*\*X-Ray Mode (\`X\`)\*\*, \*\*Airwires (\`A\`)\*\*, \*\*Ravine IC Dragging\*\* (which shifts attached strip jumpers automatically), \*\*Sequential Power-Up Unknown (\`X\`) State\*\* (requiring \`CLR\` initialization before counting), the \*\*Dual Timing Engine\*\* (Unit-delay palindromic Gray-code sweep up to 7 inputs vs. 18-cycle clocked sequential waveform), and the \*\*Verification Bridge\*\* (variable-label alignment up to 16 inputs, Tarjan SCC feedback detection, and the 5 automated fault hypotheses).

\#\#\# Task 2: Add the Interactive Visual Quickstart & Tutorial (\`src/components/quickstart/quickstart-tutorial.tsx\`)

1\. Create \`src/components/quickstart/quickstart-tutorial.tsx\` with a 4-stage interactive tutorial covering:

   \- \*\*Stage 01 (\`Theory\`)\*\*: Truth tables, K-map prime implicant loops, Quine–McCluskey reduction, and component constraints (\`All parts\`).

   \- \*\*Stage 02 (\`Diagram\`)\*\*: Block diagrams, \`Equation\` auto-wiring, custom IC grouping (\`G\`), and \`LaTeX TikZ (.tex)\` / \`SVG\` / \`4× PNG\` exports.

   \- \*\*Stage 03 (\`Practical Lab\`)\*\*: Schematic vs. 74xx Breadboard seating, \`⚡ Auto-Power\`, X-Ray (\`X\`), Airwires (\`A\`), \`CLR\` \+ \`PULSE\` clocking, and static hazard timing analysis.

   \- \*\*Stage 04 (\`Verification & Report\`)\*\*: Exhaustive \$2^n\$ truth-table diffing, Fault Inspector (\`\]\`), and printable lab reports.

2\. Include custom inline SVG visual demonstrations for each of the 4 stages and a \*\*"Try Stage Live"\*\* CTA button that loads a sample function (\`F(A,B,C) \= A'C \+ BC\`) into \`workspace-store\`, \`spec-store\`, and \`circuit-store\` and navigates to the selected stage.

3\. Render \`\<QuickstartTutorial /\>\` at the top of \`src/app/manual/page.tsx\` (under a prominent Quickstart tab/section) and expose a \`Quickstart\` modal trigger in \`src/components/site-header.tsx\`.

\#\#\# Task 3: Add Client-Side Execution Terms & Minimum System Check Gate (\`src/components/legal/terms-and-system-gate.tsx\`)

1\. Create \`src/components/legal/terms-and-system-gate.tsx\` and mount it in \`src/app/layout.tsx\`.

2\. On first visit (checked via \`localStorage.getItem("gatelab-terms-accepted-v1")\`), run an automated client-side capability diagnostic checking:

   \- \`Uint8Array\`, \`Int32Array\`, and \`BigInt\` support

   \- \`SVGSVGElement\` and \`PointerEvent\` support

   \- \`window.localStorage\` read/write availability

   \- \`navigator.hardwareConcurrency\` (minimum 2 logical cores recommended for \$2^{16}\$ sweeps) and \`navigator.deviceMemory\`

3\. Display the live diagnostic scorecard alongside the 4-clause Client-Side Execution Terms & Conditions (100% in-browser execution with zero server uploads, local CPU/RAM resource acknowledgement, hardware bench safety disclaimer, and As-Is educational provision).

4\. Require the user to check the agreement checkbox and click \*\*"Agree & Launch GateLab"\*\* before dismissing the modal and persisting \`"gatelab-terms-accepted-v1" \= "true"\`. Add a "Terms & System Check" link in the site footer / manual to re-open the modal at any time.

\#\#\# Task 4: Convert GateLab into an Installable, Offline-Ready Mobile & Desktop PWA

1\. Create \`src/app/manifest.ts\` configuring \`display: "standalone"\`, \`background\_color: "\#020617"\`, \`theme\_color: "\#020617"\`, app icons (\`/icons/icon-192.png\`, \`/icons/icon-512.png\`, \`/icons/icon.svg\`), and shortcuts to \`/theory\`, \`/diagram\`, \`/lab\`, and \`/manual\`.

2\. Create \`public/sw.js\` implementing an offline-first Service Worker that precaches \`/\`, \`/theory\`, \`/diagram\`, \`/lab\`, \`/report\`, and \`/manual\` and uses Stale-While-Revalidate for \`/\_next/static/\*\` assets so the entire simulator works offline.

3\. Create \`src/components/pwa/install-pwa-button.tsx\` and mount it in \`src/components/site-header.tsx\`. It must register \`/sw.js\`, handle \`beforeinstallprompt\` for 1-click install on Android/Chrome/Edge/Desktop, and detect iOS/iPadOS Safari to display a clean \*\*"Tap Share → Add to Home Screen"\*\* guide popover.

4\. Ensure \`src/hooks/use-viewbox.ts\` and \`src/components/lab/breadboard-view.tsx\` support two-finger touch pinch-to-zoom and single-finger pan on empty canvas/chassis areas (\`touch-none\`), and show a dismissible "Rotate device to landscape for best Breadboard experience" banner on narrow portrait mobile screens (\`\< 640px\`).

5\. Run \`npm run build\` and \`npm test\` to verify zero TypeScript, ESLint, or SSR hydration errors.