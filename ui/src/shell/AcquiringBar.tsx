import { NavLink, useLocation } from "react-router-dom";
import { ROUTES } from "../navigation/routes";
import { acquiringProgress } from "./acquiringProgress";
import { useAcquiring } from "./useAcquiring";

const ACQUIRE = ROUTES.find((route) => route.label === "Acquire")!;

/**
 * A strip under the tabs while an acquisition is running, and nothing at all otherwise.
 *
 * **Because the thing it reports is happening somewhere else.** An acquisition takes minutes
 * and the reason to start one is usually to go and look at something; a progress bar that
 * only exists on the tab you left is a progress bar nobody sees. It is deliberately absent on
 * Acquire itself, where the run's own report says more than a strip could.
 *
 * Sticky under the tab strip rather than over it: at 44px it sits exactly where the tabs
 * stop, so the two read as one header rather than as two things that happen to overlap.
 */
export function AcquiringBar() {
  const acquiring = useAcquiring();
  const { pathname } = useLocation();

  if (acquiring === null || pathname === ACQUIRE.path) return null;
  const { reading, portion } = acquiringProgress(acquiring.done, acquiring.total);

  return (
    <div className="acquiring-bar" role="status">
      <span className="acquiring-bar__title">Acquiring…</span>
      {/* SVG, so the fill's width is a datum and its colour is still a class. */}
      <svg
        className="acquiring-bar__track"
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect className="acquiring-bar__fill" width={portion} height="6" />
      </svg>
      <span className="acquiring-bar__meta">{reading}</span>
      <NavLink className="acquiring-bar__link" to={ACQUIRE.path}>
        View
      </NavLink>
    </div>
  );
}
