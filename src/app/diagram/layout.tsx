import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const title = "Diagram — drag-and-drop logic block diagram editor";
const description =
  "Build any digital logic block diagram by dragging blocks onto a canvas: gates, decoders, multiplexers, adders, comparators, flip-flops, counters, registers and memory. Group a selection into a reusable block, rotate blocks, drop junctions, auto-arrange, and export as SVG, PNG or LaTeX (TikZ) in your own colours.";
const url = `${SITE.url}/diagram`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/diagram" },
  openGraph: {
    type: "website",
    url,
    siteName: SITE.name,
    title: `${title} · Gatelab`,
    description,
    locale: SITE.locale,
    images: [
      {
        url: `${SITE.url}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: `${title} · Gatelab`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} · Gatelab`,
    description,
    images: [`${SITE.url}/opengraph-image`],
  },
};

export default function DiagramLayout({ children }: { children: React.ReactNode }) {
  return children;
}
