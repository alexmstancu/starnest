/**
 * What the rules panel does: read the rules a level defines, and record which ones this set
 * lets act (`reqs.md` 3.7, 3.7a).
 *
 * **A rule is catalog; enforcing it is a judgement.** The gates and compound rules are the same
 * for everyone -- a visa route either exists or it does not -- but whether an answer of "no"
 * rules a candidate out is the set's opinion, which is why the toggles write to the criteria
 * set and not to the rule.
 */

import { useCallback, useState } from "react";
import {
  fetchCompoundRules,
  fetchMatchRuleResults,
  fetchMatchRules,
  setCompoundRuleApplication,
  setMatchRuleEnforcement,
  type CompoundRule,
  type CriteriaSet,
  type MatchRule,
  type MatchRuleResult,
  type RuleOutcome,
} from "../../../api/endpoints";
import type { Idle, Read } from "../../../api/read";
import { useRead } from "../../../api/useRead";

export interface RuleToggles {
  matchRules: Read<{ items: MatchRule[] }>;
  /** Every recorded gate answer, so a rule can say what it is actually costing. */
  matchRuleResults: MatchRuleResult[];
  /**
   * Whether the answers have been read. Until they have, what a gate costs is unknown -- and an
   * empty list read as "never fires" while they were still on their way (UI-12).
   */
  matchRuleResultsStatus: "loading" | "ready" | "error";
  compoundRules: Read<{ items: CompoundRule[] }>;
  reloadMatchRules: () => Promise<void>;
  reloadCompoundRules: () => Promise<void>;
  failure: unknown;
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

  /**
   * **The screen changes only once the server has accepted the change.** A switch that ticked
   * itself optimistically and then failed would leave the screen claiming a gate is enforced
   * when it is not -- the one thing this panel must never do, because a gate decides whether a
   * candidate can be ranked at all. The same holds for a gate softened to a warning.
   */
  const save = useCallback(
    async (write: () => Promise<void>, accepted: () => void) => {
      setFailure(null);
      try {
        await write();
        accepted();
      } catch (error) {
        setFailure(error);
      }
    },
    [],
  );

  const toggle = (
    id: string,
    wanted: boolean,
    write: (wanted: boolean) => Promise<void>,
    remember: (change: (current: string[]) => string[]) => void,
    rememberOutcome: (change: (current: Outcomes) => Outcomes) => void,
  ) =>
    void save(
      () => write(wanted),
      () => {
        remember((current) =>
          wanted ? [...current, id] : current.filter((each) => each !== id),
        );
        // Switched off, a rule drops its outcome on the server, so switched on again it starts
        // from its default rather than from what it was before (D56).
        if (!wanted) rememberOutcome((current) => withoutOutcome(current, id));
      },
    );

  return {
    matchRules: settled(matchRules.read),
    matchRuleResults: results.read.state === "ready" ? results.read.data.items : [],
    matchRuleResultsStatus: statusOf(results.read),
    compoundRules: settled(compoundRules.read),
    reloadMatchRules: matchRules.reload,
    reloadCompoundRules: compoundRules.reload,
    failure,
    isEnforced: (matchRuleId) => enforced.includes(matchRuleId),
    isApplied: (compoundRuleId) => applied.includes(compoundRuleId),
    enforce: (matchRuleId, wanted) =>
      toggle(
        matchRuleId,
        wanted,
        (value) => setMatchRuleEnforcement(criteriaSet.id, matchRuleId, value),
        setEnforced,
        setGateOutcomes,
      ),
    apply: (compoundRuleId, wanted) =>
      toggle(
        compoundRuleId,
        wanted,
        (value) =>
          setCompoundRuleApplication(criteriaSet.id, compoundRuleId, value),
        setApplied,
        setCompoundOutcomes,
      ),
    // A gate newly enforced is a gate, as the server makes it.
    outcomeOfGate: (matchRuleId) => gateOutcomes[matchRuleId] ?? "not_matching",
    outcomeOfCompoundRule: (rule) => compoundOutcomes[rule.id] ?? rule.outcome,
    holdGateAs: (matchRuleId, outcome) =>
      void save(
        () => setMatchRuleEnforcement(criteriaSet.id, matchRuleId, true, outcome),
        () => setGateOutcomes((current) => ({ ...current, [matchRuleId]: outcome })),
      ),
    holdCompoundRuleAs: (compoundRuleId, outcome) =>
      void save(
        () =>
          setCompoundRuleApplication(criteriaSet.id, compoundRuleId, true, outcome),
        () =>
          setCompoundOutcomes((current) => ({ ...current, [compoundRuleId]: outcome })),
      ),
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
