import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Printable lab report — truth table, K-map, circuit & verification",
  description:
    "The whole derivation on one printable page: truth table, K-map, the Quine–McCluskey reduction, the circuit you built, and the row-by-row verification against your algebra.",
  keywords: [
    "digital logic lab report",
    "printable truth table and k-map",
    "boolean simplification worksheet",
  ],
  alternates: { canonical: "/report" },
};

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
