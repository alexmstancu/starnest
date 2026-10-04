/**
 * Reading a weight, and what moving one would do to its siblings. Shared by the two levels of
 * weighting, and by neither's markup.
 *
 * A weight is a percentage the user types, so it arrives as text and may not be a number at
 * all. **Nothing is sent until it is one**: the server would refuse it, and the refusal would
 * be about parsing rather than about weights -- which tells the user nothing they can act on.
 *
 * `previewRebalance` is the one piece of arithmetic here that the server also does, and the
 * reason is in its own docs: the server is asked once, when the pointer lifts, so something
 * has to answer "and the others?" for the length of the gesture. It is a preview, overwritten
 * by the response within that same gesture, and never an authority on what a weight is.
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
 * One weight in a rebalance: a pillar's within its level, or a criterion's within its pillar.
 *
 * **One shape for both levels**, as on the server -- `WeightedItem` in
 * `criteria/rebalancing.py` -- because the arithmetic does not care which of the two hundreds
 * is being shared out.
 */
export interface WeightedItem {
  identifier: string;
  weight: number;
  locked: boolean;
}

/** A preview that says nothing: no drag is in progress, or the locks leave the move no room. */
export const NOTHING_PREVIEWED: ReadonlyMap<string, number> = new Map();

/** What a level's pillar weights look like to a rebalance. */
export function weightedPillars(
  weights: readonly { pillar: string; weight: number; weight_locked: boolean }[],
): WeightedItem[] {
  return weights.map((each) => ({
    identifier: each.pillar,
    weight: each.weight,
    locked: each.weight_locked,
  }));
}

/** What a pillar's criteria look like to a rebalance. */
export function weightedCriteria(
  criteria: readonly {
    attribute: string;
    weight?: number;
    weight_locked?: boolean;
  }[],
): WeightedItem[] {
  return criteria.map((each) => ({
    identifier: each.attribute,
    // Zero where the server sent no weight at all, which it never does -- `weight` is required
    // on `Criterion` and optional only in the generated type.
    weight: each.weight ?? 0,
    locked: each.weight_locked ?? false,
  }));
}

/** What a set of weights comes to, which is the one thing a rebalance may never change. */
const TOTAL = 100;

/**
 * What every weight would become if the drag in progress were let go now.
 *
 * **A mirror of `rebalance()` in `backend/src/starnest/criteria/rebalancing.py`**, and the only
 * arithmetic here that the server also does. It exists because the server is asked once, on
 * release (`arch.md` 8.3): without it ten siblings sit still under the thumb and the total
 * reads 97 for the length of a gesture, which looks like the rule being broken rather than a
 * request not yet sent. **Nothing it produces is stored, scored or sent** -- the response
 * replaces it within the same gesture -- so this is a presentational guard and not a second
 * authority on what a weight is.
 *
 * The rule, in a sentence: the unlocked siblings absorb the change in proportion to what they
 * already hold, a locked sibling does not move, and the residue of the division lands on the
 * largest absorber. The fixtures in `weights.test.ts` are lifted from
 * `backend/tests/unit/criteria/test_rebalancing.py`, so changing the Python breaks this.
 *
 * **An impossible move previews nothing, and the empty map is how it says so.** Locks that
 * leave no room are a refusal, and the refusal is the server's to word (`reqs.md` 3.4): the
 * rows stay where they are until the release brings back the 409 naming the locks in the way.
 */
export function previewRebalance(
  items: readonly WeightedItem[],
  moved: string,
  to: number,
): ReadonlyMap<string, number> {
  const target = items.find((item) => item.identifier === moved);
  // A lock is the user saying "not this one", and the one it was placed on is this one.
  if (target === undefined || target.locked) return NOTHING_PREVIEWED;
  // A range slider cannot ask for either of these; `weightFrom` can, so they are answered.
  if (to < 0 || to > TOTAL) return NOTHING_PREVIEWED;
  if (new Set(items.map((item) => item.identifier)).size !== items.length) {
    return NOTHING_PREVIEWED;
  }

  const siblings = items.filter((item) => item.identifier !== moved);
  const absorbers = siblings.filter((item) => !item.locked);
  // Nothing to absorb the change: every sibling is locked, or there is no sibling at all
  // because one weight in a pillar already holds the whole hundred of it.
  if (absorbers.length === 0) return NOTHING_PREVIEWED;

  const held = totalOf(siblings.filter((item) => item.locked));
  // The locked weights already claim more than what is left, so no arrangement sums to 100.
  if (to + held > TOTAL) return NOTHING_PREVIEWED;

  const available = TOTAL - to - held;
  const absorbed = totalOf(absorbers);
  const shared = absorbers.map((absorber) => ({
    identifier: absorber.identifier,
    // An absorber at zero stays at zero under proportional sharing, so when every absorber is
    // at zero there is no proportion to go by and the room is split evenly. That is the only
    // sensible reading of "share this out among things that currently hold none".
    weight:
      available *
      (absorbed > 0 ? absorber.weight / absorbed : 1 / absorbers.length),
  }));

  // **The residue goes on the largest absorber**, as `_corrected_for_rounding` does: dividing
  // 100 three ways leaves a remainder in binary floating point as surely as in `Decimal`, and
  // it has to land somewhere or the total reads 99.999. The largest is where it is least
  // visible as a proportion of itself. A residue of zero added is the same act, so there is no
  // case here to split.
  const residue = available - totalOf(shared);
  const largest = shared.reduce((biggest, each) =>
    each.weight > biggest.weight ? each : biggest,
  );
  largest.weight += residue;

  const previewed: [string, number][] = [
    [moved, to],
    ...shared.map((each): [string, number] => [each.identifier, each.weight]),
    // Returned although they have not changed, the way `rebalance()` returns every identifier:
    // a caller then reads one answer rather than working out which rows it covers.
    ...siblings
      .filter((item) => item.locked)
      .map((item): [string, number] => [item.identifier, item.weight]),
  ];
  return new Map(previewed);
}

/**
 * What a set of weights comes to as the screen is showing them.
 *
 * **The running total has to read what the rows read.** Mid-drag the rows show the preview, and
 * a total summed from the stored weights would say 97 beside rows that visibly come to 100 --
 * the screen disagreeing with itself, which is the fault the chip is there to report.
 */
export function previewedTotal(
  items: readonly WeightedItem[],
  preview: ReadonlyMap<string, number>,
): number {
  return totalOf(
    items.map((item) => ({
      weight: preview.get(item.identifier) ?? item.weight,
    })),
  );
}

/**
 * The criteria as the screen is showing them, for the per-pillar totals beside them.
 *
 * Keeps only what `totalsByPillar` reads: the point is the weight a row is displaying, and
 * carrying the rest of the criterion through would suggest the preview had changed more of it.
 */
export function previewedCriteria(
  criteria: readonly { attribute: string; pillar: string; weight?: number }[],
  preview: ReadonlyMap<string, number>,
): { pillar: string; weight?: number }[] {
  return criteria.map((criterion) => ({
    pillar: criterion.pillar,
    weight: preview.get(criterion.attribute) ?? criterion.weight,
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
