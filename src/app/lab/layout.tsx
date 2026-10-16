import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "74xx TTL logic gate, flip-flop & breadboard simulator",
  description:
    "Wire real 74xx TTL chips on a schematic or a breadboard and simulate them in four-state logic (0, 1, Z, X) — so a floating input stays floating and a forgotten Vcc is reported instead of silently working. The board is a real board: a five-hole strip is a short, and the power rails break at the middle. Edge-triggered D and J-K flip-flops with a clock you can pulse or run, so ripple counters, synchronous counters, registers and shift registers all work. Free online logic gate simulator.",
  keywords: [
    "logic gate simulator",
    "logic circuit simulator online",
    "74xx TTL simulator",
    "breadboard simulator",
    "7400 NAND gate",
    "digital logic design",
    "NAND only implementation",
    "static hazard",
    "d flip flop simulator",
    "jk flip flop 7476",
    "ripple counter simulator",
    "shift register simulator",
  ],
  alternates: { canonical: "/lab" },
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
