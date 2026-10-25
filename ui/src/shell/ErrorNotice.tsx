import { Link } from "react-router-dom";
import { presentError } from "../api/errorPresentation";
import { isUnreachable, useWaitingForServer } from "../api/reachability";
import { remedyFor } from "./refusalRemedy";

/**
 * How every API failure appears on screen. One component, so the interface has one answer to
 * "the request failed" rather than a different one per screen.
 *
 * **The code is never shown** (PL-003): it is for branching on, and the sentence is the
 * interface's own wording of it.
 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const waitingForServer = useWaitingForServer();
  const presented = presentError(error);
  // The screen's card already says the server did not answer (PL-002, P1-06).
  if (onRetry && waitingForServer && isUnreachable(error)) {
    return (
      <div className="failure-card failure-card--compact" role="status">
        <p className="failure-card__title">This could not be loaded</p>
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  // Some refusals are the shipped state rather than a fault -- an unset score scale is the
  // one every reader meets first. Those get a way out instead of a dead end (UX review R3).
  const remedy = remedyFor(presented.code);

  return (
    <div className="notice notice--error" role="alert">
      <p className="notice__message">{presented.message}</p>
      {onRetry && presented.retryable && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
      {remedy && (
        <Link className="button" to={remedy.path}>
          {remedy.label}
        </Link>
      )}
    </div>
  );
}
