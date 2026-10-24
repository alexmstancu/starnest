import { type ErrorCode, isApiError } from "../api/ApiError";
import type { CandidateResult } from "../api/endpoints";

/**
 * The three counts the sidebar shows beside Total (`reqs.md` 8.1): matching, not matching,
 * insufficient data. Total is the roster's length and is read on its own (PL-005).
 *
 * **This tallies; it does not decide.** `match_status` was computed by `evaluation/` and
 * arrived over the wire; counting how many rows carry each value is presentation, in the same
 * way that sorting a rendered table is. Nothing here evaluates a threshold, a coverage figure
 * or a rule.
 *
 * That the tally happens here at all is a gap in `docs/openapi.yaml`: the sidebar needs four
 * integers on every screen and the only way to obtain them is to fetch an entire ranking. See
 * the note in the W2-D report.
 */

export interface MatchCounts {
  matching: number;
  notMatching: number;
  insufficientData: number;
}

export function tallyMatchStatus(results: readonly CandidateResult[]): MatchCounts {
  const counts: MatchCounts = { matching: 0, notMatching: 0, insufficientData: 0 };

  for (const result of results) {
    if (result.match_status === "matching") counts.matching += 1;
    else if (result.match_status === "not_matching") counts.notMatching += 1;
    else if (result.match_status === "insufficient_data") counts.insufficientData += 1;
  }

  return counts;
}

/**
 * Why the ranking has no counts to give, when the reason is a state rather than a fault
 * (PL-005): said in words, because the sidebar never prints a code.
 */
const NO_RANKING_BECAUSE: Partial<Record<ErrorCode, string>> = {
  score_scale_not_set:
    "Matching, not matching and insufficient data depend on a score, and the top of the " +
    "score range is not set yet.",
  cannot_be_ranked:
    "Matching, not matching and insufficient data depend on a score, and this criteria set " +
    "cannot be ranked as it stands.",
};

/** The sentence for a refusal that leaves the ranking empty by design, or null for a fault. */
export function noRankingBecause(error: unknown): string | null {
  if (!isApiError(error)) return null;
  return NO_RANKING_BECAUSE[error.code as ErrorCode] ?? null;
}

/**
 * Which levels have a candidate at all.
 *
 * **This is what decides whether a level can be chosen**, and it is data rather than a name:
 * v1 ranks countries because countries are what the catalog holds candidates for, not because
 * the word "city" appears in a condition somewhere. The day city candidates are nominated the
 * level offers itself, with no change here (`reqs.md` 3.1: no code may assume there are
 * exactly two levels).
 */
export function levelsWithCandidates(
  candidates: readonly { level: string }[],
): Set<string> {
  return new Set(candidates.map((candidate) => candidate.level));
}
