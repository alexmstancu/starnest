/**
 * A criterion's rule and its attribute's type, said in words, for every screen that shows one.
 *
 * **Shared, so Configure and Rank say the same rule the same way.** It lives in `format/`
 * because a screen may not import another screen, and both read these phrases.
 */

import { formatCount } from "./display";

/**
 * The four threshold shapes the contract carries, named structurally so this module needs no
 * import from `api/`: the generated `Criterion["matching_threshold"]` satisfies it.
 */
export type MatchingThreshold =
  | null
  | undefined
  | { min_value?: number | null; max_value?: number | null }
  | {
      labels?: {
        label: string;
        containment_rule: "must_contain" | "must_not_contain";
      }[];
    }
  | { required_value?: boolean }
  | { label?: string; min_share?: number | null; max_share?: number | null };

/**
 * What the attribute measures, in plain words.
 *
 * **The value type decides what a number on this row even means** (`reqs.md` 3.3a), and the
 * type names are the ontology's rather than English -- `ShareComposition` tells a reader
 * nothing until it is said as a sentence. The unit joins it where there is one, because
 * "Measured in" without the measure is half a fact.
 */
export function describeValueType(
  valueType: string | undefined,
  unit: string | null | undefined,
): string {
  const named = unit?.trim() ? unit.trim() : null;

  switch (valueType) {
    case "Monetary":
      return named === null ? "Money" : `Money in ${named}`;
    case "Quantity":
      return named === null ? "A measured quantity" : `Measured in ${named}`;
    case "Count":
      return named === null ? "A count" : `Counted in ${named}`;
    case "Ratio":
      return named === "%" ? "A percentage" : "A ratio";
    case "Index":
      return named === null ? "An index" : `An index on ${named}`;
    case "AssignedScore":
      return "A score somebody assigned";
    case "LabelSet":
      return "A set of labels";
    case "ShareComposition":
      return "Shares of a whole";
    case "Boolean":
      return "Yes or no";
    case "Text":
      return "Text";
    default:
      // Not a fallback for an unknown type so much as for an absent one: a row whose
      // attribute the catalog has not answered for says nothing rather than guessing.
      return "";
  }
}

/**
 * What stops a candidate matching on this attribute, in words.
 *
 * **The contract carries four threshold shapes and they are distinguished by which fields they
 * carry** rather than by a discriminator (`openapi.yaml`, `CriterionInput`). Each is said in
 * its own terms: a bound is a bound, a label is a containment, a boolean is a demand.
 */
export function describeThreshold(
  threshold: MatchingThreshold,
): string {
  if (threshold === null || threshold === undefined) return "no threshold";

  if ("labels" in threshold) {
    const labels = threshold.labels ?? [];
    if (labels.length === 0) return "no threshold";
    const forbidden = labels.filter(
      (each) => each.containment_rule === "must_not_contain",
    );
    const required = labels.filter(
      (each) => each.containment_rule === "must_contain",
    );
    const said = [
      required.length > 0
        ? `must contain ${required.map((each) => each.label).join(", ")}`
        : null,
      forbidden.length > 0
        ? `must not contain ${forbidden.map((each) => each.label).join(", ")}`
        : null,
    ].filter((phrase) => phrase !== null);
    return said.join("; ");
  }

  if ("required_value" in threshold) {
    return threshold.required_value === true ? "must be yes" : "must be no";
  }

  if ("min_share" in threshold || "max_share" in threshold) {
    const share = describeBounds(threshold.min_share, threshold.max_share);
    const named = threshold.label ?? "a share";
    return share === null ? "no threshold" : `${named} ${share}`;
  }

  // **Narrowed by the fields it carries, positively.** Every field of every shape is
  // optional, so an `else` branch narrows nothing: `{}` satisfies all four, and only a test
  // for the bounds themselves tells a range from an empty object.
  if ("min_value" in threshold || "max_value" in threshold) {
    return describeBounds(threshold.min_value, threshold.max_value) ?? "no threshold";
  }

  return "no threshold";
}

/**
 * A pair of bounds where either may be absent, or null when neither is there.
 *
 * An open end is said as an open end. "at least 5" and "between 5 and nothing" are the same
 * fact, and only one of them reads as one.
 */
function describeBounds(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
): string | null {
  const low = Number.isFinite(minimum) ? formatCount(minimum) : null;
  const high = Number.isFinite(maximum) ? formatCount(maximum) : null;

  if (low !== null && high !== null) return `between ${low} and ${high}`;
  if (low !== null) return `at least ${low}`;
  if (high !== null) return `at most ${high}`;
  return null;
}

/** The three legal methods (`reqs.md` 5.1), each said as what it does to the figure. */
export function describeNormalisation(method: string): string {
  switch (method) {
    case "fixed":
      return "scored against fixed anchors";
    case "percentile":
      return "scored by percentile";
    case "as_is":
      return "used as published";
    default:
      return method;
  }
}

/**
 * What the goal asks of a figure (`reqs.md` 3.4): which end is better, or the band that is.
 * Empty for a goal the criterion does not state, rather than a guess.
 */
export function describeGoal(
  goal: "minimise" | "maximise" | "target_range" | undefined,
  minimum?: number | null,
  maximum?: number | null,
): string {
  switch (goal) {
    case "minimise":
      return "lower is better";
    case "maximise":
      return "higher is better";
    case "target_range": {
      const band = describeBounds(minimum, maximum);
      return band === null ? "best within a band not yet set" : `best ${band}`;
    }
    default:
      return "";
  }
}

/** A fixed scale's anchors, lowest figure first, each as the score its figure earns. */
export function describeAnchors(
  anchors: readonly { input_value?: number; score?: number }[] | null | undefined,
): string {
  return [...(anchors ?? [])]
    .sort((one, other) => (one.input_value ?? 0) - (other.input_value ?? 0))
    .map((anchor) => `${formatCount(anchor.input_value)} scores ${formatCount(anchor.score)}`)
    .join(", ");
}
