import type { Metadata } from "next";

/**
 * The manual page is a client component (it reads the chip library and the gate
 * rules straight out of the engine), and a client component cannot export
 * `metadata`. So the title lives in a layout beside it.
 */
export const metadata: Metadata = {
  title: "User manual",
  description:
    "How to drive Gatelab: writing a function, the five theory views, gate rules, wiring 74xx chips, reading faults, and verifying a circuit against its algebra.",
};

export default function ManualLayout({ children }: { children: React.ReactNode }) {
  return children;
}
