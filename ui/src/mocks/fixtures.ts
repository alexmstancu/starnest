/**
 * The data the mock server answers with.
 *
 * Typed against the generated schema on purpose: a fixture that drifts from
 * `docs/openapi.yaml` stops compiling, so the mock cannot quietly become a different contract
 * from the one the backend will implement.
 *
 * The numbers are illustrative and deliberately unremarkable. They are not a prediction of
 * anything -- no fixture here should ever be mistaken for a real measurement.
 */

import type { components } from "../api/schema";

type Level = components["schemas"]["Level"];
type Candidate = components["schemas"]["Candidate"];
type CriteriaSetSummary = components["schemas"]["CriteriaSetSummary"];
type CandidateResult = components["schemas"]["CandidateResult"];
type Ranking = components["schemas"]["Ranking"];
type Run = components["schemas"]["Run"];
type Settings = components["schemas"]["Settings"];

export const LEVELS: Level[] = [
  { id: "country", depth_order: 1, parent_level: null },
  { id: "city", depth_order: 2, parent_level: "country" },
];

export const CRITERIA_SETS: CriteriaSetSummary[] = [
  { id: "default", name: "Default" },
  { id: "remote-only", name: "Remote only" },
];

export const COUNTRY_CANDIDATES: Candidate[] = [
  { id: "country.portugal", name: "Portugal", level: "country", parent_candidate: null },
  { id: "country.spain", name: "Spain", level: "country", parent_candidate: null },
  { id: "country.netherlands", name: "Netherlands", level: "country", parent_candidate: null },
  { id: "country.estonia", name: "Estonia", level: "country", parent_candidate: null },
];

export const CITY_CANDIDATES: Candidate[] = [
  { id: "city.lisbon", name: "Lisbon", level: "city", parent_candidate: "country.portugal" },
  { id: "city.porto", name: "Porto", level: "city", parent_candidate: "country.portugal" },
];

const COUNTRY_RESULTS: CandidateResult[] = [
  {
    candidate: "country.portugal",
    name: "Portugal",
    rank: 1,
    score: 78,
    coverage: 92.4,
    match_status: "matching",
    parent_not_matching: false,
  },
  {
    candidate: "country.netherlands",
    name: "Netherlands",
    rank: 2,
    score: 71,
    coverage: 88,
    match_status: "matching",
    parent_not_matching: false,
  },
  {
    candidate: "country.spain",
    name: "Spain",
    rank: null,
    score: 64,
    coverage: 81.5,
    match_status: "not_matching",
    parent_not_matching: false,
    non_match_reasons: [
      {
        match_rule: "country.visa_route_exists",
        reason_detail: "No visa route this household qualifies for.",
      },
    ],
  },
  {
    candidate: "country.estonia",
    name: "Estonia",
    rank: null,
    score: null,
    coverage: 41,
    match_status: "insufficient_data",
    parent_not_matching: false,
  },
];

const CITY_RESULTS: CandidateResult[] = [
  {
    candidate: "city.lisbon",
    name: "Lisbon",
    rank: 1,
    score: 74,
    coverage: 69,
    match_status: "matching",
    parent_not_matching: false,
    parent_score: 78,
  },
  {
    candidate: "city.porto",
    name: "Porto",
    rank: null,
    score: null,
    coverage: 33,
    match_status: "insufficient_data",
    parent_not_matching: false,
    parent_score: 78,
  },
];

export function candidatesForLevel(level: string | null): Candidate[] {
  if (level === "city") return CITY_CANDIDATES;
  return COUNTRY_CANDIDATES;
}

export function rankingFor(criteriaSet: string, level: string): Ranking {
  return {
    evaluation: null,
    criteria_set: criteriaSet,
    level,
    computed_at: "2026-08-30T09:15:00Z",
    candidates: level === "city" ? CITY_RESULTS : COUNTRY_RESULTS,
  };
}

export const RUNS: Run[] = [
  {
    id: 7,
    run_status: "completed",
    triggered_by: "user",
    started_at: "2026-08-29T18:02:00Z",
    finished_at: "2026-08-29T18:07:41Z",
    llm_call_count: 0,
    cost_eur: 0,
  },
  {
    id: 6,
    run_status: "halted_on_spend_cap",
    triggered_by: "user",
    started_at: "2026-08-28T10:11:00Z",
    finished_at: "2026-08-28T10:44:00Z",
    llm_call_count: 34,
    cost_eur: 2.5,
  },
];

export const SETTINGS: Settings = {
  min_coverage: 60,
  score_scale_max: 100,
  comparator_limit: 5,
  run_spend_cap_eur: 10,
};
