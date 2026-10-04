import type { Candidate } from "../../../api/endpoints";

/**
 * Turning a roster of candidates into something a reader can pick from, and nothing else.
 *
 * **These fields used to be free text.** "Home country" accepted a telephone number, a poem, or
 * `country.atlantis` -- and the value is a foreign key, so anything but a real candidate id was
 * a save the server would refuse or, worse, a record naming a country that does not exist. The
 * control now offers the roster the database holds and will commit nothing else.
 */
export interface CandidateOption {
  id: string;
  name: string;
}

export function candidateOptions(
  roster: readonly Candidate[],
  level: string,
): CandidateOption[] {
  return roster
    .filter((candidate) => candidate.level === level)
    .map((candidate) => ({ id: candidate.id, name: candidate.name }))
    .sort((one, other) => one.name.localeCompare(other.name));
}

/**
 * What a reader has typed, reduced to what a place name can contain.
 *
 * **Letters, spaces, hyphens and apostrophes**, because those are what the roster holds --
 * "Czechia", "United Kingdom", "Bosnia-Herzegovina", "Côte d'Ivoire" if it ever appears.
 * Digits and punctuation cannot narrow the list to anything, so accepting them only lets
 * someone believe they are searching when they are not.
 *
 * Accents are kept rather than stripped: they are letters, and `\p{L}` says so without this
 * module carrying a table of which ones.
 */
export function onlyPlaceNameCharacters(typed: string): string {
  return [...typed].filter((each) => /[\p{L}\s'-]/u.test(each)).join("");
}

/**
 * The options whose name contains what was typed, ignoring case and accents.
 *
 * **Contains rather than starts-with**, because a reader looking for "United Kingdom" may well
 * type "kingdom", and a list of 32 is short enough that the looser match never floods.
 */
export function matching(
  options: readonly CandidateOption[],
  typed: string,
): CandidateOption[] {
  const wanted = foldedFor(typed).trim();
  if (wanted === "") return [...options];
  return options.filter((option) => foldedFor(option.name).includes(wanted));
}

/** Case and accents removed, so "cote" finds "Côte" and "ESTONIA" finds "Estonia". */
function foldedFor(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** What to show in the box for an id already chosen, or the id itself if it is a stranger. */
export function chosenName(
  options: readonly CandidateOption[],
  id: string,
): string {
  if (id.trim() === "") return "";
  return options.find((option) => option.id === id)?.name ?? id;
}

/**
 * Whether a stored id is one the roster actually offers.
 *
 * **An empty value is not invalid**, it is unanswered -- the two have different remedies and
 * the panel says so differently. A non-empty id the roster does not hold is a value that got in
 * before this control existed, and the reader should be told rather than have it silently
 * cleared under them.
 */
export function isAStranger(
  options: readonly CandidateOption[],
  id: string,
): boolean {
  if (id.trim() === "") return false;
  if (options.length === 0) return false; // the roster has not arrived; accuse nobody yet
  return !options.some((option) => option.id === id);
}

/** The ids a comma-separated citizenship field holds, blanks dropped. */
export function citizenshipIds(value: string): string[] {
  return value
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each !== "");
}

/** Add one id to a citizenship field, refusing a duplicate. */
export function withCitizenship(value: string, id: string): string {
  const already = citizenshipIds(value);
  return already.includes(id) ? value : [...already, id].join(", ");
}

/** Remove one id from a citizenship field. */
export function withoutCitizenship(value: string, id: string): string {
  return citizenshipIds(value)
    .filter((each) => each !== id)
    .join(", ");
}
