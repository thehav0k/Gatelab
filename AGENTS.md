# Gatelab

A client-side digital logic design lab assistant. Two modules — a Boolean
minimization workspace (`/theory`) and a 74xx TTL circuit sandbox (`/lab`) —
joined by a verification bridge that checks the circuit you built against the
algebra you derived.

Run `pnpm check` (typecheck + lint + test) before every commit. That is the
whole policy.

## Architectural invariants

These are load-bearing. Violating one means a rewrite, not a patch.

**1. Nets are N-ary, derived, and never authored.**
A wire is what the user drew and what undo/redo operates on. A *net* is an
equipotential set of pins, rebuilt from scratch by union-find on every topology
change. Point-to-point `source → target` edges cannot represent a Vcc rail (one
node, fifty connections), have nowhere to hang a resolved value or a driver
list, and force every consumer to re-derive the transitive closure with subtly
different bugs. Every fault we detect is a one-line predicate over a net's
member set.

Rebuilding is `O(n·α)` and sub-millisecond. **Never optimize it into an
in-place update** — that is where ghost connections come from.

This invariant has now been cashed in. The breadboard (`breadboard.ts`) is a
*shorting device* — a 5-hole strip is a hard short, a power rail is one node with
fifty connections — and neither can be expressed as a point-to-point edge. Adding
it required seeding the strips into the same union-find and nothing else: the
solver, the diagnostics, and the verification bridge were not touched. A board
seated from a synthesized design verifies against the original algebra.

The three facts that make a breadboard a breadboard, all of them load-bearing:
holes A–E short, F–J short *separately*, and **they never meet** (the centre
channel is what a DIP straddles — short it and every gate is wired
input-to-output); and the power rails are **broken at the midpoint**, so a jumper
in the left half does not power a chip wired to the right half.

**2. Logic is 4-state (`0 | 1 | Z | X`), never boolean.**
Without `Z` an unconnected input reads as `false`, the circuit silently "works",
and the product's core feature dies. Without `X` two conflicting drivers need a
tiebreak and an output short gets a plausible value. An unpowered IC outputs
`Z`, which boolean cannot express.

**`Z` must never coerce to `0`** — not in a gate table, not via `!!value`, not
in the LED renderer. A floating TTL input physically floats *high*, so
defaulting to `0` is the worst available guess. Propagate `X` and raise a
diagnostic.

**3. `src/lib/**` is pure.**
No React, no Next, no stores, no DOM, no `Date`, no `Math.random`. It must load
in a Web Worker and in a Node test. Enforced by `no-restricted-imports` in
`eslint.config.mjs`, not by discipline. This one rule is what makes the engine
worker-loadable, fast to test, and reusable by the verification sweep.

**4. The K-map does not re-derive groupings.**
K-map loops *are* Quine–McCluskey prime implicants, rendered. A second,
independent grouping algorithm is two chances to be wrong and two answers to
reconcile. The K-map is a view of the QM result.

**5. Value resolution and fault detection are separate passes.**
The resolution table always yields a value, so the simulation stays
deterministic and useful. `diagnostics.ts` separately tells the truth about the
hardware. Do not conflate them.

**6. A wire's route is cosmetic. Connectivity never depends on it.**
Routes are *derived* state, like nets — computed from the topology, stored in
the store, and deliberately kept out of the document and out of undo history
(nobody wants to undo a bend). If the router cannot find a path, the wire is
still a wire, its net is still merged, and the simulation is untouched; the
canvas draws a dashed air-wire and says so.

The router is A\* over `(x, y, incoming-direction)`, **not** Lee's algorithm or
any other BFS. BFS is optimal only when every edge costs the same, and a bend
penalty makes the graph weighted — so a FIFO queue returns a shortest-*length*
path with an arbitrary number of jogs. "Is this step a bend?" depends on how you
arrived, which is why the direction is part of the state.

**7. The component constraint is part of the problem, not a lint.**
"Implement this with NAND only" IS the exercise. So the rule is chosen before you
build: the palette narrows to match (you cannot place what you may not use), and
the synthesizer is steered by it (`constraint.strategy`), so "build it for me"
obeys the rule rather than apologising for breaking it. `violations()` reports
anything already on the board that a newly-chosen rule forbids — switching rules
mid-build must neither silently invalidate the work nor silently bless it.

## The MSB contract

For variable `variables[i]` of an n-variable function, its bit inside minterm
index `m` is `(m >>> (n - 1 - i)) & 1`. **`variables[0]` is the most significant
bit.** This is the contract between the parser, the truth table, the QM cube
bitmasks, and the K-map Gray code. Use the `bitOf` / `varMask` helpers in
`src/lib/core-engine/types.ts` — never hand-roll the shift anywhere else.

**And a variable's bit is decided by its position IN THE FUNCTION, never by its
position in the alphabet.** The netlist sorts input switches by label; a function
lists its variables in declaration order, and `F(S, A, B)` is the natural way to
write a multiplexer. Lining those two up positionally checked every row against
the wrong input combination and reported a *correct* mux as wrong — the single
most damaging thing the verification bridge can do. `verify()` builds an explicit
switch → variable-index map; do not shortcut it.

## Testing

The line is drawn hard at `src/lib/`: pure, and covered. Components are tested
only where they encode logic, and the correct response to a testable component
is to extract that logic into `src/lib/` until nothing testable is left in it.
No snapshot tests.

`evaluate(ast, assignment)` is the **golden oracle** — small enough to verify by
hand, and the thing every later algorithm is property-tested against with
`fast-check`. The highest-value property in the codebase is
`truthTable(ast) === truthTable(minimize(ast))` over random ASTs; it catches
almost every Quine–McCluskey bug on its own.

## Stack notes

- Tailwind **v4** — there is no `tailwind.config.js`. Design tokens live in
  `src/app/globals.css`.

  **Gotcha, and it is silent:** the block is `@theme inline`, which folds token
  values directly into utility classes and **does not emit the `--color-*`
  custom properties**. So `text-logic-high` and `fill-logic-high` work, but
  `style={{ stroke: "var(--color-logic-high)" }}` resolves to nothing and the
  element renders uncolored with no error. When you need a token in an inline
  style or an SVG attribute — which the circuit renderer does constantly —
  read the raw token (`var(--logic-high)`, `var(--loop-3)`), which *is* emitted
  in `:root` and `.dark`.
- TypeScript is pinned to **5.9.3**. `typescript@latest` is the 7.x Go rewrite
  and `typescript-eslint` does not support it. Do not upgrade.
- `noUncheckedIndexedAccess` is on. This codebase indexes `values[m]`,
  `kmap[r][c]`, and `pins[i]` constantly; an off-by-one should be a type error,
  not a silently wrong truth table.
