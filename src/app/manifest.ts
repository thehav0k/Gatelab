import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GateLab — Boolean Algebra & 74xx TTL Breadboard Simulator",
    short_name: "GateLab",
    description:
      "Derive minimal Boolean functions, draw block schematics, wire 74xx TTL chips on a virtual breadboard, and verify 2^n truth tables 100% in your browser.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    /**
     * Brand colors:
     *   background_color — graphite from brand-tokens.css (#0E1311)
     *   theme_color      — same graphite (matches Android tab bar)
     */
    background_color: "#0E1311",
    theme_color: "#0E1311",
    categories: ["education", "utilities", "developer tools"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "1. Theory & K-Map",
        short_name: "Theory",
        description: "Derive Boolean functions, truth tables, and K-maps",
        url: "/theory",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "2. Diagram Workbench",
        short_name: "Diagram",
        description: "Build schematics and export LaTeX TikZ / SVG",
        url: "/diagram",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "3. Practical 74xx Lab",
        short_name: "Lab",
        description: "Simulate 74xx TTL chips on schematic or breadboard",
        url: "/lab",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "User Manual & Quickstart",
        short_name: "Manual",
        description: "74xx pinout tables, shortcuts, and quickstart guide",
        url: "/manual",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
