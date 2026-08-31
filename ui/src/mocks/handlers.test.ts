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
    const error = (await getJson("/rankings").catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.code).toBe("missing_query_parameter");
    expect(error.status).toBe(400);
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
