/**
 * The arithmetic behind the strip that opens Acquire: what the last acquisition actually
 * filled, and what has been spent this month.
 *
 * **Every figure here is a sum over what the API already returned.** Nothing is estimated and
 * nothing is inferred: a count of runs, a count of items a run reported, and an addition of
 * costs the server recorded. A `.tsx` under `routes/` may not call `Number` (`CLAUDE.md`),
 * which is why the addition lives here rather than in the markup.
 */

/** What a run says about itself in the history list. */
export interface RunSummary {
  id: number;
  run_status: string;
  started_at: string;
  finished_at?: string | null;
  cost_eur?: number;
}

/** What a run's detail says about what it reached. */
export interface RunProgress {
  items_total?: number;
  items_completed?: number;
  items_failed?: number;
  items_unanswered?: number;
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
 * What has been spent since the first of the month, in euros.
 *
 * **The calendar month, not the last thirty days.** A spend cap is a budget, and a budget is
 * something people hold against a month -- "have I spent too much this month" is the question
 * being asked, and a rolling window answers a different one.
 */
export function spentThisMonth(
  runs: readonly RunSummary[],
  now: Date,
): number {
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return runs.reduce((total, run) => {
    const started = new Date(run.started_at).getTime();
    if (Number.isNaN(started) || started < from) return total;
    return total + (run.cost_eur ?? 0);
  }, 0);
}

/** How many of the items a run asked about it came back with a figure for. */
export function filledOf(progress: RunProgress | null | undefined): {
  filled: number;
  asked: number;
} {
  return {
    filled: progress?.items_completed ?? 0,
    asked: progress?.items_total ?? 0,
  };
}

/** What a history row says a pass covered and reached. */
export interface RunReach {
  scope_candidates?: number;
  scope_attributes?: number;
  items_completed?: number;
  items_failed?: number;
}

/**
 * How big a pass was, in words.
 *
 * **Its size, not its contents.** The scope is stored expanded -- one row per candidate and
 * one per attribute -- so a history row carries two counts, and "32 candidates over 41
 * attributes" is what those two mean.
 */
export function describeScope(run: RunReach): string {
  const candidates = run.scope_candidates ?? 0;
  const attributes = run.scope_attributes ?? 0;
  if (candidates === 0 || attributes === 0) return "—";
  return (
    `${String(candidates)} ${candidates === 1 ? "candidate" : "candidates"}` +
    ` over ${String(attributes)} ${attributes === 1 ? "attribute" : "attributes"}`
  );
}
