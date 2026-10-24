import { describe, expect, it } from "vitest";
import { statusTag } from "./statusTag";

/** PL-095. A candidate that does not match, or cannot be scored, says so and why. */
describe("a candidate's status tag", () => {
  it("is nothing on a matching candidate", () => {
    expect(statusTag({ match_status: "matching" })).toBeNull();
  });

  it("names a non-match in words, with the reasons it was given", () => {
    expect(
      statusTag({
        match_status: "not_matching",
        non_match_reasons: [
          { reason_detail: "No visa route this household qualifies for." },
          { reason_detail: "The quota is full." },
        ],
      }),
    ).toEqual({
      status: "not_matching",
      label: "Not matching",
      reason: "No visa route this household qualifies for. The quota is full.",
    });
  });

  it("says why a candidate could not be scored", () => {
    expect(
      statusTag({ match_status: "insufficient_data", insufficient_reason: "too little data" }),
    ).toEqual({ status: "insufficient_data", label: "Insufficient data", reason: "too little data" });
  });

  it("still tags a candidate whose reason was not given", () => {
    expect(statusTag({ match_status: "insufficient_data", insufficient_reason: null })).toEqual({
      status: "insufficient_data",
      label: "Insufficient data",
      reason: null,
    });
  });
});
