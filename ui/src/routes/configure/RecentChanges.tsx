import { useId, useState } from "react";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { describeReach, describeWhen, reachOf } from "./changeHistory";
import type { ChangeHistory } from "./useChangeHistory";

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
export function RecentChanges({ history }: { history: ChangeHistory }) {
  const headingId = useId();
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
        <h3 id={headingId} className="rail__heading">
          <button
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
        </h3>
        {history.changes.length > 0 && (
          <button
            type="button"
            className="action"
            disabled={history.undoing}
            onClick={history.reset}
          >
            Back to where I started
          </button>
        )}
      </div>

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
              const reach = reachOf(history.changes, change.id).length;
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
                  <button
                    type="button"
                    className="action"
                    disabled={history.undoing}
                    onClick={() => history.undoThrough(change.id)}
                  >
                    {describeReach(reach)}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
