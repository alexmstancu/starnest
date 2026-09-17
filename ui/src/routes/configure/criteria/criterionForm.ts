/**
 * Reading a typed criterion rule. No React here, and no markup.
 *
 * **A criterion is the household's rule about one attribute** (`reqs.md` 3.0): which direction
 * is better, what band is wanted, which numbers anchor the scale, and what makes a candidate
 * stop matching. All of it arrives as text from inputs, so all of it may not be a number at
 * all.
 *
 * **Nothing is sent until it parses.** The server would refuse an unparseable figure, but the
 * refusal would be about JSON rather than about the rule -- which tells the reader nothing they
 * can act on. What the server still owns is every *domain* refusal: a band with no bounds, a
 * band under a method that cannot draw one, a threshold shape the attribute cannot take. Those
 * are rules about the ontology and they belong to one place (`criteria/criterion.py`).
 */

import type { Criterion, CriterionRule } from "../../../api/endpoints";

/**
 * The goals and methods a criterion may take.
 *
 * **The list the markup renders and the list the parser checks are the same one**, so a value
 * the server would refuse cannot be offered on screen -- and a fourth goal added to the
 * contract is one edit here rather than one in the type and one in the markup.
 */
export const THE_GOALS = ["minimise", "maximise", "target_range"] as const;
export const THE_METHODS = ["fixed", "percentile", "as_is"] as const;

/** One anchor as typed: a figure, the score it maps to, and an optional word for the band. */
export interface AnchorDraft {
  input_value: string;
  score: string;
  label: string;
}

/** The rule as the form holds it -- every field text or boolean, nothing parsed yet. */
export interface RuleDraft {
  // Both are plain strings here and narrowed in `ruleFrom`, because what a `<select>` reports
  // is a string whatever its options say.
  goal: string;
  normalisation_method: string;
  blocks_if_missing: boolean;
  target_range_min: string;
  target_range_max: string;
  zero_score_below: string;
  zero_score_above: string;
  anchors: AnchorDraft[];
  threshold_min: string;
  threshold_max: string;
  /**
   * The stored threshold when it is a shape this form cannot edit, and `null` otherwise.
   *
   * **This form edits one of the contract's four threshold shapes** -- the numeric range. A
   * label, boolean or share threshold is carried here untouched so that saving the rest of the
   * rule leaves it exactly as it was (P52), and so the markup can say a threshold exists that
   * it is not showing. Reading past it left both bound fields empty, which looks identical to
   * "no threshold" and then cleared the real one on the next save.
   */
  threshold_this_form_cannot_edit: object | null;
}

/**
 * What `PATCH` is sent: the scoring half of the contract's `CriterionInput`.
 *
 * **`matching_threshold` is the one optional field**, because absent and `null` mean different
 * things to a PATCH: absent says nothing about the threshold, and `null` clears it. A shape this
 * form cannot edit is left alone by omitting the key (P52).
 */
export type Rule = Required<
  Pick<
    CriterionRule,
    | "goal"
    | "normalisation_method"
    | "blocks_if_missing"
    | "target_range_min"
    | "target_range_max"
    | "zero_score_below"
    | "zero_score_above"
    | "scale_anchors"
  >
> &
  Pick<CriterionRule, "matching_threshold">;

/** A parsed rule, or the reasons it could not be read. Never both. */
export type Parsed =
  { rule: Rule; problems: [] } | { rule: null; problems: string[] };

function textOf(figure: number | null | undefined): string {
  return figure === null || figure === undefined ? "" : String(figure);
}

/**
 * The stored criterion as a draft the form can edit.
 *
 * An absent number shows as an empty field rather than as a zero: zero is a figure somebody
 * chose, and "no lower bound" is not.
 */
export function draftFrom(criterion: Criterion): RuleDraft {
  const stored = criterion.matching_threshold;
  const range: RangeThreshold | null = isARange(stored) ? stored ?? null : null;

  return {
    // `openapi.yaml` marks these required on `Criterion` and the server always sends them, but
    // they are declared on `CriterionInput` and openapi-typescript applies `required` only
    // within the same object of an `allOf` -- so the generated type has them optional. The
    // fallbacks are here rather than in every consumer, and they are the catalog's own defaults
    // rather than invented ones.
    goal: criterion.goal ?? "minimise",
    normalisation_method: criterion.normalisation_method ?? "fixed",
    blocks_if_missing: criterion.blocks_if_missing ?? false,
    target_range_min: textOf(criterion.target_range_min),
    target_range_max: textOf(criterion.target_range_max),
    zero_score_below: textOf(criterion.zero_score_below),
    zero_score_above: textOf(criterion.zero_score_above),
    anchors: (criterion.scale_anchors ?? []).map((anchor) => ({
      input_value: String(anchor.input_value),
      score: String(anchor.score),
      label: anchor.label ?? "",
    })),
    threshold_min: textOf(range?.min_value),
    threshold_max: textOf(range?.max_value),
    threshold_this_form_cannot_edit:
      stored === null || stored === undefined || range !== null
        ? null
        : stored,
  };
}

/**
 * Whether a stored threshold is the numeric range this form edits.
 *
 * Absent counts as a range: there is nothing to preserve and the form's two empty fields say
 * the same thing. Keyed on the bound fields rather than on a type discriminator, because the
 * contract's four shapes are distinguished by which fields they carry (`RangeThreshold`,
 * `LabelThreshold`, `BooleanThreshold`, `ShareThreshold`).
 */
/**
 * The `matching_threshold` entry a save should carry, which may be no entry at all.
 *
 * Three different statements, and the contract distinguishes all three: a range with bounds,
 * `null` for "there is no threshold", and **absent** for "this save says nothing about the
 * threshold" -- which is the only honest thing to send for a shape these two fields cannot
 * express (P52).
 */
function thresholdToSend(
  draft: RuleDraft,
  minimum: number | null,
  maximum: number | null,
): Pick<Rule, "matching_threshold"> | Record<string, never> {
  if (draft.threshold_this_form_cannot_edit !== null) return {};
  // Both bounds empty means there is no threshold, which is a different statement from a
  // threshold with no bounds -- the server refuses the second and this expresses the first.
  return {
    matching_threshold:
      minimum === null && maximum === null
        ? null
        : { min_value: minimum, max_value: maximum },
  };
}

function isARange(
  threshold: object | null | undefined,
): threshold is RangeThreshold | null | undefined {
  if (threshold === null || threshold === undefined) return true;
  return "min_value" in threshold || "max_value" in threshold;
}

/** The one threshold shape this form edits. */
interface RangeThreshold {
  min_value?: number | null;
  max_value?: number | null;
}

/** An empty anchor row, for the button that adds one. */
export function anEmptyAnchor(): AnchorDraft {
  return { input_value: "", score: "", label: "" };
}

interface Reading {
  figure: number | null;
  problem: string | null;
}

function figureIn(typed: string, named: string): Reading {
  if (typed.trim() === "") return { figure: null, problem: null };
  const figure = Number(typed);
  return Number.isFinite(figure)
    ? { figure, problem: null }
    : { figure: null, problem: `${named} must be a number.` };
}

/**
 * The draft as something to send, or every reason it cannot be.
 *
 * **Every problem at once, not the first.** A form that reported one error per attempt would
 * make correcting three fields take three round trips through the same screen.
 */
export function ruleFrom(draft: RuleDraft): Parsed {
  const problems: string[] = [];

  function figure(typed: string, named: string): number | null {
    const read = figureIn(typed, named);
    if (read.problem !== null) problems.push(read.problem);
    return read.figure;
  }

  const band = {
    target_range_min: figure(draft.target_range_min, "The band's minimum"),
    target_range_max: figure(draft.target_range_max, "The band's maximum"),
    zero_score_below: figure(draft.zero_score_below, "The lower zero point"),
    zero_score_above: figure(draft.zero_score_above, "The upper zero point"),
  };

  // An anchor row left completely blank is one somebody added and did not fill in, so it is
  // dropped rather than reported: the alternative is a form that cannot be saved until an
  // accidental click is undone.
  const anchors: {
    input_value: number;
    score: number;
    label: string | null;
  }[] = [];
  draft.anchors
    .filter((anchor) => !isBlank(anchor))
    .forEach((anchor, index) => {
      const value = figure(anchor.input_value, `Anchor ${index + 1}'s value`);
      const score = figure(anchor.score, `Anchor ${index + 1}'s score`);
      if (value === null || score === null) {
        problems.push(`Anchor ${index + 1} needs both a value and a score.`);
        return;
      }
      anchors.push({
        input_value: value,
        score,
        label: anchor.label.trim() === "" ? null : anchor.label.trim(),
      });
    });

  const thresholdMin = figure(draft.threshold_min, "The threshold's minimum");
  const thresholdMax = figure(draft.threshold_max, "The threshold's maximum");

  // Unreachable from the screen, whose options are this same list -- and checked anyway,
  // because the alternative is a cast asserting something nothing verified.
  const goal = THE_GOALS.find((each) => each === draft.goal);
  const method = THE_METHODS.find(
    (each) => each === draft.normalisation_method,
  );
  if (goal === undefined) problems.push(`${draft.goal} is not a goal.`);
  if (method === undefined) {
    problems.push(
      `${draft.normalisation_method} is not a normalisation method.`,
    );
  }

  if (problems.length > 0 || goal === undefined || method === undefined) {
    return { rule: null, problems };
  }

  return {
    rule: {
      goal,
      normalisation_method: method,
      blocks_if_missing: draft.blocks_if_missing,
      ...band,
      scale_anchors: anchors,
      // **A shape this form cannot edit is left alone by saying nothing about it** (P52). PATCH
      // changes only the fields present, and the contract documents `matching_threshold: null`
      // as "Null clears it" -- so sending null here to mean "I did not touch this" deleted a
      // stored label rule the moment somebody changed the goal.
      ...thresholdToSend(draft, thresholdMin, thresholdMax),
    },
    problems: [],
  };
}

function isBlank(anchor: AnchorDraft): boolean {
  return (
    anchor.input_value.trim() === "" &&
    anchor.score.trim() === "" &&
    anchor.label.trim() === ""
  );
}
