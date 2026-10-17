"use client";

import { usePathname } from "next/navigation";
import { BgTraces } from "./bg-traces";

export function MotionBackground() {
  const pathname = usePathname();
  if (pathname.startsWith("/lab")) return null;

  return (
    <>
      <div className="bg-grid" aria-hidden="true" />
      <div className="bg-glow" aria-hidden="true" />
      <BgTraces />
    </>
  );
}
