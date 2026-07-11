"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/core-engine";
import type { Diagnostic } from "@/lib/core-engine/types";
import type { EngineRequest, EngineResponse } from "@/workers/engine.protocol";

const DEBOUNCE_MS = 180;

export interface AnalysisState {
  readonly analysis: Analysis | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly pending: boolean;
}

interface Settled {
  readonly analysis: Analysis | null;
  readonly diagnostics: readonly Diagnostic[];
  /** The input this result is FOR. Comparing it to the live input gives `pending`. */
  readonly forSource: string | null;
}

/**
 * Runs the theory engine in a Web Worker, debounced and cancellable.
 *
 * Cancellation is by request id, not by terminating the worker: every keystroke
 * bumps the id, and a reply whose id is not the one we are waiting for gets
 * dropped. Without this, a slow analysis of `A` can land *after* a fast analysis
 * of `AB` and overwrite it — the classic stale-response race, which presents as
 * a nondeterministic engine bug rather than a UI one.
 *
 * `pending` is derived, not stored: it is simply "the settled result is for a
 * different string than the one on screen". Storing it would mean a setState in
 * an effect on every keystroke, which is a cascading render for a value we can
 * just compute.
 */
export function useAnalysis(source: string): AnalysisState {
  const [settled, setSettled] = useState<Settled>({
    analysis: null,
    diagnostics: [],
    forSource: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const awaiting = useRef(-1);
  const inFlightSource = useRef("");

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/engine.worker.ts", import.meta.url),
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      const res = event.data;
      if (res.requestId !== awaiting.current) return; // stale — a newer edit won

      setSettled({
        analysis: res.ok ? res.analysis : null,
        diagnostics: res.diagnostics,
        forSource: inFlightSource.current,
      });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;

      const requestId = (nextId.current += 1);
      awaiting.current = requestId;
      inFlightSource.current = source;
      worker.postMessage({ requestId, source } satisfies EngineRequest);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [source]);

  return {
    analysis: settled.analysis,
    diagnostics: settled.diagnostics,
    pending: settled.forSource !== source,
  };
}
