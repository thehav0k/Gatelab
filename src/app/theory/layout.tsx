import type { Metadata } from "next";

/**
 * Titled for what a student actually types into a search box. "Theory workspace"
 * is what WE call this page; "karnaugh map solver" is what someone looking for it
 * calls it, and only one of those two gets found.
 */
export const metadata: Metadata = {
  title: "Boolean simplifier, K-map solver & Quine–McCluskey calculator",
  description:
    "Simplify a Boolean expression, solve a Karnaugh map, or convert a truth table into an equation — with every Quine–McCluskey step shown: the combining rounds, the prime implicant chart, the essential PIs, and Petrick's method. Free, and runs in your browser.",
  keywords: [
    "boolean expression simplifier",
    "karnaugh map solver",
    "quine mccluskey calculator",
    "truth table to boolean expression",
    "prime implicant chart",
    "sum of products",
    "product of sums",
    "boolean function minimizer",
  ],
  alternates: { canonical: "/theory" },
};

export default function TheoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
