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

describe("the two switches a caller holds", () => {
  /**
   * `enabled` and `freshness` are the whole of this hook's API beyond the fetcher, and neither
   * was exercised: `enabled` is how a screen says "a prerequisite is missing, ask nothing",
   * and `freshness` is how it says "something elsewhere made this stale".
   */
  it("asks nothing while it is disabled, and says idle rather than loading", async () => {
    let asked = 0;
    const { result } = renderHook(() => {
      const fetcher = useCallback(() => {
        asked += 1;
        return Promise.resolve("a figure");
      }, []);
      return useResource(fetcher, false);
    });

    await waitFor(() => expect(result.current.resource.status).toBe("idle"));
    expect(asked).toBe(0);
  });

  it("asks as soon as the prerequisite arrives", async () => {
    // A spinner shown while nothing is being fetched tells the reader something false, so the
    // idle state is deliberately not "loading" -- and the flip to enabled has to start the
    // request, or a screen waits for ever on a prerequisite it already has.
    let asked = 0;
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        const fetcher = useCallback(() => {
          asked += 1;
          return Promise.resolve("a figure");
        }, []);
        return useResource(fetcher, enabled);
      },
      { initialProps: { enabled: false } },
    );
    await waitFor(() => expect(result.current.resource.status).toBe("idle"));

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.resource.status).toBe("ready"));
    expect(asked).toBe(1);
  });

  it("goes back to idle when the prerequisite disappears again", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        const fetcher = useCallback(() => Promise.resolve("a figure"), []);
        return useResource(fetcher, enabled);
      },
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.resource.status).toBe("ready"));

    rerender({ enabled: false });

    await waitFor(() => expect(result.current.resource.status).toBe("idle"));
    // Idle carries no data: holding the last answer would show a figure for a prerequisite
    // nobody has any more.
    expect(result.current.resource.data).toBeNull();
  });

  it("asks again when the freshness number changes", async () => {
    let asked = 0;
    const { result, rerender } = renderHook(
      ({ freshness }: { freshness: number }) => {
        const fetcher = useCallback(() => {
          asked += 1;
          return Promise.resolve(asked);
        }, []);
        return useResource(fetcher, true, freshness);
      },
      { initialProps: { freshness: 0 } },
    );
    await waitFor(() => expect(result.current.resource.data).toBe(1));

    rerender({ freshness: 1 });

    await waitFor(() => expect(result.current.resource.data).toBe(2));
  });

  it("does not ask again when the freshness number is unchanged", async () => {
    // **It is not part of the request.** A re-render that changes nothing must not re-fetch,
    // or every parent render costs a round trip.
    let asked = 0;
    const { result, rerender } = renderHook(
      ({ freshness }: { freshness: number }) => {
        const fetcher = useCallback(() => {
          asked += 1;
          return Promise.resolve(asked);
        }, []);
        return useResource(fetcher, true, freshness);
      },
      { initialProps: { freshness: 7 } },
    );
    await waitFor(() => expect(result.current.resource.status).toBe("ready"));

    rerender({ freshness: 7 });
    rerender({ freshness: 7 });

    expect(asked).toBe(1);
  });
});
