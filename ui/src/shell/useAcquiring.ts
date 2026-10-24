import { useEffect, useEffectEvent, useState } from "react";
import { fetchRun, fetchRuns, type RunDetail } from "../api/endpoints";
import { acquisitionEnded, announcementFor, runningRunOf } from "./acquiringProgress";

/**
 * Whether an acquisition is in flight, and how far through it is.
 *
 * **It polls, because nothing pushes.** There is no socket and no event stream; a run writes
 * its progress as it goes and the interface asks. Two seconds is often enough to feel live
 * and rare enough that a run lasting an hour costs 1,800 cheap reads rather than a connection
 * held open for it.
 *
 * **It stops asking the moment the run stops.** A poll that continues after `completed` is a
 * request per two seconds forever, which is the shape that makes a local app feel heavy.
 *
 * **And it says when the run it saw running stops** (UI-11), through `onEnded`: this is the
 * one place in the shell that watches a run, and what the sidebar read about the runs and the
 * ranking is stale from that moment. Never on the first look -- see `acquisitionEnded`.
 */
export interface Acquiring {
  run: RunDetail | null;
  /** Items finished either way: completed, or failed with no source answering (PL-131). */
  done: number;
  total: number;
  /** Somebody asked it to stop; it stops once the source in flight finishes. */
  stopping: boolean;
}

export interface AcquiringState {
  acquiring: Acquiring | null;
  /** The last start or end, for a live region: never the count, which moves every look. */
  announcement: string;
}

const EVERY = 2000;

export function useAcquiring(onEnded: () => void): AcquiringState {
  const [acquiring, setAcquiring] = useState<Acquiring | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // An effect event, so a caller's new callback is used without restarting the poll -- which
  // would forget the run it had seen running, and with it the end it was waiting for.
  const reportEnded = useEffectEvent(onEnded);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // **The request is cancelled, not just its answer ignored.** `live` stopped the setState
    // and left the fetch itself running, so a poll begun just before a tab change outlived
    // the component that wanted it -- and this one polls on a timer, so they accumulate.
    const controller = new AbortController();
    // Kept across a failed look: one that learned nothing has not seen the run stop.
    let seenRunning: number | null = null;

    async function look(): Promise<void> {
      try {
        const { items } = await fetchRuns(1, { signal: controller.signal });
        const newest = items[0];
        if (!live) return;
        if (acquisitionEnded(seenRunning, newest)) reportEnded();
        const said = announcementFor(seenRunning, newest);
        if (said !== null) setAnnouncement(said);
        seenRunning = runningRunOf(newest);
        if (newest?.run_status !== "running") {
          setAcquiring(null);
        } else {
          const detail = await fetchRun(newest.id, { signal: controller.signal });
          if (!live) return;
          const progress = detail.progress;
          setAcquiring({
            run: detail,
            done: (progress?.items_completed ?? 0) + (progress?.items_failed ?? 0),
            total: progress?.items_total ?? 0,
            stopping: Boolean(detail.stop_requested_at),
          });
        }
      } catch {
        // **Silent.** A banner that cannot be read is not worth an error message on every
        // screen; the Acquire tab is where a failure to read a run belongs, and it reports
        // one there.
        if (live) setAcquiring(null);
      }
      if (live) timer = setTimeout(() => void look(), EVERY);
    }

    void look();
    return () => {
      live = false;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return { acquiring, announcement };
}
