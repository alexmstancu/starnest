/**
 * What the active set has decided about each attribute it judges.
 *
 * **Which pillar a row belongs to is not decided here any more** (PL-068): the drill-down files
 * a row under the pillar the ranked detail's `attribute_scores` names, so the filter no longer
 * waits on -- or fails with -- this separate read.
 */

/** What the active set says about one attribute, beyond which pillar it is in. */
export interface Judgement {
  /** Whether the candidate cannot be scored at all without it (`blocks_if_missing`). */
  required: boolean;
  /**
   * Whether the set counts it. An excluded criterion still judges -- it matches and gates --
   * and adds nothing to the total (`reqs.md` 5.3).
   */
  scored: boolean;
}

export interface Weighed {
  attribute: string;
  blocks_if_missing?: boolean;
  is_scored?: boolean;
}

/**
 * What the active set has decided about each attribute.
 *
 * **The set's opinion, not the catalog's.** An attribute this set does not score appears in no
 * entry (`reqs.md` 3.0).
 *
 * **No weight here** (PL-063): the set's weight is a share of the pillar, and the drill-down
 * prints the server's share of the whole score instead, on the basis of the weight used.
 */
export function judgementsByAttribute(
  criteria: readonly Weighed[] | null | undefined,
): Map<string, Judgement> {
  return new Map(
    (criteria ?? []).map((each): [string, Judgement] => {
      const scored = each.is_scored !== false;
      return [
        each.attribute,
        {
          required: each.blocks_if_missing === true,
          scored,
        },
      ];
    }),
  );
}
