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
    balanced: Math.abs(total - 100) < ROUNDING_SLACK,
  }));
}
