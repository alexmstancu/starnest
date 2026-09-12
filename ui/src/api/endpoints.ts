/**
 * The calls the shell makes, named after what they fetch.
 *
 * Every screen goes through here rather than calling `getJson` with a path literal, so the set
 * of endpoints the interface actually depends on is one file long -- which is what makes a
 * contract change visible instead of scattered.
 */

import {
  getJson,
  patchJson,
  postJson,
  type PatchResult,
  type RequestOptions,
} from "./client";
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
export type RebalancedPillar =
  PatchResult<"/criteria-sets/{criteriaSetId}/criteria/{attributeId}">;

export function fetchLevels(
  options?: RequestOptions,
): Promise<{ items: Level[] }> {
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

export type Comparison = components["schemas"]["Comparison"];
export type ComparisonAttributeRow =
  components["schemas"]["ComparisonAttributeRow"];
export type RunPlan = components["schemas"]["RunPlan"];
export type RunDetail = components["schemas"]["RunDetail"];
export type RunScope = components["schemas"]["RunScope"];

/**
 * A focus candidate against comparators (`reqs.md` 8.5).
 *
 * **The comparator limit is not enforced here.** It is a setting the server reads, and a copy
 * of it in the interface would be a second bound that could disagree with the first; the screen
 * shows the limit and the server refuses anything past it.
 */
export function fetchComparison(
  criteriaSet: string,
  level: string,
  focus: string,
  comparators: readonly string[],
  options?: RequestOptions,
): Promise<Comparison> {
  return getJson(
    "/comparisons",
    { criteria_set: criteriaSet, level, focus, comparators: [...comparators] },
    options,
  );
}

/** What a run would do, before it does any of it (`reqs.md` 6.3). */
export function planRun(
  scope: RunScope,
  options?: RequestOptions,
): Promise<RunPlan> {
  return postJson("/data-acquisition-runs/plan", scope, options);
}

export function startRun(
  scope: RunScope,
  options?: RequestOptions,
): Promise<Run> {
  return postJson("/data-acquisition-runs", scope, options);
}

export function fetchRun(
  runId: number,
  options?: RequestOptions,
): Promise<RunDetail> {
  return getJson("/data-acquisition-runs/{runId}", undefined, {
    ...options,
    pathParams: { runId },
  });
}

/** A new run over only what failed (`reqs.md` 6.4). The old run keeps its record. */
export function retryRun(
  runId: number,
  options?: RequestOptions,
): Promise<Run> {
  return postJson("/data-acquisition-runs/{runId}/retry", undefined as never, {
    ...options,
    pathParams: { runId },
  });
}

export type StoredValue = components["schemas"]["Value"];
export type ExternalScore = components["schemas"]["ExternalScore"];

/**
 * Every stored value for one candidate, superseded ones included (`reqs.md` 3.6).
 *
 * **Not only the active one.** The drill-down's job is to show that nothing was discarded: the
 * figure being scored, the ones it beat, and any that were rejected, each with its source and
 * both its dates.
 */
export function fetchValues(
  candidate: string,
  options?: RequestOptions,
): Promise<{ items: StoredValue[]; total: number }> {
  return getJson(
    "/values",
    { candidate, include_superseded: true, limit: 500 },
    options,
  );
}

/** Published composites, shown beside our score and never fed into it (`reqs.md` 3.5a). */
export function fetchExternalScores(
  candidate: string,
  options?: RequestOptions,
): Promise<{ items: ExternalScore[] }> {
  return getJson("/external-scores", { candidate }, options);
}
