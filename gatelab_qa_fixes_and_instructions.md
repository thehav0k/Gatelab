# Gatelab QA Defect Scorecard & Implementation Instructions

## QA Defect Scorecard

| ID | Severity | Area / File | Issue Summary |
|---|---|---|---|
| LAB-01 | Critical | breadboard-view.tsx vs parts.ts | Pin name mismatch ("Q" / "CLK" vs "Y") silently drops manual switch/clock wires from simulation and hides preset switch wires on the breadboard |
| LAB-02 | Critical | circuit-store.ts, place.ts | Hardcoded 14-pin corner power assumptions (Pin 14 / Pin 7) short signal pins (1K, 2CLR) to rails on 16-pin 74LS76A, 74174, and 74175 chips |
| LAB-03 | High | place.ts, breadboard-view.tsx | Adding a Switch, Clock, or LED on the breadboard secretly shorts it to a breadboard strip via seatOnBoard (boardRow: "A" \| "J") even before any wire is drawn |
| LAB-04 | High | breadboard-view.tsx, circuit-store.ts | Dragging an IC horizontally along the breadboard ravine moves the chip (pos.x) but leaves all its hole-to-hole jumpers behind on the old columns |
| LAB-05 | High | place.ts, lab/page.tsx | Switching presets to Breadboard triggers a false ⚠️ 4 parts did not fit on the board toast (counting unmapped schematic power wires as unplaced parts) and drops discrete gate nodes |
| LAB-06 | High | router.ts (buildOccupancy) | Schematic A* router punches pin openings at unrotated coordinates (node.pos + spec.offset), sealing rotated/flipped pins inside obstacle blocks |
| LAB-07 | Medium | presets.ts (mux4) | The 4-to-1 Multiplexer preset is truncated to 2 data inputs (D0, D1) and omits D2 and D3 |
| LAB-08 | Medium | solver.ts (collapseOscillation) | Oscillation collapse omits flopDrivers, causing flip-flop outputs to drop to Z whenever any combinational loop oscillates |
| LAB-09 | Low | gate-symbol.tsx | OR, NOR, XOR, and XNOR symbols lack input lead stubs at x = 0, leaving input pins floating off the curved back |
| XBR-01 | High | use-viewbox.ts, breadboard-view.tsx | No pinch-to-zoom on touch screens, and Breadboard panning requires middle-click or Shift+Drag, making mobile/tablet and trackpad panning impossible |
| XBR-02 | Medium | breadboard-view.tsx (Jumper) | Dragging a jumper's horizontal routing channel mixes raw screen clientY pixels with SVG viewBox units |
| XBR-03 | Medium | breadboard-view.tsx | CSS animate-spin and hover:scale-125 on SVG <circle> elements lack transform-box: fill-box, causing elements to orbit the SVG origin in Safari and Firefox |
| XBR-04 | Medium | breadboard-view.tsx | Fixed trainer chassis width (CHASSIS_W) clips LEDs (>8) and switches (>16) on wider circuits like the 8-bit adder |
| UX-01 | Medium | lab/page.tsx | Clicking the toolbar Trash button (clear()) wipes the entire circuit immediately with no confirmation dialog and does not push to the past undo stack |
| UX-02 | Medium | lab/page.tsx, manual/page.tsx | Right-hand Faults & Verify inspector defaults to closed (rightSidebarOpen = false), hiding live hardware errors, while the Manual lists outdated wire-click shortcuts |

---

## 1. Lab & Circuit Simulator Bugs (And Exact Code Fixes)

### Fix LAB-01 (Trainer Switch & Clock Pin Name Mismatch)
In `src/lib/simulation/parts.ts` (lines 97–109) and `src/lib/simulation/elaborate.ts` (lines 147–161), both switch and clock nodes expose a single output pin named `"Y"`. However, `src/components/lab/breadboard-view.tsx` registers switches as `{ node: sw.id, pin: "Q" }` and clocks as `{ node: clockNode.id, pin: "CLK" }` (lines 146–164, 342, 424, 470, 1219–1223).
- **Why it breaks:** When a user wires a Trainer Switch or Clock to a breadboard hole manually, `buildNetIndex` (`src/lib/simulation/netlist.ts`, line 258) checks `specOf.has(key)`, fails to find `sw::Q` or `clk::CLK`, and silently ignores the wire—so the wire draws on screen while the circuit stays floating (Z). Conversely, when `placeOnBreadboard` seats a preset or synthesized circuit, it creates wires to `pin: "Y"`, which `trainerPinMap` cannot resolve—causing all input switch wires to disappear visually on the breadboard.
- **Code Fix (`src/components/lab/breadboard-view.tsx`):** Change every switch and clock pin reference in `trainerPinMap`, `trainerSocketsList`, `handleClockClick`, `TrainerSwitch`, and `resolveEndpointPoint` from `"Q"` and `"CLK"` to `"Y"`:
```ts
// In trainerPinMap & trainerSocketsList (breadboard-view.tsx):
if (clockNode) register({ node: clockNode.id, pin: "Y" }, { x: 850, y: 55 });
switchNodes.forEach((sw, i) => {
  register({ node: sw.id, pin: "Y" }, { x: 105 + i * 82, y: 668 });
});
```

### Fix LAB-02 (Hardcoded 14-Pin Corner Power Shorting 74LS76A & 16-Pin ICs)
Both `autoWireIcPower` (`src/stores/circuit-store.ts`, lines 464–489) and `placeOnBreadboard` (`src/lib/simulation/place.ts`, lines 167–186) assume VCC is always top-left (col, row F/J) and GND is always bottom-right (col + span - 1, row E/A). On 74LS76A (16-pin DIP with VCC on pin 5 and GND on pin 13), clicking Auto-Power wires Pin 16 (1K) to +5V and Pin 8 (2CLR) to GND, holding flip-flop 2 in permanent reset while leaving the chip unpowered.
- **Code Fix (`src/stores/circuit-store.ts` & `src/lib/simulation/place.ts`):** Resolve the actual VCC and GND holes from `dipHoles` and `def.pins`:
```ts
const holes = dipHoles({ col }, def.pins.length);
const vccIdx = def.pins.findIndex((p) => p.dir === "pwr");
const gndIdx = def.pins.findIndex((p) => p.dir === "gnd");
const vccLeg = holes[vccIdx];
const gndLeg = holes[gndIdx];
// On upper half (row F), free hole is row J -> +top rail; on lower half (row E), row A -> -bottom rail
const vccHole: HoleRef = { col: vccLeg.col, row: vccLeg.row === "F" ? "J" : "A" };
const vccRail: HoleRef = { col: vccLeg.col, row: vccLeg.row === "F" ? "+top" : "+bottom" };
const gndHole: HoleRef = { col: gndLeg.col, row: gndLeg.row === "E" ? "A" : "J" };
const gndRail: HoleRef = { col: gndLeg.col, row: gndLeg.row === "E" ? "-bottom" : "-top" };
```

### Fix LAB-03 (Phantom Shorts When Adding Switches/LEDs on the Breadboard)
When on the breadboard, clicking + Input or + LED (or adding from the Palette) calls `seatOnBoard` (`src/lib/simulation/place.ts`, lines 307–321), which assigns `boardRow: "A"` or `"J"` and `pos: { x: col, y: 0 }`. `seatOf` in `netlist.ts` (lines 354–360) then unions that switch/LED with breadboard strip `col/A` or `col/J`—meaning your Trainer Panel switch is invisibly shorted to column `col` on the breadboard with no jumper wire shown.
- **Code Fix (`src/lib/simulation/place.ts`):** In `seatOnBoard`, only seat `node.kind === "ic"` onto breadboard columns. For `switch`, `clock`, `led`, and `rail`, return `{ ...node, pos: { x: 0, y: 0 }, boardRow: undefined }` so they reside exclusively in the Trainer Panel until wired.

### Fix LAB-04 (Dragging a Breadboard IC Disconnects Its Jumpers)
In BreadboardView (`src/components/lab/breadboard-view.tsx`, line 521), dragging an IC calls `moveNode(node.id, { x: newCol, y: 0 })`. Because breadboard jumpers are stored with HoleRef endpoints (`{ col, row }`), moving the IC leaves its jumpers plugged into the old columns.
- **Code Fix (`src/stores/circuit-store.ts`):** When `doc.board` is active and `moveNode` moves an `ic` from `oldCol` to `newCol` (`delta = newCol - oldCol`), shift any hole wire endpoint whose `col` falls within `[oldCol, oldCol + span - 1]` on terminal rows `A..J` by `delta`. Also disable pointer-events on the `IcXRay` overlay so internal gate SVGs don't block pointer capture when grabbing the chip body.

### Fix LAB-05 (False "4 parts did not fit" Warning & Unmapped Ideal Gates)
In `buildPreset` (`src/lib/simulation/presets.ts`), multi-output presets create multiple rail nodes (`half-adder_S_s4`, `half-adder_C_s4`, etc.). In `placeOnBreadboard` (`panelMode: true`, `src/lib/simulation/place.ts`, lines 189–238), rail nodes are not added to `holeOfPin` because `panelMode` auto-wires IC power. When the loop encounters the schematic's rail -> VCC/GND wires, `endpointHole` returns `null` and pushes those wires into `unplaced`, triggering the misleading toast ⚠️ 4 parts did not fit on the board on Gatelab Lab. Additionally, if the schematic contains discrete gate primitives (such as from the Palette or hierarchical composite presets), `placeOnBreadboard` silently drops them.
- **Code Fix (`src/lib/simulation/place.ts`):** Skip schematic wires connected to rail nodes or IC power pins (VCC/GND) in `panelMode` instead of pushing them to `unplaced`, and technology-map discrete gate nodes into 74xx ICs before seating (or alert specifically when discrete gates are present).

### Fix LAB-06 (Rotated/Flipped Schematic Pins Blocked by Router Occupancy Grid)
In `src/lib/simulation/router.ts` (`buildOccupancy`, line 132), pin cells are unblocked using `{ x: node.pos.x + spec.offset.x, y: node.pos.y + spec.offset.y }`, which ignores `node.rotation`, `node.flipX`, and `node.flipY`. Rotating any gate (R) leaves its actual pins inside -1 obstacle cells, causing A* routing to fail and draw diagonal air-wires.
- **Code Fix (`src/lib/simulation/router.ts`):** Replace line 132 with `const p = getPinWorldPosition(node, spec.name);`.

### Fix LAB-07 (Broken 4-to-1 Mux Preset)
In `src/lib/simulation/presets.ts` (lines 58–64), `mux4` only defines `variables: ["S1", "S0", "D0", "D1"]` and `expr: "S1'*S0'*D0 + S1'*S0*D1"`.
- **Code Fix (`src/lib/simulation/presets.ts`):** Add `"D2", "D3"` to `variables` and update `expr` to `"S1'*S0'*D0 + S1'*S0*D1 + S1*S0'*D2 + S1*S0*D3"`.

### Fix LAB-08 (Oscillation Collapse Drops Flip-Flop Outputs)
In `src/lib/simulation/solver.ts` (`collapseOscillation`, lines 354–361), the local `resolve()` helper omits `flopDrivers` and `flopOut`, resetting flip-flop nets to Z during combinational oscillation. Pass `flopDrivers` and `flopOut` into `collapseOscillation`.

### Fix LAB-09 (Floating Input Pins on Curved Gate Symbols)
In `src/components/lab/gate-symbol.tsx`, add short horizontal input lead lines from `x = 0` to the curved back path of OR, NOR, XOR, and XNOR gates so wires visually meet the symbol at all arities (2, 3, and 4 inputs).

---

## 2. Cross-Browser & Cross-Platform Compatibility Fixes

- **Enable Touch Pan/Pinch-Zoom & Primary-Drag Panning (`use-viewbox.ts` & `breadboard-view.tsx`):**
  - Fix left-click / single touch panning on empty chassis/board areas and touch pinch zoom in `useViewBox`.
- **Fix SVG Transform Origin & Drop-Shadow Glitches on Safari/Firefox (`breadboard-view.tsx`):**
  - Add `[transform-box:fill-box] origin-center` to all transformed SVG child elements and move `drop-shadow(...)` into `style={{ filter: ... }}` or an `<svg><defs><filter>` block.
- **Fix Breadboard Wire Channel Drag Scaling (`breadboard-view.tsx`):**
  - Pass `cam.toView` down to `Jumper` and set `onChannelDrag(Math.round(cam.toView(ev.clientX, ev.clientY).y / 2) * 2)`.
- **Make Trainer Chassis Width Dynamic for Wide Presets (`breadboard-view.tsx`):**
  - Compute `CHASSIS_W = Math.max(BOARD_OFFSET_X * 2 + w, 945 + (ledNodes.length + 1) * 66 + 40, 105 + (switchNodes.length + 1) * 82 + 80)`.

---

## 3. UI/UX Bugs & Workflow Friction

- **Protect the Clear/Trash Action & Support Undo (`circuit-store.ts`, `lab/page.tsx`):**
  - Push previous doc onto `past` inside `clear()` (so Ctrl+Z recovers a cleared board) and add a confirmation or toast action with Undo.
- **Auto-Open or Highlight the Faults/Verify Drawer (`lab/page.tsx`):**
  - Default `rightSidebarOpen` to true on viewports >= 1280px (`xl`), or auto-open it when `expected` is set from Theory.
- **Reconcile Header Numbering & Manual Documentation (`site-header.tsx`, `manual/page.tsx`):**
  - Separate Manual visually with a vertical divider or move it beside Feedback.
  - In Manual and Lab hint bar, change "click a wire to delete it" to "Alt+Click or Delete/Backspace to delete it".

---

## 4. UI Polish & Engineering Aesthetic

- Reduce border radius and use crisp technical hairlines.
- Replace Sparkles icon on deterministic synthesis tabs with `Cpu`, `Sigma`, or `Binary`.
- Refine breadboard and IC materials, tactile switches, and diffused LEDs.
- Ensure Geist Mono typography for pinouts, net tables, and status readouts.
