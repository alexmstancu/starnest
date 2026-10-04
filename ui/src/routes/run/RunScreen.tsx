import { type ReactNode, useId } from "react";
import {
  type Run,
  type RunDetail,
  type RunPlan,
} from "../../api/endpoints";
import { formatCount, formatDateTime, formatMoney } from "../../format/display";
import type { RouteDefinition } from "../../navigation/routes";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
import { AcquisitionDiffPanel } from "./AcquisitionDiffPanel";
import { DatabaseHoldsPanel } from "./DatabaseHoldsPanel";
import { describeGaps, describeScope } from "./databaseHolds";
import { describeFailures } from "./failureGroups";
import { ItemGroups } from "./ItemGroups";
import { OpenToHandEntry } from "./OpenToHandEntry";
import { UnsourcedAttributes } from "./UnsourcedAttributes";
import { type Progress, progressBar } from "./runProgress";
import {
  inFlight,
  outcomeSentence,
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
  const { levelId } = useSelection();
  const run = useRunScreen();

  // Built once and placed in one of two slots, because it is one card either way: the top of
  // the screen while the run is in flight, and inside a fold under the remedies once it is not.
  const report =
    run.current === null ? null : (
      <RunReport
        run={run.current}
        busy={run.busy === "opening"}
        stopping={run.busy === "stopping"}
        onRefresh={run.refresh}
        onDismiss={run.close}
        onStop={run.stop}
      />
    );

  return (
    <section className="screen screen--acquire" aria-labelledby="screen-heading">
      <header className="screen__header">
        <h2 id="screen-heading" className="screen__heading">
          {route.label}
        </h2>
        <p className="screen__summary">
          Where the values come from. Nothing here is fetched or charged until
          you agree to an estimate.
        </p>
      </header>

      {run.failure !== null && (
        <ErrorNotice error={run.failure} onRetry={run.dismissFailure} />
      )}

      {/* **The card leads whenever there is a run, and the design settles why.** It was a
          full-size report with a table of every failure in it, which is what made leading with
          it wrong -- so the first fix here folded it away once the run had finished. The
          prototype does something better: the card is *compact* (a bar, a source breakdown, one
          outcome sentence, and no item lists at all), which costs a reader four lines whether
          the run is going or gone. `acqShow: !!s.acq` in the design's own state -- there is no
          recency window, and Dismiss is what removes it, which is exactly `run.current` and
          `run.close`. The failures live in the card below that can act on them. */}
      {report}

      {run.history.status === "ready" && (
        <DatabaseHoldsPanel runs={run.history.data.items} />
      )}

      {/* ── What you can do about the gaps ───────────────────────────────────────────
          **Three cards, side by side, and the same shape each.** A failure, an item nobody
          answered and a wholesale refresh are three different problems with three different
          remedies, and a reader arriving at this screen is choosing between them. Stacked
          in a column they read as a sequence of steps, which they are not. */}
      <section className="section" aria-labelledby="gaps">
        <header className="section__head">
          <h3 id="gaps" className="section__heading">
            What you can do about the gaps
          </h3>
          <p className="section__lead">{describeGaps(run.current)}</p>
        </header>

        <div className="gap-cards">
          {run.current && (run.current.failures ?? []).length > 0 && (
            <GapCard
              tone="danger"
              count={formatCount(run.current.progress?.items_failed)}
              what="failed"
              lead="A source broke. Worth retrying."
            >
              {/* **The count that answers the complaint, in one line.** "32 failed" reads as
                  thirty-two problems; "1 distinct message" says it is one problem with a wide
                  blast radius, which is the thing a reader can act on. The design has no slot
                  for this -- it is the only thing here the prototype does not describe, kept
                  because a list of 32 identical messages is what sent this screen back. */}
              <p className="gap-card__note">
                {describeFailures(run.current.failures)}
              </p>
              {levelId !== null && (
                <ItemGroups
                  items={run.current.failures ?? []}
                  groupedBy="data_source"
                  caption="Which sources broke"
                  level={levelId}
                  detailKind="failed"
                  act="Retry"
                  busy={run.busy === "planning"}
                  onPropose={(scope, describedAs) =>
                    run.propose(scope, describedAs, "failed")
                  }
                />
              )}
              {/* **"Retry 12 failed", the design's fixed copy.** The count in the label is
                  not decoration: three cards stand side by side and each has an action at its
                  foot, so a label that says only "Retry everything that failed" leaves the
                  reader to look back up at the heading for the size of what they are about to
                  start. */}
              <button
                type="button"
                className="button button--primary"
                disabled={run.busy === "retrying"}
                onClick={() => run.again("failed")}
              >
                {run.busy === "retrying"
                  ? "Retrying…"
                  : `Retry ${formatCount(run.current.progress?.items_failed)} failed`}
              </button>
              <GapEstimate kind="failed" run={run} />
            </GapCard>
          )}

          {run.current && (run.current.unanswered ?? []).length > 0 && (
            <GapCard
              tone="warning"
              count={formatCount(run.current.progress?.items_unanswered)}
              what="unanswered"
              lead="Every source answered, and none had a row. Retrying the same sources changes nothing."
            >
              {levelId !== null && (
                <ItemGroups
                  items={run.current.unanswered ?? []}
                  groupedBy="attribute"
                  caption="Which values went unanswered"
                  level={levelId}
                  detailKind="unanswered"
                  act="Retry"
                  busy={run.busy === "planning"}
                  onPropose={(scope, describedAs) =>
                    run.propose(scope, describedAs, "unanswered")
                  }
                />
              )}
              {/* **"Retry 62 unanswered", and the verb is the design's, not ours.** This read
                  "Ask again about all of them", which drew a distinction the card's own lead
                  already draws -- retrying the same sources changes nothing, so this asks the
                  ones that had no row. The design uses one verb for both buckets and puts the
                  difference in the noun, which is the shorter way to say it. */}
              <button
                type="button"
                className="button"
                disabled={run.busy === "asking"}
                onClick={() => run.again("unanswered")}
              >
                {run.busy === "asking"
                  ? "Retrying…"
                  : `Retry ${formatCount(run.current.progress?.items_unanswered)} unanswered`}
              </button>
              <GapEstimate kind="unanswered" run={run} />
            </GapCard>
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
              <button
                type="button"
                className="button"
                disabled={run.busy !== null}
                onClick={() => run.estimate(levelId)}
              >
                {run.busy === "planning"
                  ? "Estimating…"
                  : "Estimate an acquisition"}
              </button>
              <GapEstimate
                kind="everything"
                run={run}
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

      {/* Beside it, and separate: "no source at all" means nobody would be asked, while these
          are attributes the catalog says a person may answer. The two lists never overlap. */}
      {levelId !== null && <OpenToHandEntry level={levelId} />}

      {run.history.status === "ready" && (
        <AcquisitionDiffPanel runs={run.history.data.items} />
      )}

      <h3 className="panel__heading">Every acquisition so far</h3>
      {run.history.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {run.history.status === "error" && (
        <ErrorNotice error={run.history.error} onRetry={run.reloadHistory} />
      )}
      {run.history.status === "ready" && (
        <RunHistory runs={run.history.data.items} onOpen={run.open} />
      )}
    </section>
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
      <h4 id={headingId} className="gap-card__head">
        {count !== "" && <span className="gap-card__count">{count}</span>}
        <span className="gap-card__what">{what}</span>
      </h4>
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
}: {
  kind: GapKind;
  run: RunScreenState;
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
            <button
              type="button"
              className="button button--primary"
              disabled={run.busy === "running"}
              onClick={onStart}
            >
              {run.busy === "running" ? "Running…" : "Start this acquisition"}
            </button>
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
                <button
                  type="button"
                  className="button button--primary"
                  disabled={run.busy === "running"}
                  onClick={run.commit}
                >
                  {run.busy === "running" ? "Starting…" : "Yes, start it"}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={run.busy === "running"}
                  onClick={run.cancel}
                >
                  Not yet
                </button>
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
              <th scope="row">{source.data_source}</th>
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
  stopping,
  onRefresh,
  onDismiss,
  onStop,
}: {
  run: RunDetail;
  busy: boolean;
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
  return (
    // A labelled region, so "the run report" is something a reader -- or a screen reader --
    // can address, rather than the nearest box that happens to contain the heading.
    <section
      className={going ? "acquisition acquisition--going" : "acquisition"}
      // **Labelled by the acquisition, headed by its state.** The design heads the card with
      // the state because its prototype only ever has the run it just started; this screen can
      // open any run in the history, so the region a reader -- or a test, or a screen reader --
      // addresses has to say *which* acquisition, while the heading says what is happening to
      // it. The number is visible on the line below either way.
      aria-label={`Acquisition ${run.id}`}
    >
      <header className="acquisition__head">
        <h3 className="acquisition__heading">{headingFor(state)}</h3>
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

      <SourceBySource reaches={run.by_source} />

      {outcome !== "" && <p className="acquisition__outcome">{outcome}</p>}

      <footer className="acquisition__foot">
        <span className="acquisition__spend">
          {describeSpend(run.llm_call_count, run.cost_eur)}
        </span>
        <div className="acquisition__acts">
          {/* **Refresh, not a poll.** A run that finished is not going to change, and a screen
              that re-read it every second would spend the reader's backend on nothing. */}
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onRefresh}
          >
            {busy ? "Reading…" : "Refresh"}
          </button>
          {canStop && (
            /* **Says what it keeps, because that is the question.** "Stop" alone reads as
               "throw away what it has done", and the one thing a reader must know before
               clicking is that it does not. The loop reads the request between sources, so
               everything already written stays written. */
            <button
              type="button"
              className="button button--danger"
              disabled={stopping}
              onClick={onStop}
            >
              {stopping ? "Stopping…" : "Stop — keep what completed"}
            </button>
          )}
          {/* Dismiss only once there is nothing left to watch, as the design has it: putting a
              run away while it is still writing values would look like cancelling it. */}
          {!going && (
            <button type="button" className="button" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      </footer>
    </section>
  );
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

function RunHistory({
  runs,
  onOpen,
}: {
  runs: Run[];
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
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpen(run)}
                >
                  {run.id}
                </button>
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
 * **Each bar is its own success rate**, not a share of one track -- see `sourceReach.ts` for
 * why. Drawn as SVG because eslint refuses a `style` attribute under `routes/`, and a width
 * that comes from data belongs to the drawing rather than to the styling.
 */
function SourceBySource({
  reaches,
}: {
  reaches?: readonly SourceReach[] | null;
}) {
  const bars = sourceBars(reaches);
  if (bars.length === 0) return null;

  return (
    <div className="reach">
      <h4 className="reach__heading">Source by source</h4>
      <ul className="reach__list">
        {bars.map((bar) => (
          <li key={bar.source} className="reach__row">
            <span className="reach__source">{bar.source}</span>
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
