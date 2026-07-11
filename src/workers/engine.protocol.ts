import type { Analysis } from "@/lib/core-engine";
import type { Diagnostic } from "@/lib/core-engine/types";

/**
 * The worker's wire protocol. Hand-rolled rather than pulled from Comlink —
 * there is exactly one message shape, and it is this file.
 *
 * `requestId` is what makes cancellation work: the main thread bumps it on every
 * keystroke and drops any reply that does not match the id it is currently
 * waiting for. Stale results are discarded rather than flashed on screen.
 */

export interface EngineRequest {
  readonly requestId: number;
  readonly source: string;
}

export type EngineResponse =
  | {
      readonly requestId: number;
      readonly ok: true;
      readonly analysis: Analysis;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly requestId: number;
      readonly ok: false;
      readonly diagnostics: readonly Diagnostic[];
    };
