import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError, CLIENT_ERROR_CODES, isApiError } from "./ApiError";
import {
  API_PREFIX,
  buildUrl,
  deleteResource,
  getJson,
  patchJson,
  postJson,
  putJson,
} from "./client";
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
    // The page is one; the total is every run the fixture holds, which is what makes the
    // limit visible as a limit rather than as the whole answer.
    expect(runs.total).toBe(3);
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
    // **A path the mock will never have**, rather than one that simply has no handler yet:
    // this test used `/pillars` until that operation got a client, and then it was asserting
    // that a real endpoint was missing.
    const error = (await getJson(
      "/nothing-the-contract-describes" as never,
    ).catch((thrown: unknown) => thrown)) as ApiError;

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

describe("the paths and the query a request is built from", () => {
  it("repeats a list parameter rather than joining it", () => {
    // **The contract types `comparators` as an array.** Joining with commas would send one
    // candidate called "country.spain,country.greece", which the server reads as a candidate
    // id it has never heard of -- a 404 for what is actually a client bug.
    const url = buildUrl("/comparisons", {
      focus: "country.portugal",
      comparators: ["country.spain", "country.greece"],
    });

    expect(url).toContain("comparators=country.spain");
    expect(url).toContain("comparators=country.greece");
    expect(url).not.toContain("country.spain%2C");
  });

  it("leaves an undefined parameter out rather than sending the word undefined", () => {
    expect(buildUrl("/values", { attribute: undefined, limit: 10 })).toBe(
      `${API_PREFIX}/values?limit=10`,
    );
  });

  it("sends an empty list as no parameter at all", () => {
    expect(buildUrl("/comparisons", { comparators: [] })).toBe(
      `${API_PREFIX}/comparisons`,
    );
  });

  it("substitutes a path parameter", () => {
    expect(
      buildUrl("/criteria-sets/{criteriaSetId}", undefined, {
        criteriaSetId: "alex",
      }),
    ).toBe(`${API_PREFIX}/criteria-sets/alex`);
  });

  it("throws on a missing path value rather than sending the placeholder", () => {
    // A request to `/criteria-sets/%7BcriteriaSetId%7D` comes back as a 404 that reads like a
    // missing criteria set instead of the programming error it is.
    expect(() => buildUrl("/criteria-sets/{criteriaSetId}", undefined, {})).toThrow();
  });
});

describe("the writes", () => {
  it("sends a PUT and returns what came back", async () => {
    mockServer.use(
      http.put("/v1/settings", async ({ request }) =>
        HttpResponse.json({ echoed: await request.json() }),
      ),
    );

    const answer = await putJson("/settings", { score_scale_max: 100 });

    expect(answer).toEqual({ echoed: { score_scale_max: 100 } });
  });

  it("sends a PATCH and returns what came back", async () => {
    mockServer.use(
      http.patch("/v1/data-sources/:id", async ({ request }) =>
        HttpResponse.json({ echoed: await request.json() }),
      ),
    );

    const answer = await patchJson(
      "/data-sources/{dataSourceId}",
      { is_enabled: false },
      { pathParams: { dataSourceId: "oecd" } },
    );

    expect(answer).toEqual({ echoed: { is_enabled: false } });
  });

  it("sends a DELETE and tolerates the empty body a 204 has", async () => {
    // **A 204 carries no JSON.** Parsing one as JSON throws, and the throw would surface as
    // "the backend answered with something that is not JSON" for a delete that worked.
    mockServer.use(
      http.delete("/v1/criteria-sets/:id", () => new HttpResponse(null, { status: 204 })),
    );

    await expect(
      deleteResource("/criteria-sets/{criteriaSetId}", {
        pathParams: { criteriaSetId: "scratch" },
      }),
    ).resolves.not.toThrow();
  });

  it("raises the server's refusal on a write, with its code", async () => {
    mockServer.use(
      http.put("/v1/settings", () =>
        HttpResponse.json(
          { code: "score_scale_not_set", message: "no scale" },
          { status: 409 },
        ),
      ),
    );

    await expect(putJson("/settings", {})).rejects.toMatchObject({
      code: "score_scale_not_set",
    });
  });
});
