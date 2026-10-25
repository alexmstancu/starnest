import { describe, expect, it } from "vitest";
import { ApiError } from "../api/ApiError";
import { getJson } from "../api/client";
import {
  fetchCriteriaSet,
  fetchHoldings,
  fetchRanking,
  replaceHousehold,
  replaceSettings,
  researchMatchRules,
  updateCriterionRule,
  type CriterionRule,
} from "../api/endpoints";
import { HOUSEHOLD, RESEARCH_CALL_COST_EUR, SETTINGS } from "./fixtures";

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
    const ranking = await fetchRanking("remote-only", "country");

    expect(ranking.criteria_set).toBe("remote-only");
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
