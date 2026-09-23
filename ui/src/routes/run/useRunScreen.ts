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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchRun,
  fetchRuns,
  fetchSettings,
  planRun,
  retryRun,
  startRun,
  type Run,
  type RunDetail,
  type RunPlan,
  type RunScope,
} from "../../api/endpoints";
import { newestRun } from "./databaseHolds";
import { type Commitment, describeCommitment } from "./spendCommitment";
import { useResource, type Resource } from "../../api/useResource";

export type RunAct =
  | "planning"
  | "running"
  | "retrying"
  | "asking"
  | "opening";
/**
 * `opening` covers reading a run back: opening one from the history, and refreshing the one on
 * screen. Both used to be something else -- refreshing claimed to be `planning`, which relabelled
 * the *Estimate* button "Estimating…", and opening claimed nothing at all because it ran outside
 * `act` entirely (P45).
 */

/**
 * Which of the screen's three remedies raised an estimate.
 *
 * **The estimate belongs to the card that asked for it.** Three remedies stand side by side,
 * and a single panel underneath them saying "this would cost €0.32" cannot say which of the
 * three it is about -- a reader who clicked *Retry* reads the figure for *Ask again* and has
 * no way to tell.
 */
export type GapKind = "failed" | "unanswered" | "everything";

/**
 * A run that has been estimated and is waiting to be agreed to.
 *
 * **Nothing that can spend fires on a click.** The estimate panel already showed items, paid
 * calls and a cost ceiling; what was missing was a step between reading that and it
 * happening. A run is the only thing here that spends money and the only one a weight change
 * cannot undo.
 */
export interface ArmedRun {
  scope: RunScope;
  plan: RunPlan;
  commitment: Commitment;
  origin: GapKind;
}

export interface RunScreenState {
  plan: RunPlan | null;
  /** Which card the estimate belongs to, so it can be shown inside that one. */
  planOrigin: GapKind | null;
  /** The run awaiting a yes, or null when nothing is armed. */
  armed: ArmedRun | null;
  current: RunDetail | null;
  busy: RunAct | null;
  failure: unknown;
  history: Resource<{ items: Run[]; total: number }>;
  reloadHistory: () => void;
  dismissFailure: () => void;
  estimate: (levelId: string) => void;
  start: (levelId: string) => void;
  refresh: () => void;
  /** Put the run away. It stays in the history; this is the screen's view of it, not the run. */
  close: () => void;
  /**
   * Estimate a scoped run and arm it. **Scoped rather than a retry**, because
   * `POST /{runId}/retry` takes only `failed | unanswered` over a whole run -- anything
   * narrower has to go through `/plan` and then `POST /data-acquisition-runs`.
   */
  propose: (scope: RunScope, act: string, origin: GapKind) => void;
  /** Start the armed run. Only reachable once something has been armed. */
  commit: () => void;
  cancel: () => void;
  /** A new run over the part named: the sources that failed, or the items nobody answered. */
  again: (items: "failed" | "unanswered") => void;
  open: (run: Run) => void;
}

export function useRunScreen(): RunScreenState {
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [planOrigin, setPlanOrigin] = useState<GapKind | null>(null);
  const [current, setCurrent] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState<RunAct | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [armed, setArmed] = useState<ArmedRun | null>(null);

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

  /**
   * **The last acquisition opens by itself, once.**
   *
   * The screen's three remedies are about what the last acquisition left behind, and a
   * reader arriving here to retry a failure should not have to find the run in the history
   * and open it before the screen will say there was one. `opened` is a ref rather than
   * state so that closing a run, or opening an older one, is not undone on the next render:
   * this is the opening view, not a rule about what must stay open.
   */
  const opened = useRef(false);
  const runs = history.resource.status === "ready" ? history.resource.data.items : null;
  useEffect(() => {
    if (opened.current || runs === null) return;
    opened.current = true;
    const newest = newestRun(runs);
    if (newest === undefined) return;
    // **Silent if it fails.** Nobody asked for this read -- it is the opening view -- so a
    // banner about it would report a failure the reader did not cause. Opening a run from
    // the history is an act, and that one reports.
    void watch(newest).catch(() => undefined);
  }, [runs, watch]);

  return {
    plan,
    planOrigin,
    armed,
    current,
    busy,
    failure,
    history: history.resource,
    reloadHistory: history.reload,
    dismissFailure: () => setFailure(null),
    estimate: (levelId) =>
      void act("planning", async () => {
        setArmed(null);
        setPlanOrigin("everything");
        setPlan(await planRun({ level: levelId }));
      }),
    start: (levelId) =>
      void act("running", async () => {
        const started = await startRun({ level: levelId });
        setPlan(null);
        setPlanOrigin(null);
        await watch(started);
      }),
    propose: (scope, what, origin) =>
      void act("planning", async () => {
        setPlan(null);
        setPlanOrigin(null);
        const planned = await planRun(scope);
        // The cap is read at the moment of arming, not cached: it is a setting somebody may
        // have just changed, and a stale ceiling in a confirmation is worse than none.
        const settings = await fetchSettings();
        setArmed({
          scope,
          plan: planned,
          origin,
          commitment: describeCommitment({
            act: what,
            itemsTotal: planned.items_total,
            llmCallCount: planned.llm_call_count,
            estimatedCostEur: planned.estimated_cost_eur,
            capEur: settings.run_spend_cap_eur,
          }),
        });
      }),
    commit: () =>
      void act("running", async () => {
        if (!armed) return;
        // Going uncapped is only ever accepted because the strip said so in as many words.
        const started = await startRun({
          ...armed.scope,
          accept_uncapped_spend: armed.commitment.uncapped,
        });
        setArmed(null);
        await watch(started);
      }),
    cancel: () => {
      setArmed(null);
      setPlan(null);
      setPlanOrigin(null);
    },
    refresh: () =>
      void act("opening", async () => {
        if (current) setCurrent(await fetchRun(current.id));
      }),
    close: () => setCurrent(null),
    again: (items) =>
      void act(items === "failed" ? "retrying" : "asking", async () => {
        if (current) await watch(await retryRun(current.id, items));
      }),
    // Through `act` like everything else. A backend that is down or a run that cannot be read
    // now says so, where before the promise rejected into nothing and the click looked ignored.
    open: (run) => void act("opening", () => watch(run)),
  };
}
