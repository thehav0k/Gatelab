"use client";

import { useRef } from "react";

export function Magnetic({
  children,
  strength = 0.25,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className={`inline-block transition-transform duration-300 [transition-timing-function:var(--ease-out-expo)] ${className ?? ""}`}
      onPointerMove={(e) => {
        if (typeof window === "undefined" || !window.matchMedia("(pointer: fine)").matches) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        if (!ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * strength;
        const dy = (e.clientY - (r.top + r.height / 2)) * strength;
        ref.current.style.transform = `translate3d(${dx}px,${dy}px,0)`;
      }}
      onPointerLeave={() => {
        if (ref.current) ref.current.style.transform = "";
      }}
    >
      {children}
    </div>
  );
}
