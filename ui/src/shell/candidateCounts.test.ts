import { describe, expect, it } from "vitest";
import type { CandidateResult } from "../api/endpoints";
import { ApiError } from "../api/ApiError";
import { noRankingBecause, tallyMatchStatus } from "./candidateCounts";

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
    const counts = tallyMatchStatus([
      result("a", "matching"),
      result("b", "matching"),
      result("c", "not_matching"),
      result("d", "insufficient_data"),
    ]);

    expect(counts).toEqual({ matching: 2, notMatching: 1, insufficientData: 1 });
  });

  it("reports zeroes for an empty ranking", () => {
    expect(tallyMatchStatus([])).toEqual({ matching: 0, notMatching: 0, insufficientData: 0 });
  });

  it("ignores a status the client does not know", () => {
    const unknown = {
      ...result("x", "matching"),
      match_status: "something_new",
    } as unknown as CandidateResult;

    expect(tallyMatchStatus([unknown])).toEqual({
      matching: 0,
      notMatching: 0,
      insufficientData: 0,
    });
  });
});

describe("noRankingBecause", () => {
  function refused(code: string): ApiError {
    return new ApiError({ code, message: "the server's words", status: 409 });
  }

  it("words the unset score range and an unrankable set, never with the code", () => {
    expect(noRankingBecause(refused("score_scale_not_set"))).toMatch(/score range is not set/);
    expect(noRankingBecause(refused("cannot_be_ranked"))).toMatch(/cannot be ranked/);
    expect(noRankingBecause(refused("score_scale_not_set"))).not.toContain("score_scale");
  });

  it("is null for a fault, so the fault is reported as one", () => {
    expect(noRankingBecause(refused("not_found"))).toBeNull();
    expect(noRankingBecause(new Error("boom"))).toBeNull();
    expect(noRankingBecause(undefined)).toBeNull();
  });
});
