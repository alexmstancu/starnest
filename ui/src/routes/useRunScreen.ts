/**
 * What the Run screen does: estimate a run, start it, watch it, and go over part of it again.
 *
 * `reqs.md` 6.3 and 6.4. **The estimate comes before anything is fetched and is confirmed.** A
 * run that started on a click would be a run nobody chose to pay for -- and while every source
 * today is free, the confirmation is the mechanism the spend cap hangs off later.
 *
 * **One thing at a time.** `busy` names which act is in flight, because two runs started at
 * once would both write values and neither screen would be telling the truth about the other.
 */

import { useCallback, useState } from "react";
import {
  fetchRun,
  fetchRuns,
  planRun,
  retryRun,
  startRun,
  type Run,
  type RunDetail,
  type RunPlan,
} from "../api/endpoints";
import { useResource, type Resource } from "../api/useResource";

export type RunAct = "planning" | "running" | "retrying" | "asking";

export interface RunScreenState {
  plan: RunPlan | null;
  current: RunDetail | null;
  busy: RunAct | null;
  failure: unknown;
  history: Resource<{ items: Run[]; total: number }>;
  reloadHistory: () => void;
  dismissFailure: () => void;
  estimate: (levelId: string) => void;
  start: (levelId: string) => void;
  refresh: () => void;
  /** A new run over the part named: the sources that failed, or the items nobody answered. */
  again: (items: "failed" | "unanswered") => void;
  open: (run: Run) => void;
}

export function useRunScreen(): RunScreenState {
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [current, setCurrent] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState<RunAct | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const history = useResource(
    useCallback((signal: AbortSignal) => fetchRuns(10, { signal }), []),
  );

  const act = useCallback(
    async (what: RunAct, action: () => Promise<void>) => {
      setBusy(what);
      setFailure(null);
      try {
        await action();
        history.reload();
      } catch (error) {
        setFailure(error);
      } finally {
        setBusy(null);
      }
    },
    [history],
  );

  const watch = useCallback(async (run: Run) => {
    setCurrent(await fetchRun(run.id));
  }, []);

  return {
    plan,
    current,
    busy,
    failure,
    history: history.resource,
    reloadHistory: history.reload,
    dismissFailure: () => setFailure(null),
    estimate: (levelId) =>
      void act("planning", async () => {
        setCurrent(null);
        setPlan(await planRun({ level: levelId }));
      }),
    start: (levelId) =>
      void act("running", async () => {
        const started = await startRun({ level: levelId });
        setPlan(null);
        await watch(started);
      }),
    refresh: () =>
      void act("planning", async () => {
        if (current) setCurrent(await fetchRun(current.id));
      }),
    again: (items) =>
      void act(items === "failed" ? "retrying" : "asking", async () => {
        if (current) await watch(await retryRun(current.id, items));
      }),
    open: (run) => void watch(run),
  };
}
