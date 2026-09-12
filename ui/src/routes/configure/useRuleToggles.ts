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
  fetchMatchRules,
  setCompoundRuleApplication,
  setMatchRuleEnforcement,
  type CompoundRule,
  type CriteriaSet,
  type MatchRule,
} from "../../api/endpoints";
import { useResource, type Resource } from "../../api/useResource";

export interface RuleToggles {
  matchRules: Resource<{ items: MatchRule[] }>;
  compoundRules: Resource<{ items: CompoundRule[] }>;
  reloadMatchRules: () => void;
  reloadCompoundRules: () => void;
  failure: unknown;
  isEnforced: (matchRuleId: string) => boolean;
  isApplied: (compoundRuleId: string) => boolean;
  enforce: (matchRuleId: string, wanted: boolean) => void;
  apply: (compoundRuleId: string, wanted: boolean) => void;
}

export function useRuleToggles(
  criteriaSet: CriteriaSet,
  levelId: string,
): RuleToggles {
  const matchRules = useResource(
    useCallback(
      (signal: AbortSignal) => fetchMatchRules(levelId, { signal }),
      [levelId],
    ),
  );
  const compoundRules = useResource(
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
    matchRules: matchRules.resource,
    compoundRules: compoundRules.resource,
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
