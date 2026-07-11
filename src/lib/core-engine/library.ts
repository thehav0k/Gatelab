/**
 * Classic functions, ready to minimize.
 *
 * These are the circuits a digital-logic course actually sets: adders, the
 * comparator, multiplexers, decoders, priority encoders. Each is stated as an
 * EXPRESSION over named variables, so the theory workspace can minimize it, draw
 * its K-map, and hand it to the synthesizer like anything else — rather than being
 * a special-cased black box.
 *
 * Where a circuit has several outputs, each is its own entry. A full adder is two
 * functions of the same three inputs, and treating them separately is exactly how
 * you would derive them on paper.
 */

/**
 * A note on names: a variable is ONE LETTER plus optional digits (A, B, A1, D0).
 * It cannot be `Cin`, because juxtaposition means AND — `AB` has to be A·B — and
 * multi-letter names cannot coexist with that. Every textbook makes the same
 * trade. So the full adder's carry-in is simply `C`.
 */
export interface LibraryFunction {
  readonly id: string;
  readonly group: string;
  readonly name: string;
  /** The source string, exactly as the input box would accept it. */
  readonly source: string;
  /** What it is for, and what to notice. */
  readonly note: string;
}

export const FUNCTION_LIBRARY: readonly LibraryFunction[] = [
  // --- arithmetic ----------------------------------------------------------
  {
    id: "half-adder-sum",
    group: "Adders",
    name: "Half adder — Sum",
    source: "S(A,B) = A ^ B",
    note: "The sum of two bits is their XOR. Minimize it and you get the XOR back — there is nothing to save, which is itself the point.",
  },
  {
    id: "half-adder-carry",
    group: "Adders",
    name: "Half adder — Carry",
    source: "C(A,B) = A*B",
    note: "The carry is just an AND. A half adder is one XOR and one AND, and nothing else.",
  },
  {
    id: "full-adder-sum",
    group: "Adders",
    name: "Full adder — Sum (C is carry-in)",
    source: "S(A,B,C) = A ^ B ^ C",
    note: "Three-way parity. The K-map is a checkerboard — no two 1s are adjacent, so NOTHING combines and the minimal SOP is the full four-term canonical form. That is what a function with no simplification looks like.",
  },
  {
    id: "full-adder-carry",
    group: "Adders",
    name: "Full adder — Carry out (C is carry-in)",
    source: "K(A,B,C) = A*B + B*C + A*C",
    note: "The majority function: 1 when at least two inputs are 1. Compare it to the Sum above — same inputs, utterly different K-map.",
  },

  // --- multiplexers ---------------------------------------------------------
  {
    id: "mux2",
    group: "Multiplexers",
    name: "2-to-1 multiplexer",
    source: "Y(S,A,B) = S'*A + S*B",
    note: "Note the variable ORDER: S is the select line and comes first, so it is the MSB of the truth table. Watch the timing panel — this circuit has a classic static hazard when S changes with A = B = 1.",
  },
  {
    id: "mux4",
    group: "Multiplexers",
    name: "4-to-1 multiplexer",
    source: "Y(S1,S0,D0,D1) = S1'*S0'*D0 + S1'*S0*D1",
    note: "Two select lines choose one of four data lines. (Only D0 and D1 are shown, to keep it to four variables and a drawable K-map.)",
  },

  // --- decoders -------------------------------------------------------------
  {
    id: "decoder-y0",
    group: "Decoders",
    name: "2-to-4 decoder — Y0",
    source: "Y0(A,B) = A'*B'",
    note: "A decoder is n AND gates, one per minterm. Y0 fires on 00, Y1 on 01, and so on — each output IS a single minterm, which is why a decoder plus an OR gate can implement any function at all.",
  },
  {
    id: "decoder-y3",
    group: "Decoders",
    name: "2-to-4 decoder — Y3",
    source: "Y3(A,B) = A*B",
    note: "The last output of the decoder. Put a decoder's outputs through an OR gate and you have built a function straight from its minterm list — no minimization required.",
  },

  // --- encoders -------------------------------------------------------------
  {
    id: "encoder-q1",
    group: "Encoders",
    name: "4-to-2 priority encoder — Q1",
    source: "Q1(D3,D2,D1,D0) = D3 + D2",
    note: "Priority: the highest active input wins. Q1 is 1 whenever D3 or D2 is active, regardless of the lower lines — which is why D1 and D0 do not appear in it at all.",
  },
  {
    id: "encoder-q0",
    group: "Encoders",
    name: "4-to-2 priority encoder — Q0",
    source: "Q0(D3,D2,D1,D0) = D3 + D2'*D1",
    note: "Q0 needs D2' — the priority. D1 only speaks when D2 is silent. Compare with Q1, which needs no such guard.",
  },

  // --- comparators ----------------------------------------------------------
  {
    id: "comparator-gt",
    group: "Comparators",
    name: "2-bit comparator — A > B",
    source: "G(A1,A0,B1,B0) = A1*B1' + A0*B1'*B0' + A1*A0*B0'",
    note: "Compare two 2-bit numbers. The three terms are the three ways A can exceed B, and the K-map shows them as three overlapping loops.",
  },
  {
    id: "comparator-eq",
    group: "Comparators",
    name: "2-bit comparator — A = B",
    source: "E(A1,A0,B1,B0) = (A1 XNOR B1) * (A0 XNOR B0)",
    note: "Equality is bitwise XNOR, ANDed. XNOR is the equality gate — that is the whole of what it does.",
  },

  // --- the lesson circuits --------------------------------------------------
  {
    id: "hazard",
    group: "Hazards",
    name: "Static-1 hazard",
    source: "F(A,B,C) = A*C' + B*C",
    note: "A minimal cover that GLITCHES. Build it, open the timing panel, and watch F dip when C falls with A = B = 1.",
  },
  {
    id: "hazard-free",
    group: "Hazards",
    name: "Static-1 hazard, cured",
    source: "F(A,B,C) = A*C' + B*C + A*B",
    note: "The same function plus the consensus term A·B, which Quine–McCluskey discards precisely BECAUSE it is redundant. It is redundant in the steady state, not in time. Minimal is not hazard-free.",
  },
];

export const LIBRARY_GROUPS = [
  ...new Set(FUNCTION_LIBRARY.map((f) => f.group)),
];

export const getLibraryFunction = (id: string): LibraryFunction | undefined =>
  FUNCTION_LIBRARY.find((f) => f.id === id);

/**
 * A blank truth table for n variables — the entry point for "I do not have an
 * expression, I have a spec".
 *
 * Emitted as `F(A,B,C) = Σm()`, which the notation parser already understands, so
 * the truth table renders with every row at 0 and the user clicks the ones they
 * want. Clicking a row rewrites this same string, so the expression and the table
 * stay two views of one document rather than two sources of truth.
 */
export const blankTruthTable = (variables: number): string => {
  const names = Array.from({ length: variables }, (_, i) =>
    String.fromCharCode(65 + i),
  );
  return `F(${names.join(",")}) = Σm()`;
};
