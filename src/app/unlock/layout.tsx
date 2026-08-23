import type { Metadata } from "next";

/**
 * Kept out of every index. A gate that search engines list is a gate with a
 * signpost next to it, and the page has nothing anybody would want to find.
 */
export const metadata: Metadata = {
  title: "Private",
  robots: { index: false, follow: false },
};

export default function UnlockLayout({ children }: { children: React.ReactNode }) {
  return children;
}
