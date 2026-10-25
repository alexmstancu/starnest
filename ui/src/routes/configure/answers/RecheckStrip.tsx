import { useState } from "react";
import { formatMoney } from "../../../format/display";
import { CheckboxField } from "../../../shell/CheckboxField";
import { describeRecheckEstimate } from "./recheck";
import type { RecheckEstimate } from "./useRecheck";

/**
 * A re-check, estimated and waiting for the reader's go-ahead (PL-153 stage 2). **Markup only**:
 * the estimate is `useRecheck.ts`, the pass the screen's `useResearchPass.ts`.
 *
 * The uncapped acceptance is **per re-check, never remembered**: it lives here, and this strip
 * goes as the re-check starts, so agreeing again is a deliberate act again.
 */
export function RecheckStrip({
  estimate,
  held,
  onStart,
  onNotYet,
}: {
  estimate: RecheckEstimate;
  /** Another pass is running: one at a time, so Start is turned away until it ends. */
  held: boolean;
  onStart: (acceptUncapped: boolean) => void;
  onNotYet: () => void;
}) {
  const [acceptUncapped, setAcceptUncapped] = useState(false);
  const { plan } = estimate;
  return (
    <div role="group" aria-label="Re-check">
      <p className="screen__note">{describeRecheckEstimate(estimate.items, plan)}</p>
      {plan.estimate_basis != null && (
        <p className="screen__note">The cost is a ceiling, not a forecast: {plan.estimate_basis}</p>
      )}
      {estimate.capEur !== null ? (
        <p className="screen__note">Halts at the {formatMoney(estimate.capEur, "EUR")} spend cap.</p>
      ) : (
        <CheckboxField id="recheck-uncapped" checked={acceptUncapped} onChange={setAcceptUncapped}>
          No spend cap is set. Accept an uncapped spend for this re-check
        </CheckboxField>
      )}
      <div className="rule-form__actions">
        <button
          type="button"
          className="button"
          aria-disabled={held || undefined}
          onClick={() => {
            if (!held) onStart(acceptUncapped);
          }}
        >
          Start the re-check
        </button>
        <button type="button" className="button" onClick={onNotYet}>
          Not yet
        </button>
      </div>
    </div>
  );
}
