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
/** The hand-entry card, with the attribute whose form to open (PL-088). */
export const HAND_ENTRY = "hand-entry";

const KNOWN = new Set([UNSOURCED, HAND_ENTRY]);

/** Which attribute's form a hand-entry link asks for. */
export const ATTRIBUTE = "attribute";

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

/** A link that lands on one attribute's hand-entry form, open. */
export function linkToHandEntry(path: string, attribute: string): string {
  const query = new URLSearchParams({ [SHOW]: HAND_ENTRY, [ATTRIBUTE]: attribute });
  return `${path}?${query.toString()}`;
}

/** The attribute a hand-entry link names, or null when the URL asks for no form. */
export function handEntryAsked(search: string): string | null {
  if (highlighted(search) !== HAND_ENTRY) return null;
  const attribute = new URLSearchParams(search).get(ATTRIBUTE);
  return attribute === null || attribute === "" ? null : attribute;
}
