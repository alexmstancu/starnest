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
    const { result } = renderHook(() => {
      const fetcher = useCallback(() => Promise.resolve(42), []);
      return useResource(fetcher);
    });

    expect(result.current.resource.status).toBe("loading");
    await waitFor(() => expect(result.current.resource.status).toBe("ready"));
    expect(result.current.resource.data).toBe(42);
  });

  it("holds the error a failed request threw, rather than an empty ready", async () => {
    const boom = new Error("the backend is down");
    const { result } = renderHook(() => {
      const fetcher = useCallback(() => Promise.reject(boom), []);
      return useResource(fetcher);
    });

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

  /**
   * **These two stay mounted on purpose, and the first drafts did not.**
   *
   * Both used to `unmount()` and then settle the promise, which proves nothing at all:
   * React 18 makes `setState` on an unmounted component a silent no-op, so the hook's last
   * render is frozen whether the guard exists or not. Deleting the `current` flag *and* the
   * `!signal.aborted` check left all thirteen tests green.
   *
   * The race the hook exists to close needs a live component and two requests in flight: ask
   * again, let the **newer** request answer, and only then let the older one land. Without the
   * flag the stale answer overwrites the fresh one, which is a screen showing last candidate's
   * figures under this candidate's name.
   *
   * **Both wait for each request to be taken rather than assuming it has been**, via
   * `requests`. A first draft handed out promises from a counter and called `reload()` straight
   * after mounting, which assumes the mount request is already in flight -- true on an idle
   * machine, and it failed once in a full-suite run on a loaded one, where the stale answer won.
   * `vite.config.ts` says why that matters: a slow machine should make this suite slower and
   * not red. Draining a queue makes the ordering the test depends on something it checks, and
   * a request the hook never made is then a timeout naming the step rather than two promises
   * quietly swapping roles.
   */
  /** The requests the hook will make, in order, each settled by the test when it chooses. */
  function requestQueue(count: number) {
    const pending = Array.from({ length: count }, () => deferred<string>());
    const queue = [...pending];
    return {
      request: (index: number) => pending[index]!,
      taken: () => count - queue.length,
      /** A request beyond the ones arranged is a bug in the hook, so it says so out loud. */
      fetcher: () =>
        queue.shift()?.promise ??
        Promise.reject(new Error(`the hook asked ${count + 1} times, not ${count}`)),
    };
  }

  it("keeps the newer answer when a request it replaced resolves afterwards", async () => {
    const requests = requestQueue(2);
    const { result } = renderHook(() => {
      const fetcher = useCallback(() => requests.fetcher(), []);
      return useResource(fetcher);
    });

    // The first request has to be in flight *before* we ask again, or the two swap roles and
    // the test proves the opposite of what it says.
    await waitFor(() => expect(requests.taken()).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(requests.taken()).toBe(2));

    await act(async () => {
      requests.request(1).settle("the answer we asked for");
    });
    expect(result.current.resource.data).toBe("the answer we asked for");

    await act(async () => {
      requests.request(0).settle("the answer we abandoned");
    });

    expect(result.current.resource.data).toBe("the answer we asked for");
    expect(result.current.resource.status).toBe("ready");
  });

  it("keeps the newer answer when a request it replaced rejects afterwards", async () => {
    // The abandoned request rejects *because* it was aborted, so its failure is not news. An
    // unguarded `catch` would replace a perfectly good answer with an error notice -- which is
    // what every reload would look like if the second request won the race.
    const requests = requestQueue(2);
    const { result } = renderHook(() => {
      const fetcher = useCallback(() => requests.fetcher(), []);
      return useResource(fetcher);
    });

    await waitFor(() => expect(requests.taken()).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(requests.taken()).toBe(2));

    await act(async () => {
      requests.request(1).settle("the answer we asked for");
    });

    await act(async () => {
      requests
        .request(0)
        .fail(new DOMException("The operation was aborted.", "AbortError"));
    });

    expect(result.current.resource.status).toBe("ready");
    expect(result.current.resource.data).toBe("the answer we asked for");
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
