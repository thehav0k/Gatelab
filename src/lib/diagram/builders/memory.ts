import * as C from "../catalog";
import type { Diagram } from "../types";
import { Sketch, at, article } from "./kit";

/**
 * Memory sizing and memory expansion.
 *
 * Q31 to Q35 are, all five of them, ONE piece of arithmetic asked five ways:
 * how many address lines, how many chips, how wide is the decoder. So it is
 * computed once, here, and the calculator, the connection diagram and the
 * written answer all read the same object. Nothing in this file is a number
 * somebody typed twice.
 */

export interface MemorySize {
  readonly words: number;
  readonly bits: number;
  /** log2(words) — every address line doubles the number of reachable words. */
  readonly addressLines: number;
  readonly dataInputs: number;
  readonly dataOutputs: number;
  readonly totalBits: number;
  readonly totalBytes: number;
}

export function memorySizing(words: number, bits: number): MemorySize {
  const addressLines = Math.ceil(Math.log2(Math.max(1, words)));
  return {
    words,
    bits,
    addressLines,
    // A memory with a bidirectional bus has `bits` pins doing both jobs; with
    // separate buses it has `bits` of each. The question asks for the counts, and
    // both are `bits` either way.
    dataInputs: bits,
    dataOutputs: bits,
    totalBits: words * bits,
    totalBytes: Math.ceil((words * bits) / 8),
  };
}

export interface ExpansionPlan {
  readonly target: MemorySize;
  readonly chip: MemorySize;
  /** Chips side by side to widen the word. */
  readonly wide: number;
  /** Banks stacked to deepen the address space. */
  readonly deep: number;
  readonly chips: number;
  /** Address lines every chip sees, wired in parallel. */
  readonly sharedAddressLines: number;
  /** High address lines that must be decoded into chip selects. */
  readonly decodedAddressLines: number;
  /** `null` when one bank is enough and no decoder is needed. */
  readonly decoder: { readonly inputs: number; readonly outputs: number } | null;
  readonly feasible: boolean;
  readonly problems: readonly string[];
}

/**
 * How to build `target` out of `chip`s.
 *
 * The two directions are genuinely different operations and conflating them is
 * the mistake the question is hunting for:
 *
 *   WIDENING (more bits per word) — put chips side by side, wire ALL their
 *   address lines and ALL their chip selects in parallel. They are one memory
 *   with a wider word; every one of them responds to every access.
 *
 *   DEEPENING (more words) — stack banks, wire their address lines in parallel
 *   too, but decode the HIGH address lines into one chip select per bank so that
 *   exactly one bank drives the data bus at a time. Two banks enabled at once is
 *   a bus fight, not a bigger memory.
 */
export function planExpansion(
  targetWords: number,
  targetBits: number,
  chipWords: number,
  chipBits: number,
): ExpansionPlan {
  const target = memorySizing(targetWords, targetBits);
  const chip = memorySizing(chipWords, chipBits);
  const problems: string[] = [];

  const wide = Math.ceil(targetBits / chipBits);
  const deep = Math.ceil(targetWords / chipWords);

  if (targetBits % chipBits !== 0) {
    problems.push(
      `${targetBits} bits per word is not a whole number of ${chipBits}-bit chips — ${wide} chips give ${wide * chipBits} bits, so ${wide * chipBits - targetBits} are wasted.`,
    );
  }
  if (targetWords % chipWords !== 0) {
    problems.push(
      `${targetWords} words is not a whole number of ${chipWords}-word chips — ${deep} banks give ${deep * chipWords} words.`,
    );
  }

  const decodedAddressLines = Math.ceil(Math.log2(Math.max(1, deep)));
  return {
    target,
    chip,
    wide,
    deep,
    chips: wide * deep,
    sharedAddressLines: chip.addressLines,
    decodedAddressLines,
    decoder:
      decodedAddressLines > 0
        ? { inputs: decodedAddressLines, outputs: 1 << decodedAddressLines }
        : null,
    feasible: problems.length === 0,
    problems,
  };
}

export interface ExpansionDiagramOptions {
  readonly targetWords: number;
  readonly targetBits: number;
  readonly chipWords: number;
  readonly chipBits: number;
  readonly kind?: "ram" | "rom";
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}

/** The connection diagram for Q34 and Q35, at whatever sizes you give it. */
export function memoryExpansionDiagram(opts: ExpansionDiagramOptions): Diagram {
  const s = new Sketch();
  const plan = planExpansion(
    opts.targetWords,
    opts.targetBits,
    opts.chipWords,
    opts.chipBits,
  );
  const rom = (opts.kind ?? "ram") === "rom";
  const low = plan.sharedAddressLines;
  const high = plan.decodedAddressLines;
  const totalAddr = plan.target.addressLines;

  const addrLow = s.add(
    C.input("ALOW", low > 1 ? `A${low - 1}..A0` : "A0"),
  );
  const addrHigh =
    high > 0
      ? s.add(
          C.input(
            "AHIGH",
            high > 1 ? `A${totalAddr - 1}..A${low}` : `A${totalAddr - 1}`,
          ),
        )
      : null;

  const dec =
    high > 0
      ? s.add(
          C.decoder("DEC", high, {
            title: `${high}-to-${1 << high}`,
            subtitle: "bank select",
          }),
        )
      : null;
  if (dec && addrHigh) {
    // One link per decoded line, all from the same bus tag — which is what the
    // junction dot on that tag then tells the reader.
    for (let i = high - 1; i >= 0; i--) s.wire(at(addrHigh, "Y"), at(dec, `A${i}`));
  }

  const dataIn = rom ? null : s.add(C.input("DIN", `D${opts.targetBits - 1}..D0`));
  const we = rom ? null : s.add(C.input("WE", "WE"));

  for (let bank = 0; bank < plan.deep; bank++) {
    for (let slice = 0; slice < plan.wide; slice++) {
      const hiBit = (slice + 1) * opts.chipBits - 1;
      const loBit = slice * opts.chipBits;
      const chip = s.add({
        ...C.memory(`U${bank}_${slice}`, opts.chipWords, opts.chipBits, {
          ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
          bussed: true,
          chipSelectActiveLow: true,
          title: `${C.formatWords(opts.chipWords)} × ${opts.chipBits}`,
        }),
        subtitle: `bank ${bank}, bits ${hiBit}–${loBit}`,
        row: bank * plan.wide + slice,
      });

      s.wire(at(addrLow, "Y"), at(chip, "A"), { width: low });
      if (dec) s.wire(at(dec, `Y${bank}`), at(chip, "CS"));
      else {
        const en = s.add(C.constant(`en${slice}`, 0));
        s.wire(at(en, "Y"), at(chip, "CS"));
      }
      if (dataIn) s.wire(at(dataIn, "Y"), at(chip, "D"), { width: opts.chipBits });
      if (we) s.wire(at(we, "Y"), at(chip, "WE"));

      const busId = `DOUT${slice}`;
      if (!s.has(busId)) {
        s.add(C.output(busId, `D${hiBit}..D${loBit}`));
      }
      s.wire(at(chip, "Q"), at(busId, "A"), { width: opts.chipBits });
    }
  }

  // --- the arithmetic, spelled out ---
  s.note(
    `${C.formatWords(opts.targetWords)} × ${opts.targetBits} from ${C.formatWords(opts.chipWords)} × ${opts.chipBits} chips: ${plan.wide} wide × ${plan.deep} deep = ${plan.chips} chips.`,
  );
  s.note(
    `${totalAddr} address lines reach ${C.formatWords(opts.targetWords)} words. The low ${low} (A${low - 1}..A0) go to EVERY chip in parallel — each chip has exactly that many address pins.`,
  );
  if (high > 0) {
    s.note(
      `The high ${high} (A${totalAddr - 1}..A${low}) go to ${article(high)} ${high}-to-${1 << high} decoder whose outputs are the chip selects. Exactly one bank is enabled at a time; two at once would be a bus conflict, not more memory.`,
    );
  } else {
    s.note("One bank is enough, so there is nothing to decode — chip select is tied active.");
  }
  if (plan.wide > 1) {
    s.note(
      `The ${plan.wide} chips within a bank share address AND chip select. They are one memory whose word is ${opts.targetBits} bits wide, each supplying bits ${opts.chipBits - 1}..0 of its own slice.`,
    );
  }
  for (const problem of plan.problems) s.note(`⚠ ${problem}`);

  return s.done({
    id:
      opts.id ??
      `mem${opts.targetWords}x${opts.targetBits}from${opts.chipWords}x${opts.chipBits}`,
    title:
      opts.title ??
      `${C.formatWords(opts.targetWords)} × ${opts.targetBits} ${rom ? "ROM" : "memory"} from ${C.formatWords(opts.chipWords)} × ${opts.chipBits} chips`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

/** The sentences that answer Q31–Q33, generated from the sizing. */
export function describeSizing(size: MemorySize): string[] {
  return [
    `${C.formatWords(size.words)} × ${size.bits} stores ${size.words.toLocaleString("en-US")} words of ${size.bits} bits each.`,
    `${size.addressLines} address lines are required: 2^${size.addressLines} = ${(2 ** size.addressLines).toLocaleString("en-US")} distinct addresses.`,
    `${size.dataInputs} data inputs and ${size.dataOutputs} data outputs — one of each per bit of the word.`,
    `Total capacity ${size.totalBits.toLocaleString("en-US")} bits = ${size.totalBytes.toLocaleString("en-US")} bytes.`,
  ];
}

/** The sentences that answer Q33 and its "specify the size of the decoder" part. */
export function describePlan(plan: ExpansionPlan): string[] {
  const lines = [
    `${plan.chips} chips: ${plan.wide} in parallel to widen the word to ${plan.target.bits} bits, ${plan.deep} banks to deepen it to ${C.formatWords(plan.target.words)} words.`,
    `${plan.target.addressLines} address lines in total.`,
    `${plan.sharedAddressLines} of them (A${plan.sharedAddressLines - 1}..A0) connect to the address inputs of ALL ${plan.chips} chips.`,
  ];
  if (plan.decoder) {
    lines.push(
      `${plan.decodedAddressLines} lines must be decoded for the chip selects — ${article(plan.decoder.inputs)} ${plan.decoder.inputs}-to-${plan.decoder.outputs} decoder.`,
    );
  } else {
    lines.push("No decoding is needed: a single bank covers the whole address space.");
  }
  return lines;
}
