import { useCallback } from "react";
import { fetchCandidates, fetchRanking, fetchRuns, type Run } from "../api/endpoints";
import { useResource, type Resource } from "../api/useResource";
import { tallyMatchStatus, type CandidateCounts } from "./candidateCounts";

/**
 * The two figures the sidebar carries besides the selectors: the candidate counts for the
 * selected level and criteria set, and the most recent data acquisition run.
 *
 * The counts depend on the selection, so they re-fetch when it changes -- which is also why
 * they are not cached: a criteria set change makes every previous count wrong (`reqs.md`
 * section 3.4a, score and match status belong to an Evaluation, not to a candidate).
 *
 * **Both are read again whenever `freshness` changes** (UI-11): something elsewhere -- another
 * screen, or a run that has just ended -- may have moved them, and the sidebar is the one place
 * that would otherwise go on saying what they were.
 */

const LAST_RUN_ONLY = 1;

export interface ShellSummary {
  counts: Resource<CandidateCounts>;
  lastRun: Resource<Run | null>;
  reload: () => void;
}

export function useShellSummary(
  criteriaSetId: string | null,
  levelId: string | null,
  freshness: number,
): ShellSummary {
  const countsFetcher = useCallback(
    async (signal: AbortSignal): Promise<CandidateCounts> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!criteriaSetId || !levelId) throw new Error("no selection");

      const [candidates, ranking] = await Promise.all([
        fetchCandidates(levelId, { signal }),
        fetchRanking(criteriaSetId, levelId, { signal }),
      ]);

      return tallyMatchStatus(ranking.candidates, candidates.items.length);
    },
    [criteriaSetId, levelId],
  );

  const lastRunFetcher = useCallback(async (signal: AbortSignal): Promise<Run | null> => {
    const runs = await fetchRuns(LAST_RUN_ONLY, { signal });
    return runs.items[0] ?? null;
  }, []);

  const counts = useResource(
    countsFetcher,
    criteriaSetId !== null && levelId !== null,
    freshness,
  );
  const lastRun = useResource(lastRunFetcher, true, freshness);

  const reload = useCallback(() => {
    counts.reload();
    lastRun.reload();
  }, [counts, lastRun]);

  return { counts: counts.resource, lastRun: lastRun.resource, reload };
}
