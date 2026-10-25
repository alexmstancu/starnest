import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isUnreachable, whenAnswered } from "./reachability";
import type { Idle, Read } from "./read";

/**
 * One GET, as a `Read` (C01 M1).
 *
 * **The same resource read again keeps what is on screen**, marked `refresh: "running"`, until
 * the answer lands (PL-010); a re-read that fails keeps it as well, marked with the failure and
 * still dated when it was read (N3, P1-05). **Another resource -- a new `fetcher` identity --
 * is pending from its first render.** Kept across a set switch, the previous data would be the
 * old set's ranking under the new set's name, so the check is made while rendering rather than
 * one render later in an effect.
 *
 * `fetcher` must be stable (`useCallback`): its identity is the resource. `freshness` says
 * something elsewhere made the answer stale, and is not part of the request. `reload()`
 * resolves once a read begun after it has landed, however it went.
 */

type Fetcher<T> = (signal: AbortSignal) => Promise<T>;

/** The last read to land, with the request it answered. */
interface Answer<T> {
  readonly fetcher: Fetcher<T>;
  readonly freshness: number;
  readonly attempt: number;
  readonly read: Read<T>;
}

/** A `reload()` waiting for a read begun after the `after`th request. */
interface Waiting {
  readonly after: number;
  readonly resolve: () => void;
}

const IDLE: Idle = { state: "idle" };
const PENDING: Read<never> = { state: "pending" };

export function useRead<T>(
  fetcher: Fetcher<T>,
  { enabled = true, freshness = 0 }: { enabled?: boolean; freshness?: number } = {},
): { read: Read<T> | Idle; reload: () => Promise<void> } {
  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(0);
  const waiting = useRef<Waiting[]>([]);

  useEffect(() => {
    if (!enabled) {
      answerReloads(waiting.current, Infinity);
      return;
    }
    const request = ++started.current;
    const controller = new AbortController();
    let current = true;
    const land = (outcome: (previous: Answer<T> | null) => Read<T>) => {
      // An abandoned request's answer, or its abort, is not news.
      if (!current) return;
      setAnswer((previous) => ({ fetcher, freshness, attempt, read: outcome(previous) }));
      answerReloads(waiting.current, request);
    };
    fetcher(controller.signal).then(
      (data) => land(() => ({ state: "ready", data, readAt: new Date(), refresh: "idle" })),
      (error: unknown) =>
        land((previous) =>
          previous?.fetcher === fetcher && previous.read.state === "ready"
            ? { ...previous.read, refresh: { failed: error } }
            : { state: "failed", error },
        ),
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [fetcher, enabled, freshness, attempt]);

  // Another resource, or none, starts again from pending: what was read belonged to the last.
  useEffect(() => () => setAnswer(null), [fetcher, enabled]);

  // Unmounted, nothing will land: a reload still waiting is answered rather than left hanging.
  useEffect(() => {
    const unanswered = waiting.current;
    return () => answerReloads(unanswered, Infinity);
  }, []);

  const read = useMemo((): Read<T> | Idle => {
    if (!enabled) return IDLE;
    if (answer?.fetcher !== fetcher) return PENDING;
    if (answer.freshness === freshness && answer.attempt === attempt) return answer.read;
    // A newer read of the same resource is under way.
    return answer.read.state === "ready" ? { ...answer.read, refresh: "running" } : PENDING;
  }, [answer, fetcher, enabled, freshness, attempt]);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push({ after: started.current, resolve });
        setAttempt((previous) => previous + 1);
      }),
    [],
  );

  // **The server did not answer: read again, once, when it next answers anything** (PL-002).
  const unanswered = unansweredError(read);
  // Before paint, so the region's own full card never flashes before the screen's (P1-06).
  useLayoutEffect(() => {
    if (unanswered === null) return;
    return whenAnswered(() => void reload());
  }, [unanswered, reload]);

  return { read, reload };
}

/** The failure, first or on refresh, if it was the server not answering. */
function unansweredError(read: Read<unknown> | Idle): unknown {
  const error =
    read.state === "failed"
      ? read.error
      : read.state === "ready" && typeof read.refresh === "object"
        ? read.refresh.failed
        : null;
  return isUnreachable(error) ? error : null;
}

/** Settles every reload waiting on a read begun before `request` began. */
function answerReloads(waiting: Waiting[], request: number): void {
  const answered = waiting.filter((waiter) => waiter.after < request);
  waiting.splice(0, waiting.length, ...waiting.filter((waiter) => waiter.after >= request));
  answered.forEach((waiter) => waiter.resolve());
}
