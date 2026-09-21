/**
 * Attributes nothing can answer, because no source is connected to them at all.
 *
 * **Distinct from an item a run failed to fetch, and the difference is what to do about it.**
 * A failure is a source refusing, so asking again may work. An unanswered item is a source
 * having no figure, so asking again may work when the publisher publishes. An attribute with
 * no source has nobody to ask, and retrying it forever changes nothing -- so the screen says
 * so instead of offering a button that would do nothing.
 */

export interface CatalogAttribute {
  id: string;
  name: string;
  pillar?: string | null;
  /** The sources that would be asked, in order. Empty means nobody would be asked. */
  effective_source_priority?: readonly string[];
  /** Whether the catalog permits a figure typed in by hand for this attribute. */
  manual_entry?: boolean;
}

export interface WeightedCriterion {
  attribute: string;
  pillar: string;
  weight?: number;
}

export interface UnsourcedAttribute {
  id: string;
  name: string;
  pillar: string;
  /** What it is worth inside its pillar, or null when the active set does not score it. */
  weight: number | null;
  manualEntry: boolean;
  /** The remedy, in words, because the two cases have different ones. */
  remedy: string;
}

const NO_PILLAR = "no pillar";

/**
 * The attributes with nobody to ask, and what each one costs.
 *
 * Ordered by what they are worth, heaviest first: an unsourced attribute carrying 45% of a
 * pillar is a different problem from one carrying 5%, and a list sorted by name hides which
 * is which.
 */
export function unsourcedAttributes(
  attributes: readonly CatalogAttribute[],
  criteria: readonly WeightedCriterion[],
): UnsourcedAttribute[] {
  const weights = new Map(
    criteria.map((criterion) => [criterion.attribute, criterion.weight]),
  );

  return attributes
    .filter((attribute) => (attribute.effective_source_priority ?? []).length === 0)
    .map((attribute) => {
      const weight = weights.get(attribute.id);
      return {
        id: attribute.id,
        name: attribute.name,
        pillar: attribute.pillar ?? NO_PILLAR,
        weight: typeof weight === "number" ? weight : null,
        manualEntry: attribute.manual_entry === true,
        remedy: attribute.manual_entry === true
          ? "Enter a value by hand"
          : "No source yet, and hand entry is not permitted for this attribute",
      };
    })
    .sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0));
}
