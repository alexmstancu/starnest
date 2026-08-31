import { useCallback, useEffect, useState } from "react";

/**
 * One GET, with its loading, error and reload states.
 *
 * The shell reads five independent resources for the sidebar; without this each of them would
 * repeat the same four-state dance. Nothing here interprets what was fetched -- it is
 * plumbing, not policy.
 */

export type Resource<Data> =
  /** Nothing has been asked for, because a prerequisite is missing. Not the same as loading. */
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: Data; error: null }
  | { status: "error"; data: null; error: unknown };

export interface ResourceState<Data> {
  resource: Resource<Data>;
  reload: () => void;
}

const IDLE = { status: "idle", data: null, error: null } as const;
const LOADING = { status: "loading", data: null, error: null } as const;

/**
 * `fetcher` must be stable across renders -- wrap it in `useCallback` -- because a new
 * function identity re-runs the request.
 */
export function useResource<Data>(
  fetcher: (signal: AbortSignal) => Promise<Data>,
  enabled = true,
): ResourceState<Data> {
  const [resource, setResource] = useState<Resource<Data>>(enabled ? LOADING : IDLE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A spinner shown while nothing is being fetched tells the reader something false.
    if (!enabled) {
      setResource(IDLE);
      return;
    }

    const controller = new AbortController();
    let current = true;
    setResource(LOADING);

    fetcher(controller.signal)
      .then((data) => {
        if (current) setResource({ status: "ready", data, error: null });
      })
      .catch((error: unknown) => {
        if (current && !controller.signal.aborted) {
          setResource({ status: "error", data: null, error });
        }
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [fetcher, enabled, attempt]);

  const reload = useCallback(() => setAttempt((previous) => previous + 1), []);

  return { resource, reload };
}
