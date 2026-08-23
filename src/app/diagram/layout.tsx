import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Logic circuit builder — drag-and-drop block diagram editor",
  description:
    "Build any digital logic block diagram by dragging blocks onto a canvas: gates, decoders, multiplexers, adders, comparators, flip-flops, counters, registers and memory. Group a selection into a reusable block, rotate blocks, drop junctions, auto-arrange, and export as SVG, PNG or LaTeX (TikZ) in your own colours. Free, and runs entirely in your browser.",
  keywords: [
    "logic circuit builder",
    "block diagram editor",
    "drag and drop circuit diagram",
    "digital logic diagram maker",
    "draw logic circuit online",
    "decoder multiplexer block diagram",
    "flip flop counter diagram",
    "export circuit diagram svg png",
    "circuit diagram latex tikz",
  ],
  alternates: { canonical: "/diagram" },
};

export default function DiagramLayout({ children }: { children: React.ReactNode }) {
  return children;
}
