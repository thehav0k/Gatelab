"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  CheckCircle2,
  MonitorCheck,
  ShieldCheck,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "gatelab-terms-accepted-v1";

let isModalOpen = false;
let termsListeners: Array<() => void> = [];

function notifyTermsListeners() {
  for (const listener of termsListeners) {
    listener();
  }
}

export function openTermsModal() {
  isModalOpen = true;
  notifyTermsListeners();
}

function closeTermsModal() {
  isModalOpen = false;
  notifyTermsListeners();
}

function subscribeTerms(callback: () => void) {
  termsListeners.push(callback);
  return () => {
    termsListeners = termsListeners.filter((l) => l !== callback);
  };
}

function getTermsModalOpen(): boolean {
  if (typeof window === "undefined") return false;
  if (isModalOpen) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "true";
  } catch {
    return true;
  }
}

function getIsAccepted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface CapabilityCheck {
  id: string;
  label: string;
  detail: string;
  status: "pass" | "warn" | "fail";
}

function runBrowserDiagnostics(): CapabilityCheck[] {
  if (typeof window === "undefined") return [];

  // 1. TypedArrays & ES2020 Simulation Engine Primitives
  const hasTypedArrays =
    typeof Uint8Array !== "undefined" &&
    typeof Int32Array !== "undefined" &&
    typeof BigInt !== "undefined";

  // 2. LocalStorage Persistence Check
  let hasStorage = false;
  try {
    const testKey = "__gatelab_probe__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    hasStorage = true;
  } catch {
    hasStorage = false;
  }

  // 3. SVG & Pointer Event Support for Schematic/Breadboard Canvas
  const hasSvgAndPointer =
    typeof SVGSVGElement !== "undefined" && typeof window.PointerEvent !== "undefined";

  // 4. Logical CPU Cores & Device Memory
  const cores = navigator.hardwareConcurrency ?? 2;
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  return [
    {
      id: "engine",
      label: "4-State Simulation Engine (TypedArrays & ES2020)",
      detail: hasTypedArrays
        ? "Uint8Array, Int32Array & BigInt verified for delta-cycle solver"
        : "Missing required JavaScript TypedArray support",
      status: hasTypedArrays ? "pass" : "fail",
    },
    {
      id: "svg-pointer",
      label: "Interactive SVG Vector Canvas & Pointer Events",
      detail: hasSvgAndPointer
        ? "Hardware-accelerated SVG CTM & unified Mouse/Touch PointerEvents active"
        : "Browser lacks full PointerEvent or SVG matrix support",
      status: hasSvgAndPointer ? "pass" : "fail",
    },
    {
      id: "storage",
      label: "Client-Side Workspace Persistence (localStorage)",
      detail: hasStorage
        ? "Local persistence active (circuits stay 100% on your device)"
        : "localStorage is blocked (private browsing or strict cookie settings)",
      status: hasStorage ? "pass" : "warn",
    },
    {
      id: "hardware",
      label: "Device Compute Capacity (2ⁿ Sweep & Hazard Timing)",
      detail: `${cores} logical CPU core${cores === 1 ? "" : "s"} detected${
        memoryGb ? ` · ~${memoryGb} GB RAM` : ""
      } (Min: 2 cores recommended)`,
      status: cores >= 2 ? "pass" : "warn",
    },
  ];
}

export function TermsAndSystemGate() {
  const isOpen = useSyncExternalStore(subscribeTerms, getTermsModalOpen, () => false);
  const isAccepted = useSyncExternalStore(subscribeTerms, getIsAccepted, () => true);
  const [userChecked, setUserChecked] = useState(false);
  const checked = userChecked || isAccepted;

  const checks = useMemo(() => (isOpen ? runBrowserDiagnostics() : []), [isOpen]);
  const hasCriticalFailure = checks.some((c) => c.status === "fail");

  const handleAccept = () => {
    if (!checked || hasCriticalFailure) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Proceed for current session even if storage is restricted
    }
    closeTermsModal();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gatelab-terms-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="border-b bg-muted/40 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h2 id="gatelab-terms-title" className="text-base font-bold tracking-tight">
                GateLab Client-Side Execution Terms &amp; System Verification
              </h2>
              <p className="text-xs text-muted-foreground font-mono">
                100% In-Browser Execution · Zero Cloud Uploads · Hardware Requirements Check
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              v1.0 LOCAL ENGINE
            </Badge>
            {isAccepted && (
              <button
                type="button"
                onClick={closeTermsModal}
                className="text-muted-foreground hover:text-foreground p-1 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto p-5 space-y-4 text-xs leading-relaxed">
          {/* Live Browser & Hardware Diagnostic Scorecard */}
          <div className="rounded-md border bg-background/60 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <MonitorCheck className="size-4 text-emerald-400" />
                Automated Browser &amp; Device Compatibility Check
              </span>
              <Badge
                variant={hasCriticalFailure ? "destructive" : "secondary"}
                className="font-mono text-[10px]"
              >
                {hasCriticalFailure ? "MINIMUM REQUIREMENTS NOT MET" : "MINIMUM CONDITIONS MET"}
              </Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {checks.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-2 rounded border border-border/60 bg-card p-2.5"
                >
                  {c.status === "pass" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-400 mt-0.5" />
                  ) : (
                    <AlertTriangle
                      className={cn(
                        "size-4 shrink-0 mt-0.5",
                        c.status === "warn" ? "text-amber-400" : "text-red-400",
                      )}
                    />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground text-[11px]">{c.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {c.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Terms & Conditions Clauses */}
          <div className="rounded-md border bg-muted/20 p-3.5 space-y-2.5 text-muted-foreground">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground">
              Terms and Conditions of Local Browser Execution
            </h3>
            <ol className="list-decimal pl-4 space-y-1.5">
              <li>
                <strong className="text-foreground">100% Client-Side Execution &amp; Data Privacy:</strong>{" "}
                GateLab runs entirely inside your local web browser. All Boolean algebra minimizations,
                schematics, breadboard layouts, and verification reports are computed on your device and
                saved exclusively in your browser&apos;s local storage (<code className="font-mono text-foreground">digilab-circuit</code>).
                Nothing you build is uploaded to any external server. You are solely responsible for
                exporting (<code className="font-mono text-foreground">.json</code>) and backing up your
                work before clearing browser data.
              </li>
              <li>
                <strong className="text-foreground">Local Compute &amp; Minimum Device Conditions:</strong>{" "}
                Exhaustive truth-table verification sweeps up to <code className="font-mono text-foreground">2¹⁶ = 65,536</code> input vectors
                and unit-delay Gray-code hazard analysis utilize your device&apos;s CPU and RAM. By
                proceeding, you confirm that your device meets the minimum system requirements above and
                accept that large combinational or oscillating feedback circuits execute using local
                browser resources.
              </li>
              <li>
                <strong className="text-foreground">Hardware Simulation Scope &amp; Bench Safety Disclaimer:</strong>{" "}
                GateLab models logic behavior, pinouts, and 4-state nets (<code className="font-mono">0, 1, Z, X</code>)
                from standard 74xx TTL datasheets. It does not model analog voltage droop, current-limiting
                resistors, thermal dissipation, or real-world component damage. Always verify physical power
                polarity (+5.0V VCC vs. GND) and series LED resistors before energizing real hardware on a
                physical lab bench.
              </li>
              <li>
                <strong className="text-foreground">No Warranty (&ldquo;As-Is&rdquo; Educational Provision):</strong>{" "}
                GateLab is provided free of charge on an &ldquo;AS IS&rdquo; basis for educational and
                engineering design use without warranties of any kind.
              </li>
            </ol>
          </div>

          {/* Explicit Agreement Checkbox */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-md border border-primary/30 bg-primary/5 p-3">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setUserChecked(e.target.checked)}
              className="mt-0.5 size-4 rounded border-border accent-primary cursor-pointer"
            />
            <span className="text-xs text-foreground font-medium">
              I understand that GateLab executes 100% locally in my web browser with zero server uploads,
              confirm that my device and browser meet the minimum operating conditions above, and agree to the
              Terms and Conditions.
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="border-t bg-muted/40 px-5 py-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            disabled={!checked || hasCriticalFailure}
            onClick={handleAccept}
            className="font-semibold"
          >
            Agree &amp; Launch GateLab
          </Button>
        </div>
      </div>
    </div>
  );
}
