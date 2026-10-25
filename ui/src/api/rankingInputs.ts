/**
 * A count of the writes that change what a live ranking says without changing the criteria set:
 * the household (its citizenships clear gates, its spend feeds compound rules), the settings and
 * the sources. A screen that shows a ranking-derived sentence keys its read on this, so the
 * sentence moves the moment one of those is saved rather than when the screen is next mounted.
 *
 * Module state on purpose: the writers and the readers sit in unrelated panels, and the count
 * means "something changed", never a value anybody stores.
 */

import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

/** Called by a write the server accepted that a ranking reads. */
export function noteRankingInputsChanged(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Changes whenever `noteRankingInputsChanged` is called; pass it as a read's freshness. */
export function useRankingInputsVersion(): number {
  return useSyncExternalStore(subscribe, currentVersion);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function currentVersion(): number {
  return version;
}
