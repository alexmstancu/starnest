/**
 * That the catalog's eleven pillars are fetched once, not once per component.
 *
 * Five components need these names -- both Configure panels, the Compare matrix, the ranked
 * table and its drill-down -- and each used to mount its own `useResource`, so opening Rank
 * fired two identical `GET /pillars` and opening Configure fired two more. They never change
 * while the app is open, so there is nothing to invalidate and one shared promise is the whole
 * of what a cache needs to be here.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { forgetPillarNames, usePillarNames } from "./usePillarNames";

/** Counts the requests that actually reach the network, whatever the handler then answers. */
function countingPillarRequests(answer?: () => Response): { asked: number } {
  const seen = { asked: 0 };
  mockServer.use(
    http.get("/v1/pillars", () => {
      seen.asked += 1;
      return (
        answer?.() ??
        HttpResponse.json({
          items: [
            { id: "economics", name: "Economy", display_order: 1 },
            { id: "connectivity", name: "Transport", display_order: 7 },
          ],
        })
      );
    }),
  );
  return seen;
}

describe("the pillar names", () => {
  it("come back keyed by id", async () => {
    countingPillarRequests();

    const { result } = renderHook(() => usePillarNames());

    await waitFor(() => expect(result.current.get("economics")).toBe("Economy"));
    expect(result.current.get("connectivity")).toBe("Transport");
  });

  it("are fetched once however many components ask", async () => {
    const seen = countingPillarRequests();

    const first = renderHook(() => usePillarNames());
    const second = renderHook(() => usePillarNames());

    await waitFor(() => expect(first.result.current.size).toBeGreaterThan(0));
    await waitFor(() => expect(second.result.current.size).toBeGreaterThan(0));
    expect(seen.asked).toBe(1);
  });

  it("are empty until they arrive, rather than guessed at", async () => {
    countingPillarRequests();

    const { result } = renderHook(() => usePillarNames());

    // The first render has nothing: `pillarName` falls back to the title-cased id, which is a
    // decision taken in `format/` rather than a guess invented here.
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.size).toBeGreaterThan(0));
  });

  it("give the same empty map each time, so a consumer's identity check holds", () => {
    countingPillarRequests();

    const first = renderHook(() => usePillarNames());
    const second = renderHook(() => usePillarNames());

    expect(first.result.current).toBe(second.result.current);
  });

  it("are asked for again after a failure, rather than staying broken for the session", async () => {
    // **A rejected promise must not be remembered.** Keeping it would make one bad moment
    // permanent: every screen opened afterwards would show title-cased ids until a reload.
    const failing = countingPillarRequests(() => HttpResponse.error());
    const { result } = renderHook(() => usePillarNames());
    await waitFor(() => expect(failing.asked).toBe(1));
    await waitFor(() => expect(result.current.size).toBe(0));

    const recovered = countingPillarRequests();
    renderHook(() => usePillarNames());

    await waitFor(() => expect(recovered.asked).toBe(1));
  });

  it("are forgotten on request, so one test cannot answer for the next", async () => {
    const seen = countingPillarRequests();
    const first = renderHook(() => usePillarNames());
    await waitFor(() => expect(first.result.current.size).toBeGreaterThan(0));

    forgetPillarNames();
    renderHook(() => usePillarNames());

    await waitFor(() => expect(seen.asked).toBe(2));
  });
});
