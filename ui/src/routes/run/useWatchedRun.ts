/**
 * Which run the Acquire card shows, and whose read may change it.
 *
 * **The last act the reader took decides, not the last answer to arrive** (UI-04). Opening a
 * run, refreshing it, stopping it and starting one each read a run back, and the network
 * returns those reads in whatever order it likes -- so a slow answer for a run the reader had
 * already left used to replace the one they had just chosen. Each act takes a ticket when it is
 * clicked, and its read is shown only while that ticket is still the newest. A late answer is
 * ignored rather than cancelled: it costs one GET, never the card. **A late failure is ignored
 * the same way**: it is about a run the reader has left, so it reports nothing either.
 *
 * **A stop claims again once it has been written** (NEW-49). Refresh stays live while a stop is
 * sent, and its read can be answered before the stop is written; holding the newer ticket, it
 * kept the stop's own read off the card, which then offered Stop again. So each ticket names
 * the run it was taken for, and an act whose request has been answered takes a fresh one while
 * the reader's newest act is about that same run -- never over another run, a start or a card
 * put away.
 */

import { useCallback, useRef, useState } from "react";
import type { RunDetail } from "../../api/endpoints";

/** The ticket nobody has taken: the opening view's, which any act of the reader's outranks. */
export const UNCLAIMED = 0;

export interface WatchedRun {
  current: RunDetail | null;
  /**
   * A ticket for an act that will read a run back. Taken on the click, before any await, and
   * naming the run when the act knows it -- a start does not until the server answers.
   */
  claim: (runId?: number) => number;
  /**
   * The ticket to read `runId` back with once an act's own request has been answered: a fresh
   * one while the reader's newest act is about that run, so a read of it sent before the
   * request was written cannot stand over this one; `ticket` unchanged once they have moved on.
   */
  reclaim: (ticket: number, runId: number) => number;
  /** Whether `ticket` is still the newest: whether the reader is still waiting on that act. */
  isCurrent: (ticket: number) => boolean;
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
  // The run the newest ticket was taken for: none for a start, nor for a card put away.
  const claimedFor = useRef<number | null>(null);

  const claim = useCallback((runId?: number) => {
    newest.current += 1;
    claimedFor.current = runId ?? null;
    return newest.current;
  }, []);

  const reclaim = useCallback(
    (ticket: number, runId: number) =>
      claimedFor.current === runId ? claim(runId) : ticket,
    [claim],
  );

  const isCurrent = useCallback(
    (ticket: number) => ticket === newest.current,
    [],
  );

  const show = useCallback(
    (ticket: number, detail: RunDetail) => {
      if (isCurrent(ticket)) setCurrent(detail);
    },
    [isCurrent],
  );

  const clear = useCallback(() => {
    claim();
    setCurrent(null);
  }, [claim]);

  const unclaimed = useCallback(() => newest.current === UNCLAIMED, []);

  return { current, claim, reclaim, isCurrent, show, clear, unclaimed };
}
