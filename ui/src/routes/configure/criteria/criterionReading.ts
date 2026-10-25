/**
 * A criterion row in words and geometry: what the attribute is, what the rule says about it,
 * and how much of the pillar its weight fills. No React here, and no markup.
 *
 * **Two authorities, kept apart, which is the ontology's own split** (`reqs.md` 3.0). The
 * attribute is objective -- its value type and whether any source can fetch it come from
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
import { attributeName } from "../../../format/display";
import {
  describeNormalisation,
  describeThreshold,
} from "../../../format/criterionWords";
import { GOAL_WORDS } from "./criterionForm";

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
  /**
   * The sources whose adapter can fetch it, in priority order (`reqs.md` Q235). Empty means no
   * run can fetch it; absent means the catalog has not said, which is not the same claim.
   */
  answerable_by?: readonly string[];
}

/** The catalog as the rows read it: by attribute id, because that is what a criterion names. */
export type AttributeCatalog = ReadonlyMap<string, CatalogAttribute>;

/**
 * What to call the attribute.
 *
 * **The catalog's name, and the id made readable when the catalog has not answered.** The
 * design bars programmatic identifiers from rendered text -- no attribute keys, rule ids or
 * settings field names -- and a fallback to the key breaks that rule exactly when the catalog
 * is slowest to arrive, which is when a reader is most likely to be looking. `attributeName`
 * holds that fallback for the whole interface: it drops the level and spaces the words, so
 * `country.overcrowding_rate` reads "Overcrowding rate".
 *
 * **This used to fall back to the id on purpose**, the argument being that title-casing one is
 * the screen guessing at what an attribute measures. The guess is narrower than it sounds --
 * these ids are snake-cased English written beside the names they stand in for -- and the
 * design rule overrules it either way, as four other screens had already settled.
 */
export function titleOf(
  attributeId: string,
  attribute: CatalogAttribute | undefined,
): string {
  const name = attribute?.name ?? "";
  // An empty map asks `attributeName` for the fallback and nothing else, so the rule for what
  // an unnamed attribute reads as lives in one place rather than two that can drift.
  return name === "" ? attributeName(NO_NAMES, attributeId) : name;
}

/** No names at all. One map, rather than a new one per row. */
const NO_NAMES: ReadonlyMap<string, string> = new Map();

export function catalogOf(
  attributes: readonly CatalogAttribute[],
): AttributeCatalog {
  return new Map(attributes.map((attribute) => [attribute.id, attribute]));
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
    chips.push({ key: "goal", text: GOAL_WORDS[criterion.goal], tone: "accent" });
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

  // **A criterion that is not scored only matches** (PL-111, D31): its weight counts for
  // nothing, and "Required" -- a missing figure blocks the score -- is about a score it never
  // enters, so it is said only of a scored criterion.
  const scored = criterion.is_scored !== false;
  if (!scored) {
    chips.push({ key: "not-scored", text: "Not scored, matching only", tone: "neutral" });
  }
  if (scored && criterion.blocks_if_missing === true) {
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
    // PL-113. With nothing to score it, its weight is shared among the rest of the pillar.
    if (scored) chips.push({ key: "redistributed", text: "Weight redistributed", tone: "neutral" });
  }

  return chips;
}

/**
 * Whether no source can fetch this attribute at all.
 *
 * **Only when the catalog has answered, and has said so.** An attribute this screen has not
 * been told about is not an attribute without sources, and saying so would report a request
 * still in flight as a hole in the data -- so an absent entry is false, not true, and so is an
 * entry with no `answerable_by`. The priority order is no stand-in: it names every source for
 * every attribute (BE-39), so it could never say this.
 */
export function hasNoSource(attribute?: CatalogAttribute): boolean {
  return attribute?.answerable_by?.length === 0;
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
