import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  evalGate,
  resolveNet,
  resolvePair,
  L0,
  L1,
  LX,
  LZ,
  type Driver,
  type GateOp,
  type Logic,
} from "./logic";

const ALL: Logic[] = [L0, L1, LZ, LX];
const NAME = ["0", "1", "Z", "X"] as const;

describe("resolution table", () => {
  it("matches the table exactly", () => {
    // rows/cols in order 0, 1, Z, X
    const expected: Logic[][] = [
      [L0, LX, L0, LX],
      [LX, L1, L1, LX],
      [L0, L1, LZ, LX],
      [LX, LX, LX, LX],
    ];
    for (const a of ALL) {
      for (const b of ALL) {
        expect(resolvePair(a, b), `${NAME[a]} vs ${NAME[b]}`).toBe(
          expected[a]![b],
        );
      }
    }
  });

  it("makes 0 against 1 a short", () => {
    expect(resolvePair(L0, L1)).toBe(LX);
  });

  it("treats Z as the identity — a floating driver contributes nothing", () => {
    for (const a of ALL) expect(resolvePair(a, LZ)).toBe(a);
  });

  // Commutativity and associativity are what make the solver's answer independent
  // of the order it happens to visit a net's drivers in.
  it("is commutative and associative", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL), { minLength: 1, maxLength: 5 }),
        (values) => {
          const drivers: Driver[] = values.map((value) => ({
            value,
            strength: "strong",
          }));
          const forward = resolveNet(drivers);
          const backward = resolveNet([...drivers].reverse());
          expect(backward).toBe(forward);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("resolveNet — strength", () => {
  it("returns Z when nothing drives the net — a floating net is not a 0", () => {
    expect(resolveNet([])).toBe(LZ);
    expect(resolveNet([{ value: L1, strength: "hiz" }])).toBe(LZ);
  });

  it("lets a strong output beat a pull resistor without complaint", () => {
    expect(
      resolveNet([
        { value: L1, strength: "pull" },
        { value: L0, strength: "strong" },
      ]),
    ).toBe(L0);
  });

  // The decisive one. If Vcc silently overrode a gate output, then wiring an
  // output to +5V would resolve to a clean 1 and LOOK LIKE A WORKING CIRCUIT —
  // while being a dead short that destroys the chip.
  it("does NOT let a supply rail quietly win against a conflicting output", () => {
    expect(
      resolveNet([
        { value: L1, strength: "supply" },
        { value: L0, strength: "strong" },
      ]),
    ).toBe(LX);
  });

  it("makes two conflicting outputs an X, which is how a short is detected", () => {
    expect(
      resolveNet([
        { value: L0, strength: "strong" },
        { value: L1, strength: "strong" },
      ]),
    ).toBe(LX);
  });
});

describe("gate tables — all 16 cells of every 2-input op", () => {
  // Controlling values are the whole point. AND(0, X) = 0, because a 0 forces
  // the output no matter what the other input is doing. If X were unconditionally
  // contagious, one floating pin would turn the entire board red and the
  // diagnostic would be worthless.
  const table: Record<string, Logic[][]> = {
    //           b=0  b=1  b=Z  b=X          a
    and: [
      [L0, L0, L0, L0], // 0  <- 0 is controlling: forces 0 even against X
      [L0, L1, LX, LX], // 1
      [L0, LX, LX, LX], // Z
      [L0, LX, LX, LX], // X
    ],
    or: [
      [L0, L1, LX, LX], // 0
      [L1, L1, L1, L1], // 1  <- 1 is controlling
      [LX, L1, LX, LX], // Z
      [LX, L1, LX, LX], // X
    ],
    // XOR has NO controlling value — every input matters, so any unknown wins.
    xor: [
      [L0, L1, LX, LX],
      [L1, L0, LX, LX],
      [LX, LX, LX, LX],
      [LX, LX, LX, LX],
    ],
  };

  for (const [op, expected] of Object.entries(table)) {
    it(op, () => {
      for (const a of ALL) {
        for (const b of ALL) {
          expect(evalGate(op as GateOp, [a, b]), `${op}(${NAME[a]},${NAME[b]})`).toBe(
            expected[a]![b],
          );
        }
      }
    });
  }

  it("nand / nor / xnor are exactly their inverses, X staying X", () => {
    const inv = (v: Logic): Logic => (v === L0 ? L1 : v === L1 ? L0 : LX);
    for (const a of ALL) {
      for (const b of ALL) {
        expect(evalGate("nand", [a, b])).toBe(inv(evalGate("and", [a, b])));
        expect(evalGate("nor", [a, b])).toBe(inv(evalGate("or", [a, b])));
        expect(evalGate("xnor", [a, b])).toBe(inv(evalGate("xor", [a, b])));
      }
    }
  });
});

describe("Z never becomes 0", () => {
  // THE RULE. If Z coerces to falsy anywhere — a gate table, a stray !!value, an
  // LED renderer — the product's core feature dies silently. And the physics is
  // counterintuitive: a floating TTL input actually floats HIGH, so defaulting
  // to 0 is the single worst guess available.
  it("reads a floating gate input as unknown, not as low", () => {
    expect(evalGate("not", [LZ])).toBe(LX);
    expect(evalGate("buf", [LZ])).toBe(LX);
    expect(evalGate("and", [L1, LZ])).toBe(LX);
    expect(evalGate("or", [L0, LZ])).toBe(LX);
    expect(evalGate("xor", [L0, LZ])).toBe(LX);
  });

  it("still lets a controlling value override a floating one", () => {
    expect(evalGate("and", [L0, LZ])).toBe(L0);
    expect(evalGate("or", [L1, LZ])).toBe(L1);
  });
});

describe("n-ary gates", () => {
  it("folds any arity", () => {
    expect(evalGate("and", [L1, L1, L1])).toBe(L1);
    expect(evalGate("and", [L1, L0, L1])).toBe(L0);
    expect(evalGate("or", [L0, L0, L1])).toBe(L1);
    expect(evalGate("xor", [L1, L1, L1])).toBe(L1); // parity
    expect(evalGate("nand", [L1, L1, L1])).toBe(L0);
  });
});
