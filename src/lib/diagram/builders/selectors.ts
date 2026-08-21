import * as C from "../catalog";
import type { Diagram, Endpoint } from "../types";
import { Sketch, at, article } from "./kit";

/**
 * Decoders, demultiplexers, encoders — and, above all, TREES of them.
 *
 * "Build a 1-to-16 demultiplexer out of 2-to-4 decoders" is not a question about
 * demultiplexers. It is a question about whether you understand what ENABLE
 * does: a decoder with its enable low outputs nothing, so a first-stage decoder
 * can hand its one active output to a second stage as that stage's permission to
 * speak. Every hierarchical selector in digital design is that trick, and the
 * builders here generate it for any width rather than hard-coding the 16.
 */

const PIN = "ABCDEFGHIJKLMNOP";

export interface DemuxTreeOptions {
  readonly selectBits: number;
  /** Select bits handled per stage — 2 means "built from 2-to-4 decoders". */
  readonly stageBits: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
  /** Draw it as a demultiplexer (a data input) rather than a plain decoder. */
  readonly data?: boolean;
}

/**
 * A 1-to-2^n demultiplexer (or a 2^n-output decoder) built from small decoders.
 *
 * The wiring rule, and it is the whole answer:
 *   - The FIRST stage decodes the HIGH select bits. Its outputs are not data —
 *     they are the enables of the second stage.
 *   - Every SECOND-stage decoder sees the same LOW select bits.
 *   - Exactly one second-stage decoder is enabled at a time, and it raises
 *     exactly one of its own outputs. One out of 2^n, which is what was asked.
 *   - The data line goes to the FIRST stage's enable, so it gates everything
 *     downstream through a single pin.
 */
export function demuxTreeDiagram(opts: DemuxTreeOptions): Diagram {
  const s = new Sketch();
  const total = opts.selectBits;
  const stage = Math.min(opts.stageBits, total);
  const highBits = total - stage;
  const highCount = 1 << highBits;
  const lowCount = 1 << stage;
  const isDemux = opts.data !== false;

  const selTag = new Map<number, Endpoint>();
  for (let i = total - 1; i >= 0; i--) {
    const id = s.add(C.input(`S${i}`, `S${i}`));
    selTag.set(i, at(id, "Y"));
  }

  if (highBits === 0) {
    // One stage is enough — no tree to build, and saying so is better than
    // drawing a "tree" with a single node in it.
    const only = s.add(
      C.decoder("D0", stage, { enable: true, ...(isDemux ? { dataInput: "D" } : {}) }),
    );
    for (let i = 0; i < stage; i++) {
      s.wire(selTag.get(i) as Endpoint, at(only, `A${i}`));
    }
    return finishDemux(s, only, lowCount, isDemux, opts);
  }

  const first = s.add(
    C.decoder("DEC0", highBits, {
      enable: true,
      title: `${highBits}-to-${highCount}`,
      subtitle: "stage 1 — selects which decoder",
    }),
  );
  for (let i = 0; i < highBits; i++) {
    // The high select bits: S(total-1) is the MSB and drives A(highBits-1).
    s.wire(selTag.get(total - 1 - i) as Endpoint, at(first, `A${highBits - 1 - i}`));
  }

  if (isDemux) {
    const data = s.add(C.input("DIN", "D (serial in)"));
    s.wire(at(data, "Y"), at(first, "E"));
  } else {
    const en = s.add(C.constant("en", 1));
    s.wire(at(en, "Y"), at(first, "E"));
  }

  for (let g = 0; g < highCount; g++) {
    // `row` pins the vertical order: decoder g must sit above decoder g+1, or
    // the outputs come out shuffled and the picture stops being an answer.
    const dec = s.add({
      ...C.decoder(`DEC${g + 1}`, stage, {
        enable: true,
        title: `${stage}-to-${lowCount}`,
        subtitle: `outputs Y${g * lowCount}–Y${g * lowCount + lowCount - 1}`,
      }),
      row: g,
    });
    s.wire(at(first, `Y${g}`), at(dec, "E"));
    for (let i = 0; i < stage; i++) {
      s.wire(selTag.get(stage - 1 - i) as Endpoint, at(dec, `A${stage - 1 - i}`));
    }
    for (let k = 0; k < lowCount; k++) {
      const idx = g * lowCount + k;
      const out = s.add(C.output(`Y${idx}`, `Y${idx}`));
      s.wire(at(dec, `Y${k}`), at(out, "A"));
    }
  }

  s.note(
    `Stage 1 decodes the high select bits S${total - 1}..S${stage}; its ${highCount} outputs are the ENABLES of the ${highCount} second-stage decoders.`,
  );
  s.note(
    `All ${highCount} second-stage decoders share the low select bits S${stage - 1}..S0 — only the enabled one responds.`,
  );
  if (isDemux) {
    s.note(
      "The data line drives the first stage's enable, so it passes down the enable chain and appears on exactly one of the 16 outputs.",
    );
  }
  s.note(
    `Total: ${highCount + 1} decoders. Without the enable pin this construction is impossible — you would need external AND gates on every one of the ${1 << total} outputs.`,
  );

  return s.done({
    id: opts.id ?? `demuxtree${total}`,
    title:
      opts.title ??
      `1-to-${1 << total} ${isDemux ? "demultiplexer" : "decoder"} from ${stage}-to-${lowCount} decoders`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

function finishDemux(
  s: Sketch,
  dec: string,
  outputs: number,
  isDemux: boolean,
  opts: DemuxTreeOptions,
): Diagram {
  if (isDemux) {
    const data = s.add(C.input("DIN", "D"));
    s.wire(at(data, "Y"), at(dec, "E"));
  } else {
    const en = s.add(C.constant("en", 1));
    s.wire(at(en, "Y"), at(dec, "E"));
  }
  for (let k = 0; k < outputs; k++) {
    const out = s.add(C.output(`Y${k}`, `Y${k}`));
    s.wire(at(dec, `Y${k}`), at(out, "A"));
  }
  s.note(`One stage covers all ${outputs} outputs; no tree is needed at this width.`);
  return s.done({
    id: opts.id ?? "demux",
    title: opts.title ?? `1-to-${outputs} demultiplexer`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- mux trees --------------------------------------------------------------

/**
 * A 2^n-to-1 multiplexer from 2^k-to-1 multiplexers. (Q43's "using only 2-to-1
 * multiplexers" is this with k = 1.)
 *
 * The dual of the decoder tree, and the roles swap: here the LOW select bits go
 * to the first stage, because each first-stage mux narrows one group of inputs,
 * and the final stage picks between the groups using the HIGH bits.
 */
export function muxTreeDiagram(opts: {
  readonly selectBits: number;
  readonly stageBits: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const total = opts.selectBits;
  const stage = Math.min(opts.stageBits, total);
  const inputs = 1 << total;
  const groupSize = 1 << stage;
  const groups = inputs / groupSize;

  const selTag = new Map<number, Endpoint>();
  for (let i = total - 1; i >= 0; i--) {
    const id = s.add(C.input(`S${i}`, `S${i}`));
    selTag.set(i, at(id, "Y"));
  }

  let level: Endpoint[] = [];
  for (let g = 0; g < groups; g++) {
    const mx = s.add(
      C.mux(`M0_${g}`, stage, { title: `MUX ${groupSize}:1`, subtitle: `I${g * groupSize}–I${g * groupSize + groupSize - 1}` }),
    );
    for (let k = 0; k < groupSize; k++) {
      const idx = g * groupSize + k;
      const tag = s.add(C.input(`I${idx}`, `I${idx}`));
      s.wire(at(tag, "Y"), at(mx, `D${k}`));
    }
    for (let i = 0; i < stage; i++) s.wire(selTag.get(i) as Endpoint, at(mx, `S${i}`));
    level.push(at(mx, "Y"));
  }

  let usedBits = stage;
  let depth = 1;
  while (level.length > 1) {
    const remaining = total - usedBits;
    const thisStage = Math.min(stage, remaining);
    const fan = 1 << thisStage;
    const next: Endpoint[] = [];
    for (let g = 0; g * fan < level.length; g++) {
      const mx = s.add(C.mux(`M${depth}_${g}`, thisStage, { title: `MUX ${fan}:1` }));
      for (let k = 0; k < fan; k++) {
        const src = level[g * fan + k];
        if (src) s.wire(src, at(mx, `D${k}`));
      }
      for (let i = 0; i < thisStage; i++) {
        s.wire(selTag.get(usedBits + i) as Endpoint, at(mx, `S${i}`));
      }
      next.push(at(mx, "Y"));
    }
    level = next;
    usedBits += thisStage;
    depth += 1;
  }

  const out = s.add(C.output("OUT", "Y"));
  if (level[0]) s.wire(level[0], at(out, "A"));

  s.note(
    `The low select bits S${stage - 1}..S0 go to EVERY first-stage mux; each narrows its own group of ${groupSize} inputs to one.`,
  );
  s.note(
    "The later stages pick between those results using the high select bits. Note this is the opposite of the decoder tree, where the HIGH bits are decoded first.",
  );
  s.note(`Total: ${groups + Math.max(0, depth - 1)} multiplexers, ${depth} levels deep.`);

  return s.done({
    id: opts.id ?? `muxtree${total}`,
    title: opts.title ?? `${inputs}-to-1 multiplexer from ${groupSize}-to-1 multiplexers`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- ones counter -----------------------------------------------------------

/**
 * Count the 1s in an n-bit word, using a decoder, OR gates and an encoder. (Q41.)
 *
 * The chain of reasoning the drawing has to make visible:
 *   1. The decoder turns the input into one active minterm line.
 *   2. Minterms with the same POPULATION COUNT are the same answer, so they are
 *      ORed together — that is what the OR gates are for, and it is why there are
 *      exactly as many of them as there are non-trivial counts.
 *   3. The encoder turns "which count line is active" back into a binary number.
 *
 * For 3 bits that is a 3-to-8 decoder, two OR gates (counts 1 and 2 have three
 * minterms each; counts 0 and 3 have one and need no gate) and a 4-to-2 encoder
 * — which is exactly the parts list the question hands you.
 */
export function onesCounterDiagram(opts: {
  readonly bits: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const bits = opts.bits;
  const rows = 1 << bits;
  const counts = bits + 1;
  const encoderBits = Math.ceil(Math.log2(counts));

  const dec = s.add(
    C.decoder("DEC", bits, { title: `${bits}-to-${rows}`, subtitle: "decoder" }),
  );
  for (let i = 0; i < bits; i++) {
    const v = String.fromCharCode(65 + i);
    const tag = s.add(C.input(`in_${v}`, v));
    s.wire(at(tag, "Y"), at(dec, `A${bits - 1 - i}`));
  }

  const enc = s.add(
    C.encoder("ENC", encoderBits, {
      title: `${1 << encoderBits}-to-${encoderBits}`,
      inputPrefix: "D",
      outputPrefix: "Z",
    }),
  );

  const popcount = (v: number): number => {
    let c = 0;
    for (let i = 0; i < bits; i++) c += (v >>> i) & 1;
    return c;
  };

  let orGates = 0;
  for (let k = 0; k < counts; k++) {
    const members: number[] = [];
    for (let m = 0; m < rows; m++) if (popcount(m) === k) members.push(m);

    if (members.length === 1) {
      s.wire(at(dec, `Y${members[0]}`), at(enc, `D${k}`));
    } else {
      const g = s.add(C.gate(`or${k}`, "or", members.length, `count = ${k}`));
      orGates += 1;
      members.forEach((m, i) => {
        const pin = PIN[i];
        if (pin) s.wire(at(dec, `Y${m}`), at(g, pin));
      });
      s.wire(at(g, "Y"), at(enc, `D${k}`));
    }
  }
  // An encoder wider than the number of counts has inputs left over. Tie them
  // low rather than leaving them floating — a floating TTL input reads HIGH.
  for (let k = counts; k < 1 << encoderBits; k++) {
    const z = s.add(C.constant(`tie${k}`, 0));
    s.wire(at(z, "Y"), at(enc, `D${k}`));
  }

  for (let i = encoderBits - 1; i >= 0; i--) {
    const out = s.add(C.output(`Z${i}`, `Z${i}`));
    s.wire(at(enc, `Z${i}`), at(out, "A"));
  }

  s.note("The decoder raises exactly one line — the minterm of the input word.");
  s.note(
    `Minterms with the same number of 1s mean the same answer, so they are ORed together. Counts 0 and ${bits} have a single minterm each and need no gate, which is why there are ${orGates} OR gates and not ${counts}.`,
  );
  s.note(
    `The encoder converts "which count line is high" back to ${article(encoderBits)} ${encoderBits}-bit number Z${encoderBits - 1}..Z0.`,
  );
  if ((1 << encoderBits) > counts) {
    s.note(
      `The encoder has ${1 << encoderBits} inputs but only ${counts} counts exist, so D${counts}..D${(1 << encoderBits) - 1} are tied to GND. Leaving them open would float HIGH on TTL and corrupt the output.`,
    );
  }

  return s.done({
    id: opts.id ?? `ones${bits}`,
    title: opts.title ?? `Count the 1s in ${article(bits)} ${bits}-bit word`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}

// --- priority encoder -------------------------------------------------------

/**
 * A 2^n-to-n priority encoder, and the standard encoder it fixes. (Q11, Q16.)
 *
 * Drawn as gates on purpose. The point of the question is WHY a plain encoder
 * fails when two inputs are active — it ORs the two codes together and produces
 * a third, unrelated number — and the fix is visible only in the gates: each
 * input is masked by the complement of every higher-priority input.
 */
export function priorityEncoderDiagram(opts: {
  readonly bits: number;
  readonly id?: string;
  readonly title?: string;
  readonly caption?: string;
}): Diagram {
  const s = new Sketch();
  const outBits = opts.bits;
  const ins = 1 << outBits;

  const tag = new Map<number, Endpoint>();
  for (let i = ins - 1; i >= 0; i--) {
    const id = s.add(C.input(`D${i}`, `D${i}`));
    tag.set(i, at(id, "Y"));
  }

  // "This input wins" = it is 1 and every higher-numbered input is 0.
  const wins = new Map<number, Endpoint>();
  for (let i = ins - 1; i >= 0; i--) {
    const higher: Endpoint[] = [];
    for (let j = i + 1; j < ins; j++) {
      const inv = `inv${j}`;
      if (!s.has(inv)) {
        s.add(C.gate(inv, "not", 1, `D${j}'`));
        s.wire(tag.get(j) as Endpoint, at(inv, "A"));
      }
      higher.push(at(inv, "Y"));
    }
    if (higher.length === 0) {
      wins.set(i, tag.get(i) as Endpoint);
      continue;
    }
    const g = s.add(C.gate(`w${i}`, "and", higher.length + 1, `D${i} wins`));
    s.wire(tag.get(i) as Endpoint, at(g, "A"));
    higher.forEach((h, k) => {
      const pin = PIN[k + 1];
      if (pin) s.wire(h, at(g, pin));
    });
    wins.set(i, at(g, "Y"));
  }

  for (let b = outBits - 1; b >= 0; b--) {
    const members: number[] = [];
    for (let i = 0; i < ins; i++) if ((i >>> b) & 1) members.push(i);
    const g = s.add(C.gate(`y${b}`, "or", members.length, `Y${b}`));
    members.forEach((i, k) => {
      const pin = PIN[k];
      if (pin) s.wire(wins.get(i) as Endpoint, at(g, pin));
    });
    const out = s.add(C.output(`Y${b}`, `Y${b}`));
    s.wire(at(g, "Y"), at(out, "A"));
  }

  const valid = s.add(C.gate("V", "or", ins, "V (any input active)"));
  for (let i = 0; i < ins; i++) {
    const pin = PIN[i];
    if (pin) s.wire(tag.get(i) as Endpoint, at(valid, pin));
  }
  const vOut = s.add(C.output("VOUT", "V"));
  s.wire(at(valid, "Y"), at(vOut, "A"));

  s.note(
    "Each input is ANDed with the complement of every HIGHER input, so only the highest active one reaches the output gates.",
  );
  s.note(
    "That masking is the whole difference from a plain encoder — which simply ORs the codes and, given two active inputs, returns the bitwise OR of two valid codes: a third code that means neither of them.",
  );
  s.note(
    "V distinguishes 'no input active' from 'input 0 active' — both of which a plain encoder reports as the code 0.",
  );

  return s.done({
    id: opts.id ?? `prienc${outBits}`,
    title: opts.title ?? `${ins}-to-${outBits} priority encoder`,
    ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  });
}
