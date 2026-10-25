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
  /** The declared share of the whole level, before redistribution (D21). */
  weight?: number;
  effective_weight?: number;
  contribution?: number;
}

export interface ScoreReading {
  /** "73", or the absent mark where nothing was scored. */
  score: string;
  /**
   * The weight the set declared, as the server serves it: a share of the whole level, the
   * basis `weightUsed` is on (PL-063). Never the set's share of the pillar, which is another
   * number on another basis.
   */
  weight: string;
  /** The weight the pass used, after redistribution. */
  weightUsed: string;
  weightUsedTone: WeightUsedTone;
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
      weight:
        typeof row.weight === "number" ? formatPercentage(row.weight) : ABSENT,
      weightUsed:
        typeof row.effective_weight === "number"
          ? formatPercentage(row.effective_weight)
          : ABSENT,
      weightUsedTone: weightUsedTone(row),
      pointsAdded:
        typeof row.contribution === "number"
          ? formatSigned(row.contribution, 1)
          : ABSENT,
    });
  }
  return readings;
}

/**
 * How the weight used is tinted (PL-073): `moved` (teal) where redistribution moved it more than
 * {@link SAME_WEIGHT} points from the weight, `missing` (amber) where the attribute had no
 * figure in use and so took nothing, `plain` otherwise -- including where either weight is
 * absent, because a tint on nothing would be a claim about nothing.
 */
export type WeightUsedTone = "plain" | "moved" | "missing";

/** Within this many points the two weights are the same number, rounded. */
const SAME_WEIGHT = 0.6;

export function weightUsedTone(row: AttributeScore): WeightUsedTone {
  if (typeof row.weight !== "number" || typeof row.effective_weight !== "number") {
    return "plain";
  }
  if (row.normalised_score === null && row.effective_weight === 0) return "missing";
  return Math.abs(row.effective_weight - row.weight) > SAME_WEIGHT ? "moved" : "plain";
}

/**
 * What a stored figure is to the pass: the four words of the "In use" column.
 *
 * **Active is not the same as scored.** Being active is a comparison between the figures held
 * for one attribute (`reqs.md` 3.6); being scored needs, besides, a criterion that counts the
 * attribute -- and a descriptive attribute has none, while an excluded one judges without
 * counting (`reqs.md` 3.0, 5.3).
 */
export type InUse = "scored" | "active" | "superseded" | "rejected";

export interface StoredFigure {
  attribute: string;
  is_active: boolean;
  rejection_reason?: string | null;
}

export interface FigureInUse {
  inUse: InUse;
  /** The pass's reading, on the figure it was computed from; null on every other row. */
  reading: ScoreReading | null;
}

/**
 * What the pass made of one stored figure (UI-15).
 *
 * **A reading belongs to the figure it was computed from, and the pass computes from the
 * active one.** The readings are keyed by attribute, so handing one to every figure of that
 * attribute printed the active figure's score and points beside the superseded and rejected
 * ones -- evidence appearing to justify arithmetic done on another measurement.
 *
 * **The active figure is matched by `is_active`, not by the value the pass used**, which the
 * ranking does not name: a figure stored between the two reads would be credited with a
 * reading computed from its predecessor. Rare with one household and one writer, and the
 * household chose this over a contract change.
 *
 * **Where the set has said nothing, the pass answers.** The set is a separate read that can
 * fail or still be on its way, and the ranking carries a reading for every criterion that
 * counts and for nothing else -- so taking the set's silence for "not scored" hid the pass's
 * numbers from the figure it had scored.
 *
 * @param scoredBySet whether the active set has a criterion that counts this attribute, or
 *   undefined where the set has said nothing: unread, or not one of its criteria.
 */
export function figureInUse(
  figure: StoredFigure,
  scoredBySet: boolean | undefined,
  readings: ReadonlyMap<string, ScoreReading>,
): FigureInUse {
  if (!figure.is_active) {
    return {
      inUse: figure.rejection_reason ? "rejected" : "superseded",
      reading: null,
    };
  }
  if (!(scoredBySet ?? readings.has(figure.attribute))) {
    return { inUse: "active", reading: null };
  }
  return { inUse: "scored", reading: readings.get(figure.attribute) ?? null };
}
