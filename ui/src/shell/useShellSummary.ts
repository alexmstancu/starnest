import { useCallback } from "react";
import { fetchCandidates, fetchRanking, fetchRuns, type Run } from "../api/endpoints";
import type { Idle, Read } from "../api/read";
import { useRead } from "../api/useRead";
import { tallyMatchStatus, type MatchCounts } from "./candidateCounts";

/**
 * The figures the sidebar carries besides the selectors: how many candidates the level holds,
 * how the ranking splits them, and the most recent data acquisition run.
 *
 * **Total and the split are two reads** (PL-005). Total needs no score, so it comes from the
 * roster at the level; the split comes from the ranking, which the server refuses while the top
 * of the score range is unset. Fetched together, that refusal took Total down with it.
 *
 * The counts depend on the selection, so they re-fetch when it changes -- which is also why
 * they are not cached: a criteria set change makes every previous count wrong (`reqs.md`
 * section 3.4a, score and match status belong to an Evaluation, not to a candidate).
 *
 * **All three are read again whenever `freshness` changes** (UI-11), keeping what they show
 * until the answer lands (PL-010): something elsewhere -- another screen, or a run that has
 * just ended -- may have moved them, and the sidebar is the one place that would otherwise go
 * on saying what they were.
 */

const LAST_RUN_ONLY = 1;

export interface ShellSummary {
  total: Read<number> | Idle;
  counts: Read<MatchCounts> | Idle;
  lastRun: Read<Run | null> | Idle;
  reloadTotal: () => Promise<void>;
  reloadCounts: () => Promise<void>;
  reloadLastRun: () => Promise<void>;
}

export function useShellSummary(
  criteriaSetId: string | null,
  levelId: string | null,
  freshness: number,
): ShellSummary {
  const totalFetcher = useCallback(
    async (signal: AbortSignal): Promise<number> => {
      // Not reachable while disabled; the guard is here so the type is honest.
      if (!levelId) throw new Error("no level");
      const candidates = await fetchCandidates(levelId, { signal });
      return candidates.items.length;
    },
    [levelId],
  );

  const countsFetcher = useCallback(
    async (signal: AbortSignal): Promise<MatchCounts> => {
      if (!criteriaSetId || !levelId) throw new Error("no selection");
      const ranking = await fetchRanking(criteriaSetId, levelId, { signal });
      return tallyMatchStatus(ranking.candidates);
    },
    [criteriaSetId, levelId],
  );

  const lastRunFetcher = useCallback(async (signal: AbortSignal): Promise<Run | null> => {
    const runs = await fetchRuns(LAST_RUN_ONLY, { signal });
    return runs.items[0] ?? null;
  }, []);

  const total = useRead(totalFetcher, { enabled: levelId !== null, freshness });
  const counts = useRead(countsFetcher, {
    enabled: criteriaSetId !== null && levelId !== null,
    freshness,
  });
  const lastRun = useRead(lastRunFetcher, { freshness });

  return {
    total: total.read,
    counts: counts.read,
    lastRun: lastRun.read,
    reloadTotal: total.reload,
    reloadCounts: counts.reload,
    reloadLastRun: lastRun.reload,
  };
}
