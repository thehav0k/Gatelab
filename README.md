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

## The two modules

**Theory** — one function, five views. Write it as an expression, as `Σm(1,3,7)`, or
just fill in a blank truth table; they are the same document, and editing one rewrites
the others.

- A Quine–McCluskey minimizer that exposes **every intermediate table** — the combining
  rounds, the prime-implicant chart, the essential PIs, and Petrick's method when the
  chart is cyclic.
- A step-by-step derivation in words, in the order you'd work it on paper.
- A K-map whose loops **are** the prime implicants, rendered — not a second algorithm's
  second opinion.
- Synthesis into real chips, under a gate rule you choose.

**Lab** — a 74xx TTL sandbox on a schematic or a real breadboard.

- **Four-state logic: `0`, `1`, `Z`, `X`.** A boolean simulator reads an unconnected
  input as `false` and cheerfully tells you the circuit works. This one tells you the
  input is floating.
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
- **`variables[0]` is the MSB**, and a variable's bit is decided by its position *in the
  function*, never in the alphabet — `F(S,A,B)` is the natural way to write a
  multiplexer, and lining it up alphabetically reports a correct mux as wrong.

`evaluate(ast, assignment)` is the golden oracle: small enough to verify by hand, and
the thing every later algorithm is property-tested against. The highest-value property
in the codebase is `truthTable(ast) === truthTable(minimize(ast))` over random ASTs —
it catches almost every Quine–McCluskey bug on its own.

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
