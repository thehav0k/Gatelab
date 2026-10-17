"use client";

import { BgTraces } from "./bg-traces";

export function MotionBackground() {
  return (
    <>
      <div className="bg-glow" aria-hidden="true" />
      <div className="bg-grid" aria-hidden="true" />
      <BgTraces />
    </>
  );
}
