import { parseInput } from "./canonical";
import { kmapLayout, kmapLoops, MAX_KMAP_VARIABLES, type KMapLayout, type KMapLoop } from "./kmap";
import { minimize, type Minimization } from "./minimizer";
import { err, ok, type BooleanFunction, type EngineResult } from "./types";

export * from "./types";
export * from "./ast";
export * from "./canonical";
export * from "./format";
export * from "./kmap";
export * from "./minimizer";
export { parse } from "./parser";
export { evaluate, truthVector } from "./evaluate";

/**
 * The single entry point the UI (and the Web Worker) calls. Everything the
 * theory workspace renders comes out of one `analyze` call, so there is exactly
 * one place where the function is parsed and exactly one place where it is
 * minimized — no component gets to re-derive its own version.
 */
export interface Analysis {
  readonly fn: BooleanFunction;
  readonly sop: Minimization;
  readonly pos: Minimization;
  /** Null above 4 variables, where a K-map stops being a useful drawing. */
  readonly layout: KMapLayout | null;
  readonly loops: {
    /** Groups of 1s. */
    readonly sop: readonly KMapLoop[];
    /** Groups of 0s — the POS cover is a cover of the *complement*. */
    readonly pos: readonly KMapLoop[];
  };
}

export function analyze(
  source: string,
  variables?: readonly string[],
): EngineResult<Analysis> {
  const parsed = parseInput(source, variables);
  if (!parsed.ok) return err(parsed.diagnostics);

  const fn = parsed.value;
  const sop = minimize(fn, "sop");
  const pos = minimize(fn, "pos");

  const layout =
    fn.variables.length <= MAX_KMAP_VARIABLES ? kmapLayout(fn.variables) : null;

  return ok(
    {
      fn,
      sop,
      pos,
      layout,
      loops: {
        sop: layout ? kmapLoops(sop.cover, layout) : [],
        pos: layout ? kmapLoops(pos.cover, layout) : [],
      },
    },
    parsed.diagnostics,
  );
}
