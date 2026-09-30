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
  value_type?: string;
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
  /** Which editor the form needs, or null where hand entry is not permitted or not built. */
  manualKind: "LabelSet" | "AssignedScore" | null;
  /** The remedy, in words, because the two cases have different ones. */
  remedy: string;
}

const NO_PILLAR = "no pillar";

/** What to do about this gap, in words, because the three cases have different answers. */
function remedyFor(attribute: CatalogAttribute): string {
  if (attribute.manual_entry !== true) {
    return "No source yet, and hand entry is not permitted for this attribute";
  }
  return editorFor(attribute) === null
    ? `Hand entry is permitted, but no editor is built for a ${String(attribute.value_type)} yet`
    : "Enter a value by hand";
}

/**
 * Which hand-entry editor an attribute needs, or null.
 *
 * **Two types, because two types is what the catalog permits.** Five attributes declare
 * `manual_entry`: two `LabelSet`, two `AssignedScore`, one `Quantity` that already has a figure
 * from a source. Monetary, Count and Ratio have no attribute that would accept one, so an
 * editor for them would be a form nobody can open.
 *
 * A permitted type with no editor yet says so rather than offering a form that cannot submit --
 * `remedyFor` names it, and `docs/design-brief.md` carries the request.
 */
function editorFor(
  attribute: CatalogAttribute,
): "LabelSet" | "AssignedScore" | null {
  if (attribute.manual_entry !== true) return null;
  if (attribute.value_type === "LabelSet") return "LabelSet";
  if (attribute.value_type === "AssignedScore") return "AssignedScore";
  return null;
}

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
        manualKind: editorFor(attribute),
        remedy: remedyFor(attribute),
      };
    })
    .sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0));
}


export interface HandEnterable {
  id: string;
  name: string;
  pillar: string;
  kind: "LabelSet" | "AssignedScore";
  /** What would answer it otherwise, so typing one is visibly a choice rather than the only way. */
  otherwise: string;
}

/**
 * The attributes a person may answer themselves.
 *
 * **Not the same list as the unsourced ones, and that is the point.** Every attribute that
 * permits hand entry *does* declare sources -- `international_employers` names the LLM path,
 * `residency_admin_ease` names national law -- so none of them appear among the attributes with
 * nobody to ask. Offering the form only there would put it where it can never be reached.
 *
 * **Declared is not the same as built.** `national_law`, `company_website` and
 * `european_commission` are catalog rows with no adapter behind them, and nothing in the API
 * distinguishes the two -- so this says what *would* answer it rather than claiming anything
 * about what will.
 */
export function handEnterable(
  attributes: readonly CatalogAttribute[],
): HandEnterable[] {
  const open: HandEnterable[] = [];
  for (const attribute of attributes) {
    const kind = editorFor(attribute);
    if (kind === null) continue;
    const sources = attribute.effective_source_priority ?? [];
    open.push({
      id: attribute.id,
      name: attribute.name,
      pillar: attribute.pillar ?? NO_PILLAR,
      kind,
      otherwise:
        sources.length === 0
          ? "Nothing else would answer it"
          : `Otherwise: ${sources.join(", ")}`,
    });
  }
  return open.sort((left, right) => left.name.localeCompare(right.name));
}
