import type { MatchRuleResult } from "../../api/endpoints";
import { formatMatchStatus, matchRuleName } from "../../format/display";
import { inReadingOrder } from "../configure/gateAnswerReading";

/**
 * One candidate's gate answers, in the order they are reviewed (PL-154): ended periods first,
 * then by gate name. **Every answer, proposals among them**, because a proposal is displayed
 * with its sources even though it rules nothing out (`reqs.md` 6.10 use 3).
 */
export function answersAbout(
  answers: readonly MatchRuleResult[],
  candidate: string,
  today: string,
  gates: ReadonlyMap<string, string>,
): MatchRuleResult[] {
  return inReadingOrder(
    answers.filter((answer) => answer.candidate === candidate),
    today,
    (answer) => [matchRuleName(gates, answer.match_rule), ""],
  );
}

/** The answer in words, saying when it is a proposal that rules nothing out. */
export function answerInWords(answer: Pick<MatchRuleResult, "match_result" | "is_proposal">): string {
  const said = formatMatchStatus(answer.match_result);
  return answer.is_proposal === true
    ? `${said}, proposed by research: it rules nothing out until a person confirms it`
    : said;
}
