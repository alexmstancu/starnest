import { useEffect, useId, useRef, useState } from "react";
import { ActRefusal } from "../../shell/ActRefusal";
import { refocusIfLost } from "../../shell/focusReturn";
import { useSelection } from "../../shell/SelectionContext";
import {
  UNDO_CANNOT_RESTORE_THE_PILLAR,
  UNDO_CANNOT_RESTORE_THE_PILLARS,
  describeUndoAll,
  describeWhen,
  heldByLater,
  reachOf,
  stranded,
} from "./changeHistory";
import type { ChangeHistory, RecordedChange } from "./useChangeHistory";
import { useFocusAfterUndo } from "./useFocusAfterUndo";

/**
 * What this session has changed, newest first, and the way back.
 *
 * **Two ways back, each saying what it takes** (PL-140). "Undo this" undoes one change, and is
 * offered only while no later change touched the same setting: re-sending what it replaced over
 * a later change would undo that one too. "↑ Undo all N" undoes it and everything above it --
 * the arrow points up a list that runs newest first. Pointed at or focused, either marks the
 * entries it would undo before it is pressed.
 *
 * **Session-scoped, and the panel says so.** The backend records no change log; inventing one
 * here would be a second account of the truth the server cannot confirm.
 */
const NOTHING_PREVIEWED: ReadonlySet<number> = new Set();

/** The caveats that are about weights, which "Back to where I started" sums up in one line. */
const WEIGHT_CAVEATS: ReadonlySet<string> = new Set([
  UNDO_CANNOT_RESTORE_THE_PILLAR,
  UNDO_CANNOT_RESTORE_THE_PILLARS,
]);

/** Why "Undo this" is held, in the design's words. */
const HELD_BY = {
  same_setting: "Held by a later change to the same setting.",
  unconfirmed: "Held by a later change to this set that is not confirmed yet.",
} as const;

export function RecentChanges({
  history,
  busy,
  isDeleted,
}: {
  history: ChangeHistory;
  /**
   * The list of sets has yet to show the last set action, so nothing may be undone until it
   * does. A write in flight holds every undo through the history itself (PL-033).
   */
  busy: boolean;
  /** Whether a set is deleted now, as the list of sets says once it has settled (PL-033). */
  isDeleted: (criteriaSetId: string) => boolean;
}) {
  const headingId = useId();
  const resetCaveatId = `${headingId}-reset-caveat`;
  const caveatIdOf = (id: number) => `${headingId}-caveat-${String(id)}`;
  // Going back undoes everything, so it inherits every change's caveat: the weights' said once
  // beside it, any other -- a setting it would unset -- by the entry that carries it.
  const resetIsInexact = history.changes.some(
    (change) => change.caveat !== undefined && WEIGHT_CAVEATS.has(change.caveat),
  );
  const resetDescribedBy =
    [
      ...(resetIsInexact ? [resetCaveatId] : []),
      ...history.changes
        .filter((change) => change.caveat !== undefined && !WEIGHT_CAVEATS.has(change.caveat))
        .map((change) => caveatIdOf(change.id)),
    ].join(" ") || undefined;
  // **Held, never disabled, while a write is in flight** (NEW-34). Chromium throws focus off a
  // button the moment it is disabled, so an undo pressed from the keyboard put the reader back
  // on the page. Held, a button keeps focus and says so, and pressing it does nothing.
  const held = history.busy || busy;
  // **An entry never outlives its set** (PL-033, PL-139 D39): one whose undo would find its set
  // deleted, with nothing above it to bring the set back, cannot be undone -- so it is dropped,
  // and the rail says how many went. Only once nothing is in flight and the list of sets has
  // settled: an undo bringing a set back is above the changes it frees until it lands.
  const deleted = new Set(
    history.changes.flatMap(({ undoes }) =>
      undoes !== undefined && isDeleted(undoes.criteriaSetId) ? [undoes.criteriaSetId] : [],
    ),
  );
  const strandedIds = stranded(history.changes, deleted);
  const strandedKey = [...strandedIds].join(",");
  const { drop } = history;
  useEffect(() => {
    if (held || strandedKey === "") return;
    drop(new Set(strandedKey.split(",").map(Number)));
    // `strandedKey` says everything `strandedIds` does, and stays the same across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, strandedKey]);
  const unconfirmedIdOf = (id: number) => `${headingId}-unconfirmed-${String(id)}`;
  // Nor is anything undone through a change nobody knows took effect (PL-033).
  const blocked = (reach: readonly RecordedChange[]) =>
    reach.some((each) => strandedIds.has(each.id) || each.unconfirmed !== undefined);
  const heldFor = (reach: readonly RecordedChange[]) => held || blocked(reach);
  const heading = useRef<HTMLButtonElement>(null);
  const focus = useFocusAfterUndo(history, heading);
  const undoThrough = (id: number) => {
    if (heldFor((reachOf(history.changes, id) as RecordedChange[]))) return;
    focus.pressed();
    history.undoThrough(id);
  };
  const undoOnly = (change: RecordedChange) => {
    if (heldFor([change]) || heldByLater(history.changes, change.id) !== null) return;
    focus.pressed();
    history.undoOnly(change.id);
  };
  // **A button shows what it would take before it is pressed** (PL-140): pointed at or focused,
  // the entries it would undo are marked, and the mark goes when it is left.
  const [previewed, setPreviewed] = useState<ReadonlySet<number>>(NOTHING_PREVIEWED);
  const previewing = (ids: readonly number[]) => ({
    onMouseEnter: () => setPreviewed(new Set(ids)),
    onFocus: () => setPreviewed(new Set(ids)),
    onMouseLeave: () => setPreviewed(NOTHING_PREVIEWED),
    onBlur: () => setPreviewed(NOTHING_PREVIEWED),
  });
  // **In the set's name as it is now** (PL-140, D42), from the list every screen reads.
  const { criteriaSets } = useSelection();
  const nameOfSet = (criteriaSetId: string | undefined) =>
    criteriaSets.find((set) => set.id === criteriaSetId)?.name;
  const resetHeld = heldFor(history.changes);
  // **Check again takes its own button away** once the change is resolved -- by a press, or by
  // its request settling on its own (PL-033) -- so focus on it goes to the change's own undo, or,
  // if it turned out not to have happened, to the heading. Followed by focus rather than by the
  // press: a settlement can take the button away long after the check it pressed came back.
  const undoIdOf = (id: number) => `${headingId}-undo-${String(id)}`;
  const undoAllIdOf = (id: number) => `${headingId}-undo-all-${String(id)}`;
  const heldIdOf = (id: number) => `${headingId}-held-${String(id)}`;
  const checkFocused = useRef<number | null>(null);
  useEffect(() => {
    const id = checkFocused.current;
    if (id === null) return;
    if (history.changes.find((each) => each.id === id)?.unconfirmed !== undefined) return;
    checkFocused.current = null;
    refocusIfLost(
      document.getElementById(undoIdOf(id)),
      document.getElementById(undoAllIdOf(id)),
      heading.current,
    );
    // `undoIdOf` and `undoAllIdOf` are derived from `headingId`, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.changes]);
  const reset = () => {
    if (resetHeld) return;
    focus.pressed();
    history.reset();
  };
  // **Open, and collapsible rather than dismissible.** The rail's whole job is answering
  // "what have I just done", so it starts answering it; the collapse is for the reader who
  // has finished with it and wants the screen back. Local state, because nothing outside this
  // card has any business knowing whether it is open.
  const [shown, setShown] = useState(true);

  return (
    <section className="panel panel--rail" aria-labelledby={headingId}>
      <div className="panel__head">
        {/* The button is inside the heading rather than instead of it: the region is named by
            this heading, and a card whose title stopped being a heading would disappear from
            the list a screen reader navigates by. */}
        <h2 id={headingId} className="rail__heading">
          <button
            ref={heading}
            type="button"
            className="rail__disclosure"
            aria-expanded={shown}
            onClick={() => setShown((open) => !open)}
          >
            <span className="rail__caret" aria-hidden="true">
              {shown ? "▾" : "▸"}
            </span>
            Recent changes
            <span className="panel__count">
              {history.changes.length === 0
                ? "nothing yet"
                : `${history.changes.length} in this session`}
            </span>
          </button>
        </h2>
        {history.changes.length > 0 && (
          <button
            type="button"
            className="action"
            aria-disabled={resetHeld || undefined}
            aria-describedby={resetDescribedBy}
            onClick={reset}
          >
            Back to where I started
          </button>
        )}
      </div>

      {/* Beside the way back rather than only on the entry, because this button reaches the
          entry without the reader ever looking at it. */}
      {resetIsInexact && (
        <p id={resetCaveatId} className="panel__hint" role="note">
          Going back cannot restore every weight exactly: a change below left
          the rest of its pillar at 0.
        </p>
      )}

      {/* Why everything waits, while it does: Configure sends one write at a time, and set
          actions wait for the list to show them (PL-033). */}
      {held && (
        <p className="panel__hint" role="status">
          {history.busy
            ? "A change is being saved; the next waits until it is stored."
            : "The list of sets is being read again; undo waits for it."}
        </p>
      )}

      {history.dropped > 0 && (
        <p className="panel__hint" role="note">
          {history.dropped === 1
            ? "1 change was dropped: its set was deleted, so it cannot be undone."
            : `${String(history.dropped)} changes were dropped: their set was deleted, so they cannot be undone.`}
        </p>
      )}

      {/* Outside the collapse: a refusal to undo is about what the server holds now, and
          hiding it behind a caret would let the screen and the database disagree unnoticed. */}
      <ActRefusal act="Going back" error={history.failure} />

      {shown &&
        (history.changes.length === 0 ? (
          /* Four words, as the design has it. The paragraph that stood here explained that
             the list is session-scoped, which is true and is not what an empty panel is for:
             a reader meets it before they have made a change and needs only to know that. */
          <p className="rail__empty">No changes yet.</p>
        ) : (
          <ul className="history">
            {history.changes.map((change) => {
              const reaching = reachOf(history.changes, change.id) as RecordedChange[];
              // An undo is described by the caveat and the doubt of every change it takes.
              const describedBy = (taken: readonly RecordedChange[]) =>
                [
                  ...taken
                    .filter((each) => each.caveat !== undefined)
                    .map((each) => caveatIdOf(each.id)),
                  ...taken
                    .filter((each) => each.unconfirmed !== undefined)
                    .map((each) => unconfirmedIdOf(each.id)),
                ].join(" ") || undefined;
              const heldBy = heldByLater(history.changes, change.id);
              return (
                <li
                  key={change.id}
                  className="history__entry"
                  data-previewed={previewed.has(change.id) ? "true" : undefined}
                >
                  {/* Where it was made and when, above what it was. Six weight changes read
                      as one heap without them, and the stage is what tells a reader which
                      card to look at to see the change they are about to undo. */}
                  <div className="history__meta">
                    <span className="history__stage">{change.stage}</span>
                    <span className="history__when">
                      {describeWhen(change.at)}
                    </span>
                  </div>
                  <span className="history__label">
                    {change.describe({
                      before: change.before,
                      after: change.after,
                      inSet: nameOfSet(change.undoes?.criteriaSetId),
                    })}
                  </span>
                  {/* Before the button, so it is read before the undo is taken. */}
                  {change.caveat !== undefined && (
                    <span
                      id={caveatIdOf(change.id)}
                      className="panel__hint"
                      role="note"
                    >
                      {change.caveat}
                    </span>
                  )}
                  {change.unconfirmed !== undefined && (
                    <>
                      <span id={unconfirmedIdOf(change.id)} className="panel__hint" role="note">
                        {change.undoUnconfirmed
                          ? "Undo not confirmed: the server did not answer, so whether this was undone is not known yet."
                          : "Not confirmed: the server did not answer, so whether this took effect is not known yet."}
                        {/* What else waits on it, said where the reason is (PL-033). */}
                        {change.undoes !== undefined &&
                          " Changes to this set wait until it is checked."}
                      </span>
                      <button
                        type="button"
                        className="action"
                        aria-disabled={held || undefined}
                        onFocus={() => {
                          checkFocused.current = change.id;
                        }}
                        onBlur={(event) => {
                          // Moved on by the reader, not lost: a button taken away has nowhere
                          // it went, and some browsers say so with a blur.
                          if (event.relatedTarget !== null) checkFocused.current = null;
                        }}
                        onClick={() => {
                          if (held) return;
                          history.confirm(change.id);
                        }}
                      >
                        Check again
                      </button>
                    </>
                  )}
                  <div className="history__undo">
                    {/* **Offered only when no later change touched the same setting** (PL-140):
                        re-sent over it, this change's `before` would undo that one too. Held
                        rather than taken away, with the reason, so focus on it stays (NEW-45). */}
                    {heldBy !== null && (
                      <span id={heldIdOf(change.id)} className="panel__hint" role="note">
                        {HELD_BY[heldBy]}
                      </span>
                    )}
                    <button
                      id={undoIdOf(change.id)}
                      type="button"
                      className="action"
                      title={heldBy === null ? "Undoes this change alone." : HELD_BY[heldBy]}
                      aria-disabled={heldFor([change]) || heldBy !== null || undefined}
                      aria-describedby={
                        heldBy === null ? describedBy([change]) : heldIdOf(change.id)
                      }
                      onClick={() => undoOnly(change)}
                      {...previewing([change.id])}
                    >
                      Undo this
                    </button>
                    {reaching.length > 1 && (
                      <button
                        id={undoAllIdOf(change.id)}
                        type="button"
                        className="action"
                        title={`Undoes this change and the ${String(reaching.length - 1)} above it.`}
                        aria-disabled={heldFor(reaching) || undefined}
                        aria-describedby={describedBy(reaching)}
                        onClick={() => undoThrough(change.id)}
                        {...previewing(reaching.map((each) => each.id))}
                      >
                        <span aria-hidden="true">↑ </span>
                        {describeUndoAll(reaching.length)}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
