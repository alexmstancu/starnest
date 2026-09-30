/**
 * A criterion row in words and geometry: what the attribute is, what the rule says about it,
 * and how much of the pillar its weight fills. No React here, and no markup.
 *
 * **Two authorities, kept apart, which is the ontology's own split** (`reqs.md` 3.0). The
 * attribute is objective -- its value type and whether any source would answer it come from
 * the catalog. The criterion is the household's rule about it -- goal, threshold, method,
 * whether its absence blocks. A row shows both, and this module is where each is turned into
 * a phrase without either pretending to be the other.
 *
 * **Nothing is invented for a criterion that does not say it.** A rule with no threshold gets
 * a chip saying so; an attribute the catalog has not answered for gets no type line at all,
 * rather than a plausible guess at what it measures.
 */

import type { Criterion } from "../../../api/endpoints";
import { linkTo, UNSOURCED } from "../../../navigation/highlight";
import { formatCount } from "../../../format/display";

/**
 * What a row needs from the catalog, named structurally so the generated `Attribute` satisfies
 * it without this module importing a type it would then have to keep in step.
 */
export interface CatalogAttribute {
  id: string;
  /** What the catalog calls it, in words. The id is the identifier, not the label. */
  name?: string;
  value_type?: string;
  unit?: string | null;
  /** The sources that would be asked, in order. Empty means nobody would be asked. */
  effective_source_priority?: readonly string[];
}

/** The catalog as the rows read it: by attribute id, because that is what a criterion names. */
export type AttributeCatalog = ReadonlyMap<string, CatalogAttribute>;

/**
 * What to call the attribute.
 *
 * **The catalog's name, and the id only when there is no name.** The design bars programmatic
 * identifiers from rendered text -- no attribute keys, rule ids or settings field names -- so
 * the id is a last resort rather than a second line. Inventing a title case of the id would be
 * this screen guessing at what an attribute measures, which is worse than showing the key.
 */
export function titleOf(
  attributeId: string,
  attribute: CatalogAttribute | undefined,
): string {
  const name = attribute?.name ?? "";
  return name === "" ? attributeId : name;
}

export function catalogOf(
  attributes: readonly CatalogAttribute[],
): AttributeCatalog {
  return new Map(attributes.map((attribute) => [attribute.id, attribute]));
}

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
 * How the tint is chosen. The rule the row imposes reads as the household's (accent), what it
 * is measured against reads as neutral, and the two that are about a gap read as demands --
 * `required` because the score cannot be computed without it, `warning` because nothing would
 * fill it.
 */
export type ChipTone = "accent" | "neutral" | "required" | "warning";

export interface CriterionChip {
  /** Stable within a row, for a key that does not move when the wording does. */
  key: string;
  text: string;
  tone: ChipTone;
  /** Where the chip goes, for the one that names a gap rather than stating the rule. */
  to?: string;
}

/**
 * The row's chips: what the rule says, and what is missing.
 *
 * Ordered the way the row is read -- the direction first, then what it is judged against, then
 * how it is scaled, and last the two facts about a gap. **The gap chips come last because they
 * are the exception**: a reader scanning for them finds them in the same place on every row
 * that has one, instead of having them shift the rest of the line about.
 */
export function chipsFor(
  criterion: Criterion,
  attribute?: CatalogAttribute,
): CriterionChip[] {
  const chips: CriterionChip[] = [];

  if (criterion.goal !== undefined) {
    chips.push({ key: "goal", text: `goal: ${criterion.goal}`, tone: "accent" });
  }

  chips.push({
    key: "threshold",
    text: describeThreshold(criterion.matching_threshold),
    tone: "neutral",
  });

  if (criterion.normalisation_method !== undefined) {
    chips.push({
      key: "normalisation",
      text: describeNormalisation(criterion.normalisation_method),
      tone: "neutral",
    });
  }

  if (criterion.blocks_if_missing === true) {
    chips.push({ key: "required", text: "Required", tone: "required" });
  }

  if (hasNoSource(attribute)) {
    // **The one chip that goes somewhere.** The others state the rule; this one states a gap,
    // and a gap with no route out leaves a reader holding a problem. The arrow is the design's,
    // and says the chip is a way through rather than another label.
    chips.push({
      key: "no-source",
      text: "No source yet →",
      tone: "warning",
      to: linkTo("/acquire", UNSOURCED),
    });
  }

  return chips;
}

/**
 * Whether nobody would be asked about this attribute at all.
 *
 * **Only when the catalog has answered.** An attribute this screen has not been told about is
 * not an attribute without sources, and saying so would report a request still in flight as a
 * hole in the data -- so an absent entry is false, not true.
 */
export function hasNoSource(attribute?: CatalogAttribute): boolean {
  if (attribute === undefined) return false;
  return (attribute.effective_source_priority ?? []).length === 0;
}

/**
 * What stops a candidate matching on this attribute, in words.
 *
 * **The contract carries four threshold shapes and they are distinguished by which fields they
 * carry** rather than by a discriminator (`openapi.yaml`, `CriterionInput`). Each is said in
 * its own terms: a bound is a bound, a label is a containment, a boolean is a demand.
 */
export function describeThreshold(
  threshold: Criterion["matching_threshold"],
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
 * How much of the bar is filled, as a percentage of its own width.
 *
 * The bar is drawn against the hundred a pillar's criteria share, not against the slider's
 * ceiling: **the question the bar answers is "how much of this pillar is this", which is the
 * same question the weight is**. Clamped because a pillar mid-rebalance can hold a weight
 * above 100 for one render, and an SVG rect wider than its viewBox paints over the row.
 */
export function weightBarWidth(weight: number | undefined): number {
  if (weight === undefined || !Number.isFinite(weight)) return 0;
  return Math.min(100, Math.max(0, weight));
}
