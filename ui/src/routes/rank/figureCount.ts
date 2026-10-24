/**
 * How many of a level's candidates have a figure for one attribute, in words.
 *
 * **Candidates, not rows.** An attribute with breakdown options has one active figure per
 * option, so a candidate can be several rows, and counting rows reads as more of the level
 * measured than is (PL-077).
 */

export interface FigureHolder {
  candidate: string;
}

/**
 * "2 of 32 candidates have a figure for this attribute."
 *
 * **Without a total until the roster has arrived**, rather than a total of nothing or a guess:
 * the count is known from the figures alone, and the roster is a separate read.
 */
export function describeFigureCount(
  figures: readonly FigureHolder[],
  rosterSize?: number,
): string {
  const count = new Set(figures.map((figure) => figure.candidate)).size;
  const outOf = rosterSize === undefined ? "" : ` of ${rosterSize}`;
  const noun = (rosterSize ?? count) === 1 ? "candidate" : "candidates";
  const verb = count === 1 ? "has" : "have";
  return `${count}${outOf} ${noun} ${verb} a figure for this attribute.`;
}
