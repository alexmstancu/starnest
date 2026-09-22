import { useEffect, useState } from "react";
import { fetchRun, fetchRuns, type RunDetail } from "../api/endpoints";

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
 */
export interface Acquiring {
  run: RunDetail | null;
  done: number;
  total: number;
}

const EVERY = 2000;

export function useAcquiring(): Acquiring | null {
  const [acquiring, setAcquiring] = useState<Acquiring | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function look(): Promise<void> {
      try {
        const { items } = await fetchRuns(1);
        const newest = items[0];
        if (!live) return;
        if (newest?.run_status !== "running") {
          setAcquiring(null);
        } else {
          const detail = await fetchRun(newest.id);
          if (!live) return;
          setAcquiring({
            run: detail,
            done: detail.progress?.items_completed ?? 0,
            total: detail.progress?.items_total ?? 0,
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
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return acquiring;
}
