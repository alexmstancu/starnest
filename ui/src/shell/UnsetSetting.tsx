import { Link } from "react-router-dom";
import { ApiError, isApiError } from "../api/ApiError";
import { type Names, presentError } from "../api/errorPresentation";
import { ErrorNotice } from "./ErrorNotice";
import { SCORE_SCALE_NOT_SET, remedyFor } from "./refusalRemedy";

/**
 * A screen with nothing on it because a setting has not been decided, rather than because
 * something went wrong.
 *
 * **The design draws this apart from an error, and the difference is the whole point.**
 * `score_scale_max` is provisional by design and has no default (`reqs.md`), so the shipped
 * state of a fresh installation is "no ranking" -- and meeting that as a red alert teaches a
 * reader that the product is broken on the day they install it. It is a card with the screen's
 * own heading, the reason in plain words, and the one button that lifts it.
 *
 * **Which refusals are such a state is a table, keyed by code** (PL-006, PL-019): the unset
 * score range and comparator limit, a set that scores nothing, and an anchor standing above
 * the score range. `detail` is the screen's own words for the score range, the one every
 * scored screen meets first; the others are worded from their code. Anything else is a fault
 * and goes to `ErrorNotice`.
 */
export function UnsetSetting({
  error,
  title,
  detail,
  onRetry,
  names,
}: {
  error: unknown;
  /** What this screen has none of: "No ranking", "Nothing to compare". */
  title: string;
  /** Why the score range matters here, in the reader's terms. */
  detail: string;
  onRetry?: () => void;
  names?: Names;
}) {
  const presented = presentError(error, names);
  const details = isApiError(error) ? error.details : undefined;
  const remedy = remedyFor(presented.code, details);

  if (!isUnsetState(presented.code, details) || remedy === null) {
    return <ErrorNotice error={error} onRetry={onRetry} names={names} />;
  }

  return (
    <section className="unset" aria-labelledby="unset-heading">
      <h2 id="unset-heading" className="unset__title">
        {title}
      </h2>
      <p className="unset__detail">
        {presented.code === SCORE_SCALE_NOT_SET ? detail : presented.message}
      </p>
      <Link className="button button--primary" to={remedy.path}>
        {remedy.label}
      </Link>
    </section>
  );
}

/** A refusal that is a state a setting lifts, rather than a fault. */
function isUnsetState(code: string, details: Readonly<Record<string, unknown>> = {}): boolean {
  if (code === "invalid_criterion") return details["reason"] === "anchor_above_scale";
  return UNSET_STATES.has(code);
}

const UNSET_STATES = new Set([SCORE_SCALE_NOT_SET, "comparator_limit_not_set", "cannot_be_ranked"]);

/** The comparator limit read as unset: the same state the server refuses a comparison with. */
export const NO_COMPARATOR_LIMIT = new ApiError({
  code: "comparator_limit_not_set",
  message: "",
});
