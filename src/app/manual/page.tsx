"use client";

import Link from "next/link";
import {
  BookOpen,
  CircuitBoard,
  Cpu,
  Keyboard,
  Mail,
  MessageSquare,
  Sigma,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  { id: "lab", label: "The lab" },
  { id: "gates", label: "Logic gates" },
  { id: "chips", label: "74xx chips" },
  { id: "breadboard", label: "The breadboard" },
  { id: "faults", label: "Faults" },
  { id: "verify", label: "Verification" },
  { id: "timing", label: "Timing and hazards" },
  { id: "report", label: "The report" },
  { id: "keys", label: "Shortcuts" },
  { id: "contact", label: "Contact" },
] as const;

export default function ManualPage() {
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

      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        {/* The contents list is a luxury on a phone and a necessity on a laptop. */}
        <nav className="hidden lg:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {TOC.map(({ id, label }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="text-muted-foreground hover:text-foreground block rounded px-2 py-1 transition-colors"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
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
                write a function — say <code>F(A,B,C) = A&apos;B + BC</code>. It is
                minimized as you type.
              </li>
              <li>
                Open the <strong>Build it</strong> tab and press{" "}
                <em>Build this circuit in the lab</em>. Real 74xx chips appear, wired,
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
              One document, five views. The expression box and the minimal form stay
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
                <strong>Build it</strong> — turns the minimal form into 74xx chips.
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

          <Section id="lab" icon={CircuitBoard} title="The lab">
            <p>
              Drag parts from the palette. Click one pin, then another, to wire them —
              the wire routes itself around obstacles. Click a switch to toggle it;
              click a wire to delete it.
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
            <p className="text-muted-foreground">
              Every gate is documented below — definition, truth table and algebraic
              properties — and so is every chip, with its real pinout.
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
            <p className="text-muted-foreground">
              Seating a schematic is a realization, and a board has no schematic layout
              — so Gatelab keeps the original and hands it back when you switch view. A
              board built from scratch has nothing to go back to, and says so.
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
