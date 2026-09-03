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
type CriteriaSet = components["schemas"]["CriteriaSet"];
type Criterion = components["schemas"]["Criterion"];
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

/**
 * One criteria set in full, as `GET /criteria-sets/{id}` returns it.
 *
 * Three pillars, each shaped to exercise something the Configure screen has to survive:
 *
 * - **economics** rebalances normally -- two unlocked siblings and one locked, so a change to
 *   one weight visibly moves another and the pillar still sums to 100.
 * - **housing** has two unlocked criteria, the simplest case there is.
 * - **safety** has exactly one unlocked criterion beside a locked one, which is the only way
 *   to reach the `weights_all_locked` refusal (`openapi.yaml`, `updateCriterion` 409).
 *
 * The weights are illustrative. Nothing here is a proposal about how a life should be scored.
 */
function defaultCriteria(): Criterion[] {
  return [
    criterion("country.cost_of_living_index", "economics", 50, "minimise"),
    criterion("country.income_tax_effective", "economics", 30, "minimise"),
    criterion("country.net_median_salary", "economics", 20, "maximise", { weight_locked: true }),
    criterion("country.housing_cost_overburden_rate", "housing", 60, "minimise"),
    criterion("country.overcrowding_rate", "housing", 40, "minimise"),
    criterion("country.homicide_rate", "safety", 65, "minimise"),
    criterion("country.perceived_safety_index", "safety", 35, "maximise", { weight_locked: true }),
  ];
}

function remoteOnlyCriteria(): Criterion[] {
  return [
    criterion("country.broadband_coverage", "connectivity", 70, "maximise"),
    criterion("country.income_tax_effective", "connectivity", 30, "minimise"),
  ];
}

function criterion(
  attribute: string,
  pillar: string,
  weight: number,
  goal: Criterion["goal"],
  overrides: Partial<Criterion> = {},
): Criterion {
  return {
    attribute,
    pillar,
    weight,
    weight_locked: false,
    is_scored: true,
    goal,
    normalisation_method: "percentile",
    blocks_if_missing: false,
    ...overrides,
  };
}

/**
 * Fresh objects on every call. The mock's PATCH handler rebalances in place, so handing out
 * the same objects twice would let one test see another test's edits.
 */
export function makeCriteriaSetDetails(): Record<string, CriteriaSet> {
  return {
    default: {
      id: "default",
      name: "Default",
      pillar_weights: [
        { pillar: "economics", weight: 40, weight_locked: false },
        { pillar: "housing", weight: 35, weight_locked: false },
        { pillar: "safety", weight: 25, weight_locked: false },
      ],
      criteria: defaultCriteria(),
      enforced_match_rules: ["country.visa_route_exists"],
      applied_compound_rules: [],
    },
    "remote-only": {
      id: "remote-only",
      name: "Remote only",
      pillar_weights: [{ pillar: "connectivity", weight: 100, weight_locked: false }],
      criteria: remoteOnlyCriteria(),
      enforced_match_rules: [],
      applied_compound_rules: [],
    },
  };
}

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
