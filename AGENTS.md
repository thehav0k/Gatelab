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

**8. A wire is coloured by its NET, not by its logic level.**
Colouring purely by level made every LOW wire the same dark slate, and on a dark
canvas they simply vanished — fourteen wires on screen, four of them visible. And
you could not trace a connection, because every HIGH wire was the same green. A
wire now takes its net's colour, cycled through eight hues, which is exactly why
real jumper wire is multicoloured and for exactly the same reason.

**But the fault colours are not negotiable.** `Z` (floating) and `X` (conflict)
keep their own unmistakable colour and dashing. Net identity is a convenience;
`Z` and `X` are the product, and a broken wire must never be able to look like a
working one.

**7. The component constraint is part of the problem, not a lint.**
"Implement this with NAND only" IS the exercise. So the rule is chosen before you
build: the palette narrows to match (you cannot place what you may not use), and
the synthesizer is steered by it (`constraint.strategy`), so "build it for me"
obeys the rule rather than apologising for breaking it. `violations()` reports
anything already on the board that a newly-chosen rule forbids — switching rules
mid-build must neither silently invalidate the work nor silently bless it.

And a rule can be IMPOSSIBLE. "Build it with XOR only" is a reasonable thing to
ask and a provably impossible thing to do: XOR is affine, affine functions are
closed under composition, and AND is not affine. `completeness.ts` decides this
exactly, by Post's criterion — a gate set is universal iff it escapes all five
maximal clones (T0, T1, monotone, self-dual, affine) — and says *which* one traps
it. The power rails matter here: a constant 1 is not 0-preserving, so having +5V
demolishes T0 and turns the otherwise-impossible `{XOR, AND}` into a universal
set. Ignoring the rails would tell a student their buildable circuit is
impossible.

**9. A block diagram is a SECOND model, not a view of the circuit document.**
`src/lib/diagram/` has its own `Diagram` type — boxes with named ports, and
links between ports. It cannot simulate, it has no nets, no 4-state values and
no faults, and it is not trying to: the lab already does all of that.

The reason it exists is that `CircuitDocument` is the wrong shape for an exam
answer. "Implement a 1-to-16 demultiplexer using 2-to-4 decoders" wants five
labelled boxes, not 96 gates; "show the external connections for a 64×8 memory"
wants an address bus drawn as one line with a slash and a `6` on it, not six
wires. The whole content of those answers is the DECOMPOSITION — which boxes,
what is inside them, what connects to what — and flattening to gates destroys
exactly the information being examined.

Where the two models overlap they share code rather than agreeing by hand: the
gate-level builder runs the LAB's `synthesize` + `technologyMap`, so a NAND-only
drawing is the same circuit the lab would build, and every truth table comes out
of the core engine's canonical vector.

**Three passes, kept separate.** `layout.ts` places, `svg.ts` draws, `theme.ts`
colours. That is what lets a diagram be re-themed and re-exported without being
rebuilt, and it is why no builder in `builders/` contains a colour.

**The exported SVG must be self-contained.** Every colour is an inline hex
attribute; there are no classes, no `var(--…)`, and no external font. Two
reasons, both silent when broken: `@theme inline` does not emit `--color-*` at
all (see the stack notes below), and an SVG opened as a file — or rasterised
into a PNG through an `<img>` — has no stylesheet behind it, so a `var()` there
resolves to nothing and the shape renders invisible with no error. The first
person to see that failure is whoever opens the file.

**One renderer, and the screen uses it too.** The viewer injects the same string
the exporter writes, so what you export is byte-for-byte what you were looking
at. A React tree for the screen plus a serializer for the file is two renderers,
and two renderers drift.

**Layered layout, and the dummy nodes are not optional.** Signals flow left to
right — a force-directed blob is not a different aesthetic here, it is wrong. A
link spanning three columns gets a placeholder in each column it crosses, so
where it passes is a decision rather than an accident; without them the wire runs
at its source's height and saws through the middle of an unrelated block, which
to a reader looks exactly like a connection. `layout.test.ts` asserts over every
diagram in the catalogue that no two blocks overlap and no wire crosses a block
it is not attached to.

**A problem is a function of its parameters, never a stored picture.** Question
12 is not "1-to-16 from 2-to-4"; it is a demultiplexer tree, and the 16 and the 4
are arguments. A stored answer is correct for exactly one phrasing of one
question, and next year's paper changes the 16 to a 32.

**10. The editor is the same model with authored coordinates.**
`src/lib/diagram/editor/` adds a document whose blocks have positions, and
NOTHING else. It produces the same `PlacedDiagram` that `layout()` produces, so
one renderer draws both, one exporter exports both, and "auto-arrange" is
literally `layout()` with its coordinates written back into the document.

**An instance stores the RECIPE, not the block.** `{ part: "decoder", values: {
addr: 3 }, x, y }`, rebuilt through the parts registry on every draw. Storing the
built block would freeze it — changing a placed decoder from 3 address lines to 4
would be impossible, and every saved file would carry a snapshot of whatever the
catalogue looked like that day.

**The canvas draws the exporter's own bytes.** The interactive layer is a
transparent SVG on top that catches pointers and draws selection handles; the
picture underneath is the string `svg.ts` writes. A React tree for the screen
plus a serializer for the file is two renderers, and two renderers drift.
Both layers share the placement's coordinate system (`frame: "canvas"`), so a hit
test compares against the same numbers that were drawn — any offset would mean
clicking a pin an inch from where it appears.

**The editor's router is deliberately NOT the lab's A\*.** `simulation/router.ts`
finds better paths and allocates megabytes per wire; it runs once when a board
changes. A canvas re-routes sixty times a second while a block is dragged, so
`editor/route.ts` proposes the handful of shapes a person would draw, scores them
on bends, length and blocks crossed, and takes the best. It can be beaten in a
dense corner. That is the right trade for an editor and the wrong one for a board.

**An input pin may take more than one wire.** This was forbidden at first, on the
grounds that two drivers on a pin is a bus fight — and it silently deleted three
quarters of every memory diagram, because four chips driving one data bus is
exactly that shape and exactly correct. The lab is where a double-driven net is a
fault with a diagnostic; the editor is a drawing tool, and refusing to draw a
legitimate thing is the tool being wrong about its domain.

**Grouping is the point, and the direction flips at the boundary.** Folding a
selection into a reusable block is what makes this a design tool rather than a
drawing one — a 4-bit adder placed four times is a 16-bit adder. The block's pins
come from the IO tags inside plus any wire that crossed the boundary, and an
Input tag's own pin is an OUTPUT (it drives), so the block's pin on that side is
an INPUT. Taking the direction from the inner pin puts every input on the wrong
side of the box, which the router, the arrowheads and `connect()` all then read.

**Ungrouping dissolves a tag that an outside wire replaced.** Restore the Input
tag as well as the outside driver and the net has two sources. So a boundary pin
that something was wired to is connected straight through to whatever the tag was
feeding; a pin nothing was wired to keeps its tag.

**Generated circuits go through the same operations a hand does.**
`editor/assemble.ts` is the only way anything — the starter templates, the
equation synthesizer — creates a circuit, and it builds through `addFromPalette`
and `connect`. So a generator cannot produce a document the editor could not
have produced: no pin that does not exist, no link the connection rules would
have refused. It throws on a bad wire rather than skipping it, because a
generator with a typo should fail in the test suite, not draw a diagram with one
wire quietly missing.

Nothing hand-places anything either. A generator emits blocks at the origin and
calls `arrange()`, which is `layout()` with its coordinates written back — so
there is still exactly one thing that knows how to lay a diagram out.

**The acceptance test is that the wires compute the function.** `synthesize.test.ts`
walks each generated document back to a value by following its links — through
decoder address decoding, multiplexer select decoding and the gate tables — and
checks every row of the truth table, for six implementations. An inverted enable,
a decoder addressed LSB-first, a Shannon residue read off the wrong half of the
table: none of those look wrong in a picture, and all of them fail here.

**A bit column is a truth table somebody may have got wrong.** `1010` is also a
valid expression — four constants ANDed, which is 0 — so an input that is only
0s, 1s and don't-cares is treated as a truth table and its LENGTH is checked
against the variables. Falling through to the expression parser built a circuit
for the constant 0 from an obvious typo, silently.

**11. A ROTATION belongs to the placement, never to the block.**
A `Block` is what a thing IS; `rotation` is how it happens to be sitting on the
sheet, so it lives on the editor's `Instance` and on `PlacedBlock`, and every
consumer reads already-rotated numbers out of `place.ts` without knowing that
rotation exists. Four angles and not an arbitrary one, because the wires are
orthogonal: a symbol at 37° has no pin a horizontal wire can meet.

**The symbol turns; the writing does not.** A rotated title is not a stylistic
choice, it is an upside-down title. In the SVG each `<text>` is counter-rotated
about its own anchor; in the LaTeX nothing is transformed at all, so labels are
upright for free. Two consequences that were bugs first:

- A box's title and subtitle are ONE text element (a `<tspan>`, a `\\` inside one
  `\node`). Two separately positioned lines each counter-rotated about their own
  anchor land on top of each other, spelling `2-to-4decoder`.
- Pin labels are drawn OUTSIDE the rotated group, from the pin's ROTATED
  direction. "6px right, anchored at the start" is a rule about an upright box;
  applied inside the turn it put every label of a 180° block outside its own
  border, reading outwards.

**A JUNCTION is a block with one pin, not a special kind of wire.** A wire runs
pin to pin, so "somewhere on the sheet" had no representation and two arbitrary
points could not be joined at all. Modelling the dot as a `node` block meant the
router, the exporters, grouping and undo needed no changes. Its pin is
`bidirectional`: a junction is downstream of what drives it and upstream of what
it feeds, so `connect()` takes the direction from the OTHER end. Its `out` vector
is zero — it faces nowhere — and it is NOT an obstacle, because it is a point,
and a router made to avoid it could never reach it.

**A drag places from the ORIGIN, not from last frame.** Blocks snap to an 8px
grid; applying each frame's delta and re-snapping means a 3px move rounds away to
nothing, and the block sticks and then jumps instead of following the pointer.
`dragInstances` takes the positions captured on pointer-down and rounds once, on
the total.

**And the magnet is an EDITING gesture, not a routing one.** A pin sits at a
fraction of its block's height, so two different parts almost never line up, and
the router — correctly doing as it was told — drew a 3px two-bend jog into nearly
every wire. The router cannot fix that: a route's endpoints are the pins and it
may not move them. So `align.ts` moves the BLOCK, during a drag, when a wire is
within a few pixels of straight. It runs nowhere else: silently repositioning
blocks on load, on paste or on undo is the tool arguing with the user.

**12. The worked-solutions catalogue is gated in MIDDLEWARE, not in the page.**
Every route in this app is statically prerendered, so a check inside the page
would run in the browser — after the HTML, answers and all, had already been
sent. `src/middleware.ts` runs before the response exists, which is the only
place a gate can gate.

`solutions-gate.ts` FAILS CLOSED: with no `DIAGRAMS_PASSWORD` set there is no
token that opens the route. Treating "unset" as "open" means one missing
environment variable silently publishes everything, and nothing tells you.

**13. The LaTeX exporter is a THIRD renderer, and it transforms nothing.**
`latex.ts` draws the same `PlacedDiagram` the SVG writer draws, using the same
`measure` / `placePorts` / `gateBackX` geometry — a report written in LaTeX wants
a figure made of the same ink as the rest of the document, not a PNG of one.

**Every coordinate is a plain number.** No `rotate=` scope, no `arc`, no
`transform shape`. The picture's y basis vector is negative (`y=-1pt`) so that
the emitted numbers are the SAME numbers as in the SVG and a bug can be found by
diffing the two — but in a flipped basis, whether a TikZ `rotate=90` reads
clockwise, and which side of the pen an `arc`'s centre falls on, are questions
only pdfLaTeX can settle. Nothing here can run pdfLaTeX. So the rotation is done
in TypeScript and the half-circles are Béziers, and the file cannot be silently
wrong in a way the test suite cannot see.

**Self-contained, for the same reason the SVG is:** `\usepackage{tikz}` and
nothing else. No circuitikz, no arrow library, no font. A figure that only
compiles inside the preamble that generated it is not an export.

**Block circuits only.** Timing charts are not emitted — a waveform strip is a
different kind of figure with its own conventions, and a half-translated one is
worse than an honest omission, so the omission is stated in a comment in the
file.

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
