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
 * the reader has left neither changes the card nor reports its failure. **A running run is
 * followed without a click** (`useFollowedRun.ts`), by looks that take no ticket and are no act.
 */

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  fetchEveryRun,
  fetchHoldings,
  fetchRun,
  fetchSettings,
  planRetry,
  planRun,
  retryRun,
  startRun,
  stopRun,
  type Holdings,
  type Run,
  type RunDetail,
  type RunPlan,
} from "../../api/endpoints";
import { newestRun, startOfLocalMonth } from "./databaseHolds";
import { type Commitment, describeCommitment } from "./spendCommitment";
import {
  beginStart,
  endStart,
  leaveStartOutcome,
  startInFlight,
  startOutcomeLeft,
  subscribeToStarts,
  takeStartOutcome,
} from "./pendingStart";
import { useFollowedRun } from "./useFollowedRun";
import { UNCLAIMED, useWatchedRun } from "./useWatchedRun";
import type { Idle, Read } from "../../api/read";
import { useRead } from "../../api/useRead";
import { alwaysAsked } from "./alwaysAsked";
import { type Proposal, levelOf } from "./runScope";
import { isUnreachable } from "../../api/reachability";

export type RunAct = "planning" | "running" | "opening" | "stopping";
/**
 * `opening` covers reading a run back: opening one from the history, and refreshing the one on
 * screen. Both used to be something else -- refreshing claimed to be `planning`, which relabelled
 * the *Estimate* button "Estimating…", and opening claimed nothing at all because it ran outside
 * `act` entirely (P45).
 */

/**
 * Which of the screen's remedies raised an estimate: a gap card's, or the whole level's.
 *
 * **The estimate belongs to the card that asked for it.** Three remedies stand side by side,
 * and a single panel underneath them saying "this would cost €0.32" cannot say which of the
 * three it is about -- a reader who clicked *Retry* reads the figure for *Ask again* and has
 * no way to tell.
 */
export type GapKind = "failed" | "unanswered" | "not_reached" | "everything" | "picked";

/**
 * A run that has been estimated and is waiting to be agreed to.
 *
 * **Nothing that can spend fires on a click.** The estimate panel already showed items, paid
 * calls and a cost ceiling; what was missing was a step between reading that and it
 * happening. A run is the only thing here that spends money and the only one a weight change
 * cannot undo.
 */
export interface ArmedRun {
  /** What "Yes" sends: a retry of one run's pairs, or a run scoped to exact pairs (PL-124). */
  proposal: Proposal;
  plan: RunPlan;
  commitment: Commitment;
  origin: GapKind;
  /**
   * The gaps of its card as they were read when it was armed, or null where none were read.
   * **The scope is drawn from the database's gaps, never from the run on the card**, so opening,
   * refreshing, stopping or dismissing a run leaves it armed; the gaps changing under it
   * disarms it, as a change of selection or of level does (PL-116).
   */
  drawnFrom: string | null;
}

/** The gaps a remedy card draws its scope from, as one comparable string. */
function stillDrawnFrom(armed: ArmedRun, gaps: string | null): boolean {
  return armed.drawnFrom === null || gaps === null || armed.drawnFrom === gaps;
}

function gapsOf(holdings: Read<Holdings> | Idle, origin: GapKind): string | null {
  if (holdings.state !== "ready" || origin === "everything" || origin === "picked") return null;
  return JSON.stringify(holdings.data.gaps[origin]);
}

export type OpeningRead = Exclude<Read<RunDetail>, { state: "ready" }>;

export interface CardFocus {
  runId: number;
  asked: number;
}

export interface RunScreenState {
  /** An estimate shown but never armed: one with nothing in it (PL-120). */
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
  /** The last act that did not go through, ready for `RefusalNotice` (PL-004). */
  refusal: Refusal | null;
  /**
   * The read of the run the screen opens by itself, while it has not answered and the reader has
   * not acted: null once it has, or once they have (PL-001). Failed, it is said with Try again.
   */
  opening: OpeningRead | null;
  reopen: () => void;
  /**
   * Every run there has been. **Read again, it keeps the list it had** (PL-010), so what is
   * drawn from it -- and what the reader chose there -- stays on screen (NEW-11).
   */
  history: Read<Run[]>;
  reloadHistory: () => Promise<void>;
  /**
   * What the database holds at the level on screen (PL-051, PL-054): the panel's figures and the
   * remedy cards' gaps, never one run's accounting. Idle while no level is chosen; read again
   * after every act, as the history is, and whenever `freshness` moves.
   */
  holdings: Read<Holdings> | Idle;
  reloadHoldings: () => Promise<void>;
  dismissFailure: () => void;
  refresh: () => void;
  /** Put the run away. It stays in the history; this is the screen's view of it, not the run. */
  close: () => void;
  /**
   * Ask the run on screen to stop. **Nothing it completed is lost** -- the loop reads the
   * request between sources, so it ends when the fetch in flight finishes.
   */
  stop: () => void;
  /**
   * Estimate a proposal and arm it (PL-124, D32): a retry through `planRetry`, which refuses
   * as the retry would, or a run scoped to exact pairs through `planRun`.
   */
  propose: (proposal: Proposal, origin: GapKind) => void;
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
  /** Opens a run by its number, as "Open acquisition N" does (PL-119). */
  openAcquisition: (runId: number) => void;
}

/**
 * An act that did not go through, as `RefusalNotice` draws it (PL-004, P1-14). **`onResend` is
 * there only for an estimate**, which costs nothing to send again; a start, stop or read-back
 * is dismissed, never resent -- a start sent twice could begin a second paid run.
 */
export interface Refusal {
  act: string;
  error: unknown;
  note?: string;
  onResend?: () => Promise<void>;
}

/** What each act is called in a refusal, as the subject of a sentence. */
const ACT_NAMES: Record<RunAct, string> = {
  planning: "The estimate",
  running: "The start",
  opening: "Reading the run",
  stopping: "The stop",
};

/** What an act on one run is called, naming the run, since the wording never comes from the server. */
const ACTS_ON_A_RUN: Record<RunAct, (runId: number) => string> = {
  planning: () => ACT_NAMES.planning,
  running: () => ACT_NAMES.running,
  opening: (runId) => `Reading acquisition ${runId}`,
  stopping: (runId) => `Stopping acquisition ${runId}`,
};

interface Failure {
  what: RunAct;
  error: unknown;
  resend: (() => Promise<void>) | null;
  /** The run a read-back or a stop was about, so the refusal can say which. */
  runId: number | null;
}

/**
 * `levelId` is the level on screen: an armed scope at any other level is no longer the reader's.
 * `onStarted` hears of every run the server accepted, so the shell can watch it at once (PL-132).
 */
export function useRunScreen(
  levelId: string | null,
  onStarted: () => void = () => undefined,
  freshness = 0,
): RunScreenState {
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [planOrigin, setPlanOrigin] = useState<GapKind | null>(null);
  const { current, claim, reclaim, isCurrent, show, clear, unclaimed, ticketNow, showIfStillShown } =
    useWatchedRun();
  const [busy, setBusy] = useState<RunAct | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [armedState, setArmed] = useState<ArmedRun | null>(null);
  // Bumped by every change of selection, so an estimate read for the selection before it arms
  // nothing.
  const selectionVersion = useRef(0);
  // **A change of level clears what was estimated and armed for the level left** (PL-116,
  // PL-130), during the render that shows the new level, so no paint offers the old one's
  // Start or "Yes"; and the effect drops any estimate still being read for it.
  const [shownLevel, setShownLevel] = useState(levelId);
  if (shownLevel !== levelId) {
    setShownLevel(levelId);
    setArmed(null);
    setPlan(null);
    setPlanOrigin(null);
  }
  useEffect(() => {
    selectionVersion.current += 1;
  }, [levelId]);
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
  // the run that did start. **Kept by the page** (P94, `pendingStart.ts`), so an Acquire mounted
  // again while it is in flight holds every way to start as well.
  const starting = useSyncExternalStore(subscribeToStarts, startInFlight);
  // Whether this screen is still mounted, for a start to know whether anybody saw it end.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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

  // Every run, not the newest ten: the history and the diff's choices read this list as every
  // run there has been (UI-17). The month's spend is the server's (PL-052). **Read again on every
  // end the shell sees**, so a run that ends while the card shows another stops holding the
  // starts it held.
  const history = useRead(
    useCallback(
      async (signal: AbortSignal) => (await fetchEveryRun({ signal })).items,
      [],
    ),
    { freshness },
  );
  const historyRead = alwaysAsked(history.read);
  // The month starts where the reader's calendar says, worked out at each read so a read after
  // midnight on the first asks about the new month (C04-N10).
  const holdings = useRead(
    useCallback(
      async (signal: AbortSignal) => {
        // Not reachable while disabled; the guard is here so the type is honest.
        if (levelId === null) throw new Error("no level");
        return fetchHoldings(levelId, startOfLocalMonth(new Date()), { signal });
      },
      [levelId],
    ),
    { enabled: levelId !== null, freshness },
  );
  const reloadHoldings = holdings.reload;
  // **Derived, not cleared by an effect** (PL-116): an effect runs after the paint, and a "Yes"
  // pressed in between would still start a scope whose gaps have just moved.
  const armed =
    armedState !== null &&
    levelOf(armedState.proposal) === levelId &&
    stillDrawnFrom(armedState, gapsOf(holdings.read, armedState.origin))
      ? armedState
      : null;

  const reloadHistory = history.reload;
  // The card follows a running acquisition on its own, outside `act` (PL-117); the end it sees
  // moves the history and what the database holds, so both are read again, once.
  useFollowedRun({ current, ticketNow, showIfStillShown }, () => {
    void reloadHistory();
    void reloadHoldings();
  });
  const act = useCallback(
    async (
      what: RunAct,
      action: () => Promise<void>,
      { resend, runId }: { resend?: () => Promise<void>; runId?: number } = {},
    ) => {
      const mine = { what };
      going.current = [...going.current, mine];
      setBusy(what);
      setFailure(null);
      try {
        await action();
        void reloadHistory();
        void reloadHoldings();
      } catch (error) {
        setFailure({ what, error, resend: resend ?? null, runId: runId ?? null });
      } finally {
        going.current = going.current.filter((each) => each !== mine);
        setBusy(going.current.at(-1)?.what ?? null);
      }
    },
    [reloadHistory, reloadHoldings],
  );

  /**
   * Reads an estimate for one card, naming that card for as long as the read lasts. **A refusal
   * is reported only while it is still asked for**: one for a level or a selection the reader has
   * left would stand over the one on screen, as its answer would (PL-116).
   */
  const estimateFor = useCallback(
    (origin: GapKind, stillAsked: () => boolean, read: () => Promise<void>) => {
      // Try again sends this very estimate again: it spends nothing (P1-14).
      const attempt = (): Promise<void> =>
        act(
          "planning",
          async () => {
            setEstimating(origin);
            try {
              await read();
            } catch (refused) {
              if (stillAsked()) throw refused;
            } finally {
              setEstimating((now) => (now === origin ? null : now));
            }
          },
          { resend: attempt },
        );
      return attempt();
    },
    [act],
  );

  /**
   * Runs one start with every way to start held until it has ended, however it ends -- on every
   * Acquire in the page, and cleared in the `finally` whatever became of the screen.
   */
  const holdingStarts = useCallback(async (action: () => Promise<void>) => {
    beginStart();
    try {
      await action();
    } finally {
      endStart();
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
   * The run a start began, or null once its outcome has been left for another screen (P94):
   * **a start whose screen has gone** leaves what became of it in `pendingStart.ts`, for the
   * next Acquire to show or to report. Refused while this screen is still here, the card is
   * handed back and the refusal thrown, as before.
   */
  const startedOrLeft = useCallback(
    async (request: Promise<Run>, ticket: number, onCard: number | undefined) => {
      try {
        const started = await request;
        onStarted();
        if (alive.current) return started;
        leaveStartOutcome({ started: started.id });
      } catch (refused) {
        if (alive.current) return giveTheCardBack(ticket, onCard, refused);
        leaveStartOutcome({ refused });
      }
      return null;
    },
    [onStarted, giveTheCardBack],
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
  // Pending until it answers: the read is sent by the effect below, the render after the
  // history arrives, so that render already says it is on its way.
  const [openingRead, setOpeningRead] = useState<OpeningRead | "answered">({
    state: "pending",
  });
  /**
   * **No banner if it fails, but never silence** (PL-001): nobody asked for this read, so its
   * failure is the card's own, said where the card would be, with Try again. A card left empty
   * instead read as "there has been no run". Once the reader acts it is theirs, and so is what
   * the act reports.
   */
  const readOpening = useCallback(
    (runId: number) =>
      watch(UNCLAIMED, runId).then(
        () => {
          setOpeningRead("answered");
          return true;
        },
        (error: unknown) => {
          setOpeningRead({ state: "failed", error });
          return false;
        },
      ),
    [watch, setOpeningRead],
  );
  const runs = historyRead.state === "ready" ? historyRead.data : null;
  const newestId = runs === null ? undefined : newestRun(runs)?.id;
  useEffect(() => {
    if (opened.current || runs === null) return;
    const newest = newestRun(runs);
    // Not settled by an empty history: one started elsewhere arrives with the next re-read.
    if (newest === undefined) return;
    opened.current = true;
    if (!unclaimed()) return;
    void readOpening(newest.id);
  }, [runs, unclaimed, readOpening]);

  /**
   * Reads one run back and shows it. **A read changes nothing and costs nothing**, so a refusal
   * of it offers Try again, which claims the card afresh and reads again (P1-14).
   */
  function readBack(runId: number, { focus = false }: { focus?: boolean } = {}): Promise<void> {
    const ticket = claim(runId);
    return act(
      "opening",
      async () => {
        await watch(ticket, runId);
        if (focus) focusCardOf(ticket, runId);
      },
      { runId, resend: () => readBack(runId, { focus }) },
    );
  }

  // **What became of a start sent from an Acquire since left** (P94, D33): the run it began is
  // shown, and a refusal reported here once, the card keeping the newest run.
  const takeWhatBecameOfAStart = useEffectEvent(() => {
    const outcome = takeStartOutcome();
    if (outcome === null) return;
    if ("started" in outcome) {
      void readBack(outcome.started, { focus: true });
    } else {
      setFailure({ what: "running", error: outcome.refused, resend: null, runId: null });
    }
  });
  useEffect(() => {
    let mounted = true;
    const takeIfLeft = () => {
      if (mounted && startOutcomeLeft()) takeWhatBecameOfAStart();
    };
    // Left before this screen was mounted, or while it is.
    queueMicrotask(takeIfLeft);
    const unsubscribe = subscribeToStarts(takeIfLeft);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return {
    // Read during the render: every act claims inside a handler that also sets state.
    opening:
      unclaimed() && newestId !== undefined && openingRead !== "answered" ? openingRead : null,
    // Try again is the reader's, so it takes them to the card it brings (PL-126).
    reopen: () => {
      if (newestId === undefined) return;
      const runId = newestId;
      setOpeningRead({ state: "pending" });
      void readOpening(runId).then((answered) => {
        if (answered && unclaimed()) {
          setCardFocus((asked) => ({ runId, asked: (asked?.asked ?? 0) + 1 }));
        }
      });
    },
    plan,
    planOrigin,
    armed,
    estimating,
    cardFocus,
    current,
    busy,
    isStopping: (runId) => stopsAsked.has(runId),
    starting,
    refusal: failure === null ? null : refusalOf(failure),
    history: historyRead,
    reloadHistory,
    holdings: holdings.read,
    reloadHoldings,
    dismissFailure: () => setFailure(null),
    propose: (proposal, origin) => {
      const version = selectionVersion.current;
      const stillAsked = () => version === selectionVersion.current;
      const drawnFrom = gapsOf(holdings.read, origin);
      void estimateFor(origin, stillAsked, async () => {
        setArmed(null);
        setPlan(null);
        setPlanOrigin(null);
        const planned =
          proposal.via === "retry"
            ? await planRetry(proposal.runId, { items: proposal.items, pairs: proposal.pairs })
            : await planRun(proposal.scope);
        // The cap is read at the moment of arming, not cached: it is a setting somebody may
        // have just changed, and a stale ceiling in a confirmation is worse than none.
        const settings = await fetchSettings();
        if (!stillAsked()) return;
        // Nothing to confirm for nought items (PL-120): the estimate is shown, never armed.
        if (planned.items_total === 0) {
          setPlan(planned);
          setPlanOrigin(origin);
          return;
        }
        setArmed({
          proposal,
          plan: planned,
          origin,
          drawnFrom,
          commitment: describeCommitment({
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
          const accept_uncapped_spend = armed.commitment.uncapped;
          const { proposal } = armed;
          const started = await startedOrLeft(
            proposal.via === "retry"
              ? retryRun(proposal.runId, {
                  items: proposal.items,
                  pairs: proposal.pairs,
                  accept_uncapped_spend,
                })
              : startRun({ ...proposal.scope, accept_uncapped_spend }),
            ticket,
            onCard,
          );
          if (started === null) return;
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
      if (current) void readBack(current.id);
    },
    close: clear,
    stop: () => {
      if (!current) return;
      const runId = current.id;
      const ticket = claim(runId);
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
      }, { runId });
    },
    // Through `act` like everything else. A backend that is down or a run that cannot be read
    // now says so, where before the promise rejected into nothing and the click looked ignored.
    open: (run) => void readBack(run.id, { focus: true }),
    openAcquisition: (runId) => void readBack(runId, { focus: true }),
  };
}

function refusalOf({ what, error, resend, runId }: Failure): Refusal {
  return {
    act: runId === null ? ACT_NAMES[what] : ACTS_ON_A_RUN[what](runId),
    error,
    // **A start nobody answered may have begun all the same** (P1-14): it is not sent again,
    // and the history is where the reader learns whether it did.
    note:
      what === "running" && isUnreachable(error)
        ? "It is not known whether the run began; the history will show it."
        : undefined,
    onResend: resend ?? undefined,
  };
}
