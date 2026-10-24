import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Idle, Read } from "./read";
import { useRead } from "./useRead";

/**
 * The read every screen is to rest on (C01 M1), tested on its own.
 *
 * **Its one dangerous mistake is keeping data across a change of resource.** Reading the same
 * resource again keeps what is on screen while the answer is awaited (PL-010); reading another
 * one must never show the previous one's data, or a set switch draws the old set's ranking
 * under the new set's name. Where that matters every render is recorded, because the fault
 * would live in one render and be gone by the time a test looked at the last.
 *
 * **Fetchers are held stable with `useCallback`**, as every caller holds them: a new identity
 * is a new resource, which is the whole contract.
 */

const READ_AT = new Date("2026-10-24T13:14:00Z");
const LATER = new Date("2026-10-24T13:20:00Z");
const BOOM = new Error("the server is down");

afterEach(() => {
  vi.useRealTimers();
});

/** A promise with its resolve and reject in hand, so a test decides when a request lands. */
function deferred<T>() {
  let settle: (data: T) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

/**
 * The requests the hook will make, in order, each settled by the test when it chooses. A
 * request beyond the ones arranged is a bug in the hook, so it says so out loud.
 */
function requestQueue(count: number) {
  const requests = Array.from({ length: count }, () => ({
    ...deferred<string>(),
    signal: null as AbortSignal | null,
  }));
  let taken = 0;
  return {
    request: (index: number) => requests[index]!,
    taken: () => taken,
    fetcher: (signal: AbortSignal) => {
      const next = requests[taken];
      if (!next) return Promise.reject(new Error(`asked ${taken + 1} times, not ${count}`));
      taken += 1;
      next.signal = signal;
      return next.promise;
    },
  };
}

type Queue = ReturnType<typeof requestQueue>;

function renderOn(requests: Queue, options: { enabled?: boolean; freshness?: number } = {}) {
  return renderHook(
    ({ enabled, freshness }: { enabled?: boolean; freshness?: number }) =>
      useRead(
        useCallback((signal: AbortSignal) => requests.fetcher(signal), []),
        { enabled, freshness },
      ),
    { initialProps: options },
  );
}

function dataOf(read: Read<string> | Idle): string | undefined {
  return read.state === "ready" ? read.data : undefined;
}

describe("a first read", () => {
  it("is pending, then ready with what came back and the time it was read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(READ_AT);
    const requests = requestQueue(1);
    const { result } = renderOn(requests);

    expect(result.current.read).toEqual({ state: "pending" });

    await act(async () => requests.request(0).settle("figures"));

    expect(result.current.read).toEqual({
      state: "ready",
      data: "figures",
      readAt: READ_AT,
      refresh: "idle",
    });
  });

  it("fails with the error and no data", async () => {
    const requests = requestQueue(1);
    const { result } = renderOn(requests);

    await act(async () => requests.request(0).fail(BOOM));

    expect(result.current.read).toEqual({ state: "failed", error: BOOM });
  });

  it("is idle, and asks nothing, while its prerequisite is missing", async () => {
    const requests = requestQueue(0);
    const { result } = renderOn(requests, { enabled: false });

    await act(async () => {});

    expect(result.current.read).toEqual({ state: "idle" });
    expect(requests.taken()).toBe(0);
  });
});

describe("reading the same resource again (PL-010)", () => {
  it("keeps what it read, marked running, until reload's answer replaces it", async () => {
    const requests = requestQueue(2);
    const { result } = renderOn(requests);
    await act(async () => requests.request(0).settle("first figures"));

    act(() => void result.current.reload());

    expect(result.current.read).toMatchObject({ data: "first figures", refresh: "running" });

    await act(async () => requests.request(1).settle("second figures"));

    expect(result.current.read).toMatchObject({ data: "second figures", refresh: "idle" });
  });

  it("keeps what it read, marked running, while a new freshness reads again", async () => {
    const requests = requestQueue(2);
    const { result, rerender } = renderOn(requests, { freshness: 0 });
    await act(async () => requests.request(0).settle("first figures"));

    rerender({ freshness: 1 });

    expect(result.current.read).toMatchObject({ data: "first figures", refresh: "running" });
    await act(async () => requests.request(1).settle("second figures"));
    expect(result.current.read).toMatchObject({ data: "second figures", refresh: "idle" });
  });

  it("asks nothing when the freshness is unchanged", async () => {
    const requests = requestQueue(1);
    const { rerender } = renderOn(requests, { freshness: 7 });
    await act(async () => requests.request(0).settle("figures"));

    rerender({ freshness: 7 });
    rerender({ freshness: 7 });

    expect(requests.taken()).toBe(1);
  });

  it("keeps the data and the time it was read when the re-read fails (P1-05)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(READ_AT);
    const requests = requestQueue(2);
    const { result } = renderOn(requests);
    await act(async () => requests.request(0).settle("figures"));
    vi.setSystemTime(LATER);

    act(() => void result.current.reload());
    await act(async () => requests.request(1).fail(BOOM));

    expect(result.current.read).toEqual({
      state: "ready",
      data: "figures",
      readAt: READ_AT,
      refresh: { failed: BOOM },
    });
  });

  it("tries again after a failed refresh with the data still shown", async () => {
    const requests = requestQueue(3);
    const { result } = renderOn(requests);
    await act(async () => requests.request(0).settle("figures"));
    act(() => void result.current.reload());
    await act(async () => requests.request(1).fail(BOOM));

    act(() => void result.current.reload());

    expect(result.current.read).toMatchObject({ data: "figures", refresh: "running" });
    await act(async () => requests.request(2).settle("new figures"));
    expect(result.current.read).toMatchObject({ data: "new figures", refresh: "idle" });
  });

  it("reads from pending again after a first read that failed, having nothing to keep", async () => {
    const requests = requestQueue(2);
    const { result } = renderOn(requests);
    await act(async () => requests.request(0).fail(BOOM));

    act(() => void result.current.reload());

    expect(result.current.read).toEqual({ state: "pending" });
  });
});

describe("reading another resource", () => {
  /** Two sets, each with its own fetcher, and every render of the hook as it happened. */
  function renderSwitchingSets() {
    const answers = { a: deferred<string>(), b: deferred<string>() };
    const signals: Record<string, AbortSignal> = {};
    const renders: { set: "a" | "b"; read: Read<string> | Idle }[] = [];
    const hook = renderHook(
      ({ set }: { set: "a" | "b" }) => {
        const fetcher = useCallback(
          (signal: AbortSignal) => {
            signals[set] = signal;
            return answers[set].promise;
          },
          [set],
        );
        const state = useRead(fetcher);
        renders.push({ set, read: state.read });
        return state;
      },
      { initialProps: { set: "a" as "a" | "b" } },
    );
    return { ...hook, answers, signals, renders };
  }

  it("goes to pending at once, and never shows the other set's data", async () => {
    const { result, rerender, answers, renders } = renderSwitchingSets();
    await act(async () => answers.a.settle("set A's ranking"));
    expect(dataOf(result.current.read)).toBe("set A's ranking");

    rerender({ set: "b" });

    const underB = renders.filter((render) => render.set === "b");
    expect(underB.length).toBeGreaterThan(0);
    expect(underB.map((render) => render.read)).toEqual(
      underB.map(() => ({ state: "pending" })),
    );
    await act(async () => answers.b.settle("set B's ranking"));
    expect(dataOf(result.current.read)).toBe("set B's ranking");
  });

  it("aborts the other set's request, and ignores its answer if it lands anyway", async () => {
    const { result, rerender, answers, signals } = renderSwitchingSets();
    await waitFor(() => expect(signals["a"]).toBeDefined());

    rerender({ set: "b" });
    await act(async () => answers.a.settle("set A's ranking"));

    expect(signals["a"]?.aborted).toBe(true);
    expect(result.current.read).toEqual({ state: "pending" });
  });
});

describe("reload, awaited", () => {
  it("resolves when the re-read lands, not before", async () => {
    const requests = requestQueue(2);
    const { result } = renderOn(requests);
    await act(async () => requests.request(0).settle("first figures"));
    let landed = false;

    act(() => void result.current.reload().then(() => (landed = true)));
    await act(async () => {});
    expect(landed).toBe(false);

    await act(async () => requests.request(1).settle("second figures"));
    expect(landed).toBe(true);
  });

  it("resolves when the re-read fails, too", async () => {
    const requests = requestQueue(2);
    const { result } = renderOn(requests);
    await act(async () => requests.request(0).settle("figures"));
    let landed = false;

    act(() => void result.current.reload().then(() => (landed = true)));
    await act(async () => requests.request(1).fail(BOOM));

    expect(landed).toBe(true);
  });

  it("is answered by a read begun after it, not by one already in flight", async () => {
    const requests = requestQueue(2);
    const { result } = renderOn(requests);
    let landed = false;

    await act(async () => {
      void result.current.reload().then(() => (landed = true));
      // The read already in flight lands before React has started the one reload asked for.
      requests.request(0).settle("read before the reload");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requests.taken()).toBe(2);
    expect(landed).toBe(false);

    await act(async () => requests.request(1).settle("read after the reload"));
    expect(landed).toBe(true);
    expect(dataOf(result.current.read)).toBe("read after the reload");
  });

  it("resolves at once while there is nothing to read", async () => {
    const requests = requestQueue(0);
    const { result } = renderOn(requests, { enabled: false });
    let landed = false;

    // Not `await act(() => reload())`: act awaits the promise before it runs the effect that
    // settles it, so that shape deadlocks in a test and never in a browser.
    act(() => void result.current.reload().then(() => (landed = true)));
    await act(async () => {});

    expect(landed).toBe(true);
    expect(result.current.read).toEqual({ state: "idle" });
  });

  it("resolves when unmounted before its read lands, rather than waiting for ever", async () => {
    const requests = requestQueue(2);
    const { result, unmount } = renderOn(requests);
    await act(async () => requests.request(0).settle("figures"));
    let landed = false;
    act(() => void result.current.reload().then(() => (landed = true)));

    unmount();
    await act(async () => {});

    expect(landed).toBe(true);
  });
});

describe("letting go", () => {
  it("aborts the request in flight when unmounted", () => {
    const requests = requestQueue(1);
    const { unmount } = renderOn(requests);

    unmount();

    expect(requests.request(0).signal?.aborted).toBe(true);
  });

  it("keeps the newer answer when the request it replaced lands afterwards", async () => {
    const requests = requestQueue(2);
    const { result } = renderOn(requests);
    await waitFor(() => expect(requests.taken()).toBe(1));
    act(() => void result.current.reload());

    await act(async () => requests.request(1).settle("the answer asked for"));
    await act(async () => requests.request(0).settle("the answer abandoned"));

    expect(dataOf(result.current.read)).toBe("the answer asked for");
  });

  it("reads under StrictMode, whose doubled effects abandon the first request", async () => {
    const requests = requestQueue(2);
    const { result } = renderHook(
      () => useRead(useCallback((signal: AbortSignal) => requests.fetcher(signal), [])),
      { wrapper: StrictMode },
    );

    await act(async () => requests.request(1).settle("figures"));

    expect(requests.request(0).signal?.aborted).toBe(true);
    expect(dataOf(result.current.read)).toBe("figures");
  });

  it("drops what it read when disabled, so enabling again reads from pending", async () => {
    const requests = requestQueue(2);
    const { result, rerender } = renderOn(requests, { enabled: true });
    await act(async () => requests.request(0).settle("figures"));

    rerender({ enabled: false });
    expect(result.current.read).toEqual({ state: "idle" });

    rerender({ enabled: true });
    expect(result.current.read).toEqual({ state: "pending" });
  });
});
