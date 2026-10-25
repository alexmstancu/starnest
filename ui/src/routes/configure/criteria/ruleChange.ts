/**
 * A criterion's rule as Recent changes holds it (PL-138): what it was before a change, whether
 * a set as read back holds it, and what the change is called.
 *
 * **Only the fields the change sent.** A rule edit sends the form's whole rule, so its reverse
 * sends the same fields as they were -- and a field the criterion did not hold goes back as
 * null, or an empty list, which is how the contract clears it.
 */

import type { Criterion, CriterionRule } from "../../../api/endpoints";

type RuleField = keyof CriterionRule;

/** The rule a criterion holds now, in exactly the fields a change is about to send. */
export function ruleBefore(criterion: Criterion | undefined, rule: CriterionRule): CriterionRule {
  const before: Record<string, unknown> = {};
  for (const field of Object.keys(rule) as RuleField[]) {
    // A list held as nothing is an empty list: the contract clears anchors that way, not by null.
    before[field] = criterion?.[field] ?? (Array.isArray(rule[field]) ? [] : null);
  }
  return before;
}

/** Whether a criterion as read back holds every field of a rule: what a lost answer is read by. */
export function holdsCriterionRule(criterion: Criterion, rule: CriterionRule): boolean {
  return (Object.keys(rule) as RuleField[]).every((field) =>
    sameValue(criterion[field], rule[field]),
  );
}

/** The fields a change moved, in words: "goal minimise to maximise". */
export function ruleChangeWords(before: CriterionRule, after: CriterionRule): string {
  const moved = (Object.keys(after) as RuleField[]).filter(
    (field) => !sameValue(before[field], after[field]),
  );
  if (moved.length === 0) return "unchanged";
  return moved
    .map((field) => {
      const name = FIELD_NAMES[field] ?? field;
      const was = before[field];
      const is = after[field];
      return isPlain(was) && isPlain(is)
        ? `${name} ${plainWords(was)} to ${plainWords(is)}`
        : `${name} changed`;
    })
    .join(", ");
}

const FIELD_NAMES: Partial<Record<RuleField, string>> = {
  goal: "goal",
  normalisation_method: "method",
  target_range_min: "band from",
  target_range_max: "band to",
  zero_score_below: "zero below",
  zero_score_above: "zero above",
  blocks_if_missing: "blocks if missing",
  breakdown_option: "breakdown",
  reducer_mode: "reducer",
  scale_anchors: "anchors",
  matching_threshold: "threshold",
};

function isPlain(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || typeof value !== "object";
}

function plainWords(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value.replaceAll("_", " ");
  return String(value);
}

/**
 * Two field values as the server would hold them: a key absent, a key null and an empty list are
 * the same answer, and the order an object's keys arrive in says nothing.
 */
function sameValue(first: unknown, second: unknown): boolean {
  return JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
}

function canonical(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.map(canonical);
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, inner]) => inner !== null && inner !== undefined)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, inner]) => [key, canonical(inner)]),
  );
}
