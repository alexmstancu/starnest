/**
 * Source by source: how far each one got in a run.
 *
 * A run's totals say how far it got. They do not say *which source* got it there, and that is
 * the question a reader asks first when a run half-filled -- and the one every retry is an
 * answer to.
 *
 * **A source's bar is its own success rate, not its share of the run.** Sharing a track between
 * sources would make a source that answered everything it was asked look small beside one that
 * was asked about ten times more, which inverts the reading. So the track is what that source
 * touched and the fill is what it stored.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number` and friends, so the
 * arithmetic lives here and the component draws what it is given.
 */

export interface SourceReach {
  data_source?: string | null;
  items_stored?: number | null;
  items_failed?: number | null;
}

export interface SourceBar {
  source: string;
  /** Percentage width of the fill, as an SVG attribute. */
  width: string;
  /** "142 of 145", or "142" where nothing failed. Fits the column; the sentence is the title. */
  reading: string;
  /** The whole fact, for a screen reader and the hover. */
  sentence: string;
  /** A source that stored nothing is drawn as a failure rather than as an empty success. */
  barren: boolean;
}

export function sourceBars(
  reaches: readonly SourceReach[] | null | undefined,
): SourceBar[] {
  const bars: SourceBar[] = [];
  for (const reach of reaches ?? []) {
    const source = reach.data_source ?? "";
    if (source === "") continue;
    const stored = count(reach.items_stored);
    const failed = count(reach.items_failed);
    const touched = stored + failed;
    // A source in the breakdown that touched nothing cannot be there: the list is the union of
    // the sources that stored something and the sources that failed at something.
    if (touched === 0) continue;
    bars.push({
      source,
      width: `${(stored / touched) * 100}%`,
      reading: failed > 0 ? `${stored} of ${touched}` : `${stored}`,
      sentence:
        failed > 0
          ? `${source}: ${stored} stored, ${failed} failed`
          : `${source}: ${stored} stored`,
      barren: stored === 0,
    });
  }
  // Most productive first. A breakdown ordered by name buries the source that did the work
  // among the ones that did none.
  return bars.sort(byStoredThenName);
}

function byStoredThenName(left: SourceBar, right: SourceBar): number {
  if (left.barren !== right.barren) return left.barren ? 1 : -1;
  return left.source.localeCompare(right.source);
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/**
 * What the run came to, in one sentence, or nothing while it is still going.
 *
 * **Only once it has stopped.** A sentence about what a run "came to" while it is running is a
 * claim about an outcome that has not happened; the bar above it is already saying where it is.
 */
export function outcomeSentence(
  status: string | null | undefined,
  progress: {
    items_completed?: number | null;
    items_failed?: number | null;
    items_unanswered?: number | null;
  } | null | undefined,
): string {
  if (status === "running" || status === null || status === undefined) return "";

  const stored = count(progress?.items_completed);
  const failed = count(progress?.items_failed);
  const unanswered = count(progress?.items_unanswered);

  const parts = [`${stored} ${stored === 1 ? "figure" : "figures"} stored`];
  if (failed > 0) parts.push(`${failed} failed`);
  // Named even at zero is wrong, but named whenever there are any is the point: an item nobody
  // answered is the count that used to be in no count at all (`reqs.md` Q217).
  if (unanswered > 0) parts.push(`${unanswered} nobody answered`);

  return `${opening(status)} ${parts.join(", ")}.`;
}

function opening(status: string): string {
  switch (status) {
    case "completed":
      return "Finished.";
    case "halted_on_spend_cap":
      return "Stopped at the spend cap, keeping everything it had written.";
    case "failed":
      return "Did not finish.";
    default:
      return `${status}.`;
  }
}


/**
 * What to call a run's state, which is not always its status.
 *
 * **A run somebody has asked to stop is still `running`**, and will be until the source in
 * flight finishes. Telling a reader "running" there is true and useless: they have just
 * clicked Stop and want to know whether it took. `stopping` is not a status the server has --
 * it is the pair (running, stop asked) said in one word.
 */
export function runState(
  status: string | null | undefined,
  stopRequestedAt: string | null | undefined,
): string {
  if (status === "running" && stopRequestedAt != null) return "stopping";
  return status ?? "";
}

/**
 * The states under which a run is still going to do something.
 *
 * **`stopping` is in here although no server ever sends it**, because `runState` does: a caller
 * holding a state rather than a status must get the same answer, and a predicate that said
 * "not in flight" for a run that is mid-stop would be a trap set for whoever next passes the
 * wrong one of the two.
 */
const IN_FLIGHT = new Set(["planned", "running", "stopping"]);

/**
 * Whether the run is still going.
 *
 * **What leads the Acquire screen turns on this, not on there being a run at all.** A reader
 * arriving mid-run came for the run, so it takes the top of the screen; a reader arriving
 * afterwards came to see what the database now holds and what they can do about the gaps, and
 * a finished run above those is an answer in front of the question.
 *
 * `planned` counts: the run exists, nothing has been asked yet, and it is about to move. A run
 * somebody has asked to stop is still `running` and still in flight -- it ends when the source
 * in flight finishes, which is the one moment its progress is worth watching.
 */
export function inFlight(status: string | null | undefined): boolean {
  return status != null && IN_FLIGHT.has(status);
}
