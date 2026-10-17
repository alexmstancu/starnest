/**
 * Which run the Acquire card shows, and whose read may change it.
 *
 * **The last act the reader took decides, not the last answer to arrive** (UI-04). Opening a
 * run, refreshing it, stopping it and starting one each read a run back, and the network
 * returns those reads in whatever order it likes -- so a slow answer for a run the reader had
 * already left used to replace the one they had just chosen. Each act takes a ticket when it is
 * clicked, and its read is shown only while that ticket is still the newest. A late answer is
 * ignored rather than cancelled: it costs one GET, never the card.
 */

import { useCallback, useRef, useState } from "react";
import type { RunDetail } from "../../api/endpoints";

/** The ticket nobody has taken: the opening view's, which any act of the reader's outranks. */
export const UNCLAIMED = 0;

export interface WatchedRun {
  current: RunDetail | null;
  /** A ticket for an act that will read a run back. Taken on the click, before any await. */
  claim: () => number;
  /** Shows `detail` if `ticket` is still the newest; otherwise the reader has moved on. */
  show: (ticket: number, detail: RunDetail) => void;
  /** Puts the card away, and with it every read still on its way. */
  clear: () => void;
  /** Whether the reader has acted yet -- the opening view gives way once they have. */
  unclaimed: () => boolean;
}

export function useWatchedRun(): WatchedRun {
  const [current, setCurrent] = useState<RunDetail | null>(null);
  // A ref, not state: tickets are compared inside callbacks that outlive the render that made
  // them, and a re-render per click would buy nothing.
  const newest = useRef(UNCLAIMED);

  const claim = useCallback(() => {
    newest.current += 1;
    return newest.current;
  }, []);

  const show = useCallback((ticket: number, detail: RunDetail) => {
    if (ticket === newest.current) setCurrent(detail);
  }, []);

  const clear = useCallback(() => {
    newest.current += 1;
    setCurrent(null);
  }, []);

  const unclaimed = useCallback(() => newest.current === UNCLAIMED, []);

  return { current, claim, show, clear, unclaimed };
}
