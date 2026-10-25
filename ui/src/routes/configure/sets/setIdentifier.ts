/**
 * Turning what somebody typed into what the catalog stores.
 *
 * **The design asks for a name and nothing else**, and the contract wants an identifier too.
 * Making the reader type `local_employment` beside "Local employment" is asking them to do the
 * computer's work; deriving it here is presentation, and the server still decides whether the
 * result is acceptable -- a collision comes back as a refusal rather than being guessed around.
 */

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
  return `${identifierFrom(name)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * What a copy is called, given what is already taken.
 *
 * **It never silently reuses a name.** "Local employment copy", then "copy 2", and so on --
 * the same rule the design's prototype uses, and the reason duplicating can be one click
 * rather than a form.
 */
export function copyName(name: string, taken: readonly string[]): string {
  const used = new Set(taken);
  const first = `${name} copy`;
  if (!used.has(first)) return first;
  for (let attempt = 2; ; attempt += 1) {
    const next = `${first} ${attempt}`;
    if (!used.has(next)) return next;
  }
}
