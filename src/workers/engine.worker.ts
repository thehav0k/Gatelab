/// <reference lib="webworker" />
import { analyze } from "@/lib/core-engine";
import type { EngineRequest, EngineResponse } from "./engine.protocol";

/**
 * The theory engine, off the main thread.
 *
 * Unconditionally — not "when n > 8". Conditional worker dispatch means two code
 * paths, and the slow one is the one you never test. The postMessage round-trip
 * costs about a millisecond and buys a permanently non-blocking, cancellable UI.
 *
 * This file is why `src/lib` may not import React (see eslint.config.mjs): the
 * engine has to load in a context with no DOM at all.
 */

self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const { requestId, source } = event.data;
  const result = analyze(source);

  const response: EngineResponse = result.ok
    ? {
        requestId,
        ok: true,
        analysis: result.value,
        diagnostics: result.diagnostics,
      }
    : { requestId, ok: false, diagnostics: result.diagnostics };

  (self as unknown as Worker).postMessage(response);
};
