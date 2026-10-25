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
import {
  describeRefusal,
  numberAsInput,
  readNumber,
  type NumberKind,
  type NumberRule,
} from "../../../format/typedNumber";

/**
 * The goals and methods a criterion may take.
 *
 * **The list the markup renders and the list the parser checks are the same one**, so a value
 * the server would refuse cannot be offered on screen -- and a fourth goal added to the
 * contract is one edit here rather than one in the type and one in the markup.
 */
export const THE_GOALS = ["minimise", "maximise", "target_range"] as const;
export const THE_METHODS = ["fixed", "percentile", "as_is"] as const;

type Goal = (typeof THE_GOALS)[number];
type Method = (typeof THE_METHODS)[number];

/**
 * What each goal and method is called on screen (PL-029). **The option's value stays the id and
 * its text is these words**: one table read by the options, the chip and "You asked for", so no
 * identifier reaches the reader through any of them.
 */
export const GOAL_WORDS: Record<Goal, string> = {
  minimise: "Lower is better",
  maximise: "Higher is better",
  target_range: "Within a band",
};
export const METHOD_WORDS: Record<Method, string> = {
  fixed: "Against fixed anchors",
  percentile: "By percentile",
  as_is: "As published",
};

/**
 * What kind of figure a rule's band, zero points, anchors and threshold are, from what the
 * attribute measures (PL-024): money in euros and cents, a count in whole numbers, anything else
 * a decimal. Signed, because a temperature or a growth rate can be below zero.
 */
export function numberKindFor(valueType: string | undefined): NumberKind {
  if (valueType === "Monetary") return "money";
  if (valueType === "Count") return "whole";
  return "decimal";
}

/** How each numeric field of the rule reads what is typed into it. */
export interface RuleNumberRules {
  /** A band bound, a zero point, a threshold bound: blank means "none". */
  bound: NumberRule;
  /** An anchor's figure, in the attribute's own unit. */
  anchorValue: NumberRule;
  /**
   * The score an anchor maps to. Whole and at least zero; its ceiling is the server's, because
   * it is the top of the score range, a setting this form does not hold.
   */
  anchorScore: NumberRule;
}

export function numberRulesFor(kind: NumberKind): RuleNumberRules {
  return {
    bound: { kind, signed: true, optional: true },
    anchorValue: { kind, signed: true, optional: false },
    anchorScore: { kind: "whole", minimum: 0, optional: false },
  };
}

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

/** A stored figure as its box shows it: never in exponent form, never rounded. */
const AS_TYPED: NumberRule = { kind: "decimal", signed: true, optional: true };

function textOf(figure: number | null | undefined): string {
  return numberAsInput(figure, AS_TYPED);
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
      input_value: textOf(anchor.input_value),
      score: textOf(anchor.score),
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

/**
 * One typed figure read by the shared grammar (`format/typedNumber.ts`). Blank is "none" here,
 * whatever the field's rule says, because the caller decides what a missing figure means.
 */
function figureIn(typed: string, rule: NumberRule, named: string): Reading {
  const reading = readNumber(typed, { ...rule, optional: true });
  switch (reading.kind) {
    case "blank":
      return { figure: null, problem: null };
    case "number":
      return { figure: reading.value, problem: null };
    case "incomplete":
      return { figure: null, problem: `${named}: ${describeRefusal({ code: "not_a_number" }, rule)}` };
    case "refused":
      return { figure: null, problem: `${named}: ${describeRefusal(reading.refusal, rule)}` };
  }
}

/**
 * The draft as something to send, or every reason it cannot be.
 *
 * **Every problem at once, not the first.** A form that reported one error per attempt would
 * make correcting three fields take three round trips through the same screen.
 */
export function ruleFrom(draft: RuleDraft, kind: NumberKind = "decimal"): Parsed {
  const problems: string[] = [];
  const rules = numberRulesFor(kind);

  function figure(typed: string, named: string, rule = rules.bound): number | null {
    const read = figureIn(typed, rule, named);
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
      const before = problems.length;
      const value = figure(anchor.input_value, `Anchor ${index + 1}'s value`, rules.anchorValue);
      const score = figure(anchor.score, `Anchor ${index + 1}'s score`, rules.anchorScore);
      if (problems.length > before) return;
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

/**
 * What a refused draft asked for, in words (PL-026): the form shows the stored rule again after
 * a refusal (P55), and this keeps the attempt in view beside it. Only the parts that are set are
 * said, as typed, so it reads back what the reader wrote rather than a reading of it.
 */
export function describeAsked(draft: RuleDraft): string {
  const goal = wordsFor(GOAL_WORDS, draft.goal);
  const method = wordsFor(METHOD_WORDS, draft.normalisation_method);
  const anchors = draft.anchors.filter((anchor) => !isBlank(anchor)).length;
  const parts = [
    `${goal}, ${method}`,
    between("a band", draft.target_range_min, draft.target_range_max),
    draft.zero_score_below.trim() === "" ? null : `zero below ${draft.zero_score_below.trim()}`,
    draft.zero_score_above.trim() === "" ? null : `zero above ${draft.zero_score_above.trim()}`,
    anchors === 0 ? null : `${anchors} anchor${anchors === 1 ? "" : "s"}`,
    between("a threshold", draft.threshold_min, draft.threshold_max),
    draft.blocks_if_missing ? "a missing figure blocks scoring" : null,
  ];
  return `${parts.filter((part) => part !== null).join("; ")}.`;
}

/** The words for an id this table knows, lower-cased to sit inside a sentence; else as typed. */
function wordsFor(words: Record<string, string>, id: string): string {
  return Object.hasOwn(words, id) ? (words[id] ?? id).toLowerCase() : id;
}

function between(what: string, low: string, high: string): string | null {
  const [from, to] = [low.trim(), high.trim()];
  if (from !== "" && to !== "") return `${what} from ${from} to ${to}`;
  if (from !== "") return `${what} of at least ${from}`;
  if (to !== "") return `${what} of at most ${to}`;
  return null;
}
