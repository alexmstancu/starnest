import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError, CLIENT_ERROR_CODES, isApiError } from "./ApiError";
import { API_PREFIX, buildUrl, getJson, postJson } from "./client";
import { fetchCandidates, fetchLevels, fetchRanking, fetchRuns } from "./endpoints";
import { mockServer } from "../mocks/server";

describe("buildUrl", () => {
  it("keeps every path relative and under /v1, so requests are same-origin", () => {
    expect(buildUrl("/levels")).toBe(`${API_PREFIX}/levels`);
    expect(buildUrl("/levels").startsWith("/")).toBe(true);
    expect(buildUrl("/levels")).not.toMatch(/^https?:/);
  });

  it("appends query parameters", () => {
    expect(buildUrl("/rankings", { criteria_set: "default", level: "country" })).toBe(
      "/v1/rankings?criteria_set=default&level=country",
    );
  });

  it("omits undefined parameters instead of sending the string 'undefined'", () => {
    expect(buildUrl("/candidates", { level: undefined })).toBe("/v1/candidates");
  });

  it("encodes values", () => {
    expect(buildUrl("/candidates", { parent: "country.the netherlands" })).toBe(
      "/v1/candidates?parent=country.the+netherlands",
    );
  });

  it("carries numeric and boolean parameters", () => {
    expect(buildUrl("/values", { limit: 10, include_superseded: true })).toBe(
      "/v1/values?limit=10&include_superseded=true",
    );
  });
});

describe("getJson against the contract mock", () => {
  it("returns the parsed body", async () => {
    const levels = await fetchLevels();

    expect(levels.items.map((level) => level.id)).toEqual(["country", "city"]);
  });

  it("passes query parameters through", async () => {
    const cities = await fetchCandidates("city");

    expect(cities.items.every((candidate) => candidate.level === "city")).toBe(true);
  });

  it("returns a ranking whose coverage is a 0-100 percentage, untouched", async () => {
    const ranking = await fetchRanking("default", "country");
    const portugal = ranking.candidates.find((c) => c.candidate === "country.portugal");

    expect(portugal?.coverage).toBe(92.4);
    expect(portugal?.score).toBe(78);
  });

  it("honours a limit", async () => {
    const runs = await fetchRuns(1);

    expect(runs.items).toHaveLength(1);
    expect(runs.total).toBe(2);
  });
});

describe("error handling", () => {
  it("throws an ApiError carrying the contract's code and message", async () => {
    mockServer.use(
      http.get("/v1/levels", () =>
        HttpResponse.json(
          { code: "weights_all_locked", message: "Every other weight is locked.", details: { locked: ["a"] } },
          { status: 409 },
        ),
      ),
    );

    const error = await fetchLevels().catch((thrown: unknown) => thrown);

    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).code).toBe("weights_all_locked");
    expect((error as ApiError).message).toBe("Every other weight is locked.");
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).details).toEqual({ locked: ["a"] });
  });

  it("names a non-2xx body that is not the documented error shape", async () => {
    mockServer.use(
      http.get("/v1/levels", () => HttpResponse.json({ oops: true }, { status: 500 })),
    );

    const error = (await fetchLevels().catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.code).toBe(CLIENT_ERROR_CODES.malformedError);
    expect(error.status).toBe(500);
  });

  it("names a non-2xx body that is not JSON at all", async () => {
    mockServer.use(
      http.get("/v1/levels", () => new HttpResponse("<html>gateway</html>", { status: 502 })),
    );

    const error = (await fetchLevels().catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.code).toBe(CLIENT_ERROR_CODES.malformedError);
    expect(error.status).toBe(502);
  });

  it("names a 2xx body that is not JSON", async () => {
    mockServer.use(http.get("/v1/levels", () => new HttpResponse("not json", { status: 200 })));

    const error = (await fetchLevels().catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.code).toBe(CLIENT_ERROR_CODES.malformedBody);
  });

  it("reports an unreachable backend without inventing a status", async () => {
    mockServer.use(http.get("/v1/levels", () => HttpResponse.error()));

    const error = (await fetchLevels().catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.code).toBe(CLIENT_ERROR_CODES.unreachable);
    expect(error.status).toBeNull();
  });

  it("lets an abort propagate as an abort, not as a failure to report", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = (await fetchLevels({ signal: controller.signal }).catch(
      (thrown: unknown) => thrown,
    )) as Error;

    expect(isApiError(error)).toBe(false);
    expect(error.name).toBe("AbortError");
  });

  it("answers an unmocked path with a code rather than silence", async () => {
    const error = (await getJson("/pillars").catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.code).toBe("not_mocked");
    expect(error.status).toBe(501);
  });
});

describe("postJson", () => {
  it("sends a JSON body and returns the created resource", async () => {
    mockServer.use(
      http.post("/v1/criteria-sets", async ({ request }) => {
        const body = (await request.json()) as { id: string; name: string };
        return HttpResponse.json({ id: body.id, name: body.name }, { status: 201 });
      }),
    );

    const created = await postJson("/criteria-sets", { id: "weekend", name: "Weekend" });

    expect(created).toEqual({ id: "weekend", name: "Weekend" });
  });

  it("returns undefined for a 204", async () => {
    mockServer.use(http.post("/v1/criteria-sets", () => new HttpResponse(null, { status: 204 })));

    await expect(postJson("/criteria-sets", { id: "empty", name: "Empty" })).resolves.toBeUndefined();
  });
});
