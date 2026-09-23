/**
 * Which of a pair's synthesis sentences move the total most, taking both lists together.
 *
 * The server sends two lists -- ahead on, behind on -- each already ordered by what the gap is
 * worth, and each sentence ends with the number it was ordered on: "worth +4.9 points". What
 * neither list says is how the two interleave, and that is what the design's "by impact on
 * total" ranking answers: a comparator is routinely behind by more than its best advantage is
 * ahead, and reading either list alone hides that.
 *
 * **The number is read back out of the sentence the server wrote, never recomputed and never
 * inferred from position.** Pairing each sentence with a row of `attributes` by its place in
 * the list would hold only while the server orders and truncates exactly as it does today, and
 * would mis-tag in silence the day it does not. A number taken from the sentence it is printed
 * in cannot land on the wrong line.
 */

/** The trailing clause every templated sentence ends with. */
const WORTH = /worth ([+-]\d+(?:\.\d+)?) points/;

/** How many lines the design marks. Three, and the third is already a faint signal. */
const TOP = 3;

export interface TaggedLine {
  line: string;
  /** "#1" to "#3" for the three that move the total most, and null for every other line. */
  tag: string | null;
}

export interface TaggedSynthesis {
  advantages: TaggedLine[];
  disadvantages: TaggedLine[];
}

/**
 * The same sentences back, with the top three marked.
 *
 * **One unreadable sentence withholds every tag.** The line whose number could not be found
 * might be the largest of them, and a "#1" printed beside another line would then be this
 * screen's own claim rather than the server's arithmetic. Silence is the only honest fallback.
 */
export function tagByImpact(
  advantages: readonly string[] | null | undefined,
  disadvantages: readonly string[] | null | undefined,
): TaggedSynthesis {
  const ahead = advantages ?? [];
  const lines = [...ahead, ...(disadvantages ?? [])];
  const worth = lines.map(impactOf);
  const tags = worth.some((each) => each === null)
    ? new Map<number, string>()
    : placesOf(worth as number[]);

  const tagged = lines.map((line, at) => ({ line, tag: tags.get(at) ?? null }));
  return {
    advantages: tagged.slice(0, ahead.length),
    disadvantages: tagged.slice(ahead.length),
  };
}

/**
 * What one sentence says it is worth, or null where it does not say.
 *
 * Signed, because the sign is which list it came from; the ranking uses the size alone, since
 * being 5 points behind moves the total exactly as far as being 5 points ahead.
 */
function impactOf(line: string): number | null {
  const worth = WORTH.exec(line);
  if (worth === null) return null;
  const size = Number(worth[1]);
  return Number.isNaN(size) ? null : size;
}

/** Line position to its place, largest first. */
function placesOf(worth: readonly number[]): Map<number, string> {
  const ranked = worth
    .map((each, at) => ({ at, size: Math.abs(each) }))
    // A stable sort, so two lines worth the same keep the order the server gave them -- which
    // is the order it broke its own ties in, and the reason a comparison reads identically
    // every time it is drawn.
    .sort((one, other) => other.size - one.size)
    .slice(0, TOP);

  return new Map(ranked.map((each, place) => [each.at, `#${place + 1}`]));
}
