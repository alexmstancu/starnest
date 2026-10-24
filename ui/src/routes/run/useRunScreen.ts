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
  /**
   * The run on the card when it was armed. **Another run on the card disarms it** (PL-116), and
   * so does every act the reader takes on the card -- Refresh, Stop, opening a run -- because
   * each may redraw the items the scope was drawn from. A read the screen takes on its own, such
   * as handing the card back after a refused start, leaves it armed: nothing the reader chose
   * has changed.
   */
  armedOn: number | null;
}

export interface CardFocus {
  runId: number;
  asked: number;
}

export interface RunScreenState {
  plan: RunPlan | null;
  /** Which card the estimate belongs to, so it can be shown inside that one. */
  planOrigin: GapKind | null;
  /**
   * Which card's estimate is being read, so only that card says "Estimating…" (PL-130): `busy`
   * says `planning` for every estimate alike.
   */
  estimating: GapKind | null;
  /** The run awaiting a yes, or null when nothing is armed. */
  armed: ArmedRun | null;
  current: RunDetail | null;
  busy: RunAct | null;
  /**
   * Whether a stop of `runId` has been asked for and not refused -- whatever act is newest,
   * which is all `busy` can say (NEW-52).
   */
  isStopping: (runId: number) => boolean;
  /**
   * Whether a start is in flight -- whatever act is newest, which is all `busy` can say
   * (NEW-57). Every way to start is held on it.
   */
  starting: boolean;
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
  /**
   * The run whose card the reader should be taken to, and how many times that has been asked,
   * so asking again for the same run moves them again (PL-126). Null until an act asks.
   */
  cardFocus: CardFocus | null;
  /** Start the armed run. Only reachable once something has been armed. */
  commit: () => void;
  cancel: () => void;
  /**
   * The selection a scope is drawn from has changed: put away whatever is armed, and let no
   * estimate still being read arm the scope the reader has just left (PL-116).
   */
  disarm: () => void;
  open: (run: Run) => void;
}

/** `levelId` is the level on screen: an armed scope at any other level is no longer the reader's. */
export function useRunScreen(levelId: string | null): RunScreenState {
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [planOrigin, setPlanOrigin] = useState<GapKind | null>(null);
  const { current, claim, reclaim, isCurrent, show, clear, unclaimed } =
    useWatchedRun();
  const [busy, setBusy] = useState<RunAct | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [armedState, setArmed] = useState<ArmedRun | null>(null);
  // **Derived, not cleared by an effect** (PL-116): an effect runs after the paint, and a "Yes"
  // pressed in between would still start the scope the card has just left. Dismiss is covered
  // here, since it empties the card.
  const armed =
    armedState !== null &&
    armedState.armedOn === (current?.id ?? null) &&
    armedState.scope.level === levelId
      ? armedState
      : null;
  // Bumped by every change of selection, so an estimate read for the selection before it arms
  // nothing.
  const selectionVersion = useRef(0);
  // Every act still going, oldest first. The label is the newest of them, so the first act to
  // end no longer clears the label of one still going (NEW-10).
  const going = useRef<{ what: RunAct }[]>([]);
  // **The runs a stop has been asked for** (NEW-52). Not `busy`, which names only the newest
  // act: a refresh or a start sent while a stop was written took the label, and Stop was offered
  // again. Held from the click, and let go only if the stop is refused. **Accepted, it stays
  // asked**: when a newer act holds the card the stop's own read is dropped, so the card can go
  // on showing the run as read before the stop -- and once a read shows the stop, Stop is not
  // drawn at all.
  const [stopsAsked, setStopsAsked] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  // **Whether a start is in flight** (NEW-57), apart from `busy` for the reason Stop is: a
  // refresh sent while a start went out took the label, and every way to start was let go -- so
  // a second start could be sent, which the database refuses, and its claim took the card from
  // the run that did start.
  const [starting, setStarting] = useState(false);
  const [cardFocus, setCardFocus] = useState<CardFocus | null>(null);
  const [estimating, setEstimating] = useState<GapKind | null>(null);
  /** Takes the reader to the card, once the act's own read is the one on it. */
  const focusCardOf = useCallback(
    (ticket: number, runId: number) => {
      if (!isCurrent(ticket)) return;
      setCardFocus((asked) => ({ runId, asked: (asked?.asked ?? 0) + 1 }));
    },
    [isCurrent],
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

  /** Reads an estimate for one card, naming that card for as long as the read lasts. */
  const estimateFor = useCallback(
    (origin: GapKind, read: () => Promise<void>) =>
      act("planning", async () => {
        setEstimating(origin);
        try {
          await read();
        } finally {
          setEstimating((now) => (now === origin ? null : now));
        }
      }),
    [act],
  );

  /** Runs one start with every way to start held until it has ended, however it ends. */
  const holdingStarts = useCallback(async (action: () => Promise<void>) => {
    setStarting(true);
    try {
      await action();
    } finally {
      setStarting(false);
    }
  }, []);

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
    estimating,
    cardFocus,
    current,
    busy,
    isStopping: (runId) => stopsAsked.has(runId),
    starting,
    failure,
    history: history.resource,
    runs: runs ?? lastRuns,
    reloadHistory: history.reload,
    dismissFailure: () => setFailure(null),
    estimate: (levelId) =>
      void estimateFor("everything", async () => {
        setArmed(null);
        setPlanOrigin("everything");
        setPlan(await planRun({ level: levelId }));
      }),
    // **Every act that reads a run back claims on the click**, before its first await, so a
    // read already on its way when the reader acts again can never land over the newer choice.
    start: (levelId) => {
      const ticket = claim();
      const onCard = current?.id;
      void act("running", () =>
        holdingStarts(async () => {
          const started = await startRun({ level: levelId }).catch((refused: unknown) =>
            giveTheCardBack(ticket, onCard, refused),
          );
          setPlan(null);
          setPlanOrigin(null);
          await watch(ticket, started.id);
          focusCardOf(ticket, started.id);
        }),
      );
    },
    propose: (scope, what, origin) => {
      const version = selectionVersion.current;
      const armedOn = current?.id ?? null;
      void estimateFor(origin, async () => {
        setArmed(null);
        setPlan(null);
        setPlanOrigin(null);
        const planned = await planRun(scope);
        // The cap is read at the moment of arming, not cached: it is a setting somebody may
        // have just changed, and a stale ceiling in a confirmation is worse than none.
        const settings = await fetchSettings();
        if (version !== selectionVersion.current) return;
        setArmed({
          scope,
          plan: planned,
          origin,
          armedOn,
          commitment: describeCommitment({
            act: what,
            fromRun: armedOn,
            itemsTotal: planned.items_total,
            llmCallCount: planned.llm_call_count,
            estimatedCostEur: planned.estimated_cost_eur,
            capEur: settings.run_spend_cap_eur,
          }),
        });
      });
    },
    commit: () => {
      if (!armed) return;
      const ticket = claim();
      const onCard = current?.id;
      void act("running", () =>
        holdingStarts(async () => {
          // Going uncapped is only ever accepted because the strip said so in as many words.
          const started = await startRun({
            ...armed.scope,
            accept_uncapped_spend: armed.commitment.uncapped,
          }).catch((refused: unknown) => giveTheCardBack(ticket, onCard, refused));
          setArmed(null);
          await watch(ticket, started.id);
          focusCardOf(ticket, started.id);
        }),
      );
    },
    cancel: () => {
      setArmed(null);
      setPlan(null);
      setPlanOrigin(null);
    },
    disarm: () => {
      selectionVersion.current += 1;
      setArmed(null);
    },
    refresh: () => {
      if (!current) return;
      setArmed(null);
      const ticket = claim(current.id);
      void act("opening", () => watch(ticket, current.id));
    },
    close: clear,
    stop: () => {
      if (!current) return;
      const runId = current.id;
      const ticket = claim(runId);
      setArmed(null);
      setStopsAsked((runs) => new Set(runs).add(runId));
      void act("stopping", async () => {
        // The 202 carries the run back, so `stop_requested_at` is on screen immediately
        // rather than after the next poll -- which is what lets the card explain why the
        // button has gone before the run has actually ended.
        const stopped = await stopRun(runId).catch((refused: unknown) => {
          // Refused, so nothing was recorded, and Stop is offered again.
          setStopsAsked((runs) => {
            const left = new Set(runs);
            left.delete(runId);
            return left;
          });
          throw refused;
        });
        // **Claimed again now the stop is written** (NEW-49): a refresh sent meanwhile may
        // have read the run before it was, and standing over this read it would offer Stop
        // again.
        await watch(reclaim(ticket, runId), stopped.id);
      });
    },
    // Through `act` like everything else. A backend that is down or a run that cannot be read
    // now says so, where before the promise rejected into nothing and the click looked ignored.
    open: (run) => {
      const ticket = claim(run.id);
      setArmed(null);
      void act("opening", async () => {
        await watch(ticket, run.id);
        focusCardOf(ticket, run.id);
      });
    },
  };
}
