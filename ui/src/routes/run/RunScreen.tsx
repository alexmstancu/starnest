import { type ReactNode, useEffect, useId, useRef } from "react";
import {
  type Holdings,
  type Run,
  type RunDetail,
  type RunPlan,
} from "../../api/endpoints";
import { useSourceNames } from "../../api/useSourceNames";
import {
  formatCount,
  formatDateTime,
  formatMoney,
  sourceName,
} from "../../format/display";
import type { RouteDefinition } from "../../navigation/routes";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { RefusalNotice } from "../../shell/RefusalNotice";
import { useSelection } from "../../shell/SelectionContext";
import { AcquisitionDiffPanel } from "./AcquisitionDiffPanel";
import { DatabaseHoldsPanel } from "./DatabaseHoldsPanel";
import { describeGaps, describeScope } from "./databaseHolds";
import { describeFailures, failuresIn } from "./failureGroups";
import { HeldButton } from "./HeldButton";
import { ItemGroups } from "./ItemGroups";
import { OpenToHandEntry } from "./OpenToHandEntry";
import { UnsourcedAttributes } from "./UnsourcedAttributes";
import { type Progress, progressBar } from "./runProgress";
import { scopeFor } from "./runScope";
import {
  acquisitionInFlight,
  inFlight,
  outcomeSentence,
  planNote,
  runState,
  type SourceReach,
  sourceBars,
} from "./sourceReach";
import { describeCeiling, describeSpend } from "./spendCommitment";
import {
  type GapKind,
  type RunScreenState,
  useRunScreen,
} from "./useRunScreen";

/**
 * Data acquisition: what the database holds, what to do about the gaps, and what the last run
 * did (`reqs.md` 6.3, 6.4).
 *
 * **A failure is a thing to act on, not a thing to read**, which decides the whole order of
 * this screen. The standing figures lead, the three remedies follow, and the run's own report
 * waits behind a fold unless the run is still going -- so a reader who arrives wanting to do
 * something about 32 failures meets the button before the account. One action re-runs only what
 * failed; an item nobody answered is listed separately and asked again separately, because
 * nothing failed there (`reqs.md` Q217). And the failures themselves are grouped by source and
 * message rather than listed, because one message repeated is one problem.
 *
 * **Markup only.** The estimate, the run, the watching and the going-again are
 * `useRunScreen.ts`; the grouping and the counting are `failureGroups.ts`.
 */
export function RunScreen({ route }: { route: RouteDefinition }) {
  const { levelId, noteAcquisitionStarted, acquisitionsEnded } = useSelection();
  // An acquisition the shell saw end has moved what the database holds.
  const run = useRunScreen(levelId, noteAcquisitionStarted, acquisitionsEnded);
  // **Where Not yet hands focus back** (PL-128): the control that opened the strip, which
  // stays on screen when the strip goes.
  const opener = useRef<Element | null>(null);
  const propose: typeof run.propose = (scope, origin) => {
    opener.current = document.activeElement;
    run.propose(scope, origin);
  };
  const cancel = () => {
    run.cancel();
    if (opener.current instanceof HTMLElement && opener.current.isConnected) {
      opener.current.focus();
    }
  };
  const gapsHeading = useRef<HTMLHeadingElement>(null);
  // Dismiss takes its card with it, so focus goes to what the reader came to act on.
  const dismiss = () => {
    run.close();
    gapsHeading.current?.focus();
  };

  // Built once and placed in one of two slots, because it is one card either way: the top of
  // the screen while the run is in flight, and inside a fold under the remedies once it is not.
  const report =
    run.current === null ? (
      // Until the run the screen opens by itself has answered, its read stands where it will.
      run.opening !== null && (
        <section className="acquisition" aria-label="The last acquisition">
          <LoadedRegion
            read={run.opening}
            what="The last acquisition"
            skeleton="lines"
            prominence="region"
            onRetry={run.reopen}
          >
            {() => null}
          </LoadedRegion>
        </section>
      )
    ) : (
      <RunReport
        run={run.current}
        busy={run.busy === "opening"}
        starting={run.starting}
        stopping={run.isStopping(run.current.id)}
        focusAsked={
          run.cardFocus?.runId === run.current.id ? run.cardFocus.asked : null
        }
        onRefresh={run.refresh}
        onDismiss={dismiss}
        onStop={run.stop}
      />
    );

  return (
    <section className="screen screen--acquire" aria-labelledby="screen-heading">
      <header className="screen__header">
        <h1 id="screen-heading" className="screen__heading">
          {route.label}
        </h1>
        <p className="screen__summary">
          Where the values come from. Nothing here is fetched or charged until
          you agree to an estimate.
        </p>
      </header>

      {run.refusal !== null && <RefusalNotice {...run.refusal} onDismiss={run.dismissFailure} />}

      {/* **The card leads whenever there is a run, and the design settles why.** It was a
          full-size report with a table of every failure in it, which is what made leading with
          it wrong -- so the first fix here folded it away once the run had finished. The
          prototype does something better: the card is *compact* (a bar, a source breakdown, one
          outcome sentence, and no item lists at all), which costs a reader four lines whether
          the run is going or gone. `acqShow: !!s.acq` in the design's own state -- there is no
          recency window, and Dismiss is what removes it, which is exactly `run.current` and
          `run.close`. The failures live in the card below that can act on them. */}
      {report}

      <DatabaseHoldsPanel
        history={run.history}
        holdings={run.holdings}
        onRetryHistory={run.reloadHistory}
        onRetryHoldings={run.reloadHoldings}
      />

      {/* ── What you can do about the gaps ───────────────────────────────────────────
          **The cards side by side, and the same shape each.** A failure, an item nobody
          answered and a wholesale refresh are different problems with different remedies, and
          a reader arriving at this screen is choosing between them. Stacked in a column they
          read as a sequence of steps, which they are not.

          **The database's gaps, by their latest outcome** (PL-054, C04-N2): read from the
          holdings, never from the run on the card, so opening, dismissing or refreshing a run
          moves none of them, and with values stored they add up to every value at the level. */}
      <section className="section" aria-labelledby="gaps">
        <header className="section__head">
          <h2 id="gaps" ref={gapsHeading} tabIndex={-1} className="section__heading">
            What you can do about the gaps
          </h2>
          <p className="section__lead">
            {describeGaps(run.holdings.state === "ready" ? run.holdings.data : null)}
          </p>
        </header>

        <div className="gap-cards">
          {levelId !== null && run.holdings.state !== "idle" && (
            <LoadedRegion
              read={run.holdings}
              what="The gaps"
              skeleton="lines"
              prominence="region"
              onRetry={run.reloadHoldings}
            >
              {({ gaps }) => (
                <GapRemedies
                  gaps={gaps}
                  levelId={levelId}
                  stillRunning={acquisitionInFlight(
                    run.current,
                    run.history.state === "ready" ? run.history.data : [],
                  )}
                  run={run}
                  propose={propose}
                  onCancel={cancel}
                />
              )}
            </LoadedRegion>
          )}

          {levelId === null ? (
            <p className="screen__note">
              Choose a level to plan an acquisition.
            </p>
          ) : (
            <GapCard
              count=""
              what={`An acquisition over every ${levelId} candidate`}
              lead="Re-asks everything, including what is already stored and still fresh. The estimate first: what would be fetched, and what it would cost, before anything is."
            >
              <HeldButton
                className="button"
                held={run.busy !== null}
                onClick={() => run.estimate(levelId)}
              >
                {run.estimating === "everything"
                  ? "Estimating…"
                  : "Estimate an acquisition"}
              </HeldButton>
              <GapEstimate
                kind="everything"
                run={run}
                onCancel={cancel}
                onStart={() => run.start(levelId)}
              />
            </GapCard>
          )}
        </div>

        {run.plan && run.planOrigin !== null && (
          <PerSourcePlan plan={run.plan} />
        )}
      </section>

      {/* Beside the failures deliberately: the three reasons a figure is missing look the
          same in a ranking and have entirely different remedies. */}
      {levelId !== null && <UnsourcedAttributes level={levelId} />}

      {/* Beside it, and separate: "no source at all" means no adapter can fetch it, while these
          are attributes the catalog says a person may answer. One only a person can answer is
          honestly in both lists, and its form is here (UI-32). */}
      {levelId !== null && <OpenToHandEntry level={levelId} />}

      {/* **Kept through a re-read of the history** (NEW-11, PL-010): every act reads it again,
          and the diff left the screen for each re-read and came back with nothing chosen. Not
          drawn before the first answer, so nothing can be chosen from a list nobody has read. */}
      {run.history.state === "ready" && <AcquisitionDiffPanel runs={run.history.data} />}

      <section aria-labelledby="every-acquisition">
        <h2 id="every-acquisition" className="panel__heading">
          Every acquisition so far
        </h2>
        <LoadedRegion
          read={run.history}
          what="The acquisition history"
          skeleton="lines"
          prominence="region"
          onRetry={run.reloadHistory}
        >
          {(runs) => <RunHistory runs={runs} held={run.starting} onOpen={run.open} />}
        </LoadedRegion>
      </section>
    </section>
  );
}

/**
 * The failed, unanswered and not-reached cards, from the database's gaps.
 *
 * **Always drawn once the gaps are read** (PL-059): a card with nothing in it reads nought and
 * its action is inert -- "Nothing is failing", as the design has it -- rather than leaving the
 * row with a hole a reader cannot tell from a card still loading. The not-reached card is the
 * one exception (C04-N7): it is drawn only when some pair has never been asked about.
 */
function GapRemedies({
  gaps,
  levelId,
  stillRunning,
  run,
  propose,
  onCancel,
}: {
  gaps: Holdings["gaps"];
  levelId: string;
  /**
   * The acquisition still going, if any (PL-050). An item it has not answered yet may still be
   * answered, so "retrying changes nothing" is not yet true and Retry is held until it ends.
   */
  stillRunning: number | null;
  run: RunScreenState;
  propose: RunScreenState["propose"];
  onCancel: () => void;
}) {
  const failures = failuresIn(gaps.failed);
  return (
    <>
      <GapCard
        tone={gaps.failed.length > 0 ? "danger" : undefined}
        count={formatCount(gaps.failed.length)}
        what="failed"
        lead={
          gaps.failed.length > 0
            ? "A source broke. Worth retrying."
            : "No value is missing because a source broke."
        }
      >
        {gaps.failed.length > 0 && (
          <>
            {/* **The count that answers the complaint, in one line.** "32 failed" reads as
                thirty-two problems; "1 distinct message" says it is one problem with a wide
                blast radius, which is the thing a reader can act on. */}
            <p className="gap-card__note">{describeFailures(failures)}</p>
            <ItemGroups
              // Its picks belong to this level's gaps, so another level starts them again.
              key={levelId}
              items={failures}
              groupedBy="data_source"
              caption="Which sources broke"
              level={levelId}
              detailKind="failed"
              act="Retry"
              busy={run.busy === "planning"}
              onSelectionChange={run.disarm}
              onPropose={(scope) => propose(scope, "failed")}
            />
          </>
        )}
        {/* **"Retry 12 failed", the design's fixed copy**, with the count in the label: the
            cards stand side by side and each has its action at its foot. Held while any act is
            in flight, never disabled (NEW-44); with nothing failing it is inert, since there
            is nothing to wait for. */}
        <RemedyButton
          primary
          count={gaps.failed.length}
          label={`Retry ${formatCount(gaps.failed.length)} failed`}
          empty="Nothing is failing"
          held={run.busy !== null}
          onClick={() =>
            propose(scopeFor(levelId, gaps.failed), "failed")
          }
        />
        <GapEstimate kind="failed" run={run} onCancel={onCancel} />
      </GapCard>

      <GapCard
        tone={gaps.unanswered.length > 0 ? "warning" : undefined}
        count={formatCount(gaps.unanswered.length)}
        what="unanswered"
        lead={
          gaps.unanswered.length === 0
            ? "No value is missing because every source lacked a row."
            : stillRunning !== null
              ? `Acquisition ${stillRunning} is still running, so these may yet be answered. Retry once it ends.`
              : "Every source answered, and none had a row. Retrying the same sources changes nothing."
        }
      >
        {gaps.unanswered.length > 0 && (
          <ItemGroups
            key={levelId}
            items={gaps.unanswered}
            groupedBy="attribute"
            caption="Which values went unanswered"
            level={levelId}
            detailKind="unanswered"
            act="Retry"
            busy={run.busy === "planning" || stillRunning !== null}
            onSelectionChange={run.disarm}
            onPropose={(scope) => propose(scope, "unanswered")}
          />
        )}
        {/* "Retry 62 unanswered": the design uses one verb for both buckets and puts the
            difference in the noun. */}
        <RemedyButton
          count={gaps.unanswered.length}
          label={`Retry ${formatCount(gaps.unanswered.length)} unanswered`}
          empty="Nothing went unanswered"
          held={run.busy !== null || stillRunning !== null}
          onClick={() =>
            propose(scopeFor(levelId, gaps.unanswered), "unanswered")
          }
        />
        <GapEstimate kind="unanswered" run={run} onCancel={onCancel} />
      </GapCard>

      {gaps.not_reached.length > 0 && (
        <GapCard
          count={formatCount(gaps.not_reached.length)}
          what="not reached"
          lead="No source was asked yet. Worth asking."
        >
          <ItemGroups
            key={levelId}
            items={gaps.not_reached}
            groupedBy="attribute"
            caption="Which values were not reached"
            level={levelId}
            detailKind="not_reached"
            act="Ask"
            busy={run.busy === "planning"}
            onSelectionChange={run.disarm}
            onPropose={(scope) => propose(scope, "not_reached")}
          />
          <RemedyButton
            count={gaps.not_reached.length}
            label={`Ask ${formatCount(gaps.not_reached.length)} not reached`}
            empty=""
            held={run.busy !== null}
            onClick={() =>
              propose(scopeFor(levelId, gaps.not_reached), "not_reached")
            }
          />
          <GapEstimate kind="not_reached" run={run} onCancel={onCancel} />
        </GapCard>
      )}
    </>
  );
}

/** A card's action: held while an act is in flight, inert and saying so when there is none. */
function RemedyButton({
  count,
  label,
  empty,
  held,
  primary = false,
  onClick,
}: {
  count: number;
  label: string;
  empty: string;
  held: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  if (count === 0) {
    return (
      <button type="button" className="button" disabled>
        {empty}
      </button>
    );
  }
  return (
    <HeldButton
      className={primary ? "button button--primary" : "button"}
      held={held}
      onClick={onClick}
    >
      {label}
    </HeldButton>
  );
}

/**
 * One remedy, as a card.
 *
 * **The count leads and the verb closes.** A reader arriving here is choosing between three
 * problems, and the figure is what they are choosing on; the button at the foot of each card
 * is always in the same place, so the choice is made by reading across rather than by
 * hunting for where each card put its action.
 */
function GapCard({
  count,
  what,
  lead,
  tone,
  children,
}: {
  count: string;
  what: string;
  lead: string;
  tone?: "danger" | "warning";
  children: ReactNode;
}) {
  // Labelled, so each remedy is something a reader -- or a screen reader, or a test -- can
  // address by what it is for. Three cards that differ only in their contents are three
  // unnamed boxes, and the estimate inside one of them belongs to a card you can name.
  const headingId = useId();
  return (
    <section
      className={tone ? `gap-card gap-card--${tone}` : "gap-card"}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className="gap-card__head">
        {count !== "" && <span className="gap-card__count">{count}</span>}
        <span className="gap-card__what">{what}</span>
      </h3>
      <p className="gap-card__lead">{lead}</p>
      {children}
    </section>
  );
}

/**
 * What a remedy would do, and the step between reading that and it happening.
 *
 * **Inside the card that raised it.** Three remedies stand side by side; a single panel
 * underneath them saying "this would cost €0.32" cannot say which of the three it is about,
 * and a reader who clicked *Retry* would read the figure for *Ask again*.
 *
 * Nothing that can spend fires on a click. The estimate says what it would cost; the
 * confirmation is the step between reading that and it happening.
 */
function GapEstimate({
  kind,
  run,
  onStart,
  onCancel,
}: {
  kind: GapKind;
  run: RunScreenState;
  onCancel: () => void;
  /** Only the whole-level card starts from a bare plan; the others arm through `propose`. */
  onStart?: () => void;
}) {
  const armed = run.armed?.origin === kind ? run.armed : null;
  const plan = run.planOrigin === kind ? run.plan : (armed?.plan ?? null);
  if (plan === null) return null;

  return (
    <div className="gap-card__foot">
      <dl className="stat-list stat-list--inline">
        <Stat label="Items" value={formatCount(plan.items_total)} />
        <Stat label="Paid calls" value={formatCount(plan.llm_call_count)} />
        {/* **A ceiling, not a forecast**, and the reason sits on the figure rather than in a
            paragraph below it: priced at the highest per-call rate for every paid item in
            scope, with no cache hit assumed. `estimate_basis` is the server's own wording. */}
        <Stat
          label="At most"
          value={formatMoney(plan.estimated_cost_eur, "EUR")}
          note={describeCeiling(plan.estimate_basis)}
        />
      </dl>

      {armed === null
        ? onStart !== undefined && (
            // The one filled button in the application. The design reserves the primary for
            // the action a screen exists to take, and this screen exists to start a run.
            <HeldButton
              className="button button--primary"
              held={run.starting}
              onClick={onStart}
            >
              {run.starting ? "Running…" : "Start this acquisition"}
            </HeldButton>
          )
        : (
            <div
              className={
                armed.commitment.uncapped
                  ? "confirm confirm--uncapped"
                  : "confirm"
              }
              role="alert"
            >
              <p className="confirm__message">{armed.commitment.sentence}</p>
              <div className="confirm__acts">
                <HeldButton
                  className="button button--primary"
                  held={run.starting}
                  onClick={run.commit}
                >
                  {run.starting ? "Starting…" : "Yes, start it"}
                </HeldButton>
                <HeldButton
                  className="button"
                  held={run.starting}
                  onClick={onCancel}
                >
                  Not yet
                </HeldButton>
              </div>
            </div>
          )}
    </div>
  );
}

/**
 * Where a planned acquisition's items would come from.
 *
 * Under the cards rather than inside one: it is a table of every source in scope, and the
 * three cards are a row that has to stay a row. The figures a reader chooses on -- items,
 * paid calls, a ceiling -- are in the card; this is the detail behind them.
 */
function PerSourcePlan({ plan }: { plan: RunPlan }) {
  const names = useSourceNames();
  const sources = plan.by_source ?? [];
  if (sources.length === 0) return null;
  return (
    <div className="table-card">
      <table className="table">
        <caption>
          Per source. Where two sources answer one attribute, both are asked.
        </caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Items</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.data_source}>
              <th scope="row">{sourceName(names, source.data_source ?? "")}</th>
              <td>{formatCount(source.items)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The step between reading what a run would cost and it happening.
 *
 * An uncapped run is marked out rather than merely mentioned: `run_spend_cap_eur` is nullable
 * and null is the shipped state, so "no ceiling" is the *default* condition and the one most
 * worth interrupting for.
 */
/**
 * The run's progress as one bar.
 *
 * **SVG geometry, not a style attribute.** eslint refuses a `style` attribute anywhere under
 * `routes/` -- an inline style is design inside a component, which is what makes a redesign a
 * rewrite -- and a `<rect width="73%">` carries the same number as an attribute of the
 * drawing rather than of the styling.
 */
function RunProgress({ progress }: { progress?: Progress | null }) {
  const bar = progressBar(progress);
  if (bar.segments.length === 0) {
    return <p className="panel__hint">{bar.reading}</p>;
  }

  return (
    <div className="meter">
      <svg
        className="meter__track"
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        role="img"
        aria-label={bar.reading}
      >
        {bar.segments.map((segment) => (
          <rect
            key={segment.kind}
            className={`meter__fill meter__fill--${segment.kind}`}
            x={segment.x}
            y="0"
            width={segment.width}
            height="8"
          >
            <title>{segment.title}</title>
          </rect>
        ))}
      </svg>
      <span className="meter__reading">{bar.reading}</span>
    </div>
  );
}

/**
 * One acquisition, as the screen's lead.
 *
 * **Compact on purpose, which is what makes leading with it right.** This was a full-size
 * report carrying a table of every failure and every unanswered item, and on a run that failed
 * 32 times with one message it buried the whole rest of the screen -- so the first attempt at a
 * fix folded it away once the run had finished. The design does something better: the card is
 * four things deep (a bar, a source breakdown, one outcome sentence, a footer) and holds **no
 * item lists at all**. The items belong to the cards below that can act on them, and a reader
 * who wants to know which country failed is a reader who wants to retry it.
 *
 * **The heading is the state**: "Acquiring now", "Acquisition finished", "Stopped early". The
 * acquisition's number goes in the line under it rather than in the heading, because the state
 * is what a reader arriving mid-run is checking and the number is what they already clicked.
 *
 * **Refresh is ours, not the design's.** The prototype animates a fake run on a timer, so it
 * never needs one; `POST /data-acquisition-runs` really does return 202 and hand the fetching
 * to a background task (P35), and nothing here polls. A card that could not be re-read would
 * show "Acquiring now" for ever.
 */
function RunReport({
  run,
  busy,
  starting,
  stopping,
  onRefresh,
  onDismiss,
  onStop,
  focusAsked,
}: {
  run: RunDetail;
  busy: boolean;
  /** Changes each time an act asks to take the reader to this card; null when none has. */
  focusAsked: number | null;
  /** A start is in flight: Refresh, Dismiss and Stop would claim the card from it (UIR-G1, RB-1). */
  starting: boolean;
  stopping: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
  onStop: () => void;
}) {
  const outcome = outcomeSentence(run.run_status, run.progress);
  const state = runState(run.run_status, run.stop_requested_at);
  const going = inFlight(state);
  // **Offered only while there is something to stop, and withdrawn once asked.** A second
  // click would change nothing -- the first request is the one recorded -- and a button that
  // stays live after it has been used invites the reader to think it did not work.
  const canStop = run.run_status === "running" && run.stop_requested_at == null;
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const refresh = useRef<HTMLButtonElement>(null);
  // **Stop withdrawn takes focus to Refresh** (PL-128), the act left beside it, and only when
  // focus was lost as Stop went.
  const couldStop = useRef(canStop);
  useEffect(() => {
    const withdrawn = couldStop.current && !canStop;
    couldStop.current = canStop;
    if (withdrawn && document.activeElement === document.body) refresh.current?.focus();
  }, [canStop]);
  // **The reader is moved, not just the card** (PL-126): opened from the history 2,000 px
  // below, the card changed where nobody was looking. Only when focus is on this screen or
  // lost, so a reader who has gone elsewhere meanwhile is not pulled back.
  useEffect(() => {
    if (focusAsked === null || !focusIsHereOrLost(card.current)) return;
    heading.current?.focus();
    // Not in jsdom; the focus is what moves a keyboard reader, the scroll is for the eye.
    card.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [focusAsked]);
  return (
    // A labelled region, so "the run report" is something a reader -- or a screen reader --
    // can address, rather than the nearest box that happens to contain the heading.
    <section
      ref={card}
      className={going ? "acquisition acquisition--going" : "acquisition"}
      // **Labelled by the acquisition, headed by its state.** The design heads the card with
      // the state because its prototype only ever has the run it just started; this screen can
      // open any run in the history, so the region a reader -- or a test, or a screen reader --
      // addresses has to say *which* acquisition, while the heading says what is happening to
      // it. The number is visible on the line below either way.
      aria-label={`Acquisition ${run.id}`}
    >
      <header className="acquisition__head">
        <h2 ref={heading} tabIndex={-1} className="acquisition__heading">
          {headingFor(state)}
        </h2>
        <RunStatusPill status={state} />
      </header>

      {/* **Which acquisition, and what it was asked to cover.** The scope is stored expanded,
          so this is its size and not its contents -- and the number is here rather than in the
          heading, which the design gives to the state. */}
      <p className="acquisition__scope">
        Acquisition {run.id} {going ? "is asking for" : "asked for"}{" "}
        {describeScope(run)} — started {formatDateTime(run.started_at)}
        {run.finished_at !== null &&
          `, finished ${formatDateTime(run.finished_at)}`}
      </p>

      <RunProgress progress={run.progress} />

      <SourceBySource
        reaches={run.by_source}
        state={state}
        planRecorded={run.plan_recorded}
      />

      {outcome !== "" && <p className="acquisition__outcome">{outcome}</p>}

      <footer className="acquisition__foot">
        <span className="acquisition__spend">
          {describeSpend(run)}
        </span>
        <div className="acquisition__acts">
          {/* **Refresh, not a poll.** A run that finished is not going to change, and a screen
              that re-read it every second would spend the reader's backend on nothing. Held
              while it reads, and Stop once it has been asked for, never disabled (NEW-44,
              NEW-52). */}
          <HeldButton
            ref={refresh}
            className="button"
            held={busy || starting}
            onClick={onRefresh}
          >
            {busy ? "Reading…" : "Refresh"}
          </HeldButton>
          {canStop && (
            /* **Says what it keeps, because that is the question.** "Stop" alone reads as
               "throw away what it has done", and the one thing a reader must know before
               clicking is that it does not. The loop reads the request between sources, so
               everything already written stays written. */
            <HeldButton
              className="button button--danger"
              held={stopping || starting}
              onClick={onStop}
            >
              {stopping ? "Stopping…" : "Stop — keep what completed"}
            </HeldButton>
          )}
          {/* Dismiss only once there is nothing left to watch, as the design has it: putting a
              run away while it is still writing values would look like cancelling it. */}
          {!going && (
            <HeldButton className="button" held={starting} onClick={onDismiss}>
              Dismiss
            </HeldButton>
          )}
        </div>
      </footer>
    </section>
  );
}

/** Whether focus is lost, or still on the screen that holds `element`. */
function focusIsHereOrLost(element: HTMLElement | null): boolean {
  const focused = document.activeElement;
  if (focused === null || focused === document.body) return true;
  return element?.closest(".screen")?.contains(focused) ?? false;
}

/**
 * What to call the card, which is the run's state and not its number.
 *
 * **Four states where the design has three.** The prototype knows `running`, `cancelled` and
 * finished; a real run can also have died, and "Acquisition finished" over a run whose process
 * was killed would be the screen's worst habit -- a plausible sentence that is not true.
 */
function headingFor(state: string): string {
  switch (state) {
    case "running":
    case "stopping":
    case "planned":
      return "Acquiring now";
    case "halted_by_user":
    case "halted_on_spend_cap":
      return "Stopped early";
    case "failed":
      return "Acquisition did not finish";
    default:
      return "Acquisition finished";
  }
}

/**
 * **Held while a start is in flight** (UIR-G1). Opening a past run claims the card, and a start
 * that succeeded meanwhile would then never reach it -- the next Start refused as in flight.
 */
function RunHistory({
  runs,
  held,
  onOpen,
}: {
  runs: Run[];
  held: boolean;
  onOpen: (run: Run) => void;
}) {
  if (runs.length === 0)
    return <p className="screen__note">No acquisition has been started yet.</p>;
  return (
    <div className="table-card">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Started</th>
            <th scope="col">Scope</th>
            <th scope="col">Status</th>
            <th scope="col" className="col--right">
              Stored
            </th>
            <th scope="col" className="col--right">
              Failed
            </th>
            <th scope="col" className="col--right">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              {/* **The number is the way in.** A separate Open button in a fifth column is a
                  target to hunt for on every row; the acquisition's own number is what a
                  reader is already looking at, and it is unique, which is what a link needs
                  to be. Sequential, never hexadecimal -- an acquisition is counted. */}
              <th scope="row">
                <HeldButton
                  className="link-button"
                  held={held}
                  onClick={() => onOpen(run)}
                >
                  {run.id}
                </HeldButton>
              </th>
              <td>{formatDateTime(run.started_at)}</td>
              {/* Its size, not its contents: the scope is stored expanded, so a row carries
                  two counts rather than a list of what it covered. */}
              <td className="run-scope">{describeScope(run)}</td>
              <td>
                <span className={`chip chip--${run.run_status}`}>
                  {run.run_status.replace(/_/g, " ")}
                </span>
              </td>
              <td className="col--right">
                {formatCount(run.items_completed)}
              </td>
              {/* **Coloured only when it is not zero.** A column of red noughts would make
                  every past acquisition look like it went wrong. */}
              <td
                className={
                  (run.items_failed ?? 0) > 0
                    ? "col--right run-failed"
                    : "col--right"
                }
              >
                {formatCount(run.items_failed)}
              </td>
              <td className="col--right">{formatMoney(run.cost_eur, "EUR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The run's status as a word, coloured by what it means.
 *
 * **Four statuses, three tones.** A run halted on the spend cap is neither a success nor a
 * failure -- it stopped on purpose and kept everything it had written -- so it reads as a
 * warning rather than borrowing either of the other two.
 */
function RunStatusPill({ status }: { status: string }) {
  return <span className={`pill pill--${statusTone(status)}`}>{status}</span>;
}

function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "good";
    case "failed":
      return "bad";
    case "halted_on_spend_cap":
    case "halted_by_user":
    case "stopping":
      return "warn";
    default:
      return "live";
  }
}

/**
 * Which source got the run where it got to.
 *
 * **Each bar is the source's progress through its own plan**, not a share of one track --
 * see `sourceReach.ts` for why. Drawn as SVG because eslint refuses a `style` attribute under `routes/`, and a width
 * that comes from data belongs to the drawing rather than to the styling.
 */
function SourceBySource({
  reaches,
  state,
  planRecorded,
}: {
  reaches?: readonly SourceReach[] | null;
  state: string;
  planRecorded?: boolean | null;
}) {
  const names = useSourceNames();
  const bars = sourceBars(reaches, names, state);
  if (bars.length === 0) return null;
  const note = planNote(planRecorded);

  return (
    <div className="reach">
      <h3 className="reach__heading">Source by source</h3>
      {note !== "" && <p className="panel__hint">{note}</p>}
      <ul className="reach__list">
        {bars.map((bar) => (
          <li key={bar.source} className="reach__row">
            <span className="reach__source">{bar.name}</span>
            <svg
              className="reach__track"
              viewBox="0 0 100 5"
              preserveAspectRatio="none"
              role="img"
              aria-label={bar.sentence}
            >
              <rect
                className={
                  bar.barren ? "reach__fill reach__fill--barren" : "reach__fill"
                }
                x="0"
                y="0"
                width={bar.width}
                height="5"
              >
                <title>{bar.sentence}</title>
              </rect>
            </svg>
            <span className="reach__reading">{bar.reading}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  /** Why the figure is what it is. A cost with no stated assumptions can only be trusted. */
  note?: string | null;
}) {
  return (
    <div className="stat">
      <dt className="stat__label">
        {label}
        {note !== null && note !== undefined && note !== "" && (
          <abbr className="stat__note" title={note}>
            i
          </abbr>
        )}
      </dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}
