/**
 * Source by source: how far each one got in a run.
 *
 * A run's totals say how far it got. They do not say *which source* got it there, and that is
 * the question a reader asks first when a run half-filled -- and the one every retry is an
 * answer to.
 *
 * **A source's bar is its progress through its own plan** (PL-055): the items it has been asked
 * about out of the items the run planned to ask it, so a source the run never got to reads "not
 * reached" rather than vanishing. Sharing one track between sources would make a source asked
 * about ten times less look small beside the rest, which inverts the reading.
 *
 * **A run started before plans were recorded has no plan to measure against**, so its bars are
 * drawn as they always were: what the source stored of what it touched.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number` and friends, so the
 * arithmetic lives here and the component draws what it is given.
 */

import { sourceName } from "../../format/display";

export interface SourceReach {
  data_source?: string | null;
  items_stored?: number | null;
  items_failed?: number | null;
  /** Null for a run whose plan was not recorded. */
  items_planned?: number | null;
  items_asked?: number | null;
}

export interface SourceBar {
  /** The source's id: what tells one bar from another, and never what is printed. */
  source: string;
  /** What the catalog calls it, which is what is printed (RB-4). */
  name: string;
  /** Percentage width of the fill, as an SVG attribute. */
  width: string;
  /** "95 of 95", or "not reached". Fits the column; the sentence is the title. */
  reading: string;
  /** The whole fact, for a screen reader and the hover. */
  sentence: string;
  /** A source that stored nothing is drawn as a failure rather than as an empty success. */
  barren: boolean;
  /** A source the run planned to ask and stopped before asking anything. */
  notReached: boolean;
}

/** The states in which a source asked about nothing will now never be asked. */
const ENDED_EARLY = new Set(["stopping", "halted_by_user", "halted_on_spend_cap", "failed"]);

/**
 * @param state the run's state as `runState` names it, so a run somebody is stopping already
 *   calls its untouched sources "not reached", as the design does.
 */
export function sourceBars(
  reaches: readonly SourceReach[] | null | undefined,
  names: ReadonlyMap<string, string>,
  state?: string | null,
): SourceBar[] {
  const endedEarly = state != null && ENDED_EARLY.has(state);
  const bars: SourceBar[] = [];
  for (const reach of reaches ?? []) {
    const source = reach.data_source ?? "";
    if (source === "") continue;
    const name = sourceName(names, source);
    const bar =
      count(reach.items_planned) > 0
        ? plannedBar(source, name, reach, endedEarly)
        : touchedBar(source, name, reach);
    if (bar !== null) bars.push(bar);
  }
  // Most productive first. A breakdown ordered by name buries the source that did the work
  // among the ones that did none.
  return bars.sort(byStoredThenId);
}

function plannedBar(
  source: string,
  name: string,
  reach: SourceReach,
  endedEarly: boolean,
): SourceBar {
  const planned = count(reach.items_planned);
  const asked = Math.min(count(reach.items_asked), planned);
  const stored = count(reach.items_stored);
  const failed = count(reach.items_failed);
  const notReached = asked === 0 && endedEarly;
  const outcome = failed > 0 ? `${stored} stored, ${failed} failed` : `${stored} stored`;
  return {
    source,
    name,
    width: `${(asked / planned) * 100}%`,
    reading: notReached ? "not reached" : `${asked} of ${planned}`,
    sentence: notReached
      ? `${name}: not reached, ${planned} planned`
      : `${name}: asked about ${asked} of ${planned}, ${outcome}`,
    barren: asked > 0 && stored === 0,
    notReached,
  };
}

function touchedBar(source: string, name: string, reach: SourceReach): SourceBar | null {
  const stored = count(reach.items_stored);
  const failed = count(reach.items_failed);
  const touched = stored + failed;
  // With no plan, a source in the breakdown that touched nothing cannot be there: the list is
  // the union of the sources that stored something and the sources that failed at something.
  if (touched === 0) return null;
  return {
    source,
    name,
    width: `${(stored / touched) * 100}%`,
    reading: failed > 0 ? `${stored} of ${touched}` : `${stored}`,
    sentence:
      failed > 0
        ? `${name}: ${stored} stored, ${failed} failed`
        : `${name}: ${stored} stored`,
    barren: stored === 0,
    notReached: false,
  };
}

/** What the breakdown is measured against, said only when it is not the plan. */
export function planNote(planRecorded: boolean | null | undefined): string {
  return planRecorded === false
    ? "Plan not recorded for this acquisition: each bar is what the source stored of what it touched."
    : "";
}

/**
 * **By id among equals, not by name.** The names arrive after the bars are drawn, and an order
 * taken from them would move every bar under the reader's eye the moment the catalog answered.
 */
function byStoredThenId(left: SourceBar, right: SourceBar): number {
  const rank = (bar: SourceBar) => (bar.notReached ? 2 : bar.barren ? 1 : 0);
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
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
    items_not_reached?: number | null;
  } | null | undefined,
): string {
  if (status === "running" || status === null || status === undefined) return "";

  const stored = count(progress?.items_completed);
  const failed = count(progress?.items_failed);
  const unanswered = count(progress?.items_unanswered);
  const notReached = count(progress?.items_not_reached);

  const parts = [`${stored} ${stored === 1 ? "figure" : "figures"} stored`];
  if (failed > 0) parts.push(`${failed} failed`);
  // Named even at zero is wrong, but named whenever there are any is the point: an item nobody
  // answered is the count that used to be in no count at all (`reqs.md` Q217).
  if (unanswered > 0) parts.push(`${unanswered} nobody answered`);
  // Never folded into "nobody answered" (PL-050): nobody was asked about these.
  if (notReached > 0) parts.push(`${notReached} not reached`);

  return `${opening(status)} ${parts.join(", ")}.`;
}

function opening(status: string): string {
  switch (status) {
    case "completed":
      return "Finished.";
    case "halted_on_spend_cap":
      return "Stopped at the spend cap, keeping everything it had written.";
    case "halted_by_user":
      return "Stopped when you asked, keeping everything it had written.";
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

/**
 * The acquisition still going, if any: the run on the card when it is in flight, else the
 * newest the history says is.
 *
 * **The card's own read wins for its run**, because it is refreshed on its own and the history
 * may still call a run running that the card has seen end.
 */
export function acquisitionInFlight(
  current: { id: number; run_status?: string | null } | null,
  runs: readonly { id: number; run_status?: string | null }[],
): number | null {
  if (current !== null && inFlight(current.run_status)) return current.id;
  const other = runs.find((run) => run.id !== current?.id && inFlight(run.run_status));
  return other?.id ?? null;
}
