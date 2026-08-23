import * as C from "../catalog";
import type { Block, BlockTone, Port, Side } from "../types";

/**
 * The palette: every kind of block a user can place, and how it is configured.
 *
 * THE POINT OF THIS FILE is that a part is a FUNCTION OF ITS PARAMETERS, not a
 * fixed shape. "Decoder" is not a block; a decoder with 3 address lines, an
 * active-low enable and active-low outputs is. Storing the built block would
 * mean a palette of forty near-identical entries and no way to change one after
 * it was placed — so the document stores `{ part: "decoder", params: {...} }`
 * and the block is rebuilt whenever the parameters change.
 *
 * The last entry is the one that makes the set complete rather than merely
 * large: `generic` is a box whose title and port lists you type in. Every part
 * catalogue is a guess about what somebody will need, and this is the escape
 * hatch for when the guess is wrong — a barrel shifter, a UART, a
 * BCD-to-seven-segment driver, or a block that only exists in one lecturer's
 * notes.
 */

export type PartParamKind = "int" | "bool" | "choice" | "text";

/**
 * Deliberately NOT the `ParamSpec` from `problems/types.ts`. That one describes
 * how to vary a QUESTION; this one describes how to configure a PART. They look
 * alike today and answer to different owners, and collapsing them would mean
 * every new part option had to make sense as an exam parameter.
 */
export interface PartParam {
  readonly key: string;
  readonly label: string;
  readonly kind: PartParamKind;
  readonly min?: number;
  readonly max?: number;
  readonly choices?: readonly { readonly value: string; readonly label: string }[];
  readonly initial: string | number | boolean;
  readonly hint?: string;
}

export type PartValues = Readonly<Record<string, string | number | boolean>>;

export type PartCategory =
  | "io"
  | "gate"
  | "combinational"
  | "arithmetic"
  | "sequential"
  | "memory"
  | "custom";

export interface PartDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: PartCategory;
  readonly summary: string;
  readonly params: readonly PartParam[];
  /** Build the block. `id` is the instance id the document assigned. */
  readonly build: (id: string, values: PartValues) => Block;
}

// --- reading parameters -----------------------------------------------------

export const pInt = (v: PartValues, key: string, fallback: number): number => {
  const raw = v[key];
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};

export const pBool = (v: PartValues, key: string, fallback: boolean): boolean =>
  typeof v[key] === "boolean" ? (v[key] as boolean) : fallback;

export const pStr = (v: PartValues, key: string, fallback: string): string => {
  const raw = v[key];
  return raw === undefined || raw === "" ? fallback : String(raw);
};

// --- shared parameter shapes ------------------------------------------------

const widthParam = (initial: number, max = 16): PartParam => ({
  key: "bits",
  label: "Width (bits)",
  kind: "int",
  min: 1,
  max,
  initial,
});

const labelParam = (initial: string): PartParam => ({
  key: "label",
  label: "Label",
  kind: "text",
  initial,
});

const bussedParam: PartParam = {
  key: "bussed",
  label: "Draw as a bus",
  kind: "bool",
  initial: false,
  hint: "One thick line with a slash and the width, instead of one pin per bit.",
};

/** `title`/`subtitle` overrides, offered on every box so any block can be renamed. */
const renameParams: PartParam[] = [
  { key: "title", label: "Title (blank = default)", kind: "text", initial: "" },
  { key: "subtitle", label: "Subtitle (blank = default)", kind: "text", initial: "" },
];

/**
 * Apply the user's title/subtitle overrides to a built block.
 *
 * Every part runs through this, so renaming works everywhere without each
 * factory having to know about it — and an empty string means "keep the default"
 * rather than "make it blank", because a box with no name is never what somebody
 * meant to ask for.
 */
function renamed(block: Block, v: PartValues): Block {
  const title = pStr(v, "title", "");
  const subtitle = pStr(v, "subtitle", "");
  return {
    ...block,
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
  };
}

// --- the registry -----------------------------------------------------------

const GATE_OPS = [
  { value: "and", label: "AND" },
  { value: "or", label: "OR" },
  { value: "nand", label: "NAND" },
  { value: "nor", label: "NOR" },
  { value: "xor", label: "XOR" },
  { value: "xnor", label: "XNOR" },
  { value: "not", label: "NOT" },
  { value: "buf", label: "Buffer" },
] as const;

export const PARTS: readonly PartDefinition[] = [
  // --- I/O ------------------------------------------------------------------
  {
    id: "input",
    name: "Input",
    category: "io",
    summary: "A named signal entering the circuit.",
    params: [labelParam("A"), bussedParam, widthParam(4)],
    build: (id, v) => {
      const bus = pBool(v, "bussed", false);
      const bits = pInt(v, "bits", 4);
      const block = C.input(id, pStr(v, "label", "A"));
      return bus
        ? { ...block, ports: block.ports.map((p) => ({ ...p, width: bits })) }
        : block;
    },
  },
  {
    id: "output",
    name: "Output",
    category: "io",
    summary: "A named signal leaving the circuit.",
    params: [labelParam("F"), bussedParam, widthParam(4)],
    build: (id, v) => {
      const bus = pBool(v, "bussed", false);
      const bits = pInt(v, "bits", 4);
      const block = C.output(id, pStr(v, "label", "F"));
      return bus
        ? { ...block, ports: block.ports.map((p) => ({ ...p, width: bits })) }
        : block;
    },
  },
  {
    id: "constant",
    name: "Constant",
    category: "io",
    summary: "A tie-off to +5V or GND. A logic 1 is a real component.",
    params: [
      {
        key: "value",
        label: "Level",
        kind: "choice",
        choices: [
          { value: "1", label: "+5V (logic 1)" },
          { value: "0", label: "GND (logic 0)" },
        ],
        initial: "1",
      },
    ],
    build: (id, v) => C.constant(id, pStr(v, "value", "1") === "1" ? 1 : 0),
  },
  {
    id: "clock",
    name: "Clock",
    category: "io",
    summary: "The system clock, for sequential blocks.",
    params: [labelParam("CLK")],
    build: (id, v) => C.input(id, pStr(v, "label", "CLK")),
  },
  {
    id: "node",
    name: "Junction",
    category: "io",
    summary:
      "A dot on the sheet. Joins two points that are not pins, and gives a long wire a corner to turn at.",
    params: [],
    build: (id) => C.junction(id),
  },
  {
    id: "note",
    name: "Annotation",
    category: "io",
    summary: "Free text with no body and no pins.",
    params: [labelParam("note")],
    build: (id, v) => C.note(id, pStr(v, "label", "note")),
  },

  // --- gates ----------------------------------------------------------------
  {
    id: "gate",
    name: "Logic gate",
    category: "gate",
    summary: "AND, OR, NAND, NOR, XOR, XNOR, NOT or buffer, 2 to 8 inputs.",
    params: [
      {
        key: "op",
        label: "Function",
        kind: "choice",
        choices: [...GATE_OPS],
        initial: "and",
      },
      {
        key: "inputs",
        label: "Inputs",
        kind: "int",
        min: 2,
        max: 8,
        initial: 2,
        hint: "NOT and buffer always take exactly one.",
      },
      { key: "title", label: "Label under the gate", kind: "text", initial: "" },
    ],
    build: (id, v) =>
      C.gate(
        id,
        pStr(v, "op", "and") as Parameters<typeof C.gate>[1],
        pInt(v, "inputs", 2),
        pStr(v, "title", ""),
      ),
  },
  {
    id: "tristate",
    name: "Tri-state buffer",
    category: "gate",
    summary: "Drives its output, or releases it to high impedance.",
    params: renameParams,
    build: (id, v) =>
      renamed(
        {
          id,
          kind: "box",
          title: "EN",
          subtitle: "tri-state buffer",
          tone: "gate",
          ports: [
            { id: "A", label: "A", side: "left", dir: "in" },
            { id: "OE", label: "OE", side: "top", dir: "in" },
            { id: "Y", label: "Y", side: "right", dir: "out" },
          ],
        },
        v,
      ),
  },

  // --- combinational --------------------------------------------------------
  {
    id: "decoder",
    name: "Decoder",
    category: "combinational",
    summary: "n address lines in, exactly one of 2^n outputs active.",
    params: [
      { key: "addr", label: "Address lines", kind: "int", min: 1, max: 4, initial: 2 },
      { key: "enable", label: "Enable input", kind: "bool", initial: true },
      { key: "enableLow", label: "Enable is active low", kind: "bool", initial: false },
      { key: "outputsLow", label: "Outputs are active low", kind: "bool", initial: false },
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(
        C.decoder(id, pInt(v, "addr", 2), {
          enable: pBool(v, "enable", true),
          enableActiveLow: pBool(v, "enableLow", false),
          outputsActiveLow: pBool(v, "outputsLow", false),
        }),
        v,
      ),
  },
  {
    id: "demux",
    name: "Demultiplexer",
    category: "combinational",
    summary: "One data line routed to one of 2^n outputs. A decoder with its enable fed data.",
    params: [
      { key: "sel", label: "Select lines", kind: "int", min: 1, max: 4, initial: 2 },
      { key: "enable", label: "Enable input", kind: "bool", initial: false },
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(C.demux(id, pInt(v, "sel", 2), { enable: pBool(v, "enable", false) }), v),
  },
  {
    id: "mux",
    name: "Multiplexer",
    category: "combinational",
    summary: "2^n data inputs, n select lines, one output. Universal on its own.",
    params: [
      { key: "sel", label: "Select lines", kind: "int", min: 1, max: 4, initial: 2 },
      { key: "enable", label: "Enable input", kind: "bool", initial: false },
      { key: "complement", label: "Complement output too", kind: "bool", initial: false },
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(
        C.mux(id, pInt(v, "sel", 2), {
          enable: pBool(v, "enable", false),
          complementOutput: pBool(v, "complement", false),
        }),
        v,
      ),
  },
  {
    id: "encoder",
    name: "Encoder",
    category: "combinational",
    summary: "2^n inputs to an n-bit code. Add priority to survive two at once.",
    params: [
      { key: "out", label: "Output bits", kind: "int", min: 1, max: 4, initial: 2 },
      { key: "priority", label: "Priority encoder", kind: "bool", initial: false },
      { key: "valid", label: "Valid output", kind: "bool", initial: false },
      { key: "enable", label: "Enable input", kind: "bool", initial: false },
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(
        C.encoder(id, pInt(v, "out", 2), {
          priority: pBool(v, "priority", false),
          validOutput: pBool(v, "valid", false),
          enable: pBool(v, "enable", false),
        }),
        v,
      ),
  },
  {
    id: "comparator",
    name: "Comparator",
    category: "combinational",
    summary: "Equality, or the full A>B / A=B / A<B set.",
    params: [
      widthParam(4),
      { key: "magnitude", label: "Magnitude (>, =, <)", kind: "bool", initial: false },
      bussedParam,
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(
        C.comparator(id, pInt(v, "bits", 4), {
          magnitude: pBool(v, "magnitude", false),
          bussed: pBool(v, "bussed", false),
        }),
        v,
      ),
  },
  {
    id: "parity",
    name: "Parity generator",
    category: "combinational",
    summary: "Even and odd parity of an n-bit word.",
    params: [widthParam(8), ...renameParams],
    build: (id, v) => {
      const bits = pInt(v, "bits", 8);
      return renamed(
        {
          id,
          kind: "box",
          title: `${bits}-bit parity`,
          subtitle: "generator / checker",
          tone: "msi",
          ports: [
            { id: "D", label: `D${bits - 1}..D0`, side: "left", dir: "in", width: bits },
            { id: "EVEN", label: "ΣEVEN", side: "right", dir: "out" },
            { id: "ODD", label: "ΣODD", side: "right", dir: "out" },
          ],
        },
        v,
      );
    },
  },

  // --- arithmetic -----------------------------------------------------------
  {
    id: "halfadder",
    name: "Half adder",
    category: "arithmetic",
    summary: "Sum and carry of two bits.",
    params: renameParams,
    build: (id, v) => renamed(C.halfAdder(id), v),
  },
  {
    id: "fulladder",
    name: "Full adder",
    category: "arithmetic",
    summary: "Two bits plus a carry-in.",
    params: renameParams,
    build: (id, v) => renamed(C.fullAdder(id), v),
  },
  {
    id: "adder",
    name: "Parallel adder",
    category: "arithmetic",
    summary: "An n-bit adder with carry-in and carry-out.",
    params: [widthParam(4), bussedParam, ...renameParams],
    build: (id, v) =>
      renamed(C.adder(id, pInt(v, "bits", 4), { bussed: pBool(v, "bussed", false) }), v),
  },
  {
    id: "alu",
    name: "ALU",
    category: "arithmetic",
    summary: "An arithmetic and logic unit with a function select.",
    params: [
      widthParam(4),
      { key: "sel", label: "Function select lines", kind: "int", min: 1, max: 5, initial: 3 },
      ...renameParams,
    ],
    build: (id, v) => {
      const bits = pInt(v, "bits", 4);
      const sel = pInt(v, "sel", 3);
      return renamed(
        {
          id,
          kind: "box",
          title: `${bits}-bit ALU`,
          subtitle: "arithmetic / logic",
          tone: "arith",
          ports: [
            { id: "A", label: `A${bits - 1}..A0`, side: "left", dir: "in", width: bits },
            { id: "B", label: `B${bits - 1}..B0`, side: "left", dir: "in", width: bits },
            { id: "Cin", label: "Cin", side: "left", dir: "in", gapBefore: true },
            ...Array.from({ length: sel }, (_, i) => ({
              id: `S${sel - 1 - i}`,
              label: `S${sel - 1 - i}`,
              side: "bottom" as Side,
              dir: "in" as const,
            })),
            { id: "F", label: `F${bits - 1}..F0`, side: "right", dir: "out", width: bits },
            { id: "Cout", label: "Cout", side: "right", dir: "out", gapBefore: true },
            { id: "Z", label: "ZERO", side: "right", dir: "out" },
          ],
        },
        v,
      );
    },
  },
  {
    id: "shifter",
    name: "Shifter",
    category: "arithmetic",
    summary: "A barrel shifter — shift or rotate by a variable amount.",
    params: [widthParam(8), ...renameParams],
    build: (id, v) => {
      const bits = pInt(v, "bits", 8);
      const sel = Math.max(1, Math.ceil(Math.log2(bits)));
      return renamed(
        {
          id,
          kind: "box",
          title: `${bits}-bit shifter`,
          subtitle: "barrel shift / rotate",
          tone: "arith",
          ports: [
            { id: "D", label: `D${bits - 1}..D0`, side: "left", dir: "in", width: bits },
            { id: "DIR", label: "L/R", side: "left", dir: "in", gapBefore: true },
            ...Array.from({ length: sel }, (_, i) => ({
              id: `S${sel - 1 - i}`,
              label: `S${sel - 1 - i}`,
              side: "bottom" as Side,
              dir: "in" as const,
            })),
            { id: "Q", label: `Q${bits - 1}..Q0`, side: "right", dir: "out", width: bits },
          ],
        },
        v,
      );
    },
  },

  // --- sequential -----------------------------------------------------------
  {
    id: "flipflop",
    name: "Flip-flop",
    category: "sequential",
    summary: "D, JK, T or SR. Clock on the underside, clear on top.",
    params: [
      {
        key: "type",
        label: "Type",
        kind: "choice",
        choices: [
          { value: "d", label: "D — stores a value" },
          { value: "jk", label: "JK — set, reset or toggle" },
          { value: "t", label: "T — toggles" },
          { value: "sr", label: "SR — set / reset" },
        ],
        initial: "d",
      },
      { key: "complement", label: "Q' output", kind: "bool", initial: true },
      { key: "clear", label: "Asynchronous clear", kind: "bool", initial: true },
      { key: "preset", label: "Asynchronous preset", kind: "bool", initial: false },
      { key: "negedge", label: "Negative-edge triggered", kind: "bool", initial: false },
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(
        C.flipFlop(id, pStr(v, "type", "d") as C.FlipFlopType, {
          complement: pBool(v, "complement", true),
          clear: pBool(v, "clear", true),
          preset: pBool(v, "preset", false),
          negativeEdge: pBool(v, "negedge", false),
        }),
        v,
      ),
  },
  {
    id: "latch",
    name: "D latch",
    category: "sequential",
    summary: "Level-triggered — transparent while the enable is high.",
    params: renameParams,
    build: (id, v) =>
      renamed(
        {
          id,
          kind: "box",
          title: "D latch",
          subtitle: "level-triggered",
          tone: "seq",
          ports: [
            { id: "D", label: "D", side: "left", dir: "in" },
            { id: "EN", label: "EN", side: "bottom", dir: "in" },
            { id: "Q", label: "Q", side: "right", dir: "out" },
            { id: "QN", label: "Q'", side: "right", dir: "out" },
          ],
        },
        v,
      ),
  },
  {
    id: "register",
    name: "Register",
    category: "sequential",
    summary: "n flip-flops loaded in parallel on one clock.",
    params: [widthParam(4), bussedParam, ...renameParams],
    build: (id, v) =>
      renamed(
        C.register(id, pInt(v, "bits", 4), { bussed: pBool(v, "bussed", false) }),
        v,
      ),
  },
  {
    id: "shiftregister",
    name: "Shift register",
    category: "sequential",
    summary: "Serial in, parallel out — the other way to do serial-to-parallel.",
    params: [
      widthParam(4),
      { key: "serialOut", label: "Serial output too", kind: "bool", initial: false },
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(
        C.shiftRegister(id, pInt(v, "bits", 4), {
          serialOut: pBool(v, "serialOut", false),
        }),
        v,
      ),
  },
  {
    id: "counter",
    name: "Counter",
    category: "sequential",
    summary: "A binary counter, with optional load, clear, enable and ripple carry.",
    params: [
      widthParam(4),
      { key: "enable", label: "Count enable", kind: "bool", initial: false },
      { key: "load", label: "Parallel load", kind: "bool", initial: false },
      { key: "clear", label: "Clear", kind: "bool", initial: true },
      { key: "rco", label: "Ripple carry out", kind: "bool", initial: false },
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(
        C.counter(id, pInt(v, "bits", 4), {
          enable: pBool(v, "enable", false),
          load: pBool(v, "load", false),
          clear: pBool(v, "clear", true),
          rippleCarry: pBool(v, "rco", false),
        }),
        v,
      ),
  },

  // --- memory ---------------------------------------------------------------
  {
    id: "memory",
    name: "Memory",
    category: "memory",
    summary: "A RAM or ROM chip. Address pins follow from the word count.",
    params: [
      {
        key: "kind",
        label: "Type",
        kind: "choice",
        choices: [
          { value: "ram", label: "RAM — read and write" },
          { value: "rom", label: "ROM — read only" },
        ],
        initial: "ram",
      },
      { key: "words", label: "Words", kind: "int", min: 2, max: 1048576, initial: 1024 },
      { key: "bits", label: "Bits per word", kind: "int", min: 1, max: 64, initial: 8 },
      { key: "csLow", label: "Chip select is active low", kind: "bool", initial: true },
      { key: "oe", label: "Output enable", kind: "bool", initial: false },
      { key: "bussed", label: "Draw the address as a bus", kind: "bool", initial: true },
      ...renameParams,
    ],
    build: (id, v) =>
      renamed(
        C.memory(id, pInt(v, "words", 1024), pInt(v, "bits", 8), {
          kind: pStr(v, "kind", "ram") === "rom" ? "rom" : "ram",
          bussed: pBool(v, "bussed", true),
          chipSelectActiveLow: pBool(v, "csLow", true),
          outputEnable: pBool(v, "oe", false),
        }),
        v,
      ),
  },

  // --- the escape hatch -----------------------------------------------------
  {
    id: "generic",
    name: "Custom block",
    category: "custom",
    summary:
      "A box you name yourself, with the pins you list. For anything this palette does not have.",
    params: [
      { key: "title", label: "Title", kind: "text", initial: "BLOCK" },
      { key: "subtitle", label: "Subtitle", kind: "text", initial: "" },
      {
        key: "left",
        label: "Left pins (inputs)",
        kind: "text",
        initial: "A, B",
        hint: "Comma separated. Suffix a pin with ' to give it an inversion bubble.",
      },
      { key: "right", label: "Right pins (outputs)", kind: "text", initial: "Y" },
      { key: "top", label: "Top pins", kind: "text", initial: "" },
      { key: "bottom", label: "Bottom pins", kind: "text", initial: "" },
      {
        key: "tone",
        label: "Colour category",
        kind: "choice",
        choices: [
          { value: "msi", label: "MSI block" },
          { value: "arith", label: "Arithmetic" },
          { value: "seq", label: "Sequential" },
          { value: "memory", label: "Memory" },
          { value: "gate", label: "Gate" },
          { value: "bus", label: "Bus" },
        ],
        initial: "msi",
      },
    ],
    build: (id, v) => ({
      id,
      kind: "box",
      title: pStr(v, "title", "BLOCK"),
      ...(pStr(v, "subtitle", "") ? { subtitle: pStr(v, "subtitle", "") } : {}),
      tone: pStr(v, "tone", "msi") as BlockTone,
      ports: [
        ...pinList(pStr(v, "left", ""), "left", "in"),
        ...pinList(pStr(v, "right", ""), "right", "out"),
        ...pinList(pStr(v, "top", ""), "top", "in"),
        ...pinList(pStr(v, "bottom", ""), "bottom", "in"),
      ],
    }),
  },
];

/**
 * Parse a comma-separated pin list.
 *
 * A trailing apostrophe means active low, because that is how everybody writes
 * it by hand and it saves a checkbox per pin. Duplicate names are suffixed
 * rather than dropped: two pins with the same id would make one of them
 * unwireable, and silently losing a pin somebody typed is worse than showing
 * them `EN` and `EN~2`.
 */
export function pinList(text: string, side: Side, dir: "in" | "out"): Port[] {
  const seen = new Map<string, number>();
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((raw) => {
      const activeLow = raw.endsWith("'");
      const label = activeLow ? raw.slice(0, -1) : raw;
      const count = (seen.get(label) ?? 0) + 1;
      seen.set(label, count);
      const id = count === 1 ? label : `${label}~${count}`;
      return {
        id,
        label: count === 1 ? label : `${label}`,
        side,
        dir,
        ...(activeLow ? { activeLow: true } : {}),
      };
    });
}

export const getPart = (id: string): PartDefinition | undefined =>
  PARTS.find((p) => p.id === id);

export const partDefaults = (part: PartDefinition): PartValues =>
  Object.fromEntries(part.params.map((p) => [p.key, p.initial]));

export const CATEGORY_LABELS: Readonly<Record<PartCategory, string>> = {
  io: "Inputs & outputs",
  gate: "Gates",
  combinational: "Combinational",
  arithmetic: "Arithmetic",
  sequential: "Sequential",
  memory: "Memory",
  custom: "Custom",
};

export const CATEGORY_ORDER: readonly PartCategory[] = [
  "io",
  "gate",
  "combinational",
  "arithmetic",
  "sequential",
  "memory",
  "custom",
];
