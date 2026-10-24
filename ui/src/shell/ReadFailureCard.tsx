import type { Ref } from "react";
import { CLIENT_ERROR_CODES } from "../api/ApiError";
import { presentError } from "../api/errorPresentation";
import { useAppConfig } from "../config/AppConfigContext";

/**
 * A read that never arrived (C01 M2).
 *
 * **One full card per screen; every other region that failed with it gets the compact line**
 * (N4, P1-06), so a stopped server is said once rather than six times. The compact line is a
 * `status`, not an `alert`: the screen's card has already interrupted the reader once.
 *
 * **Every read offers Try again** (P1-14): reading again changes nothing and costs nothing.
 * The code is for branching on and is never printed.
 */
export function ReadFailureCard({
  what,
  error,
  onRetry,
  retryRef,
  prominence,
}: {
  /** What was being read, as the subject of a sentence: "The ranking". */
  what: string;
  error: unknown;
  onRetry: () => void | Promise<void>;
  /** Lets the region put focus back on Try again after a retry that failed too. */
  retryRef?: Ref<HTMLButtonElement>;
  prominence: "screen" | "region";
}) {
  const { displayName } = useAppConfig();
  const presented = presentError(error);
  const title = <p className="failure-card__title">{what} could not be loaded</p>;
  const tryAgain = (
    <button ref={retryRef} type="button" className="button" onClick={() => void onRetry()}>
      Try again
    </button>
  );

  if (prominence === "region") {
    return (
      <div className="failure-card failure-card--compact" role="status">
        {title}
        {tryAgain}
      </div>
    );
  }

  return (
    <div className="failure-card" role="alert">
      {title}
      <p>{presented.message}</p>
      <p>Nothing on this screen has changed, and nothing was charged.</p>
      {presented.code === CLIENT_ERROR_CODES.unreachable && (
        <p>
          If this keeps happening, the {displayName} server is probably not running. Start it,
          then try again.
        </p>
      )}
      {tryAgain}
    </div>
  );
}
