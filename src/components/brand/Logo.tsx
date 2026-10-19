import * as React from "react";

/** GateLab mark: AND-style gate, two inputs, output trace threaded through the body into a verified node. */
export function GateLabMark({
  className,
  title,
  style,
}: {
  className?: string | undefined;
  title?: string | undefined;
  style?: React.CSSProperties | undefined;
}) {
  return (
    <svg
      viewBox="0 0 68 64"
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
    >
      <path
        d="M18 12H30A20 20 0 0 1 30 52H18Z"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path
        d="M4 23H15M4 41H15M33 32H58"
        stroke="currentColor"
        strokeWidth="4"
      />
      <circle cx="60" cy="32" r="4.5" fill="currentColor" />
    </svg>
  );
}

export interface GateLabLogoProps {
  className?: string | undefined;
  variant?: "full" | "mark" | undefined;
  surface?: "dark" | "light" | undefined;
  size?: number | undefined;
  responsive?: boolean | undefined;
}

/**
 * Header logo. Full lockup from `sm` up, mark only on mobile (when responsive=true).
 * Mark takes `text-brand` (signal green); wordmark follows the surrounding text colour.
 * Wordmark is real text in the app font stack to avoid a second asset request.
 */
export function GateLabLogo({
  className = "",
  variant = "full",
  surface,
  size,
  responsive = true,
}: GateLabLogoProps = {}) {
  const markStyle = size ? { height: size, width: "auto" } : undefined;

  if (variant === "mark") {
    return (
      <GateLabMark
        className={`h-7 w-auto text-brand ${className}`}
        style={markStyle}
      />
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <GateLabMark
        className="h-7 w-auto text-brand shrink-0"
        style={markStyle}
      />
      <span
        className={`text-lg font-extrabold tracking-tight ${responsive ? "hidden sm:inline" : "inline"} ${
          surface === "light" ? "text-zinc-900" : ""
        }`}
        style={size ? { fontSize: size * 0.7, lineHeight: 1 } : undefined}
      >
        Gate<span className="text-brand">Lab</span>
      </span>
      {responsive && <span className="sr-only sm:hidden">GateLab</span>}
    </span>
  );
}
