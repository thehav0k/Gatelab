import * as React from "react";

/** GateLab mark: AND-style gate, two inputs, output trace threaded through the body into a verified node. */
export function GateLabMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 68 64" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} fill="none">
      <path d="M18 12H30A20 20 0 0 1 30 52H18Z" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
      <path d="M4 23H15M4 41H15M33 32H58" stroke="currentColor" strokeWidth="4" />
      <circle cx="60" cy="32" r="4.5" fill="currentColor" />
    </svg>
  );
}

/**
 * Header logo. Full lockup from `sm` up, mark only on mobile.
 * Mark takes `text-brand` (signal green); wordmark follows the surrounding text colour.
 * Wordmark is real text in the app font stack to avoid a second asset request; swap for
 * <img src="/brand/gatelab-wordmark-dark.svg"> if you want the exact outlined letterforms.
 */
export function GateLabLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <GateLabMark className="h-7 w-auto text-brand" />
      <span className="hidden text-lg font-extrabold tracking-tight sm:inline">
        Gate<span className="text-brand">Lab</span>
      </span>
      <span className="sr-only sm:hidden">GateLab</span>
    </span>
  );
}
