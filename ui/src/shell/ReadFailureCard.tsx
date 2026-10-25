import type { Ref } from "react";
import { Link } from "react-router-dom";
import { isApiError } from "../api/ApiError";
import { type Names, presentError } from "../api/errorPresentation";
import { isUnreachable, useWaitingForServer } from "../api/reachability";
import { useAppConfig } from "../config/AppConfigContext";
import { remedyFor } from "./refusalRemedy";

/**
 * A read that never arrived (C01 M2).
 *
 * **One full card per screen; every other region that failed with it gets the compact line**
 * (N4, P1-06), so a stopped server is said once rather than six times. The compact line is a
 * `status`, not an `alert`: the screen's card has already interrupted the reader once.
 *
 * **Every read offers Try again** (P1-14): reading again changes nothing and costs nothing.
 * The code is for branching on and is never printed.
 *
 * **A server that did not answer is said once, by the screen's card** (`ServerDownCard`), so
 * a region that failed that way draws the compact line whatever it was asked for.
 *
 * **A refusal names what it concerns, never its ids** (P1-07), from `names`; and one that a
 * setting lifts offers the way to it beside Try again (`remedyFor`).
 */
export function ReadFailureCard({
  what,
  error,
  onRetry,
  retryRef,
  prominence,
  names,
}: {
  /** What was being read, as the subject of a sentence: "The ranking". */
  what: string;
  error: unknown;
  onRetry: () => void | Promise<void>;
  /** Lets the region put focus back on Try again after a retry that failed too. */
  retryRef?: Ref<HTMLButtonElement>;
  prominence: "screen" | "region";
  /** Names for the ids a refusal carries: the candidates a comparison concerned. */
  names?: Names;
}) {
  const waitingForServer = useWaitingForServer();
  const saidByTheScreen = waitingForServer && isUnreachable(error);
  if (prominence === "region" || saidByTheScreen) {
    return (
      <div className="failure-card failure-card--compact" role="status">
        <p className="failure-card__title">{what} could not be loaded</p>
        <button ref={retryRef} type="button" className="button" onClick={() => void onRetry()}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <ReadFailureCardInFull
      what={what}
      error={error}
      onRetry={onRetry}
      retryRef={retryRef}
      names={names}
    />
  );
}

/** The full card, never compacted: a region's own, or the one card a screen draws (P1-06). */
export function ReadFailureCardInFull({
  what,
  error,
  onRetry,
  retryRef,
  names,
}: {
  what: string;
  error: unknown;
  onRetry: () => void | Promise<void>;
  retryRef?: Ref<HTMLButtonElement>;
  names?: Names;
}) {
  const { displayName } = useAppConfig();
  const presented = presentError(error, names);
  const remedy = remedyFor(presented.code, isApiError(error) ? error.details : undefined);
  return (
    <div className="failure-card" role="alert">
      <p className="failure-card__title">{what} could not be loaded</p>
      <p>{presented.message}</p>
      <p>Nothing on this screen has changed, and nothing was charged.</p>
      {isUnreachable(error) && (
        <p>
          If this keeps happening, the {displayName} server is probably not running. Start it,
          then try again.
        </p>
      )}
      <div className="failure-card__acts">
        <button ref={retryRef} type="button" className="button" onClick={() => void onRetry()}>
          Try again
        </button>
        {remedy && (
          <Link className="button" to={remedy.path}>
            {remedy.label}
          </Link>
        )}
      </div>
    </div>
  );
}
