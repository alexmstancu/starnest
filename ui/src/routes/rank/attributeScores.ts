/**
 * What each attribute actually put into a candidate's total.
 *
 * Three figures the criteria set alone cannot give: the **score** the figure normalised to, the
 * **weight used** after redistribution, and the **points added** to the total. The weight a set
 * configures is a different number from the weight a pass ended up using -- an attribute with
 * no figure drops out and its share spreads over the ones that have one (`reqs.md` 5.4) -- and
 * showing only the configured one leaves a reader unable to see where a missing figure went.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number` and friends, so the reading
 * of each figure happens here and the table prints what it is given.
 */

import { ABSENT, formatPercentage, formatSigned } from "../../format/display";

export interface AttributeScore {
  attribute: string;
  normalised_score?: number | null;
  effective_weight?: number;
  contribution?: number;
}

export interface ScoreReading {
  /** "73", or the absent mark where nothing was scored. */
  score: string;
  /** The weight the pass used, after redistribution. */
  weightUsed: string;
  /** What it added to the total, signed, because a contribution can be nothing. */
  pointsAdded: string;
}

export function scoresByAttribute(
  rows: readonly AttributeScore[] | null | undefined,
): ReadonlyMap<string, ScoreReading> {
  const readings = new Map<string, ScoreReading>();
  for (const row of rows ?? []) {
    readings.set(row.attribute, {
      // **Absent, not zero, when nothing scored.** A figure the pass could not score did not
      // score badly -- it dropped out, and a nought there would read as a judgement.
      score:
        typeof row.normalised_score === "number"
          ? String(row.normalised_score)
          : ABSENT,
      weightUsed:
        typeof row.effective_weight === "number"
          ? formatPercentage(row.effective_weight)
          : ABSENT,
      pointsAdded:
        typeof row.contribution === "number"
          ? formatSigned(row.contribution, 1)
          : ABSENT,
    });
  }
  return readings;
}
