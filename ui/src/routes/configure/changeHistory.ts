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

import { DISPLAY_LOCALE } from "../../format/display";

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
  /**
   * The stage the change was made in, named rather than numbered.
   *
   * **A number would be a second copy of the order.** The stages are numbered by a CSS
   * counter precisely so that moving a card moves its numeral with it; "Stage 3" written
   * here would be the one place that could then disagree with the screen.
   */
  stage: string;
  /** When it was made, so a list of six changes reads as a sequence rather than a heap. */
  at: Date;
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
    // The latest `at`, because the collapsed entry is the gesture as it now stands -- the
    // reading a user checks it against is "when did I last touch this", not when they
    // started.
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

/**
 * When a change was made, to the minute.
 *
 * **The clock, not the date.** Every entry here was made in this session, so a date would be
 * the same on all of them and say nothing; the minute is what separates two edits to the same
 * weight. Local time, because this is a record of what the person at the keyboard just did.
 */
export function describeWhen(at: Date): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** What is left once these have been undone. */
export function without<Value>(
  history: readonly Change<Value>[],
  undone: readonly Change<Value>[],
): Change<Value>[] {
  const gone = new Set(undone.map((change) => change.id));
  return history.filter((change) => !gone.has(change.id));
}
