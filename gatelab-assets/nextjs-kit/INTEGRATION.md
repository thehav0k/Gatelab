# GateLab brand: Next.js (App Router) integration

The repo was not available in this session, so nothing below has been run against it. Apply in order.

1. Copy `app/*` into your `app/` directory (App Router file conventions pick up `icon.svg`, `favicon.ico`,
   `apple-icon.png`, `opengraph-image.png/.alt.txt`, `twitter-image.*`, `manifest.ts`).
   - DELETE the existing dynamic `app/opengraph-image.tsx` (and `twitter-image.tsx` if present), otherwise two
     conventions collide. Remove any hand-written `<link rel="icon">` / `icons:` metadata for the old icons
     so declarations are not duplicated.
2. Copy `public/brand/*` and `public/icons/*` into `public/`.
3. Copy `components/brand/Logo.tsx`; in the header replace the existing logo element with `<GateLabLogo />`
   (it collapses to the mark on mobile; keep the existing link wrapper and menu button untouched).
4. Import `styles/brand-tokens.css` from `globals.css`, then map your existing blue accent variable to
   `--brand` (and, for Tailwind, `brand: "var(--brand)"` in `theme.extend.colors`). Do NOT recolour the circuit
   canvas, wires, breadboard or fault/unknown-state colours.
5. In `app/layout.tsx` metadata: `themeColor: "#0E1311"` (via `viewport` export in Next 14+), keep title and
   description. The old `meta theme-color` was `#2583FF`.
6. Footer: use `/brand/gatelab-wordmark-dark.svg` or `<GateLabMark />` beside the existing line.
7. Run: `pnpm lint && pnpm tsc --noEmit && pnpm build`, then check `/manifest.webmanifest`,
   `/opengraph-image.png`, and the favicon in a tab.
