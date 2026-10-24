import { describe, expect, it } from "vitest";
import { ApiError } from "../api/ApiError";
import { getJson } from "../api/client";
import { fetchRanking } from "../api/endpoints";

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
        { location: ["query", "criteria_set"], problem: "Field required" },
        { location: ["query", "level"], problem: "Field required" },
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
      errors: [{ location: ["query", missing], problem: "Field required" }],
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
