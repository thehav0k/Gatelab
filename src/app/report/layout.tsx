import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const title = "Printable lab report — truth table, K-map, circuit & verification";
const description =
  "The whole derivation on one printable page: truth table, K-map, the Quine–McCluskey reduction, the circuit you built, and the row-by-row verification against your algebra.";
const url = `${SITE.url}/report`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/report" },
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

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
