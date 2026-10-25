/**
 * PL-150. That the gates are named by the catalog, once for the page, at every level.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { useMatchRuleNames } from "./useMatchRuleNames";

function countingGateRequests(
  answer?: () => Response | undefined,
): { asked: number; levels: (string | null)[] } {
  const seen = { asked: 0, levels: [] as (string | null)[] };
  mockServer.use(
    http.get("/v1/match-rules", ({ request }) => {
      seen.asked += 1;
      seen.levels.push(new URL(request.url).searchParams.get("level"));
      return (
        answer?.() ??
        HttpResponse.json({
          items: [
            { id: "uk_skilled_worker", name: "UK Skilled Worker route", level: "country", description: "" },
            { id: "city_permit", name: "A city permit", level: "city", description: "" },
          ],
        })
      );
    }),
  );
  return seen;
}

describe("the gate names", () => {
  it("come back keyed by id, for every level", async () => {
    const seen = countingGateRequests();

    const { result } = renderHook(() => useMatchRuleNames());

    await waitFor(() =>
      expect(result.current.get("uk_skilled_worker")).toBe("UK Skilled Worker route"),
    );
    expect(result.current.get("city_permit")).toBe("A city permit");
    expect(seen.levels).toEqual([null]);
  });

  it("are fetched once however many components ask", async () => {
    const seen = countingGateRequests();

    const first = renderHook(() => useMatchRuleNames());
    const second = renderHook(() => useMatchRuleNames());

    await waitFor(() => expect(first.result.current.size).toBeGreaterThan(0));
    await waitFor(() => expect(second.result.current.size).toBeGreaterThan(0));
    expect(seen.asked).toBe(1);
  });

  it("are empty after a failed read, and a failure is not remembered", async () => {
    let fail = true;
    const seen = countingGateRequests(() =>
      fail
        ? HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 })
        : undefined,
    );

    const first = renderHook(() => useMatchRuleNames());
    await waitFor(() => expect(seen.asked).toBe(1));
    expect(first.result.current.size).toBe(0);

    fail = false;
    const second = renderHook(() => useMatchRuleNames());
    await waitFor(() => expect(second.result.current.size).toBe(2));
    expect(seen.asked).toBe(2);
  });
});
