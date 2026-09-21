import type { CandidateResult } from "../api/endpoints";

/**
 * The four counts the sidebar shows (`reqs.md` 8.1): total, matching, not matching,
 * insufficient data.
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

export interface CandidateCounts {
  total: number;
  matching: number;
  notMatching: number;
  insufficientData: number;
}

export const NO_COUNTS: CandidateCounts = {
  total: 0,
  matching: 0,
  notMatching: 0,
  insufficientData: 0,
};

export function tallyMatchStatus(results: readonly CandidateResult[], total: number): CandidateCounts {
  const counts: CandidateCounts = { ...NO_COUNTS, total };

  for (const result of results) {
    if (result.match_status === "matching") counts.matching += 1;
    else if (result.match_status === "not_matching") counts.notMatching += 1;
    else if (result.match_status === "insufficient_data") counts.insufficientData += 1;
  }

  return counts;
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
