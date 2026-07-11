import { analyze, type Analysis } from "@/lib/core-engine";
import { cubeLabel, cubePattern } from "@/lib/core-engine/minimizer";
import { format } from "@/lib/core-engine/format";
import { literalCount } from "@/lib/core-engine/ast";
import { canonicalSop, dontCares, minterms } from "@/lib/core-engine/canonical";
import { verify, type VerifyResult } from "@/lib/simulation/verify";
import { diagnose, type Diagnostic } from "@/lib/simulation/diagnostics";
import { elaborate } from "@/lib/simulation/elaborate";
import { evaluate } from "@/lib/simulation/solver";
import { simulateTimed, type TimedResult } from "@/lib/simulation/timing";
import { compareStrategies, describeDesign, synthesize } from "@/lib/simulation/synth";
import type { CircuitDocument } from "@/lib/simulation/netlist";
import type { BooleanFunction } from "@/lib/core-engine/types";

/**
 * Everything a lab report needs, assembled in one pure pass.
 *
 * This lives in `src/lib` deliberately. The report is not a screenshot of the UI
 * — it is a *derivation*, recomputed from the same engine the screen used, so it
 * cannot drift from what the student actually did. The page just renders it.
 */

export interface LabReport {
  readonly title: string;
  readonly source: string;
  readonly fn: BooleanFunction;
  readonly analysis: Analysis;

  /** The minimal SOP, spelled out. */
  readonly minimal: string;
  readonly canonicalLiterals: number;
  readonly minimalLiterals: number;

  /** Σm(…) + d(…) */
  readonly sigma: string;

  /** Every QM combining round, flattened for a table. */
  readonly qmColumns: readonly {
    readonly index: number;
    readonly groups: readonly {
      readonly ones: number;
      readonly rows: readonly {
        readonly pattern: string;
        readonly covers: string;
        readonly prime: boolean;
      }[];
    }[];
  }[];

  readonly primeImplicants: readonly {
    readonly label: string;
    readonly covers: readonly number[];
    readonly essential: boolean;
  }[];

  /** "Mixed gates: 3 ICs … / NAND-only: 2 ICs …" — the comparison IS the lesson. */
  readonly designs: readonly string[];
  readonly chosenDesign: string | null;

  readonly circuit: CircuitDocument | null;
  readonly onBoard: boolean;
  readonly billOfMaterials: readonly { readonly part: string; readonly count: number }[];

  readonly verification: VerifyResult | null;
  readonly faults: readonly Diagnostic[];
  readonly timing: TimedResult | null;
}

export function buildReport(
  source: string,
  circuit: CircuitDocument | null,
  title = "Digital Logic Lab Report",
): LabReport | null {
  const result = analyze(source);
  if (!result.ok) return null;

  const analysis = result.value;
  const { fn, sop } = analysis;

  const essentials = new Set(sop.trace.essentials.map((e) => cubeLabel(e.cube, fn.variables)));
  const n = fn.variables.length;

  const qmColumns = sop.trace.columns.map((col) => ({
    index: col.index,
    groups: col.groups.map((g) => ({
      ones: g.ones,
      rows: g.entries.map((e) => ({
        pattern: cubePattern(e.cube, n),
        covers: e.cube.covers.join(", "),
        prime: !e.combined && !e.isDontCareOnly,
      })),
    })),
  }));

  const primeImplicants = sop.trace.chart.rows.map((row) => ({
    label: row.label,
    covers: row.covers,
    essential: essentials.has(row.label),
  }));

  // Recompute the chip options from the same synthesizer the lab used.
  const gateNetlist = synthesize(sop.expression, fn.variables);
  const designs =
    gateNetlist.constant === null
      ? compareStrategies(gateNetlist).map(describeDesign)
      : [];

  // --- what the student actually built -------------------------------------
  let verification: VerifyResult | null = null;
  let faults: Diagnostic[] = [];
  let timing: TimedResult | null = null;
  let bom: { part: string; count: number }[] = [];
  let chosenDesign: string | null = null;

  if (circuit && Object.keys(circuit.nodes).length > 0) {
    const { index, netlist } = elaborate(circuit);
    const live = evaluate(
      netlist,
      netlist.inputs.map((p) => {
        const node = circuit.nodes[p.node];
        return node?.kind === "switch" ? node.state : (0 as const);
      }),
    );
    faults = diagnose(circuit, index, netlist, live);
    verification = verify(circuit, fn);
    timing = simulateTimed(netlist);

    const counts = new Map<string, number>();
    for (const node of Object.values(circuit.nodes)) {
      if (node.kind !== "ic") continue;
      counts.set(node.part, (counts.get(node.part) ?? 0) + 1);
    }
    bom = [...counts.entries()]
      .map(([part, count]) => ({ part, count }))
      .sort((a, b) => a.part.localeCompare(b.part));

    const total = bom.reduce((s, b) => s + b.count, 0);
    if (total > 0) {
      chosenDesign = `${total} IC${total === 1 ? "" : "s"} — ${bom
        .map((b) => (b.count > 1 ? `${b.count}× ${b.part}` : b.part))
        .join(", ")}`;
    }
  }

  return {
    title,
    source,
    fn,
    analysis,
    minimal: format(sop.expression),
    canonicalLiterals: literalCount(canonicalSop(fn)),
    minimalLiterals: sop.literals,
    sigma: sigmaOf(fn),
    qmColumns,
    primeImplicants,
    designs,
    chosenDesign,
    circuit,
    onBoard: !!circuit?.board,
    billOfMaterials: bom,
    verification,
    faults,
    timing,
  };
}

function sigmaOf(fn: BooleanFunction): string {
  const ms = minterms(fn);
  const ds = dontCares(fn);
  const head = `${fn.name}(${fn.variables.join(", ")}) = Σm(${ms.join(", ")})`;
  return ds.length > 0 ? `${head} + d(${ds.join(", ")})` : head;
}
