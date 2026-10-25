import { useRef } from "react";
import { useCandidateNames } from "../../../api/useCandidateNames";
import { useMatchRuleNames } from "../../../api/useMatchRuleNames";
import { candidateName, formatMatchStatus, matchRuleName } from "../../../format/display";
import { ActRefusal } from "../../../shell/ActRefusal";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import { GateAnswerFormPanel } from "./GateAnswerFormPanel";
import { useGateAnswers } from "./useGateAnswers";

/**
 * Gate answers a person gives: record one, override one with a reason, or rule a candidate out
 * by hand (UI-29, `reqs.md` 8.2).
 *
 * **Outside the set's rules, keyed by level** (D4): answers are objective and belong to no set.
 * **Gates and candidates by name, never by id.**
 */
export function GateAnswersPanel({
  levelId,
  onAnswered,
  researching,
}: {
  levelId: string;
  onAnswered: () => void;
  /** A research pass is asking: Save waits for it. */
  researching: boolean;
}) {
  const answers = useGateAnswers(levelId, onAnswered);
  const gateNames = useMatchRuleNames();
  const candidateNames = useCandidateNames();
  const firstField = useRef<HTMLSelectElement>(null);
  const saved = answers.saved;

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
        {saved !== null &&
          `Recorded ${formatMatchStatus(saved.match_result)} for ${matchRuleName(gateNames, saved.match_rule)} and ${candidateName(candidateNames, saved.candidate)}.`}
      </p>
    </section>
  );
}
