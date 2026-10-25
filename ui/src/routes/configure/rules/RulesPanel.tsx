import type { ReactNode } from "react";
import {
  type CompoundRule,
  type CriteriaSet,
  type MatchRule,
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
        columnLabel="Gate — removes from the ranking"
        rows={(listed: MatchRule[]) =>
          listed.map((rule) => ({
            id: rule.id,
            name: rule.name,
            // The level *and* the effect. A switch saying only "enforced" makes a reader
            // guess whether it matters; dropping the level to make room would lose which
            // candidates it is even asked about.
            detail: `Asked at ${rule.level ?? "every"} level.`,
            // The level *and* the effect, because a switch saying only "enforced" makes a
            // reader guess whether it matters -- and dropping the level to make room would
            // lose which candidates it is even asked about.
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
        columnLabel="Warning — keeps it, flags it"
        rows={(listed: CompoundRule[]) =>
          listed.map((rule) => ({
            id: rule.id,
            name: rule.name,
            // A phrase, not two facts joined by a separator: the middle dot is barred
            // outright, and the fix that matters is saying the thing in words.
            detail: `${rule.shape}, and ${rule.outcome}s when it fires.`,
            effect: describeCompoundEffect(rules.isApplied(rule.id)),
            idle: true,
            on: rules.isApplied(rule.id),
            toggleLabel: `Apply ${rule.name}`,
            onToggle: (wanted: boolean) => rules.apply(rule.id, wanted),
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
}

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
  columnLabel,
  rows,
}: {
  read: Read<{ items: Rule[] }>;
  /** What is being read, as the subject of a sentence. */
  what: string;
  onRetry: () => Promise<void>;
  empty: string;
  caption: string;
  columnLabel: string;
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
          <RuleRows caption={caption} columnLabel={columnLabel} listed={listed} />
        );
      }}
    </LoadedRegion>
  );
}

function RuleRows({
  caption,
  columnLabel,
  listed,
}: {
  caption: string;
  columnLabel: string;
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
          <span className="rule-row__kind">{columnLabel}</span>
        </li>
      ))}
    </ul>
  );
}
