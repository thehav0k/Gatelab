<div align="center">

# Gatelab

**Boolean algebra, wired up.**

A digital logic design lab that takes a function from minimization all the way to a
TTL circuit on a breadboard — and then checks that what you built actually matches
what you derived.

[**gatelab-online.vercel.app**](https://gatelab-online.vercel.app) · [User manual](https://gatelab-online.vercel.app/manual)

</div>

---

## What it is

Students learn Boolean minimization and TTL breadboarding as two disconnected
skills. Tools exist for each; nothing joins them. Gatelab is the join.

Minimize an expression, build the circuit with real 74xx chips, hit **Verify**, and
be told *"your circuit outputs 0 at A=1, B=0, C=1 — expected 1."* Then get told
**why**: every output bit inverted means you used NAND where AND was needed; a table
that matches under a column swap means two input wires are crossed.

It runs entirely in your browser. Nothing is uploaded, and there is no backend.

## The modules

**Theory** — one function, five views. Write it as an expression, as `Σm(1,3,7)`, or
just fill in a blank truth table; they are the same document, and editing one rewrites
the others.

- A Quine–McCluskey minimizer that exposes **every intermediate table** — the combining
  rounds, the prime-implicant chart, the essential PIs, and Petrick's method when the
  chart is cyclic.
- A step-by-step derivation in words, in the order you'd work it on paper.
- A K-map whose loops **are** the prime implicants, rendered — not a second algorithm's
  second opinion.
- Synthesis into real chips, under a gate rule you choose — shown as a gate diagram,
  as packed 74xx chips, and as a **pin-by-pin wiring list** (`U1 pin 2 (1Y) → U2 pin 1
  (1A)`) you can transcribe straight onto a breadboard.

**Builder** — a drag-and-drop canvas for block diagrams of any size.

Drag gates, decoders, multiplexers, encoders, adders, comparators, ALUs,
flip-flops, registers, counters, shift registers and memory onto a sheet and wire
pin to pin. Every part is *parametric* — a decoder is not a block, a decoder with
three address lines and an active-low enable is — so a placed block changes shape
when you change its settings, and the wires that still have pins stay attached.
When the palette has not got what you need, the **Custom block** is a box whose
title and pin lists you type in.

- **Type an equation and have it built.** An expression, a minterm list, or the
  output column — whichever your question gave you, one function per line — and
  six ways to implement it: gates, NAND-only, NOR-only, a decoder with collecting
  OR gates, one multiplexer by Shannon expansion, or a reduced tree of 2-to-1
  multiplexers. What lands on the canvas is ordinary parts and ordinary wires,
  editable like anything else.
- **Or auto-wire a block you placed yourself.** Drop a 3-to-8 decoder, give it a
  truth table, and it grows the inputs, the collecting gates and the outputs
  around *that* decoder — the answer to "implement f using a 3-to-8 decoder",
  where the part is dictated and only the wiring is yours. Pins you already wired
  are left alone, and a decoder of the wrong width is refused with the number to
  change rather than silently reshaped.
- **Group a selection into one reusable block.** This is the part that makes it a
  design tool rather than a drawing tool: build a 4-bit adder, fold it into a
  block, place it four times, and you have a 16-bit adder. The new block's pins
  come from the Input and Output tags inside it plus any wire that crossed the
  boundary; ungrouping puts the contents back and reconnects the outside world to
  the right inner pins.
- **Rotate anything** with `R`, in either direction. The symbol turns; the
  writing does not — a rotated title is not a style, it is an upside-down title.
- **Per-wire colour.** Signals get their own hue automatically, cycled through
  the theme's palette in order; select a wire and pick a colour to override it
  when the reader has to be shown *that* one.
- **Junctions.** Drag a wire into empty space and you get a dot there, wired up.
  A wire runs pin to pin, so two arbitrary *points* had nothing to join them
  until the dot became a block with one pin — which is what a junction has
  always been on paper.
- **Wires come out straight.** Pins sit at fractions of their block's height and
  almost never line up, so a rough drag used to leave a 3px jog in nearly every
  wire. While you drag, a block within a few pixels of straightening one of its
  wires is pulled the rest of the way. Type exact coordinates if you would
  rather, or nudge with the arrow keys.
- **Auto-arrange** is not a second layout engine — it runs the same layered
  placement the solutions use and writes the coordinates back as ordinary
  positions, so the result is still yours to move.
- Save and reopen as JSON, or export as SVG, PNG or LaTeX.

**Worked solutions** — the same engine, aimed at a set of standard exam questions,
and **behind a password** (`DIAGRAMS_PASSWORD`).

Forty-six of the standard digital-logic questions, each one parameterised down to
the thing it is actually about. "Implement a 1-to-16 demultiplexer using 2-to-4
decoders" is really *a demultiplexer tree*, so the 16 and the 4 are inputs — move
them and you get a correct answer to a question that was not on the sheet.

- Decoder and multiplexer implementations of any function, ripple and parallel
  adders, 2's complement two ways, comparators, priority encoders, counters with
  a **timing diagram whose traces are actually skewed** (an asynchronous counter
  drawn edge-aligned is a synchronous counter mislabelled), sequential design from
  excitation equations with the state table computed from the same text, and
  memory/ROM expansion at any size.
- Every drawing comes with the truth table, the minimal expression and the worked
  reasoning — all recomputed from the same engine, so the prose cannot claim
  three gates beside a picture of six.

**Export is the deliverable**, for both of them. SVG, PNG or **LaTeX**, with the background,
the wire colours and widths, the corner radii, the fonts and the per-category
block colours all yours. There is one renderer, and the canvas injects exactly
the string the exporter writes — what you export is byte-for-byte what you were
looking at. The exported file is self-contained: inline hex, no stylesheet, no
web font, so it survives being dropped into somebody else's document.

**Lab** — a 74xx TTL sandbox on a schematic or a real breadboard.

- **Four-state logic: `0`, `1`, `Z`, `X`.** A boolean simulator reads an unconnected
  input as `false` and cheerfully tells you the circuit works. This one tells you the
  input is floating.
- **Gates with 2, 3 or 4 inputs**, chosen in the palette or changed on a placed gate;
  NOT is always 1-input.
- Real pinouts from the datasheets — the 7402's gate-1 output really is on pin 1.
- Fault detection for the mistakes that actually happen at a bench: forgotten Vcc,
  floating input, output short, rail short, oscillating feedback loop.
- A breadboard that shorts like a breadboard: A–E and F–J are separate strips that
  never meet across the channel, and the power rails are broken at the midpoint.
- Timing waveforms with unit gate delay and a Gray-code sweep, so **static hazards show
  up as real glitches** — and the redundant term the minimizer discarded is the one
  that cures them. Minimal is not hazard-free, and you can see it.

**Gate rules.** "Implement this with NAND only" is the exercise, not a lint — the
palette narrows to match and the synthesizer obeys. Some rules are *impossible*
("XOR only" cannot make an AND), and Gatelab proves it via Post's criterion and tells
you which of the five maximal clones traps you, rather than building something that
quietly breaks the rule.

**Building blocks & hierarchy.** The presets are organized around one idea — complex
circuits are built from simple ones. A full adder wired from **two half adders and an
OR**; a 4:1 mux as a tree of **three 2:1 muxes**; an 8:1 mux from **two 4:1s and a
2:1**; and ripple-carry adders up to **16 bits**, each one *n* full adders with the
carry rippling through. The blocks are placed as distinct clusters and wired
port-to-port, so the decomposition is visible — and every one is a real, simulatable,
verifiable board, composed from the same gate tables everything else uses. (An 8-bit
adder's truth table has 2¹⁷ rows, which is exactly why you build it from blocks rather
than minimize it.)

## Running it

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm check        # typecheck + lint + test — run before every commit
```

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm check` | Typecheck + lint + test |
| `pnpm test` | Vitest |
| `pnpm coverage` | Coverage, with a ratchet on `src/lib` |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 · Tailwind v4 · shadcn/ui ·
Zustand · Framer Motion · Vitest + fast-check.

No `React Flow` (its edges are strictly two-endpoint and cannot model a net), no
canvas library, no PDF library — the report prints through the browser's own engine,
so the circuit stays a vector.

## Architecture

The engine lives in `src/lib/`, and it is **pure**: no React, no DOM, no `Date`, no
`Math.random`, enforced by ESLint. It loads in a Web Worker and in a Node test, and
the verification sweep reuses it as-is.

A few decisions are load-bearing enough that violating one means a rewrite rather
than a patch. They are written down in [`AGENTS.md`](./AGENTS.md), and the short
version is:

- **Nets are N-ary, derived, and never authored.** A wire is what the user drew; a
  *net* is an equipotential set of pins, rebuilt from scratch by union-find on every
  topology change. A point-to-point edge cannot represent a Vcc rail — one node, fifty
  connections — and every fault we detect is a one-line predicate over a net's members.
- **`Z` must never coerce to `0`.** A floating TTL input physically floats *high*, so
  guessing `0` is the worst available answer. Propagate `X` and raise a diagnostic.
- **The K-map does not re-derive groupings.** Two grouping algorithms are two chances
  to be wrong and two answers to reconcile.
- **A block diagram is a second model, not a view of the circuit document.** An exam
  answer is boxes and buses; flattening a demultiplexer tree to 96 gates destroys the
  decomposition that *is* the answer. Where they overlap they share code — the
  gate-level drawing runs the lab's own synthesizer — rather than agreeing by hand.
- **The builder is that model with authored coordinates, and nothing else.** It
  produces the same placed diagram the auto-layout produces, so one renderer draws
  both and the canvas shows you the exporter's own bytes.
- **A junction dot is derived from where the wires ended up.** Counting the
  distinct directions of ink leaving a point puts the dot at the T, where the
  branches actually part — not on the pin, where nothing branches and the old
  rule put it, leaving the real junction undotted and therefore saying "not
  connected".
- **A rotation belongs to the placement, never to the block.** A block is what a
  thing *is*; how it happens to be sitting is somebody's drawing decision, and
  every consumer reads already-rotated numbers without knowing rotation exists.
- **The LaTeX export transforms nothing.** Every coordinate is a plain number: no
  `rotate=` scope and no `arc`, because in a y-flipped TikZ picture the sign of
  an angle is exactly the kind of thing only pdfLaTeX can settle — and nothing
  here can run pdfLaTeX. It needs `\usepackage{tikz}` and nothing else.
- **`variables[0]` is the MSB**, and a variable's bit is decided by its position *in the
  function*, never in the alphabet — `F(S,A,B)` is the natural way to write a
  multiplexer, and lining it up alphabetically reports a correct mux as wrong.

`evaluate(ast, assignment)` is the golden oracle: small enough to verify by hand, and
the thing every later algorithm is property-tested against. The highest-value property
in the codebase is `truthTable(ast) === truthTable(minimize(ast))` over random ASTs —
it catches almost every Quine–McCluskey bug on its own.

## Configuration

| Variable | What it does |
| --- | --- |
| `DIAGRAMS_PASSWORD` | The shared password for `/solutions`. **Unset means locked**, not open — the gate fails closed, so a missing variable can never publish the catalogue by accident. |
| `NEXT_PUBLIC_FEEDBACK_ENDPOINT` | Where the feedback form posts. Defaults to a FormSubmit relay. |

## Feedback

Found a wrong answer, a bad pinout, or something that should exist and doesn't? That's
the most useful thing you can send. There's a **Feedback** button in the header, or:

- **Email** — [asifksifat@gmail.com](mailto:asifksifat@gmail.com)
- **GitHub** — [@thehav0k](https://github.com/thehav0k)

<sub>The in-app form relays through [FormSubmit](https://formsubmit.co) so the app can
stay backendless. Point `NEXT_PUBLIC_FEEDBACK_ENDPOINT` at any JSON endpoint to change
that; if the relay is unreachable the form falls back to opening your own mail client
with the message pre-filled, rather than pretending it was delivered.</sub>

## License

MIT
