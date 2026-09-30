/**
 * A card named in the URL, so one screen can send a reader to a particular card on another.
 *
 * **The route carries it, not a shared store.** A highlight that lived in memory would be lost
 * on a reload and invisible in a copied link, and the reader who followed it would arrive at a
 * long screen with nothing saying which card they came for. `?show=` survives both.
 *
 * `reqs.md` 8 gives the four tabs; nothing in the ontology names a card, so the value is a name
 * this module owns and validates. An unknown one highlights nothing rather than throwing: a URL
 * a reader edited by hand is not an error, it is a URL that says nothing.
 */

export const UNSOURCED = "unsourced";

const KNOWN = new Set([UNSOURCED]);

/** The parameter a link sets and the arriving screen reads. */
export const SHOW = "show";

export function highlighted(search: string): string | null {
  const asked = new URLSearchParams(search).get(SHOW);
  return asked !== null && KNOWN.has(asked) ? asked : null;
}

/** Where a link should point to land on a card. */
export function linkTo(path: string, card: string): string {
  return `${path}?${SHOW}=${card}`;
}
