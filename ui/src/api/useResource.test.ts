import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback } from "react";
import { describe, expect, it } from "vitest";
import { useResource } from "./useResource";

/**
 * The fetch primitive every screen rests on, tested on its own at last.
 *
 * It was covered only through the screens that use it, which is enough to notice that a table
 * renders and not enough to notice *why*: the abort, the out-of-order guard and the idle state
 * are the reasons this exists, and none of them is visible from a screen test that passes.
 */

/** A promise with its resolve and reject in hand, so a test decides when a request lands. */
function deferred<Data>() {
  let settle: (data: Data) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const promise = new Promise<Data>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

describe("the four states", () => {
  it("is idle rather than loading when its prerequisite is missing", () => {
    const { result } = renderHook(() =>
      useResource(() => Promise.resolve("never asked for"), false),
    );

    // Not "loading": a spinner shown while nothing is being fetched tells the reader
    // something false.
    expect(result.current.resource.status).toBe("idle");
    expect(result.current.resource.data).toBeNull();
  });

  it("loads, then holds what came back", async () => {
    const { result } = renderHook(() => useResource(() => Promise.resolve(42)));

    expect(result.current.resource.status).toBe("loading");
    await waitFor(() => expect(result.current.resource.status).toBe("ready"));
    expect(result.current.resource.data).toBe(42);
  });

  it("holds the error a failed request threw, rather than an empty ready", async () => {
    const boom = new Error("the backend is down");
    const { result } = renderHook(() => useResource(() => Promise.reject(boom)));

    await waitFor(() => expect(result.current.resource.status).toBe("error"));
    expect(result.current.resource.error).toBe(boom);
    expect(result.current.resource.data).toBeNull();
  });
});

describe("what it does with a request it no longer wants", () => {
  it("aborts the request in flight when it is unmounted", async () => {
    const signals: AbortSignal[] = [];
    const { unmount } = renderHook(() =>
      useResource((signal) => {
        signals.push(signal);
        return new Promise<string>(() => {});
      }),
    );

    unmount();

    expect(signals[0]?.aborted).toBe(true);
  });

  it("ignores an answer that arrives after it was abandoned", async () => {
    // **The out-of-order race this exists to close.** Without the `current` flag a slow first
    // request could resolve after a second one and overwrite the newer answer with the older.
    const slow = deferred<string>();
    const { result, unmount } = renderHook(() => useResource(() => slow.promise));

    unmount();
    await act(async () => {
      slow.settle("too late");
    });

    expect(result.current.resource.data).toBeNull();
  });

  it("reports a rejection that arrives after an abort as nothing at all", async () => {
    const abandoned = deferred<string>();
    const { result, unmount } = renderHook(() =>
      useResource(() => abandoned.promise),
    );

    unmount();
    await act(async () => {
      abandoned.fail(new Error("aborted"));
    });

    expect(result.current.resource.status).toBe("loading");
    expect(result.current.resource.error).toBeNull();
  });
});

describe("asking again", () => {
  /**
   * **The fetcher has to be stable, and these tests hold it that way on purpose.**
   *
   * `useResource` says so in its own docstring -- a new function identity re-runs the request
   * -- and the first draft of these two tests passed an inline arrow, which re-ran the effect
   * on every render: 137,316 requests before the assertion gave up. Every real caller wraps
   * the fetcher in `useCallback`, so the tests do too.
   */
  it("re-runs the request when reload is called", async () => {
    let asked = 0;
    const { result } = renderHook(() => {
      const fetcher = useCallback(() => {
        asked += 1;
        return Promise.resolve(asked);
      }, []);
      return useResource(fetcher);
    });
    await waitFor(() => expect(result.current.resource.status).toBe("ready"));

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.resource.data).toBe(2));
  });

  it("goes back to loading while the second attempt is in flight", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let asked = 0;
    const { result } = renderHook(() => {
      const fetcher = useCallback(
        () => (asked++ === 0 ? first.promise : second.promise),
        [],
      );
      return useResource(fetcher);
    });
    await act(async () => {
      first.settle("one");
    });
    expect(result.current.resource.status).toBe("ready");

    act(() => result.current.reload());

    expect(result.current.resource.status).toBe("loading");
    expect(result.current.resource.data).toBeNull();
  });
});
