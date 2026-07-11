import { ImageResponse } from "next/og";

/**
 * The share card, generated at build time.
 *
 * `summary_large_image` is declared in the metadata, and a large-image card with
 * no image is a worse result than no card at all — it renders as a broken box. So
 * the image has to exist.
 *
 * Drawn with `next/og` rather than shipped as a PNG: it is text on a background,
 * it stays in sync with the tagline, and it costs no binary in the repo. No
 * external fonts — the system stack renders fine at this size, and a remote font
 * fetch is one more thing that can fail a build.
 */
export const alt =
  "Gatelab — Boolean minimizer, K-map solver and 74xx logic circuit simulator";
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
          background: "#0a0a0a",
          color: "#fafafa",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              border: "4px solid #4ade80",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 34, color: "#a1a1aa" }}>Gatelab</div>
        </div>

        <div
          style={{
            fontSize: 78,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            marginTop: 32,
            display: "flex",
          }}
        >
          Boolean algebra,
        </div>
        <div
          style={{
            fontSize: 78,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#4ade80",
            display: "flex",
          }}
        >
          wired up.
        </div>

        <div
          style={{
            fontSize: 30,
            color: "#a1a1aa",
            marginTop: 32,
            maxWidth: 900,
            lineHeight: 1.4,
            display: "flex",
          }}
        >
          K-map solver, Quine–McCluskey minimizer, and a 74xx TTL circuit simulator
          that checks what you built against what you derived.
        </div>

        <div
          style={{
            fontSize: 24,
            color: "#52525b",
            marginTop: 44,
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
