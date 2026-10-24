import { useId, useRef, useState } from "react";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { describeReach, describeWhen, reachOf } from "./changeHistory";
import type { ChangeHistory } from "./useChangeHistory";
import { useFocusAfterUndo } from "./useFocusAfterUndo";

/**
 * What this session has changed, newest first, and the way back.
 *
 * **Every button names its own reach.** Undoing a change takes everything made after it too --
 * a configuration is a state rather than a list of independent facts, and putting one weight
 * back without the changes made since would produce a set that never existed. Saying so on
 * the button is what stops that being a surprise.
 *
 * **Session-scoped, and the panel says so.** The backend records no change log; inventing one
 * here would be a second account of the truth the server cannot confirm.
 */
export function RecentChanges({
  history,
  busy,
}: {
  history: ChangeHistory;
  /**
   * A change is being saved, so nothing may be undone until it has answered: an undo sent
   * meanwhile would race it, and the two answers could land in either order.
   */
  busy: boolean;
}) {
  const headingId = useId();
  const resetCaveatId = `${headingId}-reset-caveat`;
  const caveatIdOf = (id: number) => `${headingId}-caveat-${String(id)}`;
  // Going back undoes everything, so it inherits every change's caveat.
  const resetIsInexact = history.changes.some(
    (change) => change.caveat !== undefined,
  );
  // **Held, never disabled, while a write is in flight** (NEW-34). Chromium throws focus off a
  // button the moment it is disabled, so an undo pressed from the keyboard put the reader back
  // on the page. Held, a button keeps focus and says so, and pressing it does nothing.
  const held = history.undoing || busy;
  const heading = useRef<HTMLButtonElement>(null);
  const focus = useFocusAfterUndo(history, heading);
  const undoThrough = (id: number) => {
    if (held) return;
    focus.pressed();
    history.undoThrough(id);
  };
  const reset = () => {
    if (held) return;
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
            aria-disabled={held || undefined}
            aria-describedby={resetIsInexact ? resetCaveatId : undefined}
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

      {/* Outside the collapse: a refusal to undo is about what the server holds now, and
          hiding it behind a caret would let the screen and the database disagree unnoticed. */}
      {history.failure !== null && <ErrorNotice error={history.failure} />}

      {shown &&
        (history.changes.length === 0 ? (
          /* Four words, as the design has it. The paragraph that stood here explained that
             the list is session-scoped, which is true and is not what an empty panel is for:
             a reader meets it before they have made a change and needs only to know that. */
          <p className="rail__empty">No changes yet.</p>
        ) : (
          <ul className="history">
            {history.changes.map((change) => {
              const reaching = reachOf(history.changes, change.id);
              // An undo takes every change after it too, so it is described by each of their
              // caveats as well as its own.
              const caveats = reaching
                .filter((each) => each.caveat !== undefined)
                .map((each) => caveatIdOf(each.id))
                .join(" ");
              return (
                <li key={change.id} className="history__entry">
                  {/* Where it was made and when, above what it was. Six weight changes read
                      as one heap without them, and the stage is what tells a reader which
                      card to look at to see the change they are about to undo. */}
                  <div className="history__meta">
                    <span className="history__stage">{change.stage}</span>
                    <span className="history__when">
                      {describeWhen(change.at)}
                    </span>
                  </div>
                  <span className="history__label">{change.label}</span>
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
                  <button
                    type="button"
                    className="action"
                    aria-disabled={held || undefined}
                    aria-describedby={caveats === "" ? undefined : caveats}
                    onClick={() => undoThrough(change.id)}
                  >
                    {describeReach(reaching.length)}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
