"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Blocks,
  BookOpen,
  CircuitBoard,
  Cpu,
  Eye,
  Keyboard,
  Layers,
  MessageSquare,
  Network,
  Search,
  ShieldCheck,
  Sigma,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { GithubIcon } from "@/components/shared/github-icon";
import { GateReference, LogicValues } from "@/components/manual/gate-reference";
import { IcReference } from "@/components/manual/ic-reference";
import { QuickstartTutorial } from "@/components/quickstart/quickstart-tutorial";
import { openTermsModal } from "@/components/legal/terms-and-system-gate";
import { CONTACT } from "@/lib/feedback";
import { CONSTRAINTS } from "@/lib/simulation/constraints";

/**
 * The user manual.
 *
 * Written for the person who opened Gatelab and does not yet know what it is FOR.
 * Every section answers a question someone actually asks at the bench, and the
 * parts of it that could drift from the code — the chip list, the gate rules —
 * are read from the code rather than retyped here.
 */

const NOTATION = [
  { write: "A'  !A  ~A  ¬A", means: "NOT A", note: "any of the four" },
  { write: "AB   A·B   A*B   A&B", means: "A AND B", note: "juxtaposition is AND" },
  { write: "A + B   A|B", means: "A OR B", note: "" },
  { write: "A ^ B   A⊕B", means: "A XOR B", note: "" },
  { write: "0   1", means: "constants", note: "tie to GND / +5V" },
  {
    write: "F(A,B,C) = Σm(1,3,7)",
    means: "sum of minterms",
    note: "the rows where F = 1",
  },
  {
    write: "F(A,B,C) = Σm(1,3) + d(6,7)",
    means: "with don't-cares",
    note: "rows you are free to choose",
  },
  { write: "F(A,B,C) = ΠM(0,2)", means: "product of maxterms", note: "the rows where F = 0" },
] as const;

/**
 * The 17 74xx TTL integrated circuits, their packages, power supplies,
 * and datasheet exceptions / bench traps.
 */
const TTL_EXCEPTIONS_CATALOG = [
  {
    part: "7400 / 7408 / 7432 / 7486",
    fn: "Quad 2-in NAND / AND / OR / XOR",
    pkg: "DIP-14",
    pwr: "Pin 14 / Pin 7",
    trap: "Standard pinout: Gates 1–4 inputs and outputs run in order (1,2→3; 4,5→6; 9,10→8; 12,13→11).",
    highlight: false,
  },
  {
    part: "7402",
    fn: "Quad 2-in NOR",
    pkg: "DIP-14",
    pwr: "Pin 14 / Pin 7",
    trap: "Output-First Trap: Left half puts outputs on Pins 1 and 4! Gate 1 is inputs (2, 3) → Pin 1 (1Y); Gate 2 is inputs (5, 6) → Pin 4 (2Y). Right half returns to Y on pins 10 and 13.",
    highlight: "amber",
  },
  {
    part: "7404",
    fn: "Hex Inverter (NOT)",
    pkg: "DIP-14",
    pwr: "Pin 14 / Pin 7",
    trap: "Right-Half Reversed: Left side is 1→2, 3→4, 5→6. Right side reverses direction: Pin 8 is 4Y (input on Pin 9 = 4A), Pin 10 is 5Y, Pin 12 is 6Y.",
    highlight: "amber",
  },
  {
    part: "7410 / 7411 / 7427",
    fn: "Triple 3-in NAND / AND / NOR",
    pkg: "DIP-14",
    pwr: "Pin 14 / Pin 7",
    trap: "Wrapped Gate 1: Gate 1's pins wrap across the notch: inputs on Pins 1, 2, and 13 → output 1Y on Pin 12! Gate 2 is (3,4,5→6); Gate 3 is (9,10,11→8).",
    highlight: "amber",
  },
  {
    part: "7420 / 7421",
    fn: "Dual 4-in NAND / AND",
    pkg: "DIP-14",
    pwr: "Pin 14 / Pin 7",
    trap: "NC Pins: Pins 3 and 11 are No Connect (NC). Gate 1 is (1,2,4,5→6); Gate 2 is (9,10,12,13→8).",
    highlight: false,
  },
  {
    part: "7430",
    fn: "8-input NAND",
    pkg: "DIP-14",
    pwr: "Pin 14 / Pin 7",
    trap: "NC Pins & Opposite Output: Pins 9, 10, and 13 are NC. Eight inputs on Pins 1,2,3,4,5,6,11,12. The single output 1Y sits on Pin 8 directly opposite GND.",
    highlight: false,
  },
  {
    part: "7474",
    fn: "Dual D Flip-Flop (+Edge)",
    pkg: "DIP-14",
    pwr: "Pin 14 / Pin 7",
    trap: "Active-low async CLR (pins 1, 13) and PRE (pins 4, 10) must be tied to +5V (VCC) for normal clocking. Powers up at X (unknown) until CLR is pulsed low.",
    highlight: false,
  },
  {
    part: "74LS76A",
    fn: "Dual JK Flip-Flop (-Edge) with PRE/CLR",
    pkg: "DIP-16",
    pwr: "Pin 5 / Pin 13",
    trap: "Non-Corner Center Supply Trap: 16-pin package where VCC is Pin 5 and GND is Pin 13 (Pin 16 is 1K, Pin 8 is 2CLR). Wiring it like a 7474 leaves it unpowered!",
    highlight: "red",
  },
  {
    part: "74LS107A",
    fn: "Dual JK Flip-Flop (-Edge)",
    pkg: "DIP-14",
    pwr: "Pin 14 / Pin 7",
    trap: "Clear only (no preset). Classic ripple-counter part: tie J and K to +5V and pulse CLK. Pin 1 is 1J, Pin 7 is GND, Pin 14 is VCC.",
    highlight: false,
  },
  {
    part: "74175",
    fn: "Quad D Register (+Edge)",
    pkg: "DIP-16",
    pwr: "Pin 16 / Pin 8",
    trap: "16-pin corner supply (Pin 16 = VCC, Pin 8 = GND). Four D flip-flops sharing common CLK (Pin 9) and common active-low CLR (Pin 1). Both Q and Q̄ outputs.",
    highlight: false,
  },
  {
    part: "74174",
    fn: "Hex D Register (+Edge)",
    pkg: "DIP-16",
    pwr: "Pin 16 / Pin 8",
    trap: "16-pin corner supply (Pin 16 = VCC, Pin 8 = GND). Six D flip-flops sharing common CLK (Pin 9) and common active-low CLR (Pin 1). True Q outputs only (no Q̄).",
    highlight: false,
  },
] as const;

/**
 * The sequential packages, as a reader needs them: what it is, and the one
 * thing about it that is not like the others.
 */
const FLIP_FLOPS = [
  {
    part: "7474",
    what: "Dual D flip-flop, positive edge, with asynchronous preset and clear.",
    watch: "The workhorse. Vcc on 14, GND on 7, like the gates.",
  },
  {
    part: "74LS76A",
    what: "Dual J-K flip-flop, negative edge, with preset and clear.",
    watch:
      "Vcc is pin 5 and GND is pin 13 — not the corners. Wire it like a 7474 and the chip never powers up. (The plain 7476 shares this pinout but is pulse-triggered rather than edge-triggered; the edge-triggered part is the one modelled, so it is the one named.)",
  },
  {
    part: "74LS107A",
    what: "Dual J-K flip-flop, negative edge, clear only — no preset.",
    watch: "The usual ripple-counter part: tie J and K high and it toggles.",
  },
  {
    part: "74175",
    what: "Quad D flip-flop with one shared clock and one shared clear — a 4-bit register.",
    watch:
      "The shared clock is the point. Wire each Q to the next D and the same chip is a shift register.",
  },
  {
    part: "74174",
    what: "Hex D flip-flop, shared clock and clear. A 6-bit register.",
    watch: "No complementary outputs — Q only.",
  },
] as const;

const FAULTS = [
  {
    code: "UNPOWERED_IC",
    what: "A chip has no +5V on pin 14 (or pin 5/16), or no GND on pin 7 (or pin 13/8).",
    fix: "Wire the rails or click Auto-Power. An unpowered TTL chip drives nothing — its outputs sit at Z, and the whole downstream circuit floats. This is the single most common bench mistake, and it is why the fault exists.",
  },
  {
    code: "FLOATING_INPUT",
    what: "A gate input is connected to nothing.",
    fix: "A real TTL input left floating drifts HIGH, unreliably. Gatelab refuses to guess: it propagates X. Tie the input to +5V or GND, or wire it to a valid signal source.",
  },
  {
    code: "OUTPUT_SHORT",
    what: "Two gate outputs are wired to each other and disagree.",
    fix: "On a real board this is a short between a totem-pole HIGH and a totem-pole LOW, and it is the one that gets hot. Delete one of the wires.",
  },
  {
    code: "OUTPUT_DRIVES_RAIL",
    what: "A gate output is wired directly to +5V or GND.",
    fix: "The rail always wins and the gate is fighting it. You almost certainly meant to wire an INPUT to the rail.",
  },
  {
    code: "RAIL_SHORT",
    what: "+5V and GND are on the same net.",
    fix: "Dead short across the power supply. Find and delete the jumper that bridges the positive and negative rails.",
  },
  {
    code: "OSCILLATION",
    what: "A feedback loop never settles — an odd number of inversions round a ring.",
    fix: "Combinational logic must be acyclic. Break the loop, unless a ring oscillator is what you wanted.",
  },
  {
    code: "UNUSED_GATE",
    what: "Some gates in a package are not used.",
    fix: "Not an error — just a note. On a real board you would tie their inputs to a rail rather than leave them floating.",
  },
] as const;

const SHORTCUTS = [
  { keys: "Click wire", does: "Select wire (opens HUD for color/delete & exposes draggable routing handle)" },
  { keys: "Alt+Click wire", does: "Delete wire instantly" },
  { keys: "Delete / Backspace", does: "Delete selected wire or component" },
  { keys: "Drag white handle", does: "Adjust wire horizontal Manhattan routing channel (snappedY)" },
  { keys: "Click pin, click pin", does: "Wire two pins or breadboard holes together" },
  { keys: "Click switch lever / Space", does: "Toggle logic switch between 0 (LOW) and 1 (HIGH)" },
  { keys: "PULSE button", does: "Fire a complete 0 → 1 → 0 clock pulse (advances rising & falling edge ICs)" },
  { keys: "CLR button", does: "Reset sequential flip-flops from power-up X to 0" },
  { keys: "X", does: "Toggle DIP internal gate / flip-flop X-Ray view on breadboard" },
  { keys: "A", does: "Toggle unrouted schematic Airwires rat's nest guide" },
  { keys: "F", does: "Toggle Zen fullscreen mode" },
  { keys: "[ or B", does: "Toggle Parts palette sidebar" },
  { keys: "]", does: "Toggle Faults & Verification inspector" },
  { keys: "R / Shift+R", does: "Rotate selected gate or IC 90° CW / CCW" },
  { keys: "H / V", does: "Flip selected gate horizontally / vertically" },
  { keys: "G / Shift+G", does: "Group selection into reusable IC / Ungroup (Diagram workbench)" },
  { keys: "Esc", does: "Cancel wire drawing or clear active selection" },
  { keys: "Tab / Shift+Tab", does: "Focus next / previous component or control" },
  { keys: "Space / Enter", does: "Select focused part or toggle focused switch" },
  { keys: "⌘Z / Ctrl-Z", does: "Undo" },
  { keys: "⇧⌘Z / Ctrl-Shift-Z", does: "Redo" },
  { keys: "Scroll / pinch", does: "Zoom canvas (anchored to cursor or touch center)" },
  { keys: "Drag background", does: "Pan canvas with velocity inertia" },
] as const;

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Icon className="text-logic-high size-4 shrink-0" />
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

const TOC = [
  { id: "quickstart", label: "Interactive quickstart" },
  { id: "start", label: "Start here" },
  { id: "writing", label: "Writing a function" },
  { id: "theory", label: "The theory workspace" },
  { id: "rules", label: "Gate rules" },
  { id: "diagrams", label: "The diagram editor" },
  { id: "lab", label: "The lab" },
  { id: "blocks", label: "Presets & building blocks" },
  { id: "gates", label: "Logic gates" },
  { id: "chips", label: "74xx chips & exceptions" },
  { id: "breadboard", label: "Trainer chassis & breadboard" },
  { id: "sequential", label: "Flip-flops & counters" },
  { id: "faults", label: "Faults" },
  { id: "verify", label: "Verification" },
  { id: "timing", label: "Timing and hazards" },
  { id: "report", label: "The report" },
  { id: "keys", label: "Shortcuts & gestures" },
  { id: "terms", label: "Terms & system check" },
  { id: "contact", label: "Contact" },
] as const;

export default function ManualPage() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>("quickstart");
  const q = query.trim().toLowerCase();

  const filteredToc = TOC.filter(
    (item) => q === "" || item.label.toLowerCase().includes(q) || item.id.includes(q),
  );

  useEffect(() => {
    const sections = TOC.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[];
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-15% 0px -75% 0px" },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          <BookOpen className="text-logic-high size-6" />
          User manual
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm text-pretty">
          Gatelab takes a Boolean function from algebra to a wired TTL circuit, and
          then checks that the circuit you built actually computes the function you
          derived. This is how to drive it.
        </p>
      </header>

      {/* Mobile outline jump drawer */}
      <div className="mb-6 lg:hidden">
        <details className="rounded-lg border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">
            Table of contents ({TOC.length} topics)
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
            {TOC.map(({ id, label }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="text-muted-foreground hover:text-foreground block rounded py-1 transition-colors"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* Sticky Desktop Table of Contents with quick search */}
        <nav className="hidden lg:block">
          <div className="sticky top-20 space-y-3">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter topics..."
                className="h-8 pl-8 text-xs"
                aria-label="Filter manual topics"
              />
            </div>
            <ul className="space-y-0.5 text-sm">
              {filteredToc.map(({ id, label }) => {
                const isActive = activeId === id;
                return (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className={cn(
                        "block rounded px-2.5 py-1 text-xs transition-colors",
                        isActive
                          ? "bg-secondary text-secondary-foreground font-medium border-l-2 border-logic-high pl-2"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                      )}
                    >
                      {label}
                    </a>
                  </li>
                );
              })}
              {filteredToc.length === 0 && (
                <li className="text-muted-foreground px-2 py-2 text-xs italic">
                  No matching topics found
                </li>
              )}
            </ul>
          </div>
        </nav>

        <div className="min-w-0 space-y-10">
          <Section id="quickstart" icon={Sparkles} title="Interactive Visual Quickstart">
            <p className="text-muted-foreground">
              New to GateLab or exploring its digital logic design pipeline? Follow this 4-step tutorial
              demonstrating how algebraic derivation connects directly to 74xx breadboard construction and $2^n$ verification.
            </p>
            <div className="pt-2">
              <QuickstartTutorial />
            </div>
          </Section>

          <Section id="start" icon={CircuitBoard} title="Start here">
            <p>
              The whole product is one loop, and it is worth doing once end to end
              before anything else:
            </p>
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>
                In <Link href="/theory" className="underline underline-offset-4">Theory</Link>,
                write a function — say{" "}
                <code>F(A,B,C) = A&apos;B + BC</code>. It is minimized as you type.
              </li>
              <li>
                Open the{" "}
                <Link href="/theory?tab=build" className="underline underline-offset-4">
                  <strong>Build it</strong>
                </Link>{" "}
                tab in Theory (or navigate to{" "}
                <Link href="/build" className="underline underline-offset-4 font-mono text-xs">
                  /build
                </Link>
                ) and press <em>Build this circuit in the lab</em>. Real 74xx chips appear, wired,
                with the power rails already connected.
              </li>
              <li>
                In the <Link href="/lab" className="underline underline-offset-4">Lab</Link>,
                open <strong>Verify</strong>. It sweeps all 2ⁿ input combinations
                through the circuit and diffs the result against your algebra.
              </li>
              <li>
                Now break it on purpose — pull the wire off pin 14 — and watch the
                lab tell you exactly what you did.
              </li>
            </ol>
            <p className="text-muted-foreground">
              You never have to go through Theory, though. The lab has its own{" "}
              <strong>From equation</strong> button, and you can wire a circuit up
              from nothing and verify it against a target you type in later.
            </p>
          </Section>

          <Section id="writing" icon={Sigma} title="Writing a function">
            <p>
              Everything lands on the same function, whichever way you write it. The
              parser accepts all of the usual notations, so you can type what your
              textbook uses:
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <tbody>
                  {NOTATION.map(({ write, means, note }) => (
                    <tr key={write} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {write}
                      </td>
                      <td className="px-3 py-2">{means}</td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">
                        {note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground">
              Juxtaposition is AND, so <code>AB</code> is <code>A AND B</code>. An
              apostrophe is NOT, so <code>A&apos;</code> is <code>NOT A</code>.
            </p>
          </Section>

          <Section id="theory" icon={BookOpen} title="The theory workspace">
            <p>
              Type an expression at the top, or click outputs in the truth table or
              K-map. Every view updates as you type:
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <strong>Truth table</strong> — click any output bit to cycle it through
                0, 1 and X (don&apos;t care).
              </li>
              <li>
                <strong>K-map</strong> — rendered with the prime implicants looped. The
                loops are not re-derived for the drawing; they are the Quine–McCluskey
                result, drawn.
              </li>
              <li>
                <strong>Derivation</strong> — Quine–McCluskey step by step: grouping by
                number of 1s, matching terms that differ by one bit, and the prime
                implicant chart that picks the essential ones.
              </li>
              <li>
                <strong>Canonical forms</strong> — minterm list (Σm), maxterm list
                (ΠM), and the numeric vectors.
              </li>
            </ul>
          </Section>

          <Section id="rules" icon={CircuitBoard} title="Gate rules">
            <p>
              &ldquo;Implement this using NAND only&rdquo; is not a suggestion — in a
              digital logic course it is the whole exercise. So the rule is chosen
              before you build:
            </p>
            <div className="space-y-2">
              {CONSTRAINTS.map((c) => (
                <div key={c.id} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {c.parts.join(", ")}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">{c.description}</p>
                </div>
              ))}
            </div>
            <p>
              When a rule is active, the palette narrows to match — you cannot place
              gates you are not allowed to use — and the synthesizer is steered by it,
              so <em>Build this circuit</em> obeys the rule rather than apologizing
              for breaking it.
            </p>
            <p className="text-muted-foreground">
              The power rails matter here. A constant 1 is not 0-preserving, so having
              +5V on the board makes <code>&#123;XOR, AND&#125;</code> universal when it
              would otherwise be useless.
            </p>
          </Section>

          <Section id="diagrams" icon={Network} title="The diagram editor">
            <p>
              <strong>Diagram</strong> is a canvas. Drag a block out of the palette,
              drag from one of its pins to another block&apos;s pin to wire them, and
              drag the blocks around until it reads the way you want.
            </p>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              <li>Drag a pin to a pin to wire them. Click a wire to select it.</li>
              <li>Drag empty space to marquee-select. Hold ⌥ or drag with the middle button to pan; ⌘-scroll to zoom.</li>
              <li><kbd className="rounded border px-1">R</kbd> rotates the selection a quarter turn, ⇧<kbd className="rounded border px-1">R</kbd> the other way.</li>
              <li>Arrow keys nudge one grid step, ⇧ and an arrow one pixel. Hold ⌘ while dragging to ignore the grid entirely.</li>
              <li>⌘Z / ⇧⌘Z undo and redo. ⌘D duplicates. ⌫ deletes.</li>
              <li><strong>Arrange</strong> tidies everything into left-to-right dataflow, and the result is still yours to move.</li>
            </ul>

            <h3 className="pt-1 text-sm font-medium">Getting the wires straight</h3>
            <p>
              A pin sits at a fraction of its block&apos;s height, and two different
              parts almost never line up — so a rough drag used to leave a small
              two-bend jog in the middle of a wire that plainly wanted to be
              straight. While you are dragging, a block within a few pixels of
              straightening one of its wires is now pulled the rest of the way, and a
              whole bus of them agrees on one shift.
            </p>

            <h3 className="pt-1 text-sm font-medium">Building bigger things</h3>
            <p>
              Select several blocks and press <kbd className="rounded border px-1">G</kbd>.
              They fold into <em>one</em> block, which joins the palette and can be
              placed as many times as you like. Build a 4-bit adder once, group it,
              place it four times — that is a 16-bit adder, and it is how every real
              digital system is put together.
            </p>

            <h3 className="pt-1 text-sm font-medium">Exporting</h3>
            <p>
              <strong>SVG</strong> first, and deliberately. It is a vector, it stays
              sharp at any size, Word and Google Docs both accept it, and you can open
              it afterwards to add an annotation the tool did not think of. PNG is
              there at 1×, 2× and 4× for submission portals that refuse anything else,
              and <strong>File → Save as JSON</strong> keeps the editable document.
            </p>
            <p>
              <strong>LaTeX</strong> is there for reports written in LaTeX, where a
              PNG of a circuit has the wrong fonts, the wrong line weights and goes
              soft in print. It writes a TikZ picture of the same drawing — download a
              standalone <code>.tex</code> you can compile on its own, or copy the
              figure straight into your document.
            </p>
          </Section>

          <Section id="lab" icon={CircuitBoard} title="The lab">
            <p>
              Drag parts from the palette. Click one pin, then another, to wire them —
              the wire routes itself around obstacles. Click a switch to toggle it.
            </p>

            <div className="rounded-md border p-3 bg-card/60">
              <h3 className="text-sm font-semibold mb-1">Wire Selection &amp; Routing Controls</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Clicking any wire on the Schematic or Breadboard <strong>selects</strong> it:
              </p>
              <ul className="mt-1.5 list-disc pl-5 text-xs text-muted-foreground space-y-1">
                <li>
                  <strong>Action HUD:</strong> A docked toolbar opens allowing you to recolor the wire across 8 distinct hues or delete it.
                </li>
                <li>
                  <strong>Horizontal Routing Handle:</strong> A circular white handle appears along the horizontal segment. Drag this handle up or down to adjust its Manhattan routing channel (<code>snappedY</code>) without moving the connected pins.
                </li>
                <li>
                  <strong>Quick Delete:</strong> Hold <kbd className="px-1 py-0.5 rounded border bg-muted font-mono">Alt</kbd> and click a wire, or press <kbd className="px-1 py-0.5 rounded border bg-muted font-mono">Delete</kbd> / <kbd className="px-1 py-0.5 rounded border bg-muted font-mono">Backspace</kbd> while selected, to delete it instantly.
                </li>
              </ul>
            </div>

            <p>
              <strong>Logic is four-state: 0, 1, Z and X.</strong> Z is a floating,
              undriven net — not zero. X is a conflict or power-up indeterminate state. This is the difference between
              a simulator that tells you your circuit works and one that tells you the
              truth: a boolean simulator reads an unconnected input as false and stays
              quiet.
            </p>
            <p>
              Wires are colored <strong>by net</strong>, cycling through eight hues,
              for the same reason real jumper wire is multicolored — so you can trace
              one. But Z and X keep their own unmistakable color and dashing. A broken
              wire must never be able to look like a working one.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 pt-1">
              <div className="rounded-md border p-3">
                <h4 className="font-semibold text-xs flex items-center gap-1.5">
                  <Eye className="size-3.5 text-primary" /> X-Ray Mode (Hotkey X)
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Press <kbd className="px-1 rounded border bg-muted font-mono">X</kbd> in Breadboard view to reveal the live internal logic gate and flip-flop symbols inside every DIP package, color-coded by electrical state.
                </p>
              </div>
              <div className="rounded-md border p-3">
                <h4 className="font-semibold text-xs flex items-center gap-1.5">
                  <Layers className="size-3.5 text-sky-400" /> Airwires &amp; Ravine Dragging
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Press <kbd className="px-1 rounded border bg-muted font-mono">A</kbd> to show unrouted rat&apos;s-nest airwires. Drag any IC horizontally along the center ravine to re-seat it — attached strip jumpers automatically translate with the pins!
                </p>
              </div>
            </div>
          </Section>

          <Section id="blocks" icon={Blocks} title="Presets & building blocks">
            <p>
              The <strong>Presets</strong> menu is organized around one idea: complex circuits are built from simple
              ones.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <strong>Building blocks</strong> — half and full adders, comparators, multiplexers, decoders, priority encoders.
              </li>
              <li>
                <strong>Hierarchical blocks</strong> — full adders wired from two half adders and an OR; 4:1 mux as a tree of three 2:1 muxes; 8:1 mux from two 4:1s and a 2:1.
              </li>
              <li>
                <strong>Large circuits</strong> — 2-, 4-, 8- and 16-bit ripple-carry adders. Watch the top sum bit wait for the carry to walk all the way up.
              </li>
            </ul>
          </Section>

          <Section id="gates" icon={CircuitBoard} title="Logic gates">
            <p>
              The seven gates, what each one means, and the algebraic properties that
              decide how it behaves when you build with it.
            </p>
            <div className="pt-2">
              <h3 className="mb-2 text-sm font-medium">Before the gates: the four values</h3>
              <LogicValues />
            </div>
            <div className="pt-3">
              <GateReference />
            </div>
          </Section>

          <Section id="chips" icon={Cpu} title="74xx chips & exceptions">
            <p>
              The GateLab 74xx TTL integrated circuit catalog covers 17 standard DIP packages, transcribed
              directly from official Texas Instruments datasheets.
            </p>

            <Card className="border-border/80 my-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="size-4 text-primary" />
                  74xx TTL Integrated Circuit Catalog &amp; Pinout Exceptions
                </CardTitle>
                <CardDescription>
                  Review power supplies, pinout layouts, and non-standard traps before wiring on the bench.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground font-mono">
                        <th className="py-2 pr-3">Part</th>
                        <th className="py-2 px-3">Function</th>
                        <th className="py-2 px-3">Package</th>
                        <th className="py-2 px-3">VCC / GND</th>
                        <th className="py-2 pl-3">Datasheet Trap &amp; Pinout Rule</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-sans">
                      {TTL_EXCEPTIONS_CATALOG.map((item) => (
                        <tr
                          key={item.part}
                          className={cn(
                            item.highlight === "amber" && "bg-amber-500/5",
                            item.highlight === "red" && "bg-red-500/10 font-medium",
                          )}
                        >
                          <td className="py-2.5 pr-3 font-mono font-bold text-foreground whitespace-nowrap">
                            {item.part}
                          </td>
                          <td className="py-2.5 px-3">{item.fn}</td>
                          <td className="py-2.5 px-3 font-mono text-muted-foreground whitespace-nowrap">
                            {item.pkg}
                          </td>
                          <td
                            className={cn(
                              "py-2.5 px-3 font-mono font-semibold whitespace-nowrap",
                              item.highlight === "red" ? "text-red-400" : "text-logic-high",
                            )}
                          >
                            {item.pwr}
                          </td>
                          <td className="py-2.5 pl-3 text-muted-foreground leading-normal">
                            {item.trap}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <IcReference />
          </Section>

          <Section id="breadboard" icon={CircuitBoard} title="Trainer chassis & breadboard">
            <p>
              Switching from Schematic to <strong>Breadboard</strong> seats your components onto the
              <strong> MODEL 74XX-TTL · 5V BENCH Digital Logic Trainer</strong>, a high-fidelity virtual
              workbench with integrated power, pulsing, input switches, and logic indicators.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 pt-2">
              <div className="rounded-md border p-3 bg-card/60">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-red-400 mb-1">
                  1. DC Power Supply (+5.0V &amp; 0.0V GND)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Located top-left. Click the red <code>+5.0V (VCC)</code> or blue <code>0.0V (GND)</code> banana socket and click any rail hole to supply power. Or click <code className="text-amber-400">Auto-Power</code> in the top toolbar to automatically wire and bridge supplies for all seated ICs.
                </p>
              </div>

              <div className="rounded-md border p-3 bg-card/60">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">
                  2. Pulse / Clock Generator (PULSE, CLR, 1Hz–5Hz)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Wire the amber <code>CLK OUT</code> socket to flip-flop clock pins. Click <code>PULSE</code> for a clean 0 → 1 → 0 transition, <code>CLR</code> to reset flip-flops from power-up <code>X</code> to <code>0</code>, or toggle <code>1Hz / 2Hz / 5Hz</code> for continuous execution.
                </p>
              </div>

              <div className="rounded-md border p-3 bg-card/60">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-sky-400 mb-1">
                  3. Logic Input Switches (Bottom Chassis)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Click the physical toggle bat lever on any switch to toggle its logic state between <code>1 (HIGH)</code> and <code>0 (LOW)</code>. Click its blue <code>OUT</code> banana socket to route a jumper wire to the breadboard. Add more switches with <code>+ Input</code>.
                </p>
              </div>

              <div className="rounded-md border p-3 bg-card/60">
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                  4. Logic Indicators (Top-Right Chassis)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Each LED displays a real-time 4-state digital readout badge (<code>0</code>, <code>1</code>, <code className="text-amber-400">Z</code> floating, or <code className="text-red-400">X</code> conflict). Click the small lens dot beside any LED label to cycle across 7 lens colors (Green, Red, Amber, Blue, Cyan, Purple, White).
                </p>
              </div>
            </div>

            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs mt-3">
              <p className="font-semibold text-amber-300 flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="size-4 shrink-0" />
                Three Physical Breadboard Rules Modelled Strictly by GateLab:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                <li>
                  <strong>5-Hole Vertical Terminal Strips:</strong> In each column (1–63), holes A–E short together, and holes F–J short separately. They never meet across the center ravine.
                </li>
                <li>
                  <strong>One Leg or Jumper Per Hole:</strong> An IC leg occupies row E (pins 1..N/2) and row F (pins N/2+1..N). Jumper wires must plug into the remaining 4 free holes (A–D or G–J) in that column.
                </li>
                <li>
                  <strong>Midpoint Power Rail Split:</strong> Like physical 63-column breadboards, the +top, -top, +bottom, and -bottom rails break between <strong>Column 32 and Column 33</strong>. Bridge the split with jumper wires or click <code className="text-amber-400">Auto-Power</code> when placing ICs on the right half.
                </li>
              </ul>
            </div>
          </Section>

          <Section id="sequential" icon={CircuitBoard} title="Flip-flops, clocks and counters">
            <p>
              Combinational outputs depend solely on current inputs. Flip-flops introduce memory:
              their outputs change only at clock <strong>edges</strong>.
            </p>

            <div className="rounded-md border p-3.5 bg-card/60 my-2">
              <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2 mb-1">
                <AlertTriangle className="size-4" /> Why Flip-Flops Power Up at X (Unknown State)
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Real bistable multivibrators power up in an indeterminate state dictated by transistor mismatch. GateLab reflects physical reality: newly placed flip-flops start at <code>X</code>, and clocking <code>X</code> propagates <code>X</code>.
                <strong> You must click CLR on the Trainer Clock module (or Clear in the Clock Drawer) to initialize flip-flops to 0 before pulsing the clock!</strong>
              </p>
            </div>

            <div className="space-y-2 pt-2">
              {FLIP_FLOPS.map(({ part, what, watch }) => (
                <div key={part} className="rounded-md border p-3">
                  <code className="text-xs font-semibold">{part}</code>
                  <p className="mt-1 text-sm">{what}</p>
                  <p className="text-muted-foreground mt-1 text-xs text-pretty">{watch}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="faults" icon={TriangleAlert} title="Faults">
            <p>
              The <strong>Faults</strong> panel runs as a separate pass from value resolution.
              The simulator always produces a value so the board stays usable; the fault
              panel separately alerts you to real physical wiring errors:
            </p>
            <div className="space-y-2">
              {FAULTS.map(({ code, what, fix }) => (
                <div key={code} className="rounded-md border p-3">
                  <code className="text-xs font-semibold">{code}</code>
                  <p className="mt-1 text-sm">{what}</p>
                  <p className="text-muted-foreground mt-1 text-xs text-pretty">{fix}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="verify" icon={Sigma} title="Verification">
            <p>
              The <strong>Verification Bridge</strong> sweeps all $2^n$ input combinations through
              your wired circuit and diffs the results against your algebraic Boolean specification.
            </p>
            <ul className="ml-4 list-disc space-y-1.5 text-sm">
              <li>
                <strong>Variable-Label Alignment:</strong> Input switches match Boolean variables by exact label name (e.g. <code>A, B, C</code> or <code>S, D0, D1</code>), not array order, supporting up to 16 variables.
              </li>
              <li>
                <strong>Tarjan SCC Feedback Detection:</strong> Netlists are checked with Tarjan&apos;s Strongly Connected Components algorithm; any combinational feedback loops or unclocked latches are caught and flagged as non-combinational memory.
              </li>
              <li>
                <strong>5 Automated Fault Hypotheses:</strong> When verification fails, GateLab tests root-cause hypotheses:
                <ul className="ml-5 list-circle space-y-1 text-xs text-muted-foreground mt-1">
                  <li><code>UNPOWERED_IC</code>: IC supply pins missing +5V or GND.</li>
                  <li><code>FLOATING_INPUT</code>: Gate inputs disconnected and drifting to X.</li>
                  <li><code>output-inverted</code>: Circuit output is the exact complement of target (e.g. NAND used for AND).</li>
                  <li><code>output-stuck</code>: Circuit output is permanently stuck at 0 or 1.</li>
                  <li><code>inputs-swapped</code>: Tests if swapping any two input signals (e.g. A ↔ B) produces a 100% match.</li>
                </ul>
              </li>
            </ul>
          </Section>

          <Section id="timing" icon={CircuitBoard} title="Timing and hazards">
            <p>
              The GateLab Timing Drawer houses a <strong>Dual Timing Engine</strong> designed for both
              combinational hazard analysis and sequential clock debugging:
            </p>
            <div className="grid gap-3 sm:grid-cols-2 pt-1">
              <div className="rounded-md border p-3 bg-card/60">
                <h4 className="font-semibold text-xs text-primary mb-1">
                  1. Combinational Unit-Delay Engine
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Drives inputs in a forward-then-reverse <strong>Gray-code sequence</strong> (changing 1 bit per step) with configurable unit gate delays (1, 2, or 3 ticks). By changing only one variable at a time, it isolates true static and dynamic <em>logic hazards</em> from unavoidable function hazards. Capped at 7 inputs (256 held steps).
                </p>
              </div>
              <div className="rounded-md border p-3 bg-card/60">
                <h4 className="font-semibold text-xs text-amber-400 mb-1">
                  2. Clocked Sequential Engine
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Drives 18 continuous clock cycles while holding input switches constant. Plots flip-flop state transitions, propagation ripple delay, and register waveforms.
                </p>
              </div>
            </div>
            <p className="text-muted-foreground pt-1">
              Remember: <strong>minimal is not hazard-free</strong>. The redundant consensus term that Quine–McCluskey discards during minimization is precisely the term that prevents a static-1 glitch. Add it back to eliminate the spike!
            </p>
          </Section>

          <Section id="report" icon={BookOpen} title="The report">
            <p>
              <Link href="/report" className="underline underline-offset-4">
                Report
              </Link>{" "}
              assembles the whole derivation into one printable page: truth table,
              K-map, tabular reduction, schematic/breadboard snapshot, and the row-by-row
              verification matrix.
            </p>
            <p>
              Print it with your browser (⌘P / Ctrl-P) and “Save as PDF”. It outputs
              vector SVG elements so figures stay crisp and publication-ready.
            </p>
          </Section>

          <Section id="keys" icon={Keyboard} title="Shortcuts & gestures">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <tbody>
                  {SHORTCUTS.map(({ keys, does }) => (
                    <tr key={keys} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap font-medium text-foreground">
                        {keys}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{does}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground">
              GateLab runs 100% in your browser. All designs and states are saved locally in localStorage with zero server uploads.
            </p>
          </Section>

          <Section id="terms" icon={ShieldCheck} title="Terms & system check">
            <Card className="border-border/80">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-400" />
                  Client-Side Execution Terms &amp; Hardware Diagnostics
                </CardTitle>
                <CardDescription>
                  GateLab runs 100% in your local browser sandbox. Review our execution terms or run an automated system capability diagnostic at any time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Our 4-clause terms guarantee that all Boolean derivations, 74xx delta-cycle simulations, and $2^n$ verification sweeps run entirely client-side using TypedArrays and web workers. Zero schematics, formulas, or personal telemetry are uploaded to external servers.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openTermsModal()}
                  className="gap-2 cursor-pointer"
                >
                  <Cpu className="size-3.5 text-primary" />
                  <span>Open System Capability Check &amp; Terms Modal</span>
                </Button>
              </CardContent>
            </Card>
          </Section>

          <Section id="contact" icon={MessageSquare} title="Contact">
            <p>
              Found a wrong answer, a bad pinout, or something that should exist and
              does not? That is the most useful thing you can send.
            </p>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Get in touch</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FeedbackDialog>
                  <Button className="w-full sm:w-auto">
                    <MessageSquare /> Send feedback
                  </Button>
                </FeedbackDialog>
                <div className="text-muted-foreground flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
                  <FeedbackDialog>
                    <button
                      type="button"
                      className="hover:text-foreground flex items-center gap-2 underline underline-offset-4 cursor-pointer"
                    >
                      <MessageSquare className="size-4" />
                      Open feedback form
                    </button>
                  </FeedbackDialog>
                  <a
                    href={CONTACT.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground flex items-center gap-2 underline underline-offset-4"
                  >
                    <GithubIcon className="size-4" />@{CONTACT.github}
                  </a>
                </div>
              </CardContent>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
