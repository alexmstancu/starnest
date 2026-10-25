/**
 * The Acquire card follows a running acquisition by itself, and stops at its end (PL-117).
 *
 * **A look, never an act.** Every act on the card goes through `useRunScreen`'s `act`, which
 * clears the refusal on screen, holds every control and re-reads the history; a poll through it
 * would wipe a refused start's banner within a tick, flicker every held button and page the whole
 * history every two seconds. So a look takes no ticket and touches nothing but the card: it reads
 * the newest ticket when it sends, and its answer is shown only while that ticket is still the
 * newest and the card still shows the same run (`showIfStillShown`). A failed look is silent and
 * the next one is sent; Refresh is still there, and reports.
 *
 * **It stops** at a status that has ended, when the card shows another run or none, and when the
 * screen goes. The end it sees is said once, so the history and the holdings are re-read once.
 */

import { useEffect, useEffectEvent } from "react";
import { fetchRun, type RunDetail } from "../../api/endpoints";
import { WHILE_RUNNING } from "../../shell/useAcquiring";
import { isLive } from "./useWatchedRun";

let lookEvery = WHILE_RUNNING;

/** For tests: how often the card looks, so a suite on real timers is never raced by a look. */
export function followEvery(milliseconds: number = WHILE_RUNNING): void {
  lookEvery = milliseconds;
}

export interface Followed {
  current: RunDetail | null;
  ticketNow: () => number;
  showIfStillShown: (ticket: number, detail: RunDetail) => boolean;
}

export function useFollowedRun(
  { current, ticketNow, showIfStillShown }: Followed,
  onEnded: () => void,
): void {
  const runId = current?.id ?? null;
  const live = current !== null && isLive(current);
  const show = useEffectEvent(showIfStillShown);
  const ticket = useEffectEvent(ticketNow);
  const ended = useEffectEvent(onEnded);

  useEffect(() => {
    if (runId === null || !live) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      const sentWith = ticket();
      let detail: RunDetail | null = null;
      try {
        detail = await fetchRun(runId, { signal: controller.signal });
      } catch {
        // Silent: nobody asked for this read. The next look goes out all the same.
      }
      if (controller.signal.aborted) return;
      if (detail !== null && show(sentWith, detail) && !isLive(detail)) {
        ended();
        return;
      }
      timer = setTimeout(() => void look(), lookEvery);
    };
    timer = setTimeout(() => void look(), lookEvery);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId, live]);
}
