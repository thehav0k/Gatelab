import type { Transition, Variants } from "framer-motion";

/**
 * GateLab Motion System Tokens
 *
 * Centralized, restrained timing and easing definitions engineered for an
 * authentic digital electronics lab environment:
 * - Fast UI micro-press & releases: 80–130 ms
 * - Hover & active state changes: 100–160 ms
 * - Standard UI entrances & reveals: 180–240 ms
 * - Major panel & view transitions: 180–240 ms
 *
 * All easing curves are responsive and restrained (no bouncy social-media physics).
 */

export const DURATION = {
  fast: 0.12, // 120ms
  ui: 0.15, // 150ms
  enter: 0.2, // 200ms
  panel: 0.22, // 220ms
} as const;

export const EASE = {
  ui: [0.2, 0.8, 0.2, 1] as const, // Responsive cubic bezier
  enter: [0.16, 1, 0.3, 1] as const, // Gentle deceleration entrance
  out: [0, 0, 0.2, 1] as const,
} as const;

export const TRANSITION = {
  fast: {
    duration: DURATION.fast,
    ease: EASE.ui,
  } satisfies Transition,
  ui: {
    duration: DURATION.ui,
    ease: EASE.ui,
  } satisfies Transition,
  enter: {
    duration: DURATION.enter,
    ease: EASE.enter,
  } satisfies Transition,
  panel: {
    duration: DURATION.panel,
    ease: EASE.enter,
  } satisfies Transition,
} as const;

/** Shared scroll reveal variants for presentation pages (e.g. Homepage) */
export const scrollFadeRise: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: (customDelay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.enter,
      delay: customDelay,
      ease: EASE.enter,
    },
  }),
};

export const scrollFadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: (customDelay: number = 0) => ({
    opacity: 1,
    transition: {
      duration: DURATION.enter,
      delay: customDelay,
      ease: EASE.enter,
    },
  }),
};

/** Stagger container for card grids */
export const staggerGrid: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};
