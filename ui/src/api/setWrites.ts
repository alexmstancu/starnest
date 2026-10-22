/**
 * How many writes to each criteria set have been answered, for the life of the page.
 *
 * **A read of a set is only as fresh as the writes answered before it began** (UIC-A3, RD-2). A
 * read taken before a write to its set committed, but answered after the write was, holds the
 * set as it used to be; shown, it put a pillar back at 60 that had just been stored at 70. So
 * the client notes every write it sends under a set once it is answered (`client.ts`), and the
 * one screen that reads a whole set compares the count when its read began with the count when
 * the answer lands, and reads again rather than show the older set.
 *
 * **The page's, not a component's.** A write's answer can land after the panel that sent it has
 * gone -- the set switched away from, the screen left -- and the read it outdates is outdated
 * all the same. A write whose answer never arrived is not counted: it is unknown whether it
 * changed anything.
 */

const answered = new Map<string, number>();

export function noteAnsweredWrite(criteriaSetId: string): void {
  answered.set(criteriaSetId, answeredWrites(criteriaSetId) + 1);
}

export function answeredWrites(criteriaSetId: string): number {
  return answered.get(criteriaSetId) ?? 0;
}

/** Every test is a page of its own. */
export function forgetAnsweredWrites(): void {
  answered.clear();
}
