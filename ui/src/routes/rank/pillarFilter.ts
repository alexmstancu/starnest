/**
 * Which pillar a stored value belongs to, so the contribution cards can filter the table.
 *
 * **The criteria set already knows.** Every criterion carries its attribute and its pillar, so
 * no new endpoint and no new field are needed -- and the map is the set's own opinion rather
 * than the catalog's, which matters: a set that does not score an attribute has no pillar for
 * it, and that is the truthful answer rather than a lookup failure.
 */

export interface PillarBearing {
  attribute: string;
  pillar: string;
}

export interface HasAttribute {
  attribute: string;
}

/** Attribute id to the pillar the active set files it under. */
export function pillarsByAttribute(
  criteria: readonly PillarBearing[] | null | undefined,
): Map<string, string> {
  return new Map((criteria ?? []).map((each) => [each.attribute, each.pillar]));
}

/**
 * The values belonging to one pillar, or all of them when no pillar is chosen.
 *
 * **A value whose attribute this set does not score is left out of every pillar**, not swept
 * into an arbitrary one. A descriptive attribute has no criterion by definition (`reqs.md`
 * 3.0), so it belongs to no pillar's contribution -- showing it under one would imply it
 * counted toward that pillar's score.
 */
export function valuesInPillar<T extends HasAttribute>(
  values: readonly T[],
  byAttribute: Map<string, string>,
  pillar: string | null,
): T[] {
  if (pillar === null) {
    return [...values];
  }
  return values.filter((value) => byAttribute.get(value.attribute) === pillar);
}
