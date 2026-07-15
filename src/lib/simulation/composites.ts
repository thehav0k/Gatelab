import type { CompositeSpec, Instance, Source } from "./compose";

/**
 * The hierarchical presets — circuits built from BLOCKS, where the decomposition
 * is the whole point.
 *
 * These are the answer to "implement a full adder with half adders" and "an 8:1
 * mux from 4:1 muxes": not a flattened truth table, but the actual block diagram,
 * wired up and simulatable. An 8-bit adder here is eight full adders with the
 * carry rippling through — which is the only honest way to draw it, since its
 * flat truth table has 2^17 rows.
 */

// --- a ripple-carry adder of any width, generated -------------------------

function rippleAdder(bits: number): CompositeSpec {
  const inputs: string[] = [];
  // A(bits-1..0), then B(bits-1..0), then the carry-in — MSB first reads naturally.
  for (let i = bits - 1; i >= 0; i--) inputs.push(`A${i}`);
  for (let i = bits - 1; i >= 0; i--) inputs.push(`B${i}`);
  inputs.push("Cin");

  const instances: Instance[] = [];
  const connections: { from: Source; to: string }[] = [];
  for (let i = 0; i < bits; i++) {
    const id = `FA${i}`;
    instances.push({ id, block: "fa" });
    connections.push({ from: `in:A${i}`, to: `${id}.A` });
    connections.push({ from: `in:B${i}`, to: `${id}.B` });
    // Bit 0 takes the external carry-in; every other bit takes the one below it.
    // The full-adder block's carry-in port is `C` (see the note in compose.ts).
    connections.push({
      from: i === 0 ? "in:Cin" : `FA${i - 1}.Co`,
      to: `${id}.C`,
    });
  }

  // Outputs, MSB first: the final carry, then each sum bit.
  const outputs: { label: string; from: Source }[] = [
    { label: "Cout", from: `FA${bits - 1}.Co` },
  ];
  for (let i = bits - 1; i >= 0; i--) outputs.push({ label: `S${i}`, from: `FA${i}.S` });

  return {
    id: `adder${bits}`,
    name: `${bits}-bit ripple adder`,
    description: `${bits} full adders, carry rippling from bit 0 to bit ${bits - 1}.`,
    note:
      bits >= 8
        ? `${bits} full adders in a chain. Its truth table has 2^${2 * bits + 1} rows — which is exactly why nobody minimizes an adder, they build it from blocks. Watch the carry ripple: the top sum bit cannot settle until the carry has walked all the way up from bit 0.`
        : `Each bit is a full adder; the carry-out of one is the carry-in of the next. This is how every adder in every CPU is built.`,
    inputs,
    instances,
    connections,
    outputs,
  };
}

export const COMPOSITES: readonly CompositeSpec[] = [
  {
    id: "fa-from-ha",
    name: "Full adder from half adders",
    description: "Two half adders and an OR gate.",
    note: "A half adder gives sum and carry of two bits. Feed the first sum into a second half adder along with the carry-in, and OR the two carries — that is a full adder. The classic decomposition, wired up so you can trace it.",
    inputs: ["A", "B", "Cin"],
    instances: [
      { id: "HA1", block: "ha" },
      { id: "HA2", block: "ha" },
      { id: "OR1", block: "or2" },
    ],
    connections: [
      { from: "in:A", to: "HA1.A" },
      { from: "in:B", to: "HA1.B" },
      { from: "HA1.S", to: "HA2.A" },
      { from: "in:Cin", to: "HA2.B" },
      { from: "HA1.C", to: "OR1.A" },
      { from: "HA2.C", to: "OR1.B" },
    ],
    outputs: [
      { label: "Cout", from: "OR1.Y" },
      { label: "S", from: "HA2.S" },
    ],
  },
  {
    id: "mux4-from-mux2",
    name: "4:1 mux from 2:1 muxes",
    description: "Three 2:1 multiplexers in a tree.",
    note: "Two muxes pick between the low pair and the high pair using S0; a third picks between those two results using S1. Every wide multiplexer is a tree of narrow ones.",
    inputs: ["S1", "S0", "D0", "D1", "D2", "D3"],
    instances: [
      { id: "MA", block: "mux2" },
      { id: "MB", block: "mux2" },
      { id: "MO", block: "mux2" },
    ],
    connections: [
      { from: "in:S0", to: "MA.S" },
      { from: "in:D0", to: "MA.A" },
      { from: "in:D1", to: "MA.B" },
      { from: "in:S0", to: "MB.S" },
      { from: "in:D2", to: "MB.A" },
      { from: "in:D3", to: "MB.B" },
      { from: "in:S1", to: "MO.S" },
      { from: "MA.Y", to: "MO.A" },
      { from: "MB.Y", to: "MO.B" },
    ],
    outputs: [{ label: "Y", from: "MO.Y" }],
  },
  {
    id: "mux8-from-mux4",
    name: "8:1 mux from 4:1 muxes",
    description: "Two 4:1 muxes and a 2:1 mux.",
    note: "The low 4:1 mux handles D0–D3 and the high one handles D4–D7, both addressed by S1,S0. A final 2:1 mux picks between them with S2. The same tree idea, one level up.",
    inputs: ["S2", "S1", "S0", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"],
    instances: [
      { id: "M0", block: "mux4" },
      { id: "M1", block: "mux4" },
      { id: "MF", block: "mux2" },
    ],
    connections: [
      { from: "in:S1", to: "M0.S1" },
      { from: "in:S0", to: "M0.S0" },
      { from: "in:D0", to: "M0.D0" },
      { from: "in:D1", to: "M0.D1" },
      { from: "in:D2", to: "M0.D2" },
      { from: "in:D3", to: "M0.D3" },
      { from: "in:S1", to: "M1.S1" },
      { from: "in:S0", to: "M1.S0" },
      { from: "in:D4", to: "M1.D0" },
      { from: "in:D5", to: "M1.D1" },
      { from: "in:D6", to: "M1.D2" },
      { from: "in:D7", to: "M1.D3" },
      { from: "in:S2", to: "MF.S" },
      { from: "M0.Y", to: "MF.A" },
      { from: "M1.Y", to: "MF.B" },
    ],
    outputs: [{ label: "Y", from: "MF.Y" }],
  },
  rippleAdder(2),
  rippleAdder(4),
  rippleAdder(8),
  rippleAdder(16),
] as const;

export const getComposite = (id: string): CompositeSpec | undefined =>
  COMPOSITES.find((c) => c.id === id);
