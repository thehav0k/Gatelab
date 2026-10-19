import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GateLab",
    short_name: "GateLab",
    description: "Boolean algebra, wired up. Derive, diagram, wire and verify digital logic in your browser.",
    start_url: "/",
    display: "standalone",
    background_color: "#0E1311",
    theme_color: "#0E1311",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
