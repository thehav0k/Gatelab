import type { SimNetlist } from "./elaborate";
import { L0, LX, LZ, isDefinite, type Logic } from "./logic";
import { pinKey, type CircuitDocument, type NetIndex, type NodeId, type PinRef } from "./netlist";
import { cellsOf, flopsOf, pinsOf, powerOf } from "./parts";
import type { SimState } from "./solver";

/**
 * Hardware fault detection.
 *
 * INVARIANT 5: value resolution and fault detection are SEPARATE PASSES. The
 * resolution table always yields a value, so the simulation stays deterministic
 * and useful; this file separately tells the truth about the hardware. Conflating
 * them gives you a simulator that either lies or refuses to run.
 *
 * Note how short each check is. That is the dividend of Invariant 1: because a
 * net is an N-ary set of pins with a driver list, every fault is a one-line
 * predicate over that set. With point-to-point wire edges, every one of these
 * would be a graph traversal.
 */

export type Severity = "error" | "warning" | "info";

export type Diagnostic =
  | { code: "FLOATING_INPUT"; severity: "warning"; message: string; pins: PinRef[]; net: number }
  | { code: "UNDRIVEN_NET"; severity: "warning"; message: string; net: number }
  | { code: "OUTPUT_SHORT"; severity: "error"; message: string; net: number; drivers: PinRef[] }
  | { code: "OUTPUT_TO_OUTPUT"; severity: "warning"; message: string; net: number; drivers: PinRef[] }
  | { code: "OUTPUT_DRIVES_RAIL"; severity: "error"; message: string; net: number; drivers: PinRef[] }
  | { code: "RAIL_SHORT"; severity: "error"; message: string; net: number }
  | { code: "UNPOWERED_IC"; severity: "error"; message: string; node: NodeId; missing: ("vcc" | "gnd")[] }
  | { code: "DANGLING_OUTPUT"; severity: "info"; message: string; pins: PinRef[]; net: number }
  | { code: "UNUSED_GATE"; severity: "info"; message: string; node: NodeId; slots: number[] }
  | { code: "OSCILLATION"; severity: "error"; message: string; nets: number[]; period: number }
  | { code: "FLOATING_CLOCK"; severity: "warning"; message: string; node: NodeId; slots: number[] }
  | { code: "PRESET_AND_CLEAR"; severity: "warning"; message: string; node: NodeId; slots: number[] }
  | { code: "UNINITIALISED_FLOP"; severity: "info"; message: string; node: NodeId; slots: number[] };

export function diagnose(
  doc: CircuitDocument,
  index: NetIndex,
  nl: SimNetlist,
  state: SimState,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const labelOf = (ref: PinRef): string =>
    `${doc.nodes[ref.node]?.label ?? ref.node}.${ref.pin}`;

  /**
   * Spare gates in a package.
   *
   * A 7408 has four AND gates. Use one and the other three sit there with
   * floating inputs and unconnected outputs — which is TRUE, but reporting it as
   * five separate FLOATING_INPUT warnings and three DANGLING_OUTPUTs buries the
   * one fault the student actually needs to see.
   *
   * A gate whose output drives nothing is not faulty, it is UNUSED. We say that
   * once, as information, and suppress the per-pin noise for exactly those pins.
   * (Tying spare TTL inputs off is still good practice, and the message says so —
   * but it is advice, not an error.)
   */
  const unusedPins = new Set<string>();
  const unusedSlots = new Map<NodeId, number[]>();

  for (const node of Object.values(doc.nodes)) {
    const templates = cellsOf(node);
    if (templates.length < 2) continue; // a lone gate primitive is never "spare"

    for (const t of templates) {
      const outNet = index.netOfPin.get(pinKey({ node: node.id, pin: t.outputPin }));
      const net = outNet && index.nets.find((n) => n.id === outNet);
      if (!net || net.loads.length > 0) continue; // it feeds something: in use

      unusedPins.add(pinKey({ node: node.id, pin: t.outputPin }));
      for (const p of t.inputPins) {
        unusedPins.add(pinKey({ node: node.id, pin: p }));
      }
      unusedSlots.set(node.id, [...(unusedSlots.get(node.id) ?? []), t.slot]);
    }
  }

  /**
   * The same rule for flip-flops, and one more besides.
   *
   * A '74 has two flip-flops and a divide-by-two uses one; the other has a
   * floating clock, floating data and an unknown state — all true, and all
   * noise around the one thing the reader needs to see. So a flip-flop whose
   * outputs feed nothing is reported once as spare and its own pins stop
   * complaining.
   *
   * AND AN UNUSED Q-BAR IS NOT A DANGLING OUTPUT. A flip-flop always drives
   * both of its outputs; using only one is not an oversight, it is the normal
   * case, and four "1QN is not connected to anything" notices buried the one
   * message that mattered on a ripple counter.
   */
  const spareFlops = new Set<string>();
  const spareSlots = new Map<NodeId, number[]>();

  for (const node of Object.values(doc.nodes)) {
    for (const t of flopsOf(node)) {
      const used = (pin: string | null): boolean => {
        if (pin === null) return false;
        const netId = index.netOfPin.get(pinKey({ node: node.id, pin }));
        const net = netId && index.nets.find((n) => n.id === netId);
        return (net?.loads.length ?? 0) > 0;
      };

      const qUsed = used(t.qPin);
      const qnUsed = used(t.qnPin);

      if (!qUsed && !qnUsed) {
        spareFlops.add(`${node.id}/${t.slot}`);
        spareSlots.set(node.id, [...(spareSlots.get(node.id) ?? []), t.slot]);
        for (const pin of [t.qPin, t.qnPin, t.clockPin, ...t.dataPins]) {
          if (pin) unusedPins.add(pinKey({ node: node.id, pin }));
        }
        continue;
      }

      // In use — so the output nobody took is simply the one nobody needed.
      if (!qUsed) unusedPins.add(pinKey({ node: node.id, pin: t.qPin }));
      if (!qnUsed && t.qnPin) unusedPins.add(pinKey({ node: node.id, pin: t.qnPin }));
    }
  }

  for (const net of index.nets) {
    const ordinal = index.ordinalOf.get(net.id) as number;

    // --- Vcc shorted to GND ------------------------------------------------
    if (net.railShort) {
      out.push({
        code: "RAIL_SHORT",
        severity: "error",
        message: "Vcc is wired directly to GND. That is a dead short.",
        net: ordinal,
      });
      continue; // every other check on this net would be noise
    }

    const strongDrivers = net.drivers.filter(
      (d) => specOf(doc, d)?.dir === "out",
    );
    const railDrivers = net.drivers.filter((d) => {
      const dir = specOf(doc, d)?.dir;
      return dir === "pwr" || dir === "gnd";
    });

    // --- an output pin wired onto a supply rail ----------------------------
    // Resolution already made this X (supply and strong share a class on
    // purpose), but the value alone doesn't tell the student what they did.
    if (railDrivers.length > 0 && strongDrivers.length > 0) {
      out.push({
        code: "OUTPUT_DRIVES_RAIL",
        severity: "error",
        message: `${strongDrivers
          .map(labelOf)
          .join(", ")} drives the ${net.kind === "gnd" ? "GND" : "+5V"} rail. Remove that wire before it removes the chip.`,
        net: ordinal,
        drivers: [...strongDrivers],
      });
      continue;
    }

    // --- two outputs on one net --------------------------------------------
    if (strongDrivers.length > 1) {
      const value = state.values[ordinal] as Logic;
      if (value === LX) {
        out.push({
          code: "OUTPUT_SHORT",
          severity: "error",
          message: `${strongDrivers
            .map(labelOf)
            .join(" and ")} are wired together and disagree. Two outputs must never share a net.`,
          net: ordinal,
          drivers: [...strongDrivers],
        });
      } else {
        // They happen to agree right now. It is still a fault — it just hasn't
        // bitten yet, and it will the moment an input changes.
        out.push({
          code: "OUTPUT_TO_OUTPUT",
          severity: "warning",
          message: `${strongDrivers
            .map(labelOf)
            .join(" and ")} are wired together. They agree at the moment, but two outputs on one net is a short waiting to happen.`,
          net: ordinal,
          drivers: [...strongDrivers],
        });
      }
    }

    // --- floating inputs ----------------------------------------------------
    // The most common lab mistake there is, and the one a boolean simulator
    // physically cannot see. Spare gates in a package are excluded — they are
    // reported once, below, as UNUSED_GATE.
    const floating = net.loads.filter((p) => !unusedPins.has(pinKey(p)));
    if (net.drivers.length === 0 && floating.length > 0) {
      out.push({
        code: "FLOATING_INPUT",
        severity: "warning",
        message: `${floating
          .map(labelOf)
          .join(", ")} ${floating.length === 1 ? "is" : "are"} floating — nothing drives this net. A floating TTL input is not a 0; it is undefined.`,
        net: ordinal,
        pins: floating,
      });
    }

    // --- an output going nowhere -------------------------------------------
    const dangling = strongDrivers.filter((p) => !unusedPins.has(pinKey(p)));
    if (dangling.length > 0 && net.loads.length === 0 && net.pins.length === 1) {
      out.push({
        code: "DANGLING_OUTPUT",
        severity: "info",
        message: `${dangling.map(labelOf).join(", ")} is not connected to anything.`,
        net: ordinal,
        pins: dangling,
      });
    }
  }

  // --- spare gates ----------------------------------------------------------
  for (const [nodeId, slots] of unusedSlots) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    out.push({
      code: "UNUSED_GATE",
      severity: "info",
      message: `${node.label}${
        node.kind === "ic" ? ` (${node.part})` : ""
      }: gate${slots.length === 1 ? "" : "s"} ${slots.join(", ")} ${
        slots.length === 1 ? "is" : "are"
      } unused. On a real board you would tie their inputs to Vcc or GND rather than leave them floating.`,
      node: nodeId,
      slots,
    });
  }

  // --- sequential parts -----------------------------------------------------
  //
  // Three things go wrong with a flip-flop that cannot go wrong with a gate, and
  // all three present as "the circuit just sits there".
  const floatingClock = new Map<NodeId, number[]>();
  const bothAsync = new Map<NodeId, number[]>();
  const unknownState = new Map<NodeId, number[]>();

  for (const flop of nl.flops) {
    if (spareFlops.has(`${flop.owner.node}/${flop.owner.slot}`)) continue;
    const push = (into: Map<NodeId, number[]>) => {
      const list = into.get(flop.owner.node) ?? [];
      list.push(flop.owner.slot);
      into.set(flop.owner.node, list);
    };

    const clock = state.values[flop.clock] as Logic;
    if (clock === LZ) push(floatingClock);

    const preset = flop.preset === null ? null : (state.values[flop.preset] as Logic);
    const clear = flop.clear === null ? null : (state.values[flop.clear] as Logic);
    if (preset === L0 && clear === L0) push(bothAsync);

    if (state.state.q[flop.id] === LX && clock !== LZ) push(unknownState);
  }

  const list = (slots: number[]) => slots.join(", ");
  const plural = (slots: number[], one: string, many: string) =>
    slots.length === 1 ? one : many;

  for (const [nodeId, slots] of spareSlots) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    // Only worth saying when there is more than one in the package — a lone
    // flip-flop you have not wired yet is a work in progress, not a spare.
    if (nl.flops.filter((f) => f.owner.node === nodeId).length === slots.length) continue;
    out.push({
      code: "UNUSED_GATE",
      severity: "info",
      message: `${node.label}${
        node.kind === "ic" ? ` (${node.part})` : ""
      }: flip-flop${slots.length === 1 ? "" : "s"} ${slots.join(", ")} ${
        slots.length === 1 ? "is" : "are"
      } unused. Tie the spare clock and data pins off rather than leaving them floating.`,
      node: nodeId,
      slots,
    });
  }

  for (const [nodeId, slots] of floatingClock) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    out.push({
      code: "FLOATING_CLOCK",
      severity: "warning",
      message: `${node.label}: the clock on flip-flop${plural(slots, "", "s")} ${list(
        slots,
      )} is not connected. Nothing will ever be loaded — a floating clock has no edges, and an edge is the only thing that moves a flip-flop.`,
      node: nodeId,
      slots,
    });
  }

  for (const [nodeId, slots] of bothAsync) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    out.push({
      code: "PRESET_AND_CLEAR",
      severity: "warning",
      message: `${node.label}: preset and clear are both held low on flip-flop${plural(
        slots,
        "",
        "s",
      )} ${list(slots)}. Both outputs go high, which is not a state the chip can keep — release either one and where it lands is a race.`,
      node: nodeId,
      slots,
    });
  }

  for (const [nodeId, slots] of unknownState) {
    const node = doc.nodes[nodeId];
    if (!node) continue;
    out.push({
      code: "UNINITIALISED_FLOP",
      severity: "info",
      message: `${node.label}: flip-flop${plural(slots, "", "s")} ${list(slots)} ${plural(
        slots,
        "has",
        "have",
      )} never been set or cleared, so ${plural(slots, "its", "their")} output is unknown. A real one powers up in whichever state it falls into — which is why every counter has a clear wired to it.`,
      node: nodeId,
      slots,
    });
  }

  // --- unpowered ICs --------------------------------------------------------
  // The single most common reason a student's board doesn't work, and the exact
  // message we exist to produce.
  for (const node of Object.values(doc.nodes)) {
    const power = powerOf(node);
    if (!power) continue;

    const missing: ("vcc" | "gnd")[] = [];
    const vccNet = index.netOfPin.get(pinKey({ node: node.id, pin: power.vcc }));
    const gndNet = index.netOfPin.get(pinKey({ node: node.id, pin: power.gnd }));

    const vccOk =
      vccNet !== undefined &&
      state.values[index.ordinalOf.get(vccNet) as number] === 1;
    const gndOk =
      gndNet !== undefined &&
      state.values[index.ordinalOf.get(gndNet) as number] === 0;

    if (!vccOk) missing.push("vcc");
    if (!gndOk) missing.push("gnd");
    if (missing.length === 0) continue;

    const pinNumbers = pinsOf(node)
      .filter(
        (p) =>
          (p.dir === "pwr" && missing.includes("vcc")) ||
          (p.dir === "gnd" && missing.includes("gnd")),
      )
      .map((p) => `pin ${p.number} (${p.name})`);

    out.push({
      code: "UNPOWERED_IC",
      severity: "error",
      message: `${node.label}${
        node.kind === "ic" ? ` (${node.part})` : ""
      }: ${pinNumbers.join(" and ")} ${pinNumbers.length === 1 ? "is" : "are"} not connected. The chip has no power, so its outputs are floating.`,
      node: node.id,
      missing,
    });
  }

  // --- unstable feedback ----------------------------------------------------
  //
  // Structural, not value-based. In 4-state logic a ring oscillator does not
  // toggle — NOT(X) = X is a fixed point, so it collapses to a stable X in one
  // delta cycle. Watching for a period-2 wobble would therefore never fire.
  //
  // So we ask a different question: this group of gates provably forms a loop
  // (Tarjan, in elaborate.ts) — did that loop reach a definite value? A latch
  // and `Y = A AND Y, A=0` both do, and are fine. A ring oscillator cannot, and
  // its nets sit at X. Reporting only the loop's OWN nets is what keeps a ring
  // in one corner of the board from turning the whole thing red.
  for (const loop of nl.feedbackLoops) {
    const nets = loop.map((cellId) => (nl.cells[cellId] as { output: number }).output);
    const unstable = nets.filter((net) => state.values[net] === LX);
    if (unstable.length === 0) continue; // the loop settled — a latch, not a fault

    const gates = loop
      .map((cellId) => nl.cells[cellId]?.owner.node)
      .filter((id): id is NodeId => id !== undefined)
      .map((id) => doc.nodes[id]?.label ?? id);

    out.push({
      code: "OSCILLATION",
      severity: "error",
      message: `${[...new Set(gates)].join(", ")} form a feedback loop that never settles to a definite value. Its output is undefined, not 0.`,
      nets: unstable,
      period: state.period,
    });
  }

  // A true period >= 2 oscillation between definite values — rare in 4-state
  // logic, but the solver can still detect it, so do not drop it on the floor.
  if (!state.settled && state.oscillating.length > 0 && nl.feedbackLoops.length === 0) {
    out.push({
      code: "OSCILLATION",
      severity: "error",
      message: `This circuit never settles — ${state.oscillating.length} net${
        state.oscillating.length === 1 ? "" : "s"
      } oscillate with period ${state.period}.`,
      nets: [...state.oscillating],
      period: state.period,
    });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

function specOf(doc: CircuitDocument, ref: PinRef) {
  const node = doc.nodes[ref.node];
  if (!node) return undefined;
  return pinsOf(node).find((p) => p.name === ref.pin);
}

/** True when every net carries a definite level — nothing floating, nothing in conflict. */
export const isClean = (state: SimState): boolean =>
  state.settled && [...state.values].every((v) => isDefinite(v as Logic));
