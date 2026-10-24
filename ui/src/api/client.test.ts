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
import { answeredWrites } from "./setWrites";

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

  /**
   * **The status is read before the body is judged** (PL-002). A proxy answering for a backend
   * that is not there -- Vite's empty 500, nginx's HTML 502 -- is "the server did not answer",
   * never "an answer in a shape this interface does not recognise".
   */
  it.each([
    ["a 502 page from a proxy", 502, "<html>Bad Gateway</html>", CLIENT_ERROR_CODES.unreachable],
    ["an empty 503", 503, "", CLIENT_ERROR_CODES.unreachable],
    ["an empty 504", 504, "", CLIENT_ERROR_CODES.unreachable],
    ["Vite's empty 500 for a backend it cannot reach", 500, "", CLIENT_ERROR_CODES.unreachable],
    ["a 500 in plain text", 500, "Internal Server Error", CLIENT_ERROR_CODES.serverFault],
    ["a 500 not in the documented shape", 500, '{"oops":true}', CLIENT_ERROR_CODES.serverFault],
    ["a 500 in the documented shape", 500, '{"code":"database_down","message":"x"}', "database_down"],
    ["a 503 in the documented shape", 503, '{"code":"database_down","message":"x"}', "database_down"],
    ["a 409 in the documented shape", 409, '{"code":"weights_all_locked","message":"x"}', "weights_all_locked"],
    ["a 404 from the framework", 404, '{"detail":"Not Found"}', CLIENT_ERROR_CODES.malformedError],
    ["a 400 that is not JSON", 400, "bad", CLIENT_ERROR_CODES.malformedError],
  ])("classifies %s", async (_case, status, body, code) => {
    mockServer.use(http.get("/v1/levels", () => new HttpResponse(body, { status })));

    const error = (await fetchLevels().catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
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

/**
 * UI-10. **`JSON.stringify` writes NaN and the infinities as null**, and null means "unset" in
 * this contract: a lone "." typed into a nullable setting went out as null and cleared it. A
 * body holding one was already wrong, so the client refuses it rather than send another request.
 */
describe("a body holding a number JSON cannot carry", () => {
  /** Every request that reaches the mock, so a test can say none did. */
  function recordWrites(): string[] {
    const reached: string[] = [];
    mockServer.events.on("request:start", ({ request }) => {
      reached.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    return reached;
  }

  it("refuses to send NaN rather than sending null", async () => {
    const reached = recordWrites();

    await expect(
      putJson("/settings", { min_coverage: Number.NaN }),
    ).rejects.toMatchObject({
      code: CLIENT_ERROR_CODES.unsendableNumber,
      details: { field: "min_coverage" },
    });
    expect(reached).toEqual([]);
  });

  it("refuses an infinity, which JSON would also send as null", async () => {
    const reached = recordWrites();

    await expect(
      patchJson(
        "/criteria-sets/{criteriaSetId}/criteria/{attributeId}",
        { weight: Number.POSITIVE_INFINITY },
        { pathParams: { criteriaSetId: "default", attributeId: "country.x" } },
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(reached).toEqual([]);
  });

  it("finds one however deep in the body it sits", async () => {
    const reached = recordWrites();

    await expect(
      postJson("/values/manual", {
        candidate: "country.portugal",
        attribute: "country.residency_admin_ease",
        payload: {
          value: Number.NaN,
          range_min: 0,
          range_max: 10,
          assigned_by: "human",
        },
        reference_period: { start: "2025-01-01", end: "2025-12-31" },
        retrieval_date: "2026-01-01T00:00:00Z",
        confidence_level: "medium",
      }),
    ).rejects.toMatchObject({ code: CLIENT_ERROR_CODES.unsendableNumber });
    expect(reached).toEqual([]);
  });

  it("still sends a null, which is a decision, and a zero", async () => {
    mockServer.use(
      http.put("/v1/settings", async ({ request }) =>
        HttpResponse.json({ echoed: await request.json() }),
      ),
    );

    const answer = await putJson("/settings", {
      min_coverage: null,
      comparator_limit: 0,
    });

    expect(answer).toEqual({
      echoed: { min_coverage: null, comparator_limit: 0 },
    });
  });
});

/**
 * UIC-A3, RD-2. **A write under a criteria set is noted once it is answered**, so the screen that
 * reads the whole set can tell a read begun before it from one begun after. In the client rather
 * than at each endpoint: every write addressed under a set changes what a read of it returns, and
 * one added later must not be able to forget.
 */
describe("a write addressed under a criteria set", () => {
  it("is noted once it is answered, against the set it was addressed to", async () => {
    mockServer.use(
      http.put(
        "/v1/criteria-sets/:criteriaSetId/match-rules/:matchRuleId",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    await putJson(
      "/criteria-sets/{criteriaSetId}/match-rules/{matchRuleId}",
      { is_enforced: true },
      { pathParams: { criteriaSetId: "default", matchRuleId: "country.visa_route_exists" } },
    );

    expect(answeredWrites("default")).toBe(1);
    expect(answeredWrites("remote_only")).toBe(0);
  });

  it("is noted for every kind of write: a patch, a post and a delete as well", async () => {
    mockServer.use(
      http.patch("/v1/criteria-sets/:criteriaSetId", () => HttpResponse.json({})),
      http.post("/v1/criteria-sets/:criteriaSetId/duplicate", () => HttpResponse.json({})),
      http.delete("/v1/criteria-sets/:criteriaSetId", () => new HttpResponse(null, { status: 204 })),
    );

    await patchJson(
      "/criteria-sets/{criteriaSetId}",
      { name: "Renamed" },
      { pathParams: { criteriaSetId: "a" } },
    );
    await postJson(
      "/criteria-sets/{criteriaSetId}/duplicate",
      { id: "b_copy", name: "Copy" },
      { pathParams: { criteriaSetId: "b" } },
    );
    await deleteResource("/criteria-sets/{criteriaSetId}", { pathParams: { criteriaSetId: "c" } });

    expect([answeredWrites("a"), answeredWrites("b"), answeredWrites("c")]).toEqual([1, 1, 1]);
  });

  it("is not noted when it is refused, which changed nothing", async () => {
    mockServer.use(
      http.patch("/v1/criteria-sets/:criteriaSetId", () =>
        HttpResponse.json({ code: "conflict", message: "no" }, { status: 409 }),
      ),
    );

    await expect(
      patchJson(
        "/criteria-sets/{criteriaSetId}",
        { name: "Renamed" },
        { pathParams: { criteriaSetId: "default" } },
      ),
    ).rejects.toBeInstanceOf(ApiError);

    expect(answeredWrites("default")).toBe(0);
  });

  it("is not noted for a read of the set", async () => {
    await getJson("/criteria-sets/{criteriaSetId}", { level: undefined }, {
      pathParams: { criteriaSetId: "default" },
    });

    expect(answeredWrites("default")).toBe(0);
  });
});
