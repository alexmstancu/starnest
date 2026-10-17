/**
 * Gate proposals and research passes, read into sentences. No React and no markup.
 */

import { isApiError } from "../../../api/ApiError";
import type { MatchRuleResult } from "../../../api/endpoints";
import { formatDate, formatMoney } from "../../../format/display";

/**
 * The period a proposed answer holds for (UI-13), or that nobody recorded one.
 *
 * **Shown so it is not lost unseen.** Confirming used to drop it, and the row never showed it,
 * so a gate answer that holds only until a date read the same as one that holds for ever.
 */
export function describePeriod(
  period: MatchRuleResult["reference_period"],
): string {
  if (period == null) return "No period recorded";
  return `${formatDate(period.start)} to ${formatDate(period.end)}`;
}

/** What a research pass answers with about itself, beside the proposals it made. */
export interface ResearchPass {
  cost_eur: number;
  calls: number;
  halted_on_spend_cap: boolean;
}

/**
 * What the last research pass actually did (UI-14): what it spent, how many calls it made, and
 * whether the spend cap stopped it.
 *
 * **A pass halted half way must not look finished.** The estimate is a ceiling and the spend is
 * a fact, so the two are shown together -- and a stop at the cap says which gates were left.
 */
export function describePass(pass: ResearchPass): string {
  const did =
    pass.calls === 0
      ? "made no calls and spent nothing"
      : `made ${pass.calls === 1 ? "1 call" : `${pass.calls} calls`} and spent ${formatMoney(pass.cost_eur, "EUR")}`;
  return pass.halted_on_spend_cap
    ? `The last pass stopped at the spend cap: it ${did}, and the gates after that were not asked.`
    : `The last pass ${did}.`;
}

/**
 * Whether a research request that failed is known to have spent nothing (UI-14).
 *
 * **A refusal in the contract's shape -- a 4xx carrying a code -- is the server saying no before
 * the model was asked anything**: no spend cap, a scope it will not research. Anything else -- a
 * 5xx, a timeout the proxy turned into a 504, the network gone -- can come after calls that were
 * billed, and the response that would have said how many never arrived.
 */
export function spendIsKnown(failure: unknown): boolean {
  return (
    isApiError(failure) &&
    failure.status !== null &&
    failure.status >= 400 &&
    failure.status < 500 &&
    !failure.code.startsWith("client.")
  );
}

/** Said in place of a failed pass's spend when nothing says what it was. */
export const SPEND_NOT_KNOWN =
  "This pass failed before it said what it spent, so what it cost is not known.";
