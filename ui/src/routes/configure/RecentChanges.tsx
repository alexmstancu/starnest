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
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        Recent changes
      </h3>

      {history.failure !== null && <ErrorNotice error={history.failure} />}

      {history.changes.length === 0 ? (
        <p className="panel__hint">
          Nothing has been changed in this session. This list is not stored:
          reloading clears it, because it is a record of what this session did
          rather than of what the configuration has been through.
        </p>
      ) : (
        <>
          <ul className="history">
            {history.changes.map((change) => {
              const reach = reachOf(history.changes, change.id).length;
              return (
                <li key={change.id} className="history__entry">
                  <span className="history__label">{change.label}</span>
                  <button
                    type="button"
                    className="button"
                    disabled={history.undoing}
                    onClick={() => history.undoThrough(change.id)}
                  >
                    {describeReach(reach)}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="button"
            disabled={history.undoing}
            onClick={history.reset}
          >
            Back to where I started
          </button>
        </>
      )}
    </section>
  );
}
