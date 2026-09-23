import { describe, expect, it } from "vitest";
import {
  SETTING_FIELDS,
  draftOf,
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
      "candidates",
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

  it("gives every setting a consequence written in plain words", () => {
    for (const field of SETTING_FIELDS) {
      expect(field.consequence.length).toBeGreaterThan(0);
      // A consequence is what is true while it is blank, so it must not merely restate the
      // description of what the setting is for.
      expect(field.consequence).not.toBe(field.description);
    }
  });
});
