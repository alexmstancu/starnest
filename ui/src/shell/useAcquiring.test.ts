import { act, renderHook } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockServer } from "../mocks/server";
import { useAcquiring } from "./useAcquiring";

/**
 * PL-132: how often the shell asks for the run list. Every 30 s while nothing runs; every 2 s
 * while a run is in flight, or just after one was started.
 */

const BASE = "/v1";
const RUN = { id: 42, triggered_by: "user", started_at: "2026-09-21T09:00:00Z", cost_eur: 0 };

function runsAre(
  status: "running" | "completed" | "failing" | "unanswered",
): { looks: number } {
  const counter = { looks: 0 };
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs`, () => {
      counter.looks += 1;
      if (status === "failing") return new HttpResponse("Internal Server Error", { status: 500 });
      if (status === "unanswered") return HttpResponse.error();
      return HttpResponse.json({ items: [{ ...RUN, run_status: status }], total: 1 });
    }),
    http.get(`${BASE}/data-acquisition-runs/:runId`, () =>
      HttpResponse.json({ ...RUN, run_status: "running", progress: {}, failures: [] }),
    ),
  );
  return counter;
}

async function wait(ms: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("how often the shell looks at the runs", () => {
  it("looks every 30 seconds while nothing runs", async () => {
    const runs = runsAre("completed");
    renderHook(() => useAcquiring(() => {}, 0));
    await wait(0);
    expect(runs.looks).toBe(1);

    await wait(2_500);
    expect(runs.looks).toBe(1);

    await wait(28_000);
    expect(runs.looks).toBe(2);
  });

  it("looks every 2 seconds while a run is in flight", async () => {
    const runs = runsAre("running");
    renderHook(() => useAcquiring(() => {}, 0));
    await wait(0);
    expect(runs.looks).toBe(1);

    await wait(2_100);
    expect(runs.looks).toBe(2);
    await wait(2_100);
    expect(runs.looks).toBe(3);
  });

  it("looks at once when told a run has just started, then every 2 seconds for a while", async () => {
    const runs = runsAre("completed");
    const { rerender } = renderHook(({ started }) => useAcquiring(() => {}, started), {
      initialProps: { started: 0 },
    });
    await wait(0);
    expect(runs.looks).toBe(1);

    rerender({ started: 1 });
    await wait(0);
    expect(runs.looks).toBe(2);

    await wait(2_100);
    expect(runs.looks).toBe(3);
  });

  it("goes back to 30 seconds once a start turned up no run", async () => {
    const runs = runsAre("completed");
    const { rerender } = renderHook(({ started }) => useAcquiring(() => {}, started), {
      initialProps: { started: 0 },
    });
    await wait(0);
    rerender({ started: 1 });
    await wait(15_000);
    const afterTheWindow = runs.looks;

    await wait(10_000);
    expect(runs.looks).toBe(afterTheWindow);
    await wait(20_000);
    expect(runs.looks).toBe(afterTheWindow + 1);
  });

  it("waits 30 seconds after a look that failed when nothing was seen running", async () => {
    const runs = runsAre("failing");
    renderHook(() => useAcquiring(() => {}, 0));
    await wait(0);
    expect(runs.looks).toBe(1);

    await wait(2_500);
    expect(runs.looks).toBe(1);
    await wait(28_000);
    expect(runs.looks).toBe(2);
  });

  it("looks every 2 seconds while the server does not answer, to see it come back (PL-002)", async () => {
    const runs = runsAre("unanswered");
    renderHook(() => useAcquiring(() => {}, 0));
    await wait(0);
    expect(runs.looks).toBe(1);

    await wait(2_100);
    expect(runs.looks).toBe(2);
  });

  it("stops looking once unmounted", async () => {
    const runs = runsAre("running");
    const { unmount } = renderHook(() => useAcquiring(() => {}, 0));
    await wait(0);
    unmount();

    await wait(60_000);
    expect(runs.looks).toBe(1);
  });
});

/**
 * PL-015. **A run that started and finished between two looks still ended**: it was never seen
 * running, and what it stored makes every open view stale all the same.
 */
describe("a run nobody saw running", () => {
  it("is reported as ended once a look finds it, newer than the last look's newest", async () => {
    let newest = 42;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({
          items: [{ ...RUN, id: newest, run_status: "completed" }],
          total: 1,
        }),
      ),
    );
    const ended = vi.fn();
    renderHook(() => useAcquiring(ended, 0));
    await wait(0);
    expect(ended).not.toHaveBeenCalled();

    newest = 43;
    await wait(30_000);
    expect(ended).toHaveBeenCalledTimes(1);

    await wait(30_000);
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
