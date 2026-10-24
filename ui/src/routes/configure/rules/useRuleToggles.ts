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
}

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
  const [failure, setFailure] = useState<unknown>(null);

  /**
   * **The list changes only once the server has accepted the change.** A checkbox that ticked
   * itself optimistically and then failed would leave the screen claiming a gate is enforced
   * when it is not -- the one thing this panel must never do, because a gate decides whether a
   * candidate can be ranked at all.
   */
  const toggle = useCallback(
    async (
      id: string,
      wanted: boolean,
      write: (wanted: boolean) => Promise<void>,
      remember: (change: (current: string[]) => string[]) => void,
    ) => {
      setFailure(null);
      try {
        await write(wanted);
        remember((current) =>
          wanted ? [...current, id] : current.filter((each) => each !== id),
        );
      } catch (error) {
        setFailure(error);
      }
    },
    [],
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
      void toggle(
        matchRuleId,
        wanted,
        (value) => setMatchRuleEnforcement(criteriaSet.id, matchRuleId, value),
        setEnforced,
      ),
    apply: (compoundRuleId, wanted) =>
      void toggle(
        compoundRuleId,
        wanted,
        (value) =>
          setCompoundRuleApplication(criteriaSet.id, compoundRuleId, value),
        setApplied,
      ),
  };
}

/** These reads are always enabled, so never idle; this says so to the type. */
function settled<T>(read: Read<T> | Idle): Read<T> {
  return read.state === "idle" ? { state: "pending" } : read;
}

function statusOf(read: Read<unknown> | Idle): RuleToggles["matchRuleResultsStatus"] {
  if (read.state === "ready") return "ready";
  return read.state === "failed" ? "error" : "loading";
}
