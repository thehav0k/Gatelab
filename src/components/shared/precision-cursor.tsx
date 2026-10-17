"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Precision Custom Cursor for GateLab
 *
 * Designed as a subtle technical instrument rather than a decorative effect:
 * - Active ONLY on desktop devices with fine pointer and hover support.
 * - Completely inactive on touch/mobile devices or when prefers-reduced-motion is on.
 * - Uses Framer Motion's motion values and springs (zero React component state
 *   updates on mousemove) to ensure 60/120fps performance.
 * - Context-aware:
 *     - Smoothly enlarges over clickable controls (buttons, links, switches).
 *     - Hides over text inputs, code, and text selections to keep the native I-beam.
 *     - Yields cleanly over interactive schematic and breadboard canvases so
 *       native crosshairs, pin snappings, and grab handles take precedence.
 * - Disappears on mouseleave or route transition.
 */
export function PrecisionCursor() {
  const isFinePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const prefersReduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const pathname = usePathname();

  // If touch or reduced motion, do not render or attach listeners
  if (!isFinePointer || prefersReduced) {
    return null;
  }

  return <PrecisionCursorInner key={pathname} />;
}

function PrecisionCursorInner() {
  const [isVisible, setIsVisible] = useState(false);
  const [cursorMode, setCursorMode] = useState<"default" | "interactive" | "hidden">("default");

  // Raw mouse coordinates
  const rawX = useMotionValue(-100);
  const rawY = useMotionValue(-100);

  // Smooth precision ring spring
  const ringX = useSpring(rawX, { damping: 28, stiffness: 420, mass: 0.4 });
  const ringY = useSpring(rawY, { damping: 28, stiffness: 420, mass: 0.4 });

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      rawX.set(e.clientX);
      rawY.set(e.clientY);

      if (!isVisible) {
        setIsVisible(true);
      }

      // Context detection via elementFromPoint or target
      const target = e.target as HTMLElement | SVGElement | null;
      if (!target) return;

      // 1. Hide over text fields, text-editing, or canvas drawing surfaces
      if (
        target.closest("input, textarea, select, [contenteditable='true'], pre, code") ||
        target.closest(".builder-canvas, .diagram-viewport, [data-native-cursor]")
      ) {
        setCursorMode("hidden");
        return;
      }

      // Check computed cursor style for text selection
      if (target instanceof HTMLElement) {
        const computed = window.getComputedStyle(target).cursor;
        if (computed === "text" || computed === "crosshair" || computed === "grab" || computed === "grabbing") {
          setCursorMode("hidden");
          return;
        }
      }

      // 2. Interactive enlargement over clickable controls
      if (
        target.closest(
          "button, a, [role='button'], [role='tab'], [role='menuitem'], [data-slot='switch'], [data-interactive='true'], summary, label",
        )
      ) {
        setCursorMode("interactive");
        return;
      }

      setCursorMode("default");
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
      setCursorMode("default");
    };

    const handleMouseEnter = () => {
      setIsVisible(true);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mouseenter", handleMouseEnter);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mouseenter", handleMouseEnter);
    };
  }, [isVisible, rawX, rawY]);

  if (!isVisible || cursorMode === "hidden") {
    return null;
  }

  const isInteractive = cursorMode === "interactive";
  const size = isInteractive ? 26 : 16;
  const half = size / 2;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden select-none">
      {/* Precision reticle dot at exact mouse coordinate */}
      <motion.div
        style={{
          x: rawX,
          y: rawY,
          translateX: "-50%",
          translateY: "-50%",
        }}
        className="pointer-events-none absolute size-1 rounded-full bg-logic-high shadow-[0_0_4px_var(--color-logic-high)]"
      />

      {/* Precision outer ring follower */}
      <motion.div
        style={{
          x: ringX,
          y: ringY,
          translateX: `-${half}px`,
          translateY: `-${half}px`,
          width: size,
          height: size,
        }}
        animate={{
          scale: isInteractive ? 1.05 : 1,
          borderColor: isInteractive ? "var(--color-logic-high)" : "currentColor",
          opacity: isInteractive ? 0.9 : 0.45,
        }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        className="pointer-events-none absolute rounded-full border border-foreground/40 shadow-xs"
      />
    </div>
  );
}
