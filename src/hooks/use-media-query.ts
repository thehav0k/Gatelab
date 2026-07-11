"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as a React value.
 *
 * `useSyncExternalStore` rather than the usual `useState` + `useEffect` dance,
 * for two reasons that both bite in this codebase:
 *
 *   1. React 19's lint rejects setState-in-an-effect, which is how everyone
 *      normally writes this hook.
 *   2. The server has no viewport. `getServerSnapshot` returns `false` — i.e. the
 *      server always renders the DESKTOP layout — and React swaps to the real
 *      answer on hydration without a mismatch warning. Guessing "mobile" on the
 *      server instead would flash the wrong layout to every desktop visitor.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below `lg` — where the lab collapses its side columns into sheets. */
export const useIsCompact = () => useMediaQuery("(max-width: 1023px)");
