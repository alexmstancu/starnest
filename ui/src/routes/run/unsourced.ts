/**
 * Attributes no run can answer, because no source can fetch them at all.
 *
 * **Distinct from an item a run failed to fetch, and the difference is what to do about it.**
 * A failure is a source refusing, so asking again may work. An unanswered item is a source
 * having no figure, so asking again may work when the publisher publishes. An attribute no
 * source can fetch has nobody to ask, and retrying it forever changes nothing -- so the screen
 * says so instead of offering a button that would do nothing.
 *
 * **Which sources can fetch an attribute is the server's to say** (`reqs.md` Q235): its
 * `answerable_by` names those whose registered adapter declares it. The priority order is not a
 * stand-in -- since BE-39 it names every source for every attribute, `manual` and `llm`
 * included, so reading "no source" from it could never find one.
 */

import { describeValueType } from "../../format/criterionWords";

export interface CatalogAttribute {
  id: string;
  name: string;
  value_type?: string;
  unit?: string | null;
  pillar?: string | null;
  /**
   * The sources whose adapter can fetch it, in priority order, whether or not they are
   * switched on. Empty means no run can fetch it; absent means the catalog has not said, which
   * is not the same claim.
   */
  answerable_by?: readonly string[];
  /** Whether the catalog permits a figure typed in by hand for this attribute. */
  manual_entry?: boolean;
}

export interface WeightedCriterion {
  attribute: string;
  pillar: string;
  weight?: number;
  /** A criterion the set keeps but does not score is worth nothing in its pillar. */
  is_scored?: boolean;
}

/** The set's criteria are still being read, so no weight can be said yet (PL-088). */
export const WEIGHTS_PENDING = "pending";

export interface UnsourcedAttribute {
  id: string;
  name: string;
  pillar: string;
  /** Its value type in words, so the reader knows what kind of figure is missing. */
  type: string;
  /**
   * What it is worth inside its pillar, null when the active set does not score it, and
   * pending while the set is still being read -- which says nothing either way.
   */
  weight: number | null | typeof WEIGHTS_PENDING;
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
  return editorFor(attribute) === null ? noFormFor(attribute) : "Enter a value by hand";
}

/**
 * Permitted, but no editor is built for this type: said rather than offering a form that
 * cannot submit. The type in words, without its unit: "a measured quantity", not "measured in
 * weeks".
 */
function noFormFor(attribute: CatalogAttribute): string {
  const words = describeValueType(attribute.value_type, null);
  const named = words === "" ? "this type" : words.charAt(0).toLowerCase() + words.slice(1);
  return `Permitted, but there is no form for ${named} yet`;
}

function typeOf(attribute: CatalogAttribute): string {
  return describeValueType(attribute.value_type, attribute.unit);
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
  criteria: readonly WeightedCriterion[] | typeof WEIGHTS_PENDING,
): UnsourcedAttribute[] {
  // **Only what the set scores has a weight** (PL-088): a kept-but-unscored criterion still
  // carries the weight it would have, and printing it claims a share of the pillar it has not.
  const weights = new Map(
    (criteria === WEIGHTS_PENDING ? [] : criteria)
      .filter((criterion) => criterion.is_scored !== false)
      .map((criterion) => [criterion.attribute, criterion.weight]),
  );

  const gaps = attributes.filter(nothingCanFetch).map((attribute): UnsourcedAttribute => {
    const weight = weights.get(attribute.id);
    return {
      id: attribute.id,
      name: attribute.name,
      pillar: attribute.pillar ?? NO_PILLAR,
      type: typeOf(attribute),
      weight:
        criteria === WEIGHTS_PENDING
          ? WEIGHTS_PENDING
          : typeof weight === "number"
            ? weight
            : null,
      manualEntry: attribute.manual_entry === true,
      manualKind: editorFor(attribute),
      remedy: remedyFor(attribute),
    };
  });
  // By name while the weights are pending, and among equal weights, so the same catalog
  // always reads in the same order.
  return gaps.sort(
    (left, right) =>
      worth(right) - worth(left) || left.name.localeCompare(right.name),
  );
}

function worth(gap: UnsourcedAttribute): number {
  return typeof gap.weight === "number" ? gap.weight : 0;
}

/**
 * Whether the catalog says no source can fetch this attribute.
 *
 * **Only when it says so.** An absent `answerable_by` is a catalog that has not answered, and
 * reading "nothing" into silence would report a gap in the answer as a gap in the data -- so
 * absent is false here, and only an empty list is true.
 */
function nothingCanFetch(attribute: CatalogAttribute): boolean {
  return attribute.answerable_by?.length === 0;
}


export interface HandEnterable {
  id: string;
  name: string;
  /** The catalog's pillar, or null where it files the attribute under none. */
  pillar: string | null;
  /** Its value type in words, under its name. */
  type: string;
  /** Which editor opens, or null where the catalog permits entry and no form exists yet. */
  kind: "LabelSet" | "AssignedScore" | null;
  /** Why there is no button, where `kind` is null. */
  noForm: string;
  /** What else can fetch it, so typing one is visibly a choice -- or plainly the only way. */
  otherwise: string;
}

/**
 * Every attribute a person may answer themselves.
 *
 * **Not the same list as the unsourced ones, though the two overlap.** This is every attribute
 * a person may answer; that one is every attribute no source can fetch. One only a person can
 * answer -- `residency_admin_ease`, whose per-country gradient nobody publishes -- is honestly
 * in both, while `international_employers` is here alone wherever the LLM path is configured
 * to fetch it. Offering the form only among the unsourced would hide it from every attribute
 * something else could also answer.
 *
 * **Every one the catalog permits, form or not** (PL-087): listing only those with an editor
 * left a permitted measured quantity a source also answers in neither card, so the permission
 * was invisible. Where no form exists, the row says so instead of offering one.
 *
 * **What else would answer it is `answerable_by`, never the priority order.** The order names
 * every source for every attribute -- `manual` among them, which is this very form, and sources
 * with no adapter for this attribute, such as `company_website` -- so printing it offered typing
 * by hand as the alternative to typing by hand. A source switched off still counts: the switch
 * decides whether it is asked, not what it can fetch (Q235).
 */
export function handEnterable(
  attributes: readonly CatalogAttribute[],
  sourceNames: ReadonlyMap<string, string>,
): HandEnterable[] {
  return attributes
    .filter((attribute) => attribute.manual_entry === true)
    .map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      pillar: attribute.pillar ?? null,
      type: typeOf(attribute),
      kind: editorFor(attribute),
      noForm: noFormFor(attribute),
      otherwise: otherwiseFor(attribute, sourceNames),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * What would answer it besides a person, in words.
 *
 * Empty where the catalog has not said: silence is not "nothing", and this column is no place
 * to guess at a source. **Named by the catalog, never by id** (UIR-G3): until the names are in,
 * or if they cannot be read, the column says only that another source would answer it.
 */
function otherwiseFor(
  attribute: CatalogAttribute,
  sourceNames: ReadonlyMap<string, string>,
): string {
  const able = attribute.answerable_by;
  if (able === undefined) return "";
  if (able.length === 0) return "Nothing else would answer it";
  const named = able.flatMap((id) => {
    const name = sourceNames.get(id);
    return name === undefined ? [] : [name];
  });
  return named.length === 0
    ? "Another source would answer it"
    : `Otherwise: ${named.join(", ")}`;
}
