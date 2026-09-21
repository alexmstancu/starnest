import { describe, expect, it } from "vitest";
import { type RuleResult, describeEffect } from "./ruleEffect";

const answer = (
  rule: string,
  candidate: string,
  match_result: string,
): RuleResult => ({ match_rule: rule, candidate, match_result });

const enforced = { enforced: true };

describe("what a rule costs", () => {
  /** "No answers recorded" and "answered, and rules nobody out" are different facts. */
  it("says a rule nobody has answered never fires", () => {
    expect(describeEffect("uk", [], enforced)).toBe(
      "No answer has been recorded for this rule, so it never fires.",
    );
  });

  it("says when a rule is answered and rules nobody out", () => {
    expect(
      describeEffect("uk", [answer("uk", "country.spain", "matching")], enforced),
    ).toBe("Answered for one candidate, and rules nobody out.");
  });

  it("counts the candidates it was answered for", () => {
    expect(
      describeEffect(
        "uk",
        [
          answer("uk", "country.spain", "matching"),
          answer("uk", "country.malta", "matching"),
        ],
        enforced,
      ),
    ).toBe("Answered for 2 candidates, and rules nobody out.");
  });

  it("names the one candidate it removes", () => {
    expect(
      describeEffect(
        "uk",
        [answer("uk", "country.united_kingdom", "not_matching")],
        enforced,
      ),
    ).toBe("Removes country.united_kingdom.");
  });

  it("names two or three candidates in a sentence", () => {
    expect(
      describeEffect(
        "quota",
        [
          answer("quota", "b", "not_matching"),
          answer("quota", "a", "not_matching"),
        ],
        enforced,
      ),
    ).toBe("Removes a and b.");
  });

  /** A list of ids running off the row is not a sentence. */
  it("counts them once there are more than three", () => {
    expect(
      describeEffect(
        "quota",
        ["a", "b", "c", "d", "e"].map((each) =>
          answer("quota", each, "not_matching"),
        ),
        enforced,
      ),
    ).toBe("Removes 5 candidates: a, b, c and 2 more.");
  });

  it("uses the candidate's name where one is given", () => {
    expect(
      describeEffect(
        "uk",
        [answer("uk", "country.united_kingdom", "not_matching")],
        { enforced: true, nameOf: () => "United Kingdom" },
      ),
    ).toBe("Removes United Kingdom.");
  });

  /** An unenforced rule states what it would do, then that it is not doing it. */
  it("says a switched-off rule is not doing what it would do", () => {
    expect(
      describeEffect(
        "uk",
        [answer("uk", "country.united_kingdom", "not_matching")],
        { enforced: false },
      ),
    ).toBe("Removes country.united_kingdom. Not while this is off.");
  });

  it("ignores answers belonging to another rule", () => {
    expect(
      describeEffect(
        "uk",
        [answer("quota", "country.switzerland", "not_matching")],
        enforced,
      ),
    ).toBe("No answer has been recorded for this rule, so it never fires.");
  });
});
