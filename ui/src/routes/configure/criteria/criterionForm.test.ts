import { describe, expect, it } from "vitest";
import {
  anEmptyAnchor,
  draftFrom,
  ruleFrom,
  type RuleDraft,
} from "./criterionForm";

/**
 * Reading a typed criterion rule.
 *
 * The line this module holds is between **parsing** and **judging**: whether "abc" is a number
 * is this module's business, and whether a band may be drawn under `percentile` is the
 * server's. A second copy of the second question here would be a rule that could disagree with
 * the one that counts.
 */

const A_CRITERION = {
  attribute: "country.rent_centre",
  pillar: "housing",
  weight: 40,
  weight_locked: false,
  is_scored: true,
  goal: "minimise" as const,
  normalisation_method: "fixed" as const,
  blocks_if_missing: false,
};

function aDraft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return {
    goal: "minimise",
    normalisation_method: "fixed",
    blocks_if_missing: false,
    target_range_min: "",
    target_range_max: "",
    zero_score_below: "",
    zero_score_above: "",
    anchors: [],
    threshold_min: "",
    threshold_max: "",
    threshold_this_form_cannot_edit: null,
    ...overrides,
  };
}

describe("the stored criterion as a draft", () => {
  it("shows an absent number as an empty field, never as a zero", () => {
    const draft = draftFrom(A_CRITERION);

    expect(draft.target_range_min).toBe("");
    expect(draft.threshold_max).toBe("");
  });

  it("shows a zero as a zero, because somebody chose it", () => {
    const draft = draftFrom({ ...A_CRITERION, target_range_min: 0 });

    expect(draft.target_range_min).toBe("0");
  });

  it("carries the anchors with their labels", () => {
    const draft = draftFrom({
      ...A_CRITERION,
      scale_anchors: [
        { input_value: 500, score: 100, label: "cheap" },
        { input_value: 1500, score: 0, label: null },
      ],
    });

    expect(draft.anchors).toEqual([
      { input_value: "500", score: "100", label: "cheap" },
      { input_value: "1500", score: "0", label: "" },
    ]);
  });

  it("reads a range threshold's bounds", () => {
    const draft = draftFrom({
      ...A_CRITERION,
      matching_threshold: { min_value: null, max_value: 12 },
    });

    expect(draft.threshold_min).toBe("");
    expect(draft.threshold_max).toBe("12");
    expect(draft.threshold_this_form_cannot_edit).toBeNull();
  });

  it("keeps a threshold of a shape it cannot edit rather than reading past it", () => {
    // P52: the cast to `{min_value, max_value}` was unconditional, so a label, boolean or
    // share threshold read as two empty fields -- no sign a threshold existed at all. The
    // contract defines four shapes and the backend implements all four, with a storage table
    // each; this form edits one of them.
    const draft = draftFrom({
      ...A_CRITERION,
      matching_threshold: {
        labels: [{ label: "Csb", containment_rule: "must_contain" }],
      },
    });

    expect(draft.threshold_min).toBe("");
    expect(draft.threshold_max).toBe("");
    expect(draft.threshold_this_form_cannot_edit).toEqual({
      labels: [{ label: "Csb", containment_rule: "must_contain" }],
    });
  });
});

describe("the draft as something to send", () => {
  it("sends the numbers it parsed", () => {
    const parsed = ruleFrom(
      aDraft({
        goal: "target_range",
        target_range_min: "5",
        target_range_max: "10",
        zero_score_below: "0",
        zero_score_above: "30",
      }),
    );

    expect(parsed.problems).toEqual([]);
    expect(parsed.rule).toMatchObject({
      goal: "target_range",
      target_range_min: 5,
      target_range_max: 10,
      zero_score_below: 0,
      zero_score_above: 30,
    });
  });

  it("sends null for a field left empty, so a bound can be removed", () => {
    const parsed = ruleFrom(aDraft({ target_range_min: "" }));

    expect(parsed.rule?.target_range_min).toBeNull();
  });

  it("refuses a figure that is not one, naming the field", () => {
    const parsed = ruleFrom(aDraft({ target_range_max: "soon" }));

    expect(parsed.rule).toBeNull();
    expect(parsed.problems).toEqual(["The band's maximum must be a number."]);
  });

  it("reports every problem at once rather than the first", () => {
    const parsed = ruleFrom(
      aDraft({ target_range_min: "x", threshold_max: "y" }),
    );

    expect(parsed.problems).toHaveLength(2);
  });

  it("sends no threshold when both bounds are empty", () => {
    const parsed = ruleFrom(aDraft());

    expect(parsed.rule?.matching_threshold).toBeNull();
  });

  it("sends a one-sided threshold as one bound and a null", () => {
    const parsed = ruleFrom(aDraft({ threshold_max: "12" }));

    expect(parsed.rule?.matching_threshold).toEqual({
      min_value: null,
      max_value: 12,
    });
  });

  it("says nothing about a threshold shape it cannot edit, rather than clearing it", () => {
    // **Omitted, not null** (P52). The contract documents `matching_threshold: null` as "Null
    // clears it", and PATCH changes only the fields present -- so saying nothing is the only
    // way to leave a shape this form cannot show alone. Editing the goal of a criterion with
    // a label threshold used to delete that threshold, with nothing on screen saying so.
    const parsed = ruleFrom(
      aDraft({
        goal: "maximise",
        threshold_this_form_cannot_edit: {
          labels: [{ label: "Csb", containment_rule: "must_contain" }],
        },
      }),
    );

    expect(parsed.problems).toEqual([]);
    expect(parsed.rule).not.toBeNull();
    expect("matching_threshold" in (parsed.rule ?? {})).toBe(false);
    expect(parsed.rule?.goal).toBe("maximise");
  });

  it("drops an anchor row nobody filled in", () => {
    const parsed = ruleFrom(aDraft({ anchors: [anEmptyAnchor()] }));

    expect(parsed.problems).toEqual([]);
    expect(parsed.rule?.scale_anchors).toEqual([]);
  });

  it("refuses a half-filled anchor, because a value without a score maps nothing", () => {
    const parsed = ruleFrom(
      aDraft({ anchors: [{ input_value: "500", score: "", label: "" }] }),
    );

    expect(parsed.rule).toBeNull();
    expect(parsed.problems).toEqual([
      "Anchor 1 needs both a value and a score.",
    ]);
  });

  it("sends an anchor with no label as a null rather than an empty word", () => {
    const parsed = ruleFrom(
      aDraft({
        anchors: [
          { input_value: "500", score: "100", label: "  " },
          { input_value: "1500", score: "0", label: " dear " },
        ],
      }),
    );

    expect(parsed.rule?.scale_anchors).toEqual([
      { input_value: 500, score: 100, label: null },
      { input_value: 1500, score: 0, label: "dear" },
    ]);
  });

  it("refuses a goal that is not one of the three", () => {
    const parsed = ruleFrom(aDraft({ goal: "whatever" }));

    expect(parsed.rule).toBeNull();
    expect(parsed.problems).toEqual(["whatever is not a goal."]);
  });

  it("refuses a normalisation method that is not one of the three", () => {
    const parsed = ruleFrom(aDraft({ normalisation_method: "vibes" }));

    expect(parsed.rule).toBeNull();
    expect(parsed.problems).toEqual(["vibes is not a normalisation method."]);
  });

  it("says nothing about a band under a method that cannot draw one", () => {
    /**
     * Deliberately not this module's question. The server refuses it (`0468`), and a copy of
     * that rule here could disagree with the one that counts -- which is the same argument as
     * the weight rebalancing.
     */
    const parsed = ruleFrom(
      aDraft({
        goal: "target_range",
        normalisation_method: "as_is",
        target_range_min: "5",
        target_range_max: "10",
      }),
    );

    expect(parsed.problems).toEqual([]);
    expect(parsed.rule).not.toBeNull();
  });
});
