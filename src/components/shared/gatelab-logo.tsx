/**
 * GateLab logo component.
 *
 * The G-mark is an inline SVG (so it scales perfectly, has no network request,
 * and picks up currentColor where needed). The wordmark is plain text using the
 * app's font stack.
 *
 * Props:
 *   variant   — "full" (mark + wordmark), "mark" (symbol only)
 *   surface   — "dark" (white wordmark) | "light" (navy wordmark)
 *   size      — height of the mark in px; wordmark scales proportionally
 */

import { cn } from "@/lib/utils";

interface GateLabLogoProps {
  /** "full" renders mark + wordmark side by side; "mark" renders only the symbol. */
  variant?: "full" | "mark";
  /** Surface the logo is placed on. Controls wordmark color. */
  surface?: "dark" | "light";
  /** Mark height in pixels. Default 24. */
  size?: number;
  className?: string;
}

export function GateLabLogo({
  variant = "full",
  surface = "dark",
  size = 24,
  className,
}: GateLabLogoProps) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-2", className)}
      aria-label="GateLab"
      role="img"
    >
      {/* ── G-mark SVG ─────────────────────────────────────────────── */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        focusable="false"
        style={{ flexShrink: 0 }}
      >
        {/* Dark navy background square */}
        <rect width="32" height="32" rx="7" fill="#0B1220" />
        {/*
          G arc: open circle missing ~50° on the right side (the "gate notch").
          Arc goes from ~25° to ~335° (PIL convention, SVG 0° is 3-o'clock).
          In SVG arc notation, drawn with stroke.
        */}
        <path
          d="M24.1 23.1
             A10 10 0 1 1 25.5 16
             L21 16"
          stroke="#2583FF"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Stub crossbar — the G's inner horizontal bar, references a gate pin */}
        <line
          x1="16"
          y1="16"
          x2="21"
          y2="16"
          stroke="#2583FF"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {/* Terminal pin dot in cyan — the logic output pin */}
        <circle cx="25.5" cy="16" r="1.6" fill="#35C9FF" />
      </svg>

      {/* ── Wordmark ────────────────────────────────────────────────── */}
      {variant === "full" && (
        <span
          className={cn(
            "font-semibold tracking-tight",
            surface === "dark" ? "text-white" : "text-[#0B1220]",
          )}
          style={{ fontSize: size * 0.75, lineHeight: 1 }}
        >
          GateLab
        </span>
      )}
    </span>
  );
}
