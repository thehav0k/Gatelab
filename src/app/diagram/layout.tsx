import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const title = "Logic Block Diagram Editor — Drag & Drop Circuits";
const description =
  "Design digital logic block diagrams with gates, multiplexers, decoders, and flip-flops. Auto-route connections and export to SVG, PNG, or LaTeX TikZ.";
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
