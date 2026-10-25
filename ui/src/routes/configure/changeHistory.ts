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
  /**
   * What undoing this cannot do, said before it is done. Absent when the undo is exact.
   *
   * **Undo still makes the real request** -- this is the honest half of it, for the one case
   * where re-sending a value does not put everything back (`undoCanRestore`).
   */
  caveat?: string;
  /** The set undoing this writes to, and how; absent for a change outside any set (PL-033). */
  undoes?: SetUndo;
  /**
   * Present while it is unknown whether the change took effect (PL-033): its answer was lost and
   * reading it back could not say. Reads back again -- true when it did, false when it did not --
   * and shows what it found. Nothing is undone through it until it is confirmed.
   */
  unconfirmed?: () => Promise<boolean>;
}

/**
 * What undoing a change does to a set: writes to it, which needs it there; deletes it, which
 * undoes its creation; or restores it, which undoes its deletion.
 */
export interface SetUndo {
  criteriaSetId: string;
  by: "write" | "delete" | "restore";
}

/**
 * The changes whose undo would find their set deleted, given the sets deleted now (PL-033).
 *
 * Walked newest first, as an undo runs, so a restore above a change brings its set back in time
 * and a deletion above it -- undoing a creation -- takes it away. A change here would answer 404,
 * so it is dropped, and the rail says how many were (PL-139, D39).
 */
export function stranded(
  history: readonly Change[],
  deleted: ReadonlySet<string>,
): Set<number> {
  const gone = new Set(deleted);
  const found = new Set<number>();
  for (const { id, undoes } of history) {
    if (undoes === undefined) continue;
    if (undoes.by === "restore") gone.delete(undoes.criteriaSetId);
    else if (gone.has(undoes.criteriaSetId)) found.add(id);
    else if (undoes.by === "delete") gone.add(undoes.criteriaSetId);
  }
  return found;
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
 *
 * **Appended when its write commits** (PL-033): Configure sends one write at a time, so the order
 * they were sent in, the order they committed in and this order are one, and a collapse never
 * has a pending write to skip over.
 */
export function record<Value>(
  history: readonly Change<Value>[],
  change: Change<Value>,
): Change<Value>[] {
  const latest = history[0];
  // **Never across a change nobody knows took effect** (PL-033): folded into a confirmed one, its
  // resolution would take the confirmed step with it, or confirm a step that never landed.
  const bothKnown = latest?.unconfirmed === undefined && change.unconfirmed === undefined;
  if (latest?.target === change.target && bothKnown) {
    // The latest `at`, because the collapsed entry is the gesture as it now stands -- the
    // reading a user checks it against is "when did I last touch this", not when they
    // started. **The earlier caveat survives**: proportions one step destroyed are in no
    // later state either, so the whole gesture cannot be undone exactly.
    return [
      { ...change, before: latest.before, caveat: change.caveat ?? latest.caveat },
      ...history.slice(1),
    ];
  }
  return [change, ...history];
}

/** One weight in a pillar, as a rebalance answers with it. */
export interface PillarShare {
  attribute: string;
  weight?: number;
  weight_locked?: boolean;
}

/** Said on an entry whose undo cannot put the rest of its pillar back. */
export const UNDO_CANNOT_RESTORE_THE_PILLAR =
  "Undo cannot restore the rest of this pillar: this change left them all at 0, " +
  "so undoing it shares their weight out evenly.";

/** The same, one level up: a pillar's move that left every other unlocked pillar at 0. */
export const UNDO_CANNOT_RESTORE_THE_PILLARS =
  "Undo cannot restore the other pillars: this change left them all at 0, " +
  "so undoing it shares their weight out evenly.";

/**
 * Whether re-sending a weight's old value would also put the rest of its pillar back.
 *
 * **The server shares a change among the unlocked siblings in proportion to their weights**
 * (`arch.md` 8.3), so moving a weight back reverses any move that left them something to be in
 * proportion to. A move that emptied them all left nothing: the way back is shared evenly, and
 * [50, 20, 30] -> [100, 0, 0] undoes to [50, 25, 25]. Even is still exact when there is one
 * sibling to share it, or when they were even before.
 *
 * **Comparisons only.** Which weights a rebalance produces is the server's arithmetic; this
 * reads its answer and asks whether the siblings were all left empty and had differed.
 */
export function undoCanRestore(
  before: readonly PillarShare[],
  after: readonly PillarShare[],
  moved: string,
): boolean {
  const absorbers = after.filter(
    (share) => share.attribute !== moved && share.weight_locked !== true,
  );
  const leftEmpty = absorbers.every((share) => (share.weight ?? 0) === 0);
  const held = absorbers.map(
    (share) =>
      before.find((was) => was.attribute === share.attribute)?.weight ?? 0,
  );
  const heldEvenly = held.every((weight) => weight === held[0]);
  return heldEvenly || !leftEmpty;
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
