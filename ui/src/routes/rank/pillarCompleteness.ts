/**
 * How much of what a pillar scores this candidate actually has a figure for.
 *
 * A pillar's score is a weighted mean of the criteria that could be scored, so an attribute
 * with nothing stored against it does not score badly -- it drops out, and a reader looking at
 * "nature 61" has no way to tell whether that rests on eight attributes or on three.
 *
 * **It counts what is stored, not what scores.** A rejected figure is still a stored value,
 * and the table underneath says which figures were rejected; a count that quietly took a
 * different view of "has a figure" from the table it sits above would be the screen
 * disagreeing with itself.
 */

/** A criterion as this count needs one: its attribute, its pillar, and whether it counts. */
export interface ScoredCriterion {
  attribute: string;
  pillar: string;
  is_scored?: boolean;
}

export interface Stored {
  attribute: string;
}

export interface Completeness {
  /** Scored attributes with nothing stored against them. */
  missing: number;
  /** How many scored attributes were counted -- the chosen pillar's, or the whole set's. */
  counted: number;
  sentence: string;
}

/**
 * What to say above the stored values, or null when there is nothing to say.
 *
 * **Null rather than an empty sentence** when the set scores nothing here: before the criteria
 * set has arrived, and for a pillar the set does not score, the truthful answer is silence.
 *
 * **A criterion the set does not score is not counted as a gap.** It contributes no weight, so
 * a missing figure for it costs the pillar nothing -- calling it incomplete would invite the
 * reader to go looking for data that would change no number (`reqs.md` 3.0).
 */
export function pillarCompleteness(
  criteria: readonly ScoredCriterion[] | null | undefined,
  values: readonly Stored[] | null | undefined,
  pillar: string | null,
): Completeness | null {
  const counted = (criteria ?? []).filter(
    (each) =>
      each.is_scored !== false && (pillar === null || each.pillar === pillar),
  );
  if (counted.length === 0) return null;

  const stored = new Set((values ?? []).map((value) => value.attribute));
  const missing = counted.filter((each) => !stored.has(each.attribute)).length;

  return { missing, counted: counted.length, sentence: say(missing, counted.length, pillar) };
}

function say(missing: number, counted: number, pillar: string | null): string {
  // One phrase serves both scopes: "attributes in safety" and "attributes this set scores".
  // Ids are lowercase and underscored, and this is the middle of a sentence, so it stays that
  // way rather than being capitalised the way a heading would be.
  const scope =
    pillar === null ? "this set scores" : `in ${pillar.replace(/_/g, " ")}`;

  if (missing === 0) {
    return `Every attribute ${scope} has a stored value.`;
  }
  // Said whole rather than as "3 of the 3": a fraction that is all of something reads as
  // though part of it survived.
  if (missing === counted) {
    return `Nothing ${scope} has a stored value.`;
  }
  // Only reachable with at least two counted, so "attributes" is never the wrong plural.
  const verb = missing === 1 ? "has" : "have";
  return `${missing} of the ${counted} attributes ${scope} ${verb} no stored value.`;
}
