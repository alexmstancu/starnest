import { useEffect, useState } from "react";
import type { ComparisonRequest } from "./comparisonRequest";

/** How long a selection must stay still before it is asked for. */
export const SETTLE_MS = 300;

/**
 * The request, once it has stopped changing for a moment (PL-094): a burst of ticks asks once,
 * for where it ended. Nothing to ask is settled at once, so a cleared selection stops drawing.
 */
export function useSettledRequest(request: ComparisonRequest | null): ComparisonRequest | null {
  const [settled, setSettled] = useState(request);
  const key = keyOf(request);
  // Nothing to ask forgets what was last asked, so a new selection never fetches an old one.
  if (request === null && settled !== null) setSettled(null);
  useEffect(() => {
    if (request === null) return;
    const timer = window.setTimeout(() => setSettled(request), SETTLE_MS);
    return () => window.clearTimeout(timer);
    // Keyed by content: a new object asking the same thing is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return settled;
}

function keyOf(request: ComparisonRequest | null): string {
  return request === null ? "" : `${request.focus}|${request.comparators.join(",")}`;
}
