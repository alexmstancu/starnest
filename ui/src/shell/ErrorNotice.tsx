import { presentError } from "../api/errorPresentation";

/**
 * How every API failure appears on screen. One component, so the interface has one answer to
 * "the request failed" rather than a different one per screen.
 *
 * It shows the machine-readable `code` alongside the sentence deliberately: the code is what
 * a bug report can be searched for, and what `errorPresentation` branches on.
 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const presented = presentError(error);

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
    </div>
  );
}
