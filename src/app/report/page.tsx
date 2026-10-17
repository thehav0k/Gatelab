"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CircuitBoard, FileCheck, FileText, Printer, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KMapGrid } from "@/components/theory/kmap-grid";
import { TruthTable } from "@/components/theory/truth-table";
import { CircuitCanvas } from "@/components/lab/circuit-canvas";
import { BreadboardView } from "@/components/lab/breadboard-view";
import { useCircuitStore } from "@/stores/circuit-store";
import { useSpecStore } from "@/stores/spec-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildReport, type LabReport } from "@/lib/report";
import { LOGIC_NAMES, type Logic } from "@/lib/simulation/logic";
import { DONT_CARE } from "@/lib/core-engine/types";
import { cn } from "@/lib/utils";

const SAMPLE_SOURCE = "F(A,B,C,D) = Σm(0,2,5,7,8,10,13,15)";

const SECTIONS = [
  { id: "section-1", title: "1. The function" },
  { id: "section-2", title: "2. Truth table & K-map" },
  { id: "section-3", title: "3. Tabular reduction" },
  { id: "section-4", title: "4. Implementation" },
  { id: "section-5", title: "5. Verification" },
];

/**
 * The lab report.
 *
 * Printed through the BROWSER'S OWN PDF ENGINE — a /report route, an @media print
 * stylesheet, and window.print(). That keeps the circuit, the K-map, and the
 * waveform as real VECTORS in the output, and costs zero dependencies.
 */
export default function ReportPage() {
  const specSource = useSpecStore((s) => s.source);
  const theorySource = useWorkspaceStore((s) => s.theorySource);
  const userSource = specSource || theorySource;
  const [showSample, setShowSample] = useState(false);
  const [activeId, setActiveId] = useState<string>("section-1");

  const activeSource = userSource || (showSample ? SAMPLE_SOURCE : null);
  const doc = useCircuitStore((s) => s.doc);

  const isSample = !userSource && showSample;

  const report = useMemo(() => {
    if (!activeSource) return null;
    const hasCircuit = Object.keys(doc.nodes).length > 0;
    return buildReport(activeSource, hasCircuit && !isSample ? doc : null);
  }, [activeSource, doc, isSample]);

  useEffect(() => {
    if (!report) return;
    const ids = ["section-1", "section-2", "section-3", "section-4", "section-5", "section-6"];
    const elements = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-15% 0px -75% 0px" },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [report]);

  if (!report) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <FileText className="text-muted-foreground size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Nothing to report yet</h1>
        <p className="text-muted-foreground mt-3 text-sm text-pretty">
          No derivation or circuit is loaded. Enter a Boolean function in the theory workspace
          and build its circuit in the lab to generate a complete report with truth tables, K-maps,
          Quine–McCluskey derivations, circuit schematics, and verification.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href="/theory">1. Start with Theory</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/lab">2. Go to Lab</Link>
          </Button>
          <Button variant="secondary" onClick={() => setShowSample(true)} className="gap-1.5">
            <FileCheck className="size-3.5 text-logic-high" /> View Sample Report
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 print:max-w-none print:px-0 print:py-0">
      {/* Sample indicator banner */}
      {isSample && (
        <div className="print:hidden no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-logic-high/30 bg-logic-high/10 p-3.5 text-xs">
          <div className="flex items-center gap-2">
            <FileCheck className="size-4 shrink-0 text-logic-high" />
            <div>
              <span className="font-semibold text-logic-high">Viewing Sample Worked Report</span>
              <span className="text-muted-foreground ml-1.5">
                — Worked derivation for <code>{SAMPLE_SOURCE}</code>.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="xs" asChild>
              <Link href="/theory">Derive Your Own</Link>
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setShowSample(false)}>
              Close Sample
            </Button>
          </div>
        </div>
      )}

      {/* Top action toolbar */}
      <div className="print:hidden no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-xs">
        <div>
          <h2 className="text-sm font-semibold">Laboratory Derivation & Verification Report</h2>
          <p className="text-muted-foreground text-xs">
            {isSample
              ? "Sample demonstration report with complete algebraic reduction."
              : `Derived from your workspace: ${activeSource}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/theory">Edit Theory</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/lab">Edit Lab Circuit</Link>
          </Button>
          <Button size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="size-4" /> Print / Save as PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[180px_1fr] print:block">
        {/* Sticky Desktop Outline Navigator */}
        <aside className="print:hidden no-print hidden lg:block">
          <nav className="sticky top-20 rounded-lg border bg-card/50 p-3">
            <p className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
              Contents
            </p>
            <ul className="space-y-1 text-xs">
              {SECTIONS.map((s) => {
                const isActive = activeId === s.id;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={cn(
                        "block rounded px-2 py-1 transition-colors",
                        isActive
                          ? "bg-secondary text-secondary-foreground font-medium border-l-2 border-logic-high pl-2"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                      )}
                    >
                      {s.title}
                    </a>
                  </li>
                );
              })}
              {report.timing && report.timing.glitches.length > 0 && (
                <li>
                  <a
                    href="#section-6"
                    className={cn(
                      "block rounded px-2 py-1 transition-colors",
                      activeId === "section-6"
                        ? "bg-secondary text-secondary-foreground font-medium border-l-2 border-logic-high pl-2"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                    )}
                  >
                    6. Timing hazards
                  </a>
                </li>
              )}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0">
          <Report report={report} />
        </div>
      </div>
    </div>
  );
}

function Report({ report }: { report: LabReport }) {
  const { fn, analysis, verification } = report;
  const layout = analysis.layout;
  const loops = analysis.loops.sop;

  return (
    <article className="report space-y-8 text-sm [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_thead_th]:bg-muted/60 [&_thead_th]:font-semibold">
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
            <figure className="print-section">
              <div className="h-[440px] overflow-hidden rounded-md border print:h-[400px]">
                {report.onBoard ? <BreadboardView /> : <CircuitCanvas />}
              </div>
              <figcaption className="text-muted-foreground mt-2 text-xs">
                {report.onBoard
                  ? "Seated on a breadboard. Each jumper takes its own color so a connection can be traced; every hole on a strip is one net."
                  : "Schematic. Each net takes its own color; a lit wire is carrying a 1."}
              </figcaption>
            </figure>
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
          <div className="rounded-lg border border-dashed p-6 text-center">
            <CircuitBoard className="text-muted-foreground mx-auto mb-2 size-8" />
            <p className="text-sm font-medium">No circuit has been built yet in the Lab</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
              Synthesize or wire a circuit on schematic or breadboard to embed circuit drawings, pin connections, and bill-of-materials in this report.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Button size="sm" asChild>
                <Link href="/lab">Open Practical Lab</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/theory">View in Theory</Link>
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* --- 5. verification -------------------------------------------------- */}
      <Section n={5} title="Verification" breakBefore>
        {verification ? (
          verification.error ? (
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
          )
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm font-medium">Verification requires a built circuit</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
              Once a circuit is built in the Lab, the automated verification bridge sweeps every row of the truth table and compares live simulation against the derived algebra.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <Button variant="outline" size="sm" asChild>
                <Link href="/lab">Build Circuit in Lab</Link>
              </Button>
            </div>
          </div>
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
    <section id={`section-${n}`} className={cn("scroll-mt-20 print-section", breakBefore && "print-break-before")}>
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
