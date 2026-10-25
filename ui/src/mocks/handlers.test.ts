import { describe, expect, it } from "vitest";
import { ApiError } from "../api/ApiError";
import { getJson } from "../api/client";
import { fetchRanking, replaceHousehold, replaceSettings } from "../api/endpoints";
import { HOUSEHOLD, SETTINGS } from "./fixtures";

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
