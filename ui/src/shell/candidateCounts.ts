import type { CandidateResult } from "../api/endpoints";

/**
 * The four counts the sidebar shows (`reqs.md` §8.1): total, matching, not matching,
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
