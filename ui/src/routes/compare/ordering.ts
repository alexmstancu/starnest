/**
 * Which pillars Compare puts first, and why.
 *
 * **"#N priority" means one thing on the whole screen** (PL-100, PL-104): a pillar's place among
 * the criteria set's heaviest at this level, as configured. The matrix's rows and the cards'
 * lines are tagged by this one function, so the two cannot drift into different meanings.
 *
 * **The configured weights, not the focus's redistributed ones.** A focus missing data has its
 * weight moved to its other pillars, so ranking its weights moved the priorities when only the
 * focus changed -- and printed 18% where Configure said 16.9.
 */

/** A pillar's configured weight at one level, as a criteria set carries it. */
export interface PillarWeight {
  pillar: string;
  level: string;
  weight: number;
}

/** How many pillars the design marks as priorities. */
const PRIORITY_COUNT = 3;

/** The set's configured weight for each pillar at this level, in the set's own order. */
export function pillarWeightsAt(
  set: { pillar_weights?: readonly PillarWeight[] } | null,
  level: string | null,
): ReadonlyMap<string, number> {
  return new Map(
    (set?.pillar_weights ?? [])
      .filter((each) => each.level === level)
      .map((each) => [each.pillar, each.weight]),
  );
}

/**
 * The heaviest pillars, ranked: a map from pillar to its place (0 for the heaviest), holding only
 * the top few. A pillar weighted at nothing is never a priority, and a tie keeps the set's order.
 */
export function pillarPriority(weights: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  return topPlaces([...weights].map(([key, weight]) => ({ key, weight })));
}

/**
 * "#N in pillar" (PL-098): the attributes that counted most in the focus's total, ranked the
 * way the pillars are -- the heaviest three, nothing for an attribute that counted for nothing
 * or whose weight is unknown, and a tie in the server's order.
 */
export function rankInPillar(
  rows: readonly { attribute: string; weight: number | null }[],
): ReadonlyMap<string, number> {
  return topPlaces(rows.map((row) => ({ key: row.attribute, weight: row.weight ?? 0 })));
}

/** The heaviest few keys, by place. The sort is stable, so a tie keeps the order given. */
function topPlaces(
  entries: readonly { key: string; weight: number }[],
): ReadonlyMap<string, number> {
  const ranked = entries
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((one, other) => other.weight - one.weight)
    .slice(0, PRIORITY_COUNT);
  return new Map(ranked.map((entry, place) => [entry.key, place]));
}

/**
 * Comparators in one order for every column and card (PL-103): total score, highest first, no
 * score last, ties in the order chosen. **The stored selection keeps the click order**, which the
 * limit's newest-first trim needs; only the drawing is reordered.
 */
export function orderByScore<T extends { score?: number | null }>(comparators: readonly T[]): T[] {
  const scoreOf = (each: T) => (typeof each.score === "number" ? each.score : -Infinity);
  return [...comparators].sort((one, other) => scoreOf(other) - scoreOf(one));
}

/** A comparison with its comparators, and the cards that follow them, in score order. */
export function inScoreOrder<
  C extends {
    comparators?: readonly { candidate: string; score?: number | null }[];
    synthesis?: readonly { comparator: string }[];
  },
>(comparison: C): C {
  const comparators = orderByScore(comparison.comparators ?? []);
  const place = new Map(comparators.map((each, at) => [each.candidate, at]));
  const placeOf = (id: string) => place.get(id) ?? comparators.length;
  const synthesis = comparison.synthesis
    ? [...comparison.synthesis].sort((one, other) => placeOf(one.comparator) - placeOf(other.comparator))
    : comparison.synthesis;
  return { ...comparison, comparators, synthesis };
}
