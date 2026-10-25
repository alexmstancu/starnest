/**
 * What to call each gate, by id (PL-150).
 *
 * **The catalog's name, never the id.** A gate answer carries the gate's id -- `uk_skilled_worker`
 * -- and the Proposals panel printed it in its cells and in the name of its Confirm button, where
 * the catalog says "UK Skilled Worker route".
 *
 * **Every level, fetched without narrowing**, so a proposal is named whichever level its gate is
 * asked at. **A failure is silence, not a refusal**, as for the other names: what this feeds is
 * a label, and `matchRuleName` falls back to the id made readable.
 */

import { useCallback, useMemo } from "react";
import { fetchMatchRules, type MatchRule } from "./endpoints";
import { useRead } from "./useRead";

export type MatchRuleNames = ReadonlyMap<string, string>;
/** Each gate's clearing citizenships, each with where it clears it (0517, 0526). */
export type MatchRuleClearing = ReadonlyMap<string, MatchRule["cleared_by"]>;

/**
 * The names once, shared by every caller on the page. The gates are catalog rows that change
 * only with a migration, and a migration means a restart, so there is nothing to invalidate.
 */
let theNames: Promise<readonly MatchRule[]> | null = null;

function readThem(signal: AbortSignal): Promise<readonly MatchRule[]> {
  // The request is shared: one component unmounting must not cancel it for the others.
  void signal;
  theNames ??= fetchMatchRules(null)
    .then((answer) => answer.items)
    .catch((failure: unknown) => {
      // A failure is not remembered: the next caller tries again.
      theNames = null;
      throw failure;
    });
  return theNames;
}

/** Only for tests: forget what was fetched, so each one starts from nothing. */
export function forgetMatchRuleNames(): void {
  theNames = null;
}

const NONE: readonly MatchRule[] = [];

function useMatchRules(): readonly MatchRule[] {
  const { read } = useRead(
    useCallback((signal: AbortSignal) => readThem(signal), []),
  );
  return read.state === "ready" ? read.data : NONE;
}

export function useMatchRuleNames(): MatchRuleNames {
  const rules = useMatchRules();
  return useMemo(() => new Map(rules.map((rule) => [rule.id, rule.name])), [rules]);
}

/** Which citizenships clear each gate, and where -- for a verdict that names them (PL-164). */
export function useMatchRuleClearing(): MatchRuleClearing {
  const rules = useMatchRules();
  return useMemo(() => new Map(rules.map((rule) => [rule.id, rule.cleared_by])), [rules]);
}
