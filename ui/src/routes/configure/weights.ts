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
