/**
 * What the Run screen does: estimate a run, start it, watch it, and go over part of it again.
 *
 * `reqs.md` 6.3 and 6.4. **The estimate comes before anything is fetched and is confirmed.** A
 * run that started on a click would be a run nobody chose to pay for -- and while every source
 * today is free, the confirmation is the mechanism the spend cap hangs off later.
 *
 * **One thing at a time.** `busy` names which act is in flight, because two runs started at
 * once would both write values and neither screen would be telling the truth about the other.
 * Acts can still overlap -- Refresh stays live while a stop is written -- so the label is the
 * newest act still going, and lasts as long as that act does.
 *
 * **The card shows the run the reader chose last** (`useWatchedRun.ts`): every act that reads a
 * run back takes a ticket on the click, and the opening view gives way to all of them. A read
 * the reader has left neither changes the card nor reports its failure.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchEveryRun,
  fetchRun,
  fetchSettings,
  planRun,
  startRun,
  stopRun,
  type Run,
  type RunDetail,
  type RunPlan,
  type RunScope,
} from "../../api/endpoints";
import { newestRun } from "./databaseHolds";
import { type Commitment, describeCommitment } from "./spendCommitment";
import { UNCLAIMED, useWatchedRun } from "./useWatchedRun";
import { useResource, type Resource } from "../../api/useResource";

export type RunAct = "planning" | "running" | "opening" | "stopping";
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
  /**
   * Whether a stop of `runId` is still in flight, until it has been read back -- whatever act
   * is newest, which is all `busy` can say (NEW-52).
   */
  isStopping: (runId: number) => boolean;
  failure: unknown;
  history: Resource<{ items: Run[]; total: number }>;
  /**
   * Every run as last read: kept while the history is read again, so what is drawn from it --
   * and what the reader chose there -- stays on screen (NEW-11). Null until the first read.
   */
  runs: Run[] | null;
  reloadHistory: () => void;
  dismissFailure: () => void;
  estimate: (levelId: string) => void;
  start: (levelId: string) => void;
  refresh: () => void;
  /** Put the run away. It stays in the history; this is the screen's view of it, not the run. */
  close: () => void;
  /**
   * Ask the run on screen to stop. **Nothing it completed is lost** -- the loop reads the
   * request between sources, so it ends when the fetch in flight finishes.
   */
  stop: () => void;
  /**
   * Estimate a scoped run and arm it. **Scoped rather than a retry**, because
   * `POST /{runId}/retry` takes only `failed | unanswered` over a whole run -- anything
   * narrower has to go through `/plan` and then `POST /data-acquisition-runs`.
   */
  propose: (scope: RunScope, act: string, origin: GapKind) => void;
  /** Start the armed run. Only reachable once something has been armed. */
  commit: () => void;
  cancel: () => void;
  open: (run: Run) => void;
}

export function useRunScreen(): RunScreenState {
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [planOrigin, setPlanOrigin] = useState<GapKind | null>(null);
  const { current, claim, reclaim, isCurrent, show, clear, unclaimed } =
    useWatchedRun();
  const [busy, setBusy] = useState<RunAct | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [armed, setArmed] = useState<ArmedRun | null>(null);
  // Every act still going, oldest first. The label is the newest of them, so the first act to
  // end no longer clears the label of one still going (NEW-10).
  const going = useRef<{ what: RunAct }[]>([]);
  // **The runs a stop is in flight for, until it has been read back** (NEW-52). Not `busy`,
  // which names only the newest act: a refresh sent while a stop was written took the label, and
  // Stop was offered again until the refresh had read the run back.
  const [stopsInFlight, setStopsInFlight] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  // Every run, not the newest ten: the history, the diff's choices and the month's spend all
  // read this list as every run there has been (UI-17).
  const history = useResource(
    useCallback((signal: AbortSignal) => fetchEveryRun({ signal }), []),
  );

  const act = useCallback(
    async (what: RunAct, action: () => Promise<void>) => {
      const mine = { what };
      going.current = [...going.current, mine];
      setBusy(what);
      setFailure(null);
      try {
        await action();
        history.reload();
      } catch (error) {
        setFailure(error);
      } finally {
        going.current = going.current.filter((each) => each !== mine);
        setBusy(going.current.at(-1)?.what ?? null);
      }
    },
    [history],
  );

  /**
   * Reads a run back, and shows it if the reader is still waiting on the act that asked.
   *
   * **A read the reader has left fails as quietly as it answers** (UI-04): its answer is not
   * shown, so its failure is not reported either -- it is about a run nobody is waiting on, and
   * it would stand over the one they chose. Only the read is forgiven: a start or a stop the
   * server refused is the act's own request, and reports whatever was opened meanwhile.
   */
  const watch = useCallback(
    async (ticket: number, runId: number) => {
      try {
        show(ticket, await fetchRun(runId));
      } catch (error) {
        if (isCurrent(ticket)) throw error;
      }
    },
    [show, isCurrent],
  );

  /**
   * **A refused start hands the card back** (NEW-49). A start takes the newest ticket on the
   * click and, refused, reads nothing back -- so a stop answered meanwhile had its own read
   * dropped, and the card went on offering Stop for a run already stopping. While the start is
   * still the reader's newest act, the run on the card is read again before the refusal is
   * reported; a read that fails then must not take the refusal's place.
   */
  const giveTheCardBack = useCallback(
    async (ticket: number, onCard: number | undefined, refused: unknown): Promise<never> => {
      if (onCard !== undefined && isCurrent(ticket)) {
        await watch(claim(onCard), onCard).catch(() => undefined);
      }
      throw refused;
    },
    [claim, isCurrent, watch],
  );

  /**
   * **The last acquisition opens by itself, once.**
   *
   * The screen's three remedies are about what the last acquisition left behind, and a
   * reader arriving here to retry a failure should not have to find the run in the history
   * and open it before the screen will say there was one. `opened` is a ref rather than
   * state so that closing a run, or opening an older one, is not undone on the next render:
   * this is the opening view, not a rule about what must stay open.
   *
   * **It gives way to the reader, and never claims.** An act taken before the history arrived
   * -- a run started while the list was slow -- is what the reader chose, so the opening view
   * is skipped; and anything clicked while it is still reading outranks its answer.
   */
  const opened = useRef(false);
  const runs = history.resource.status === "ready" ? history.resource.data.items : null;
  useEffect(() => {
    if (opened.current || runs === null) return;
    opened.current = true;
    const newest = newestRun(runs);
    if (newest === undefined || !unclaimed()) return;
    // **Silent if it fails.** Nobody asked for this read -- it is the opening view -- so a
    // banner about it would report a failure the reader did not cause. Opening a run from
    // the history is an act, and that one reports.
    void watch(UNCLAIMED, newest.id).catch(() => undefined);
  }, [runs, watch, unclaimed]);

  /**
   * **The runs as last read, kept while they are read again** (NEW-11). Every act reads the
   * history again as it ends, and a re-read has no list until it answers -- so the diff, drawn
   * from the list, left the screen and came back with nothing chosen. A run is never deleted, so
   * the list read last stays true until the next one lands; the history table still says it is
   * reading, and still reports a re-read that failed.
   */
  const [lastRuns, setLastRuns] = useState<Run[] | null>(null);
  if (runs !== null && runs !== lastRuns) setLastRuns(runs);

  return {
    plan,
    planOrigin,
    armed,
    current,
    busy,
    isStopping: (runId) => stopsInFlight.has(runId),
    failure,
    history: history.resource,
    runs: runs ?? lastRuns,
    reloadHistory: history.reload,
    dismissFailure: () => setFailure(null),
    estimate: (levelId) =>
      void act("planning", async () => {
        setArmed(null);
        setPlanOrigin("everything");
        setPlan(await planRun({ level: levelId }));
      }),
    // **Every act that reads a run back claims on the click**, before its first await, so a
    // read already on its way when the reader acts again can never land over the newer choice.
    start: (levelId) => {
      const ticket = claim();
      const onCard = current?.id;
      void act("running", async () => {
        const started = await startRun({ level: levelId }).catch((refused: unknown) =>
          giveTheCardBack(ticket, onCard, refused),
        );
        setPlan(null);
        setPlanOrigin(null);
        await watch(ticket, started.id);
      });
    },
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
    commit: () => {
      if (!armed) return;
      const ticket = claim();
      const onCard = current?.id;
      void act("running", async () => {
        // Going uncapped is only ever accepted because the strip said so in as many words.
        const started = await startRun({
          ...armed.scope,
          accept_uncapped_spend: armed.commitment.uncapped,
        }).catch((refused: unknown) => giveTheCardBack(ticket, onCard, refused));
        setArmed(null);
        await watch(ticket, started.id);
      });
    },
    cancel: () => {
      setArmed(null);
      setPlan(null);
      setPlanOrigin(null);
    },
    refresh: () => {
      if (!current) return;
      const ticket = claim(current.id);
      void act("opening", () => watch(ticket, current.id));
    },
    close: clear,
    stop: () => {
      if (!current) return;
      const ticket = claim(current.id);
      setStopsInFlight((runs) => new Set(runs).add(current.id));
      void act("stopping", async () => {
        try {
          // The 202 carries the run back, so `stop_requested_at` is on screen immediately
          // rather than after the next poll -- which is what lets the card explain why the
          // button has gone before the run has actually ended.
          const stopped = await stopRun(current.id);
          // **Claimed again now the stop is written** (NEW-49): a refresh sent meanwhile may
          // have read the run before it was, and standing over this read it would offer Stop
          // again.
          await watch(reclaim(ticket, current.id), stopped.id);
        } finally {
          setStopsInFlight((runs) => {
            const left = new Set(runs);
            left.delete(current.id);
            return left;
          });
        }
      });
    },
    // Through `act` like everything else. A backend that is down or a run that cannot be read
    // now says so, where before the promise rejected into nothing and the click looked ignored.
    open: (run) => {
      const ticket = claim(run.id);
      void act("opening", () => watch(ticket, run.id));
    },
  };
}
