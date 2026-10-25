import type { ReactNode } from "react";
import {
  type CompoundRule,
  type CriteriaSet,
  type MatchRule,
  type RuleOutcome,
} from "../../../api/endpoints";
import { useCandidateNames } from "../../../api/useCandidateNames";
import type { Read } from "../../../api/read";
import { candidateName } from "../../../format/display";
import { ActRefusal } from "../../../shell/ActRefusal";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import {
  describeCompoundEffect,
  describeEffect,
  describeUnreadAnswers,
} from "./ruleEffect";
import { useRuleToggles } from "./useRuleToggles";

/**
 * The rules that exist, and which of them this set lets act (`reqs.md` 3.7, 3.7a).
 *
 * **Two different consequences, kept apart on screen.** A match rule can make a candidate
 * `not_matching`, which costs it its rank while it keeps its score (`reqs.md` 5.5). A compound
 * rule usually only warns. Presenting them in one list would suggest the two switches do the
 * same thing.
 *
 * **Markup only.** Reading the rules and writing a toggle are `useRuleToggles.ts`.
 */
export function RulesPanel({
  criteriaSet,
  levelId,
  answersFreshness,
  children,
}: {
  criteriaSet: CriteriaSet;
  levelId: string;
  /** Changes when a gate answer has been written elsewhere, so the answers are read again. */
  answersFreshness: number;
  /** The gate proposals, rendered inside the stage: a proposal answers one of these rules. */
  children?: ReactNode;
}) {
  const rules = useRuleToggles(criteriaSet, levelId, answersFreshness);
  // Candidates by name in the sentences, never by id (NEW-06).
  const names = useCandidateNames();
  const answers = rules.matchRuleResultsStatus;

  return (
    <>
      <ActRefusal act="The change to the gate" error={rules.failure} />

      {/* Said once, at the top, because the difference between the two kinds is the thing a
          reader has to hold while reading either list. The disc marks it as the note that
          explains the two lists rather than a warning about either of them: the shape says
          which kind of message this is before the sentence is read. */}
      <p className="rule-note rule-note--marked">
        <span className="rule-note__mark" aria-hidden="true">
          i
        </span>
        <span>
          A <strong>gate</strong> makes a candidate not matching, which costs it
          its rank and leaves its score intact. A <strong>warning</strong> keeps
          it ranked and says why. Turn one off and it stops being applied — and a
          rule nobody has answered never fires either way.
        </span>
      </p>

      <h3 className="panel__heading">Gates</h3>
      <RuleList
        read={rules.matchRules}
        what="The gates"
        onRetry={rules.reloadMatchRules}
        empty="No gate is defined at this level."
        caption="Gates. Enforcing one lets it rule a candidate out."
        rows={(listed: MatchRule[]) =>
          listed.map((rule) => ({
            id: rule.id,
            name: rule.name,
            // What the gate tests, as the catalog words it (PL-155): its level alone left a
            // reader to guess what "A visa route exists" is actually checked against.
            detail: rule.description,
            effect:
              answers === "ready"
                ? describeEffect(rule.id, rules.matchRuleResults, {
                    enforced: rules.isEnforced(rule.id),
                    nameOf: (candidate) => candidateName(names, candidate),
                  })
                : describeUnreadAnswers(answers),
            idle: answers !== "ready",
            on: rules.isEnforced(rule.id),
            toggleLabel: `Enforce ${rule.name}`,
            onToggle: (wanted: boolean) => rules.enforce(rule.id, wanted),
            outcome: rules.outcomeOfGate(rule.id),
            onOutcome: (outcome: RuleOutcome) => rules.holdGateAs(rule.id, outcome),
          }))
        }
      />

      <h3 className="panel__heading">Compound rules</h3>
      <RuleList
        read={rules.compoundRules}
        what="The compound rules"
        onRetry={rules.reloadCompoundRules}
        empty="No compound rule is defined at this level."
        caption="Compound rules, with what each one does when it fires."
        rows={(listed: CompoundRule[]) =>
          listed.map((rule) => ({
            id: rule.id,
            name: rule.name,
            // Written by the server from the rule's conditions, naming attributes and bands
            // (PL-155): the shape and outcome as vocabulary tokens told a reader nothing.
            detail: rule.description,
            effect: describeCompoundEffect(rules.isApplied(rule.id)),
            idle: true,
            on: rules.isApplied(rule.id),
            toggleLabel: `Apply ${rule.name}`,
            onToggle: (wanted: boolean) => rules.apply(rule.id, wanted),
            // Its kind from its outcome in this set (PL-158), never from the list it sits in.
            outcome: rules.outcomeOfCompoundRule(rule),
            onOutcome: (outcome: RuleOutcome) => rules.holdCompoundRuleAs(rule.id, outcome),
          }))
        }
      />
      {children}
    </>
  );
}

interface RuleRow {
  id: string;
  name: string;
  detail: string;
  /** What it is doing right now, or where to find out. */
  effect: string;
  /** Said quietly: a pointer, or a state still unknown, rather than a cost. */
  idle: boolean;
  on: boolean;
  toggleLabel: string;
  onToggle: (wanted: boolean) => void;
  /** What it does when it fires, in this set. */
  outcome: RuleOutcome;
  onOutcome: (outcome: RuleOutcome) => void;
}

const OUTCOME_LABELS: Record<RuleOutcome, string> = {
  not_matching: "Gate — removes from the ranking",
  warning: "Warning — keeps it, flags it",
};

/**
 * One list of rules with one switch each. Written once for both kinds because the shape of the
 * table is the same; what differs is only what the switch means, which the labels carry.
 */
function RuleList<Rule>({
  read,
  what,
  onRetry,
  empty,
  caption,
  rows,
}: {
  read: Read<{ items: Rule[] }>;
  /** What is being read, as the subject of a sentence. */
  what: string;
  onRetry: () => Promise<void>;
  empty: string;
  caption: string;
  rows: (items: Rule[]) => RuleRow[];
}) {
  return (
    <LoadedRegion
      read={read}
      what={what}
      skeleton="lines"
      onRetry={onRetry}
      prominence="region"
    >
      {(data) => {
        const listed = rows(data.items);
        return listed.length === 0 ? (
          <p className="screen__note">{empty}</p>
        ) : (
          <RuleRows caption={caption} listed={listed} />
        );
      }}
    </LoadedRegion>
  );
}

function RuleRows({
  caption,
  listed,
}: {
  caption: string;
  listed: RuleRow[];
}) {
  return (
    <ul className="rule-list" aria-label={caption}>
      {listed.map((row) => (
        <li key={row.id} className="rule-row" aria-label={row.name}>
          {/* **A switch, because being in force is a state the rule is in.** It leads the row
              for the same reason it leads a source's: what a reader scans for is which of
              these are on, and a column of switches down the left answers that in one pass. */}
          <button
            type="button"
            role="switch"
            aria-checked={row.on}
            aria-label={row.toggleLabel}
            title={
              row.on
                ? "On in this set. Switch it off and it stops being applied."
                : "Off in this set. Switch it on to apply it."
            }
            className="switch"
            onClick={() => row.onToggle(!row.on)}
          >
            <span className="switch__knob" aria-hidden="true" />
          </button>
          <span className="rule-row__what">
            <span className="rule-row__name">{row.name}</span>
            <span className="rule-row__detail">{row.detail}</span>
            {/* What it is doing *right now*, which is the question a switch raises and a
                description cannot answer. */}
            <span
              className={
                row.idle
                  ? "rule-row__effect rule-row__effect--idle"
                  : "rule-row__effect"
              }
            >
              {row.effect}
            </span>
          </span>
          {/* **Held, not disabled, while the rule is off** (D56): the server keeps an outcome
              only for a rule that is on, and refuses one sent with the switch going off. */}
          <select
            className="field__control rule-row__kind"
            aria-label={`What ${row.name} does when it fires`}
            aria-disabled={!row.on}
            title={row.on ? undefined : "Switch the rule on to choose whether it acts as a gate or a warning."}
            value={row.outcome}
            onChange={(event) => {
              if (row.on) row.onOutcome(event.target.value as RuleOutcome);
            }}
          >
            {(Object.keys(OUTCOME_LABELS) as RuleOutcome[]).map((outcome) => (
              <option key={outcome} value={outcome}>
                {OUTCOME_LABELS[outcome]}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}
