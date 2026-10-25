import {
  setCompoundRuleApplication,
  setMatchRuleEnforcement,
  type CriteriaSet,
  type RuleOutcome,
} from "../../../api/endpoints";

/**
 * Whether one rule is on in a set, and what it does when it fires there (PL-138).
 *
 * `outcome` is null for a rule that is off, and for one on with the outcome its kind gives it:
 * a gate a gate, a compound rule the catalog's. The server stores only what was chosen (D56).
 */
export interface RuleState {
  kind: "gate" | "compound";
  id: string;
  on: boolean;
  outcome: RuleOutcome | null;
}

/** Sends a rule's state as it is: on with its outcome, if one was chosen, or off. */
export function sendRule(criteriaSetId: string, state: RuleState): Promise<void> {
  const outcome = state.on && state.outcome !== null ? state.outcome : undefined;
  return state.kind === "gate"
    ? setMatchRuleEnforcement(criteriaSetId, state.id, state.on, outcome)
    : setCompoundRuleApplication(criteriaSetId, state.id, state.on, outcome);
}

/** Whether a set as stored holds a rule in this state: what a lost answer is read back by. */
export function holdsRule(stored: CriteriaSet, state: RuleState): boolean {
  const on =
    state.kind === "gate" ? stored.enforced_match_rules : stored.applied_compound_rules;
  const outcomes =
    state.kind === "gate" ? stored.match_rule_outcomes : stored.compound_rule_outcomes;
  if ((on ?? []).includes(state.id) !== state.on) return false;
  return state.outcome === null || outcomes?.[state.id] === state.outcome;
}

/** What a change to a rule is called in Recent changes, from what it was and what it is. */
export function ruleChangeLabel(name: string, before: RuleState, after: RuleState): string {
  if (before.on !== after.on) {
    const [on, off] =
      after.kind === "gate" ? ["Enforced", "Stopped enforcing"] : ["Applied", "Stopped applying"];
    // Switched on with a kind chosen -- a gesture that went on to choose it -- says which.
    const kind =
      after.on && after.outcome !== null ? ` as ${after.outcome === "warning" ? "a warning" : "a gate"}` : "";
    return `${after.on ? on : off} ${name}${kind}`;
  }
  return `Made ${name} ${after.outcome === "warning" ? "a warning" : "a gate"}`;
}
