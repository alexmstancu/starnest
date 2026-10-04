/**
 * That the catalog's attribute names are fetched once, and that a screen never prints an id.
 *
 * The design states the rule the other way round -- "No programmatic identifiers in rendered
 * text" -- and four screens need the same answer: the ranked drill-down, the one-attribute
 * drill-down, Compare's rows and Acquire's failure lists. Deliberately the same shape as
 * `usePillarNames`, so the two can be read side by side.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { forgetAttributeNames, useAttributeNames } from "./useAttributeNames";

/** Counts the requests that actually reach the network, whatever the handler then answers. */
function countingAttributeRequests(answer?: () => Response): { asked: number } {
  const seen = { asked: 0 };
  mockServer.use(
    http.get("/v1/attributes", () => {
      seen.asked += 1;
      return (
        answer?.() ??
        HttpResponse.json({
          items: [
            { id: "country.average_working_hours", name: "Average working hours" },
            { id: "country.homicide_rate", name: "Homicide rate" },
          ],
        })
      );
    }),
  );
  return seen;
}

describe("the attribute names", () => {
  it("come back keyed by id", async () => {
    countingAttributeRequests();

    const { result } = renderHook(() => useAttributeNames());

    await waitFor(() => expect(result.current.get("country.average_working_hours")).toBe(
      "Average working hours",
    ));
    expect(result.current.get("country.homicide_rate")).toBe("Homicide rate");
  });

  it("are fetched once however many components ask", async () => {
    const seen = countingAttributeRequests();

    const first = renderHook(() => useAttributeNames());
    const second = renderHook(() => useAttributeNames());

    await waitFor(() => expect(first.result.current.size).toBeGreaterThan(0));
    await waitFor(() => expect(second.result.current.size).toBeGreaterThan(0));
    expect(seen.asked).toBe(1);
  });

  it("are empty until they arrive, rather than guessed at", async () => {
    countingAttributeRequests();

    const { result } = renderHook(() => useAttributeNames());

    // The first render has nothing: `attributeName` falls back to the id without its level, which is a
    // decision taken in `format/` rather than a guess invented here.
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.size).toBeGreaterThan(0));
  });

  it("give the same empty map each time, so a consumer's identity check holds", () => {
    countingAttributeRequests();

    const first = renderHook(() => useAttributeNames());
    const second = renderHook(() => useAttributeNames());

    expect(first.result.current).toBe(second.result.current);
  });

  it("are asked for again after a failure, rather than staying broken for the session", async () => {
    // **A rejected promise must not be remembered.** Keeping it would make one bad moment
    // permanent: every screen opened afterwards would show title-cased ids until a reload.
    const failing = countingAttributeRequests(() => HttpResponse.error());
    const { result } = renderHook(() => useAttributeNames());
    await waitFor(() => expect(failing.asked).toBe(1));
    await waitFor(() => expect(result.current.size).toBe(0));

    const recovered = countingAttributeRequests();
    renderHook(() => useAttributeNames());

    await waitFor(() => expect(recovered.asked).toBe(1));
  });

  it("are forgotten on request, so one test cannot answer for the next", async () => {
    const seen = countingAttributeRequests();
    const first = renderHook(() => useAttributeNames());
    await waitFor(() => expect(first.result.current.size).toBeGreaterThan(0));

    forgetAttributeNames();
    renderHook(() => useAttributeNames());

    await waitFor(() => expect(seen.asked).toBe(2));
  });
});
