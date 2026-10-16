"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CircuitBoard,
  Cpu,
  Network,
  ShieldCheck,
  Sigma,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogicAnimation } from "@/components/shared/logic-animation";

/**
 * The landing page.
 *
 * ORGANISED AS THE PIPELINE IT IS. The four modules are not four unrelated
 * tools — they are four stages of one job, and the thing that makes this app
 * worth using rather than any of the dozen K-map solvers is that the last stage
 * checks the first. So they are numbered, they read left to right, and the
 * bridge between the ends gets a band of its own rather than half a sentence in
 * the hero.
 *
 * Every card carries the SAME shape: one line of what it is, three things it
 * does, and an Open link pinned to the bottom with `mt-auto`. Paragraphs of
 * different lengths left the links floating at four different heights, which
 * read as four different kinds of thing.
 */

const MODULES = [
  {
    step: "01",
    href: "/theory",
    icon: Sigma,
    title: "Theory",
    verb: "Derive it",
    blurb: "Take a function apart and find its smallest form.",
    points: [
      "Quine–McCluskey, one column at a time",
      "K-map loops that are the prime implicants",
      "Truth table, SOP and POS from any input",
    ],
  },
  {
    step: "02",
    href: "/diagram",
    icon: Network,
    title: "Diagram",
    verb: "Draw it",
    blurb: "Build the block diagram an answer actually needs.",
    points: [
      "Drag decoders, muxes, adders, counters",
      "Or type the equation and have it built",
      "Export SVG, PNG or LaTeX in your colours",
    ],
  },
  {
    step: "03",
    href: "/lab",
    icon: CircuitBoard,
    title: "Lab",
    verb: "Build it",
    blurb: "Wire real 74xx chips on a schematic or a breadboard.",
    points: [
      "Gates and flip-flops, with a clock you can run",
      "Four-state logic: floating stays floating",
      "Faults that name the pin you forgot",
    ],
  },
  {
    step: "04",
    href: "/report",
    icon: Cpu,
    title: "Report",
    verb: "Hand it in",
    blurb: "The whole derivation on one printable page.",
    points: [
      "Truth table, K-map and the reduction",
      "The board you built, as you built it",
      "The row-by-row check against your algebra",
    ],
  },
] as const;

const FACTS = [
  {
    icon: Waves,
    title: "It knows the difference between 0 and nothing",
    body: "Logic here is four-state — 0, 1, Z, X. A boolean simulator reads an unconnected input as false and tells you your circuit works. This one tells you the input is floating.",
  },
  {
    icon: Cpu,
    title: "The chips are real chips",
    body: "7400, 7402, 7404, 7474, 74LS76A, 74175 — pinouts transcribed from the datasheets. The 7402's output really is on pin 1, the 74LS76A's supply really is on pins 5 and 13, and forgetting pin 14 really does stop the board.",
  },
  {
    icon: Cpu,
    title: "A flip-flop powers up not knowing",
    body: "Place one and it reads X, not 0 — a real one comes up in whichever state the metastability fell into. That is the entire reason every counter you have ever seen has a clear wired to it, and a simulator that started at zero would hide it.",
  },
  {
    icon: Sigma,
    title: "Minimal is not hazard-free",
    body: "The timing panel sweeps the inputs in Gray code with unit gate delay, so a static hazard shows up as a real glitch — and the redundant term the minimizer discarded is exactly the one that cures it.",
  },
] as const;

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay, ease: "easeOut" as const },
});

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      {/* --- hero -------------------------------------------------------------- */}
      <section className="grid items-center gap-10 md:grid-cols-[1.05fr_1fr]">
        <motion.div {...rise(0)}>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Boolean algebra, <span className="text-logic-high">wired up.</span>
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-lg text-pretty">
            Gatelab takes a function from minimization all the way to a TTL circuit on
            a breadboard — then checks that what you built actually matches what you
            derived.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/theory">
                Minimize a function
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/lab">Go straight to the bench</Link>
            </Button>
          </div>

          <p className="text-muted-foreground mt-6 text-xs">
            Free · no account · runs entirely in your browser
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
          className="bg-card/50 rounded-xl border p-4"
        >
          <LogicAnimation className="w-full" />
          <p className="text-muted-foreground mt-2 text-center text-xs text-pretty">
            The inverter path is longer. Watch it arrive late — that delay is what a
            static hazard is made of.
          </p>
        </motion.div>
      </section>

      {/* --- the pipeline -------------------------------------------------------- */}
      <section className="mt-16 sm:mt-20">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight">
            One job, in four stages
          </h2>
          <p className="text-muted-foreground text-sm">
            Each one hands its work to the next.
          </p>
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map(({ step, href, icon: Icon, title, verb, blurb, points }, i) => (
            <motion.div key={href} {...rise(0.15 + i * 0.07)} className="flex">
              <Link
                href={href}
                className="group hover:border-foreground/20 hover:bg-accent/40 flex w-full flex-col rounded-xl border p-5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Icon className="text-logic-high size-5" />
                  <span className="text-muted-foreground/60 ml-auto font-mono text-xs">
                    {step}
                  </span>
                </div>

                <h3 className="mt-3 font-medium">
                  {title}
                  <span className="text-muted-foreground font-normal"> — {verb}</span>
                </h3>
                <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
                  {blurb}
                </p>

                <ul className="mt-3 space-y-1.5">
                  {points.map((point) => (
                    <li
                      key={point}
                      className="text-muted-foreground flex gap-2 text-xs text-pretty"
                    >
                      <span className="bg-logic-high/60 mt-1.5 size-1 shrink-0 rounded-full" />
                      {point}
                    </li>
                  ))}
                </ul>

                {/* Pinned to the bottom, so four cards of different lengths still
                    line their links up. */}
                <span className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium">
                  Open
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* --- the bridge ---------------------------------------------------------- */}
      <motion.section
        {...rise(0.2)}
        className="bg-card/40 mt-16 rounded-xl border p-6 sm:mt-20 sm:p-8"
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <ShieldCheck className="text-logic-high size-5" />
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-balance">
              The last stage checks the first
            </h2>
            <p className="text-muted-foreground mt-2 text-pretty">
              This is the part that is not a K-map solver with a simulator bolted on.
              <strong className="text-foreground"> Verify</strong> sweeps every one of
              the 2ⁿ input combinations through the circuit you actually wired and
              diffs the results against the function you actually derived — row by
              row, naming the ones that disagree.
            </p>
            <p className="text-muted-foreground mt-3 text-sm text-pretty">
              And when it fails it guesses why, because some mistakes have a shape:
              every output bit flipped means NAND where AND was wanted; a match under
              a column swap means two input wires crossed; an output that never
              changes means Vcc.
            </p>
          </div>

          <div className="text-muted-foreground grid shrink-0 gap-3 text-sm md:w-64">
            {[
              ["Derived", "F = A·B′ + B·C"],
              ["Built", "7408 + 7432 + 7404"],
              ["Checked", "8 of 8 rows agree"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border px-3 py-2">
                <p className="text-[10px] tracking-wide uppercase">{label}</p>
                <p className="text-foreground mt-0.5 font-mono text-xs">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* --- what makes it different --------------------------------------------- */}
      <section className="mt-16 sm:mt-20">
        <h2 className="text-xl font-semibold tracking-tight">
          Four decisions it does not compromise on
        </h2>

        <div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {FACTS.map(({ icon: Icon, title, body }, i) => (
            <motion.div key={title} {...rise(0.1 + i * 0.06)}>
              <Icon className="text-muted-foreground size-4" />
              <h3 className="mt-2 font-medium">{title}</h3>
              <p className="text-muted-foreground mt-1.5 text-sm text-pretty">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* --- close ---------------------------------------------------------------- */}
      <motion.section
        {...rise(0.1)}
        className="mt-16 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-6 sm:mt-20"
      >
        <div className="min-w-0">
          <h2 className="font-medium">Not sure where to start?</h2>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            The manual covers the notation, every fault code, and how the verification
            bridge decides you got it wrong.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/manual">
            <BookOpen />
            Read the manual
          </Link>
        </Button>
      </motion.section>
    </div>
  );
}
