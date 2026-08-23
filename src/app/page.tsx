"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CircuitBoard, Cpu, Network, Sigma, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogicAnimation } from "@/components/shared/logic-animation";

const MODULES = [
  {
    href: "/theory",
    icon: Sigma,
    title: "Theory",
    blurb:
      "Parse an expression, sweep its truth table, and watch Quine–McCluskey reduce it one column at a time. Every prime implicant is drawn back onto the K-map.",
  },
  {
    href: "/diagram",
    icon: Network,
    title: "Builder",
    blurb:
      "Drag decoders, multiplexers, adders, flip-flops and memory onto a canvas and wire them up. Fold a selection into one reusable block, then build something bigger out of it. Exports as SVG or PNG in your own colours.",
  },
  {
    href: "/lab",
    icon: CircuitBoard,
    title: "Lab",
    blurb:
      "Wire real 74xx chips on a schematic or a breadboard. Four-state logic means a floating input stays floating — so the lab can tell you that you forgot pin 14.",
  },
  {
    href: "/report",
    icon: Cpu,
    title: "Report",
    blurb:
      "The whole derivation, printable: truth table, K-map, tabular reduction, the board you built, and the row-by-row check against your algebra.",
  },
] as const;

const FACTS = [
  {
    icon: Waves,
    title: "It knows the difference between 0 and nothing",
    body: "Logic is four-state — 0, 1, Z, X. A boolean simulator reads an unconnected input as false and tells you your circuit works. This one tells you the input is floating.",
  },
  {
    icon: Cpu,
    title: "The chips are real chips",
    body: "7400, 7402, 7404, 7408, 7432, 7486, 7410 — actual pinouts, transcribed from the datasheets. The 7402's output really is on pin 1, and forgetting pin 14 really does stop the board.",
  },
  {
    icon: Sigma,
    title: "Minimal is not hazard-free",
    body: "The timing panel sweeps the inputs in Gray code with unit gate delay, so a static hazard shows up as a real glitch — and the redundant term the minimizer discarded is the one that cures it.",
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      {/* --- hero -------------------------------------------------------------- */}
      <section className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Boolean algebra,{" "}
            <span className="text-logic-high">wired up.</span>
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-lg text-pretty">
            Gatelab takes a function from minimization all the way to a TTL circuit
            on a breadboard — then checks that what you built actually matches what
            you derived.
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
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
          className="bg-card/50 rounded-xl border p-4"
        >
          <LogicAnimation className="w-full" />
          <p className="text-muted-foreground mt-2 text-center text-xs">
            The inverter path is longer. Watch it arrive late — that delay is what a
            static hazard is made of.
          </p>
        </motion.div>
      </section>

      {/* --- modules ------------------------------------------------------------ */}
      <section className="mt-12 grid gap-4 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map(({ href, icon: Icon, title, blurb }, i) => (
          <motion.div
            key={href}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 + i * 0.08, ease: "easeOut" }}
          >
            <Link
              href={href}
              className="group hover:border-foreground/20 hover:bg-accent/40 flex h-full flex-col rounded-xl border p-5 transition-colors"
            >
              <Icon className="text-logic-high size-5" />
              <h2 className="mt-3 font-medium">{title}</h2>
              <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
                {blurb}
              </p>
              <span className="mt-4 flex items-center gap-1 text-sm font-medium">
                Open
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </motion.div>
        ))}
      </section>

      {/* --- what makes it different -------------------------------------------- */}
      <section className="mt-12 grid gap-8 sm:mt-16 sm:grid-cols-3">
        {FACTS.map(({ icon: Icon, title, body }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 + i * 0.1 }}
          >
            <Icon className="text-muted-foreground size-4" />
            <h3 className="mt-2 text-sm font-medium">{title}</h3>
            <p className="text-muted-foreground mt-1 text-sm text-pretty">{body}</p>
          </motion.div>
        ))}
      </section>
    </div>
  );
}
