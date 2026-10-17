import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const title = "74xx TTL logic gate, flip-flop & breadboard simulator";
const description =
  "Wire real 74xx TTL chips on a schematic or a breadboard and simulate them in four-state logic (0, 1, Z, X) — so a floating input stays floating and a forgotten Vcc is reported instead of silently working. The board is a real board: a five-hole strip is a short, and the power rails break at the middle. Edge-triggered D and J-K flip-flops with a clock you can pulse or run, so ripple counters, synchronous counters, registers and shift registers all work.";
const url = `${SITE.url}/lab`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/lab" },
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

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
