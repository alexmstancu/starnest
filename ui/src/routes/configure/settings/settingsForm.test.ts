import { describe, expect, it } from "vitest";
import { draftOf, settingsFrom, type SettingsDraft } from "./settingsForm";

/**
 * The four tuning values, as text and back.
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
