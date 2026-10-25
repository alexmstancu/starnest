import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import type { MatchRuleResult } from "../../../api/endpoints";
import { useCandidateNames } from "../../../api/useCandidateNames";
import { useMatchRuleNames } from "../../../api/useMatchRuleNames";
import { candidateName, formatMatchStatus, matchRuleName } from "../../../format/display";
import { ActRefusal } from "../../../shell/ActRefusal";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import { dayOf, inReadingOrder } from "../gateAnswerReading";
import { leavesEstimateUnspent } from "../proposals/researchPass";
import type { ResearchPass } from "../proposals/useResearchPass";
import { isWorthRechecking, recheckItem } from "./recheck";
import { RecheckStrip } from "./RecheckStrip";
import { useRecheck } from "./useRecheck";
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
  pass,
  form,
}: {
  levelId: string;
  answersFreshness: number;
  onAnswered: () => void;
  /**
   * The screen's one research pass: Save waits while it asks, and a re-check runs through it,
   * with its Stop, its progress and its kept outcome (PL-153 stage 2).
   */
  pass: ResearchPass;
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
  const researching = pass.running;

  // **A re-check asks again about answers a person recorded** (PL-153 stage 2): estimated here,
  // run as the screen's pass. Focus goes back to the Re-check that opened it when its strip goes.
  const recheck = useRecheck();
  const opener = useRef<HTMLElement | null>(null);
  const recordedHeading = useRef<HTMLHeadingElement>(null);
  const askRecheck = (worth: readonly MatchRuleResult[], button: HTMLElement) => {
    opener.current = button;
    recheck.ask(levelId, worth.map((answer) => recheckItem(answer, names(answer))));
  };
  const handFocusBack = () => {
    if (opener.current?.isConnected) opener.current.focus();
    else recordedHeading.current?.focus();
  };
  const { end } = pass;
  const { restore } = recheck;
  useEffect(() => {
    if (end !== null && end.pass.recheck && leavesEstimateUnspent(end)) restore();
  }, [end, restore]);
  const recheckHeld = tableHeld || researching || recheck.estimating;
  const worthRechecking = answers.recorded.filter((answer) => isWorthRechecking(answer, today));

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

      <h4 ref={recordedHeading} className="gate-answers__heading" tabIndex={-1}>
        Recorded answers
      </h4>
      <ActRefusal act="The re-check's estimate" error={recheck.failure} onResend={recheck.resend ?? undefined} />
      {recheck.estimate !== null && (
        <RecheckStrip
          estimate={recheck.estimate}
          held={researching}
          onStart={(acceptUncapped) => {
            const { estimate } = recheck;
            if (estimate === null) return;
            handFocusBack();
            recheck.forget();
            pass.start({
              level: levelId,
              questionsTotal: estimate.plan.gates_total,
              acceptUncapped,
              ceilingEur: estimate.plan.estimated_cost_eur,
              recheck: estimate.items,
            });
          }}
          onNotYet={() => {
            handFocusBack();
            recheck.forget();
          }}
        />
      )}
      <LoadedRegion
        read={answers.read}
        what="The gate answers"
        skeleton="lines"
        onRetry={answers.reload}
        prominence="region"
      >
        {() => (
          <>
          {worthRechecking.length > 1 && (
            <div className="rule-form__actions">
              <button
                type="button"
                className="button"
                aria-disabled={recheckHeld || undefined}
                onClick={(event) => {
                  if (!recheckHeld) askRecheck(worthRechecking, event.currentTarget);
                }}
              >
                Re-check the {worthRechecking.length} answers to look at again
              </button>
            </div>
          )}
          <RecordedAnswersTable
            recorded={inReadingOrder(answers.recorded, today, names)}
            names={names}
            citizenshipName={(candidate) => candidateName(candidateNames, candidate)}
            today={today}
            now={now}
            held={tableHeld}
            onChange={(answer) => fill(draftFrom(answer))}
            onTake={(answer, proposal) => fill(draftFromProposal(answer, proposal))}
            recheckHeld={recheckHeld}
            onRecheck={(answer, button) => askRecheck([answer], button)}
          />
          </>
        )}
      </LoadedRegion>
    </section>
  );
}
