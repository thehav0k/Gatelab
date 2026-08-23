import type { Metadata } from "next";

/**
 * Titled for what somebody types into a search box when they need one of these.
 * Nobody searches for "block diagram workspace"; they search for "1 to 16
 * demultiplexer using 2 to 4 decoder".
 */
export const metadata: Metadata = {
  title: "Logic circuit & block diagram generator — decoders, MUX, adders, counters",
  description:
    "Draw and export block diagrams for digital logic design problems: NAND-only circuits, decoder and multiplexer implementations, adders, 2's complement, comparators, counters with timing diagrams, and memory/ROM expansion. Fully customisable colours, and export as SVG or PNG.",
  keywords: [
    "logic circuit diagram generator",
    "block diagram digital logic",
    "1 to 16 demultiplexer using 2 to 4 decoder",
    "implement function using multiplexer",
    "full adder using decoder",
    "4 bit comparator circuit",
    "2's complement circuit",
    "ripple counter timing diagram",
    "memory expansion 16x4 chips",
    "ROM expansion decoder",
    "export circuit diagram svg",
  ],
  alternates: { canonical: "/diagrams" },
};

export default function DiagramsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
