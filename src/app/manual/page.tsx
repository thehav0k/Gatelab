"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Blocks,
  BookOpen,
  CircuitBoard,
  Cpu,
  Keyboard,
  Mail,
  MessageSquare,
  Network,
  Search,
  Sigma,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { GithubIcon } from "@/components/shared/github-icon";
import { GateReference, LogicValues } from "@/components/manual/gate-reference";
import { IcReference } from "@/components/manual/ic-reference";
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
    what: "A chip has no +5V on pin 14, or no GND on pin 7.",
    fix: "Wire the rails. An unpowered TTL chip drives nothing — its outputs sit at Z, and the whole downstream circuit floats. This is the single most common bench mistake, and it is why the fault exists.",
  },
  {
    code: "FLOATING_INPUT",
    what: "A gate input is connected to nothing.",
    fix: "A real TTL input left floating drifts HIGH, unreliably. Gatelab refuses to guess: it propagates X. Tie the input to +5V or GND, or wire it to something.",
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
    fix: "Dead short across the supply. Find the jumper that bridges the two rails.",
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
  { keys: "Click pin, click pin", does: "Wire two pins together" },
  { keys: "Click a wire", does: "Delete it" },
  { keys: "Click a switch", does: "Toggle it between 0 and 1" },
  { keys: "Esc", does: "Cancel a half-drawn wire" },
  { keys: "Backspace / Delete", does: "Delete the selected part" },
  { keys: "⌘Z / Ctrl-Z", does: "Undo" },
  { keys: "⇧⌘Z / Ctrl-Shift-Z", does: "Redo" },
  { keys: "Scroll / pinch", does: "Zoom the canvas" },
  { keys: "Drag the background", does: "Pan" },
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
  { id: "start", label: "Start here" },
  { id: "writing", label: "Writing a function" },
  { id: "theory", label: "The theory workspace" },
  { id: "rules", label: "Gate rules" },
  { id: "diagrams", label: "The diagram editor" },
  { id: "lab", label: "The lab" },
  { id: "blocks", label: "Presets & building blocks" },
  { id: "gates", label: "Logic gates" },
  { id: "chips", label: "74xx chips" },
  { id: "breadboard", label: "The breadboard" },
  { id: "sequential", label: "Flip-flops & counters" },
  { id: "faults", label: "Faults" },
  { id: "verify", label: "Verification" },
  { id: "timing", label: "Timing and hazards" },
  { id: "report", label: "The report" },
  { id: "keys", label: "Shortcuts" },
  { id: "contact", label: "Contact" },
] as const;

export default function ManualPage() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filteredToc = TOC.filter(
    (item) => q === "" || item.label.toLowerCase().includes(q) || item.id.includes(q),
  );

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
              {filteredToc.map(({ id, label }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/60 block rounded px-2.5 py-1 text-xs transition-colors"
                  >
                    {label}
                  </a>
                </li>
              ))}
              {filteredToc.length === 0 && (
                <li className="text-muted-foreground px-2 py-2 text-xs italic">
                  No matching topics found
                </li>
              )}
            </ul>
          </div>
        </nav>

        <div className="min-w-0 space-y-10">
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
                      <td className="px-3 py-2 whitespace-nowrap">{means}</td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Precedence runs <strong>NOT → AND → XOR → OR</strong>, so{" "}
              <code>A + BC</code> is <code>A + (B·C)</code>. Parenthesize when in
              doubt.
            </p>
            <p className="text-muted-foreground">
              A variable is one letter, optionally followed by digits (<code>A</code>,{" "}
              <code>B2</code>). It cannot be a word — because juxtaposition means AND,{" "}
              <code>Cin</code>{" "}
              would have to parse as C·i·n. The full adder&apos;s
              carry-in is just <code>C</code>.
            </p>
          </Section>

          <Section id="theory" icon={Sigma} title="The theory workspace">
            <p>
              One document, six views. The expression box and the minimal form stay
              on screen; the tabs below are different ways of looking at the same
              function.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <strong>How it was derived</strong> — the reduction spelled out the way
                you would work it on paper: read the 1-rows, write the canonical SOP,
                combine terms differing in one variable, collect the prime implicants,
                find the essential ones, cover the rest.
              </li>
              <li>
                <strong>Truth table</strong> — <em>editable</em>. Click an output to
                cycle it 0 → 1 → X (don&apos;t-care), click a variable name to rename
                it, use ± to change the variable count. Every edit rewrites the
                expression above. Start from a blank table and just fill in the outputs
                — the equation derives itself.
              </li>
              <li>
                <strong>K-map</strong> — the loops are not a second algorithm&apos;s
                opinion. They <em>are</em> the prime implicants the tabular method
                found, drawn onto the grid. Wrapping loops really do wrap.
              </li>
              <li>
                <strong>Tabular method</strong> — every intermediate Quine–McCluskey
                column, the prime-implicant chart, and Petrick&apos;s method when the
                chart is cyclic.
              </li>
              <li>
                <strong>Circuit</strong> — the minimal expression drawn as a gate
                diagram, then the same logic mapped onto real 74xx chips, and finally
                a <em>wiring list</em>: every connection in datasheet language, like
                <code> U1 pin 2 (1Y) → U2 pin 1 (1A)</code>. That last table is the
                thing you actually transcribe onto a breadboard — which pin number
                goes to which pin number — and it is derived from the same net index
                the simulator uses, so it cannot disagree with it.
              </li>
              <li>
                <Link href="/theory?tab=build" className="underline underline-offset-4">
                  <strong>Build it</strong>
                </Link>{" "}
                — drops the whole circuit onto the lab bench.
              </li>
            </ul>
            <p className="text-muted-foreground">
              Don&apos;t-cares are merge fuel: they let cubes grow, but they are never
              rows you must cover. That is what makes them worth so much.
            </p>
          </Section>

          <Section id="rules" icon={TriangleAlert} title="Gate rules">
            <p>
              “Implement this with NAND only” is the exercise, not a lint. Pick a rule
              and the palette narrows to match — you cannot place what you may not use
              — and the synthesizer is steered by it, so <em>Build it</em> obeys the
              rule instead of apologizing for breaking it.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CONSTRAINTS.map((c) => (
                <div key={c.id} className="rounded-md border p-2.5">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs text-pretty">
                    {c.description}
                  </p>
                </div>
              ))}
            </div>
            <p>
              You can also build a custom rule from any set of gates. Some of them are{" "}
              <strong>impossible</strong>, and Gatelab will say so and refuse rather
              than build something that quietly breaks the rule. XOR alone can never
              make an AND — XOR is affine, affine functions compose to affine
              functions, and AND is not affine. The verdict comes from Post&apos;s
              criterion, and it tells you <em>which</em> property traps you.
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
            <p className="text-muted-foreground">
              If you would rather be exact, the properties panel has the block&apos;s{" "}
              <strong>X</strong> and <strong>Y</strong> as numbers you can type into —
              which is also the quickest way to put four blocks on the same line or
              space a row evenly.
            </p>

            <h3 className="pt-1 text-sm font-medium">Junctions</h3>
            <p>
              Drag a wire out of a pin and let go over empty space: you get a{" "}
              <strong>junction</strong> there, wired up. It is a dot with a single pin,
              so a wire can carry on from it — which is how you join two points that
              are not pins, fan a signal out at a corner, or route a long wire the way
              you want it rather than the way the router chose.
            </p>
            <p className="text-muted-foreground">
              A junction you have not selected is a place to start a wire; one you have
              already selected is a thing to drag. Click it once, then move it.
            </p>

            <h3 className="pt-1 text-sm font-medium">Blocks are parametric</h3>
            <p>
              A decoder is not one block — a decoder with three address lines and an
              active-low enable is. Select a placed block and the panel on the right
              changes what it <em>is</em>: width, number of address or select lines,
              enables, clears, active-low pins, RAM or ROM. Narrowing a block really
              does delete pins, and the tool tells you how many wires went with them.
            </p>
            <p>
              When the palette has not got what you need, <strong>Custom block</strong>{" "}
              is a box whose title and pin lists you type in — a comma-separated list
              per side, with a trailing apostrophe for an active-low pin.
            </p>

            <h3 className="pt-1 text-sm font-medium">Starting from an equation</h3>
            <p>
              The <strong>Equation</strong> tab takes the function however your
              question gave it to you — an expression, a minterm list, or the column
              of output bits — and builds a circuit for it:
            </p>
            <pre className="bg-muted/40 overflow-x-auto rounded-md border p-3 font-mono text-xs">
{`F(A,B,C) = A'B + BC'
F(A,B,C) = Σm(1,3,5) + d(7)
F(A,B,C) = 01101001`}
            </pre>
            <p>
              One function per line, and the first line&apos;s variables carry to the
              rest — so <code>f1</code>, <code>f2</code> and <code>f3</code> over the
              same inputs is three lines, and they share one decoder.
            </p>
            <p>
              Six implementations, and they are not styles — they are different
              answers, and which one is right depends on what you are allowed to use:
              gates, NAND-only, NOR-only, a decoder with collecting OR gates, one
              multiplexer by Shannon expansion, or a reduced tree of 2-to-1
              multiplexers. What lands on the canvas is ordinary blocks and ordinary
              wires; drag them, re-parameterise them, group them.
            </p>

            <h3 className="pt-1 text-sm font-medium">Auto-wiring a block you placed</h3>
            <p>
              When the question dictates the component — &ldquo;implement f using a
              3-to-8 decoder&rdquo; — you do not want the tool choosing for you.
              Place the decoder yourself, select it, type the function, and press{" "}
              <strong>Auto-wire</strong>: it grows the input tags, the collecting
              gates and the outputs around <em>that</em> block.
            </p>
            <p className="text-muted-foreground">
              Pins you have already wired are left alone, so you can do part of it by
              hand and let the rest be filled in. And a decoder whose address lines do
              not match the function is refused rather than quietly widened — with the
              number you need to change, because reshaping a part you chose on purpose
              would be the tool overruling you.
            </p>

            <h3 className="pt-1 text-sm font-medium">Building bigger things</h3>
            <p>
              Select several blocks and press <kbd className="rounded border px-1">G</kbd>.
              They fold into <em>one</em> block, which joins the palette and can be
              placed as many times as you like. Build a 4-bit adder once, group it,
              place it four times — that is a 16-bit adder, and it is how every real
              digital system is put together.
            </p>
            <p className="text-muted-foreground">
              The new block&apos;s pins come from the Input and Output tags inside the
              selection, plus any wire that crossed its boundary. So the deliberate
              way to design one is to drop the tags in first and wire them up: the
              block gets exactly the interface you drew. ⇧
              <kbd className="rounded border px-1">G</kbd> takes it apart again and
              reconnects whatever was wired to it.
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
              figure straight into your document. It needs{" "}
              <code>\usepackage&#123;tikz&#125;</code> and nothing else: no
              circuitikz, no libraries, no fonts. Timing charts are the one thing it
              does not carry over, and it says so in a comment at the top of the file
              rather than leaving you to notice.
            </p>
            <p>
              The <strong>Preset</strong> at the top of the <strong>Style</strong> tab
              is a whole look, and choosing one applies it — including over changes you
              had made yourself, because a preset that left your old background in
              place would change the name in the box and nothing on the page. It says
              what it replaced and puts it back on one click if that is not what you
              meant.
            </p>
            <p>
              The rest of the <strong>Style</strong> tab changes the background
              (including fully transparent, for dark slides), the grid, the wire colours
              and widths, the
              corner radii, the type sizes, and the colour of each category of block.
              It applies to the canvas and to the export together — there is one
              renderer, and the canvas is showing you the same bytes the file will
              contain.
            </p>
            <p className="text-muted-foreground">
              Per-signal wire colouring gives every net its own hue and every branch of
              one fan-out the same one. Real jumper wire is multicoloured for exactly
              this reason: so that a connection can be traced across a crowded drawing.
              The hues are handed out in order and the palette is arranged so that
              consecutive ones are far apart — two signals side by side have to look
              like two signals.
            </p>
            <p className="text-muted-foreground">
              Select a wire and you can give it a colour of its own, which is what you
              want when the reader has to be shown <em>that</em> wire: the carry chain,
              the enable, the one line the paragraph underneath is about. Auto puts it
              back.
            </p>

            <h3 className="pt-1 text-sm font-medium">Straight from an equation</h3>
            <p>
              Theory&apos;s <em>Block diagram</em> tab draws whatever function you are
              working on four ways — as gates, from a decoder, on one multiplexer, or
              as a tree of 2-to-1 multiplexers — with the same exporter and the same
              styling.
            </p>
          </Section>

          <Section id="lab" icon={CircuitBoard} title="The lab">
            <p>
              Drag parts from the palette. Click one pin, then another, to wire them —
              the wire routes itself around obstacles. Click a switch to toggle it;
              select a wire to recolor or reroute it (Alt+Click or Backspace/Delete to remove it).
            </p>
            <p>
              <strong>Logic is four-state: 0, 1, Z and X.</strong> Z is a floating,
              undriven net — not zero. X is a conflict. This is the difference between
              a simulator that tells you your circuit works and one that tells you the
              truth: a boolean simulator reads an unconnected input as false and stays
              quiet.
            </p>
            <p>
              Wires are coloured <strong>by net</strong>, cycling through eight hues,
              for the same reason real jumper wire is multicoloured — so you can trace
              one. But Z and X keep their own unmistakable colour and dashing. A broken
              wire must never be able to look like a working one.
            </p>
            <p>
              <strong>Gates can have 2, 3 or 4 inputs.</strong> Pick the count in the
              palette before you place one — a real 74xx family has 2-, 3- and 4-input
              parts, and &ldquo;implement this as a 3-input NAND&rdquo; is a normal
              exercise. NOT is always 1-input. Already placed a gate? Select it and the
              palette lets you change its inputs; widening adds unconnected pins,
              narrowing drops the wires to the pins that vanish.
            </p>
            <p className="text-muted-foreground">
              Every gate is documented below — definition, truth table and algebraic
              properties — and so is every chip, with its real pinout.
            </p>
          </Section>

          <Section id="blocks" icon={Blocks} title="Presets & building blocks">
            <p>
              The <strong>Presets</strong> menu is not just a grab-bag of examples —
              it is organized around one idea: complex circuits are built from simple
              ones.
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <strong>Building blocks</strong> — the classics on their own: half and
                full adders, a comparator, multiplexers, a decoder, a priority encoder.
              </li>
              <li>
                <strong>Built from smaller blocks</strong> — the same circuits shown as
                a <em>hierarchy</em>. A full adder wired from two half adders and an OR;
                a 4:1 mux as a tree of three 2:1 muxes; an 8:1 mux from two 4:1s and a
                2:1. The blocks are placed as distinct clusters and wired port-to-port,
                so you can trace the decomposition — because the structure IS the lesson,
                and a flattened truth table erases it.
              </li>
              <li>
                <strong>Large circuits</strong> — 2-, 4-, 8- and 16-bit ripple-carry
                adders, each one <em>n</em> full adders with the carry rippling from the
                bottom bit to the top. An 8-bit adder&apos;s truth table has 2¹⁷ rows,
                which is exactly why nobody minimizes an adder — you build it from
                blocks. Watch the top sum bit wait for the carry to walk all the way up.
              </li>
            </ul>
            <p className="text-muted-foreground">
              These are real, simulatable, verifiable boards — composed block by block
              from the same gate tables everything else uses, so they compute what they
              claim to. (Verification sweeps 2ⁿ inputs, so above 16 inputs the lab
              declines to sweep and trusts the construction instead — a 16-bit adder has
              2³³ combinations.)
            </p>
          </Section>

          <Section id="gates" icon={CircuitBoard} title="Logic gates">
            <p>
              The seven gates, what each one means, and the algebraic properties that
              decide how it behaves when you build with it.
            </p>
            <p className="text-muted-foreground">
              Every truth table below is <em>computed by the simulator itself</em>, not
              typed into this page — so it cannot drift from what the lab actually
              does.
            </p>

            <div className="pt-2">
              <h3 className="mb-2 text-sm font-medium">
                Before the gates: the four values
              </h3>
              <LogicValues />
            </div>

            <div className="pt-3">
              <GateReference />
            </div>

            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">Two things worth knowing</p>
              <p className="text-muted-foreground mt-1.5 text-xs text-pretty">
                <strong>A controlling value decides the output on its own.</strong> AND
                is controlled by 0 and OR by 1, which is why <code>AND(0, X) = 0</code>{" "}
                — a floating second input cannot change an answer that is already
                settled. XOR has no controlling value at all, so{" "}
                <code>XOR(anything, X) = X</code>. If X were unconditionally contagious,
                one floating pin would turn the whole board red and the diagnostic would
                be worthless.
              </p>
              <p className="text-muted-foreground mt-2 text-xs text-pretty">
                <strong>NAND and NOR are not associative.</strong>{" "}
                <code>NAND(NAND(A,B), C)</code> is <em>not</em>{" "}
                <code>NAND(A, NAND(B,C))</code>, and neither is a 3-input NAND. You
                cannot widen a NAND by chaining it — that is what the 7410 is for.
              </p>
            </div>
          </Section>

          <Section id="chips" icon={Cpu} title="74xx chips">
            <p>
              The library, with real pinouts transcribed from the datasheets. Each
              package holds several independent gates that share one power supply —
              which is why chip count and gate count are different numbers, and why
              you cannot buy half a package.
            </p>
            <p className="text-muted-foreground">
              <strong>Pin 14 is +5V and pin 7 is GND on every DIP-14 here.</strong> An
              unpowered TTL chip does not output 0 — it outputs nothing at all, and
              everything downstream of it floats. Forgetting the supply is the single
              most common bench mistake, and the lab reports it as{" "}
              <code>UNPOWERED_IC</code>.
            </p>
            <IcReference />
          </Section>

          <Section id="breadboard" icon={CircuitBoard} title="The breadboard">
            <p>
              Press <strong>Breadboard</strong> to seat a schematic on a real board.
              Hover any hole and the whole strip it shorts to lights up — because that
              strip <em>is</em> one net.
            </p>
            <p>Three facts make a breadboard a breadboard, and all three are enforced:</p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>Holes A–E are shorted together. F–J are shorted together.</li>
              <li>
                <strong>They never meet.</strong> The centre channel is what a DIP
                straddles — short across it and every gate is wired input-to-output.
              </li>
              <li>
                The power rails are <strong>broken at the midpoint</strong>. A jumper in
                the left half does not power a chip wired to the right half. This one
                costs people hours at a real bench.
              </li>
            </ul>
            <p>
              You can keep building once you are on the board: a chip you add from the
              palette is <em>plugged in</em> — given real columns, clear of the chips
              already there and clear of their strips, because two parts in one column
              are wired together whether or not you meant it. If the board is full it
              says so rather than adding a part with nowhere to be.
            </p>
            <p className="text-muted-foreground">
              Seating a schematic is a realization, and a board has no schematic layout
              — so Gatelab keeps the original and hands it back when you switch view. A
              board built from scratch has nothing to go back to, and says so.
            </p>
          </Section>

          <Section id="sequential" icon={CircuitBoard} title="Flip-flops, clocks and counters">
            <p>
              Everything above is <em>combinational</em>: the output is a function of
              the inputs, and nothing else. A flip-flop is the first part here with a
              yesterday — its output depends on what happened at the last clock{" "}
              <strong>edge</strong>, which is why it needs a control the switches
              cannot provide.
            </p>

            <h3 className="pt-1 text-sm font-medium">The parts</h3>
            <p>
              Five packages, with the pin names transcribed from the TI datasheets and
              checked pin by pin in the test suite. They are much less alike than the
              gates are, so read the tooltip before you wire one:
            </p>
            <div className="space-y-2">
              {FLIP_FLOPS.map(({ part, what, watch }) => (
                <div key={part} className="rounded-md border p-3">
                  <code className="text-xs font-semibold">{part}</code>
                  <p className="mt-1 text-sm">{what}</p>
                  <p className="text-muted-foreground mt-1 text-xs text-pretty">{watch}</p>
                </div>
              ))}
            </div>

            <h3 className="pt-1 text-sm font-medium">The clock</h3>
            <p>
              Drop a <strong>Clock</strong> from the palette and wire it to CLK. It is
              a switch the app can drive for you: click it on the canvas for one edge,
              or use the panel under the canvas.
            </p>
            <ul className="ml-4 list-disc space-y-1.5 text-sm">
              <li>
                <strong>Pulse</strong> runs the level up and back down — one complete
                pulse. It has to be both halves, because half these parts load on the
                rising edge and half on the falling one, so a button that only raised
                the clock would appear to do nothing at all on a ripple counter.
              </li>
              <li>
                <strong>Run</strong> pulses it on a timer, from 1 to 10 Hz.
              </li>
              <li>
                <strong>Power-cycle</strong> puts every flip-flop back to unknown. It is
                not an edit and does not touch undo.
              </li>
            </ul>

            <h3 className="pt-1 text-sm font-medium">Why it starts at X</h3>
            <p>
              A flip-flop you have just placed reads <code>X</code>, not 0, and its
              LED is dark rather than off. That is not the simulator being unhelpful —
              a real flip-flop powers up in whichever state the metastability fell
              into, and that is the entire reason every counter you have ever seen has
              a CLEAR wired to it.
            </p>
            <p className="text-muted-foreground">
              Pull CLR low once and the count starts. Getting an <code>X</code> until
              you do is the same rule as a floating input reading <code>Z</code>: the
              tool will not invent a value it does not have.
            </p>

            <h3 className="pt-1 text-sm font-medium">Designing a counter from its sequence</h3>
            <p>
              Theory&apos;s <strong>Sequential circuits</strong> section has a{" "}
              <strong>Custom sequence</strong> entry: type the states you want counted,
              in the order you want them, and it runs the standard design procedure and
              shows every step of it — because the marks are in the steps.
            </p>
            <ol className="ml-4 list-decimal space-y-1.5 text-sm">
              <li>The sequence gives the transition table — each state&apos;s successor.</li>
              <li>
                The flip-flop&apos;s own excitation table turns each transition into the
                inputs that produce it. Half the J-K table is don&apos;t-care, which is
                why J-K designs come out smaller than D ones.
              </li>
              <li>
                Each input is then a Boolean function of the present state, minimized by
                the same Quine–McCluskey the rest of the app uses.
              </li>
              <li>
                <strong>The states the counter never visits are don&apos;t cares.</strong>{" "}
                This is the step people skip, and it typically halves the gate count.
              </li>
            </ol>
            <p className="text-muted-foreground">
              Any subset in any order works — <code>0, 3, 5, 6</code> is a counter, and
              so is a Gray-code sequence or a down-count. A state that appears twice is
              refused, because a state with two different successors is not a function of
              the present state and no combinational logic can produce it.
            </p>
            <p className="text-muted-foreground">
              It also says <strong>where the unused states actually go</strong>. The
              minimizer was free to choose anything there and chose whatever made the
              algebra smallest, so where that leaves a stray state is a real property of
              the finished circuit that nobody decided on purpose — and it is the
              difference between a counter that recovers from a power-up glitch and one
              that sits in a trap forever.
            </p>

            <h3 className="pt-1 text-sm font-medium">Counters and registers</h3>
            <p>
              The <strong>Presets</strong> menu has a clocked section: a divide-by-two,
              ripple counters, a synchronous counter, a register and a shift register,
              all built from the real packages. Open one and press Pulse.
            </p>
            <p className="text-muted-foreground">
              The pair worth opening together is the 2-bit ripple and the 2-bit
              synchronous counter. They count the same and differ by one wire — where
              the second flip-flop&apos;s clock comes from — which is the whole of the
              lesson about ripple delay. Theory&apos;s{" "}
              <strong>Sequential circuits</strong> section draws the same circuits as
              block diagrams, with a link straight to the Lab preset.
            </p>
            <p className="text-muted-foreground">
              The timing chart switches to <em>clock-driven</em> for these: it drives
              the clock and plots the state, continuing from wherever the board
              actually is. Clear the counter and you get the classic halving
              waveform; do not, and you get a chart full of unknowns, which is the
              truth about an uncleared counter.
            </p>
          </Section>

          <Section id="faults" icon={TriangleAlert} title="Faults">
            <p>
              The <strong>Faults</strong> panel is a separate pass from the simulation.
              The simulator always produces a value so the board stays useful; the fault
              panel separately tells the truth about the hardware.
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
              This is the bridge, and the reason the app exists. <strong>Verify</strong>{" "}
              sweeps every one of the 2ⁿ input combinations through the circuit you
              actually built and diffs the results against the function you actually
              derived — row by row, naming the ones that disagree.
            </p>
            <p>When it fails it also guesses why, because some mistakes have a shape:</p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <strong>Every</strong> output bit flipped → you used NAND where AND was
                needed.
              </li>
              <li>
                The table matches under a column swap → two input wires are swapped.
              </li>
              <li>The output never changes → check Vcc and floating inputs.</li>
            </ul>
            <p className="text-muted-foreground">
              If the circuit has a feedback loop it has <em>memory</em>, and no truth
              table can describe it. Gatelab says that rather than printing a
              plausible-looking table that depends on what the circuit happened to be
              doing a moment ago.
            </p>
          </Section>

          <Section id="timing" icon={CircuitBoard} title="Timing and hazards">
            <p>
              The timing panel drives the inputs in <strong>Gray code</strong> — one bit
              changes at a time — with a unit delay on every gate, and it sweeps forward
              and then back.
            </p>
            <p>
              Both of those are load-bearing. A binary counter changes several bits at
              once, which produces <em>function</em> hazards you cannot cure. And a
              hazard is directional: it appears on a falling edge but not on the
              matching rising one, so a one-way sweep would miss half of them.
            </p>
            <p className="text-muted-foreground">
              This is where the two halves of the app meet:{" "}
              <strong>minimal is not hazard-free</strong>. The redundant consensus term
              that Quine–McCluskey correctly discarded as non-minimal is exactly the term
              that removes the glitch. Add it back and watch the spike disappear.
            </p>
            <p className="text-muted-foreground">
              The sweep covers circuits with up to seven inputs, and says so when a
              circuit has more. Every term of the cost doubles per input — a 4-bit
              adder&apos;s nine inputs is 512 combinations and a chart you would have to
              scroll for a minute; the 16-bit adder&apos;s thirty-three is eight billion.
              Everything else — the schematic, the faults, the verification — still works
              on circuits that size.
            </p>
          </Section>

          <Section id="report" icon={BookOpen} title="The report">
            <p>
              <Link href="/report" className="underline underline-offset-4">
                Report
              </Link>{" "}
              assembles the whole derivation into one printable page: truth table,
              K-map, the tabular reduction, the circuit you built, and the row-by-row
              verification.
            </p>
            <p>
              Print it with your browser (⌘P / Ctrl-P) and “Save as PDF”. It goes
              through the browser&apos;s own PDF engine, so the circuit and the K-map
              stay real vectors in the output instead of blurry screenshots.
            </p>
          </Section>

          <Section id="keys" icon={Keyboard} title="Shortcuts">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <tbody>
                  {SHORTCUTS.map(({ keys, does }) => (
                    <tr key={keys} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {keys}
                      </td>
                      <td className="px-3 py-2">{does}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground">
              Everything is saved in your browser as you work. Nothing is uploaded —
              the entire engine runs on your machine.
            </p>
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
                  <a
                    href={`mailto:${CONTACT.email}`}
                    className="hover:text-foreground flex items-center gap-2 underline underline-offset-4"
                  >
                    <Mail className="size-4" />
                    {CONTACT.email}
                  </a>
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
