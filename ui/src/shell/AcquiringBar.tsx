import { NavLink, useLocation } from "react-router-dom";
import { ROUTES } from "../navigation/routes";
import { useSelection } from "./SelectionContext";
import { acquiringProgress } from "./acquiringProgress";
import { type Acquiring, useAcquiring } from "./useAcquiring";

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
 *
 * **The strip is not a live region** (PL-131): its count moves on every look, and a screen
 * reader read each one out. A separate, always-present status says only that a run started or
 * ended -- always present, because the strip is gone by the time there is an end to say.
 */
export function AcquiringBar() {
  // **Watched on every screen, Acquire included**, so the sidebar hears that a run has ended
  // wherever the reader is -- only the strip itself stays off Acquire.
  const { noteAcquisitionEnded } = useSelection();
  const { acquiring, announcement } = useAcquiring(noteAcquisitionEnded);
  const onAcquire = useLocation().pathname === ACQUIRE.path;

  return (
    <>
      <p className="visually-hidden" role="status" data-testid="acquisition-announcer">
        {onAcquire ? "" : announcement}
      </p>
      {acquiring !== null && !onAcquire && <Strip acquiring={acquiring} />}
    </>
  );
}

function Strip({ acquiring }: { acquiring: Acquiring }) {
  const { reading, portion } = acquiringProgress(acquiring.done, acquiring.total);

  return (
    <section className="acquiring-bar" aria-label="Acquisition in progress">
      <span className="acquiring-bar__title">
        {acquiring.stopping ? "Stopping…" : "Acquiring…"}
      </span>
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
    </section>
  );
}
