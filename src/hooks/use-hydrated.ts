"use client";

import { useSyncExternalStore } from "react";

/**
 * `false` on the server and on the client's FIRST render; `true` after that.
 *
 * The gate for anything whose value the server cannot know: a persisted store, a
 * localStorage preference, the resolved light/dark theme. React's hydration
 * requires the first client render to produce byte-identical output to the
 * server's, and a component that reads a persisted value violates that
 * immediately — the server has no localStorage, so it renders the default while
 * the client renders whatever was saved.
 *
 * The symptom is specific and worth recognising: React discards the server
 * markup for that subtree and re-renders it, so the page still LOOKS right and
 * an error appears in the console. It is easy to ignore and it costs the
 * server-rendered HTML for that whole branch.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` for the same
 * reason as `use-media-query.ts`: React 19's lint rejects setState-in-an-effect,
 * and the two-snapshot shape is exactly what this needs — `getServerSnapshot`
 * returns false, `getSnapshot` returns true, and the swap happens on hydration
 * without anybody writing an effect.
 */
const subscribe = (): (() => void) => () => {};

export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
