import { buildNetIndex, type CircuitDocument, type PinRef } from "./netlist";
import { pinsOf } from "./parts";

/**
 * The wiring, spelled out net by net.
 *
 * A schematic shows you WHERE the wires go; this tells you WHAT they connect, in
 * the language of a datasheet: "U1 pin 3 (2A) ← U2 pin 6 (1Y)". That is the thing
 * a student actually transcribes onto a breadboard, and the thing a flat picture
 * of gate symbols never gives them — which pin number goes to which pin number.
 *
 * It is derived, like everything else, from the same union-find net index the
 * solver uses. A wiring list that disagreed with the simulation would be a second
 * source of truth; this cannot, because it IS the net index, printed.
 */

export interface WiringPin {
  readonly nodeLabel: string;
  /** The pin's name — "1Y", "A", "VCC". */
  readonly pin: string;
  /** DIP pin number for an IC; 0 for an ideal gate/switch/LED. */
  readonly number: number;
  readonly role: "driver" | "load";
}

export interface WiringNet {
  readonly index: number;
  readonly kind: "signal" | "vcc" | "gnd";
  readonly drivers: readonly WiringPin[];
  readonly loads: readonly WiringPin[];
}

export interface WiringSummary {
  readonly nets: readonly WiringNet[];
  readonly icCount: number;
  readonly gateCount: number;
  readonly wireCount: number;
}

export function describeWiring(doc: CircuitDocument): WiringSummary {
  const index = buildNetIndex(doc, pinsOf);

  const pinOf = (ref: PinRef, role: "driver" | "load"): WiringPin | null => {
    const node = doc.nodes[ref.node];
    if (!node) return null;
    const spec = pinsOf(node).find((p) => p.name === ref.pin);
    return {
      nodeLabel: node.label,
      pin: ref.pin,
      number: spec?.number ?? 0,
      role,
    };
  };

  const byLabel = (a: WiringPin, b: WiringPin) =>
    a.nodeLabel.localeCompare(b.nodeLabel, undefined, { numeric: true });

  const nets: WiringNet[] = [];
  index.nets.forEach((net) => {
    // A one-pin net is nothing wired to nothing — not worth a row.
    if (net.pins.length < 2) return;

    const drivers = net.drivers
      .map((r) => pinOf(r, "driver"))
      .filter((p): p is WiringPin => p !== null)
      .sort(byLabel);
    const loads = net.loads
      .map((r) => pinOf(r, "load"))
      .filter((p): p is WiringPin => p !== null)
      .sort(byLabel);

    nets.push({ index: nets.length + 1, kind: net.kind, drivers, loads });
  });

  const values = Object.values(doc.nodes);
  return {
    nets,
    icCount: values.filter((n) => n.kind === "ic").length,
    gateCount: values.filter((n) => n.kind === "gate").length,
    wireCount: Object.keys(doc.wires).length,
  };
}

/** A one-line, datasheet-style rendering of one pin: "U1 pin 3 (2A)". */
export function formatPin(p: WiringPin): string {
  return p.number > 0 ? `${p.nodeLabel} pin ${p.number} (${p.pin})` : `${p.nodeLabel}.${p.pin}`;
}
