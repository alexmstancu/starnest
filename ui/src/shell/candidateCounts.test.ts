import { describe, expect, it } from "vitest";
import type { CandidateResult } from "../api/endpoints";
import { NO_COUNTS, tallyMatchStatus } from "./candidateCounts";

function result(candidate: string, status: CandidateResult["match_status"]): CandidateResult {
  return {
    candidate,
    name: candidate,
    score: status === "insufficient_data" ? null : 50,
    coverage: 80,
    match_status: status,
  };
}

describe("tallyMatchStatus", () => {
  it("counts each of the three statuses", () => {
    const counts = tallyMatchStatus(
      [
        result("a", "matching"),
        result("b", "matching"),
        result("c", "not_matching"),
        result("d", "insufficient_data"),
      ],
      4,
    );

    expect(counts).toEqual({ total: 4, matching: 2, notMatching: 1, insufficientData: 1 });
  });

  it("reports zeroes for an empty ranking", () => {
    expect(tallyMatchStatus([], 0)).toEqual(NO_COUNTS);
  });

  it("takes the total from the candidate list, not from the ranking", () => {
    // A candidate present in the catalog but absent from the ranking must not vanish from the
    // total -- the sidebar's job is to make that discrepancy visible, not to hide it.
    const counts = tallyMatchStatus([result("a", "matching")], 4);

    expect(counts.total).toBe(4);
    expect(counts.matching).toBe(1);
  });

  it("ignores a status the client does not know", () => {
    const unknown = {
      ...result("x", "matching"),
      match_status: "something_new",
    } as unknown as CandidateResult;

    expect(tallyMatchStatus([unknown], 1)).toEqual({
      total: 1,
      matching: 0,
      notMatching: 0,
      insufficientData: 0,
    });
  });
});
