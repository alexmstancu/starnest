import { useCallback, useRef, useState } from "react";
import { fetchSettings, planMatchRuleResearch, type ResearchPlan } from "../../../api/endpoints";
import type { Gate } from "../proposals/researchPass";

/**
 * The estimate a re-check starts from (PL-153 stage 2): asked first and separately, as every
 * research is, so the household agrees to a figure rather than to a verb. **It allows one pass**,
 * which the screen's research pass runs; a start refused before it spent anything offers it
 * again (PL-160), rather than asking for it again.
 */
export interface RecheckEstimate {
  items: readonly Gate[];
  plan: ResearchPlan;
  /** `run_spend_cap_eur`, read with the estimate: stated, or an uncapped pass offered. */
  capEur: number | null;
}

export interface Recheck {
  estimate: RecheckEstimate | null;
  estimating: boolean;
  /** The last estimate's refusal. A failed estimate offers Try again (P1-14). */
  failure: unknown;
  resend: (() => Promise<void>) | null;
  ask: (level: string, items: readonly Gate[]) => void;
  /** The pass started from it, or the reader said Not yet. */
  forget: () => void;
  /** The pass it started was refused before it spent anything: offered again. */
  restore: () => void;
}

export function useRecheck(): Recheck {
  const [estimate, setEstimate] = useState<RecheckEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [failed, setFailed] = useState<{ level: string; items: readonly Gate[] } | null>(null);
  const startedFrom = useRef<RecheckEstimate | null>(null);
  // A ref, because two presses in one tick would both pass a check on state.
  const inFlight = useRef(false);

  function ask(level: string, items: readonly Gate[]): void {
    if (inFlight.current) return;
    inFlight.current = true;
    setEstimating(true);
    setFailure(null);
    setFailed(null);
    setEstimate(null);
    const recheck = items.flatMap((item) =>
      item.candidate === undefined ? [] : [{ match_rule: item.id, candidate: item.candidate }],
    );
    void Promise.all([planMatchRuleResearch({ level, recheck }), fetchSettings()])
      .then(([plan, settings]) =>
        setEstimate({ items, plan, capEur: settings.run_spend_cap_eur ?? null }),
      )
      .catch((error: unknown) => {
        setFailure(error);
        setFailed({ level, items });
      })
      .finally(() => {
        inFlight.current = false;
        setEstimating(false);
      });
  }

  const restore = useCallback(() => {
    if (startedFrom.current !== null) setEstimate(startedFrom.current);
    startedFrom.current = null;
  }, []);

  return {
    estimate,
    estimating,
    failure,
    resend:
      failed === null
        ? null
        : () => {
            ask(failed.level, failed.items);
            return Promise.resolve();
          },
    ask,
    forget: () => {
      startedFrom.current = estimate;
      setEstimate(null);
    },
    restore,
  };
}
