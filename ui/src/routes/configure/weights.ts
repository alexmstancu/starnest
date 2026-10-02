/**
 * Reading a typed weight. Shared by the two levels of weighting, and by neither's markup.
 *
 * A weight is a percentage the user types, so it arrives as text and may not be a number at
 * all. **Nothing is sent until it is one**: the server would refuse it, and the refusal would
 * be about parsing rather than about weights -- which tells the user nothing they can act on.
 */

/** The number a field holds, or null when it holds something that is not one. */
export function weightFrom(typed: string): number | null {
  if (typed.trim() === "") return null;
  const weight = Number(typed);
  return Number.isFinite(weight) ? weight : null;
}

/** What a stored weight looks like in an input. An absent weight shows empty, never a zero. */
export function weightAsText(weight: number | undefined): string {
  return weight === undefined ? "" : String(weight);
}

/** What a set of weights comes to, for the running total beside them. */
export function totalOf(weights: readonly { weight: number }[]): number {
  return weights.reduce((sum, each) => sum + each.weight, 0);
}

/** One pillar's criteria, and what they currently come to. */
export interface PillarTotal {
  pillar: string;
  total: number;
  /** True when the criteria in it sum to 100, which is the rule they are held to. */
  balanced: boolean;
}

/** How close a total has to be to 100 before it counts as 100. */
const ROUNDING_SLACK = 0.0001;

/**
 * Whether a set of weights has come to 100.
 *
 * **Exported so there is one answer to the question.** `totalsByPillar` compared with slack
 * and the pillar panel's own total compared with `===`, so the same arithmetic was right in
 * one place on the screen and wrong a few lines above it: a rebalance returns weights at full
 * `Decimal` precision, summing them as doubles misses 100 about a quarter of the time, and the
 * chip read "Total 100.0%" in amber (P79).
 */
export function comesToAHundred(total: number): boolean {
  return Math.abs(total - 100) < ROUNDING_SLACK;
}

/**
 * What each pillar's criteria currently sum to.
 *
 * **Criterion weights sum to 100 within a pillar** (`reqs.md` 3.4), and the server enforces
 * it by rebalancing. This is the same number shown back, so a reader can see the rule holding
 * rather than take it on trust.
 *
 * **Compared with slack, never with `===`.** A rebalance divides a weight across siblings, and
 * the result is a repeating decimal far more often than not -- three siblings sharing 100 come
 * to 99.99999999999999 in binary floating point. An exact test would report the arithmetic as
 * broken every time it was right. The same lesson as the SQL guard in migration `0477`: a
 * check has to be exactly as tolerant as the thing it is checking.
 */
export function totalsByPillar(
  criteria: readonly { pillar: string; weight?: number }[],
): PillarTotal[] {
  const totals = new Map<string, number>();
  for (const criterion of criteria) {
    totals.set(
      criterion.pillar,
      (totals.get(criterion.pillar) ?? 0) + (criterion.weight ?? 0),
    );
  }
  return [...totals].map(([pillar, total]) => ({
    pillar,
    total,
    balanced: comesToAHundred(total),
  }));
}

/**
 * The bounds the weight sliders run between.
 *
 * **A pillar's track stops at 40 and a criterion's at 60**, which is the design's judgement
 * rather than a domain rule: eleven pillars share 100, so a track to 100 would spend
 * three-fifths of its length on values that cannot occur while the others hold anything at
 * all. Going past the ceiling is still possible -- the server rebalances and the reading
 * shows it -- the track is just scaled to where the answers actually are.
 */
export const PILLAR_SLIDER = { min: 0, step: 0.5 } as const;
export const CRITERION_SLIDER = { min: 0, step: 0.5 } as const;

/**
 * How high a weight slider's track runs, given how many weights share the 100.
 *
 * **The ceiling scales with the field, and never below what is legal.** The design draws a
 * pillar track to 40, which is four and a half times an even share of eleven -- enough head
 * room to express "this one matters much more" while keeping the resolution that makes 8 and
 * 9 distinguishable. Four pillars sharing 100 need a taller track, and three of them need the
 * whole hundred: a ceiling that clamps a weight the server would accept is a control that
 * silently refuses a legal answer, which is worse than a coarse one.
 */
export function sliderCeiling(count: number, floor: number): number {
  if (count <= 0) return 100;
  const headroom = Math.ceil((100 / count) * 4.4);
  return Math.min(100, Math.max(floor, headroom));
}

/** The head room the design gives a pillar track, and a criterion's within its pillar. */
export const PILLAR_CEILING_FLOOR = 40;
export const CRITERION_CEILING_FLOOR = 60;

/**
 * What a slider's position reads as beside it: one decimal, always.
 *
 * **A decimal that is always there is what makes the column line up.** A rebalance produces
 * fractions -- 8.5, 7.2 -- so a reading that drops `.0` when a weight happens to be whole
 * makes the numbers jump left and right as a slider moves, which reads as instability in
 * the thing being measured rather than in the formatting.
 */
export function weightReading(typed: string): string {
  const weight = weightFrom(typed);
  return weight === null ? typed : `${weight.toFixed(1)}%`;
}

/**
 * How many criteria each pillar holds.
 *
 * The line under a pillar's name, so a reader knows whether opening it reveals four rows or
 * fourteen before they open it.
 */
export function countByPillar(
  criteria: readonly { pillar: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const criterion of criteria) {
    counts.set(criterion.pillar, (counts.get(criterion.pillar) ?? 0) + 1);
  }
  return counts;
}
