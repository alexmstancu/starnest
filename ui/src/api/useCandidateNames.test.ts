/**
 * That candidate names are fetched once, so no screen prints `country.malta`.
 *
 * A `Ranking` carries a name beside every candidate, which is why the table never needed this.
 * A stored value, an acquisition failure and a comparison row carry the id alone, and those
 * three screens were printing it.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { forgetCandidateNames, useCandidateNames } from "./useCandidateNames";

/** Counts the requests that actually reach the network, whatever the handler then answers. */
function countingCandidateRequests(answer?: () => Response): { asked: number } {
  const seen = { asked: 0 };
  mockServer.use(
    http.get("/v1/candidates", () => {
      seen.asked += 1;
      return (
        answer?.() ??
        HttpResponse.json({
          items: [
            { id: "country.malta", name: "Malta", level: "country" },
            { id: "country.portugal", name: "Portugal", level: "country" },
          ],
        })
      );
    }),
  );
  return seen;
}

describe("the candidate names", () => {
  it("come back keyed by id", async () => {
    countingCandidateRequests();

    const { result } = renderHook(() => useCandidateNames());

    await waitFor(() => expect(result.current.get("country.malta")).toBe("Malta"));
    expect(result.current.get("country.portugal")).toBe("Portugal");
  });

  it("are fetched once however many components ask", async () => {
    const seen = countingCandidateRequests();

    const first = renderHook(() => useCandidateNames());
    const second = renderHook(() => useCandidateNames());

    await waitFor(() => expect(first.result.current.size).toBeGreaterThan(0));
    await waitFor(() => expect(second.result.current.size).toBeGreaterThan(0));
    expect(seen.asked).toBe(1);
  });

  it("are empty until they arrive, rather than guessed at", async () => {
    countingCandidateRequests();

    const { result } = renderHook(() => useCandidateNames());

    // The first render has nothing: `candidateName` falls back to the id without its level, which is a
    // decision taken in `format/` rather than a guess invented here.
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.size).toBeGreaterThan(0));
  });

  it("give the same empty map each time, so a consumer's identity check holds", () => {
    countingCandidateRequests();

    const first = renderHook(() => useCandidateNames());
    const second = renderHook(() => useCandidateNames());

    expect(first.result.current).toBe(second.result.current);
  });

  it("are asked for again after a failure, rather than staying broken for the session", async () => {
    // **A rejected promise must not be remembered.** Keeping it would make one bad moment
    // permanent: every screen opened afterwards would show title-cased ids until a reload.
    const failing = countingCandidateRequests(() => HttpResponse.error());
    const { result } = renderHook(() => useCandidateNames());
    await waitFor(() => expect(failing.asked).toBe(1));
    await waitFor(() => expect(result.current.size).toBe(0));

    const recovered = countingCandidateRequests();
    renderHook(() => useCandidateNames());

    await waitFor(() => expect(recovered.asked).toBe(1));
  });

  it("are forgotten on request, so one test cannot answer for the next", async () => {
    const seen = countingCandidateRequests();
    const first = renderHook(() => useCandidateNames());
    await waitFor(() => expect(first.result.current.size).toBeGreaterThan(0));

    forgetCandidateNames();
    renderHook(() => useCandidateNames());

    await waitFor(() => expect(seen.asked).toBe(2));
  });
});
