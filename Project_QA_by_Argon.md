# **Gatelab Full QA Audit, Sequential Simulation Diagnosis & Patch Guide**

## **1\. Task Contract & Audit Scope**

* **Objective**: Perform a full logical QA audit of Gatelab and resolve all circuit simulation defects in the Practical Lab, with special focus on sequential circuits (gate-level latches, edge-triggered flip-flops, ripple/synchronous counters, and shift registers).  
* **Audited Modules**:  
  * **Simulation Engine**: src/lib/simulation/solver.ts, src/lib/simulation/sequential.ts, src/lib/simulation/sequential-presets.ts, src/lib/simulation/timing.ts, src/lib/simulation/ic-library.ts, src/lib/simulation/elaborate.ts, src/lib/simulation/netlist.ts, src/lib/simulation/parts.ts, src/lib/simulation/place.ts, src/lib/simulation/breadboard.ts, and src/lib/simulation/verify.ts.  
  * **State & Lab UI**: src/stores/sim-store.ts, src/stores/circuit-store.ts, src/components/lab/clock-panel.tsx, src/components/lab/waveform-panel.tsx, src/components/lab/breadboard-view.tsx, and src/app/lab/page.tsx.  
* **Success Criteria**:  
  1. Gate-level bistable feedback circuits (cross-coupled NAND/NOR SR latches, gated D latches, master-slave flip-flops) retain their state across input changes instead of collapsing to X (LX).  
  2. Edge-triggered 74xx sequential ICs (7474, 74LS76A, 74LS107A, 74174, 74175\) and sequential presets count, shift, and plot waveforms cleanly without deadlocking in X or dropping falling clock edges.  
  3. Breadboard operations (Auto-Power, Delete, Pulse, toBreadboard) preserve board state, power rails, and jumper connectivity.

## **2\. Complete QA Defect Scorecard**

### **2.1 Newly Identified Sequential & Lab Simulation Flaws (SEQ-01 – LAB-14)**

| ID | Severity | File(s) & Lines | Issue Summary |
| :---- | :---- | :---- | :---- |
| **SEQ-01** | **Critical** | solver.ts (L258), circuit-store.ts (L68, L221) | **Gate-level latches & flip-flops have zero memory:** settle() resets cellOut to LZ on every evaluation and SeqState only stores SimFlop ICs, causing any NAND/NOR SR latch or gated D-latch to collapse to X (LX) the moment it enters Hold mode. |
| **SEQ-02** | **Critical** | sequential-presets.ts (L69–160), timing.ts (L316–358), clock-panel.tsx | **Sequential presets & timing diagrams deadlock in X:** All flip-flops power up at UNKNOWN (LX) while CLR is held inactive (1). Because toggle(LX) \=== LX and D \= 1QN \= LX, pulsing divide-by-two, ripple-2, ripple-4, or sync-2 leaves outputs stuck at X forever, and WaveformPanel plots 18 cycles of flat X lines. |
| **SEQ-03** | **Critical** | timing.ts (L161, L196), lab/page.tsx (L86) | **Clocked gate circuits fail in Timing Panel:** simulateTimed() only calls simulateClocked() when nl.flops.length \> 0, ignoring nl.clocks.length \> 0\. Any clocked gate-level latch/circuit runs the combinational Gray-code sweep with its clock pin left floating at LZ, even while lab/page.tsx displays Engine: clock-driven. |
| **SEQ-04** | **High** | solver.ts (L197–233) | **Two-phase data sampling race & unpowered flop stale outputs in advance():** advance() mutates state.q in-place while iterating nl.flops, and when an IC loses power (\!isPowered), it sets state.q\[id\] \= UNKNOWN without incrementing moved, skipping the re-settle pass so downstream gates keep reading the old output. |
| **SEQ-05** | **High** | circuit-store.ts (L251, L429–450), clock-panel.tsx (L111) | **Shared pulseTimer drops falling edges & leaks across circuit loads:** A single pulseTimer is shared across all clocks and is never cleared in load(), clear(), resetState(), or toBreadboard(). Pulsing multiple clocks cancels the first clock's falling edge (breaking negative-edge 74LS107A/74LS76A), and loading a circuit within 120ms fires a phantom clock edge. |
| **SEQ-06** | **High** | lab/page.tsx (L480), breadboard-view.tsx (L146–168, L649–765) | **ClockPanel disappears on Breadboard & lacks Clear/Power-cycle:** \<ClockPanel/\> is only rendered when \!onBoard. On the breadboard, users lose the flip-flop state readout (State), the Power-cycle button, and multi-clock support (autoHz only toggles the first clock node). |
| **SEQ-07** | **Medium** | elaborate.ts (L198–216), netlist.ts (L222–230), clock-panel.tsx (L149) | **Unused flip-flops in dual/quad/hex packages pollute state:** buildNetIndex registers every IC pin in dsu, so ord(node.id, pin) is never null. elaborate() instantiates unused flip-flop slots (e.g., slot 2 of 7474 in divide-by-two), showing permanent phantom X states in ClockPanel. |
| **LAB-10** | **Critical** | circuit-store.ts (L382–398) | **Deleting any component on the Breadboard wipes doc.board:** deleteSelected() calls commit({ nodes, wires }) without ...doc, setting doc.board to undefined. Deleting an IC on the breadboard kicks the user into Schematic view with all components stacked at (0, 0\) and leaves orphan hole jumpers. |
| **LAB-11** | **High** | circuit-store.ts (L644–672), breadboard-view.tsx (L1034) | **autoWireIcPower (⚡ \+PWR) fails to power ICs on manual breadboards:** Clicking ⚡ UNPOWERED · AUTO-WIRE only jumpers the IC to \+top/-bottom at hardcoded rows J/A without checking hole occupancy, without creating/wiring \+5V and GND RailNodes, and without bridging split rail segments—leaving the IC unpowered. |
| **LAB-12** | **High** | place.ts (L140–160, L257–399) | **High-fanout nets fail breadboard placement & clock wires lose color:** A 5-hole strip only has 4 free holes beside an IC leg (E/F). When a signal (e.g., 1Q or CLR) has \>4 connections, freeHoleOn() returns null instead of daisy-chaining from an already-connected strip on the same net, and CLK wires are colored switch-blue (\#38bdf8) instead of clock-amber (\#f59e0b). |
| **LAB-13** | **Medium** | lab/page.tsx (L107–133), breadboard-view.tsx (L255–281) | **Duplicate global keydown listeners fire deleteSelected() twice:** Both LabPage and BreadboardView bind Delete/Backspace and Escape on window, executing deleteSelected() twice when onBoard is active. |
| **LAB-14** | **Medium** | circuit-store.ts (L753–762), breadboard-view.tsx (L1055–1112), waveform-panel.tsx (L85–140) | **State persistence & UI mismatches:** partialize omits flopState despite onRehydrateStorage reading state.flopState; IcXRay renders blank boxes on sequential ICs (def.flops); and WaveformPanel shows non-functional gate-delay controls and Gray-code captions on clocked sequential charts. |

### **2.2 Baseline Defects Previously Patch-Verified (LAB-01 – UX-02)**

| ID | Severity | Area / File | Status in Audit Bundle |
| :---- | :---- | :---- | :---- |
| **LAB-01** | Critical | breadboard-view.tsx vs parts.ts | Patched ("Y" pin used for switches and clocks). |
| **LAB-02** | Critical | circuit-store.ts, place.ts | Partially patched (resolves dir \=== "pwr" / "gnd", but autoWireIcPower still fails on unpowered rails — see **LAB-11**). |
| **LAB-03** | High | place.ts, breadboard-view.tsx | Patched (seatOnBoard strips boardRow for non-ICs). |
| **LAB-04** | High | breadboard-view.tsx, circuit-store.ts | Patched (moveNode shifts hole wires within IC column span). |
| **LAB-05** | High | place.ts, lab/page.tsx | Patched for rail wires; discrete gate mapping still pushes gates to unplaced. |
| **LAB-06** | High | router.ts (buildOccupancy) | Tracked in baseline QA (getPinWorldPosition). |
| **LAB-07** | Medium | presets.ts (mux4) | Tracked in baseline QA (D0..D3 4-to-1 mux expression). |
| **LAB-08** | Medium | solver.ts (collapseOscillation) | Patched (flopDrivers and flopOut passed to collapseOscillation). |
| **LAB-09** | Low | gate-symbol.tsx | Tracked in baseline QA (input lead stubs at x \= 0). |
| **XBR-01..04** | High/Med | use-viewbox.ts, breadboard-view.tsx | Patched in breadboard-view.tsx (CHASSIS\_W, \[transform-box:fill-box\], toView). |
| **UX-01..02** | Medium | lab/page.tsx, circuit-store.ts | Patched (clear() pushes to past with Undo toast; rightSidebarOpen defaults open on xl). |

## **3\. Root-Cause Analysis: What Is Wrong in Sequential Circuit Simulation**

### **3.1 Gate-Level Latches & Flip-Flops Have No Memory (SEQ-01)**

In src/lib/simulation/solver.ts (line 258), settle() initializes every gate cell's output array from seed (which defaults to LZ) on every evaluation:

TypeScript  
const seed \= options.seed ?? LZ;  
const cellOut \= new Uint8Array(nl.cells.length).fill(seed);

When a user constructs a **cross-coupled NAND SR latch** (or NOR latch, gated D latch, or master-slave flip-flop out of gates/7400 ICs) and asserts Set (S\_bar \= 0, R\_bar \= 1), the controlling 0 input forces Q \= 1 and Q\_bar \= 0\. However, the moment the user toggles S\_bar back to 1 (S\_bar \= 1, R\_bar \= 1, **Hold mode**), toggleSwitch() triggers simulate(), which calls settle() with a fresh cellOut \= \[LZ, LZ\]:

> 1. Gate 1 evaluates NAND(1, Z) \-\> LX (X).  
> 2. Gate 2 evaluates NAND(1, Z) \-\> LX (X).  
> 3. Both outputs immediately collapse to X (LX), erasing the stored bit.

**Fix**: Carry the settled cellOut vector inside SeqState and persist feedback-loop cell outputs in StoredState (keyed by cell:$node/${slot}). When options.seed \=== undefined (live interactive simulation), initialize cellOut from state.cellOut so feedback loops remember their prior settled state; when options.seed is explicitly passed (such as verify() truth-table sweeps), use options.seed so stateless verification remains pure.

### **3.2 Sequential Presets & Timing Waveforms Deadlock in X (SEQ-02)**

In src/lib/simulation/sequential.ts, flip-flops power up at UNKNOWN (LX), and clockedNext() evaluates toggle(LX) \-\> LX for JK/T flip-flops and D \= 1QN \= LX \-\> LX for a D flip-flop wired as a divide-by-two toggle.

* In src/lib/simulation/sequential-presets.ts (divide-by-two, ripple-2, ripple-4, sync-2), the active-low CLR switch is initialized to 1 (inactive).  
* When a student loads any counter preset and clicks **Pulse** or **Run**, state.clk starts at LZ on load, and state.q stays stuck at LX forever unless the user knows to manually toggle CLR from 1 \-\> 0 \-\> 1\.  
* Worse, in src/lib/simulation/timing.ts, simulateClocked() runs 18 clock cycles starting from the current flopState (LX) with switches held at CLR \= 1\. Opening the Timing Diagram on any counter preset displays flat red X lines across the entire chart.

**Fix**:

> 1. Add a pulseClear() action in circuit-store.ts and expose a **Clear (0)** button in both ClockPanel and the Breadboard Trainer's PULSE / CLK GENERATOR panel, plus a one-click **Initialize (Clear → 0\)** alert action in WaveformPanel when all clocked outputs are stuck at X.  
> 2. In simulateClocked() (timing.ts), if all flip-flops in the passed state are currently at UNKNOWN (LX) and no async clear/preset is actively low, auto-clear state.q to L0 for the timing trace (or after an initial reset tick) so the timing diagram charts the actual counter sequence rather than 18 cycles of X.

### **3.3 Clocked Gate-Level Circuits Are Treated as Combinational in Timing (SEQ-03)**

In src/lib/simulation/timing.ts (line 161), simulateTimed() checks:

TypeScript  
if (nl.flops.length \> 0) return simulateClocked(nl, options);

If a user builds a clocked circuit using logic gates or 7400/7402 ICs with a Clock node (nl.clocks.length \> 0, nl.flops.length \=== 0), simulateTimed() falls through to the combinational Gray-code input sweep. Because the combinational loop (lines 192–207) only populates staticDrivers for nl.railDrivers and nl.inputs—completely omitting nl.clocks—the clock net is left floating (LZ) for the entire sweep, even though src/app/lab/page.tsx (line 86\) labels the panel Engine: clock-driven.  
**Fix**: Route to simulateClocked(nl, options) whenever nl.flops.length \> 0 || nl.clocks.length \> 0\.

### **3.4 Two-Phase Commit & Unpowered Flip-Flop Bug in advance() (SEQ-04)**

In src/lib/simulation/solver.ts (lines 197–233):

> 1. When a flip-flop is unpowered (flop.power && \!isPowered(flop.power, values)), advance() sets state.q\[flop.id\] \= UNKNOWN and executes continue **without incrementing moved**. If moved remains 0, evaluate() returns last without re-running settle(), leaving downstream gates driven by the pre-power-loss output.  
> 2. advance() mutates state.q\[flop.id\] in-place inside the for (const flop of nl.flops) loop. Staging updates into a nextQ buffer and committing after all flip-flops have sampled values guarantees strict two-phase edge sampling.

### **3.5 Shared pulseTimer Drops Falling Edges & Leaks Across Loads (SEQ-05)**

In src/stores/circuit-store.ts (line 251 & lines 429–450):

* A single let pulseTimer variable is shared across all clocks. In ClockPanel (line 111), clicking **Pulse** runs clocks.forEach((c) \=\> pulseClock(c.id)). When a circuit has two clocks, the second pulseClock call executes clearTimeout(pulseTimer), canceling the first clock's setTimeout(..., 120\) falling edge and leaving the first clock stuck HIGH (1). On negative-edge flip-flops (74LS107A, 74LS76A), the flip-flop never triggers.  
* pulseTimer is never cleared in load(), clear(), resetState(), toBreadboard(), or toSchematic(), so switching presets within 120ms of a pulse fires a stray falling clock edge on the newly loaded circuit.

### **3.6 Breadboard Deletion State Wipe & Auto-Power Failures (LAB-10, LAB-11, LAB-12)**

* **deleteSelected() Wipes doc.board (LAB-10)**: In src/stores/circuit-store.ts (line 397), deleteSelected() calls commit({ nodes, wires }) instead of commit({ ...doc, nodes, wires }). Because doc.board is dropped, deleting any IC or switch on the Breadboard immediately drops the user back into Schematic view with every component stacked at (0, 0).  
* **autoWireIcPower Leaves Manual Breadboard ICs Unpowered (LAB-11)**: In src/stores/circuit-store.ts (lines 644–672), clicking ⚡ UNPOWERED · AUTO-WIRE on a breadboard IC only adds two jumpers from row J/A to \+top/-bottom. If the user built the circuit on the breadboard without \+5V and GND RailNodes wired to \+top/-bottom, the rails themselves are floating (LZ), so the IC stays unpowered and the ⚠️ UNPOWERED · AUTO-WIRE badge never clears. Furthermore, it hardcodes rows J and A without checking if a jumper already occupies those holes.  
* **High-Fanout Strip Exhaustion (LAB-12)**: In src/lib/simulation/place.ts, each IC pin sits in row E or F of a 5-hole strip, leaving 4 free holes (A..D or G..J). If a net has more than 4 connections to a single pin, freeHoleOn() returns null and drops the wire into unplaced, instead of chaining from a free hole on a partner strip already wired to the same net.

## **4\. Exact Code Patches**

### **Patch 1: src/lib/simulation/solver.ts**

Adds cellOut state persistence for gate-level sequential feedback loops (SEQ-01) and fixes advance() two-phase sampling and unpowered flip-flop state transitions (SEQ-04).

TypeScript  
// In src/lib/simulation/solver.ts  
// 1\. Replace SeqState, initialState, cloneState, StoredState, toSeqState, and fromSeqState (lines 65-118):

export interface SeqState {  
  /\*\* Per flip-flop, the stored Q. \*/  
  readonly q: Uint8Array;  
  /\*\* Per flip-flop, its clock net's value at the end of the last evaluation. \*/  
  readonly clk: Uint8Array;  
  /\*\* Per gate cell, its last settled output — gives cross-coupled gate latches memory. \*/  
  readonly cellOut?: Uint8Array;  
}

export const initialState \= (nl: SimNetlist): SeqState \=\> ({  
  q: new Uint8Array(nl.flops.length).fill(UNKNOWN),  
  clk: new Uint8Array(nl.flops.length).fill(LZ),  
  cellOut: new Uint8Array(nl.cells.length).fill(LZ),  
});

export const cloneState \= (state: SeqState): SeqState \=\> ({  
  q: new Uint8Array(state.q),  
  clk: new Uint8Array(state.clk),  
  ...(state.cellOut ? { cellOut: new Uint8Array(state.cellOut) } : {}),  
});

export type StoredState \= Readonly\<  
  Record\<string, readonly \[Logic, Logic\] | readonly \[Logic\]\>  
\>;

const keyOf \= (flop: SimFlop): string \=\> \`\${flop.owner.node}/\${flop.owner.slot}\`;  
const cellKeyOf \= (cell: { owner: { node: string; slot: number } }): string \=\>  
  \`cell:\${cell.owner.node}/\${cell.owner.slot}\`;

export function toSeqState(nl: SimNetlist, stored: StoredState | undefined): SeqState {  
  const state \= initialState(nl);  
  if (\!stored) return state;  
  for (const flop of nl.flops) {  
    const saved \= stored\[keyOf(flop)\];  
    if (\!saved || saved.length \< 2) continue;  
    state.q\[flop.id\] \= saved\[0\] as Logic;  
    state.clk\[flop.id\] \= saved\[1\] as Logic;  
  }  
  if (state.cellOut) {  
    for (const cell of nl.cells) {  
      const saved \= stored\[cellKeyOf(cell)\];  
      if (\!saved) continue;  
      state.cellOut\[cell.id\] \= saved\[0\] as Logic;  
    }  
  }  
  return state;  
}

export function fromSeqState(nl: SimNetlist, state: SeqState): StoredState {  
  const out: Record\<string, readonly \[Logic, Logic\] | readonly \[Logic\]\> \= {};  
  for (const flop of nl.flops) {  
    out\[keyOf(flop)\] \= \[state.q\[flop.id\] as Logic, state.clk\[flop.id\] as Logic\];  
  }  
  if (state.cellOut && nl.feedbackLoops.length \> 0) {  
    for (const loop of nl.feedbackLoops) {  
      for (const cellId of loop) {  
        const cell \= nl.cells\[cellId\];  
        if (cell) {  
          out\[cellKeyOf(cell)\] \= \[state.cellOut\[cell.id\] as Logic\];  
        }  
      }  
    }  
  }  
  return out;  
}

TypeScript  
// 2\. In src/lib/simulation/solver.ts — replace evaluate() and advance() (lines 167-234):

export function evaluate(  
  nl: SimNetlist,  
  inputs: InputVector,  
  options: SimOptions \= {},  
): SimState {  
  const state \= cloneState(options.state ?? initialState(nl));  
  if (nl.flops.length \=== 0) {  
    return { ...settle(nl, inputs, options, state), state, edges: 0 };  
  }

  const maxPasses \= nl.flops.length \+ 2;  
  let last \= settle(nl, inputs, options, state);  
  let edges \= 0;

  for (let pass \= 0; pass \< maxPasses; pass++) {  
    const { moved, triggered } \= advance(nl, last.values, state);  
    edges \+= triggered;  
    if (moved \=== 0) return { ...last, state, edges };  
    last \= settle(nl, inputs, options, state);  
  }

  return { ...last, settled: false, state, edges };  
}

function advance(  
  nl: SimNetlist,  
  values: Uint8Array,  
  state: SeqState,  
): { moved: number; triggered: number } {  
  let moved \= 0;  
  let triggered \= 0;  
  const nextQ \= new Uint8Array(state.q);

  for (const flop of nl.flops) {  
    const clockNow \= values\[flop.clock\] as Logic;  
    const wasClock \= state.clk\[flop.id\] as Logic;  
    state.clk\[flop.id\] \= clockNow;

    if (flop.power && \!isPowered(flop.power, values)) {  
      if (state.q\[flop.id\] \!== UNKNOWN) moved \+= 1;  
      nextQ\[flop.id\] \= UNKNOWN;  
      continue;  
    }

    const async \= asyncOutputs(asyncOf(flop, values));  
    if (async) {  
      const forced \= asStored(async.q);  
      if (state.q\[flop.id\] \!== forced) {  
        moved \+= 1;  
        triggered \+= 1;  
      }  
      nextQ\[flop.id\] \= forced;  
      continue;  
    }

    if (\!isEdge(flop.edge, wasClock, clockNow)) continue;

    const before \= state.q\[flop.id\] as Logic;  
    const after \= asStored(  
      clockedNext(flop.kind, flop.data.map((n) \=\> values\[n\] as Logic), before),  
    );  
    nextQ\[flop.id\] \= after;  
    if (after \!== before) {  
      moved \+= 1;  
      triggered \+= 1;  
    }  
  }

  state.q.set(nextQ);  
  return { moved, triggered };  
}

TypeScript  
// 3\. In src/lib/simulation/solver.ts — inside settle() (lines 258 and 319):

  // Seed from explicit options.seed when provided (e.g. verification sweeps),  
  // otherwise preserve feedback cell outputs from \`state.cellOut\` if available.  
  const cellOut \=  
    options.seed \=== undefined &&  
    state.cellOut &&  
    state.cellOut.length \=== nl.cells.length  
      ? new Uint8Array(state.cellOut)  
      : new Uint8Array(nl.cells.length).fill(seed);

  // ... and inside the \`if (equal(cur, next))\` block (line 319):  
    if (equal(cur, next)) {  
      cellOut.set(nextCellOut);  
      if (state.cellOut && state.cellOut.length \=== cellOut.length) {  
        state.cellOut.set(cellOut);  
      }  
      settled \= true;  
      break;  
    }

### **Patch 2: src/lib/simulation/timing.ts**

Routes any circuit with a Clock source (nl.clocks.length \> 0\) or flip-flops (nl.flops.length \> 0\) to simulateClocked() (SEQ-03).

TypeScript  
// In src/lib/simulation/timing.ts (replace line 161):

  // A circuit with flip-flops or a clock source has no combinational truth table  
  // to sweep — drive the clock instead.  
  if (nl.flops.length \> 0 || nl.clocks.length \> 0) {  
    return simulateClocked(nl, options);  
  }

### **Patch 3: src/components/lab/waveform-panel.tsx**

Adds a one-click **"Initialize (Clear → 0)"** banner when clocked outputs are stuck in power-up X (SEQ-02), and hides combinational-only gate-delay buttons and Gray-code descriptions when displaying a clocked waveform (LAB-14).

TypeScript  
// In src/components/lab/waveform-panel.tsx — replace WaveformPanel (lines 26-142):

export function WaveformPanel() {  
  const doc \= useCircuitStore((s) \=\> s.doc);  
  const flopState \= useCircuitStore((s) \=\> s.flopState);  
  const pulseClear \= useCircuitStore((s) \=\> s.pulseClear);  
  const \[delay, setDelay\] \= useState(1);

  const result \= useMemo(() \=\> {  
    const netlist \= elaborate(doc).netlist;  
    return simulateTimed(netlist, { delay, state: toSeqState(netlist, flopState) });  
  }, \[doc, delay, flopState\]);

  if (result.tooWide) {  
    return (  
      \<p className="text-muted-foreground p-3 text-sm text-pretty"\>  
        {result.tooWide.inputs} inputs is{" "}  
        {result.tooWide.combinations.toLocaleString()} combinations — too many to  
        sweep, and far too many to read. The timing diagram covers circuits with up  
        to {MAX\_SWEEP\_INPUTS} inputs; the schematic, the faults and the verification  
        all still work here.  
      \</p\>  
    );  
  }

  if (result.ticks \=== 0\) {  
    return (  
      \<p className="text-muted-foreground p-3 text-sm"\>  
        Add input switches, some gates, and an LED, and the timing diagram will  
        sweep every input combination.  
      \</p\>  
    );  
  }

  const outputWaves \= result.waves.filter((w) \=\> \!w.isInput);  
  const allOutputsUnknown \=  
    Boolean(result.clocked) &&  
    outputWaves.length \> 0 &&  
    outputWaves.every((w) \=\> w.samples.every((s) \=\> s \=== LX || s \=== LZ));

  const width \= LABEL\_W \+ result.ticks \* TICK\_W;  
  const height \= result.waves.length \* ROW\_H \+ 18;  
  const glitchTicks \= new Set(result.glitches.flatMap((g) \=\> g.ticks));

  return (  
    \<div className="space-y-3 p-3"\>  
      {allOutputsUnknown && (  
        \<Alert\>  
          \<Zap className="text-amber-500" /\>  
          \<AlertTitle\>Flip-flops are in power-up unknown state (X)\</AlertTitle\>  
          \<AlertDescription className="flex flex-wrap items-center justify-between gap-2"\>  
            \<span\>  
              Real flip-flops power up in an unknown state (X), and toggling X  
              stays X. Pulse Clear (or initialize to 0\) to see the count waveform.  
            \</span\>  
            \<Button  
              size="sm"  
              variant="secondary"  
              className="h-7 text-xs"  
              onClick={pulseClear}  
            \>  
              Initialize (Clear → 0\)  
            \</Button\>  
          \</AlertDescription\>  
        \</Alert\>  
      )}

      {result.glitches.length \> 0 && (  
        \<Alert\>  
          \<Zap className="text-logic-z" /\>  
          \<AlertTitle\>Glitch detected\</AlertTitle\>  
          \<AlertDescription\>  
            {result.glitches.map((g) \=\> g.label).join(", ")} pulses away from its  
            settled value while the inputs are held steady — a{" "}  
            \<strong\>static hazard\</strong\>, caused by unequal path delays rather  
            than by a logic error. The truth table is still correct, but on real  
            hardware that spike is a real pulse. The cure is a redundant consensus  
            term: the one Quine–McCluskey discarded \<em\>because\</em\> it was  
            redundant.  
          \</AlertDescription\>  
        \</Alert\>  
      )}

      \<div className="flex items-center gap-2"\>  
        {\!result.clocked && (  
          \<\>  
            \<span className="text-muted-foreground text-xs"\>Gate delay\</span\>  
            {\[1, 2, 3\].map((d) \=\> (  
              \<Button  
                key={d}  
                size="sm"  
                variant={delay \=== d ? "secondary" : "ghost"}  
                className="h-7 px-2 font-mono text-xs"  
                onClick={() \=\> setDelay(d)}  
              \>  
                {d}  
              \</Button\>  
            ))}  
          \</\>  
        )}  
        \<span className="text-muted-foreground ml-auto text-xs"\>  
          {result.clocked  
            ? \`\${result.clocked.cycles} clock cycles\`  
            : "Gray-code sweep, forward then back"}  
        \</span\>  
      \</div\>

      \<div className="overflow-x-auto rounded-md border"\>  
        \<svg width={width} height={height} className="block"\>  
          {Array.from({ length: result.steps \+ 1 }, (\_, s) \=\> {  
            const x \= LABEL\_W \+ (result.settleTicks \+ s \* result.ticksPerCombination) \* TICK\_W;  
            return (  
              \<line  
                key={s}  
                x1={x}  
                y1={4}  
                x2={x}  
                y2={height \- 8}  
                className="stroke-border"  
                strokeDasharray="2 3"  
              /\>  
            );  
          })}

          {\[...glitchTicks\].map((t) \=\> (  
            \<rect  
              key={t}  
              x={LABEL\_W \+ t \* TICK\_W}  
              y={4}  
              width={TICK\_W}  
              height={height \- 12}  
              style={{ fill: "var(--logic-z)" }}  
              opacity={0.18}  
            /\>  
          ))}

          {result.waves.map((wave, row) \=\> (  
            \<WaveRow key={wave.label} wave={wave} row={row} /\>  
          ))}  
        \</svg\>  
      \</div\>

      \<p className="text-muted-foreground text-xs"\>  
        {result.clocked  
          ? "Clocked waveform starting from the circuit's current flip-flop state and switch settings."  
          : "Inputs step through every combination changing one bit at a time, then reverse — so each transition is exercised in both directions. A hazard is directional: it appears on a falling edge but not the matching rising one."}  
      \</p\>  
    \</div\>  
  );  
}

### **Patch 4: src/stores/circuit-store.ts**

Fixes per-clock pulseTimers (SEQ-05), adds pulseClear() (SEQ-02), preserves doc.board in deleteSelected() (LAB-10), upgrades autoWireIcPower() so it powers the board rails and picks unoccupied holes (LAB-11), and persists flopState in partialize (LAB-14).

TypeScript  
// In src/stores/circuit-store.ts:  
// 1\. Add \`pulseClear: () \=\> void;\` to \`interface CircuitState\` (around line 117):  
  pulseClockSync: (id: NodeId) \=\> void;  
  /\*\* Pulse active-low CLR/RESET switches (1 \-\> 0 \-\> 1\) or seed flip-flops to 0\. \*/  
  pulseClear: () \=\> void;  
  /\*\* Forget every stored bit, as though the power had just come on. \*/  
  resetState: () \=\> void;

TypeScript  
// 2\. Replace \`let pulseTimer\` and \`pulseClockSync\` (lines 251-287) with per-clock timer management:  
  const pulseTimers \= new Map\<NodeId, ReturnType\<typeof setTimeout\>\>();  
  const clearAllPulseTimers \= (): void \=\> {  
    for (const timer of pulseTimers.values()) clearTimeout(timer);  
    pulseTimers.clear();  
  };

  /\*\* Drive one clock node to a new level and re-simulate. Not an edit. \*/  
  const setClock \= (id: NodeId, to: (level: 0 | 1) \=\> 0 | 1): void \=\> {  
    const { doc, flopState } \= get();  
    const node \= doc.nodes\[id\];  
    if (node?.kind \!== "clock") return;  
    const level \= to(node.state);  
    if (level \=== node.state) return;  
    const nextDoc \= {  
      ...doc,  
      nodes: { ...doc.nodes, \[id\]: { ...node, state: level } },  
    };  
    const next \= simulate(nextDoc, flopState);  
    set({  
      doc: nextDoc,  
      index: next.index,  
      diagnostics: next.diagnostics,  
      routes: next.routes,  
      flopState: next.flopState,  
    });  
  };

  const pulseClockSync \= (id: NodeId): void \=\> {  
    const { doc } \= get();  
    const node \= doc.nodes\[id\];  
    if (node?.kind \!== "clock") return;  
    const existing \= pulseTimers.get(id);  
    if (existing) {  
      clearTimeout(existing);  
      pulseTimers.delete(id);  
    }  
    if (node.state \=== 1) {  
      setClock(id, () \=\> 0);  
    }  
    setClock(id, () \=\> 1);  
    setClock(id, () \=\> 0);  
  };

TypeScript  
// 3\. Replace \`deleteSelected\` (lines 382-398) so \`doc.board\` is preserved and deleted IC strip jumpers are cleaned up:  
    deleteSelected: () \=\> {  
      const { doc, selection } \= get();  
      if (selection.length \=== 0) return;

      const gone \= new Set\<string\>(selection);  
      const deletedIcStrips \= new Set\<string\>();  
      if (doc.board) {  
        for (const id of selection) {  
          const node \= doc.nodes\[id\];  
          if (node?.kind \=== "ic") {  
            const def \= getIc(node.part);  
            const holes \= dipHoles({ col: Math.round(node.pos.x) }, def?.pins.length ?? 14);  
            for (const h of holes) deletedIcStrips.add(stripOf(doc.board, h));  
          }  
        }  
      }

      const nodes \= Object.fromEntries(  
        Object.entries(doc.nodes).filter((\[id\]) \=\> \!gone.has(id)),  
      );  
      const touches \= (e: (typeof doc.wires)\[string\]\["a"\]): boolean \=\> {  
        if (e.kind \=== "pin") return gone.has(e.ref.node);  
        if (doc.board && deletedIcStrips.size \> 0) {  
          return deletedIcStrips.has(stripOf(doc.board, e.ref));  
        }  
        return false;  
      };  
      const wires \= Object.fromEntries(  
        Object.entries(doc.wires).filter((\[, w\]) \=\> \!touches(w.a) && \!touches(w.b)),  
      );  
      set({ selection: \[\] });  
      commit({ ...doc, nodes, wires });  
    },

TypeScript  
// 4\. Replace \`pulseClock\`, \`pulseClockSync\`, and \`resetState\` (lines 429-467):  
    pulseClock: (id, sync \= false) \=\> {  
      if (sync || typeof window \=== "undefined") {  
        pulseClockSync(id);  
        return;  
      }  
      const { doc } \= get();  
      const node \= doc.nodes\[id\];  
      if (node?.kind \!== "clock") return;

      const existing \= pulseTimers.get(id);  
      if (existing) {  
        clearTimeout(existing);  
        pulseTimers.delete(id);  
      }  
      if (node.state \=== 1) {  
        setClock(id, () \=\> 0);  
      }  
      setClock(id, () \=\> 1);  
      const timer \= setTimeout(() \=\> {  
        pulseTimers.delete(id);  
        setClock(id, () \=\> 0);  
      }, 120);  
      pulseTimers.set(id, timer);  
    },

    pulseClockSync,

    pulseClear: () \=\> {  
      clearAllPulseTimers();  
      const { doc, flopState } \= get();  
      const clrSwitches \= Object.values(doc.nodes).filter(  
        (n): n is Extract\<CircuitNode, { kind: "switch" }\> \=\>  
          n.kind \=== "switch" && /^(CLR|RESET|RST|CLEAR)/i.test(n.label),  
      );  
      if (clrSwitches.length \> 0) {  
        const assertedNodes \= { ...doc.nodes };  
        for (const sw of clrSwitches) assertedNodes\[sw.id\] \= { ...sw, state: 0 };  
        const mid \= simulate({ ...doc, nodes: assertedNodes }, flopState);

        const releasedNodes \= { ...doc.nodes };  
        for (const sw of clrSwitches) releasedNodes\[sw.id\] \= { ...sw, state: 1 };  
        const finalDoc \= { ...doc, nodes: releasedNodes };  
        const next \= simulate(finalDoc, mid.flopState);  
        set({  
          doc: finalDoc,  
          index: next.index,  
          diagnostics: next.diagnostics,  
          routes: next.routes,  
          flopState: next.flopState,  
        });  
        return;  
      }

      const { netlist } \= elaborate(doc);  
      const seeded: Record\<string, readonly \[0, 0\]\> \= {};  
      for (const flop of netlist.flops) {  
        seeded\[\`\${flop.owner.node}/\${flop.owner.slot}\`\] \= \[0, 0\];  
      }  
      const next \= simulate(doc, seeded);  
      set({  
        flopState: next.flopState,  
        index: next.index,  
        diagnostics: next.diagnostics,  
        routes: next.routes,  
      });  
    },

    resetState: () \=\> {  
      clearAllPulseTimers();  
      const { doc } \= get();  
      const next \= simulate(doc, {});  
      set({  
        flopState: next.flopState,  
        index: next.index,  
        diagnostics: next.diagnostics,  
        routes: next.routes,  
      });  
    },

TypeScript  
// 5\. Replace \`autoWireIcPower\` (lines 644-672) and add \`clearAllPulseTimers()\` in \`toBreadboard\`, \`toSchematic\`, \`load\`, \`clear\`, \`undo\`, \`redo\`, plus \`flopState\` in \`partialize\`:

    autoWireIcPower: (nodeId) \=\> {  
      const { doc } \= get();  
      const node \= doc.nodes\[nodeId\];  
      if (\!node || node.kind \!== "ic" || \!doc.board) return;  
      const spec \= doc.board;  
      const def \= getIc(node.part);  
      if (\!def) return;

      const nextNodes \= { ...doc.nodes };  
      const nextWires \= { ...doc.wires };  
      const taken \= new Set\<string\>();

      for (const n of Object.values(nextNodes)) {  
        if (n.kind \=== "ic") {  
          const d \= getIc(n.part);  
          for (const h of dipHoles({ col: Math.round(n.pos.x) }, d?.pins.length ?? 14)) {  
            taken.add(\`\${h.col}/\${h.row}\`);  
          }  
        }  
      }  
      for (const w of Object.values(nextWires)) {  
        if (w.a.kind \=== "hole") taken.add(\`\${w.a.ref.col}/\${w.a.ref.row}\`);  
        if (w.b.kind \=== "hole") taken.add(\`\${w.b.ref.col}/\${w.b.ref.row}\`);  
      }

      const pickFree \= (col: number, rows: readonly ("A" | "B" | "C" | "D" | "G" | "H" | "I" | "J")\[\]): HoleRef \=\> {  
        for (const r of rows) {  
          if (\!taken.has(\`\${col}/\${r}\`)) {  
            taken.add(\`\${col}/\${r}\`);  
            return { col, row: r };  
          }  
        }  
        return { col, row: rows\[0\]\! };  
      };

      const pickFreeRail \= (targetCol: number, row: "+top" | "-top" | "+bottom" | "-bottom"): HoleRef \=\> {  
        const targetStrip \= stripOf(spec, { col: targetCol, row });  
        for (let d \= 0; d \< spec.columns; d++) {  
          for (const c of d \=== 0 ? \[targetCol\] : \[targetCol \+ d, targetCol \- d\]) {  
            if (c \>= 1 && c \<= spec.columns) {  
              const cand: HoleRef \= { col: c, row };  
              if (stripOf(spec, cand) \=== targetStrip && \!taken.has(\`\${c}/\${row}\`)) {  
                taken.add(\`\${c}/\${row}\`);  
                return cand;  
              }  
            }  
          }  
        }  
        return { col: targetCol, row };  
      };

      // Ensure \+5V and GND trainer rail nodes exist and feed the breadboard rails  
      let vccNode \= Object.values(nextNodes).find((n) \=\> n.kind \=== "rail" && n.rail \=== "vcc");  
      if (\!vccNode) {  
        const id \= asNodeId(nextId("n"));  
        vccNode \= { id, kind: "rail", rail: "vcc", label: "+5V", pos: { x: 0, y: 0 } };  
        nextNodes\[id\] \= vccNode;  
      }  
      let gndNode \= Object.values(nextNodes).find((n) \=\> n.kind \=== "rail" && n.rail \=== "gnd");  
      if (\!gndNode) {  
        const id \= asNodeId(nextId("n"));  
        gndNode \= { id, kind: "rail", rail: "gnd", label: "GND", pos: { x: 0, y: 0 } };  
        nextNodes\[id\] \= gndNode;  
      }

      const hasVccFeed \= Object.values(nextWires).some(  
        (w) \=\>  
          (w.a.kind \=== "pin" && w.a.ref.node \=== vccNode.id) ||  
          (w.b.kind \=== "pin" && w.b.ref.node \=== vccNode.id),  
      );  
      if (\!hasVccFeed) {  
        const wFeed \= asWireId(nextId("w"));  
        const wBridge \= asWireId(nextId("w"));  
        nextWires\[wFeed\] \= {  
          id: wFeed,  
          a: pinEnd({ node: vccNode.id, pin: "VCC" }),  
          b: holeEnd(pickFreeRail(1, "+top")),  
          color: "\#ef4444",  
        };  
        nextWires\[wBridge\] \= {  
          id: wBridge,  
          a: holeEnd(pickFreeRail(1, "+top")),  
          b: holeEnd(pickFreeRail(1, "+bottom")),  
          color: "\#ef4444",  
        };  
      }

      const hasGndFeed \= Object.values(nextWires).some(  
        (w) \=\>  
          (w.a.kind \=== "pin" && w.a.ref.node \=== gndNode.id) ||  
          (w.b.kind \=== "pin" && w.b.ref.node \=== gndNode.id),  
      );  
      if (\!hasGndFeed) {  
        const wFeed \= asWireId(nextId("w"));  
        const wBridge \= asWireId(nextId("w"));  
        nextWires\[wFeed\] \= {  
          id: wFeed,  
          a: pinEnd({ node: gndNode.id, pin: "GND" }),  
          b: holeEnd(pickFreeRail(1, "-bottom")),  
          color: "\#3b82f6",  
        };  
        nextWires\[wBridge\] \= {  
          id: wBridge,  
          a: holeEnd(pickFreeRail(1, "-top")),  
          b: holeEnd(pickFreeRail(1, "-bottom")),  
          color: "\#3b82f6",  
        };  
      }

      // Bridge split rail segments if needed  
      if (spec.railSegments \> 1) {  
        const perSegment \= Math.ceil(spec.columns / spec.railSegments);  
        for (let seg \= 1; seg \< spec.railSegments; seg++) {  
          const cLeft \= seg \* perSegment;  
          const cRight \= cLeft \+ 1;  
          if (cRight \<= spec.columns) {  
            for (const r of \["+top", "-top", "+bottom", "-bottom"\] as const) {  
              const alreadyBridged \= Object.values(nextWires).some(  
                (w) \=\>  
                  w.a.kind \=== "hole" &&  
                  w.b.kind \=== "hole" &&  
                  w.a.ref.row \=== r &&  
                  w.b.ref.row \=== r &&  
                  Math.min(w.a.ref.col, w.b.ref.col) \<= cLeft &&  
                  Math.max(w.a.ref.col, w.b.ref.col) \>= cRight,  
              );  
              if (\!alreadyBridged) {  
                const wb \= asWireId(nextId("w"));  
                nextWires\[wb\] \= {  
                  id: wb,  
                  a: holeEnd(pickFreeRail(cLeft, r)),  
                  b: holeEnd(pickFreeRail(cRight, r)),  
                  color: isPositiveRail(r) ? "\#ef4444" : "\#3b82f6",  
                };  
              }  
            }  
          }  
        }  
      }

      const col \= Math.round(node.pos.x);  
      const holes \= dipHoles({ col }, def.pins.length);  
      const vccIdx \= def.pins.findIndex((p) \=\> p.dir \=== "pwr");  
      const gndIdx \= def.pins.findIndex((p) \=\> p.dir \=== "gnd");  
      if (vccIdx \=== \-1 || gndIdx \=== \-1) return;

      const vccLeg \= holes\[vccIdx\]\!;  
      const gndLeg \= holes\[gndIdx\]\!;

      const vccHole \= pickFree(vccLeg.col, vccLeg.row \=== "F" ? \["G", "H", "I", "J"\] : \["D", "C", "B", "A"\]);  
      const vccRail \= pickFreeRail(vccLeg.col, vccLeg.row \=== "F" ? "+top" : "+bottom");  
      const gndHole \= pickFree(gndLeg.col, gndLeg.row \=== "E" ? \["D", "C", "B", "A"\] : \["G", "H", "I", "J"\]);  
      const gndRail \= pickFreeRail(gndLeg.col, gndLeg.row \=== "E" ? "-bottom" : "-top");

      const w1 \= asWireId(nextId("w"));  
      const w2 \= asWireId(nextId("w"));  
      nextWires\[w1\] \= { id: w1, a: holeEnd(vccHole), b: holeEnd(vccRail), color: "\#ef4444" };  
      nextWires\[w2\] \= { id: w2, a: holeEnd(gndHole), b: holeEnd(gndRail), color: "\#3b82f6" };

      commit({ ...doc, nodes: nextNodes, wires: nextWires });  
    },

TypeScript  
// 6\. In \`partialize\` (line 753 of src/stores/circuit-store.ts):  
      partialize: (s) \=\> ({  
        doc: s.doc,  
        schematic: s.schematic,  
        origin: s.origin,  
        flopState: s.flopState,  
      }),

### **Patch 5: src/lib/simulation/place.ts**

Colors clock wires amber (\#f59e0b) to distinguish them from data switches (\#38bdf8) and allows freeHoleOn() to daisy-chain from connected strips on the same net when a 5-hole strip fills up (LAB-12).

TypeScript  
// In src/lib/simulation/place.ts:  
// 1\. Track connected strips so high-fanout nets (\>4 jumpers on one pin) can chain to a partner strip (around line 140):

  const connectedStrips \= new Map\<string, Set\<string\>\>();  
  const linkStrips \= (s1: string, s2: string): void \=\> {  
    if (\!connectedStrips.has(s1)) connectedStrips.set(s1, new Set(\[s1\]));  
    if (\!connectedStrips.has(s2)) connectedStrips.set(s2, new Set(\[s2\]));  
    const merged \= new Set(\[  
      ...(connectedStrips.get(s1) ?? \[\]),  
      ...(connectedStrips.get(s2) ?? \[\]),  
    \]);  
    for (const s of merged) connectedStrips.set(s, merged);  
  };

  const freeHoleOn \= (hole: HoleRef): HoleRef | null \=\> {  
    const strip \= stripOf(spec, hole);

    if (strip.startsWith("rail:")) {  
      const maxDist \= Math.max(hole.col \- 1, spec.columns \- hole.col);  
      for (let dist \= 0; dist \<= maxDist; dist++) {  
        const cols \= dist \=== 0 ? \[hole.col\] : \[hole.col \+ dist, hole.col \- dist\];  
        for (const c of cols) {  
          if (c \>= 1 && c \<= spec.columns) {  
            const candidate: HoleRef \= { col: c, row: hole.row };  
            if (stripOf(spec, candidate) \=== strip && \!isTaken(candidate)) {  
              return candidate;  
            }  
          }  
        }  
      }  
      return null;  
    }

    for (const row of nearestRows(hole.row)) {  
      const candidate: HoleRef \= { col: hole.col, row };  
      if (\!isTaken(candidate)) return candidate;  
    }

    // Fallback for high-fanout pins (\>4 jumpers): find a free hole on any strip  
    // already shorted to this strip via an earlier jumper.  
    const peers \= connectedStrips.get(strip);  
    if (peers) {  
      for (const peer of peers) {  
        if (peer \=== strip || \!peer.startsWith("col:")) continue;  
        const \[, colStr, half\] \= peer.split(":");  
        const peerCol \= Number(colStr);  
        const rows \= half \=== "L" ? LOWER\_FREE : UPPER\_FREE;  
        for (const r of rows) {  
          const cand: HoleRef \= { col: peerCol, row: r };  
          if (\!isTaken(cand)) return cand;  
        }  
      }  
    }

    return null;  
  };

  let w \= 0;  
  const jumper \= (a: HoleRef, b: HoleRef, color?: string): void \=\> {  
    const id \= asWireId(\`bb\${++w}\`);  
    occupy(a);  
    occupy(b);  
    linkStrips(stripOf(spec, a), stripOf(spec, b));  
    wires\[id\] \= { id, a: holeEnd(a), b: holeEnd(b), ...(color ? { color } : {}) };  
  };

TypeScript  
// 2\. In \`place.ts\` (lines 257-272), color clock wires amber (\`\#f59e0b\`) and switch wires blue (\`\#38bdf8\`):  
      if (isSwitchA && \!isSwitchB && pinA) {  
        const targetLeg \= wire.b.kind \=== "hole" ? wire.b.ref : (pinB ? (holeOfPin.get(pinKey(pinB)) ?? null) : null);  
        if (\!targetLeg) { unplaced.push(wire.id); continue; }  
        const targetHole \= freeHoleOn(targetLeg);  
        if (\!targetHole) { unplaced.push(wire.id); continue; }  
        const srcNode \= source.nodes\[pinA.node\];  
        const defaultColor \= srcNode?.kind \=== "clock" ? "\#f59e0b" : "\#38bdf8";  
        wirePinToHole(pinA, targetHole, wire.color || defaultColor);  
        continue;  
      }  
      if (isSwitchB && \!isSwitchA && pinB) {  
        const targetLeg \= wire.a.kind \=== "hole" ? wire.a.ref : (pinA ? (holeOfPin.get(pinKey(pinA)) ?? null) : null);  
        if (\!targetLeg) { unplaced.push(wire.id); continue; }  
        const targetHole \= freeHoleOn(targetLeg);  
        if (\!targetHole) { unplaced.push(wire.id); continue; }  
        const srcNode \= source.nodes\[pinB.node\];  
        const defaultColor \= srcNode?.kind \=== "clock" ? "\#f59e0b" : "\#38bdf8";  
        wirePinToHole(pinB, targetHole, wire.color || defaultColor);  
        continue;  
      }

### **Patch 6: src/components/lab/clock-panel.tsx**

Adds a **Clear (0)** button so sequential circuits can be initialized with one click (SEQ-02) and hides internal cell: keys and completely unwired flip-flop slots from the State readout (SEQ-07).

TypeScript  
// In src/components/lab/clock-panel.tsx:  
// 1\. Update store selectors and filter \`stored\` (lines 27-35):  
  const doc \= useCircuitStore((s) \=\> s.doc);  
  const index \= useCircuitStore((s) \=\> s.index);  
  const pulseClock \= useCircuitStore((s) \=\> s.pulseClock);  
  const toggleClock \= useCircuitStore((s) \=\> s.toggleClock);  
  const pulseClear \= useCircuitStore((s) \=\> s.pulseClear);  
  const resetState \= useCircuitStore((s) \=\> s.resetState);  
  const flopState \= useCircuitStore((s) \=\> s.flopState);

  const clocks \= Object.values(doc.nodes).filter((n) \=\> n.kind \=== "clock");  
  const allFlopEntries \= Object.entries(flopState).filter(  
    (\[key\]) \=\> \!key.startsWith("cell:"),  
  );

  // Hide unused flip-flop slots in multi-unit packages (e.g. slot 2 of 7474 in divide-by-two)  
  const stored \= allFlopEntries.filter((\[key\]) \=\> {  
    const \[nodeId, slotStr\] \= key.split("/");  
    if (\!nodeId || \!slotStr || \!index) return true;  
    const prefix \= \`\${slotStr}\`;  
    return index.nets.some(  
      (net) \=\>  
        net.pins.length \> 1 &&  
        net.pins.some(  
          (p) \=\>  
            p.node \=== nodeId &&  
            (p.pin.startsWith(prefix) || p.pin \=== "CLK" || p.pin \=== "CLR"),  
        ),  
    );  
  });

TypeScript  
// 2\. Add the Clear (0) button next to Power-cycle (around line 155):  
          \<Tooltip\>  
            \<TooltipTrigger asChild\>  
              \<Button  
                size="sm"  
                variant="outline"  
                className="h-7 gap-1.5 px-2 text-xs"  
                onClick={pulseClear}  
              \>  
                Clear (0)  
              \</Button\>  
            \</TooltipTrigger\>  
            \<TooltipContent className="max-w-64"\>  
              Pulse active-low Clear (or initialize all flip-flops to 0\) so the  
              counter starts from a known state.  
            \</TooltipContent\>  
          \</Tooltip\>

### **Patch 7: src/components/lab/breadboard-view.tsx**

Toggles all clocks in autoHz, adds a **CLR** button inside the Trainer PULSE / CLK GENERATOR module (SEQ-06), and renders internal flip-flop blocks in IcXRay for sequential ICs (LAB-14).

TypeScript  
// In src/components/lab/breadboard-view.tsx:  
// 1\. Pull \`pulseClear\` from \`useCircuitStore\` (around line 94):  
  const pulseClock \= useCircuitStore((s) \=\> s.pulseClock);  
  const pulseClear \= useCircuitStore((s) \=\> s.pulseClear);

TypeScript  
// 2\. In the \`autoHz\` useEffect (lines 146-168), toggle all clock nodes:  
  useEffect(() \=\> {  
    if (autoHz \=== null) return;  
    const interval \= setInterval(() \=\> {  
      const state \= useCircuitStore.getState();  
      const clks \= Object.values(state.doc.nodes).filter(  
        (n): n is ClockNode \=\> n.kind \=== "clock",  
      );  
      if (clks.length \=== 0\) {  
        const id \= state.addNode({ kind: "clock", label: "CLK", state: 0, pos: { x: 0, y: 0 } });  
        if (id) state.toggleClock(id);  
      } else {  
        for (const c of clks) state.toggleClock(c.id);  
      }  
    }, 1000 / (2 \* autoHz));  
    return () \=\> {  
      clearInterval(interval);  
      const state \= useCircuitStore.getState();  
      for (const n of Object.values(state.doc.nodes)) {  
        if (n.kind \=== "clock" && n.state \=== 1\) {  
          state.setClock(n.id, () \=\> 0);  
        }  
      }  
    };  
  }, \[autoHz\]);

TypeScript  
// 3\. Inside \`IcXRay\` (lines 1055-1112), add rendering for \`def.flops\` when \`def.cells.length \=== 0\`:  
      {def.flops.map((flop) \=\> {  
        const qPinNum \= pinNumberByName.get(flop.qPin);  
        const clkPinNum \= pinNumberByName.get(flop.clockPin);  
        if (\!qPinNum || \!clkPinNum) return null;  
        const qPt \= pinPointMap.get(qPinNum);  
        const clkPt \= pinPointMap.get(clkPinNum);  
        if (\!qPt || \!clkPt) return null;  
        const qHole \= holes\[qPinNum \- 1\]\!;  
        const boxX \= (qPt.x \+ clkPt.x) / 2 \- 11;  
        const boxY \= midY \- 8;  
        return (  
          \<g key={\`flop-\${flop.slot}\`}\>  
            \<XRayLead from={clkPt} to={{ x: boxX \+ 11, y: boxY \+ 8 }} hole={holes\[clkPinNum \- 1\]\!} /\>  
            \<XRayLead from={qPt} to={{ x: boxX \+ 11, y: boxY \+ 8 }} hole={qHole} /\>  
            \<rect  
              x={boxX}  
              y={boxY}  
              width={22}  
              height={16}  
              rx={2.5}  
              fill="rgba(15, 23, 42, 0.88)"  
              stroke="\#38bdf8"  
              strokeWidth={1}  
            /\>  
            \<text  
              x={boxX \+ 11}  
              y={boxY \+ 10.5}  
              textAnchor="middle"  
              fill="\#f8fafc"  
              className="font-mono text-\[6.5px\] font-bold"  
            \>  
              {flop.kind.toUpperCase()}  
              {flop.slot}  
            \</text\>  
          \</g\>  
        );  
      })}

### **Patch 8: src/app/lab/page.tsx**

Prevents duplicate Delete/Backspace and Escape execution when onBoard is active (LAB-13) and keeps \<ClockPanel/\> visible whenever sequential elements exist (SEQ-06).

TypeScript  
// In src/app/lab/page.tsx:  
// 1\. Update the global keydown handler (lines 107-133) so \`BreadboardView\` handles board-specific Delete/Escape without double-firing:  
  useEffect(() \=\> {  
    const onKey \= (e: KeyboardEvent) \=\> {  
      const el \= document.activeElement;  
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      if ((e.key \=== "Backspace" || e.key \=== "Delete") && \!onBoard) {  
        deleteSelected();  
      }  
      if (e.key \=== "Escape") {  
        if (isZenMode) setIsZenMode(false);  
        else if (\!onBoard) useCircuitStore.getState().cancelWire();  
      }  
      if (e.key \=== "f" || e.key \=== "F") {  
        setIsZenMode((v) \=\> \!v);  
      }  
      if (e.key \=== "\[" || e.key.toLowerCase() \=== "b") {  
        setLeftSidebarOpen((v) \=\> \!v);  
      }  
      if (e.key \=== "\]") {  
        setRightSidebarOpen((v) \=\> \!v);  
      }  
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() \=== "z") {  
        e.preventDefault();  
        if (e.shiftKey) redo();  
        else undo();  
      }  
    };  
    window.addEventListener("keydown", onKey);  
    return () \=\> window.removeEventListener("keydown", onKey);  
  }, \[deleteSelected, undo, redo, isZenMode, onBoard, setRightSidebarOpen, setLeftSidebarOpen\]);

TypeScript  
// 2\. In src/app/lab/page.tsx (line 480), render ClockPanel whenever \`\!onBoard\` OR \`hasFlops\` is true:  
          {(\!onBoard || hasFlops) && \!isZenMode && \<ClockPanel /\>}

## **5\. Verification Commands & QA Checklist**

Run the following verification commands from the Gatelab-master root directory after applying the patches:

Bash  
\# 1\. Run all unit & property tests (solver, sequential, sequential-presets, timing, breadboard, verify)  
pnpm test \-- \--run

\# 2\. Run TypeScript compiler & ESLint verification  
pnpm check

### **Interactive QA Checklist**

> 1. **Cross-Coupled Gate Latch (SEQ-01)**: Build a 2-NAND SR latch in Schematic or Breadboard view, set S\_bar \= 0, R\_bar \= 1 (Q \= 1, Q\_bar \= 0), then toggle S\_bar \= 1, R\_bar \= 1 (Hold) — confirm Q \= 1, Q\_bar \= 0 holds its state without collapsing to X.  
> 2. **Sequential Counter Presets & Timing (SEQ-02, SEQ-03, SEQ-07)**: Load **Divide by two**, **2-bit ripple counter**, **4-bit ripple counter**, and **2-bit synchronous counter**, click **Clear (0)**, click **Pulse** / **Run**, and expand **Show Timing Diagram** — confirm the LEDs and timing traces step cleanly through 0, 1, 2, 3... and unused flip-flop slots do not show phantom X values.  
> 3. **Multi-Clock Negative-Edge Pulse (SEQ-05)**: Place two clocks driving two 74LS107A flip-flops and click **Pulse** — confirm both flip-flops receive their falling edges after 120ms.  
> 4. **Breadboard Auto-Power & Delete (LAB-10, LAB-11)**: Switch to **Breadboard**, place a 74LS76A or 7474 from the palette, click ⚠️ UNPOWERED · AUTO-WIRE (confirm the fault clears immediately), and press Delete on a selected IC (confirm the view remains on the Breadboard).

