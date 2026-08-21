import { parse, truthVector } from "@/lib/core-engine";
import type { Strategy } from "@/lib/simulation/synth";
import {
  adderBlockDiagram,
  equalityComparatorDiagram,
  rippleAdderDiagram,
  scaleDiagram,
  twosComplementDiagram,
} from "../builders/arithmetic";
import { article, bitwiseSpecs, mintermsWhere, type FunctionSpec } from "../builders/kit";
import {
  decoderImplementation,
  gateLevelDiagram,
  muxImplementation,
  muxResidues,
  muxTreeForFunction,
  readMux,
} from "../builders/logic";
import {
  memoryExpansionDiagram,
  planExpansion,
  describePlan,
} from "../builders/memory";
import { demuxTreeDiagram, onesCounterDiagram } from "../builders/selectors";
import {
  excitationSummary,
  modNCounterDiagram,
  rippleCounterDiagram,
  sequentialDesignDiagram,
  serialToParallelDiagram,
  stateTable,
  steppedCounterDiagram,
  syncCounterDiagram,
  type SequentialSpec,
} from "../builders/sequential";
import {
  minimalExpressions,
  num,
  sigmaOf,
  str,
  truthTable,
  variablesFor,
  type Problem,
  type SolutionTable,
} from "./types";

/**
 * The questions that want a picture.
 *
 * Each one is parameterised down to the thing it is actually about. Q12 is not
 * "1-to-16 from 2-to-4"; it is "a demultiplexer tree", and the 16 and the 4 are
 * arguments. That is what makes the tool answer next year's paper as well as
 * this one, and it is also the honest way to write the code: the reason the
 * answer is what it is has to be in the construction, not in a constant.
 */

const list = (text: string): number[] =>
  text
    .split(/[\s,;]+/)
    .map((t) => Number.parseInt(t, 10))
    .filter((v) => Number.isFinite(v) && v >= 0);

/**
 * Variable names, normalised to upper case.
 *
 * The engine's lexer upper-cases every identifier (see `core-engine/lexer.ts`),
 * so a user who types `x'y + z` gets an AST over X, Y and Z. Handing that AST a
 * variable list of `["x","y","z"]` throws — and the failure is at parse time,
 * far from the input box that caused it. Normalise once, here, at the boundary.
 */
const names = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => t.toUpperCase());

const STRATEGY_CHOICES = [
  { value: "mixed", label: "Any gate (fewest gates)" },
  { value: "nand-only", label: "NAND only" },
  { value: "nor-only", label: "NOR only" },
];

const strategyOf = (v: string): Strategy =>
  v === "nand-only" ? "nand-only" : v === "nor-only" ? "nor-only" : "mixed";

const strategyNote = (v: string): string =>
  v === "nand-only"
    ? "Every gate has been rewritten into NAND by De Morgan: AND is a NAND followed by an inverter, OR is a NAND of the complemented inputs, and an inverter is a NAND with its inputs tied together — which is why a NAND-only design usually needs no separate 7404 at all."
    : v === "nor-only"
      ? "Every gate has been rewritten into NOR — the exact dual of the NAND construction."
      : "Gates are chosen freely, so this uses the fewest gates; it is not necessarily the fewest CHIPS, because you cannot buy half a package.";

// ---------------------------------------------------------------------------

export const CIRCUIT_PROBLEMS: readonly Problem[] = [
  // --- Q5 ------------------------------------------------------------------
  {
    id: "q5",
    number: "5",
    title: "High when P = 0, or when Q = R = 1",
    prompt:
      "Design a logic circuit with inputs P, Q, R so that the output is high whenever P is 0 or whenever Q = R = 1. Use NAND gates only.",
    category: "circuit",
    tags: ["NAND only", "universal gate", "De Morgan", "SOP"],
    params: [
      {
        key: "rule",
        label: "Gate rule",
        kind: "choice",
        choices: STRATEGY_CHOICES,
        initial: "nand-only",
      },
    ],
    solve: (v) => {
      const rule = str(v, "rule", "nand-only");
      // P is the MSB. "P = 0" is rows 0-3; "Q = R = 1" adds row 7 (row 3 is
      // already in). Reading the sentence straight into a row set is the whole
      // first step, and it is where the marks are lost.
      const spec: FunctionSpec = {
        name: "F",
        variables: ["P", "Q", "R"],
        minterms: mintermsWhere(3, (m) => {
          const P = (m >>> 2) & 1;
          const Q = (m >>> 1) & 1;
          const R = m & 1;
          return P === 0 || (Q === 1 && R === 1);
        }),
      };
      const diagram = gateLevelDiagram([spec], {
        id: "q5",
        title: "F = P' + QR",
        strategy: strategyOf(rule),
        caption:
          "Inputs on the left, output on the right; each column is one more gate delay.",
      });
      // Counted off the drawing rather than written into the prose. A sentence
      // claiming three gates beside a picture of six is the kind of thing this
      // codebase treats as a bug, not a typo.
      const gates = diagram.blocks.filter((b) => b.kind === "gate").length;

      return {
        diagrams: [diagram],
        tables: [truthTable([spec], { title: "Truth table", decimal: true })],
        expressions: [sigmaOf(spec), ...minimalExpressions([spec])],
        steps: [
          "Read the sentence as rows, not as algebra. “P is 0” is every row with P = 0 — rows 0 to 3. “Q = R = 1” is rows 3 and 7. The union is Σm(0, 1, 2, 3, 7).",
          "Minimising gives F = P' + QR. Notice it is already obvious from the sentence: the word “or” in the question IS the OR in the expression.",
          strategyNote(rule),
          rule === "nand-only"
            ? `In NAND form: F = P' + QR = (P · (QR)')' = NAND(P, NAND(Q, R)). Two gates, and both fit in one 7400 with two slots to spare — note that P is used DIRECTLY, with no inverter, because the outer NAND supplies the complement itself.`
            : `${gates} gate${gates === 1 ? "" : "s"} as drawn.`,
        ],
      };
    },
  },

  // --- Q6 ------------------------------------------------------------------
  {
    id: "q6",
    number: "6",
    title: "Divisible by 3 or 5",
    prompt:
      "Design a logic circuit with four inputs A, B, C, D where the output Y = 1 when the binary number ABCD is divisible by 3 or by 5.",
    category: "circuit",
    tags: ["SOP", "K-map", "number predicate"],
    params: [
      { key: "bits", label: "Input width (bits)", kind: "int", min: 2, max: 6, initial: 4 },
      { key: "p", label: "First divisor", kind: "int", min: 2, max: 15, initial: 3 },
      { key: "q", label: "Second divisor", kind: "int", min: 2, max: 15, initial: 5 },
      {
        key: "zero",
        label: "Treat 0 as divisible",
        kind: "choice",
        choices: [
          { value: "no", label: "No — start from 1 (usual convention)" },
          { value: "yes", label: "Yes — 0 is divisible by everything" },
        ],
        initial: "no",
        hint: "Textbooks differ. It changes exactly one row, and it is worth stating your assumption.",
      },
      {
        key: "rule",
        label: "Gate rule",
        kind: "choice",
        choices: STRATEGY_CHOICES,
        initial: "mixed",
      },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 4);
      const p = num(v, "p", 3);
      const q = num(v, "q", 5);
      const includeZero = str(v, "zero", "no") === "yes";
      const rule = str(v, "rule", "mixed");
      const variables = variablesFor(bits);

      const spec: FunctionSpec = {
        name: "Y",
        variables,
        minterms: mintermsWhere(bits, (m) => {
          if (m === 0) return includeZero;
          return m % p === 0 || m % q === 0;
        }),
      };

      return {
        diagrams: [
          gateLevelDiagram([spec], {
            id: "q6",
            title: `Y = 1 when ${variables.join("")} is divisible by ${p} or ${q}`,
            strategy: strategyOf(rule),
          }),
        ],
        tables: [
          truthTable([spec], { title: "Truth table", decimal: true }),
        ],
        expressions: [sigmaOf(spec), ...minimalExpressions([spec])],
        steps: [
          `List the values 0 to ${(1 << bits) - 1} and mark the ones divisible by ${p} or by ${q}. That is the truth table — there is no algebra to do yet.`,
          includeZero
            ? "0 is counted as divisible here (0 = 0·k for every k), which adds row 0."
            : "0 is NOT counted here. It divides by everything trivially, and most textbooks start the count at 1 — but say which convention you used, because it changes row 0.",
          `The rows are ${sigmaOf(spec)}. Feed that to a K-map or to Quine–McCluskey and the minimal sum falls out.`,
          strategyNote(rule),
          "There is no arithmetic in the circuit at all. “Divisible by 3” is not a division — it is a set of eight specific rows, and once they are listed the problem is an ordinary minimisation.",
        ],
      };
    },
  },

  // --- Q7 ------------------------------------------------------------------
  {
    id: "q7",
    number: "7",
    title: "Square of a 3-bit number",
    prompt:
      "Design a logic circuit that accepts a 3-bit number and generates an output binary number equal to the square of the input.",
    category: "circuit",
    tags: ["multi-output", "SOP", "arithmetic"],
    params: [
      { key: "bits", label: "Input width (bits)", kind: "int", min: 2, max: 4, initial: 3 },
      {
        key: "rule",
        label: "Gate rule",
        kind: "choice",
        choices: STRATEGY_CHOICES,
        initial: "mixed",
      },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 3);
      const rule = str(v, "rule", "mixed");
      const variables = variablesFor(bits);
      const max = (1 << bits) - 1;
      const outBits = Math.max(1, Math.ceil(Math.log2(max * max + 1)));
      const specs = bitwiseSpecs(bits, variables, (x) => x * x, outBits, "S");

      const trivial = specs.filter((s) => s.minterms.length === 0);
      const identity = specs.filter(
        (s) => s.minterms.length === 1 && s.minterms[0] === (1 << bits) - 1,
      );

      return {
        diagrams: [
          gateLevelDiagram(specs, {
            id: "q7",
            title: `Square of ${article(bits)} ${bits}-bit number`,
            strategy: strategyOf(rule),
            caption: `${bits} inputs, ${outBits} outputs — one minimisation per output bit, sharing the input rail.`,
          }),
        ],
        tables: [
          {
            title: "Input and its square",
            columns: [...variables, "value", "square", ...specs.map((s) => s.name)],
            rows: Array.from({ length: 1 << bits }, (_, m) => [
              ...variables.map((_, i) => String((m >>> (bits - 1 - i)) & 1)),
              String(m),
              String(m * m),
              ...specs.map((s) => (s.minterms.includes(m) ? "1" : "0")),
            ]),
          },
          truthTable(specs, { title: "Truth table, one column per output bit" }),
        ],
        expressions: minimalExpressions(specs),
        steps: [
          `${bits} input bits reach ${max} at most, whose square is ${max * max} — so the output needs ${outBits} bits. Getting this count wrong is the commonest error in the question, and it costs the whole answer.`,
          "A multi-output circuit is not one problem. It is one minimisation PER OUTPUT BIT, all sharing the same inputs — and any gate that appears in two of them is built once.",
          trivial.length > 0
            ? `${trivial.map((s) => s.name).join(", ")} ${trivial.length === 1 ? "is" : "are"} identically 0 — no square of an integer ever sets ${trivial.length === 1 ? "that bit" : "those bits"}, so ${trivial.length === 1 ? "it needs" : "they need"} no gates at all. Tie ${trivial.length === 1 ? "it" : "them"} to ground.`
            : "Every output bit needs real logic here.",
          identity.length > 0
            ? `${identity.map((s) => s.name).join(", ")} is high only for the largest input, so it is just the AND of every input bit.`
            : "",
          `S0 is always equal to the input's own LSB: an odd number squares to an odd number, and an even one to an even one. That single observation removes a whole output's worth of gates.`,
        ].filter(Boolean),
      };
    },
  },

  // --- Q8 ------------------------------------------------------------------
  {
    id: "q8",
    number: "8",
    title: "2's complement of a 4-bit number",
    prompt:
      "Design a logic circuit that accepts a 4-bit number and generates its 2's complement.",
    category: "circuit",
    tags: ["complement", "adder", "XOR"],
    params: [
      { key: "bits", label: "Width (bits)", kind: "int", min: 2, max: 8, initial: 4 },
      {
        key: "style",
        label: "Method",
        kind: "choice",
        choices: [
          { value: "invert-add-one", label: "Invert, then add 1 (adder)" },
          { value: "scan", label: "Copy up to the first 1, invert the rest (XOR)" },
        ],
        initial: "invert-add-one",
      },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 4);
      const style = str(v, "style", "invert-add-one") as "invert-add-one" | "scan";
      const mask = (1 << bits) - 1;

      const table: SolutionTable = {
        title: "Input and its 2's complement",
        columns: ["A (binary)", "A (decimal)", "2's complement", "as signed"],
        rows: Array.from({ length: 1 << bits }, (_, m) => {
          const comp = (~m + 1) & mask;
          return [
            m.toString(2).padStart(bits, "0"),
            String(m),
            comp.toString(2).padStart(bits, "0"),
            String(m === 0 ? 0 : m >= 1 << (bits - 1) ? m - (1 << bits) : m),
          ];
        }),
      };

      return {
        diagrams: [
          twosComplementDiagram({ bits, style, id: "q8", title: `${bits}-bit 2's complement` }),
          twosComplementDiagram({
            bits,
            style: style === "scan" ? "invert-add-one" : "scan",
            id: "q8alt",
            title: `The other construction, for comparison`,
          }),
        ],
        tables: [table],
        steps: [
          "2's complement of A is 2^n − A, computed modulo 2^n. Both circuits below produce exactly that; they differ in speed and in parts.",
          "Invert-and-add-one is the definition made literal: NOT each bit (that is the 1's complement), then add 1. The +1 costs nothing because a parallel adder's carry-in is otherwise unused, and the carry-OUT is discarded — the 2^n is exactly what modular arithmetic throws away.",
          "The scan method is what you do by hand: copy bits from the right up to and including the first 1, invert everything above. As a circuit that is one XOR per bit plus an OR chain carrying “a 1 has been seen below here”.",
          "The scan version is faster. The adder version has to ripple a carry through all n stages; the XOR version settles in two gate delays per bit and the OR chain is the only thing that propagates.",
          `Note the fixed point: the complement of 0 is 0, and the complement of ${(1 << (bits - 1)).toString(2)} (${1 << (bits - 1)}) is itself. In ${bits}-bit signed arithmetic, −${1 << (bits - 1)} has no positive counterpart, so negating it overflows.`,
        ],
      };
    },
  },

  // --- Q10 -----------------------------------------------------------------
  {
    id: "q10",
    number: "10",
    title: "Add 1011 and 1100 — block diagram",
    prompt:
      "Design and explain the circuit to add the bits 1011 and 1100 using a block diagram.",
    category: "circuit",
    tags: ["adder", "block diagram", "carry"],
    params: [
      { key: "bits", label: "Width (bits)", kind: "int", min: 2, max: 8, initial: 4 },
      { key: "a", label: "First operand (decimal)", kind: "int", min: 0, max: 255, initial: 11 },
      { key: "b", label: "Second operand (decimal)", kind: "int", min: 0, max: 255, initial: 12 },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 4);
      const a = num(v, "a", 11) & ((1 << bits) - 1);
      const b = num(v, "b", 12) & ((1 << bits) - 1);
      const sum = a + b;

      const carries: string[] = [];
      let c = 0;
      for (let i = 0; i < bits; i++) {
        const ai = (a >>> i) & 1;
        const bi = (b >>> i) & 1;
        const s = ai ^ bi ^ c;
        const next = (ai & bi) | (c & (ai ^ bi));
        carries.push(
          `bit ${i}: ${ai} + ${bi} + carry ${c} = ${s}, carry out ${next}`,
        );
        c = next;
      }

      return {
        diagrams: [
          adderBlockDiagram({ bits, a, b, id: "q10block", title: `${bits}-bit parallel adder` }),
          rippleAdderDiagram({
            bits,
            a,
            b,
            carryIn: 0,
            id: "q10ripple",
            title: "Inside the box — the ripple-carry chain",
          }),
        ],
        tables: [
          {
            title: "The addition, bit by bit",
            columns: ["", ...Array.from({ length: bits }, (_, i) => `bit ${bits - 1 - i}`)],
            rows: [
              ["A", ...a.toString(2).padStart(bits, "0").split("")],
              ["B", ...b.toString(2).padStart(bits, "0").split("")],
              [
                "Sum",
                ...sum
                  .toString(2)
                  .padStart(bits + 1, "0")
                  .slice(1)
                  .split(""),
              ],
            ],
            note: `${a} + ${b} = ${sum}${sum > (1 << bits) - 1 ? ` — which needs ${bits + 1} bits, so C${bits} = 1` : ""}`,
          },
        ],
        answer: `${a.toString(2).padStart(bits, "0")} + ${b.toString(2).padStart(bits, "0")} = ${sum.toString(2).padStart(bits + 1, "0")}  (${a} + ${b} = ${sum})`,
        steps: [
          `At block level the answer is one box: ${article(bits)} ${bits}-bit parallel adder with A, B and a carry-in, producing ${bits} sum bits and a carry-out. That is the level of detail the question asks for.`,
          `Inside, it is ${bits} full adders in a chain. Each takes one bit of A, one bit of B, and the carry OUT of the stage below it.`,
          ...carries,
          sum > (1 << bits) - 1
            ? `The result ${sum} does not fit in ${bits} bits, so C${bits} comes out 1. In unsigned arithmetic that carry-out is the overflow flag; the ${bits}-bit sum alone would read ${sum & ((1 << bits) - 1)}.`
            : `The result fits in ${bits} bits, so C${bits} is 0 and there is no overflow.`,
          `The carry is the reason this is a chain and not ${bits} independent circuits: bit ${bits - 1} cannot settle until the carry has walked all the way up from bit 0. That accumulating delay is the whole motivation for carry-lookahead.`,
        ],
      };
    },
  },

  // --- Q12 -----------------------------------------------------------------
  {
    id: "q12",
    number: "12",
    title: "1-to-16 demultiplexer from 2-to-4 decoders",
    prompt:
      "Implement a 1-to-16 demultiplexer using only 2-to-4 decoders with enable inputs. Label all inputs, pins and outputs.",
    category: "circuit",
    tags: ["decoder", "demultiplexer", "enable", "hierarchy"],
    params: [
      { key: "select", label: "Select lines (2^n outputs)", kind: "int", min: 2, max: 5, initial: 4 },
      { key: "stage", label: "Decoder size (select bits each)", kind: "int", min: 1, max: 3, initial: 2 },
    ],
    solve: (v) => {
      const select = num(v, "select", 4);
      const stage = Math.min(num(v, "stage", 2), select);
      const outputs = 1 << select;
      const perStage = 1 << stage;
      const banks = 1 << (select - stage);

      return {
        diagrams: [
          demuxTreeDiagram({
            selectBits: select,
            stageBits: stage,
            data: true,
            id: "q12",
            title: `1-to-${outputs} demultiplexer from ${stage}-to-${perStage} decoders`,
          }),
        ],
        tables: [
          {
            title: "Which decoder handles which output",
            columns: [`S${select - 1}..S${stage}`, "enabled decoder", "its outputs"],
            rows: Array.from({ length: banks }, (_, g) => [
              g.toString(2).padStart(select - stage, "0"),
              `DEC${g + 1}`,
              `Y${g * perStage} – Y${g * perStage + perStage - 1}`,
            ]),
          },
        ],
        answer: `${banks + 1} decoders: one to select the bank, ${banks} to select within it.`,
        steps: [
          "A decoder and a demultiplexer are the same device. Each output is (minterm of the address) AND (enable) — call the enable “data” and you have a demultiplexer. That equivalence is what makes this construction possible.",
          `The high select bits S${select - 1}..S${stage} pick WHICH decoder is allowed to speak: they drive ${article(select - stage)} ${select - stage}-to-${banks} decoder whose ${banks} outputs are the ENABLE pins of the second stage.`,
          `The low select bits S${stage - 1}..S0 go to every second-stage decoder at once. All ${banks} of them decode the same address — but only the enabled one has an output that can go active.`,
          "The data line drives the FIRST stage's enable. It therefore gates the whole tree through one pin, and appears on exactly one of the outputs.",
          `Total ${banks + 1} decoders. Without an enable pin this is impossible: you would need an AND gate on all ${outputs} outputs to gate them, which is more hardware than the decoders themselves.`,
          "The same tree with the data line removed and the first enable tied active is a plain 4-to-16 decoder — again, the same circuit under a different name.",
        ],
      };
    },
  },

  // --- Q13 -----------------------------------------------------------------
  {
    id: "q13",
    number: "13",
    title: "4-bit equality comparator",
    prompt:
      "Design a logic circuit that compares two 4-bit numbers A and B to check whether they are equal.",
    category: "circuit",
    tags: ["comparator", "XNOR", "equality"],
    params: [
      { key: "bits", label: "Width (bits)", kind: "int", min: 1, max: 8, initial: 4 },
      {
        key: "magnitude",
        label: "Also produce A>B and A<B",
        kind: "choice",
        choices: [
          { value: "no", label: "Equality only" },
          { value: "yes", label: "Full magnitude comparator" },
        ],
        initial: "no",
      },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 4);
      const magnitude = str(v, "magnitude", "no") === "yes";
      return {
        diagrams: [
          equalityComparatorDiagram({
            bits,
            magnitude,
            id: "q13",
            title: `${bits}-bit equality comparator`,
          }),
        ],
        tables: [
          {
            title: "One bit position",
            columns: ["Ai", "Bi", "Ai ⊙ Bi (XNOR)"],
            rows: [
              ["0", "0", "1"],
              ["0", "1", "0"],
              ["1", "0", "0"],
              ["1", "1", "1"],
            ],
            highlightWhen: "1",
          },
        ],
        expressions: [
          `E = ${Array.from({ length: bits }, (_, i) => `(A${bits - 1 - i} ⊙ B${bits - 1 - i})`).join(" · ")}`,
        ],
        steps: [
          "Two numbers are equal exactly when every bit position agrees. So the problem decomposes bit by bit, and there is no carry and no ordering to worry about.",
          "XNOR is the equality gate: its output is 1 precisely when its two inputs match. One XNOR per bit position answers “do these two bits agree”.",
          `All ${bits} answers must be true at once, so they are ANDed. One disagreement anywhere pulls the output to 0.`,
          `Cost: ${bits} XNOR gates and one ${bits}-input AND. Compare that with the obvious alternative — subtract A − B with a full adder chain and test for zero — which needs an entire adder to answer a question ${bits} XNORs answer flat, and is slower because the borrow has to ripple.`,
          magnitude
            ? "For A>B and A<B as well, work from the MSB down: the first position where the bits differ decides the comparison, and the “equal so far” terms it needs are exactly the XNOR outputs already drawn. A>B = A3B3' + (A3⊙B3)A2B2' + … which is how the 7485 is built."
            : "Equality alone needs no ordering logic at all — which is why an equality comparator is so much cheaper than a magnitude comparator.",
        ],
      };
    },
  },

  // --- Q15 -----------------------------------------------------------------
  {
    id: "q15",
    number: "15",
    title: "Serial input distributed to four outputs",
    prompt:
      "Design a circuit to distribute a serial input to four different outputs using a demultiplexer.",
    category: "sequential",
    tags: ["demultiplexer", "counter", "serial to parallel"],
    params: [
      { key: "outputs", label: "Outputs", kind: "int", min: 2, max: 16, initial: 4 },
      {
        key: "latched",
        label: "Hold each bit",
        kind: "choice",
        choices: [
          { value: "yes", label: "Latch each output (true serial-to-parallel)" },
          { value: "no", label: "Bare demultiplexer (bit appears for one clock)" },
        ],
        initial: "yes",
      },
    ],
    solve: (v) => {
      const outputs = num(v, "outputs", 4);
      const latched = str(v, "latched", "yes") === "yes";
      const selBits = Math.ceil(Math.log2(outputs));
      return {
        diagrams: [
          serialToParallelDiagram({
            outputs,
            latched,
            id: "q15",
            title: `Serial input to ${outputs} outputs`,
          }),
        ],
        tables: [
          {
            title: "Clock by clock",
            columns: ["clock", `counter (S${selBits - 1}..S0)`, "active output"],
            rows: Array.from({ length: outputs }, (_, i) => [
              String(i),
              i.toString(2).padStart(selBits, "0"),
              `Y${i}`,
            ]),
          },
        ],
        steps: [
          `A demultiplexer routes one input to one of ${outputs} outputs — but something has to say WHICH, and a serial stream carries no address.`,
          `A mod-${outputs} counter clocked by the same bit clock supplies it: bit 0 goes to Y0, bit 1 to Y1, and so on, wrapping every ${outputs} bits.`,
          latched
            ? "Each output is latched by a D flip-flop. Without the latches, an output is valid for exactly one bit time and then vanishes — you would have a distributor, not a serial-to-parallel converter, and you could never read all four bits at once."
            : "Without latches, each output pulses for one bit time only. That is a distributor — useful for steering a stream to different destinations, but it does not assemble a parallel word.",
          "Framing matters and the question does not mention it: something must reset the counter at the start of each word, or the four bits land on the wrong four outputs forever after one dropped bit.",
          `The alternative is ${article(outputs)} ${outputs}-bit shift register, which does the same job with fewer parts and no counter. The demux version is the one that generalises to routing a whole bus to one of several destinations.`,
        ],
      };
    },
  },

  // --- Q18 -----------------------------------------------------------------
  {
    id: "q18",
    number: "18",
    title: "f₁, f₂, f₃ from one decoder and external gates",
    prompt:
      "Draw the circuit for the functions f₁, f₂ and f₃ using a decoder and external gates.",
    category: "circuit",
    tags: ["decoder", "minterms", "multi-output"],
    params: [
      { key: "vars", label: "Variables", kind: "int", min: 2, max: 4, initial: 3 },
      { key: "f1", label: "f₁ = Σm(…)", kind: "text", initial: "1, 2, 4, 7" },
      { key: "f2", label: "f₂ = Σm(…)", kind: "text", initial: "3, 5, 6, 7" },
      { key: "f3", label: "f₃ = Σm(…)", kind: "text", initial: "0, 1, 2, 3" },
      {
        key: "active",
        label: "Decoder outputs",
        kind: "choice",
        choices: [
          { value: "high", label: "Active HIGH (collect with OR)" },
          { value: "low", label: "Active LOW, like a 74138 (collect with NAND)" },
        ],
        initial: "high",
      },
    ],
    solve: (v) => {
      const vars = num(v, "vars", 3);
      const variables = variablesFor(vars);
      const low = str(v, "active", "high") === "low";
      const limit = (1 << vars) - 1;
      const clean = (text: string) => list(text).filter((m) => m <= limit);

      const specs: FunctionSpec[] = [
        { name: "f1", variables, minterms: clean(str(v, "f1", "1, 2, 4, 7")) },
        { name: "f2", variables, minterms: clean(str(v, "f2", "3, 5, 6, 7")) },
        { name: "f3", variables, minterms: clean(str(v, "f3", "0, 1, 2, 3")) },
      ].filter((s) => s.minterms.length > 0);

      return {
        diagrams: [
          decoderImplementation(specs, {
            id: "q18",
            title: `Three functions from one ${vars}-to-${1 << vars} decoder`,
            activeLowOutputs: low,
          }),
        ],
        tables: [truthTable(specs, { title: "Truth table", decimal: true })],
        expressions: [...specs.map(sigmaOf), ...minimalExpressions(specs)],
        steps: [
          "A decoder output IS a minterm — output k is high exactly on row k. So a decoder computes ALL 2^n minterms of the variables, once, and hands them to you.",
          "Any function is a sum of the minterms where it is 1. With the minterms already generated, implementing a function is just an OR gate over the right decoder outputs.",
          "This is why one decoder plus a few gates beats three separate minimisations when several functions share the same variables: the expensive part (generating the minterms) is paid for once and shared.",
          low
            ? "With active-LOW outputs the decoder gives you complemented minterms, so the collecting gate is a NAND, not an OR — NAND of the complements is the OR of the originals. Using an OR here inverts every output, which is the classic way to lose the marks on this question."
            : "With active-HIGH outputs the collecting gate is a plain OR.",
          "It does not use minimisation at all, and that is deliberate. The circuit is bigger in gate count than three minimised SOPs would be, and smaller in chip count — which is the trade the question is really about.",
        ],
      };
    },
  },

  // --- Q29 -----------------------------------------------------------------
  {
    id: "q29",
    number: "29",
    title: "Counter for even numbers, 0 to 14",
    prompt: "Design a counter that counts only the even numbers from 0 to 14.",
    category: "sequential",
    tags: ["counter", "flip-flop", "state encoding"],
    params: [
      { key: "last", label: "Highest count", kind: "int", min: 2, max: 254, initial: 14 },
      { key: "step", label: "Step", kind: "int", min: 2, max: 8, initial: 2 },
    ],
    solve: (v) => {
      const last = num(v, "last", 14);
      const step = num(v, "step", 2);
      const shift = Math.round(Math.log2(step));
      const states = Math.floor(last / step) + 1;
      const stateBits = Math.ceil(Math.log2(states));
      const powerOfTwoStep = step === 1 << shift;

      return {
        diagrams: [
          powerOfTwoStep
            ? steppedCounterDiagram({
                states,
                shift,
                id: "q29",
                title: `Counts 0, ${step}, … ${last}`,
              })
            : modNCounterDiagram({ modulus: states, id: "q29", title: `Mod-${states} counter` }),
        ],
        tables: [
          {
            title: "State sequence",
            columns: ["step", "count", "binary", `flip-flops (Q${stateBits - 1 + shift}..Q${shift})`],
            rows: Array.from({ length: states }, (_, i) => [
              String(i),
              String(i * step),
              (i * step).toString(2).padStart(stateBits + shift, "0"),
              i.toString(2).padStart(stateBits, "0"),
            ]),
          },
        ],
        answer: `${states} states, ${stateBits} flip-flops${powerOfTwoStep && shift > 0 ? `, and the bottom ${shift} output bit${shift === 1 ? "" : "s"} tied to 0` : ""}.`,
        steps: [
          `The sequence is 0, ${step}, ${2 * step}, … ${last} — that is ${states} distinct states, and ${states} states need ⌈log₂ ${states}⌉ = ${stateBits} flip-flops. Not four: counting to 14 does not mean you need to represent 15 values.`,
          powerOfTwoStep
            ? `Do NOT build a counter that adds ${step}. Build an ordinary ${stateBits}-bit binary counter and call its outputs the HIGH bits of the answer, tying the bottom ${shift} bit${shift === 1 ? "" : "s"} permanently to 0. A number whose low ${shift} bit${shift === 1 ? " is" : "s are"} always 0 is a multiple of ${step} by construction — no decoding logic, nothing to get wrong.`
            : `A step of ${step} is not a power of two, so the shift trick does not apply. Build a mod-${states} counter and decode its output through a small combinational block, or load the counter with the next value each cycle.`,
          `The flip-flops themselves are an ordinary mod-${states} counter: T flip-flops, all on the same clock, with bit k toggling when every lower bit is 1.`,
          states === 1 << stateBits
            ? `${states} is a power of two, so the counter rolls over on its own and no decode-and-clear is needed.`
            : `${states} is not a power of two, so the count ${states} must be detected and used to clear the counter back to 0.`,
          "Worth stating explicitly in an exam answer: the count is even because of how the outputs are WIRED, not because of anything the flip-flops do. That is the insight being tested.",
        ],
      };
    },
  },

  // --- Q30 -----------------------------------------------------------------
  {
    id: "q30",
    number: "30",
    title: "4-bit asynchronous counter with timing diagram",
    prompt:
      "Explain the working of a 4-bit asynchronous binary counter with a timing diagram.",
    category: "sequential",
    tags: ["ripple counter", "timing", "propagation delay"],
    params: [
      { key: "bits", label: "Width (bits)", kind: "int", min: 2, max: 6, initial: 4 },
      {
        key: "dir",
        label: "Direction",
        kind: "choice",
        choices: [
          { value: "up", label: "Up (clock the next stage from Q)" },
          { value: "down", label: "Down (clock the next stage from Q')" },
        ],
        initial: "up",
      },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 4);
      const down = str(v, "dir", "up") === "down";
      return {
        diagrams: [
          rippleCounterDiagram({
            bits,
            down,
            id: "q30",
            title: `${bits}-bit asynchronous (ripple) ${down ? "down " : ""}counter`,
          }),
          syncCounterDiagram({
            bits,
            id: "q30sync",
            title: "The synchronous counter, for comparison",
          }),
        ],
        tables: [
          {
            title: "Count sequence",
            columns: ["clock edge", ...Array.from({ length: bits }, (_, i) => `Q${bits - 1 - i}`), "value"],
            rows: Array.from({ length: 1 << bits }, (_, k) => {
              const value = down ? (1 << bits) - 1 - k : k;
              return [
                String(k),
                ...Array.from({ length: bits }, (_, i) =>
                  String((value >>> (bits - 1 - i)) & 1),
                ),
                String(value),
              ];
            }),
          },
        ],
        steps: [
          "Every flip-flop has J = K = 1, so each clock edge simply inverts its Q. A flip-flop wired that way is a divide-by-two.",
          `Only FF0 is connected to the system clock. FF1 is clocked by FF0's ${down ? "Q'" : "Q"}, FF2 by FF1's, and so on — so a clock edge does not arrive at FF${bits - 1} until it has passed through ${bits - 1} flip-flops. That is the “ripple”.`,
          `Read the timing diagram left to right: each trace is drawn slightly later than the one above it. That offset is the propagation delay, and it ACCUMULATES — by bit ${bits - 1} the total is ${bits} flip-flop delays.`,
          `The consequence is not cosmetic. Going from 0111 to 1000, the outputs pass through 0110, 0100 and 0000 on the way. Those states are real, and a decoder watching the outputs will briefly and genuinely select the wrong line.`,
          `Maximum clock frequency is therefore 1/(${bits} × t_pd) rather than 1/t_pd — the counter gets slower with every bit you add.`,
          "In exchange it is the cheapest counter there is: no gates at all, just flip-flops. That is why it survives as a frequency divider, where nobody is decoding the intermediate outputs.",
          "The synchronous version below fixes all of this by clocking every flip-flop together and using AND gates to decide which ones toggle — constant delay, no invalid states, more hardware.",
        ],
      };
    },
  },

  // --- Q34 / Q35 -----------------------------------------------------------
  {
    id: "q34",
    number: "34",
    title: "64×8 memory from 16×4 chips",
    prompt:
      "Show the external connections necessary to construct a 64×8 memory unit from 16×4 memory chips.",
    category: "memory",
    tags: ["memory expansion", "decoder", "chip select"],
    params: [
      { key: "tw", label: "Target words", kind: "int", min: 2, max: 1048576, initial: 64 },
      { key: "tb", label: "Target bits per word", kind: "int", min: 1, max: 64, initial: 8 },
      { key: "cw", label: "Chip words", kind: "int", min: 2, max: 1048576, initial: 16 },
      { key: "cb", label: "Chip bits per word", kind: "int", min: 1, max: 64, initial: 4 },
    ],
    solve: (v) => memorySolution(v, "ram", "q34"),
  },
  {
    id: "q35",
    number: "35",
    title: "128×8 ROM from 32×8 ROM chips",
    prompt:
      "Show the external connections necessary to construct a 128×8 ROM using four 32×8 ROM chips and a decoder.",
    category: "memory",
    tags: ["ROM", "memory expansion", "decoder"],
    params: [
      { key: "tw", label: "Target words", kind: "int", min: 2, max: 1048576, initial: 128 },
      { key: "tb", label: "Target bits per word", kind: "int", min: 1, max: 64, initial: 8 },
      { key: "cw", label: "Chip words", kind: "int", min: 2, max: 1048576, initial: 32 },
      { key: "cb", label: "Chip bits per word", kind: "int", min: 1, max: 64, initial: 8 },
    ],
    solve: (v) => memorySolution(v, "rom", "q35"),
  },

  // --- Q40 -----------------------------------------------------------------
  {
    id: "q40",
    number: "40",
    title: "Sequential circuit with two D flip-flops",
    prompt:
      "Design a sequential circuit with two D flip-flops A and B and two inputs P and Q.",
    category: "sequential",
    tags: ["D flip-flop", "state table", "feedback"],
    params: [
      { key: "DA", label: "DA =", kind: "text", initial: "A*P + B*Q" },
      { key: "DB", label: "DB =", kind: "text", initial: "A'*P" },
      { key: "Y", label: "output Y =", kind: "text", initial: "(A + B)*P'" },
    ],
    solve: (v) => {
      const spec: SequentialSpec = {
        inputs: ["P", "Q"],
        stateVars: ["A", "B"],
        type: "d",
        excitation: {
          DA: str(v, "DA", "A*P + B*Q"),
          DB: str(v, "DB", "A'*P"),
        },
        outputs: [{ label: "Y", expr: str(v, "Y", "(A + B)*P'") }],
      };
      const rows = stateTable(spec);
      return {
        diagrams: [
          sequentialDesignDiagram(spec, {
            id: "q40",
            title: "Two D flip-flops, inputs P and Q",
          }),
        ],
        tables: [
          {
            title: "State table",
            columns: ["A B", "P Q", "A⁺ B⁺", "Y"],
            rows: rows.map((r) => [
              r.present.split("").join(" "),
              r.input.split("").join(" "),
              r.next.split("").join(" "),
              r.output,
            ]),
          },
        ],
        expressions: excitationSummary(spec),
        steps: [
          "For a D flip-flop the next state IS the excitation: A⁺ = DA and B⁺ = DB. That is the entire appeal of the D type — no characteristic equation to apply, no excitation table to look up, so the next-state equations ARE the circuit.",
          "Everything the circuit does is in those two equations plus the output equation. Change them and both the drawing and the state table below follow, because both are computed from the same text.",
          "The wires that run round underneath are the state feedback: each flip-flop's Q is an input to the next-state logic. Without them the circuit would be combinational and would have no state at all.",
          "Y depends on P as well as on the state, which makes this a MEALY machine — the output can change between clock edges when an input changes. A Moore machine's output would depend on A and B only, and would be glitch-free at the cost of one extra state.",
          "To read the behaviour, start from AB = 00 and walk the table. Any state that cannot be reached from the reset state is an orphan, and if the circuit can ever land in one it must still be able to get out — which is why the asynchronous CLEAR is drawn.",
        ],
      };
    },
  },

  // --- Q41 -----------------------------------------------------------------
  {
    id: "q41",
    number: "41(a), (b)",
    title: "Count the 1s, with a decoder, OR gates and an encoder",
    prompt:
      "Draw a logic circuit using a 3-to-8 decoder, two OR gates and a 4-to-2 encoder that outputs the number of 1s in the input.",
    category: "circuit",
    tags: ["decoder", "encoder", "population count"],
    params: [{ key: "bits", label: "Input width (bits)", kind: "int", min: 2, max: 4, initial: 3 }],
    solve: (v) => {
      const bits = num(v, "bits", 3);
      const rows = 1 << bits;
      const counts = bits + 1;
      const encBits = Math.ceil(Math.log2(counts));
      const pop = (x: number): number => x.toString(2).split("").filter((c) => c === "1").length;

      return {
        diagrams: [
          onesCounterDiagram({ bits, id: "q41", title: `Count the 1s in ${article(bits)} ${bits}-bit word` }),
        ],
        tables: [
          {
            title: "What the circuit computes",
            columns: [...variablesFor(bits), "minterm", "number of 1s", `Z${encBits - 1}..Z0`],
            rows: Array.from({ length: rows }, (_, m) => [
              ...variablesFor(bits).map((_, i) => String((m >>> (bits - 1 - i)) & 1)),
              `Y${m}`,
              String(pop(m)),
              pop(m).toString(2).padStart(encBits, "0"),
            ]),
          },
          {
            title: "Grouping the minterms by population count",
            columns: ["count", "minterms", "gate"],
            rows: Array.from({ length: counts }, (_, k) => {
              const members = Array.from({ length: rows }, (_, m) => m).filter(
                (m) => pop(m) === k,
              );
              return [
                String(k),
                members.map((m) => `Y${m}`).join(", "),
                members.length === 1 ? "direct wire" : `${members.length}-input OR`,
              ];
            }),
          },
        ],
        answer: `One ${bits}-to-${rows} decoder, ${counts - 2} OR gates, one ${1 << encBits}-to-${encBits} encoder.`,
        steps: [
          `The decoder turns the ${bits}-bit input into exactly one active line — the minterm of that input.`,
          "Minterms with the same number of 1s must produce the same answer, so they are ORed together. That is what the OR gates are for.",
          `Counts 0 and ${bits} have a single minterm each (all-zeros and all-ones), so they need no gate at all — which is exactly why the question says TWO OR gates and not ${counts}.`,
          `The encoder converts “which count line is active” back into ${article(encBits)} ${encBits}-bit binary number.`,
          (1 << encBits) > counts
            ? `The ${1 << encBits}-to-${encBits} encoder has ${1 << encBits} inputs but there are only ${counts} possible counts, so the unused inputs are tied to GND. Leaving them open would float HIGH on TTL and corrupt the output — a detail that costs marks and, on a bench, hours.`
            : "Every encoder input is used.",
          "The chain decoder → OR → encoder is a general recipe: decode to minterms, group the minterms that share an answer, encode the group index. Any function from n bits to m bits can be built this way, at a cost of 2^n decoder outputs.",
        ],
      };
    },
  },

  // --- Q42 -----------------------------------------------------------------
  {
    id: "q42",
    number: "42(a), (b)",
    title: "P = 3Q + 1 using a 4-bit adder",
    prompt:
      "Draw a logic circuit using a 4-bit adder and basic gates that computes P = 3·Q + 1.",
    category: "circuit",
    tags: ["adder", "shift", "constant multiply"],
    params: [
      { key: "bits", label: "Width of Q (bits)", kind: "int", min: 2, max: 8, initial: 4 },
      {
        key: "mult",
        label: "Multiplier",
        kind: "choice",
        choices: [
          { value: "3", label: "3  (Q + 2Q)" },
          { value: "5", label: "5  (Q + 4Q)" },
          { value: "9", label: "9  (Q + 8Q)" },
        ],
        initial: "3",
      },
      {
        key: "offset",
        label: "Offset",
        kind: "choice",
        choices: [
          { value: "1", label: "+1  (free, via carry-in)" },
          { value: "0", label: "+0" },
        ],
        initial: "1",
      },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 4);
      const mult = num(v, "mult", 3);
      const offset = (num(v, "offset", 1) === 1 ? 1 : 0) as 0 | 1;
      const shift = Math.round(Math.log2(mult - 1));

      return {
        diagrams: [
          scaleDiagram({
            bits,
            multiplier: mult,
            offset,
            id: "q42",
            title: `P = ${mult}Q${offset ? " + 1" : ""}`,
          }),
        ],
        tables: [
          {
            title: "Check it",
            columns: ["Q", "Q (binary)", `${2 ** shift}Q`, `${mult}Q${offset ? " + 1" : ""}`, "P (binary)"],
            rows: Array.from({ length: Math.min(16, 1 << bits) }, (_, q) => [
              String(q),
              q.toString(2).padStart(bits, "0"),
              String(q * 2 ** shift),
              String(mult * q + offset),
              (mult * q + offset).toString(2).padStart(bits + shift + 1, "0"),
            ]),
          },
        ],
        answer: `One ${bits}-bit adder, ${shift} half adder${shift === 1 ? "" : "s"}, and no multiplier at all.`,
        steps: [
          `${mult}Q = ${2 ** shift}Q + Q. Multiplying by a power of two is a SHIFT, and a shift is free — it is where you solder the wire, not a component.`,
          `So A = Q and B = Q shifted ${shift} place${shift === 1 ? "" : "s"} left: B${bits - 1}..B${shift} are Q${bits - 1 - shift}..Q0, and B${shift - 1}..B0 are tied to 0.`,
          offset === 1
            ? "The +1 is the adder's carry-in tied to +5V. It costs nothing — the pin was sitting there unused."
            : "The carry-in is tied to 0.",
          `Q is ${bits} bits, so ${mult}Q${offset ? "+1" : ""} needs up to ${bits + shift + 1}. The top ${shift} bit${shift === 1 ? "" : "s"} of ${2 ** shift}Q fall off the end of the ${bits}-bit adder, so they are added to its carry-out by ${shift === 1 ? "a half adder" : `${shift} half adders`}.`,
          "The whole point of the question: there is no multiplier here. A constant multiplier is always a handful of shifts and adds, and “×3” in particular is one addition.",
        ],
      };
    },
  },

  // --- Q43 -----------------------------------------------------------------
  {
    id: "q43",
    number: "43(a), (b)",
    title: "f = x'y + x'z + xy'z' with 2-to-1 multiplexers only",
    prompt:
      "Draw the truth table for f = x′y + x′z + xy′z′, then implement the function using only 2-to-1 multiplexers.",
    category: "circuit",
    tags: ["multiplexer", "Shannon expansion", "decision tree"],
    params: [
      { key: "expr", label: "Function", kind: "text", initial: "X'Y + X'Z + XY'Z'" },
      { key: "vars", label: "Variables (in order, MSB first)", kind: "text", initial: "X Y Z" },
    ],
    solve: (v) => {
      const variables = names(str(v, "vars", "X Y Z"));
      const spec = specFromExpression(str(v, "expr", "X'Y + X'Z + XY'Z'"), variables, "f");
      return {
        diagrams: [
          muxTreeForFunction(spec, { id: "q43", title: "f from 2-to-1 multiplexers only" }),
          muxImplementation(spec, {
            id: "q43alt",
            title: "The same function on one 4-to-1 multiplexer",
            selectBits: Math.max(1, variables.length - 1),
          }),
        ],
        tables: [truthTable([spec], { title: "Truth table", decimal: true })],
        expressions: [sigmaOf(spec), ...minimalExpressions([spec])],
        steps: [
          "A 2-to-1 multiplexer is an if-then-else: with S = 0 it passes I0, with S = 1 it passes I1. Nothing else.",
          `So test the variables one at a time — ${variables.join(", then ")} — and you have a decision tree whose leaves are the function's own 0s and 1s. That needs no gates at all, not even an inverter: I0 = 1 with I1 = 0 IS a complement.`,
          "Then REDUCE it: wherever both branches of a multiplexer lead to the same value, that test cannot affect the answer and the multiplexer disappears. This is exactly how a binary decision diagram is built, and it is what turns the 2ⁿ−1 worst case into the small circuit expected here.",
          "The second drawing is the shortcut for when you are allowed a wider mux: put n−1 variables on the select lines and each data input becomes 0, 1, the last variable, or its complement — read straight off the truth table in pairs of rows.",
        ],
      };
    },
  },

  // --- Q44 -----------------------------------------------------------------
  {
    id: "q44",
    number: "44(a), (b)",
    title: "Full adder from a 3-to-8 decoder",
    prompt:
      "Draw the truth table for a full adder, then implement it using one 3-to-8 decoder and basic gates.",
    category: "circuit",
    tags: ["decoder", "full adder", "minterms"],
    params: [
      {
        key: "active",
        label: "Decoder outputs",
        kind: "choice",
        choices: [
          { value: "high", label: "Active HIGH (collect with OR)" },
          { value: "low", label: "Active LOW, like a 74138 (collect with NAND)" },
        ],
        initial: "high",
      },
    ],
    solve: (v) => {
      const low = str(v, "active", "high") === "low";
      const variables = ["X", "Y", "Z"];
      // Sum is odd parity: the rows with an odd number of 1s. Carry is majority.
      const sum: FunctionSpec = { name: "S", variables, minterms: [1, 2, 4, 7] };
      const carry: FunctionSpec = { name: "C", variables, minterms: [3, 5, 6, 7] };

      return {
        diagrams: [
          decoderImplementation([sum, carry], {
            id: "q44",
            title: "Full adder from a 3-to-8 decoder",
            activeLowOutputs: low,
          }),
        ],
        tables: [truthTable([sum, carry], { title: "Full adder truth table", decimal: true })],
        expressions: [sigmaOf(sum), sigmaOf(carry), ...minimalExpressions([sum, carry])],
        steps: [
          "A full adder adds three bits — X, Y and the carry-in Z — and produces a two-bit result: the sum bit and the carry-out.",
          "S is 1 when an ODD number of inputs is 1: rows 1, 2, 4 and 7. That is odd parity, which is why S = X ⊕ Y ⊕ Z.",
          "C is 1 when at least TWO inputs are 1: rows 3, 5, 6 and 7. That is a majority function, C = XY + YZ + XZ.",
          "The decoder generates all eight minterms. S is the OR of its four, C is the OR of its four — and note that row 7 appears in both, which is fine: one decoder output can drive as many gates as you like.",
          low
            ? "With active-LOW outputs the collecting gates are NANDs. NAND over complemented minterms gives their OR; using OR gates here would invert both outputs."
            : "With active-HIGH outputs the collecting gates are ORs.",
          "The decoder implementation is bigger in gates than S = X⊕Y⊕Z and C = XY+YZ+XZ, and it is the right answer to THIS question because the same decoder serves both outputs — and would serve four more for free.",
        ],
      };
    },
  },

  // --- Q45 -----------------------------------------------------------------
  {
    id: "q45",
    number: "45(a), (b), (c)",
    title: "Prime number detector on a multiplexer",
    prompt:
      "Draw the truth table for f(a,b,c,d) which is 1 when the input is a prime number, then implement it with an 8-to-1 and with a 4-to-1 multiplexer plus extra gates.",
    category: "circuit",
    tags: ["multiplexer", "Shannon expansion", "prime"],
    params: [
      { key: "bits", label: "Input width (bits)", kind: "int", min: 3, max: 5, initial: 4 },
      {
        key: "sel",
        label: "Multiplexer size",
        kind: "choice",
        choices: [
          { value: "3", label: "8-to-1 (3 select lines)" },
          { value: "2", label: "4-to-1 (2 select lines)" },
          { value: "1", label: "2-to-1 (1 select line)" },
        ],
        initial: "3",
      },
    ],
    solve: (v) => {
      const bits = num(v, "bits", 4);
      const selectBits = num(v, "sel", 3);
      const variables = ["a", "b", "c", "d", "e"].slice(0, bits);
      const isPrime = (x: number): boolean => {
        if (x < 2) return false;
        for (let k = 2; k * k <= x; k++) if (x % k === 0) return false;
        return true;
      };
      const spec: FunctionSpec = {
        name: "f",
        variables,
        minterms: mintermsWhere(bits, isPrime),
      };
      const residues = muxResidues(spec, selectBits);
      const rest = variables.slice(selectBits);

      return {
        diagrams: [
          muxImplementation(spec, {
            id: "q45",
            title: `Prime detector on ${article(1 << selectBits)} ${1 << selectBits}-to-1 multiplexer`,
            selectBits,
          }),
        ],
        tables: [
          truthTable([spec], { title: "Truth table", decimal: true }),
          {
            title: `Data inputs (select = ${variables.slice(0, selectBits).join("")})`,
            columns: ["input", "select code", `residue in ${rest.join(", ") || "—"}`],
            rows: residues.map((r, j) => [
              `I${j}`,
              r.select,
              r.residue.kind === "const"
                ? String(r.residue.value)
                : r.residue.kind === "var"
                  ? `${r.residue.name}${r.residue.complemented ? "'" : ""}`
                  : r.residue.text,
            ]),
          },
        ],
        expressions: [sigmaOf(spec), ...minimalExpressions([spec])],
        steps: [
          `The primes below ${1 << bits} are ${spec.minterms.join(", ")} — that is the truth table, and there is nothing clever about deriving it. 0 and 1 are not prime; 2 is.`,
          `Put ${variables.slice(0, selectBits).join(", ")} on the select lines. Fixing those leaves a function of ${rest.length > 0 ? rest.join(", ") : "nothing"} — the RESIDUE — and that is what ties to the corresponding data input.`,
          selectBits === bits - 1
            ? "With n−1 select lines each residue is a function of one variable, so it can only be 0, 1, d or d′. Read them straight off the truth table two rows at a time — this is why an 8-to-1 mux implements ANY four-variable function with at most one inverter."
            : `With ${selectBits} select lines each residue is a function of ${rest.length} variables, so some of them need a gate or two. That is the trade: a smaller multiplexer costs external logic.`,
          "This works for every function, not just this one, which is the real content of “a multiplexer is a universal logic element”. It is Shannon expansion in hardware.",
        ],
      };
    },
  },

  // --- Q46 -----------------------------------------------------------------
  {
    id: "q46",
    number: "46(a), (b)",
    title: "What function does this multiplexer implement?",
    prompt:
      "Show the multiplexer implementation with the given data inputs, and determine the Boolean function it implements.",
    category: "circuit",
    tags: ["multiplexer", "analysis", "reverse engineering"],
    params: [
      { key: "sel", label: "Select variables", kind: "text", initial: "A B" },
      { key: "data", label: "Data variables", kind: "text", initial: "C" },
      {
        key: "inputs",
        label: "Data inputs I0, I1, … (0, 1, a variable, or an expression)",
        kind: "text",
        initial: "C, C', 1, 0",
      },
    ],
    solve: (v) => {
      const sel = names(str(v, "sel", "A B"));
      const data = names(str(v, "data", "C"));
      const inputs = str(v, "inputs", "C, C', 1, 0")
        .split(",")
        .map((t) => t.trim());
      const readout = readMux(sel, data, inputs, "F");
      const spec: FunctionSpec = {
        name: "F",
        variables: readout.variables,
        minterms: readout.minterms,
      };

      return {
        diagrams: [
          muxImplementation(spec, {
            id: "q46",
            title: `F on ${article(1 << sel.length)} ${1 << sel.length}-to-1 multiplexer`,
            selectBits: sel.length,
          }),
        ],
        tables: [
          {
            title: "Given",
            columns: ["input", `select ${sel.join("")}`, "tied to"],
            rows: Array.from({ length: 1 << sel.length }, (_, j) => [
              `I${j}`,
              j.toString(2).padStart(sel.length, "0"),
              inputs[j] ?? "0",
            ]),
          },
          truthTable([spec], { title: "Resulting truth table", decimal: true }),
        ],
        expressions: [sigmaOf(spec), `F = ${readout.minimal}`],
        answer: `F = ${readout.minimal}`,
        steps: [
          "Read the multiplexer as a table of cases. When the select lines hold a particular code, the output IS whatever is tied to that data input — nothing else in the circuit matters.",
          `So each data input contributes a block of ${1 << data.length} rows to the truth table: the rows where ${sel.join("")} equals that input's index.`,
          "Write those blocks out in select order and you have the whole truth table. Minimise it and you have the function.",
          `Here that gives F = ${readout.minimal}.`,
          "The reverse direction is the same operation: to IMPLEMENT a function this way, split its truth table into blocks of consecutive rows and read off what each block is as a function of the remaining variables.",
        ],
      };
    },
  },
];

// --- shared helpers ---------------------------------------------------------

function memorySolution(
  v: Readonly<Record<string, number | string>>,
  kind: "ram" | "rom",
  id: string,
) {
  const tw = num(v, "tw", 64);
  const tb = num(v, "tb", 8);
  const cw = num(v, "cw", 16);
  const cb = num(v, "cb", 4);
  const plan = planExpansion(tw, tb, cw, cb);

  return {
    diagrams: [
      memoryExpansionDiagram({
        targetWords: tw,
        targetBits: tb,
        chipWords: cw,
        chipBits: cb,
        kind,
        id,
      }),
    ],
    tables: [
      {
        title: "Address map",
        columns: ["bank", `A${plan.target.addressLines - 1}..A${plan.sharedAddressLines}`, "address range"],
        rows: Array.from({ length: plan.deep }, (_, b) => [
          String(b),
          b.toString(2).padStart(Math.max(1, plan.decodedAddressLines), "0"),
          `${b * cw} – ${(b + 1) * cw - 1}`,
        ]),
      },
    ],
    answer: describePlan(plan)[0] as string,
    steps: [
      ...describePlan(plan),
      `Widening and deepening are different operations. The ${plan.wide} chip${plan.wide === 1 ? "" : "s"} within a bank share address AND chip select — they are one memory with a wider word. The ${plan.deep} bank${plan.deep === 1 ? "" : "s"} share address but NOT chip select, because only one of them may drive the data bus at a time.`,
      "Two chip selects active simultaneously is not a bigger memory — it is two chips fighting over the same wires. The decoder exists precisely to make that impossible.",
      kind === "rom"
        ? "A ROM has no data inputs and no write-enable, so only the address lines, the chip selects and the data outputs need wiring."
        : "For a RAM the data lines and the write-enable also go to every chip in parallel; the chip select is what decides which one actually responds.",
      ...plan.problems.map((p) => `Note: ${p}`),
    ],
  };
}

/**
 * Turn a written expression into the minterm-shaped spec the builders want.
 *
 * Run through the ENGINE's parser and truth-vector builder, so the variable
 * order obeys the MSB contract rather than this file's opinion of it — the same
 * mistake that once made `verify()` report a correct multiplexer as wrong.
 */
function specFromExpression(
  text: string,
  variables: readonly string[],
  name: string,
): FunctionSpec {
  const parsed = parse(text);
  if (!parsed.ok) return { name, variables, minterms: [] };
  const vector = truthVector(parsed.value.ast, variables.map((x) => x.toUpperCase()));
  const minterms: number[] = [];
  for (let m = 0; m < 1 << variables.length; m++) if (vector[m] === 1) minterms.push(m);
  return { name, variables, minterms };
}
