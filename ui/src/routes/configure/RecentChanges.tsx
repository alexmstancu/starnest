import { useId } from "react";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { describeReach, reachOf } from "./changeHistory";
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

  return (
    <section className="panel panel--rail" aria-labelledby={headingId}>
      <div className="panel__head">
        <h3 id={headingId} className="rail__heading">
          Recent changes
          <span className="panel__count">
            {history.changes.length === 0
              ? "nothing yet"
              : `${history.changes.length} in this session`}
          </span>
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

      {history.failure !== null && <ErrorNotice error={history.failure} />}

      {history.changes.length === 0 ? (
        <p className="rail__empty">
          Nothing has been changed in this session. This list is not stored:
          reloading clears it, because it is a record of what this session did
          rather than of what the configuration has been through.
        </p>
      ) : (
        <ul className="history">
          {history.changes.map((change) => {
            const reach = reachOf(history.changes, change.id).length;
            return (
              <li key={change.id} className="history__entry">
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
      )}
    </section>
  );
}
