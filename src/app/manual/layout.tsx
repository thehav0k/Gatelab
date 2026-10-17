import type { Metadata } from "next";
import { SITE } from "@/lib/site";

/**
 * The manual page is a client component (it reads the chip library and the gate
 * rules straight out of the engine), and a client component cannot export
 * `metadata`. So the title lives in a layout beside it.
 */
const title = "User manual — notation, K-maps, breadboard wiring & fault codes";
const description =
  "How to drive Gatelab: Boolean notation, simplifying a function, gate rules, building and exporting block diagrams, wiring 74xx TTL chips on a breadboard, what every fault code means, and verifying a circuit against its algebra.";
const url = `${SITE.url}/manual`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/manual" },
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

export default function ManualLayout({ children }: { children: React.ReactNode }) {
  return children;
}
