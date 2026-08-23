/**
 * What the site says about itself, in one place.
 *
 * A note on `KEYWORDS`, because it is the thing everyone asks for and the thing
 * that does the least: Google has ignored `<meta name="keywords">` since 2009,
 * and Bing treats a stuffed one as a *spam* signal. It is here because it costs
 * nothing and a few smaller crawlers still read it — but nothing about being
 * found rests on it.
 *
 * What actually gets a page found is that its TITLE and DESCRIPTION contain the
 * words a person would really type into a search box. So these strings are
 * written around real queries — "karnaugh map solver", "quine mccluskey
 * calculator", "truth table to boolean expression" — rather than around how we
 * describe the product to ourselves. Nobody searches for "verification bridge".
 */

export const SITE = {
  name: "Gatelab",
  url: "https://gatelab-online.vercel.app",
  title: "Gatelab — Boolean minimizer, K-map solver & logic circuit simulator",
  description:
    "Free online Boolean algebra simplifier, Karnaugh map solver and Quine–McCluskey calculator — with a 74xx TTL logic gate and breadboard simulator that verifies the circuit you built against the equation you derived. Runs entirely in your browser.",
  locale: "en_US",
} as const;

export const KEYWORDS = [
  "boolean algebra simplifier",
  "boolean expression simplifier",
  "karnaugh map solver",
  "k-map solver",
  "quine mccluskey calculator",
  "quine mccluskey solver",
  "truth table to boolean expression",
  "truth table generator",
  "boolean function minimizer",
  "sum of products calculator",
  "SOP and POS converter",
  "prime implicant chart",
  "logic gate simulator",
  "logic circuit simulator online",
  "digital logic design",
  "74xx TTL simulator",
  "7400 NAND gate",
  "breadboard simulator",
  "NAND only implementation",
  "static hazard",
  "half adder full adder",
  "multiplexer decoder encoder",
  "logic circuit diagram generator",
  "logic circuit builder",
  "block diagram editor",
  "drag and drop circuit diagram",
  "block diagram digital logic",
  "implement function using multiplexer",
  "full adder using decoder",
  "1 to 16 demultiplexer using decoders",
  "memory expansion decoder chip select",
  "ripple counter timing diagram",
  "export circuit diagram svg png",
  "circuit diagram latex tikz",
  "logic gate tikz",
  "block diagram to latex",
] as const;

/**
 * Structured data. This is the one machine-readable description of the app, and
 * it is what lets a search engine render a rich result rather than a bare link.
 */
export const jsonLd = () => ({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE.name,
  url: SITE.url,
  description: SITE.description,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any (web browser)",
  browserRequirements: "Requires JavaScript.",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Boolean expression parser and truth table generator",
    "Quine–McCluskey minimization with every intermediate step",
    "Karnaugh map with prime-implicant loops",
    "Truth table to Boolean equation to circuit",
    "74xx TTL logic gate and breadboard simulator",
    "Four-state logic (0, 1, Z, X) with fault detection",
    "NAND-only and NOR-only technology mapping",
    "Timing waveforms and static hazard detection",
    "Drag-and-drop block diagram builder for decoders, multiplexers, adders, counters, registers and memory",
    "Group a selection into a reusable block and build hierarchical circuits",
    "Customisable diagram styling with SVG, PNG and LaTeX (TikZ) export",
    "Rotate blocks, place junctions, and snap wires straight",
  ],
});
