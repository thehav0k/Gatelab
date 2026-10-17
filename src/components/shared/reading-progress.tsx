"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * A restrained reading progress hairline for long technical pages (/manual, /report).
 * Pinned at the top of the page under the header.
 */
export function ReadingProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const prefersReduced = useMediaQuery("(prefers-reduced-motion: reduce)");

  // Only render on long-form documentation & report routes
  const isEligible = pathname.startsWith("/manual") || pathname.startsWith("/report");

  useEffect(() => {
    if (!isEligible) return;

    const onScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) {
        setProgress(0);
        return;
      }
      const current = window.scrollY;
      const ratio = Math.min(Math.max(current / scrollHeight, 0), 1);
      setProgress(ratio);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, [isEligible, pathname]);

  if (!isEligible || prefersReduced) return null;

  return (
    <div
      className="pointer-events-none fixed top-14 inset-x-0 z-40 h-[2px] bg-transparent print:hidden no-print"
      aria-hidden="true"
    >
      <div
        className="reading-progress-bar h-full bg-logic-high shadow-[0_0_8px_var(--color-logic-high)]"
        style={{
          transform: `scaleX(${progress})`,
        }}
      />
    </div>
  );
}
