import { describe, expect, it } from "vitest";
import {
  SETTING_FIELDS,
  describeUnset,
  draftOf,
  invalidSettings,
  isBlocked,
  settingsFrom,
  type SettingsDraft,
  unsetFields,
} from "./settingsForm";

/**
 * The five tuning values, as text and back.
 *
 * **The empty case is the one that matters.** Every setting is provisional (`reqs.md` 3.10), so
 * an emptied field must stay empty and travel as null: a score scale of 100 nobody chose is the
 * fabricated number this application exists to avoid.
 */

const SET: SettingsDraft = {
  score_scale_max: "100",
  min_coverage: "60",
  comparator_limit: "5",
  run_spend_cap_eur: "10",
  refetch_older_than_days: "365",
};

describe("settings becoming a draft", () => {
  it("holds each value as text", () => {
    expect(draftOf({ score_scale_max: 100, min_coverage: 60 })).toMatchObject({
      score_scale_max: "100",
      min_coverage: "60",
    });
  });

  it("shows an unset value as empty rather than as zero", () => {
    const unset = draftOf({ score_scale_max: null, min_coverage: null });

    expect(unset.score_scale_max).toBe("");
    expect(unset.min_coverage).toBe("");
  });

  it("shows a missing value as empty too", () => {
    expect(draftOf({}).comparator_limit).toBe("");
  });

  /** T32-1 (PL-032). The cap is euros, and the design shows it with its cents. */
  it("shows the spend cap with its cents, and reads it back as the same figure", () => {
    const draft = draftOf({ run_spend_cap_eur: 5 });

    expect(draft.run_spend_cap_eur).toBe("5.00");
    expect(settingsFrom({ ...SET, run_spend_cap_eur: draft.run_spend_cap_eur }).run_spend_cap_eur).toBe(5);
  });

  /** T32-2. A stored figure with more decimals than money takes is shown whole, never rounded. */
  it("shows a stored cap with three decimals in full, and calls it invalid", () => {
    const draft = draftOf({ run_spend_cap_eur: 5.555 });

    expect(draft.run_spend_cap_eur).toBe("5.555");
    expect(invalidSettings({ ...SET, run_spend_cap_eur: draft.run_spend_cap_eur })).toEqual([
      "run_spend_cap_eur",
    ]);
  });
});

describe("a draft becoming settings", () => {
  it("reads each typed number", () => {
    expect(settingsFrom(SET)).toEqual({
      score_scale_max: 100,
      min_coverage: 60,
      comparator_limit: 5,
      run_spend_cap_eur: 10,
      refetch_older_than_days: 365,
    });
  });

  it("sends an emptied field as null, not as zero", () => {
    const cleared = settingsFrom({ ...SET, score_scale_max: "" });

    expect(cleared.score_scale_max).toBeNull();
  });

  it("treats a field of spaces as empty", () => {
    expect(
      settingsFrom({ ...SET, min_coverage: "   " }).min_coverage,
    ).toBeNull();
  });

  it("refuses to turn a draft the form would refuse into null", () => {
    expect(() => settingsFrom({ ...SET, comparator_limit: "25" })).toThrow();
  });

  it("keeps a real zero, because zero can be a decision", () => {
    /** A spend cap of zero means "fetch nothing that costs", which is a choice. */
    expect(
      settingsFrom({ ...SET, run_spend_cap_eur: "0" }).run_spend_cap_eur,
    ).toBe(0);
  });
});

describe("what a blank setting costs", () => {
  const filled: SettingsDraft = {
    score_scale_max: "100",
    min_coverage: "60",
    comparator_limit: "5",
    run_spend_cap_eur: "5",
    refetch_older_than_days: "365",
  };

  it("finds nothing unset when all five are filled", () => {
    expect(unsetFields(filled)).toEqual([]);
    expect(isBlocked(filled)).toBe(false);
  });

  /**
   * The order is the screen's, not the record's: the coverage floor leads and the score scale
   * follows it, so a list that came back in declaration order would read differently from the
   * fields it is describing.
   */
  it("names the fields left blank, in the order they are shown", () => {
    const draft = { ...filled, score_scale_max: "", min_coverage: "" };
    expect(unsetFields(draft).map((field) => field.name)).toEqual([
      "min_coverage",
      "score_scale_max",
    ]);
  });

  /** Every field is counted in something, and a field with no unit would print a bare box. */
  it("counts every setting in a stated unit", () => {
    expect(SETTING_FIELDS.map((field) => field.unit)).toEqual([
      "%",
      "points",
      "candidates (1–20)",
      "€",
      "days",
    ]);
  });

  it("treats a field of spaces as blank", () => {
    expect(unsetFields({ ...filled, comparator_limit: "   " })).toHaveLength(1);
  });

  /**
   * The distinction the design's R3 turns on: an unset score scale stops the product working,
   * while the other four merely leave a rule off. One red, four amber.
   */
  it("blocks only on the score scale", () => {
    expect(isBlocked({ ...filled, score_scale_max: "" })).toBe(true);
    expect(isBlocked({ ...filled, min_coverage: "" })).toBe(false);
    expect(isBlocked({ ...filled, comparator_limit: "" })).toBe(false);
    expect(isBlocked({ ...filled, run_spend_cap_eur: "" })).toBe(false);
  });

  it("blocks when everything is blank, which is the shipped state", () => {
    const blank: SettingsDraft = {
      score_scale_max: "",
      min_coverage: "",
      comparator_limit: "",
      run_spend_cap_eur: "",
      refetch_older_than_days: "",
    };
    expect(unsetFields(blank)).toHaveLength(5);
    expect(isBlocked(blank)).toBe(true);
  });

  /**
   * **Read by someone deciding whether to fill the box in**, so a consequence has to be a
   * sentence about what happens next and not a second label. The two things a reader notices
   * at once are what is asserted: no identifier from the contract leaks into it, and it reads
   * as a sentence. A length greater than zero stood here and could not fail for any wording.
   */
  it("gives every setting a consequence written in plain words", () => {
    for (const field of SETTING_FIELDS) {
      // `insufficient_data` and `score_scale_max` are the contract's words, not a reader's, and
      // a description is read by the same reader (PL-031, C02-S6).
      expect(field.consequence).not.toMatch(/[a-z]+_[a-z_]+/);
      expect(field.description).not.toMatch(/[a-z]+_[a-z_]+/);
      expect(field.consequence).toMatch(/^[A-Z].*\.$/);
      // A consequence is what is true while it is blank, so it must not merely restate the
      // description of what the setting is for.
      expect(field.consequence).not.toBe(field.description);
    }
  });
});

/** PL-031. Stage 6 says what each setting does in a reader's words, and all of what it does. */
describe("the settings in words", () => {
  const field = (name: string) => SETTING_FIELDS.find((each) => each.name === name)!;

  it("says a candidate below the floor has insufficient data and no score", () => {
    expect(field("min_coverage").description).toBe(
      "Below this, a candidate has insufficient data and shows no score.",
    );
  });

  it("says the cap bounds each gate-research pass as well as an acquisition", () => {
    expect(field("run_spend_cap_eur").description).toBe(
      "An acquisition halts here, keeping what it fetched, and so does each gate-research pass.",
    );
    expect(field("run_spend_cap_eur").consequence).toMatch(/gate-research pass/);
  });
});

/** UI-10. A field that holds text no number can be read from is neither set nor unset. */
describe("a setting that holds no number", () => {
  it("calls a lone decimal point invalid rather than unset", () => {
    expect(invalidSettings({ ...SET, min_coverage: "." })).toEqual([
      "min_coverage",
    ]);
  });

  it("names every invalid field, in the order they are shown", () => {
    expect(
      invalidSettings({
        ...SET,
        run_spend_cap_eur: ".",
        min_coverage: "9".repeat(400),
      }),
    ).toEqual(["min_coverage", "run_spend_cap_eur"]);
  });

  it("finds nothing invalid in blank fields or numbers", () => {
    expect(invalidSettings({ ...SET, score_scale_max: "" })).toEqual([]);
  });
});

/** PL-028 and PL-030. Each field's range is the contract's, and a figure outside it is held. */
describe("a setting outside its range", () => {
  it.each([
    ["min_coverage", "150"],
    ["min_coverage", "-1"],
    ["score_scale_max", "0"],
    ["comparator_limit", "0"],
    ["comparator_limit", "21"],
    ["comparator_limit", "2.5"],
    ["run_spend_cap_eur", "-5"],
    ["run_spend_cap_eur", "72.000"],
    ["refetch_older_than_days", "0"],
  ] as const)("holds %s at %s", (name, typed) => {
    expect(invalidSettings({ ...SET, [name]: typed })).toEqual([name]);
  });

  it.each([
    ["min_coverage", "100"],
    ["min_coverage", "0"],
    ["min_coverage", "57.5"],
    ["comparator_limit", "1"],
    ["comparator_limit", "20"],
    ["run_spend_cap_eur", "0"],
    ["run_spend_cap_eur", "12.50"],
  ] as const)("accepts %s at its edge or inside, %s", (name, typed) => {
    expect(invalidSettings({ ...SET, [name]: typed })).toEqual([]);
  });

  it("refuses a comma rather than reading it as a point", () => {
    expect(invalidSettings({ ...SET, min_coverage: "57,5" })).toEqual(["min_coverage"]);
  });

  it("states the comparator limit's range as 1 to 20", () => {
    const limit = SETTING_FIELDS.find((field) => field.name === "comparator_limit");

    expect(limit?.rule).toMatchObject({ kind: "whole", minimum: 1, maximum: 20 });
  });
});

/**
 * UI-31. **The guidance said the opposite of what happens.** Compare refuses a comparison while
 * the limit is unset (`comparator_limit_not_set`); it never accepted "as many as you pick".
 */
describe("what an unset comparator limit costs", () => {
  it("says an unset comparator limit stops every comparison", () => {
    const limit = SETTING_FIELDS.find(
      (field) => field.name === "comparator_limit",
    );

    expect(limit?.consequence).toBe(
      "Compare refuses every comparison until this is set.",
    );
    // Advisory still: ranking works without it, so the one blocking banner stays the scale's;
    // what it stops is Compare, and the summary says so (PL-030).
    expect(limit?.severity).toBe("advisory");
  });
});

describe("the summary of the blanks", () => {
  const field = (name: string) => SETTING_FIELDS.find((each) => each.name === name)!;

  it("says one blank leaves its rule off", () => {
    expect(describeUnset([field("min_coverage")])).toBe(
      "One setting is not set, so the rule behind it is not in force.",
    );
  });

  it("says several blanks leave their rules off", () => {
    expect(describeUnset([field("min_coverage"), field("refetch_older_than_days")])).toBe(
      "2 settings are not set, so the rules behind them are not in force.",
    );
  });

  it("names Compare when the comparator limit is the blank", () => {
    expect(describeUnset([field("comparator_limit")])).toBe(
      "One setting is not set: Compare refuses every comparison until the comparator limit is set.",
    );
  });

  it("names Compare first, and the other rule after it", () => {
    expect(describeUnset([field("min_coverage"), field("comparator_limit")])).toBe(
      "2 settings are not set: Compare refuses every comparison until the comparator limit " +
        "is set, and the rule behind the other is not in force.",
    );
  });

  it("counts the others when there are several", () => {
    expect(
      describeUnset([
        field("min_coverage"),
        field("comparator_limit"),
        field("refetch_older_than_days"),
      ]),
    ).toBe(
      "3 settings are not set: Compare refuses every comparison until the comparator limit " +
        "is set, and the rules behind the other 2 are not in force.",
    );
  });
});
