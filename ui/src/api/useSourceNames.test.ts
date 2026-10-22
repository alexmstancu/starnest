/**
 * UIR-G3. That the sources are named by the catalog, once for the page, and never guessed at.
 *
 * "What else would answer it" printed `world_bank` and `llm`: ids, where the catalog says
 * "World Bank" and "LLM with web search" (`format/display.ts`, no programmatic identifiers in
 * rendered text).
 */

import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { useSourceNames } from "./useSourceNames";

function countingSourceRequests(answer?: () => Response): { asked: number } {
  const seen = { asked: 0 };
  mockServer.use(
    http.get("/v1/data-sources", () => {
      seen.asked += 1;
      return (
        answer?.() ??
        HttpResponse.json({
          items: [
            { id: "world_bank", name: "World Bank" },
            { id: "llm", name: "LLM with web search" },
          ],
        })
      );
    }),
  );
  return seen;
}

describe("the source names", () => {
  it("come back keyed by id", async () => {
    countingSourceRequests();

    const { result } = renderHook(() => useSourceNames());

    await waitFor(() => expect(result.current.get("world_bank")).toBe("World Bank"));
    expect(result.current.get("llm")).toBe("LLM with web search");
  });

  it("are fetched once however many components ask", async () => {
    const seen = countingSourceRequests();

    const first = renderHook(() => useSourceNames());
    const second = renderHook(() => useSourceNames());

    await waitFor(() => expect(first.result.current.size).toBeGreaterThan(0));
    await waitFor(() => expect(second.result.current.size).toBeGreaterThan(0));
    expect(seen.asked).toBe(1);
  });

  it("are empty rather than guessed at when the catalog cannot be read", async () => {
    const seen = countingSourceRequests(() =>
      HttpResponse.json({ code: "unavailable", message: "down" }, { status: 503 }),
    );

    const { result } = renderHook(() => useSourceNames());

    await waitFor(() => expect(seen.asked).toBe(1));
    expect(result.current.size).toBe(0);
  });
});
