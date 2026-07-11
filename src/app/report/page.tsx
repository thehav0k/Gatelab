"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Printer, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KMapGrid } from "@/components/theory/kmap-grid";
import { TruthTable } from "@/components/theory/truth-table";
import { CircuitCanvas } from "@/components/lab/circuit-canvas";
import { BreadboardView } from "@/components/lab/breadboard-view";
import { useCircuitStore } from "@/stores/circuit-store";
import { useSpecStore } from "@/stores/spec-store";
import { buildReport, type LabReport } from "@/lib/report";
import { LOGIC_NAMES, type Logic } from "@/lib/simulation/logic";
import { DONT_CARE } from "@/lib/core-engine/types";
import { cn } from "@/lib/utils";

/**
 * The lab report.
 *
 * Printed through the BROWSER'S OWN PDF ENGINE — a /report route, an @media print
 * stylesheet, and window.print(). That keeps the circuit, the K-map, and the
 * waveform as real VECTORS in the output, and costs zero dependencies.
 *
 * The alternative everyone reaches for — jsPDF plus html2canvas — adds about a
 * megabyte to the bundle in order to rasterize a vector drawing into a blurry
 * bitmap and then paste that bitmap into a PDF. For a document whose entire
 * content is line art and text, that is strictly worse in every dimension.
 */
export default function ReportPage() {
  const source = useSpecStore((s) => s.source);
  const doc = useCircuitStore((s) => s.doc);

  const report = useMemo(() => {
    if (!source) return null;
    const hasCircuit = Object.keys(doc.nodes).length > 0;
    return buildReport(source, hasCircuit ? doc : null);
  }, [source, doc]);

  if (!report) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Nothing to report yet</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Minimize a function in the{" "}
          <Link href="/theory" className="text-foreground underline underline-offset-4">
            theory workspace
          </Link>{" "}
          and build its circuit, and this page will assemble the whole derivation —
          truth table, K-map, Quine–McCluskey trace, the board you built, and the
          verification against your algebra.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      <div className="no-print mb-6 flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Everything below is recomputed from the engine — it is a derivation, not
          a screenshot.
        </p>
        <Button onClick={() => window.print()}>
          <Printer /> Print / Save as PDF
        </Button>
      </div>

      <Report report={report} />
    </div>
  );
}

function Report({ report }: { report: LabReport }) {
  const { fn, analysis, verification } = report;
  const layout = analysis.layout;
  const loops = analysis.loops.sop;

  return (
    <article className="space-y-8 text-sm">
      {/* --- header ---------------------------------------------------------- */}
      <header className="print-section border-b pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{report.title}</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">{report.sigma}</p>
      </header>

      {/* --- 1. the problem -------------------------------------------------- */}
      <Section n={1} title="The function">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
          <Field label="As entered">
            <code>{report.source}</code>
          </Field>
          <Field label="Variables">
            <code>
              {fn.variables.join(", ")} ({fn.variables.length} → {fn.values.length} rows)
            </code>
          </Field>
          <Field label="Canonical SOP">
            <span className="text-muted-foreground">
              {report.canonicalLiterals} literals
            </span>
          </Field>
          <Field label="Minimal SOP">
            <code className="font-semibold">{report.minimal}</code>{" "}
            <span className="text-muted-foreground">
              — {report.minimalLiterals} literals (
              <span className="text-logic-high">
                {report.canonicalLiterals - report.minimalLiterals} fewer
              </span>
              )
            </span>
          </Field>
        </dl>
      </Section>

      {/* --- 2. truth table + K-map ------------------------------------------ */}
      <Section n={2} title="Truth table and Karnaugh map">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <TruthTable fn={fn} />
          </div>
          <div>
            {layout ? (
              <>
                <KMapGrid
                  fn={fn}
                  layout={layout}
                  loops={loops}
                  highlighted={null}
                  onHighlight={() => {}}
                />
                <ul className="mt-3 space-y-1 text-xs">
                  {loops.map((loop) => (
                    <li key={loop.label} className="flex items-center gap-2">
                      <span
                        className="size-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: `var(--loop-${loop.colorIndex + 1})` }}
                      />
                      <code>{loop.label}</code>
                      <span className="text-muted-foreground">
                        {loop.cells.length} cells
                        {loop.eliminated.length > 0 && (
                          <> · {loop.eliminated.join(", ")} cancel out</>
                        )}
                        {loop.wraps && <> · wraps</>}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">
                A K-map is not drawn above 4 variables. The tabular reduction below
                still applies.
              </p>
            )}
          </div>
        </div>
        <p className="text-muted-foreground mt-4 text-xs">
          The loops are not drawn by a second algorithm — they{" "}
          <em>are</em> the prime implicants found below, rendered onto the grid.
        </p>
      </Section>

      {/* --- 3. QM ----------------------------------------------------------- */}
      <Section n={3} title="Quine–McCluskey reduction" breakBefore>
        <div className="space-y-5">
          {report.qmColumns.map((col) => (
            <div key={col.index}>
              <h3 className="mb-2 font-medium">
                {col.index === 0
                  ? "Column 1 — group the minterms by number of 1s"
                  : `Column ${col.index + 1} — combine terms differing in one bit`}
              </h3>
              <div className="flex flex-wrap gap-4">
                {col.groups.map((g) => (
                  <div key={g.ones}>
                    <div className="text-muted-foreground mb-1 text-xs">
                      {g.ones} one{g.ones === 1 ? "" : "s"}
                    </div>
                    <div className="space-y-1">
                      {g.rows.map((row, i) => (
                        <div
                          key={i}
                          className={cn(
                            "rounded border px-2 py-0.5 font-mono text-xs",
                            row.prime && "border-logic-high/60 bg-logic-high/10",
                          )}
                        >
                          {row.pattern}
                          <span className="text-muted-foreground ml-2">
                            {row.covers}
                          </span>
                          {row.prime && <span className="text-logic-high ml-1.5">✓</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div>
            <h3 className="mb-2 font-medium">Prime implicant chart</h3>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1" />
                  {analysis.sop.trace.chart.columns.map((m) => (
                    <th key={m} className="text-muted-foreground px-2 py-1 font-mono font-normal">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.primeImplicants.map((pi) => (
                  <tr key={pi.label} className="border-t">
                    <td className="px-2 py-1 font-mono whitespace-nowrap">
                      {pi.label}
                      {pi.essential && <span className="text-logic-high ml-1">★</span>}
                    </td>
                    {analysis.sop.trace.chart.columns.map((m) => (
                      <td key={m} className="px-2 py-1 text-center font-mono">
                        {pi.covers.includes(m) ? (
                          <span className="text-logic-high">×</span>
                        ) : (
                          <span className="text-muted-foreground/30">·</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground mt-2 text-xs">
              ★ = essential: the only implicant covering some minterm, so every cover
              must include it.
              {analysis.sop.trace.dontCares.length > 0 && (
                <>
                  {" "}
                  Don&apos;t-cares ({analysis.sop.trace.dontCares.join(", ")}) helped the
                  terms combine but are not columns here — nothing has to cover them.
                </>
              )}
            </p>
          </div>
        </div>
      </Section>

      {/* --- 4. implementation ----------------------------------------------- */}
      <Section n={4} title="Implementation" breakBefore>
        {report.designs.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-2 font-medium">Gate-family comparison</h3>
            <ul className="space-y-1 font-mono text-xs">
              {report.designs.map((d, i) => (
                <li key={d} className={cn(i === 0 && "font-semibold")}>
                  {d}
                  {i === 0 && (
                    <span className="text-logic-high ml-2 font-sans font-normal">
                      fewest chips
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.circuit ? (
          <>
            {report.chosenDesign && (
              <p className="mb-3">
                <span className="text-muted-foreground">Built with: </span>
                <span className="font-mono font-semibold">{report.chosenDesign}</span>
              </p>
            )}
            <div className="h-[420px] overflow-hidden rounded-md border print:h-[380px]">
              {report.onBoard ? <BreadboardView /> : <CircuitCanvas />}
            </div>
            {report.billOfMaterials.length > 0 && (
              <table className="mt-4 text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-1 text-left font-medium">Part</th>
                    <th className="px-3 py-1 text-left font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {report.billOfMaterials.map((b) => (
                    <tr key={b.part} className="border-b last:border-0">
                      <td className="px-3 py-1 font-mono">{b.part}</td>
                      <td className="px-3 py-1 font-mono">{b.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">No circuit was built.</p>
        )}
      </Section>

      {/* --- 5. verification -------------------------------------------------- */}
      {verification && (
        <Section n={5} title="Verification" breakBefore>
          {verification.error ? (
            <p className="text-muted-foreground">{verification.error}</p>
          ) : (
            <>
              <p
                className={cn(
                  "mb-3 font-medium",
                  verification.ok ? "text-logic-high" : "text-destructive",
                )}
              >
                {verification.ok
                  ? `The circuit matches ${fn.name} on all ${verification.rows.length} rows.`
                  : `The circuit differs from ${fn.name} on ${verification.mismatches.length} row${
                      verification.mismatches.length === 1 ? "" : "s"
                    }.`}
              </p>

              <table className="font-mono text-xs">
                <thead>
                  <tr className="border-b">
                    {verification.inputLabels.map((l) => (
                      <th key={l} className="px-3 py-1 text-left font-medium">
                        {l}
                      </th>
                    ))}
                    <th className="px-3 py-1 text-left font-medium">expected</th>
                    <th className="px-3 py-1 text-left font-medium">measured</th>
                  </tr>
                </thead>
                <tbody>
                  {verification.rows.map((row) => (
                    <tr
                      key={row.minterm}
                      className={cn("border-b last:border-0", !row.ok && "bg-destructive/10")}
                    >
                      {row.inputs.map((bit, i) => (
                        <td key={i} className="text-muted-foreground px-3 py-1">
                          {bit}
                        </td>
                      ))}
                      <td className="px-3 py-1">
                        {row.expected === DONT_CARE ? (
                          <span className="text-logic-z">X</span>
                        ) : (
                          row.expected
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-1 font-semibold",
                          row.ok ? "text-logic-high" : "text-destructive",
                        )}
                      >
                        {LOGIC_NAMES[row.actual as Logic]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {verification.hypotheses.length > 0 && (
                <div className="mt-4 space-y-2">
                  {verification.hypotheses.map((h, i) => (
                    <p key={i} className="text-xs">
                      <span className="font-medium">Likely cause: </span>
                      {h.message}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}

          {report.faults.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 font-medium">Diagnostics</h3>
              <ul className="space-y-1 text-xs">
                {report.faults.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <code
                      className={cn(
                        "shrink-0",
                        f.severity === "error" && "text-destructive",
                        f.severity === "warning" && "text-logic-z",
                        f.severity === "info" && "text-muted-foreground",
                      )}
                    >
                      {f.code}
                    </code>
                    <span className="text-muted-foreground">{f.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* --- 6. hazards ------------------------------------------------------- */}
      {report.timing && report.timing.glitches.length > 0 && (
        <Section n={6} title="Timing hazard">
          <div className="border-logic-z/50 bg-logic-z/5 flex gap-3 rounded-md border p-3">
            <TriangleAlert className="text-logic-z mt-0.5 size-4 shrink-0" />
            <div className="space-y-1 text-xs">
              <p>
                <span className="font-medium">
                  {report.timing.glitches.map((g) => g.label).join(", ")} glitches.
                </span>{" "}
                The output pulses away from its settled value while the inputs are
                held steady — a <strong>static hazard</strong>, caused by unequal
                path delays rather than by a logic error.
              </p>
              <p className="text-muted-foreground">
                The truth table above is still correct. The cure is to add back a
                redundant consensus term — the one Quine–McCluskey discarded{" "}
                <em>because</em> it was redundant. Minimal is not the same as
                hazard-free.
              </p>
            </div>
          </div>
        </Section>
      )}

      <footer className="text-muted-foreground border-t pt-4 text-xs">
        Generated by Gatelab. Every figure above is recomputed from the same
        engine that ran the simulation — the report cannot drift from what was built.
      </footer>
    </article>
  );
}

function Section({
  n,
  title,
  children,
  breakBefore,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  breakBefore?: boolean;
}) {
  return (
    <section className={cn("print-section", breakBefore && "print-break-before")}>
      <h2 className="mb-3 text-base font-semibold">
        <span className="text-muted-foreground mr-2 font-mono">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
