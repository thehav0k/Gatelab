import type { Metadata } from "next";

/**
 * NOT indexed, and no keywords.
 *
 * This section is worked answers to a specific assignment, behind a password.
 * The SEO that the rest of the site wants would be actively harmful here: it
 * would put "question 34 answer" in front of exactly the people the password is
 * there to keep out. `robots` is belt and braces alongside the middleware and
 * the sitemap omission.
 */
export const metadata: Metadata = {
  title: "Worked solutions",
  robots: { index: false, follow: false },
  description:
    "Draw and export block diagrams for digital logic design problems: NAND-only circuits, decoder and multiplexer implementations, adders, 2's complement, comparators, counters with timing diagrams, and memory/ROM expansion. Fully customisable colours, and export as SVG or PNG.",
  alternates: { canonical: "/solutions" },
};

export default function SolutionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
