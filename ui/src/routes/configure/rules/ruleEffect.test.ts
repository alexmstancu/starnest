import { describe, expect, it } from "vitest";
import type { CandidateResult, Ranking } from "../../../api/endpoints";
import type { Idle, Read } from "../../../api/read";
import {
  describeClearance,
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

const enforced = { enforced: true, level: "country" };

const sentenceOf = (effect: { sentence: string }) => effect.sentence;

describe("what a rule costs", () => {
  /** "No answers recorded" and "answered, and rules nobody out" are different facts. */
  it("says a rule nobody has answered never fires", () => {
    expect(sentenceOf(describeEffect("uk", [], enforced))).toBe(
      "No answer has been recorded for this rule, so it never fires.",
    );
  });

  it("says when a rule is answered and rules nobody out", () => {
    expect(
      sentenceOf(describeEffect("uk", [answer("uk", "country.spain", "matching")], enforced),
    )).toBe("Answered for one candidate, and rules nobody out.");
  });

  it("counts the candidates it was answered for", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [
          answer("uk", "country.spain", "matching"),
          answer("uk", "country.malta", "matching"),
        ],
        enforced,
      ),
    )).toBe("Answered for 2 candidates, and rules nobody out.");
  });

  it("names the one candidate it removes", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [answer("uk", "country.united_kingdom", "not_matching")],
        enforced,
      ),
    )).toBe("Removes country.united_kingdom.");
  });

  it("names two or three candidates in a sentence", () => {
    expect(
      sentenceOf(describeEffect(
        "quota",
        [
          answer("quota", "b", "not_matching"),
          answer("quota", "a", "not_matching"),
        ],
        enforced,
      ),
    )).toBe("Removes 2 countries: a and b.");
  });

  /** A list of ids running off the row is not a sentence. */
  it("counts them once there are more than three", () => {
    expect(
      sentenceOf(describeEffect(
        "quota",
        ["a", "b", "c", "d", "e"].map((each) =>
          answer("quota", each, "not_matching"),
        ),
        enforced,
      ),
    )).toBe("Removes 5 countries: a, b, c and 2 more.");
  });

  it("uses the candidate's name where one is given", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [answer("uk", "country.united_kingdom", "not_matching")],
        { ...enforced, nameOf: () => "United Kingdom" },
      ),
    )).toBe("Removes United Kingdom.");
  });

  /** An unenforced rule states what it would do, then that it is not doing it. */
  it("says a switched-off rule is not doing what it would do", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [answer("uk", "country.united_kingdom", "not_matching")],
        { enforced: false, level: "country" },
      ),
    )).toBe("Removes country.united_kingdom — not while this is off.");
  });

  it("ignores answers belonging to another rule", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [answer("quota", "country.switzerland", "not_matching")],
        enforced,
      ),
    )).toBe("No answer has been recorded for this rule, so it never fires.");
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
      sentenceOf(describeEffect(
        "uk",
        [proposed("uk", "country.portugal", "not_matching")],
        enforced,
      ),
    )).toBe("1 proposed answer awaits confirmation, so this rules nobody out yet.");
  });

  it("says how many proposals wait, in the plural too", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [
          proposed("uk", "country.portugal", "not_matching"),
          proposed("uk", "country.spain", "matching"),
        ],
        enforced,
      ),
    )).toBe("2 proposed answers await confirmation, so this rules nobody out yet.");
  });

  it("removes only the confirmed, and mentions the proposals apart", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [
          answer("uk", "country.malta", "not_matching"),
          proposed("uk", "country.portugal", "not_matching"),
        ],
        enforced,
      ),
    )).toBe(
      "Removes country.malta. 1 proposed answer awaits confirmation and rules nobody out until then.",
    );
  });

  it("counts only the confirmed answers as answered", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [
          answer("uk", "country.spain", "matching"),
          proposed("uk", "country.portugal", "not_matching"),
          proposed("uk", "country.malta", "not_matching"),
        ],
        enforced,
      ),
    )).toBe(
      "Answered for one candidate, and rules nobody out. 2 proposed answers await confirmation and rule nobody out until then.",
    );
  });

  it("still says when a switched-off rule would do nothing either way", () => {
    expect(
      sentenceOf(describeEffect(
        "uk",
        [proposed("uk", "country.portugal", "not_matching")],
        { enforced: false, level: "country" },
      ),
    )).toBe(
      "1 proposed answer awaits confirmation, so this rules nobody out yet — not while this is off.",
    );
  });
});

/** UI-12. While the answers are not in, what a gate does is unknown -- never "nothing". */
describe("what a rule costs before its answers have been read", () => {
  it("says the answers are being read, rather than that the rule never fires", () => {
    expect(describeUnreadAnswers("loading").sentence).toBe("Reading the answers…");
  });

  it("says what it cannot know when the answers could not be read", () => {
    expect(describeUnreadAnswers("error").sentence).toBe(
      "The answers could not be read, so what this rule does is not known.",
    );
  });
});

/** PL-156. A gate held as a warning flags whom it would remove, and is coloured by it. */
describe("the colour and verb of a gate's sentence", () => {
  const removing = [answer("uk", "country.united_kingdom", "not_matching")];

  it("is red only when the gate removes someone", () => {
    expect(describeEffect("uk", removing, enforced).tone).toBe("removes");
    expect(
      describeEffect("uk", [answer("uk", "country.spain", "matching")], enforced).tone,
    ).toBe("nothing");
    expect(describeEffect("uk", [], enforced).tone).toBe("nothing");
  });

  it("flags rather than removes when the set holds it as a warning", () => {
    expect(describeEffect("uk", removing, { ...enforced, outcome: "warning" })).toEqual({
      sentence: "Flags country.united_kingdom.",
      tone: "flags",
    });
  });

  it("is not known while its answers are unread", () => {
    expect(describeUnreadAnswers("loading").tone).toBe("unknown");
  });
});

/**
 * PL-156. **Whom a compound rule flags is the live ranking's to say**: the candidates whose
 * warnings or reasons name it. A rule that is off is not evaluated, so it guesses nobody.
 */
describe("what a compound rule does", () => {
  const RULE = "country.rent_within_budget";
  const ruleWarning = { compound_rule: RULE, match_rule: null, detail: "Rent is high." };
  const result = (name: string, extra: Partial<CandidateResult> = {}): CandidateResult => ({
    candidate: `country.${name.toLowerCase()}`,
    name,
    rank: 1,
    score: 70,
    coverage: 90,
    match_status: "matching",
    parent_not_matching: false,
    ...extra,
  });
  const ready = (candidates: CandidateResult[]): Read<Ranking> => ({
    state: "ready",
    data: {
      criteria_set: "default",
      level: "country",
      computed_at: "2026-10-25T09:00:00Z",
      score_scale_max: 100,
      candidates,
    },
    readAt: new Date(),
    refresh: "idle",
  });
  const applied = (ranking: Read<Ranking> | Idle) => ({
    applied: true,
    outcome: "warning" as const,
    ranking,
    level: "country",
  });

  it("names the countries the ranking says it flags", () => {
    const ranking = ready([
      result("Spain", { warnings: [ruleWarning] }),
      result("Malta", { warnings: [ruleWarning] }),
      result("Portugal", { warnings: [ruleWarning] }),
      result("Ireland"),
    ]);
    expect(describeCompoundEffect(RULE, applied(ranking))).toEqual({
      sentence: "Flags 3 countries: Malta, Portugal and Spain.",
      tone: "flags",
    });
  });

  it("names whom it removes, in red", () => {
    const ranking = ready([
      result("Spain", {
        match_status: "not_matching",
        rank: null,
        non_match_reasons: [{ compound_rule: RULE, reason_detail: "Too hot." }],
      }),
    ]);
    expect(describeCompoundEffect(RULE, applied(ranking))).toEqual({
      sentence: "Removes Spain.",
      tone: "removes",
    });
  });

  it("ignores what another rule flags", () => {
    const other = { ...ruleWarning, compound_rule: "country.mild_and_connected" };
    expect(
      describeCompoundEffect(RULE, applied(ready([result("Spain", { warnings: [other] })]))),
    ).toEqual({ sentence: "Applies to no country right now.", tone: "nothing" });
  });

  it("applies to nobody in an empty ranking", () => {
    expect(describeCompoundEffect(RULE, applied(ready([])))).toEqual({
      sentence: "Applies to no country right now.",
      tone: "nothing",
    });
  });

  it("says it is reading the ranking, and what it cannot know when that failed", () => {
    expect(describeCompoundEffect(RULE, applied({ state: "pending" }))).toEqual({
      sentence: "Reading the ranking…",
      tone: "unknown",
    });
    expect(
      describeCompoundEffect(RULE, applied({ state: "failed", error: new Error("no") })),
    ).toEqual({
      sentence: "The ranking could not be read, so whom this rule acts on is not known.",
      tone: "unknown",
    });
  });

  it("says a rule that is not applied acts on nobody, in its own verb", () => {
    const off = { ...applied({ state: "idle" }), applied: false };
    expect(describeCompoundEffect(RULE, off).sentence).toBe("Not applied, so it flags nobody.");
    expect(describeCompoundEffect(RULE, { ...off, outcome: "not_matching" }).sentence).toBe(
      "Not applied, so it removes nobody.",
    );
  });
});

/** PL-164. What clears a gate, said with names, and what is not known said as such. */
describe("what clears a gate", () => {
  const nameOf = (id: string) => id.replace("country.", "").toUpperCase();
  const gate = (cleared_by: string[], decided_by_citizenship = false) => ({
    id: "g",
    cleared_by,
    decided_by_citizenship,
  });

  it("says nothing for a gate no citizenship clears", () => {
    expect(describeClearance(gate([]), { state: "reading" }, nameOf)).toBeNull();
  });

  it("counts a long list of clearing citizenships rather than naming them all", () => {
    expect(
      describeClearance(gate(["country.a", "country.b", "country.c", "country.d"]), { state: "reading" }, nameOf),
    ).toBe("Cleared by a citizenship of any of 4 countries.");
  });

  it("says a citizenship decision is unknown when the household cannot be read", () => {
    expect(describeClearance(gate(["country.a"], true), { state: "failed" }, nameOf)).toBe(
      "Decided by citizenship. Yours could not be read.",
    );
  });
});
