/**
 * What the rules panel does: read the rules a level defines, and record which ones this set
 * lets act (`reqs.md` 3.7, 3.7a).
 *
 * **A rule is catalog; enforcing it is a judgement.** The gates and compound rules are the same
 * for everyone -- a visa route either exists or it does not -- but whether an answer of "no"
 * rules a candidate out is the set's opinion, which is why the toggles write to the criteria
 * set and not to the rule.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCompoundRules,
  fetchCriteriaSet,
  fetchMatchRuleResults,
  fetchMatchRules,
  fetchRanking,
  type CompoundRule,
  type CriteriaSet,
  type MatchRule,
  type MatchRuleResult,
  type Ranking,
  type RuleOutcome,
} from "../../../api/endpoints";
import type { Idle, Read } from "../../../api/read";
import { useRead } from "../../../api/useRead";
import { useCandidateRosterState } from "../../../api/useCandidateRoster";
import type { CandidateNames } from "../../../api/useCandidateNames";
import { useConfigurationSession } from "../useConfigurationSession";
import type { LabelParts } from "../changeHistory";
import { pendingEntry, settled as settledWrite, UnconfirmedWrite } from "../unknownOutcome";
import { holdsRule, ruleChangeLabel, sendRule, type RuleState } from "./ruleSwitches";

import { answersAtLevel } from "./ruleEffect";

/** Where a change to a rule is made: the stage's name, as Recent changes says it. */
const RULES_STAGE = "Match rules & gates";

export interface RuleToggles {
  matchRules: Read<{ items: MatchRule[] }>;
  /** The recorded gate answers about this level's candidates, so a rule can say what it costs. */
  matchRuleResults: MatchRuleResult[];
  /**
   * Whether the roster that places each answer at a level could be read. Until it is, nothing
   * is hidden; when it failed, the panel says the sentences count every level (PL-151).
   */
  rosterFailed: boolean;
  reloadRoster: () => void;
  /** Candidates by name, from the same roster, so reading it again names them too (NEW-06). */
  candidateNames: CandidateNames;
  /**
   * Whether the answers have been read. Until they have, what a gate costs is unknown -- and an
   * empty list read as "never fires" while they were still on their way (UI-12).
   */
  matchRuleResultsStatus: "loading" | "ready" | "error";
  compoundRules: Read<{ items: CompoundRule[] }>;
  /**
   * The live ranking, which is what says whom an applied compound rule flags (PL-156). Read
   * only while one is applied, and again after every change this panel makes.
   */
  ranking: Read<Ranking> | Idle;
  reloadRanking: () => Promise<void>;
  reloadMatchRules: () => Promise<void>;
  reloadCompoundRules: () => Promise<void>;
  failure: unknown;
  /** Another write in Configure is in flight, so a switch or a kind waits for it (PL-033). */
  held: boolean;
  isEnforced: (matchRuleId: string) => boolean;
  isApplied: (compoundRuleId: string) => boolean;
  enforce: (matchRuleId: string, wanted: boolean) => void;
  apply: (compoundRuleId: string, wanted: boolean) => void;
  /** What a gate does in this set when a candidate fails it; a gate that is off would be a gate. */
  outcomeOfGate: (matchRuleId: string) => RuleOutcome;
  /** What a compound rule does in this set when it fires; the catalog's unless the set says. */
  outcomeOfCompoundRule: (rule: CompoundRule) => RuleOutcome;
  /** Only for a rule that is on: the server refuses an outcome for one that is off. */
  holdGateAs: (matchRuleId: string, outcome: RuleOutcome) => void;
  holdCompoundRuleAs: (compoundRuleId: string, outcome: RuleOutcome) => void;
}

type Outcomes = Record<string, RuleOutcome>;

export function useRuleToggles(
  criteriaSet: CriteriaSet,
  levelId: string,
  /**
   * Changes when a gate answer has been written elsewhere -- a confirm, a research pass -- so
   * the answers are read again rather than described as they were when the panel mounted.
   */
  answersFreshness: number,
): RuleToggles {
  const matchRules = useRead(
    useCallback(
      (signal: AbortSignal) => fetchMatchRules(levelId, { signal }),
      [levelId],
    ),
  );
  // What each gate has actually decided. Read here rather than in the panel so the markup
  // stays markup, and because it is the same question the switches are about.
  // Re-read when the answers move, keeping the last answers on screen until the new ones land
  // (PL-010): a gate describes what it was last known to cost rather than going blank.
  const results = useRead(
    useCallback(
      (signal: AbortSignal) => fetchMatchRuleResults({ signal }),
      [],
    ),
    { freshness: answersFreshness },
  );

  const roster = useCandidateRosterState();
  const candidateNames = useMemo<CandidateNames>(
    () => new Map(roster.roster.map((candidate) => [candidate.id, candidate.name])),
    [roster.roster],
  );

  const compoundRules = useRead(
    useCallback(
      (signal: AbortSignal) => fetchCompoundRules(levelId, { signal }),
      [levelId],
    ),
  );

  const [enforced, setEnforced] = useState<string[]>(
    criteriaSet.enforced_match_rules ?? [],
  );
  const [applied, setApplied] = useState<string[]>(
    criteriaSet.applied_compound_rules ?? [],
  );
  const [gateOutcomes, setGateOutcomes] = useState<Outcomes>(
    criteriaSet.match_rule_outcomes ?? {},
  );
  const [compoundOutcomes, setCompoundOutcomes] = useState<Outcomes>(
    criteriaSet.compound_rule_outcomes ?? {},
  );
  const [failure, setFailure] = useState<unknown>(null);
  const [accepted, setAccepted] = useState(0);

  const ranking = useRead(
    useCallback(
      (signal: AbortSignal) => fetchRanking(criteriaSet.id, levelId, { signal }),
      [criteriaSet.id, levelId],
    ),
    // Both only ever grow, so their sum changes whenever either does.
    { enabled: applied.length > 0, freshness: answersFreshness + accepted },
  );

  // **A rule's state is shown as a write or its undo left it**, in whichever panel shows its set
  // then (PL-138): an undo can land after this panel was remounted, or after Configure was left.
  const { history, ruleAnswers } = useConfigurationSession();
  const show = useCallback((state: RuleState) => {
    const remember = state.kind === "gate" ? setEnforced : setApplied;
    const rememberOutcome = state.kind === "gate" ? setGateOutcomes : setCompoundOutcomes;
    remember((current) =>
      state.on
        ? current.includes(state.id)
          ? current
          : [...current, state.id]
        : current.filter((each) => each !== state.id),
    );
    // Switched off, a rule drops its outcome on the server, so switched on again it starts from
    // its default rather than from what it was before (D56).
    rememberOutcome((current) =>
      state.on && state.outcome !== null
        ? { ...current, [state.id]: state.outcome }
        : withoutOutcome(current, state.id),
    );
    setAccepted((count) => count + 1);
  }, []);
  useEffect(() => ruleAnswers.listen(criteriaSet.id, show), [ruleAnswers, criteriaSet.id, show]);

  const stateOf = (kind: RuleState["kind"], id: string): RuleState => {
    const on = (kind === "gate" ? enforced : applied).includes(id);
    const outcome = (kind === "gate" ? gateOutcomes : compoundOutcomes)[id];
    return { kind, id, on, outcome: on && outcome !== undefined ? outcome : null };
  };
  const nameOf = (kind: RuleState["kind"], id: string): string => {
    const read = kind === "gate" ? matchRules.read : compoundRules.read;
    const rules: readonly { id: string; name: string }[] =
      read.state === "ready" ? read.data.items : [];
    return rules.find((rule) => rule.id === id)?.name ?? id;
  };

  /**
   * **The screen changes only once the server has accepted the change.** A switch that ticked
   * itself optimistically and then failed would leave the screen claiming a gate is enforced
   * when it is not -- the one thing this panel must never do, because a gate decides whether a
   * candidate can be ranked at all. The same holds for a gate softened to a warning.
   *
   * **Configure's one write in flight** (PL-033): a rule's switch or kind changes the set, so it
   * takes the slot every other set write takes, and an answer lost on the way is read back. It
   * is **listed in Recent changes with the request that reverses it** (PL-138): the rule as it
   * was, sent again.
   */
  const write = (after: RuleState) => {
    const sentFor = criteriaSet.id;
    const before = stateOf(after.kind, after.id);
    const named = nameOf(after.kind, after.id);
    const setName = criteriaSet.name;
    const done = history.begin(sentFor);
    if (done === null) return;
    setFailure(null);
    const entry = {
      target: `${after.kind}:${sentFor}:${after.id}`,
      stage: RULES_STAGE,
      describe: ({ before: from, after: to, inSet }: LabelParts) =>
        `${ruleChangeLabel(named, from as RuleState, to as RuleState)}, in ${inSet ?? setName}`,
      before,
      after,
      reverse: async (back: unknown) => {
        const state = back as RuleState;
        await sendRule(sentFor, state);
        ruleAnswers.deliver(sentFor, state);
      },
      undoes: { criteriaSetId: sentFor, by: "write" as const },
    };
    void settledWrite(
      () => sendRule(sentFor, after).then(() => true as const),
      async (signal) =>
        holdsRule(await fetchCriteriaSet(sentFor, { signal }), after) ? true : null,
    )
      .then(() => {
        ruleAnswers.deliver(sentFor, after);
        history.note(entry);
      })
      .catch((error: unknown) => {
        // Unknown, it is listed unconfirmed and holds the set's writes until it is known.
        if (error instanceof UnconfirmedWrite) {
          history.note({
            ...entry,
            ...pendingEntry(error, () => ruleAnswers.deliver(sentFor, after)),
          });
        } else setFailure(error);
      })
      .finally(done);
  };

  return {
    matchRules: settled(matchRules.read),
    matchRuleResults: answersAtLevel(
      results.read.state === "ready" ? results.read.data.items : [],
      roster.roster,
      levelId,
    ),
    rosterFailed: roster.status === "error",
    reloadRoster: roster.reload,
    candidateNames,
    matchRuleResultsStatus: statusOf(results.read),
    compoundRules: settled(compoundRules.read),
    ranking: ranking.read,
    reloadRanking: ranking.reload,
    reloadMatchRules: matchRules.reload,
    reloadCompoundRules: compoundRules.reload,
    failure,
    held: history.busy || history.waitsFor(criteriaSet.id),
    isEnforced: (matchRuleId) => enforced.includes(matchRuleId),
    isApplied: (compoundRuleId) => applied.includes(compoundRuleId),
    enforce: (matchRuleId, wanted) =>
      write({ kind: "gate", id: matchRuleId, on: wanted, outcome: null }),
    apply: (compoundRuleId, wanted) =>
      write({ kind: "compound", id: compoundRuleId, on: wanted, outcome: null }),
    // A gate newly enforced is a gate, as the server makes it.
    outcomeOfGate: (matchRuleId) => gateOutcomes[matchRuleId] ?? "not_matching",
    outcomeOfCompoundRule: (rule) => compoundOutcomes[rule.id] ?? rule.outcome,
    holdGateAs: (matchRuleId, outcome) =>
      write({ kind: "gate", id: matchRuleId, on: true, outcome }),
    holdCompoundRuleAs: (compoundRuleId, outcome) =>
      write({ kind: "compound", id: compoundRuleId, on: true, outcome }),
  };
}

function withoutOutcome(current: Outcomes, id: string): Outcomes {
  return Object.fromEntries(Object.entries(current).filter(([held]) => held !== id));
}

/** These reads are always enabled, so never idle; this says so to the type. */
function settled<T>(read: Read<T> | Idle): Read<T> {
  return read.state === "idle" ? { state: "pending" } : read;
}

function statusOf(read: Read<unknown> | Idle): RuleToggles["matchRuleResultsStatus"] {
  if (read.state === "ready") return "ready";
  return read.state === "failed" ? "error" : "loading";
}
