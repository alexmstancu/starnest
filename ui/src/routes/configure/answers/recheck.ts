/**
 * A re-check of recorded answers (PL-153 stage 2), as items and sentences. No React and no
 * markup.
 *
 * **Offered where an answer may have gone stale**: its period has ended, or the household's
 * citizenships are no longer those it assumed (`needs_recheck`). Neither expires anything -- the
 * answer applies until a person changes it -- so a re-check only proposes, beside it.
 */

import type { MatchRuleResult, ResearchPlan } from "../../../api/endpoints";
import { formatMoney } from "../../../format/display";
import { periodHasEnded } from "../gateAnswerReading";
import type { Gate } from "../proposals/researchPass";

export function isWorthRechecking(answer: MatchRuleResult, today: string): boolean {
  return answer.needs_recheck === true || periodHasEnded(answer.reference_period, today);
}

/** One answer as a pass asks it again: its gate and candidate, named as the screen names them. */
export function recheckItem(
  answer: Pick<MatchRuleResult, "match_rule" | "candidate">,
  [gate, candidate]: [gate: string, candidate: string],
): Gate {
  return { id: answer.match_rule, candidate: answer.candidate, name: `${gate} for ${candidate}` };
}

/** What a re-check would ask and cost: the answer it names, or how many, and the estimate. */
export function describeRecheckEstimate(items: readonly Gate[], plan: ResearchPlan): string {
  const what = items.length === 1 ? (items[0]?.name ?? "") : `${String(items.length)} answers`;
  return (
    `To re-check ${what}: ${countOf(plan.gates_total, "question")}, ` +
    `${countOf(plan.llm_call_count, "call")}, at most ${formatMoney(plan.estimated_cost_eur, "EUR")}.`
  );
}

function countOf(count: number, noun: string): string {
  return `${String(count)} ${count === 1 ? noun : `${noun}s`}`;
}
