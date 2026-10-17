import type { Metadata } from "next";
import { SITE } from "@/lib/site";

const title = "Printable Digital Logic Lab Report & Verification";
const description =
  "Export complete digital logic derivations on one printable sheet: truth tables, K-maps, Quine–McCluskey steps, schematic drawings, and formal verification.";
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
