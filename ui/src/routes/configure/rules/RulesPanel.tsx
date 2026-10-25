import type { ReactNode } from "react";
import {
  type CompoundRule,
  type CriteriaSet,
  type MatchRule,
  type RuleOutcome,
} from "../../../api/endpoints";
import type { Read } from "../../../api/read";
import { candidateName } from "../../../format/display";
import { ActRefusal } from "../../../shell/ActRefusal";
import { ReadFailureCard } from "../../../shell/ReadFailureCard";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import {
  describeClearance,
  describeCompoundEffect,
  describeGateEffect,
  type RuleEffect,
} from "./ruleEffect";
import { useGateEvidence } from "./useGateEvidence";
import { type RuleToggles, useRuleToggles } from "./useRuleToggles";

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
  const names = rules.candidateNames;
  const evidence = useGateEvidence(
    criteriaSet.id,
    levelId,
    rulesInForce(rules),
    answersFreshness,
  );
  const nameOf = (candidate: string) => candidateName(names, candidate);
  // Which answers are at this level is unknown until the roster has placed them (PL-151): a
  // pending roster is "reading", never every level's answers counted as this one's.
  const answers =
    rules.matchRuleResultsStatus === "error"
      ? ("error" as const)
      : rules.matchRuleResultsStatus === "loading" || evidence.rosterReading
        ? ("reading" as const)
        : rules.matchRuleResults;

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

      {/* Every gate that is on, and every compound rule, says whom it acts on from the ranking. */}
      {evidence.ranking.state === "failed" && (
        <ReadFailureCard
          what="Whom the rules remove or flag"
          error={evidence.ranking.error}
          onRetry={evidence.reloadRanking}
          prominence="region"
        />
      )}

      <h3 className="panel__heading">Gates</h3>
      {/* Hides nothing rather than guess a level: the sentences below then count every
          level's answers, and say so (PL-151). */}
      {rules.rosterFailed && (
        <p className="screen__note" role="status">
          The list of places could not be read, so each gate counts its answers at every level.{" "}
          <button type="button" className="button" onClick={rules.reloadRoster}>
            Try again
          </button>
        </p>
      )}
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
            // Which citizenships clear it, and whether the household holds one (PL-164).
            clearance: describeClearance(rule, evidence.held, nameOf),
            effect: describeGateEffect(rule, {
              enforced: rules.isEnforced(rule.id),
              outcome: rules.outcomeOfGate(rule.id),
              level: levelId,
              ranking: evidence.ranking,
              answers,
              held: evidence.held,
              nameOf,
            }),
            on: rules.isEnforced(rule.id),
            toggleLabel: `Enforce ${rule.name}`,
            onToggle: (wanted: boolean) => rules.enforce(rule.id, wanted),
            outcome: rules.outcomeOfGate(rule.id),
            onOutcome: (outcome: RuleOutcome) => rules.holdGateAs(rule.id, outcome),
            held: rules.held,
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
            effect: describeCompoundEffect(rule.id, {
              applied: rules.isApplied(rule.id),
              outcome: rules.outcomeOfCompoundRule(rule),
              ranking: evidence.ranking,
              level: levelId,
            }),
            on: rules.isApplied(rule.id),
            toggleLabel: `Apply ${rule.name}`,
            onToggle: (wanted: boolean) => rules.apply(rule.id, wanted),
            // Its kind from its outcome in this set (PL-158), never from the list it sits in.
            outcome: rules.outcomeOfCompoundRule(rule),
            onOutcome: (outcome: RuleOutcome) => rules.holdCompoundRuleAs(rule.id, outcome),
            held: rules.held,
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
  /** What clears a gate, and whether the household holds it; absent where nothing clears it. */
  clearance?: string | null;
  /** What it is doing right now, and so its colour. */
  effect: RuleEffect;
  on: boolean;
  toggleLabel: string;
  onToggle: (wanted: boolean) => void;
  /** What it does when it fires, in this set. */
  outcome: RuleOutcome;
  onOutcome: (outcome: RuleOutcome) => void;
  /** Another write in Configure is in flight, so this one waits for it (PL-033). */
  held: boolean;
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
            aria-disabled={row.held || undefined}
            onClick={() => {
              if (!row.held) row.onToggle(!row.on);
            }}
          >
            <span className="switch__knob" aria-hidden="true" />
          </button>
          <span className="rule-row__what">
            <span className="rule-row__name">{row.name}</span>
            <span className="rule-row__detail">{row.detail}</span>
            {row.clearance != null && (
              <span className="rule-row__detail">{row.clearance}</span>
            )}
            {/* What it is doing *right now*, which is the question a switch raises and a
                description cannot answer. */}
            {/* Coloured by what it does, never red for a rule that costs nothing; a rule that is
                off is drawn as off whatever it would do (PL-156). */}
            <span
              className={`rule-row__effect rule-row__effect--${row.on ? row.effect.tone : "off"}`}
            >
              {row.effect.sentence}
            </span>
          </span>
          {/* **Held, not disabled, while the rule is off** (D56): the server keeps an outcome
              only for a rule that is on, and refuses one sent with the switch going off. */}
          <select
            className="field__control rule-row__kind"
            aria-label={`What ${row.name} does when it fires`}
            aria-disabled={!row.on || row.held || undefined}
            title={row.on ? undefined : "Switch the rule on to choose whether it acts as a gate or a warning."}
            value={row.outcome}
            onChange={(event) => {
              if (row.on && !row.held) row.onOutcome(event.target.value as RuleOutcome);
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

/**
 * This set's rules as they stand, in one string: what the ranking depends on among them. Null
 * until both lists are settled, so the ranking is not read once for a half-known set.
 */
function rulesInForce(rules: RuleToggles): string | null {
  if (rules.matchRules.state === "pending" || rules.compoundRules.state === "pending") return null;
  const gates = rules.matchRules.state === "ready" ? rules.matchRules.data.items : [];
  const compound = rules.compoundRules.state === "ready" ? rules.compoundRules.data.items : [];
  return [
    ...gates.map((gate) =>
      rules.isEnforced(gate.id) ? `${gate.id}=${rules.outcomeOfGate(gate.id)}` : "",
    ),
    ...compound.map((rule) =>
      rules.isApplied(rule.id) ? `${rule.id}=${rules.outcomeOfCompoundRule(rule)}` : "",
    ),
  ].join(",");
}
