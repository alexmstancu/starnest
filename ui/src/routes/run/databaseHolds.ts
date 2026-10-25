/**
 * The words and figures behind the panel that opens Acquire: what the database holds, which
 * acquisition last filled it, and what has been spent this month.
 *
 * **Every figure here is one the API already returned.** The database's counts and the month's
 * spend come whole from the holdings read (PL-051, PL-052) and the scored count from the
 * ranking's tally (C04-N4); nothing is added up across runs. A `.tsx` under `routes/` may not
 * call `Number` (`CLAUDE.md`), which is why the wording lives here rather than in the markup.
 */

import { formatCount, formatMoney } from "../../format/display";
import type { MatchCounts } from "../../shell/candidateCounts";

/** What a run says about itself in the history list. */
export interface RunSummary {
  id: number;
  run_status: string;
  started_at: string;
  finished_at?: string | null;
  cost_eur?: number;
}

/**
 * The most recent acquisition, whatever became of it.
 *
 * **Sorted here rather than trusted from the server.** The list is served newest first today;
 * a list that is usually ordered is worse than one that always is, because the exception
 * arrives long after anybody remembers the assumption.
 */
export function newestRun<T extends RunSummary>(
  runs: readonly T[],
): T | undefined {
  return [...runs].sort((left, right) =>
    right.started_at.localeCompare(left.started_at),
  )[0];
}

/** The one still going, if any. Only one runs at a time, which is why this is a find. */
export function runningNow<T extends RunSummary>(
  runs: readonly T[],
): T | undefined {
  return runs.find((run) => run.run_status === "running");
}

/**
 * The newest acquisition that stored anything: the one that last filled the database. A run
 * that fetched nothing -- refused, stopped at once, or asking a source that answered nothing --
 * filled nothing, so it does not take the name.
 */
export function lastFilledBy<T extends RunSummary & { items_completed?: number }>(
  runs: readonly T[],
): T | undefined {
  return newestRun(runs.filter((run) => (run.items_completed ?? 0) > 0));
}

/**
 * The first moment of the reader's month, with the reader's zone (C04-N10).
 *
 * **A budget is held against the reader's calendar**, so the server is told where the month
 * starts rather than deciding on a clock of its own -- and the offset is written out, because a
 * time without one would be read on the database's clock, which the server refuses.
 */
export function startOfLocalMonth(now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const offset = -start.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const hours = twoDigits(Math.floor(Math.abs(offset) / 60));
  const minutes = twoDigits(Math.abs(offset) % 60);
  return (
    `${String(start.getFullYear())}-${twoDigits(start.getMonth() + 1)}-01` +
    `T00:00:00${sign}${hours}:${minutes}`
  );
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** One of the panel's four figures, as the markup draws it. */
export interface Tile {
  label: string;
  value: string;
  note: string;
  tone?: "warning" | "danger";
}

/** What the database figures are read from: the holdings read's counts and spend. */
export interface HoldingsFigures {
  level: string;
  pairs_total: number;
  values_stored: number;
  values_past_allowed_age: number;
  spent: { total_eur: number };
}

/**
 * Values stored, values past their allowed age, and this month's spend: the database at a level,
 * as the server counted it in one read (PL-051). **Nothing here adds anything up**, so opening,
 * dismissing or retrying one acquisition cannot move them.
 *
 * The ageing figure counts values in use past their attribute's maximum age -- the same
 * staleness Rank reads -- rather than the refetch setting's age (C04-N3). The cap is a per-run
 * and per-research-pass ceiling, said so beside the monthly sum that is not a budget (C04-N9).
 */
export function holdingsFigures(
  holdings: HoldingsFigures,
  capEur: number | null | undefined,
): { stored: Tile; aged: Tile; spent: Tile } {
  return {
    stored: {
      label: "Values stored",
      value: formatCount(holdings.values_stored),
      note: `of ${formatCount(holdings.pairs_total)} at ${holdings.level} level a source can fill or that hold a figure`,
    },
    aged: {
      label: "Past their allowed age",
      value: formatCount(holdings.values_past_allowed_age),
      note: "in use, though older than their attribute allows",
      tone: holdings.values_past_allowed_age > 0 ? "warning" : undefined,
    },
    spent: {
      label: "Spent this month",
      value: formatMoney(holdings.spent.total_eur, "EUR"),
      note:
        capEur === null || capEur === undefined
          ? "no cap is set: an acquisition that would spend asks you to accept going uncapped"
          : `the cap is ${formatMoney(capEur, "EUR")} per acquisition and per research pass`,
    },
  };
}

/**
 * How many candidates the active set scores, counted as the sidebar counts them (C04-N4): a
 * candidate that matches or does not match was scored, and one with insufficient data was not.
 * **"Could not be scored" rather than "below the coverage floor"**: the reason is free text, and
 * a missing required figure is the other way to get there.
 */
export function scoredFigure(counts: MatchCounts, setName: string): Tile {
  const unscored = counts.insufficientData;
  return {
    label: "Candidates scored",
    value: formatCount(counts.matching + counts.notMatching),
    note:
      unscored === 0
        ? `under ${setName}, every candidate`
        : `under ${setName}; ${formatCount(unscored)} could not be scored`,
    tone: unscored > 0 ? "warning" : undefined,
  };
}

/** What a history row says a pass covered and reached. */
export interface RunReach {
  scope_candidates?: number;
  scope_attributes?: number;
  items_total?: number;
  items_completed?: number;
  items_failed?: number;
}

/**
 * How big a pass was, in words.
 *
 * **Its size, not its contents.** The scope is stored expanded -- one row per candidate and
 * one per attribute -- so a history row carries two counts, and "32 candidates over 41
 * attributes" is what those two mean. **A pass over exact pairs asked for fewer values than
 * their cross product** (C04-N14), so it is counted in values: a two-item retry over two
 * candidates and two attributes is "2 values over 2 candidates", never four.
 */
export function describeScope(run: RunReach): string {
  const candidates = run.scope_candidates ?? 0;
  const attributes = run.scope_attributes ?? 0;
  if (candidates === 0 || attributes === 0) return "—";
  const items = run.items_total;
  if (items !== undefined && items < candidates * attributes) {
    return (
      `${String(items)} ${items === 1 ? "value" : "values"}` +
      ` over ${String(candidates)} ${candidates === 1 ? "candidate" : "candidates"}`
    );
  }
  return (
    `${String(candidates)} ${candidates === 1 ? "candidate" : "candidates"}` +
    ` over ${String(attributes)} ${attributes === 1 ? "attribute" : "attributes"}`
  );
}

/**
 * The line over the remedies, saying what their counts are of.
 *
 * **Every value at the level, by its latest outcome** (PL-054): the cards are the database's
 * gaps, so with values stored they add up to the pairs total -- and a lead that did not say so
 * would leave "62 unanswered" reading as one acquisition's accounting, which it no longer is.
 */
export function describeGaps(holdings: { level: string; pairs_total: number } | null): string {
  if (holdings === null || holdings.pairs_total <= 0) {
    return "Each of these starts a new acquisition. Nothing is fetched or charged until you agree to an estimate.";
  }
  return (
    `All ${formatCount(holdings.pairs_total)} values at ${holdings.level} level, by their latest outcome. ` +
    "Each action starts a new acquisition, and nothing is fetched or charged until you agree to an estimate."
  );
}
