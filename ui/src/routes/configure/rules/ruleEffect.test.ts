import { describe, expect, it } from "vitest";
import {
  type RuleResult,
  describeCompoundEffect,
  describeEffect,
  describeUnreadAnswers,
} from "./ruleEffect";

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

/**
 * UI-12. **A proposal rules nobody out until a person confirms it** (Q218). Counting one as a
 * removal said a gate was costing a candidate its rank when the ranking ignores it entirely.
 */
describe("what a rule costs while answers are only proposed", () => {
  const proposed = (
    rule: string,
    candidate: string,
    match_result: string,
  ): RuleResult => ({ match_rule: rule, candidate, match_result, is_proposal: true });

  it("does not count a proposal as removing anyone", () => {
    expect(
      describeEffect(
        "uk",
        [proposed("uk", "country.portugal", "not_matching")],
        enforced,
      ),
    ).toBe("1 proposed answer awaits confirmation, so this rules nobody out yet.");
  });

  it("says how many proposals wait, in the plural too", () => {
    expect(
      describeEffect(
        "uk",
        [
          proposed("uk", "country.portugal", "not_matching"),
          proposed("uk", "country.spain", "matching"),
        ],
        enforced,
      ),
    ).toBe("2 proposed answers await confirmation, so this rules nobody out yet.");
  });

  it("removes only the confirmed, and mentions the proposals apart", () => {
    expect(
      describeEffect(
        "uk",
        [
          answer("uk", "country.malta", "not_matching"),
          proposed("uk", "country.portugal", "not_matching"),
        ],
        enforced,
      ),
    ).toBe(
      "Removes country.malta. 1 proposed answer awaits confirmation and rules nobody out until then.",
    );
  });

  it("counts only the confirmed answers as answered", () => {
    expect(
      describeEffect(
        "uk",
        [
          answer("uk", "country.spain", "matching"),
          proposed("uk", "country.portugal", "not_matching"),
          proposed("uk", "country.malta", "not_matching"),
        ],
        enforced,
      ),
    ).toBe(
      "Answered for one candidate, and rules nobody out. 2 proposed answers await confirmation and rule nobody out until then.",
    );
  });

  it("still says when a switched-off rule would do nothing either way", () => {
    expect(
      describeEffect(
        "uk",
        [proposed("uk", "country.portugal", "not_matching")],
        { enforced: false },
      ),
    ).toBe(
      "1 proposed answer awaits confirmation, so this rules nobody out yet. Not while this is off.",
    );
  });
});

/** UI-12. While the answers are not in, what a gate does is unknown -- never "nothing". */
describe("what a rule costs before its answers have been read", () => {
  it("says the answers are being read, rather than that the rule never fires", () => {
    expect(describeUnreadAnswers("loading")).toBe("Reading the answers…");
  });

  it("says what it cannot know when the answers could not be read", () => {
    expect(describeUnreadAnswers("error")).toBe(
      "The answers could not be read, so what this rule does is not known.",
    );
  });
});

/**
 * UI-12. **Who a compound rule flags is a ranking's to say**, and the rules screen reads no
 * ranking -- so it says where to look rather than inventing "nobody".
 */
describe("what a compound rule does", () => {
  it("points to Rank for who an applied rule flags", () => {
    expect(describeCompoundEffect(true)).toBe(
      "Applied. Who it flags right now is shown on Rank.",
    );
  });

  it("says a rule that is not applied flags nobody", () => {
    expect(describeCompoundEffect(false)).toBe("Not applied, so it flags nobody.");
  });
});
