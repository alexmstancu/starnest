/**
 * Every configuration change this session made, newest first, and what undoing one would cost.
 *
 * **Session-scoped on purpose.** Nothing here is persisted: the backend records no change log,
 * and inventing one in the client would be a second account of the truth that the server
 * cannot confirm. Reloading clears it, which is honest -- the history is a record of what
 * *this* session did, not of what the configuration has been through.
 *
 * **Undo re-issues the real request; it never restores local state.** An undo that only put a
 * number back on screen would disagree with the server the moment anything else read it, and
 * a configuration screen that lies about what is stored is worse than one with no undo at all.
 */

export interface Change<Value = unknown> {
  /** Unique and increasing, so "everything after this" is a comparison rather than a search. */
  id: number;
  /**
   * What was changed, as an identity rather than a sentence: two edits to the same target
   * collapse, and a target spelled two ways would not.
   */
  target: string;
  /** What to call it on screen. */
  label: string;
  before: Value;
  after: Value;
}

/**
 * Add a change, collapsing a repeat of the same target into the one already there.
 *
 * **A drag is one undo step, not forty.** A slider fires on every movement, and a history that
 * recorded each would bury the change before it and make undo useless. Collapsing keeps the
 * *original* `before` -- which is what undoing the whole gesture has to put back -- and takes
 * the latest `after`.
 *
 * **Only a repeat of the most recent change collapses.** Editing housing, then career, then
 * housing again is three decisions, and folding the two housing edits together would undo a
 * career change nobody asked to undo.
 */
export function record<Value>(
  history: readonly Change<Value>[],
  change: Change<Value>,
): Change<Value>[] {
  const latest = history[0];
  if (latest?.target === change.target) {
    return [{ ...change, before: latest.before }, ...history.slice(1)];
  }
  return [change, ...history];
}

/**
 * The changes undoing this one would take with it, newest first.
 *
 * **Everything after it goes too.** A configuration is a state, not a list of independent
 * facts: putting one weight back without the changes made since would produce a set that
 * never existed. Naming the reach on the button is what stops that being a surprise.
 */
export function reachOf<Value>(
  history: readonly Change<Value>[],
  id: number,
): Change<Value>[] {
  const at = history.findIndex((change) => change.id === id);
  return at === -1 ? [] : history.slice(0, at + 1);
}

/** What the button says, so the reach is stated before it is taken rather than after. */
export function describeReach(reach: number): string {
  if (reach <= 0) return "Nothing to undo";
  if (reach === 1) return "Undo this";
  return `Undo this and the ${reach - 1} after it`;
}

/** What is left once these have been undone. */
export function without<Value>(
  history: readonly Change<Value>[],
  undone: readonly Change<Value>[],
): Change<Value>[] {
  const gone = new Set(undone.map((change) => change.id));
  return history.filter((change) => !gone.has(change.id));
}
