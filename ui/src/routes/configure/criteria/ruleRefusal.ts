/**
 * A refused rule, as the rule's own form reports it (PL-026). No React here, and no markup.
 *
 * **The server says which fields a refusal is about** (`details.errors`, the same list a malformed
 * request carries), so the form marks those fields and lists why, inside itself -- never at the
 * top of the pillar, where a weight's refusal goes and where it named no field at all.
 */

import { presentError } from "../../../api/errorPresentation";
import { fieldProblemEntries } from "../../../api/fieldProblems";
import type { RuleDraft } from "./criterionForm";

/** The parts of the form a refusal can mark. */
export type RuleMark =
  | "goal"
  | "normalisation_method"
  | "blocks_if_missing"
  | "target_range_min"
  | "target_range_max"
  | "zero_score_below"
  | "zero_score_above"
  | "anchors"
  | "threshold_min"
  | "threshold_max";

export type RuleMarks = Partial<Record<RuleMark, string>>;

export interface RuleRefusal {
  /** The draft that was refused, so it can be put back. */
  draft: RuleDraft;
  /** Why, in words: each reason once. */
  sentences: string[];
  /** The fields the server named, each with its reason. */
  marks: RuleMarks;
}

/** Which marks each body field the server can name lands on. */
const MARKS_OF: Record<string, readonly RuleMark[]> = {
  goal: ["goal"],
  normalisation_method: ["normalisation_method"],
  blocks_if_missing: ["blocks_if_missing"],
  target_range_min: ["target_range_min"],
  target_range_max: ["target_range_max"],
  zero_score_below: ["zero_score_below"],
  zero_score_above: ["zero_score_above"],
  scale_anchors: ["anchors"],
  matching_threshold: ["threshold_min", "threshold_max"],
};

/** What a bare bound ("At most 100.") is about, for the list where it stands without its box. */
const FIELD_WORDS: Record<string, string> = {
  goal: "Goal",
  normalisation_method: "Normalisation",
  blocks_if_missing: "Missing figure blocks scoring",
  target_range_min: "Band minimum",
  target_range_max: "Band maximum",
  zero_score_below: "Zero below",
  zero_score_above: "Zero above",
  scale_anchors: "Scale anchors",
  matching_threshold: "Matching threshold",
};

/**
 * The refusal of `draft`, for the attribute the form calls `title`.
 *
 * **The domain's sentence names the attribute by its id** (`criterion.py`), so the id is said as
 * the row says it. A field the form does not edit (a reducer) marks nothing and is still listed.
 * A refusal naming no field -- the set gone, the server unreachable -- is listed in words.
 */
export function refusalOf(
  error: unknown,
  draft: RuleDraft,
  { attribute, title }: { attribute: string; title: string },
): RuleRefusal {
  const named = (sentence: string) => sentence.split(attribute).join(title);
  const entries = fieldProblemEntries(error);
  const marks: RuleMarks = {};
  const sentences: string[] = [];

  for (const { field, kind, sentence } of entries) {
    const said = named(sentence);
    for (const mark of MARKS_OF[field] ?? []) marks[mark] = said;
    const listed =
      kind === "invalid_criterion" ? said : `${FIELD_WORDS[field] ?? "A figure"}: ${said}`;
    if (!sentences.includes(listed)) sentences.push(listed);
  }
  if (sentences.length === 0) sentences.push(named(presentError(error).message));

  return { draft, sentences, marks };
}

/** The marks without the ones an edit has answered. */
export function withoutMarks(marks: RuleMarks, answered: readonly RuleMark[]): RuleMarks {
  return Object.fromEntries(
    Object.entries(marks).filter(([mark]) => !answered.includes(mark as RuleMark)),
  );
}
