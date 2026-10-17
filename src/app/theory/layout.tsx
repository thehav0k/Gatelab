import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const title = "Boolean simplifier, K-map solver & Quine–McCluskey calculator";
const description =
  "Simplify a Boolean expression, solve a Karnaugh map, or convert a truth table into an equation — with every Quine–McCluskey step shown: the combining rounds, the prime implicant chart, the essential PIs, and Petrick's method. Free, and runs in your browser.";
const url = `${SITE.url}/theory`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/theory" },
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

export default function TheoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
