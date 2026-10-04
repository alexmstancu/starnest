/**
 * One item of an acquisition, as a reader's phrase rather than two keys side by side.
 *
 * **No programmatic identifiers in rendered text**, which is the design's own rule. Every list
 * on this screen -- what failed, what nobody answered, what a selection would ask about -- is a
 * list of (candidate, attribute) pairs, and all of them printed
 * `country.malta country.rail_passenger_km`: a database key shown to somebody who never chose
 * one, when the catalog has held a name for both since migration `0101`.
 *
 * **The phrase is "Rail passenger-km for Malta", and the word "for" is the point.** Two facts
 * juxtaposed with a space read as one mangled fact, and the design bars a `·` between them
 * outright -- a separator is a typographic answer to a problem that has a grammatical one. The
 * attribute leads because these lists are scanned for *what is missing*; the candidate is which
 * one of thirty-two it is missing for.
 *
 * **Shared here rather than in `format/`** because `routes/run/` is the nearest common
 * ancestor of the three components that render such a pair, and nothing outside this screen has
 * an acquisition item. `attributeName` and `candidateName` do the naming and the falling back;
 * this only says how the two go together.
 */

import { attributeName, candidateName } from "../../format/display";

/** The two catalogs a pair has to be read against. */
export interface ItemNames {
  attributes: ReadonlyMap<string, string>;
  candidates: ReadonlyMap<string, string>;
}

/**
 * One pair, as a reader sees it: "Rail passenger-km for Malta".
 *
 * **The design writes this phrase itself** -- `labelOf = r => r[2] + ' for ' + r[1]` in the
 * prototype's group builder -- so the word "for" and the attribute-first order are the
 * designer's, not an invention here.
 */
export function itemPhrase(
  names: ItemNames,
  item: { candidate: string; attribute: string },
): string {
  return `${attributeName(names.attributes, item.attribute)} for ${candidateName(names.candidates, item.candidate)}`;
}

/**
 * What to call one group of items, which depends on what they were grouped by.
 *
 * **A source is already its own name and an attribute is not.** Failures group by source, where
 * `eurostat` and `oecd` are what the publisher is called and what every other panel on this
 * screen prints; unanswered items group by attribute, where the key is a key. Passing both
 * through one naming function would turn "oecd" into "Oecd", so the grouping decides.
 */
export function groupLabel(
  names: ItemNames,
  groupedBy: "data_source" | "attribute",
  key: string,
): string {
  return groupedBy === "attribute" ? attributeName(names.attributes, key) : key;
}

/** Long enough for a sentence, short enough that a row stays a row. */
const DETAIL_LIMIT = 120;

/**
 * The right-hand detail on an item row, which says a different thing per list.
 *
 * **The design gives every item row a detail, and the two lists fill it differently**: a
 * failure's is the message the source gave, in red, because that is what distinguishes one
 * failure from the next; an unanswered item's is the fixed "no row anywhere", in grey, because
 * every one of them has the same reason and a per-item message would be the same words
 * repeated down the column.
 */
export function itemDetail(
  item: { error_message?: string | null },
  kind: "failed" | "unanswered",
): string {
  if (kind === "unanswered") return "no row anywhere";
  const message = oneLine(item.error_message);
  return message === "" ? "no reason given" : readableMessage(message);
}

/**
 * The sentence worth reading, out of whatever the source handed back.
 *
 * **A client wraps the one useful sentence inside a serialised payload**, and the front of that
 * payload is the part that says nothing: shortening `Error code: 400 - {'type': 'error',
 * 'error': {'type': 'invalid_request_error', ...` from the left gives a row as unreadable as
 * the thirty-two it replaced. So where the text carries a quoted `message` field -- which is
 * where every HTTP client in use here puts the human sentence -- that is what the row shows.
 *
 * **A miss costs nothing**, which is what makes the heuristic safe: the fallback is the message
 * itself, shortened the ordinary way.
 */
export function readableMessage(message: string): string {
  const quoted = /["']message["']\s*:\s*(["'])([\s\S]*?)\1/.exec(message);
  return shortened(oneLine(quoted?.[2]) || message);
}

/**
 * **One line, always.** A source may hand back a stack trace, and a newline inside a row makes
 * the row three rows tall -- which is the shape this screen was fixed for, in miniature.
 */
export function oneLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** A sentence cut to a row's width, at a word where there is one. */
export function shortened(sentence: string, limit = DETAIL_LIMIT): string {
  if (sentence.length <= limit) return sentence;
  const cut = sentence.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace === -1 ? cut : cut.slice(0, lastSpace);
  return `${kept.trimEnd()}…`;
}

/**
 * A group head's meta: how many items it holds, and how many of them are picked.
 *
 * **The design joins the two with a comma and leaves the second out at zero** --
 * `mine.length + ' items' + (onCount ? ', ' + onCount + ' picked' : '')`. A head that always
 * said ", 0 picked" would put a nought beside every group in a list that opens with nothing
 * selected, which is most of the time.
 */
export function groupMeta(held: number, picked: number): string {
  const items = `${String(held)} ${held === 1 ? "item" : "items"}`;
  return picked === 0 ? items : `${items}, ${String(picked)} picked`;
}
