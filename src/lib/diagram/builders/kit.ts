import {
  fromMinterms,
  type BooleanFunction,
} from "@/lib/core-engine";
import type { Block, Diagram, Endpoint, Link, TimingChart } from "../types";

/**
 * A scratchpad for assembling a diagram.
 *
 * Every builder in this directory does the same three things — make a block,
 * remember its id, wire a port to a port — and doing that with array literals
 * produces code where a single mistyped id becomes a silently missing wire. So
 * blocks are added through one method that hands back the id, and `wire()` takes
 * those ids, which makes most typos a `undefined` at build time instead of a
 * wrong picture at read time.
 */
export class Sketch {
  private readonly blocks: Block[] = [];
  private readonly links: Link[] = [];
  private readonly notes: string[] = [];
  private seq = 0;

  add<T extends Block>(block: T): string {
    this.blocks.push(block);
    return block.id;
  }

  /** A unique id with a readable prefix, for generated blocks. */
  uid(prefix: string): string {
    return `${prefix}${this.seq++}`;
  }

  wire(from: Endpoint, to: Endpoint, extra: Omit<Link, "id" | "from" | "to"> = {}): void {
    this.links.push({
      id: `l${this.links.length}:${from.block}.${from.port}>${to.block}.${to.port}`,
      from,
      to,
      ...extra,
    });
  }

  note(text: string): void {
    this.notes.push(text);
  }

  has(id: string): boolean {
    return this.blocks.some((b) => b.id === id);
  }

  done(meta: {
    id: string;
    title: string;
    caption?: string;
    timing?: TimingChart;
  }): Diagram {
    return {
      id: meta.id,
      title: meta.title,
      ...(meta.caption !== undefined ? { caption: meta.caption } : {}),
      ...(meta.timing !== undefined ? { timing: meta.timing } : {}),
      blocks: this.blocks,
      links: this.links,
      ...(this.notes.length > 0 ? { notes: this.notes } : {}),
    };
  }
}

export const at = (block: string, port: string): Endpoint => ({ block, port });

/**
 * "a" or "an", chosen by how the NUMBER is spoken, not by its first digit.
 *
 * These strings are all generated — "a 8-to-1 multiplexer" is what you get from
 * naive interpolation, and it appears in the FIGURE TITLE, which is the one line
 * of a diagram everybody reads. Eight, eleven and eighteen are the only leading
 * numerals in this range that begin with a vowel sound.
 */
export const article = (n: number): "a" | "an" => {
  const lead = String(n);
  return lead === "8" ||
    lead === "11" ||
    lead === "18" ||
    lead.startsWith("8") ||
    lead.startsWith("11") ||
    lead.startsWith("18")
    ? "an"
    : "a";
};


// --- functions --------------------------------------------------------------

/**
 * A function, the way an exam question states one: a name, its variables, and
 * the rows where it is 1.
 *
 * Deliberately minterm-shaped rather than expression-shaped. Every question in
 * this catalogue is ultimately "here are the rows" — divisible by 3 or 5, prime,
 * the square of the input — and computing the row set with a predicate is both
 * how the student should think about it and the only version that stays correct
 * when the width changes.
 */
export interface FunctionSpec {
  readonly name: string;
  readonly variables: readonly string[];
  readonly minterms: readonly number[];
  readonly dontCares?: readonly number[];
}

export function toFunction(spec: FunctionSpec): BooleanFunction {
  const built = fromMinterms(
    spec.variables,
    spec.minterms,
    spec.dontCares ?? [],
    spec.name,
  );
  if (!built.ok) {
    throw new Error(
      `Bad function spec ${spec.name}: ${built.diagnostics.map((d) => d.message).join("; ")}`,
    );
  }
  return built.value;
}

/** Rows where `predicate(value)` holds, for an n-bit unsigned input. */
export const mintermsWhere = (
  bits: number,
  predicate: (value: number) => boolean,
): number[] => {
  const out: number[] = [];
  for (let m = 0; m < 1 << bits; m++) if (predicate(m)) out.push(m);
  return out;
};

/**
 * Split an n-bit output function of an m-bit input into one FunctionSpec per
 * output bit.
 *
 * This is the shape of half the questions in the assignment — "generate the
 * square of a 3-bit number", "generate the 2's complement" — and every one of
 * them is the same operation: apply the map to all 2^m inputs, then read out one
 * output column at a time. `variables[0]` is the MSB, matching the core engine's
 * contract, and so is bit 0 of the OUTPUT the least significant.
 */
export function bitwiseSpecs(
  inputBits: number,
  inputVariables: readonly string[],
  map: (value: number) => number,
  outputBits: number,
  outputName: string,
): FunctionSpec[] {
  const specs: FunctionSpec[] = [];
  for (let bit = outputBits - 1; bit >= 0; bit--) {
    const minterms: number[] = [];
    for (let m = 0; m < 1 << inputBits; m++) {
      if ((map(m) >>> bit) & 1) minterms.push(m);
    }
    specs.push({
      name: `${outputName}${bit}`,
      variables: inputVariables,
      minterms,
    });
  }
  return specs;
}
