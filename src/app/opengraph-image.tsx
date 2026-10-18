import { ImageResponse } from "next/og";

/**
 * The share card, generated at build time via next/og.
 *
 * Uses the new GateLab brand identity:
 *   - Deep navy background (#0B1220)
 *   - Electric blue accent (#2583FF)
 *   - Cyan pin accent (#35C9FF)
 *   - White headline
 *   - Slate descriptor text (#94A3B8)
 *
 * The G-mark is rendered as inline SVG so no font fetch is needed for the logo.
 * No external font fetch — system sans renders cleanly at 78px headline size.
 */
export const alt =
  "GateLab — Boolean minimizer, K-map solver and 74xx logic circuit simulator";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0B1220",
          color: "#fafafa",
          padding: "80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Subtle circuit trace decoration — top right */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 320,
            height: 220,
            display: "flex",
            opacity: 0.12,
          }}
        >
          <svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M320 20 H260 L240 40 H180 L160 60 H100" stroke="#2583FF" strokeWidth="2"/>
            <path d="M320 60 H280 L260 80 H200 L180 100 H120" stroke="#2583FF" strokeWidth="2"/>
            <path d="M320 100 H290 L270 120 H220" stroke="#35C9FF" strokeWidth="1.5"/>
            <circle cx="260" cy="40" r="4" fill="#2583FF"/>
            <circle cx="180" cy="100" r="3" fill="#35C9FF"/>
            <circle cx="270" cy="120" r="3" fill="#2583FF"/>
          </svg>
        </div>

        {/* Brand logo row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
          {/* G-mark icon */}
          <div
            style={{
              width: 52,
              height: 52,
              background: "#0B1220",
              borderRadius: 11,
              border: "2px solid #172235",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
              <path
                d="M24.1 23.1 A10 10 0 1 1 25.5 16 L21 16"
                stroke="#2583FF"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line x1="16" y1="16" x2="21" y2="16" stroke="#2583FF" strokeWidth="2.4" strokeLinecap="round"/>
              <circle cx="25.5" cy="16" r="1.6" fill="#35C9FF"/>
            </svg>
          </div>
          <div style={{ fontSize: 28, color: "#94A3B8", fontWeight: 600, display: "flex" }}>
            GateLab
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 80,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            display: "flex",
          }}
        >
          Boolean algebra,
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#2583FF",
            lineHeight: 1.05,
            display: "flex",
          }}
        >
          wired up.
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 28,
            color: "#94A3B8",
            marginTop: 32,
            maxWidth: 880,
            lineHeight: 1.5,
            display: "flex",
          }}
        >
          K-map solver · Block diagram builder · 74xx TTL circuit simulator
        </div>

        {/* Domain */}
        <div
          style={{
            fontSize: 22,
            color: "#334155",
            marginTop: 48,
            display: "flex",
          }}
        >
          gatelab-online.vercel.app
        </div>
      </div>
    ),
    size,
  );
}
