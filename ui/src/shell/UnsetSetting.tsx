import { NavLink } from "react-router-dom";
import { presentError } from "../api/errorPresentation";
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
 * Anything else is a fault and goes to `ErrorNotice`, which is still the one answer to "the
 * request failed".
 */
export function UnsetSetting({
  error,
  title,
  detail,
  onRetry,
}: {
  error: unknown;
  /** What this screen has none of: "No ranking", "Nothing to compare". */
  title: string;
  /** Why, in the reader's terms, and what setting brings it back. */
  detail: string;
  onRetry?: () => void;
}) {
  const presented = presentError(error);
  const remedy = remedyFor(presented.code);

  if (presented.code !== SCORE_SCALE_NOT_SET || remedy === null) {
    return <ErrorNotice error={error} onRetry={onRetry} />;
  }

  return (
    <section className="unset" aria-labelledby="unset-heading">
      <h2 id="unset-heading" className="unset__title">
        {title}
      </h2>
      <p className="unset__detail">{detail}</p>
      <NavLink className="button button--primary" to={remedy.path}>
        {remedy.label}
      </NavLink>
    </section>
  );
}
