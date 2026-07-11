import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "74xx TTL logic circuit & breadboard simulator",
  description:
    "Wire real 74xx TTL chips on a schematic or a breadboard and simulate them in four-state logic (0, 1, Z, X) — so a floating input stays floating and a forgotten Vcc is reported instead of silently working. Free online logic gate simulator.",
  keywords: [
    "logic gate simulator",
    "logic circuit simulator online",
    "74xx TTL simulator",
    "breadboard simulator",
    "7400 NAND gate",
    "digital logic design",
    "NAND only implementation",
    "static hazard",
  ],
  alternates: { canonical: "/lab" },
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
