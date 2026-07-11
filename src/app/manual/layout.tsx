import type { Metadata } from "next";

/**
 * The manual page is a client component (it reads the chip library and the gate
 * rules straight out of the engine), and a client component cannot export
 * `metadata`. So the title lives in a layout beside it.
 */
export const metadata: Metadata = {
  title: "User manual",
  description:
    "How to drive Gatelab: Boolean notation, simplifying a function, gate rules, wiring 74xx TTL chips on a breadboard, what every fault code means, and verifying a circuit against its algebra.",
  alternates: { canonical: "/manual" },
};

export default function ManualLayout({ children }: { children: React.ReactNode }) {
  return children;
}
