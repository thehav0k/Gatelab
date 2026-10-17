import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const title = "Boolean Simplifier, K-Map Solver & Quine–McCluskey";
const description =
  "Simplify Boolean algebra expressions, solve Karnaugh maps, and view full Quine–McCluskey step-by-step minimization with prime implicant tables online.";
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
