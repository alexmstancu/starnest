import { describe, expect, it } from "vitest";
import { ApiError } from "../api/ApiError";
import { getJson, patchJson, postJson } from "../api/client";
import {
  enterValueManually,
  createCriteriaSet,
  deleteCriteriaSet,
  duplicateCriteriaSet,
  fetchCriteriaSet,
  fetchMatchRuleResults,
  fetchDataSources,
  fetchHoldings,
  fetchCriteriaSets,
  fetchRanking,
  fetchRun,
  planRetry,
  planMatchRuleResearch,
  planRun,
  putMatchRuleResult,
  renameCriteriaSet,
  replaceHousehold,
  replaceSettings,
  reorderDataSources,
  researchMatchRules,
  retryRun,
  setCompoundRuleApplication,
  setMatchRuleEnforcement,
  restoreCriteriaSet,
  startRun,
  updateCriterionRule,
  updateDataSource,
  type CriterionRule,
  type ManualValueInput,
  type MatchRuleResultInput,
} from "../api/endpoints";
import {
  HOUSEHOLD,
  RESEARCH_CALL_COST_EUR,
  RUNS,
  RUN_ITEMS,
  RUN_REUSES,
  SETTINGS,
  STORED_VALUES,
} from "./fixtures";

/**
 * The mock is a stand-in for the backend, so it has to fail the way the backend will: with the
 * one documented error shape, never with an HTML page or a bare status.
 */
describe("the mock server", () => {
  it("rejects a ranking request that is missing its required parameters", async () => {
    const error = (await getJson("/rankings").catch(
      (thrown: unknown) => thrown,
    )) as ApiError;

    // As the server does: a required query parameter left out is a malformed request, and each
    // one missing is located in the query, in FastAPI's words (`errors.py`).
    expect(error.code).toBe("invalid_request");
    expect(error.status).toBe(422);
    expect(error.details).toEqual({
      errors: [
        { location: ["query", "criteria_set"], problem: "Field required", kind: "missing" },
        { location: ["query", "level"], problem: "Field required", kind: "missing" },
      ],
    });
  });

  it("serves a ranking per level, so the level toggle changes what is shown", async () => {
    const countries = await fetchRanking("default", "country");
    const cities = await fetchRanking("default", "city");

    expect(countries.candidates).toHaveLength(4);
    expect(cities.candidates).toHaveLength(2);
    expect(cities.candidates[0]?.parent_score).toBe(78);
  });

  it("echoes the criteria set it was asked about", async () => {
    const ranking = await fetchRanking("remote_only", "country");

    expect(ranking.criteria_set).toBe("remote_only");
  });
});

/**
 * **The comparison refuses what the server refuses** (PL-091). A mock that drew a comparison
 * for a request the server rejects certifies a screen that builds it. The order and the codes
 * are `comparisons.py`'s and `comparison.py`'s; the limit's own code and its `details` are
 * PL-007's.
 */
describe("the mock comparison", () => {
  const PORTUGAL = "country.portugal";

  async function refusalOf(query: Record<string, string | string[]>): Promise<ApiError> {
    // Untyped on purpose: some of these requests are the malformed ones the type forbids.
    return (await getJson("/comparisons", query as never).catch((thrown: unknown) => thrown)) as ApiError;
  }

  it.each([
    ["criteria_set", { level: "country", focus: PORTUGAL, comparators: ["country.spain"] }],
    ["level", { criteria_set: "default", focus: PORTUGAL, comparators: ["country.spain"] }],
    ["focus", { criteria_set: "default", level: "country", comparators: ["country.spain"] }],
  ])("is a malformed request without its %s, located as the server locates it", async (missing, query) => {
    const error = await refusalOf(query);

    expect([error.status, error.code]).toEqual([422, "invalid_request"]);
    expect(error.details).toEqual({
      errors: [{ location: ["query", missing], problem: "Field required", kind: "missing" }],
    });
  });

  it("refuses a comparator named twice, naming it", async () => {
    const error = await refusalOf({
      criteria_set: "default",
      level: "country",
      focus: PORTUGAL,
      comparators: ["country.spain", "country.netherlands", "country.spain"],
    });

    expect([error.status, error.code]).toEqual([409, "invalid_comparison"]);
    expect(error.details).toEqual({ candidates: ["country.spain"] });
  });

  it("refuses a comparator from another level, naming it", async () => {
    const error = await refusalOf({
      criteria_set: "default",
      level: "country",
      focus: PORTUGAL,
      comparators: ["city.lisbon"],
    });

    expect([error.status, error.code]).toEqual([409, "invalid_comparison"]);
    expect(error.details).toEqual({ candidates: ["city.lisbon"] });
  });

  it("refuses a focus from another level, naming it", async () => {
    const error = await refusalOf({
      criteria_set: "default",
      level: "city",
      focus: PORTUGAL,
      comparators: ["city.lisbon"],
    });

    expect([error.status, error.code]).toEqual([409, "invalid_comparison"]);
    expect(error.details).toEqual({ candidates: [PORTUGAL] });
  });

  it("refuses more comparators than the limit with its own code, the limit and the count", async () => {
    const error = await refusalOf({
      criteria_set: "default",
      level: "country",
      focus: PORTUGAL,
      comparators: ["a", "b", "c", "d", "e", "f"].map((name) => `country.${name}`),
    });

    expect([error.status, error.code]).toEqual([409, "comparator_limit_exceeded"]);
    expect(error.details).toEqual({ limit: 5, asked: 6 });
  });
});

/**
 * T28-5 (PL-028, C02-S2). **The household and the settings are refused as the server refuses
 * them**: 422 `invalid_request`, every offending field at once as a `FieldProblem` with its
 * `kind` and, for a bound, its `limit` -- never `400 invalid_field`, which the server never
 * sends.
 */
describe("the mock's refusal of a field", () => {
  async function refusal(write: Promise<unknown>): Promise<ApiError> {
    return (await write.catch((thrown: unknown) => thrown)) as ApiError;
  }

  it("refuses settings outside the contract's ranges, naming each with its kind and limit", async () => {
    const error = await refusal(
      replaceSettings({ ...SETTINGS, comparator_limit: 21, min_coverage: -1, score_scale_max: 2.5 }),
    );

    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid_request");
    expect(error.details).toEqual({
      errors: [
        {
          location: ["body", "min_coverage"],
          problem: "Input should be greater than or equal to 0",
          kind: "greater_than_equal",
          limit: 0,
        },
        {
          location: ["body", "score_scale_max"],
          problem: "Input should be a valid integer, got a number with a fractional part",
          kind: "int_from_float",
        },
        {
          location: ["body", "comparator_limit"],
          problem: "Input should be less than or equal to 20",
          kind: "less_than_equal",
          limit: 20,
        },
      ],
    });
  });

  it.each([
    ["min_coverage", 100],
    ["comparator_limit", 20],
    ["comparator_limit", 1],
    ["run_spend_cap_eur", 0],
    ["refetch_older_than_days", 1],
  ])("accepts %s at its edge, %s", async (name, value) => {
    await expect(replaceSettings({ ...SETTINGS, [name]: value })).resolves.toMatchObject({
      [name]: value,
    });
  });

  it("refuses a household with a negative income, no adult and no passport", async () => {
    const error = await refusal(
      replaceHousehold({ ...HOUSEHOLD, net_income: -1, number_adults: 0, citizenships: [] }),
    );

    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid_request");
    expect(error.details).toEqual({
      errors: [
        {
          location: ["body", "net_income"],
          problem: "Input should be greater than or equal to 0",
          kind: "greater_than_equal",
          limit: 0,
        },
        {
          location: ["body", "number_adults"],
          problem: "Input should be greater than or equal to 1",
          kind: "greater_than_equal",
          limit: 1,
        },
        {
          location: ["body", "citizenships"],
          problem: "Tuple should have at least 1 item after validation, not 0",
          kind: "too_short",
        },
      ],
    });
  });

  it("refuses a household with a required figure left out", async () => {
    const { net_income: _left, ...without } = HOUSEHOLD;
    const error = await refusal(replaceHousehold(without as typeof HOUSEHOLD));

    expect(error.details).toEqual({
      errors: [{ location: ["body", "net_income"], problem: "Field required", kind: "missing" }],
    });
  });
});

/**
 * PL-026. **A rule the domain refuses is refused as the server refuses it**: 422
 * `invalid_criterion`, the domain's sentence as the message, and each field it concerns in
 * `details.errors` with that sentence and the kind `invalid_criterion`. The mock once stored any
 * rule at all, which certified a form whose refusal path no test could reach.
 */
describe("the mock's refusal of a rule", () => {
  const ANCHORED = "country.overcrowding_rate";

  async function refusalOf(rule: CriterionRule): Promise<ApiError> {
    return (await updateCriterionRule("default", ANCHORED, rule).catch(
      (thrown: unknown) => thrown,
    )) as ApiError;
  }

  function naming(message: string, ...fields: string[]) {
    return fields.map((field) => ({
      location: ["body", field],
      problem: message,
      kind: "invalid_criterion",
    }));
  }

  it.each<[string, CriterionRule, string, string[]]>([
    [
      "a band goal with no band",
      { goal: "target_range", target_range_min: 10 },
      `${ANCHORED} aims at a target range but names no band; a target range needs both a ` +
        "minimum and a maximum, in the attribute's own unit",
      ["target_range_max"],
    ],
    [
      "a band percentile cannot draw",
      { goal: "target_range", normalisation_method: "percentile", target_range_min: 10, target_range_max: 30 },
      `${ANCHORED} aims at a target range and normalises \`percentile\`, which cannot express a ` +
        "band: `percentile` scores by standing among the candidates and `as_is` reads the " +
        "figure as a score. A target range is a `fixed` scale -- the band, and where the score " +
        "reaches zero on each side",
      ["goal", "normalisation_method"],
    ],
    [
      "a backwards band",
      { target_range_min: 30, target_range_max: 10 },
      `the target range of ${ANCHORED} runs 30 to 10, which is backwards`,
      ["target_range_min", "target_range_max"],
    ],
    [
      "a lower zero point inside the band",
      { target_range_min: 10, target_range_max: 30, zero_score_below: 12 },
      `${ANCHORED} scores 0 below 12, which is inside its target band starting at 10`,
      ["target_range_min", "zero_score_below"],
    ],
    [
      "an upper zero point inside the band",
      { target_range_min: 10, target_range_max: 30, zero_score_above: 25 },
      `${ANCHORED} scores 0 above 25, which is inside its target band ending at 30`,
      ["target_range_max", "zero_score_above"],
    ],
    [
      "one anchor",
      { scale_anchors: [{ input_value: 5, score: 50, label: null }] },
      `${ANCHORED} has one scale anchor, which maps that single value and nothing else; a ` +
        "fixed scale needs at least two points, or none at all",
      ["scale_anchors"],
    ],
    [
      "one figure anchored twice",
      {
        scale_anchors: [
          { input_value: 5, score: 100, label: null },
          { input_value: 5, score: 0, label: null },
        ],
      },
      `${ANCHORED} anchors the same input value twice, so it maps to two different scores`,
      ["scale_anchors"],
    ],
    [
      "anchors that rise where lower is better",
      {
        goal: "minimise",
        scale_anchors: [
          { input_value: 2, score: 0, label: null },
          { input_value: 20, score: 100, label: null },
        ],
      },
      `${ANCHORED} is to minimise, but its anchors' scores rise as the value rises -- it ` +
        "would reward exactly what it means to penalise",
      ["goal", "scale_anchors"],
    ],
    [
      "a backwards threshold",
      { matching_threshold: { min_value: 50, max_value: 10 } },
      "minimum 50 is above maximum 10",
      ["matching_threshold"],
    ],
  ])("refuses %s, naming its fields", async (_, rule, message, fields) => {
    const error = await refusalOf(rule);

    expect([error.status, error.code, error.message]).toEqual([422, "invalid_criterion", message]);
    expect(error.details).toEqual({ errors: naming(message, ...fields) });
  });

  it("refuses an anchor above the top of the score range, with the bound", async () => {
    const error = await refusalOf({
      scale_anchors: [
        { input_value: 2, score: 150, label: null },
        { input_value: 20, score: 0, label: null },
      ],
    });

    expect(error.message).toBe(
      `${ANCHORED} anchors 2.0 to a score of 150, and the score scale stops at 100`,
    );
    expect(error.details).toEqual({
      reason: "anchor_above_scale",
      attribute: ANCHORED,
      anchor_score: 150,
      score_scale_max: 100,
      errors: [{ ...naming(error.message, "scale_anchors")[0], limit: 100 }],
    });
  });

  it("refuses a method the attribute's type does not permit", async () => {
    const error = await updateCriterionRule("default", "country.cost_of_living_index", {
      normalisation_method: "as_is",
    }).catch((thrown: unknown) => thrown as ApiError);

    expect((error as ApiError).details).toEqual({
      errors: naming(
        "country.cost_of_living_index is a Quantity and normalises `as_is`, which `reqs.md` " +
          "3.3a does not permit for that type; the legal methods for a Quantity are: fixed, " +
          "percentile",
        "normalisation_method",
      ),
    });
  });

  it("stores nothing it refused", async () => {
    await refusalOf({ target_range_min: 30, target_range_max: 10 });

    const stored = (await fetchCriteriaSet("default")).criteria?.find(
      (criterion) => criterion.attribute === ANCHORED,
    );
    expect(stored?.target_range_min ?? null).toBeNull();
  });

  it("stores a rule it accepts", async () => {
    await updateCriterionRule("default", ANCHORED, {
      goal: "target_range",
      target_range_min: 10,
      target_range_max: 30,
      scale_anchors: [],
    });

    const stored = (await fetchCriteriaSet("default")).criteria?.find(
      (criterion) => criterion.attribute === ANCHORED,
    );
    expect(stored).toMatchObject({ goal: "target_range", target_range_min: 10 });
  });
});

/**
 * PL-051, PL-052. **`/holdings` closes as the server's one statement does**, sums the month from
 * the `since` it is given over runs and the research ledger, and refuses what `api/holdings.py`
 * refuses: a parameter left out, a time with no zone, a level that does not exist.
 */
/** D56, as `criteria_set.py` holds it: only a rule that is on holds an outcome. */
describe("the mock's outcome of a rule", () => {
  it.each([
    ["a gate", () => setMatchRuleEnforcement("default", "country.visa_route_exists", false, "warning")],
    ["a compound rule", () =>
      setCompoundRuleApplication("default", "country.rent_within_budget", false, "warning")],
  ])("refuses an outcome sent for %s being switched off", async (_kind, write) => {
    const error = (await write().catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid_criteria_set");
  });

  it("drops a gate's outcome with the gate, so enforced again it is a gate", async () => {
    await setMatchRuleEnforcement("default", "country.visa_route_exists", true, "warning");
    await setMatchRuleEnforcement("default", "country.visa_route_exists", false);
    await setMatchRuleEnforcement("default", "country.visa_route_exists", true);

    expect((await fetchCriteriaSet("default")).match_rule_outcomes).toEqual({
      "country.visa_route_exists": "not_matching",
    });
  });

  it("gives a compound rule newly applied the catalog's outcome", async () => {
    await setCompoundRuleApplication("default", "country.mild_and_connected", true);

    expect((await fetchCriteriaSet("default")).compound_rule_outcomes).toEqual({
      "country.mild_and_connected": "not_matching",
    });
  });
});

/** As `evaluation/ranking.py` judges: only the set's rules act, and on the side its outcome says. */
describe("the mock ranking's rules", () => {
  async function resultFor(criteriaSet: string, candidate: string) {
    const ranking = await fetchRanking(criteriaSet, "country");
    return ranking.candidates.find((each) => each.candidate === candidate)!;
  }

  it("leaves no warning or reason for a rule the set switches off", async () => {
    await setMatchRuleEnforcement("default", "country.visa_route_exists", false);

    const spain = await resultFor("default", "country.spain");
    const netherlands = await resultFor("default", "country.netherlands");
    expect(spain.non_match_reasons).toBeUndefined();
    expect(spain.warnings).toBeUndefined();
    expect(spain.match_status).toBe("matching");
    expect(spain.rank).toBe(3);
    // The rent rule fires for the Netherlands, and no set applies it.
    expect(netherlands.warnings).toBeUndefined();
  });

  it("flags rather than removes for a gate the set holds as a warning", async () => {
    await setMatchRuleEnforcement("default", "country.visa_route_exists", true, "warning");

    const spain = await resultFor("default", "country.spain");
    expect(spain.non_match_reasons).toBeUndefined();
    expect(spain.warnings?.map((each) => each.match_rule)).toEqual(["country.visa_route_exists"]);
    expect(spain.match_status).toBe("matching");
  });

  it("removes for a compound rule the set holds as a gate, and ranks the rest again", async () => {
    await setCompoundRuleApplication("default", "country.rent_within_budget", true, "not_matching");

    const ranking = await fetchRanking("default", "country");
    const netherlands = ranking.candidates.find((each) => each.candidate === "country.netherlands")!;
    expect(netherlands.warnings).toBeUndefined();
    expect(netherlands.non_match_reasons?.map((each) => each.compound_rule)).toEqual([
      "country.rent_within_budget",
    ]);
    expect(netherlands.match_status).toBe("not_matching");
    expect(netherlands.rank).toBeNull();
    // The ranked first, then the unranked by score, those with none last.
    expect(ranking.candidates.map((each) => [each.name, each.rank])).toEqual([
      ["Portugal", 1],
      ["Netherlands", null],
      ["Spain", null],
      ["Estonia", null],
    ]);
  });

  it("flags with a compound rule's catalog outcome when the set names none", async () => {
    await setCompoundRuleApplication("default", "country.rent_within_budget", true);

    const netherlands = await resultFor("default", "country.netherlands");
    expect(netherlands.warnings?.map((each) => each.compound_rule)).toEqual([
      "country.rent_within_budget",
    ]);
    expect(netherlands.match_status).toBe("matching");
  });
});

/** Q239, as `evaluation/rules.py` judges: a held citizenship clears a gate, answer or none. */
describe("the mock ranking's citizenships", () => {
  const spain = async () =>
    (await fetchRanking("default", "country")).candidates.find(
      (each) => each.candidate === "country.spain",
    )!;

  it("drops a recorded refusal a held citizenship clears", async () => {
    await setMatchRuleEnforcement("default", "country.uk_skilled_worker", true);
    await putMatchRuleResult("country.uk_skilled_worker", "country.spain", {
      match_result: "not_matching",
      data_source: "manual",
    });
    expect((await spain()).non_match_reasons?.map((each) => each.match_rule)).toContain(
      "country.uk_skilled_worker",
    );

    await replaceHousehold({ ...HOUSEHOLD, citizenships: ["country.romania", "country.ireland"] });

    expect((await spain()).non_match_reasons?.map((each) => each.match_rule)).not.toContain(
      "country.uk_skilled_worker",
    );
  });

  it("rules out by free movement where no held citizenship clears it, naming them", async () => {
    await setMatchRuleEnforcement("default", "country.eu_free_movement", true);
    expect((await spain()).non_match_reasons?.map((each) => each.match_rule)).not.toContain(
      "country.eu_free_movement",
    );

    await replaceHousehold({ ...HOUSEHOLD, citizenships: ["country.united_kingdom"] });

    const reason = (await spain()).non_match_reasons?.find(
      (each) => each.match_rule === "country.eu_free_movement",
    );
    expect(reason?.citizenships).toEqual(["country.united_kingdom"]);
  });
});

describe("the mock's holdings", () => {
  const SINCE = "2026-08-01T00:00:00+02:00";

  it("adds values stored and every gap up to the pairs total", async () => {
    const held = await fetchHoldings("country", SINCE);
    const { failed, unanswered, not_reached: notReached } = held.gaps;

    expect(held.values_stored + failed.length + unanswered.length + notReached.length).toBe(
      held.pairs_total,
    );
  });

  it("sums the runs started at or after since, and every research call ledgered since", async () => {
    const before = await fetchHoldings("country", SINCE);
    const research = await researchMatchRules({ level: "country" });
    const after = await fetchHoldings("country", SINCE);

    // Runs 7 and 6 started in August; run 6 cost 2.50 and run 7 nothing.
    expect(before.spent).toMatchObject({ runs_eur: 2.5, research_eur: 0, total_eur: 2.5 });
    expect(research.calls).toBeGreaterThan(0);
    expect(after.spent.research_eur).toBeCloseTo(research.calls * RESEARCH_CALL_COST_EUR, 6);
    expect(after.spent.total_eur).toBeCloseTo(2.5 + after.spent.research_eur, 6);
  });

  it("leaves out what was spent before since", async () => {
    const held = await fetchHoldings("country", "2026-09-01T00:00:00+02:00");

    expect(held.spent.runs_eur).toBe(0);
  });

  it("refuses a since with no zone, locating it in the query", async () => {
    const error = (await fetchHoldings("country", "2026-08-01T00:00:00").catch(
      (thrown: unknown) => thrown,
    )) as ApiError;

    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid_request");
    expect(error.details).toMatchObject({ errors: [{ location: ["query", "since"] }] });
  });

  it("refuses a request with neither parameter, naming both", async () => {
    const error = (await getJson("/holdings").catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.code).toBe("invalid_request");
    expect(error.details).toMatchObject({
      errors: [{ location: ["query", "level"] }, { location: ["query", "since"] }],
    });
  });

  it("refuses a level that does not exist, naming it", async () => {
    const error = (await fetchHoldings("planet", SINCE).catch(
      (thrown: unknown) => thrown,
    )) as ApiError;

    expect(error.code).toBe("unknown_scope");
    expect(error.details).toEqual({ level: "planet", unknown_levels: ["planet"] });
  });
});

/**
 * **What the server answers for a score while the range is unset, in its precedence**
 * (`rankings.py::the_ranking`): the criteria set named is read first, so one that does not
 * exist is a 404 whatever the settings say; only an existing set is refused for the range.
 */
describe("the mock's scored reads while the score range is unset", () => {
  const COMPARISON = { level: "country", focus: "country.portugal", comparators: ["country.spain"] };
  const ASKED: Record<string, (set: string) => Promise<unknown>> = {
    "GET /rankings": (set) => getJson("/rankings", { criteria_set: set, level: "country" }),
    "GET /rankings/candidates/{id}": (set) =>
      getJson("/rankings/candidates/{candidateId}", { criteria_set: set, level: "country" }, {
        pathParams: { candidateId: "country.portugal" },
      }),
    "GET /comparisons": (set) => getJson("/comparisons", { criteria_set: set, ...COMPARISON }),
    "POST /evaluations": (set) => postJson("/evaluations", { criteria_set: set, level: "country" }),
  };

  async function refusalOf(ask: () => Promise<unknown>): Promise<[number | null, string]> {
    await replaceSettings({ ...SETTINGS, score_scale_max: null });
    const error = (await ask().catch((thrown: unknown) => thrown)) as ApiError;
    return [error.status, error.code];
  }

  it.each(Object.entries(ASKED))("%s refuses an existing set with 409 score_scale_not_set", async (_name, ask) => {
    expect(await refusalOf(() => ask("default"))).toEqual([409, "score_scale_not_set"]);
  });

  it.each(Object.entries(ASKED))("%s names a set that does not exist with 404 first", async (_name, ask) => {
    expect(await refusalOf(() => ask("no-such-set"))).toEqual([404, "not_found"]);
  });
});

/**
 * PL-049. **What a run re-confirmed, served as the server serves it**: in its detail, limited to
 * its own items, and as the values `reconfirmed_by_run` lists -- which the server refuses beside
 * `data_acquisition_run`, since a run re-confirms only what it did not store.
 */
describe("the mock's re-confirmed figures", () => {
  const PORTUGAL_AIR = {
    data_source: "eurostat",
    candidate: "country.portugal",
    attribute: "country.european_air_connectivity",
  };

  it("names what a run re-confirmed, with the stored figure it restated", async () => {
    expect((await fetchRun(6)).reconfirmed).toEqual([{ ...PORTUGAL_AIR, value: 499 }]);
    expect((await fetchRun(7)).reconfirmed).toEqual([]);
  });

  /**
   * Review of PL-060. **A run's items are exact pairs, not a rectangle**: a retry of Portugal's
   * rent and Spain's tax never asked about Portugal's tax, so a reuse recorded for it is not the
   * run's, as the server's join on the run's own items decides.
   */
  it("names only what a run over exact pairs re-confirmed among its own items", async () => {
    const pt = "country.portugal";
    const es = "country.spain";
    const reuse = { data_acquisition_run: 11, data_source: "eurostat", value: null };
    const reusesBefore = RUN_REUSES.length;
    RUN_ITEMS[11] = [
      { candidate: pt, attribute: "country.rent" },
      { candidate: es, attribute: "country.tax" },
    ];
    RUN_REUSES.push(
      { ...reuse, candidate: pt, attribute: "country.rent" },
      { ...reuse, candidate: pt, attribute: "country.tax" },
    );
    try {
      expect((await fetchRun(11)).reconfirmed).toEqual([
        { data_source: "eurostat", candidate: pt, attribute: "country.rent", value: null },
      ]);
    } finally {
      RUN_REUSES.splice(reusesBefore);
      delete RUN_ITEMS[11];
    }
  });

  it("restates a figure the fixtures hold, for the same pair and source", () => {
    for (const reuse of RUN_REUSES) {
      expect(STORED_VALUES.find((value) => value.id === reuse.value)).toMatchObject({
        candidate: reuse.candidate,
        attribute: reuse.attribute,
        data_source: reuse.data_source,
      });
    }
  });

  it("lists exactly the values a run re-confirmed, superseded ones only when asked", async () => {
    const listed = (query: Record<string, unknown>) =>
      getJson("/values", query as never) as Promise<{ items: { id: number }[]; total: number }>;

    expect(
      (await listed({ reconfirmed_by_run: 6, include_superseded: true })).items.map(
        (value) => value.id,
      ),
    ).toEqual([499]);
    expect((await listed({ reconfirmed_by_run: 6 })).total).toBe(0);
    expect(
      (await listed({ reconfirmed_by_run: 7, include_superseded: true })).total,
    ).toBe(0);
  });

  it("refuses both run filters together, located at the second", async () => {
    const error = (await getJson("/values", {
      data_acquisition_run: 6,
      reconfirmed_by_run: 6,
    }).catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid_request");
    expect(error.details).toEqual({
      errors: [
        {
          location: ["query", "reconfirmed_by_run"],
          problem: "cannot be asked for together with data_acquisition_run",
          kind: "mutually_exclusive",
        },
      ],
    });
  });
});

/**
 * PL-089, PL-086. **A figure typed by hand, refused as the server refuses it**: the body is
 * validated before the route runs, so a citation that is not a full web address is refused
 * first, every one named; then `data/manual.py`'s order, permission before the switch.
 */
describe("the mock's manual entry", () => {
  const TYPED: ManualValueInput = {
    candidate: "country.portugal",
    attribute: "country.residency_admin_ease",
    payload: { value: 3, range_min: 0, range_max: 10, assigned_by: "human" },
    reference_period: { start: "2026-01-01", end: "2026-12-31" },
    retrieval_date: "2026-10-25",
    confidence_level: "medium",
    citations: ["https://example.com/page"],
  };

  async function refusalOf(input: ManualValueInput): Promise<ApiError> {
    return (await enterValueManually(input).catch((thrown: unknown) => thrown)) as ApiError;
  }

  it("names every citation that is not a full web address, before any other check", async () => {
    const error = await refusalOf({
      ...TYPED,
      attribute: "country.total_tax_rate_effective",
      citations: ["https://example.com", "javascript:alert(1)", "https://"],
    });

    expect([error.status, error.code]).toEqual([422, "invalid_request"]);
    expect(
      (error.details?.["errors"] as { location: string[]; kind: string }[]).map((problem) => [
        problem.location,
        problem.kind,
      ]),
    ).toEqual([
      [["body", "citations", "1"], "string_pattern_mismatch"],
      [["body", "citations", "2"], "string_pattern_mismatch"],
    ]);
  });

  it("refuses while the manual source is switched off", async () => {
    await updateDataSource("manual", { is_enabled: false });

    const error = await refusalOf(TYPED);

    expect([error.status, error.code]).toEqual([409, "manual_entry_switched_off"]);
  });

  it("refuses an attribute that takes no typed figure before it looks at the switch", async () => {
    await updateDataSource("manual", { is_enabled: false });

    const error = await refusalOf({ ...TYPED, attribute: "country.total_tax_rate_effective" });

    expect([error.status, error.code]).toEqual([409, "manual_entry_not_permitted"]);
  });

  it("stores a typed figure while the source is on", async () => {
    expect((await enterValueManually(TYPED)).data_source).toBe("manual");
  });
});

/** PUT /data-sources/order, as `reorder_keeping_tiers` answers it (D36). */
describe("the mock's source reorder", () => {
  const priorities = (items: readonly { id: string; default_priority: number }[]) =>
    items.map((source) => [source.id, source.default_priority]);

  it("hands the stored numbers back out in the new order, so the tiers survive", async () => {
    const { items } = await reorderDataSources([
      "llm", "eurostat", "oecd", "manual", "eurostat_estimate",
    ]);

    expect(priorities(items)).toEqual([
      ["llm", 10], ["eurostat", 11], ["oecd", 50], ["manual", 65], ["eurostat_estimate", 90],
    ]);
    expect(priorities((await fetchDataSources()).items)).toEqual(priorities(items));
  });

  /** A tie reads back by id, so one the new order keeps is left a tie, and a swap splits it. */
  it("splits a tie only when the new order puts it against the ids", async () => {
    await patchJson("/data-sources/{dataSourceId}", { default_priority: 10 }, {
      pathParams: { dataSourceId: "manual" },
    });
    expect(priorities((await fetchDataSources()).items)).toEqual([
      ["eurostat", 10], ["manual", 10], ["oecd", 11], ["eurostat_estimate", 65], ["llm", 90],
    ]);

    const kept = await reorderDataSources(["eurostat", "manual", "oecd", "eurostat_estimate", "llm"]);
    expect(priorities(kept.items)).toEqual([
      ["eurostat", 10], ["manual", 10], ["oecd", 11], ["eurostat_estimate", 65], ["llm", 90],
    ]);

    // Eurostat now follows Manual entry on 10, which reads back the other way, so it takes 11 --
    // a tie with OECD that reads back in the order asked for, so it stands.
    const swapped = await reorderDataSources([
      "manual", "eurostat", "oecd", "eurostat_estimate", "llm",
    ]);
    expect(priorities(swapped.items)).toEqual([
      ["manual", 10], ["eurostat", 11], ["oecd", 11], ["eurostat_estimate", 65], ["llm", 90],
    ]);
  });

  it("refuses an order that does not name every source once, with all three lists", async () => {
    const error = (await reorderDataSources(["llm", "llm", "gone"]).catch(
      (thrown: unknown) => thrown,
    )) as ApiError;

    expect(error.status).toBe(422);
    expect(error.code).toBe("invalid_source_order");
    expect(error.details).toEqual({
      missing: ["eurostat", "eurostat_estimate", "manual", "oecd"],
      repeated: ["llm"],
      unknown: ["gone"],
    });
    expect(priorities((await fetchDataSources()).items)).toEqual([
      ["eurostat", 10], ["oecd", 11], ["manual", 50], ["eurostat_estimate", 65], ["llm", 90],
    ]);
  });

  it("leaves a list empty where nothing was wrong with it", async () => {
    const error = (await reorderDataSources(["eurostat", "oecd", "manual", "eurostat_estimate"]).catch(
      (thrown: unknown) => thrown,
    )) as ApiError;

    expect(error.details).toEqual({ missing: ["llm"], repeated: [], unknown: [] });
  });

  it("refuses a body that is not a list of ids as a malformed request", async () => {
    const error = (await reorderDataSources([7 as unknown as string]).catch(
      (thrown: unknown) => thrown,
    )) as ApiError;

    expect(error.code).toBe("invalid_request");
    expect(error.details).toEqual({
      errors: [{ location: ["body", "order", "0"], problem: "Input should be a valid string", kind: "string_type" }],
    });
  });
});

/**
 * **A set's lifecycle as the server keeps it** (PL-033, PL-034): a deletion is a tombstone that
 * keeps its id, a restore brings the set back exactly, and a new set copies the default. The
 * codes and `details` are `errors.py`'s.
 */
describe("the mock criteria sets", () => {
  async function refusal(request: Promise<unknown>): Promise<ApiError> {
    return (await request.catch((thrown: unknown) => thrown)) as ApiError;
  }

  it("deletes restorably: gone from every read, then back exactly", async () => {
    const before = await fetchCriteriaSet("remote_only");

    await deleteCriteriaSet("remote_only");

    expect((await fetchCriteriaSets()).items.map((set) => set.id)).toEqual(["default"]);
    expect((await refusal(fetchCriteriaSet("remote_only"))).code).toBe("not_found");
    expect((await refusal(fetchRanking("remote_only", "country"))).status).toBe(404);
    expect(await restoreCriteriaSet("remote_only")).toEqual(before);
    expect(await fetchCriteriaSet("remote_only")).toEqual(before);
  });

  it("restores idempotently, and 404s an id no set ever held", async () => {
    const live = await fetchCriteriaSet("default");

    expect(await restoreCriteriaSet("default")).toEqual(live);
    expect(await restoreCriteriaSet("default")).toEqual(live);
    expect((await refusal(restoreCriteriaSet("never_held"))).status).toBe(404);
  });

  it("refuses a restore whose name a live set took meanwhile, naming it", async () => {
    await deleteCriteriaSet("remote_only");
    await renameCriteriaSet("default", "remote ONLY");

    const refused = await refusal(restoreCriteriaSet("remote_only"));

    expect([refused.status, refused.code]).toEqual([409, "criteria_set_name_taken"]);
    expect(refused.details).toEqual({ name: "Remote only" });
  });

  it("never gives a deleted set's id to another set", async () => {
    await deleteCriteriaSet("remote_only");

    const refused = await refusal(createCriteriaSet("remote_only", "Another"));

    expect([refused.status, refused.code]).toEqual([409, "criteria_set_exists"]);
  });

  it("creates a set as a full copy of the default, even a deleted default", async () => {
    const shipped = await fetchCriteriaSet("default");
    await deleteCriteriaSet("default");

    const created = await createCriteriaSet("partner", "Partner");

    expect(created).toEqual({ ...shipped, id: "partner", name: "Partner" });
  });

  it("refuses a name a live set has, and an id the server would not hold", async () => {
    const taken = await refusal(duplicateCriteriaSet("default", "other", "Remote only"));
    const malformed = await refusal(createCriteriaSet("remote-only", "Remote"));

    expect([taken.status, taken.code, taken.details]).toEqual([
      409,
      "criteria_set_name_taken",
      { name: "Remote only" },
    ]);
    expect([malformed.status, malformed.code]).toEqual([422, "invalid_request"]);
  });

  /** PL-003, b19ff01: the server locates a malformed id in the body, as a `FieldProblem`. */
  it.each([
    ["a new set", () => createCriteriaSet("Remote-Only", "Remote")],
    ["a copy", () => duplicateCriteriaSet("default", "Remote-Only", "Remote")],
    // The body is read before the set it names, so the 422 comes before the 404.
    ["a copy of a set there is not", () => duplicateCriteriaSet("nowhere", "Remote-Only", "Remote")],
  ])("names where a malformed id is, for %s, as the server does", async (_, send) => {
    const malformed = await refusal(send());

    expect([malformed.status, malformed.code, malformed.details]).toEqual([
      422,
      "invalid_request",
      {
        errors: [
          {
            location: ["body", "id"],
            problem:
              "Value error, 'Remote-Only' is not a valid identifier: the segment 'Remote-Only' " +
              "must be lowercase letters, digits and underscores, and must start with a letter",
            kind: "malformed_identifier",
          },
        ],
      },
    ]);
  });
});

/** PL-120. The plan and the start refuse a scope with nothing to ask, by the server's reasons. */
describe("the mock's estimate with nothing to ask", () => {
  async function refused(act: () => Promise<unknown>): Promise<[number | null, string, unknown]> {
    const error = (await act().catch((thrown: unknown) => thrown)) as ApiError;
    return [error.status, error.code, error.details?.["reason"]];
  }

  it("refuses an empty selection as an empty scope, at the plan and at the start", async () => {
    const empty = { level: "country", pairs: [] };

    expect(await refused(() => planRun(empty))).toEqual([409, "nothing_to_fetch", "empty_scope"]);
    expect(await refused(() => startRun(empty))).toEqual([409, "nothing_to_fetch", "empty_scope"]);
  });

  it("refuses a sweep with every fetching source switched off", async () => {
    await switchOffEveryStructuredSource();

    expect(await refused(() => planRun({ level: "country" }))).toEqual([
      409,
      "nothing_to_fetch",
      "no_source_switched_on",
    ]);
  });

  it("asks a paid source only when the scope names attributes", async () => {
    await switchOffEveryStructuredSource();
    await updateDataSource("llm", { is_enabled: true });
    const pair = { candidate: "country.malta", attribute: "country.homicide_rate" };

    expect(await refused(() => planRun({ level: "country" }))).toEqual([
      409,
      "nothing_to_fetch",
      "no_source_switched_on",
    ]);
    const plan = await planRun({ level: "country", pairs: [pair, pair] });
    expect([plan.items_total, plan.llm_call_count, plan.by_source]).toEqual([
      1,
      1,
      [{ data_source: "llm", items: 1 }],
    ]);
  });
});

/** Review: exact pairs are settled as the server settles them, never counted as sent. */
describe("the mock's settling of exact pairs", () => {
  const SPAIN = "country.spain";

  it("drops a pair no switched-on source declares, and asks each pair only of its own sources", async () => {
    const plan = await planRun({
      level: "country",
      pairs: [
        { candidate: SPAIN, attribute: "country.cost_of_living_index" },
        { candidate: SPAIN, attribute: "country.nobody_measures_this" },
      ],
    });

    expect([plan.items_total, plan.by_source]).toEqual([1, [{ data_source: "eurostat", items: 1 }]]);
  });

  it("refuses pairs nothing on can answer as nothing answerable, with the counts", async () => {
    const error = (await planRun({
      level: "country",
      pairs: [
        { candidate: SPAIN, attribute: "country.nobody_measures_this" },
        { candidate: "country.portugal", attribute: "country.nobody_measures_this" },
      ],
    }).catch((thrown: unknown) => thrown)) as ApiError;

    expect([error.status, error.code, error.details]).toEqual([
      409,
      "nothing_to_fetch",
      { reason: "nothing_answerable", candidates: 2, attributes: 1 },
    ]);
  });
});

/** PL-124. A retry and its estimate go back alike, refusing in the server's order. */
describe("the mock's retry of exact pairs", () => {
  const TAX = { candidate: "country.liechtenstein", attribute: "country.total_tax_rate_effective" };
  const OTHER = { candidate: "country.malta", attribute: "country.homicide_rate" };

  async function refused(act: () => Promise<unknown>): Promise<[string, unknown]> {
    const error = (await act().catch((thrown: unknown) => thrown)) as ApiError;
    return [error.code, error.details];
  }

  it("estimates exactly the selected failures, asking only the source that failed", async () => {
    const plan = await planRetry(7, { items: "failed", pairs: [TAX] });

    expect([plan.items_total, plan.by_source]).toEqual([1, [{ data_source: "oecd", items: 1 }]]);
  });

  it("refuses a run with nothing of the kind before it reads the selection", async () => {
    expect(await refused(() => planRetry(6, { items: "failed", pairs: [OTHER] }))).toEqual([
      "nothing_to_retry",
      {},
    ]);
    expect(await refused(() => retryRun(6, { items: "unanswered", pairs: [] }))).toEqual([
      "nothing_to_ask_again",
      {},
    ]);
  });

  it("refuses an empty selection, then one naming a pair the run does not hold", async () => {
    expect(await refused(() => planRetry(7, { items: "failed", pairs: [] }))).toEqual([
      "nothing_to_fetch",
      { reason: "empty_scope" },
    ]);
    expect(await refused(() => retryRun(7, { items: "failed", pairs: [TAX, OTHER] }))).toEqual([
      "selection_not_in_run",
      { items: "failed", pairs: [OTHER] },
    ]);
  });

  it("refuses a retry and its estimate while a run is in flight, naming it", async () => {
    RUNS.unshift({ ...RUNS[0]!, id: 9, run_status: "running", finished_at: null });
    try {
      expect(await refused(() => planRetry(7, { items: "failed", pairs: [TAX] }))).toEqual([
        "run_already_in_flight",
        { run: 9 },
      ]);
      expect(await refused(() => retryRun(7, { items: "failed", pairs: [TAX] }))).toEqual([
        "run_already_in_flight",
        { run: 9 },
      ]);
    } finally {
      RUNS.shift();
    }
  });

  it("asks unanswered items of every switched-on source, and refuses with none on", async () => {
    const plan = await planRetry(7, { items: "unanswered", pairs: [] }).catch(() => null);
    expect(plan).toBeNull();
    const asked = await planRetry(7, {
      items: "unanswered",
      pairs: [{ candidate: "country.liechtenstein", attribute: "country.overcrowding_rate" }],
    });
    expect(asked.by_source).toEqual([
      { data_source: "eurostat", items: 1 },
      { data_source: "oecd", items: 1 },
      { data_source: "eurostat_estimate", items: 1 },
    ]);

    await switchOffEveryStructuredSource();
    expect(
      await refused(() =>
        planRetry(7, {
          items: "unanswered",
          pairs: [{ candidate: "country.liechtenstein", attribute: "country.overcrowding_rate" }],
        }),
      ),
    ).toEqual(["nothing_to_fetch", { reason: "no_source_switched_on" }]);
  });
});

describe("the mock's gate answer", () => {
  const AN_ANSWER: MatchRuleResultInput = { match_result: "not_matching", data_source: "manual" };

  async function refusalOf(
    gate: string,
    candidate: string,
    answer: MatchRuleResultInput,
  ): Promise<ApiError> {
    return (await putMatchRuleResult(gate, candidate, answer).catch(
      (thrown: unknown) => thrown,
    )) as ApiError;
  }

  it("refuses a malformed body before it looks for the gate", async () => {
    const error = await refusalOf("no_such_gate", "country.portugal", {
      ...AN_ANSWER,
      override_reason: "",
    });

    expect([error.status, error.code]).toEqual([422, "invalid_request"]);
  });

  it("names every cited page that is not a full web address, before it looks for the gate", async () => {
    const error = await refusalOf("no_such_gate", "country.portugal", {
      ...AN_ANSWER,
      citations: ["https://example.com/page", "javascript:alert(1)", "example.com"],
    });

    expect([error.status, error.code]).toEqual([422, "invalid_request"]);
    expect(
      (error.details?.["errors"] as { location: string[]; kind: string }[]).map((problem) => [
        problem.location,
        problem.kind,
      ]),
    ).toEqual([
      [["body", "citations", "1"], "string_pattern_mismatch"],
      [["body", "citations", "2"], "string_pattern_mismatch"],
    ]);
  });

  it("refuses an unknown gate, then an unknown candidate, with 404", async () => {
    const gate = await refusalOf("no_such_gate", "country.atlantis", AN_ANSWER);
    const candidate = await refusalOf("country.uk_skilled_worker", "country.atlantis", AN_ANSWER);

    expect([gate.status, gate.code, candidate.status, candidate.code]).toEqual([
      404,
      "not_found",
      404,
      "not_found",
    ]);
  });

  it("refuses a candidate at another level than its gate, the pair in its details", async () => {
    const error = await refusalOf("country.uk_skilled_worker", "city.lisbon", {
      ...AN_ANSWER,
      data_source: "a_blog",
    });

    expect([error.status, error.code, error.details]).toEqual([
      422,
      "invalid_match_rule_result",
      { match_rule: "country.uk_skilled_worker", candidate: "city.lisbon" },
    ]);
  });

  it("refuses an unknown source before a period that ends first", async () => {
    const error = await refusalOf("country.uk_skilled_worker", "country.united_kingdom", {
      ...AN_ANSWER,
      data_source: "a_blog",
      reference_period: { start: "2026-12-31", end: "2026-01-01" },
    });

    expect([error.status, error.code]).toEqual([422, "unknown_data_source"]);
  });

  it("refuses a period that ends before it begins", async () => {
    const error = await refusalOf("country.uk_skilled_worker", "country.united_kingdom", {
      ...AN_ANSWER,
      reference_period: { start: "2026-12-31", end: "2026-01-01" },
    });

    expect([error.status, error.code]).toEqual([422, "invalid_reference_period"]);
  });

  it("refuses a model's answer over a person's with 409, and keeps the person's", async () => {
    const error = await refusalOf("country.eu_free_movement", "country.spain", {
      ...AN_ANSWER,
      data_source: "llm",
    });
    const stored = (await fetchMatchRuleResults()).items.find(
      (answer) => answer.candidate === "country.spain",
    );

    expect([error.status, error.code, error.details]).toEqual([
      409,
      "answer_recorded_by_a_person",
      { match_rule: "country.eu_free_movement", candidate: "country.spain" },
    ]);
    expect(stored?.match_result).toBe("matching");
  });

  it("stores a model's answer where nobody answered as a proposal", async () => {
    const stored = await putMatchRuleResult("country.uk_skilled_worker", "country.united_kingdom", {
      ...AN_ANSWER,
      data_source: "llm",
    });

    expect(stored.is_proposal).toBe(true);
  });
});

/**
 * PL-153 stage 2. **A re-check is refused and stored as the server refuses and stores it**: the
 * pairs it names are its whole scope, a pair nobody answered is refused by name, and what it
 * finds sits beside the person's answer, never over it.
 */
describe("the mock's re-check of recorded answers", () => {
  const VISA_FOR_PORTUGAL = { match_rule: "country.visa_route_exists", candidate: "country.portugal" };

  async function aPersonAnswered(): Promise<void> {
    await putMatchRuleResult(VISA_FOR_PORTUGAL.match_rule, VISA_FOR_PORTUGAL.candidate, {
      match_result: "matching",
      data_source: "manual",
      reason: "Read the consulate's page.",
    });
  }

  async function refusalOf(ask: () => Promise<unknown>): Promise<ApiError> {
    return (await ask().catch((thrown: unknown) => thrown)) as ApiError;
  }

  it("estimates only the pairs it names", async () => {
    await aPersonAnswered();

    const plan = await planMatchRuleResearch({ level: "country", recheck: [VISA_FOR_PORTUGAL] });

    expect([plan.gates_total, plan.llm_call_count, plan.estimated_cost_eur]).toEqual([
      1, 1, RESEARCH_CALL_COST_EUR,
    ]);
  });

  it("keeps what it finds beside the person's answer, which still applies", async () => {
    await aPersonAnswered();

    const outcome = await researchMatchRules({ level: "country", recheck: [VISA_FOR_PORTUGAL] });
    const stored = (await fetchMatchRuleResults()).items.find(
      (answer) => answer.candidate === VISA_FOR_PORTUGAL.candidate,
    );

    expect([outcome.calls, outcome.cost_eur]).toEqual([1, RESEARCH_CALL_COST_EUR]);
    expect(stored).toMatchObject({ match_result: "matching", data_source: "manual", is_proposal: false });
    expect(stored?.pending_proposal).toMatchObject({ match_result: "not_matching", data_source: "llm" });
  });

  it.each([
    ["the estimate", () => planMatchRuleResearch({ level: "country", recheck: [VISA_FOR_PORTUGAL] })],
    ["the pass", () => researchMatchRules({ level: "country", recheck: [VISA_FOR_PORTUGAL] })],
  ])("refuses %s for a pair nobody answered with 422 unknown_scope, naming it", async (_act, ask) => {
    const error = await refusalOf(ask);

    expect([error.status, error.code, error.details]).toEqual([
      422,
      "unknown_scope",
      { recheck: [VISA_FOR_PORTUGAL] },
    ]);
  });

  it("refuses a re-check beside a list of gates with 422 invalid_request", async () => {
    await aPersonAnswered();

    const error = await refusalOf(() =>
      researchMatchRules({
        level: "country",
        recheck: [VISA_FOR_PORTUGAL],
        match_rules: ["country.visa_route_exists"],
      }),
    );

    expect([error.status, error.code]).toEqual([422, "invalid_request"]);
  });

  it("refuses a re-check that would spend with no cap set, and stores nothing", async () => {
    await aPersonAnswered();
    await replaceSettings({ ...SETTINGS, run_spend_cap_eur: null });

    const error = await refusalOf(() =>
      researchMatchRules({ level: "country", recheck: [VISA_FOR_PORTUGAL] }),
    );
    const stored = (await fetchMatchRuleResults()).items.find(
      (answer) => answer.candidate === VISA_FOR_PORTUGAL.candidate,
    );

    expect([error.status, error.code]).toEqual([409, "spend_cap_not_set"]);
    expect(stored?.pending_proposal ?? null).toBeNull();
  });

  it("is pending no longer once the person records again", async () => {
    await aPersonAnswered();
    await researchMatchRules({ level: "country", recheck: [VISA_FOR_PORTUGAL] });

    await aPersonAnswered();
    const stored = (await fetchMatchRuleResults()).items.find(
      (answer) => answer.candidate === VISA_FOR_PORTUGAL.candidate,
    );

    expect(stored?.pending_proposal ?? null).toBeNull();
  });
});

/** Every structured source the mock lists switched off, as "nothing left to fetch from" needs. */
async function switchOffEveryStructuredSource(): Promise<void> {
  for (const id of ["eurostat", "oecd", "eurostat_estimate"]) {
    await updateDataSource(id, { is_enabled: false });
  }
}
