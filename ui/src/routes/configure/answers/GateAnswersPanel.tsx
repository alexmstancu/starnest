import { type Ref, useImperativeHandle, useRef } from "react";
import type { MatchRuleResult } from "../../../api/endpoints";
import { useCandidateNames } from "../../../api/useCandidateNames";
import { useMatchRuleNames } from "../../../api/useMatchRuleNames";
import { candidateName, formatMatchStatus, matchRuleName } from "../../../format/display";
import { ActRefusal } from "../../../shell/ActRefusal";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import { dayOf, inReadingOrder } from "../gateAnswerReading";
import { draftAnsweringOtherwise, draftFrom, draftFromProposal } from "./gateAnswerForm";
import { GateAnswerFormPanel } from "./GateAnswerFormPanel";
import { RecordedAnswersTable } from "./RecordedAnswersTable";
import { useGateAnswers } from "./useGateAnswers";

/**
 * Gate answers a person gives: record one, override one with a reason, correct one, or rule a
 * candidate out by hand (UI-29, `reqs.md` 8.2) -- and every answer already recorded, with its
 * period and age (BE-36 stage 1).
 *
 * **Outside the set's rules, keyed by level** (D4): answers are objective and belong to no set.
 * **Gates and candidates by name, never by id.**
 */
/** What another panel may ask of this one: the form, filled to answer a proposal otherwise. */
export interface AnswerForm {
  answerOtherwise: (
    proposal: Pick<MatchRuleResult, "match_rule" | "candidate" | "match_result">,
  ) => void;
}

export function GateAnswersPanel({
  levelId,
  answersFreshness,
  onAnswered,
  researching,
  form,
}: {
  levelId: string;
  answersFreshness: number;
  onAnswered: () => void;
  /** A research pass is asking: Save waits for it. */
  researching: boolean;
  /** Lets the proposals open this form on a pair (PL-153), as Change and Take the proposal do. */
  form?: Ref<AnswerForm>;
}) {
  const answers = useGateAnswers(levelId, answersFreshness, onAnswered);
  const gateNames = useMatchRuleNames();
  const candidateNames = useCandidateNames();
  const firstField = useRef<HTMLSelectElement>(null);
  const now = new Date();
  const today = dayOf(now);
  const names = (answer: Pick<MatchRuleResult, "match_rule" | "candidate">): [string, string] => [
    matchRuleName(gateNames, answer.match_rule),
    candidateName(candidateNames, answer.candidate),
  ];
  const fill = (draft: Parameters<typeof answers.load>[0]) => {
    answers.load(draft);
    firstField.current?.focus();
  };
  useImperativeHandle(form, () => ({
    answerOtherwise: (proposal) => fill(draftAnsweringOtherwise(proposal)),
  }));
  const tableHeld = answers.saving || answers.stale;

  return (
    <section className="panel" aria-labelledby="gate-answers-heading">
      <h3 id="gate-answers-heading" className="panel__heading">
        Gate answers
      </h3>
      <p className="panel__hint">
        What you have found out about a gate, for one candidate. It is recorded as yours and
        applies to every criteria set that enforces the gate. To rule a candidate out by hand,
        answer “Not excluded by hand” with Not matching.
      </p>

      <LoadedRegion
        read={answers.gates}
        what="The gates"
        skeleton="lines"
        onRetry={answers.reloadGates}
        prominence="region"
      >
        {() => <GateAnswerFormPanel answers={answers} researching={researching} firstField={firstField} />}
      </LoadedRegion>
      <ActRefusal act="The gate answer" error={answers.failure} />
      <p className="panel__hint" role="status">
        {answers.saved !== null &&
          `Recorded ${formatMatchStatus(answers.saved.match_result)} for ${names(answers.saved).join(" and ")}.`}
      </p>

      <h4 className="gate-answers__heading">Recorded answers</h4>
      <LoadedRegion
        read={answers.read}
        what="The gate answers"
        skeleton="lines"
        onRetry={answers.reload}
        prominence="region"
      >
        {() => (
          <RecordedAnswersTable
            recorded={inReadingOrder(answers.recorded, today, names)}
            names={names}
            citizenshipName={(candidate) => candidateName(candidateNames, candidate)}
            today={today}
            now={now}
            held={tableHeld}
            onChange={(answer) => fill(draftFrom(answer))}
            onTake={(answer, proposal) => fill(draftFromProposal(answer, proposal))}
          />
        )}
      </LoadedRegion>
    </section>
  );
}
