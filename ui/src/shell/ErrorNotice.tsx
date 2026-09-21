import { NavLink } from "react-router-dom";
import { presentError } from "../api/errorPresentation";
import { remedyFor } from "./refusalRemedy";

/**
 * How every API failure appears on screen. One component, so the interface has one answer to
 * "the request failed" rather than a different one per screen.
 *
 * It shows the machine-readable `code` alongside the sentence deliberately: the code is what
 * a bug report can be searched for, and what `errorPresentation` branches on.
 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const presented = presentError(error);
  // Some refusals are the shipped state rather than a fault -- an unset score scale is the
  // one every reader meets first. Those get a way out instead of a dead end (UX review R3).
  const remedy = remedyFor(presented.code);

  return (
    <div className="notice notice--error" role="alert">
      <p className="notice__message">{presented.message}</p>
      <p className="notice__code">
        <code>{presented.code}</code>
      </p>
      {onRetry && presented.retryable && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
      {remedy && (
        <NavLink className="button" to={remedy.path}>
          {remedy.label}
        </NavLink>
      )}
    </div>
  );
}
