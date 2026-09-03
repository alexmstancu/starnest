/**
 * The calls the shell makes, named after what they fetch.
 *
 * Every screen goes through here rather than calling `getJson` with a path literal, so the set
 * of endpoints the interface actually depends on is one file long -- which is what makes a
 * contract change visible instead of scattered.
 */

import { getJson, patchJson, type PatchResult, type RequestOptions } from "./client";
import type { components } from "./schema";

export type Level = components["schemas"]["Level"];
export type Candidate = components["schemas"]["Candidate"];
export type CriteriaSetSummary = components["schemas"]["CriteriaSetSummary"];
export type Run = components["schemas"]["Run"];
export type Ranking = components["schemas"]["Ranking"];
export type CandidateResult = components["schemas"]["CandidateResult"];
export type Settings = components["schemas"]["Settings"];
export type CriteriaSet = components["schemas"]["CriteriaSet"];
export type Criterion = components["schemas"]["Criterion"];

/**
 * What a weight change answers with: the affected pillar and every criterion in it, already
 * rebalanced (`arch.md` 8.3). The client sends one number and is told what the others became.
 */
export type RebalancedPillar = PatchResult<"/criteria-sets/{criteriaSetId}/criteria/{attributeId}">;

export function fetchLevels(options?: RequestOptions): Promise<{ items: Level[] }> {
  return getJson("/levels", undefined, options);
}

export function fetchCriteriaSets(
  options?: RequestOptions,
): Promise<{ items: CriteriaSetSummary[] }> {
  return getJson("/criteria-sets", undefined, options);
}

export function fetchCandidates(
  level: string,
  options?: RequestOptions,
): Promise<{ items: Candidate[] }> {
  return getJson("/candidates", { level }, options);
}

export function fetchRanking(
  criteriaSet: string,
  level: string,
  options?: RequestOptions,
): Promise<Ranking> {
  return getJson("/rankings", { criteria_set: criteriaSet, level }, options);
}

export function fetchRuns(
  limit: number,
  options?: RequestOptions,
): Promise<{ items: Run[]; total: number }> {
  return getJson("/data-acquisition-runs", { limit }, options);
}

export function fetchCriteriaSet(
  criteriaSetId: string,
  options?: RequestOptions,
): Promise<CriteriaSet> {
  return getJson("/criteria-sets/{criteriaSetId}", undefined, {
    ...options,
    pathParams: { criteriaSetId },
  });
}

/**
 * Changes one criterion's weight.
 *
 * **The rebalance is not computed here and must not be.** Which siblings absorb the change
 * depends on which weights are locked, and a pillar that does not sum to 100 is a broken
 * score -- so the server owns the arithmetic and this returns whatever it decided.
 */
export function updateCriterionWeight(
  criteriaSetId: string,
  attributeId: string,
  weight: number,
  options?: RequestOptions,
): Promise<RebalancedPillar> {
  return patchJson(
    "/criteria-sets/{criteriaSetId}/criteria/{attributeId}",
    { weight },
    { ...options, pathParams: { criteriaSetId, attributeId } },
  );
}

export function fetchSettings(options?: RequestOptions): Promise<Settings> {
  return getJson("/settings", undefined, options);
}
