import type { Run } from "../api/endpoints";
import { formatCount } from "../format/display";

/**
 * How far through an acquisition is, in words and as a width.
 *
 * A `.tsx` under `shell/` may not call `Number` (`CLAUDE.md`), so the division lives here --
 * and with it the one case that matters: a run whose total is not known yet.
 */
export function acquiringProgress(
  done: number,
  total: number,
): { reading: string; portion: number } {
  if (total <= 0) {
    // **Not "0 of 0".** A run that has not yet said how much there is to do has not failed to
    // do any of it; saying nothing about the count is the honest reading.
    return { reading: "starting", portion: 0 };
  }
  const portion = Math.max(0, Math.min(100, (done / total) * 100));
  return { reading: `${formatCount(done)} of ${formatCount(total)}`, portion };
}

/** As much of the newest run as a look needs to say whether it is running. */
type LookedAt = Pick<Run, "id" | "run_status">;

/** The run a look saw running, or null when the newest run is not running or there is none. */
export function runningRunOf(newest: LookedAt | undefined): number | null {
  return newest?.run_status === "running" ? newest.id : null;
}

/**
 * Whether the run the previous look saw running has stopped running by this one (UI-11), which
 * is when what the sidebar read about the runs and the ranking goes stale.
 *
 * **Never on the first look.** A run that had already stopped when the shell first asked did not
 * stop under anybody, and whatever it changed was read with everything else. **Another run in
 * its place is an end too**: looks are two seconds apart, and the run that was watched is over
 * whether or not a new one has started since.
 */
export function acquisitionEnded(
  seenRunning: number | null,
  newest: LookedAt | undefined,
): boolean {
  return seenRunning !== null && runningRunOf(newest) !== seenRunning;
}

const STARTED = "An acquisition is running.";
const ENDED = "The acquisition has ended.";

/**
 * What a look says aloud, if anything (PL-131): **only a start and an end.** The count moves on
 * every look, and a live region around it read every poll out to a screen reader.
 *
 * A run is "started" the first time a look sees it running -- the shell may open on one already
 * under way, which is news to the reader all the same.
 */
export function announcementFor(
  seenRunning: number | null,
  newest: LookedAt | undefined,
): string | null {
  const running = runningRunOf(newest);
  const said = [
    acquisitionEnded(seenRunning, newest) ? ENDED : null,
    running !== null && running !== seenRunning ? STARTED : null,
  ].filter((sentence) => sentence !== null);
  return said.length === 0 ? null : said.join(" ");
}
