/**
 * Turning what somebody typed into what the catalog stores.
 *
 * **The design asks for a name and nothing else**, and the contract wants an identifier too.
 * Making the reader type `local_employment` beside "Local employment" is asking them to do the
 * computer's work; deriving it here is presentation, and the server still decides whether the
 * result is acceptable -- a collision comes back as a refusal rather than being guessed around.
 */

/**
 * The longest name a set may have: the contract's `CriteriaSetName.maxLength`, which a test holds
 * this to. Longer is refused with the reason, never cut: a field that silently shortens a paste
 * is the rewrite C02 rules out (PL-041).
 */
export const SET_NAME_LIMIT = 60;

/**
 * A catalog identifier from a name: lower case, words joined by underscores, nothing else.
 *
 * Anything outside `a-z0-9` becomes a separator, so "Alex + Teodora" reads `alex_teodora`
 * rather than carrying a character the catalog has never held.
 */
export function identifierFrom(name: string): string {
  return name
    .normalize("NFD")
    // Strip the accents rather than the letters: "Zürich" is `zurich`, not `zrich`.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * An identifier for a set this tab is about to make: the name's, and a mark only this request
 * carries (PL-033).
 *
 * **What a tab claims it must be able to prove.** When a create's answer is lost, the set is
 * read back under the identifier that was sent; derived from the name alone, it could be another
 * tab's set of the same name, and the undo of "Created" would delete that tab's work.
 */
export function ownIdentifier(name: string): string {
  return `${catalogStem(identifierFrom(name))}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A stem the catalog accepts, which starts with a letter (PL-039): `set` when nothing Latin is
 * left of the name -- "Ελλάδα" -- and `set_` before one that starts with a digit -- "2026 plan".
 * The server derives its own identifiers the same way (`openapi.yaml`, `NewCriteriaSetId`).
 */
function catalogStem(stem: string): string {
  if (stem === "") return "set";
  return /^[a-z]/.test(stem) ? stem : `set_${stem}`;
}

/** A name as uniqueness reads it: case and surrounding spaces tell no two sets apart (PL-036). */
function comparable(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Why a name cannot be a set's, said before anything is sent, or null when it can. A
 * presentational guard, worded as the server's own refusal is: the server still refuses a name
 * another set holds, which another tab may have taken meanwhile.
 */
export function nameRefusal(name: string, taken: readonly string[]): string | null {
  const wanted = name.trim();
  if (wanted.length > SET_NAME_LIMIT) {
    return `A set's name can be at most ${String(SET_NAME_LIMIT)} characters.`;
  }
  const clash = taken.find((each) => comparable(each) === comparable(wanted));
  return clash === undefined ? null : `Another criteria set is already called “${clash}”.`;
}

/**
 * What a copy is called, given what is already taken.
 *
 * **It never silently reuses a name**, in any case (PL-036): "Local employment copy", then
 * "copy 2", and so on -- the same rule the design's prototype uses, and the reason duplicating
 * can be one click rather than a form. A name too long to take the suffix is shortened before
 * it, so the copy's name is one the server accepts (PL-041).
 */
export function copyName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map(comparable));
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? " copy" : ` copy ${String(attempt)}`;
    // Cut before the suffix rather than refused: a copy of a long name is still a copy of it.
    const next = `${name.trim().slice(0, SET_NAME_LIMIT - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(comparable(next))) return next;
  }
}
