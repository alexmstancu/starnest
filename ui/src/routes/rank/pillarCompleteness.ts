/**
 * How much of what is being scored has a figure in use, said above the rows that name it.
 *
 * A pillar's score is a weighted mean of the criteria that could be scored, so an attribute
 * with no figure in use does not score badly -- it drops out, and a reader looking at
 * "nature 61" has no way to tell whether that rests on eight attributes or on three.
 *
 * **It counts the rows it sits above** (PL-068): the scored attributes the drill-down lists and
 * the "no value in use" rows among them. A count that took a different view of "has a figure"
 * from the table beneath it would be the screen disagreeing with itself -- so a rejected figure,
 * or one from a switched-off source, is not a figure in use here either.
 */

import { pillarName } from "../../format/display";
import type { DrillRow } from "./drillRows";

export interface Completeness {
  /** Scored attributes with no figure in use. */
  missing: number;
  /** How many scored attributes were counted -- the chosen pillar's, or the whole set's. */
  counted: number;
  sentence: string;
}

/**
 * What to say above the rows, or null when there is nothing to say.
 *
 * **Null rather than an empty sentence** when no row is scored: while the scoring is pending or
 * has failed, and for a pillar the pass scored nothing in, the truthful answer is silence.
 *
 * @param rows the drill-down's rows, already narrowed to `pillar` when one is chosen.
 */
export function pillarCompleteness(
  rows: readonly DrillRow[],
  pillar: string | null,
  /** The catalog's pillar names: a sentence names a pillar as the charts beside it do. */
  names: ReadonlyMap<string, string>,
): Completeness | null {
  const counted = new Set(
    rows.filter((row) => row.scored).map((row) => row.attribute),
  ).size;
  if (counted === 0) return null;

  const missing = rows.filter((row) => row.kind === "missing").length;
  return { missing, counted, sentence: say(missing, counted, pillar, names) };
}

function say(
  missing: number,
  counted: number,
  pillar: string | null,
  names: ReadonlyMap<string, string>,
): string {
  // One phrase serves both scopes: "attributes in Safety" and "attributes this set scores".
  // The pillar is the catalog's name, as the cards and charts beside this sentence call it --
  // never the id, which read "in economics" under a card saying "Economy" (NEW-08).
  const scope =
    pillar === null ? "this set scores" : `in ${pillarName(names, pillar)}`;

  if (missing === 0) {
    return `Every attribute ${scope} has a value in use.`;
  }
  // Said whole rather than as "3 of the 3": a fraction that is all of something reads as
  // though part of it survived.
  if (missing === counted) {
    return `Nothing ${scope} has a value in use.`;
  }
  // Only reachable with at least two counted, so "attributes" is never the wrong plural.
  const verb = missing === 1 ? "has" : "have";
  return `${missing} of the ${counted} attributes ${scope} ${verb} no value in use.`;
}
