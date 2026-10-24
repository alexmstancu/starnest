import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { COUNTRY_CANDIDATES } from "../mocks/fixtures";
import { mockServer } from "../mocks/server";
import { useShellSummary } from "./useShellSummary";

const BASE = "/v1";

/** PL-005: the count that needs no score is not fetched in the same promise as the ranking. */
describe("useShellSummary", () => {
  it("reads Total from the roster even when the ranking is refused", async () => {
    mockServer.use(
      http.get(`${BASE}/rankings`, () =>
        HttpResponse.json(
          { code: "score_scale_not_set", message: "not set" },
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHook(() => useShellSummary("default", "country", 0));

    await waitFor(() =>
      expect(result.current.total).toMatchObject({
        state: "ready",
        data: COUNTRY_CANDIDATES.length,
      }),
    );
    await waitFor(() => expect(result.current.counts.state).toBe("failed"));
  });

  it("asks for nothing while there is no selection", () => {
    const { result } = renderHook(() => useShellSummary(null, null, 0));

    expect(result.current.total.state).toBe("idle");
    expect(result.current.counts.state).toBe("idle");
  });
});
