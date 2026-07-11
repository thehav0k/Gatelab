"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CircuitBoard, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";

const MODULES = [
  {
    href: "/theory",
    icon: Sigma,
    title: "Theoretical Workspace",
    blurb:
      "Parse a Boolean expression, sweep its truth table, and watch Quine–McCluskey reduce it one column at a time. Every prime implicant is drawn back onto the K-map.",
    points: [
      "Expression, minterm, and truth-table input",
      "Step-by-step tabular reduction",
      "K-map loops with wrap-around groups",
    ],
  },
  {
    href: "/lab",
    icon: CircuitBoard,
    title: "Practical Lab",
    blurb:
      "Wire up real 74xx TTL chips with real pinouts. Four-state logic means a floating input stays floating — so the lab can tell you that you forgot pin 14.",
    points: [
      "7400 / 7402 / 7404 / 7408 / 7432 / 7486",
      "Floating inputs, output shorts, missing Vcc",
      "Verify your build against your algebra",
    ],
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Boolean algebra, wired up.
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg text-pretty">
          DigiLab Studio takes an expression from minimization all the way to a
          TTL circuit — then checks that what you built actually matches what you
          derived.
        </p>
      </motion.div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {MODULES.map(({ href, icon: Icon, title, blurb, points }, i) => (
          <motion.div
            key={href}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.4,
              delay: 0.1 + i * 0.08,
              ease: "easeOut",
            }}
          >
            <Link
              href={href}
              className="group hover:border-foreground/20 hover:bg-accent/40 flex h-full flex-col rounded-xl border p-6 transition-colors"
            >
              <Icon className="text-logic-high size-6" />
              <h2 className="mt-4 font-medium">{title}</h2>
              <p className="text-muted-foreground mt-2 text-sm text-pretty">
                {blurb}
              </p>
              <ul className="text-muted-foreground mt-4 space-y-1 text-sm">
                {points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="text-logic-high">·</span>
                    {p}
                  </li>
                ))}
              </ul>
              <span className="mt-6 flex items-center gap-1 text-sm font-medium">
                Open
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </motion.div>
        ))}
      </div>

      <motion.div
        className="mt-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <Button asChild size="lg">
          <Link href="/theory">
            Start with an expression
            <ArrowRight />
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}
