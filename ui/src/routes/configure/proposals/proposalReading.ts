/**
 * Gate proposals, read into sentences. No React and no markup. A research pass has its own,
 * `researchPass.ts`.
 */

import type { MatchRuleResult } from "../../../api/endpoints";
import { formatDate } from "../../../format/display";

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
