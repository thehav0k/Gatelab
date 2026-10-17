import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const title = "74xx TTL Logic Gates & Breadboard Simulator";
const description =
  "Simulate 74xx TTL logic gates, flip-flops, and counters on virtual breadboards with 4-state logic. Detect faults and verify circuits against Boolean specs.";
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
