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
type Comparison = components["schemas"]["Comparison"];
type RunPlan = components["schemas"]["RunPlan"];
type RunDetail = components["schemas"]["RunDetail"];
type StoredValue = components["schemas"]["Value"];
type ExternalScore = components["schemas"]["ExternalScore"];

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
    // **Every attribute named here exists in the catalog** (P3). A mock may invent figures --
    // that is what it is for -- but an attribute id it invents reads as documentation of what
    // the product has. `country.net_median_salary` never existed, and
    // `country.income_tax_effective` was retired in favour of the total tax rate (Q205).
    criterion("country.cost_of_living_index", "economics", 50, "minimise"),
    criterion("country.total_tax_rate_effective", "economics", 30, "minimise"),
    criterion("country.economic_outlook", "economics", 20, "maximise", {
      weight_locked: true,
    }),
    criterion(
      "country.housing_cost_overburden_rate",
      "housing",
      60,
      "minimise",
    ),
    // One criterion in the set the screen opens on carries a full rule, so a test can read an
    // anchored scale and a threshold back rather than only the empty case.
    criterion("country.overcrowding_rate", "housing", 40, "minimise", {
      normalisation_method: "fixed",
      scale_anchors: [
        { input_value: 2, score: 100, label: "roomy" },
        { input_value: 20, score: 0, label: "crowded" },
      ],
      matching_threshold: { min_value: null, max_value: 15 },
    }),
    criterion("country.homicide_rate", "safety", 65, "minimise"),
    criterion("country.perceived_safety_index", "safety", 35, "maximise", {
      weight_locked: true,
    }),
  ];
}

function remoteOnlyCriteria(): Criterion[] {
  return [
    criterion("country.broadband_coverage", "connectivity", 70, "maximise"),
    criterion("country.international_air_connectivity", "connectivity", 30, "maximise"),
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
      pillar_weights: [
        { pillar: "connectivity", weight: 100, weight_locked: false },
      ],
      criteria: remoteOnlyCriteria(),
      enforced_match_rules: [],
      applied_compound_rules: [],
    },
  };
}

export const COUNTRY_CANDIDATES: Candidate[] = [
  {
    id: "country.portugal",
    name: "Portugal",
    level: "country",
    parent_candidate: null,
    country_code: "PT",
  },
  {
    id: "country.spain",
    name: "Spain",
    level: "country",
    parent_candidate: null,
    country_code: "ES",
  },
  {
    id: "country.netherlands",
    name: "Netherlands",
    level: "country",
    parent_candidate: null,
    country_code: "NL",
  },
  {
    id: "country.estonia",
    name: "Estonia",
    level: "country",
    parent_candidate: null,
    country_code: "EE",
  },
];

export const CITY_CANDIDATES: Candidate[] = [
  {
    id: "city.lisbon",
    name: "Lisbon",
    level: "city",
    parent_candidate: "country.portugal",
  },
  {
    id: "city.porto",
    name: "Porto",
    level: "city",
    parent_candidate: "country.portugal",
  },
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

/**
 * **No level means every candidate, not the first level's.**
 *
 * `GET /candidates` takes `level` as a filter, so omitting it asks for all of them -- and the
 * server answers that way. This returned the country roster for an unfiltered request, which
 * made the mock quietly disagree with the contract: the sidebar decides which levels can be
 * chosen by looking for candidates at each, and against this mock the deeper level looked
 * empty when it was not. A mock that is kinder, or narrower, than the server certifies a
 * protocol the server does not speak (`CLAUDE.md`).
 */
export function candidatesForLevel(level: string | null): Candidate[] {
  if (level === "city") return CITY_CANDIDATES;
  if (level === null) return [...COUNTRY_CANDIDATES, ...CITY_CANDIDATES];
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
  // **Run 5 exists because a stored value names it.** A value referencing a run the history
  // does not hold is a fixture that could not have happened, and it made the acquisition
  // diff untestable: the run could not be picked.
  {
    id: 5,
    run_status: "completed",
    triggered_by: "user",
    started_at: "2025-09-11T08:00:00Z",
    finished_at: "2025-09-11T08:06:12Z",
    llm_call_count: 0,
    cost_eur: 0,
  },
];

export const SETTINGS: Settings = {
  min_coverage: 60,
  score_scale_max: 100,
  comparator_limit: 5,
  run_spend_cap_eur: 10,
  // Null, like the shipped database: every run refetches everything until somebody decides
  // a number, which is exactly what the planner did before the setting existed.
  refetch_older_than_days: null,
};

/**
 * One comparison: Portugal against the Netherlands, with a gap that matters and one that does
 * not. The synthesis is the server's, never assembled here -- the interface prints the
 * sentences it is given (`reqs.md` 8.5).
 */
export function comparisonFor(
  criteriaSet: string,
  level: string,
  focus: string,
  comparators: string[],
): Comparison {
  const named = (candidate: string): CandidateResult => {
    const found = COUNTRY_RESULTS.find(
      (result) => result.candidate === candidate,
    );
    // A candidate the mock has no result for still gets a row, named after itself: the screen
    // under test should render what it is given rather than depend on this fixture's roster.
    return (
      found ?? {
        candidate,
        name: candidate,
        rank: null,
        score: null,
        coverage: 0,
        match_status: "insufficient_data",
        parent_not_matching: false,
      }
    );
  };
  return {
    criteria_set: criteriaSet,
    level,
    focus: named(focus),
    comparators: comparators.map(named),
    attributes: [
      {
        attribute: "country.cost_of_living_index",
        pillar: "economics",
        // The raw figure beside the score, which is what the Compare toggle switches between
        // (`ComparisonAttributeRow` carries the whole `Value`, not only its score).
        focus: {
          normalised_score: 82,
          value: comparedValue(
            "country.cost_of_living_index",
            focus,
            { magnitude: 92.1, unit: "index_eu27_100" },
            "Quantity",
          ),
        },
        comparators: comparators.map((candidate) => ({
          candidate,
          normalised_score: 41,
          delta: -13.4,
          weighted_contribution: 4.9,
          value: comparedValue(
            "country.cost_of_living_index",
            candidate,
            { magnitude: 105.5, unit: "index_eu27_100" },
            "Quantity",
          ),
        })),
      },
      {
        attribute: "country.coastline_access",
        pillar: "nature",
        focus: {
          normalised_score: 70,
          value: comparedValue(
            "country.coastline_access",
            focus,
            { magnitude: 1793, unit: "km" },
            "Quantity",
          ),
        },
        comparators: comparators.map((candidate) => ({
          candidate,
          normalised_score: 64,
          delta: 1341,
          weighted_contribution: 0.2,
          // No `value` on this one: a comparator with no figure must read as absent rather
          // than as a zero, which is the whole reason the raw view exists.
        })),
      },
    ],
    synthesis: comparators.map((candidate) => ({
      comparator: candidate,
      score_delta: 7,
      advantages: [
        "Cost of living: 82 against 41, worth +4.9 points",
        "Coastline access: 70 against 64, worth +0.2 points",
      ],
      disadvantages: ["Broadband coverage: 61 against 88, worth -1.8 points"],
    })),
  };
}

/** A stored value as a comparison carries it: the figure in its own unit, with provenance. */
function comparedValue(
  attribute: string,
  candidate: string,
  payload: StoredValue["payload"],
  valueType: StoredValue["value_type"],
): StoredValue {
  return {
    id: 900,
    candidate,
    attribute,
    value_type: valueType,
    payload,
    data_source: "eurostat",
    reference_period: { start: "2025-01-01", end: "2025-12-31" },
    retrieval_date: "2026-09-11T08:00:00Z",
    confidence_level: "high",
    is_active: true,
    quote: null,
    citations: [],
    data_acquisition_run: 7,
  };
}

export const RUN_PLAN: RunPlan = {
  items_total: 96,
  llm_call_count: 0,
  estimated_cost_eur: 0,
  by_source: [
    { data_source: "eurostat", items: 64 },
    { data_source: "world_bank", items: 32 },
  ],
};

/**
 * A plan that would spend, so the screen's cost path is exercised by a test rather than only by
 * a configured environment. The basis is what the server says the figure rests on -- a euro
 * amount with no stated assumptions can be trusted but not checked.
 */
export const PAID_RUN_PLAN: RunPlan = {
  items_total: 32,
  llm_call_count: 32,
  estimated_cost_eur: 2.1,
  by_source: [{ data_source: "llm", items: 32 }],
  estimate_basis:
    "a ceiling: 12,000 input tokens per call (configured, measured by make live-llm)",
};

/** A run that finished with one thing left undone, so the retry path is always exercised. */
export const STARTED_RUN: Run = {
  id: 8,
  run_status: "completed",
  triggered_by: "user",
  started_at: "2026-09-12T09:00:00Z",
  finished_at: "2026-09-12T09:00:12Z",
  llm_call_count: 0,
  cost_eur: 0,
  // The size of the pass, which the server sends on every run and this fixture used to omit.
  // A mock narrower than the server certifies a screen that would be blank against the real
  // one -- the fault the `is_enabled` switches shipped with.
  scope_candidates: 32,
  scope_attributes: 41,
  items_total: 96,
  items_completed: 93,
  items_failed: 1,
};

export const STARTED_RUN_DETAIL: RunDetail = {
  ...STARTED_RUN,
  scope: { level: "country", candidates: null, attributes: null },
  // The three counts sum to the total, which is the arithmetic Q217 closed: one item broke,
  // two produced neither a figure nor a failure.
  progress: {
    items_total: 96,
    items_completed: 93,
    items_failed: 1,
    items_unanswered: 2,
  },
  failures: [
    {
      data_source: "oecd",
      candidate: "country.liechtenstein",
      attribute: "country.total_tax_rate_effective",
      error_message:
        "the oecd's cloudflare front answered with a browser challenge",
    },
  ],
  unanswered: [
    {
      candidate: "country.liechtenstein",
      attribute: "country.housing_cost_overburden_rate",
    },
    {
      candidate: "country.liechtenstein",
      attribute: "country.overcrowding_rate",
    },
  ],
  // **One source that answered everything and one that answered nothing**, which is the
  // shipped shape: OECD's front door is Cloudflare-challenged. A mock where every source
  // succeeded would never exercise the barren bar, and the barren bar is the one a reader
  // came to this panel to find.
  by_source: [
    { data_source: "eurostat", items_stored: 93, items_failed: 0 },
    { data_source: "oecd", items_stored: 0, items_failed: 1 },
  ],
};

/**
 * Two values for one attribute and one for another: the drill-down's whole point is that a
 * superseded figure is still there, with the source that produced it (`reqs.md` 3.6).
 */
/** The catalog's attributes, for the one-attribute-every-candidate drill-down (`reqs.md` 8.4). */
export const ATTRIBUTES = [
  {
    id: "country.cost_of_living_index",
    name: "Cost of living index",
    pillar: "economics",
    level: "country",
    value_type: "Quantity",
    unit: "index_eu27_100",
    description: "Eurostat PLI, EU27 = 100",
    manual_entry: false,
    max_age_months: 24,
    breakdown_scheme: null,
    breakdown_options: [],
    allowed_range: null,
    allowed_labels: [],
    effective_source_priority: ["eurostat"],
  },
  {
    id: "country.nobody_measures_this",
    name: "Nobody measures this",
    pillar: "family",
    level: "country",
    value_type: "Quantity",
    unit: "weeks",
    description: "An attribute with no figure anywhere -- the case this view exists for",
    manual_entry: true,
    max_age_months: 24,
    breakdown_scheme: null,
    breakdown_options: [],
    allowed_range: null,
    allowed_labels: [],
    effective_source_priority: [],
  },
  /**
   * The two shapes hand entry is actually for, mirroring the real catalog: five attributes
   * declare `manual_entry` and their types are `LabelSet`, `AssignedScore` and one `Quantity`
   * a source already answers. A mock carrying only the Quantity would exercise no editor.
   */
  {
    id: "country.international_employers",
    name: "International employers",
    pillar: "career",
    level: "country",
    value_type: "LabelSet",
    unit: null,
    description: "named firms",
    manual_entry: true,
    max_age_months: 24,
    breakdown_scheme: null,
    breakdown_options: [],
    allowed_range: null,
    // No fixed vocabulary: only `climate_zone` has one, because named firms cannot be enumerated
    // in advance and a picker would refuse the answer.
    allowed_labels: [],
    // As the server has it. A mock with no sources here would put this in the unsourced card
    // as well, and the two lists never overlap against the real catalog.
    effective_source_priority: ["llm", "company_website"],
  },
  {
    id: "country.residency_admin_ease",
    name: "Residency admin ease",
    pillar: "governance",
    level: "country",
    value_type: "AssignedScore",
    unit: null,
    description: "a judgement, on a scale the person assigning it states",
    manual_entry: true,
    max_age_months: 24,
    breakdown_scheme: null,
    breakdown_options: [],
    allowed_range: null,
    allowed_labels: [],
    effective_source_priority: ["national_law", "world_bank"],
  },
];

/**
 * What the pass made of each stored figure: the score it normalised to, the weight it used
 * after redistribution, and the points it added.
 *
 * **The attributes are the stored values' own**, so the drill-down's three new columns have a
 * reading for every row it draws -- except `country.summer_daytime_high`, deliberately left
 * out, because an attribute with a figure the active set does not score is exactly the case
 * those columns must say nothing about rather than nought.
 */
export const ATTRIBUTE_SCORES = [
  {
    attribute: "country.cost_of_living_index",
    pillar: "economics",
    normalised_score: 73,
    effective_weight: 12.5,
    contribution: 9.125,
  },
  {
    attribute: "country.average_rent",
    pillar: "housing",
    normalised_score: 61,
    effective_weight: 20,
    contribution: 12.2,
  },
  {
    attribute: "country.total_tax_rate_effective",
    pillar: "economics",
    normalised_score: 48,
    effective_weight: 27.5,
    contribution: 13.2,
  },
  // Covered by no figure, so it dropped out and its share went to the others. The score is
  // null and the weight it was actually given is nought -- which is not the same claim as a
  // score of nought, and the table must not print one for the other.
  {
    attribute: "country.broadband_coverage",
    pillar: "connectivity",
    normalised_score: null,
    effective_weight: 0,
    contribution: 0,
  },
];

export const STORED_VALUES: StoredValue[] = [
  /**
   * **A figure with no criterion attached**, which `reqs.md` 3.0 provides for and
   * `european_air_connectivity` is this project's own example of (Q228): counted, fetched and
   * displayed as context, never scored. It is here so the drill-down has a row whose score,
   * weight used and points added are all genuinely absent -- which is a different claim from
   * nought and must read differently.
   */
  {
    id: 500,
    candidate: "country.portugal",
    attribute: "country.european_air_connectivity",
    value_type: "Count",
    payload: { count: 31 },
    data_source: "eurostat",
    reference_period: { start: "2025-01-01", end: "2025-12-31" },
    retrieval_date: "2026-09-11T08:00:00Z",
    confidence_level: "high",
    is_active: true,
    quote: null,
    citations: [],
    data_acquisition_run: 7,
  },
  {
    id: 501,
    candidate: "country.portugal",
    attribute: "country.cost_of_living_index",
    value_type: "Quantity",
    payload: { magnitude: 94.5, unit: "index_eu27_100" },
    data_source: "eurostat",
    reference_period: { start: "2025-01-01", end: "2025-12-31" },
    retrieval_date: "2026-09-11T08:00:00Z",
    confidence_level: "high",
    is_active: true,
    quote: "Eurostat 2025: 94.5",
    citations: [],
    data_acquisition_run: 7,
  },
  {
    id: 502,
    candidate: "country.portugal",
    attribute: "country.cost_of_living_index",
    value_type: "Quantity",
    payload: { magnitude: 92.1, unit: "index_eu27_100" },
    data_source: "eurostat",
    reference_period: { start: "2024-01-01", end: "2024-12-31" },
    retrieval_date: "2025-09-11T08:00:00Z",
    confidence_level: "high",
    is_active: false,
    quote: "Eurostat 2024: 92.1",
    citations: [],
    data_acquisition_run: 5,
  },
  {
    id: 503,
    candidate: "country.portugal",
    attribute: "country.total_tax_rate_effective",
    value_type: "Ratio",
    payload: { value: 41.5, basis: "labour_cost" },
    data_source: "eurostat_estimate",
    reference_period: { start: "2025-01-01", end: "2025-12-31" },
    retrieval_date: "2026-09-11T08:00:00Z",
    confidence_level: "low",
    is_active: true,
    quote: "Estimated from Eurostat's tax-benefit figures",
    citations: [
      "https://ec.europa.eu/eurostat/tax-benefit",
      // Refused at render: a scheme the interface will not put behind a click.
      "javascript:alert(1)",
    ],
    data_acquisition_run: 7,
  },
];

export const EXTERNAL_SCORES: ExternalScore[] = [
  {
    candidate: "country.portugal",
    data_source: "numbeo",
    published_value: 72.4,
    published_scale: "0-100, higher is safer",
    reference_period: { start: "2026-01-01", end: "2026-06-30" },
    retrieval_date: "2026-09-01T08:00:00Z",
    caveats: "Crowdsourced, and its weighting is the publisher's own.",
    methodology_url: "https://www.numbeo.com/crime/indices_explained.jsp",
  },
];

type Household = components["schemas"]["HouseholdInput"];
type MatchRule = components["schemas"]["MatchRule"];
type MatchRuleResult = components["schemas"]["MatchRuleResult"];
type ResearchPlan = components["schemas"]["ResearchPlan"];
type CompoundRule = components["schemas"]["CompoundRule"];
type DataSource = components["schemas"]["DataSource"];

/**
 * One household, invented. Two adults, one child, a home country that is also a candidate --
 * which is the shape `reqs.md` 1.1 describes, where staying put is one of the options being
 * measured.
 */
export const HOUSEHOLD: Household = {
  net_income: 90000,
  number_adults: 2,
  number_children: 1,
  target_monthly_spend: 2800,
  max_rent: 1500,
  home_country_candidate: "country.romania",
  home_city_candidate: null,
  citizenships: ["country.romania"],
};

/**
 * Gates. One is asked at every level, which is what a null level means -- the Configure screen
 * has to render that without calling it "null".
 */
export const MATCH_RULES: MatchRule[] = [
  {
    id: "country.visa_route_exists",
    name: "A visa route exists",
    level: "country",
  },
  {
    id: "country.eu_free_movement",
    name: "Free movement applies",
    level: "country",
  },
  { id: "not_manually_excluded", name: "Not excluded by hand", level: null },
];

/**
 * Gate answers as stored: one a model proposed and one a person settled.
 *
 * Both kinds, because the panel shows the proposals and counts the rest -- and because a
 * fixture with only proposals would let "this is unconfirmed" pass while meaning nothing.
 */
export const MATCH_RULE_RESULTS: MatchRuleResult[] = [
  {
    match_rule: "country.visa_route_exists",
    candidate: "country.portugal",
    match_result: "not_matching",
    data_source: "llm",
    retrieval_date: "2026-09-12T09:00:00Z",
    reason: "The official page lists no route for these citizenships.",
    citations: ["https://example.gov/skilled-worker"],
    is_proposal: true,
  },
  {
    match_rule: "country.eu_free_movement",
    candidate: "country.spain",
    match_result: "matching",
    data_source: "manual",
    retrieval_date: "2026-09-10T09:00:00Z",
    reason: "Checked the treaty text.",
    is_proposal: false,
  },
];

/** What a research pass would ask and cost, which is asked instead of the pass. */
export const RESEARCH_PLAN: ResearchPlan = {
  gates_total: 64,
  llm_call_count: 64,
  estimated_cost_eur: 4.2,
  estimate_basis:
    "a ceiling: 12,000 input tokens per call (configured, measured by make live-llm)",
};

export const COMPOUND_RULES: CompoundRule[] = [
  {
    id: "country.rent_within_budget",
    name: "Rent fits the target spend",
    level: "country",
    shape: "ShareOfHouseholdField",
    outcome: "warning",
    threshold_max: 35,
    inputs: [
      {
        input_order: 1,
        attribute: "country.average_rent",
        household_field: null,
      },
      {
        input_order: 2,
        attribute: null,
        household_field: "target_monthly_spend",
      },
    ],
  },
  {
    id: "country.mild_and_connected",
    name: "Mild and connected",
    level: "country",
    shape: "AllConditionsHold",
    outcome: "not_matching",
    inputs: [],
    conditions: [
      {
        ordinal: 1,
        attribute: "country.summer_daytime_high",
        threshold_min: null,
        threshold_max: 30,
      },
      {
        ordinal: 2,
        attribute: "country.broadband_coverage",
        threshold_min: 90,
        threshold_max: null,
      },
    ],
  },
];

/**
 * Priority order as the migrations ship it: a lower number wins, and the LLM ranks last.
 *
 * **One is switched off**, so the screen's two states are both exercised by a test rather
 * than one of them only by a configured environment.
 */
export const DATA_SOURCES: DataSource[] = [
  {
    id: "eurostat",
    name: "Eurostat",
    source_kind: "structured",
    default_priority: 10,
    reliability_tier: "official",
    is_enabled: true,
  },
  {
    id: "manual",
    name: "Manual entry",
    source_kind: "manual",
    default_priority: 50,
    reliability_tier: "declared",
    is_enabled: true,
  },
  {
    id: "llm",
    name: "LLM with web search",
    source_kind: "llm",
    default_priority: 90,
    reliability_tier: "indicative",
    is_enabled: false,
  },
];
