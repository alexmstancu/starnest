/**
 * Keeping a comparator selection inside the limit the settings name.
 *
 * **The limit was enforced only when adding.** Lowering it in Configure left a selection above
 * it untouched, and the note read "You have 5 of 2" while all five stayed in the matrix --
 * a request the real application cannot make, because `/comparisons` answers 409 above the
 * limit. The design's round-2 review found the same fault in its prototype (R4).
 */

/**
 * The selection, trimmed to the newest N.
 *
 * **Newest rather than first.** A selection is built by clicking, so the last few clicks are
 * the ones somebody is currently thinking about; dropping those and keeping the oldest would
 * discard exactly the comparators they just chose.
 */
export function withinLimit(
  comparators: readonly string[],
  limit: number | null | undefined,
): string[] {
  // A limit that is not a number is no limit here. The server still refuses, and its refusal
  // is what appears -- guessing a bound the settings do not state would be this screen
  // inventing policy.
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
    return [...comparators];
  }
  return comparators.slice(Math.max(0, comparators.length - limit));
}

/** How many were dropped, so the screen can say so rather than silently losing them. */
export function droppedByLimit(
  comparators: readonly string[],
  limit: number | null | undefined,
): number {
  return comparators.length - withinLimit(comparators, limit).length;
}
