import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lab report",
  description:
    "The whole derivation on one printable page: truth table, K-map, the Quine–McCluskey reduction, the circuit you built, and the row-by-row verification against your algebra.",
  alternates: { canonical: "/report" },
};

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
