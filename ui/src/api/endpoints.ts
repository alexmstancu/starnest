/**
 * The calls the shell makes, named after what they fetch.
 *
 * Every screen goes through here rather than calling `getJson` with a path literal, so the set
 * of endpoints the interface actually depends on is one file long -- which is what makes a
 * contract change visible instead of scattered.
 */

import { getJson, type RequestOptions } from "./client";
import type { components } from "./schema";

export type Level = components["schemas"]["Level"];
export type Candidate = components["schemas"]["Candidate"];
export type CriteriaSetSummary = components["schemas"]["CriteriaSetSummary"];
export type Run = components["schemas"]["Run"];
export type Ranking = components["schemas"]["Ranking"];
export type CandidateResult = components["schemas"]["CandidateResult"];
export type Settings = components["schemas"]["Settings"];

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

export function fetchSettings(options?: RequestOptions): Promise<Settings> {
  return getJson("/settings", undefined, options);
}
