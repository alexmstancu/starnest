import {
  type Run,
  type RunDetail,
  type RunPlan,
  type RunScope,
} from "../../api/endpoints";
import { formatCount, formatDateTime, formatMoney } from "../../format/display";
import type { RouteDefinition } from "../../navigation/routes";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
import { AcquisitionDiffPanel } from "./AcquisitionDiffPanel";
import { DatabaseHoldsPanel } from "./DatabaseHoldsPanel";
import { ItemGroups } from "./ItemGroups";
import { UnsourcedAttributes } from "./UnsourcedAttributes";
import { type Progress, progressBar } from "./runProgress";
import { useRunScreen } from "./useRunScreen";

/**
 * Data acquisition: what a run would do, then what it did (`reqs.md` 6.3, 6.4).
 *
 * **A failure is a thing to act on, not a thing to read.** Each is listed with the source that
 * failed, and one action re-runs only what failed. An item nobody answered is listed too, and
 * asked again separately, because nothing failed there (`reqs.md` Q217).
 *
 * **Markup only.** The estimate, the run, the watching and the going-again are
 * `useRunScreen.ts`.
 */
export function RunScreen({ route }: { route: RouteDefinition }) {
  const { levelId } = useSelection();
  const run = useRunScreen();

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

      {/* **The screen opens with what is already known.** Everything under it is about
          changing that, and none of it means anything without the number it would change. */}
      {run.history.status === "ready" && (
        <DatabaseHoldsPanel runs={run.history.data.items} />
      )}

      {levelId === null ? (
        <p className="screen__note">Choose a level to plan an acquisition.</p>
      ) : (
        <div className="panel">
          <h3 className="panel__heading">
            An acquisition over every {levelId} candidate
          </h3>
          <p className="panel__hint">
            The estimate first: what would be fetched, and what it would cost,
            before anything is.
          </p>
          <button
            type="button"
            className="button"
            disabled={run.busy !== null}
            onClick={() => run.estimate(levelId)}
          >
            {run.busy === "planning" ? "Estimating…" : "Estimate an acquisition"}
          </button>

          {run.plan && (
            <PlannedRun
              plan={run.plan}
              busy={run.busy === "running"}
              onStart={() => run.start(levelId)}
            />
          )}

          {/* Nothing that can spend fires on a click. The estimate already said what it would
              cost; this is the step between reading that and it happening. */}
          {run.armed && (
            <SpendConfirmation
              sentence={run.armed.commitment.sentence}
              uncapped={run.armed.commitment.uncapped}
              busy={run.busy === "running"}
              onYes={run.commit}
              onCancel={run.cancel}
            />
          )}
        </div>
      )}

      {run.failure !== null && (
        <ErrorNotice error={run.failure} onRetry={run.dismissFailure} />
      )}

      {run.current && (
        <RunReport
          run={run.current}
          busy={run.busy === "retrying"}
          onRefresh={run.refresh}
          onRetry={() => run.again("failed")}
          asking={run.busy === "asking"}
          onAskAgain={() => run.again("unanswered")}
          level={levelId}
          planning={run.busy === "planning"}
          onPropose={run.propose}
        />
      )}

      {/* Beside the failures deliberately: the three reasons a figure is missing look the
          same in a ranking and have entirely different remedies. */}
      {levelId !== null && <UnsourcedAttributes level={levelId} />}

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

function PlannedRun({
  plan,
  busy,
  onStart,
}: {
  plan: RunPlan;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <div className="panel">
      <h4 className="panel__heading">What this acquisition would do</h4>
      <dl className="stat-list stat-list--inline">
        <Stat label="Items" value={formatCount(plan.items_total)} />
        <Stat label="LLM calls" value={formatCount(plan.llm_call_count)} />
        <Stat
          label="Estimated cost"
          value={formatMoney(plan.estimated_cost_eur, "EUR")}
        />
      </dl>
      {plan.estimate_basis && (
        <p className="screen__note">
          The cost is a ceiling, not a forecast: {plan.estimate_basis}
        </p>
      )}
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
            {(plan.by_source ?? []).map((source) => (
              <tr key={source.data_source}>
                <th scope="row">{source.data_source}</th>
                <td>{formatCount(source.items)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The one filled button in the application. The design reserves the primary for the
          action a screen exists to take, and this screen exists to start a run -- everything
          else here reads, retries or navigates. */}
      <button
        type="button"
        className="button button--primary"
        disabled={busy}
        onClick={onStart}
      >
        {busy ? "Running…" : "Start this acquisition"}
      </button>
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

function SpendConfirmation({
  sentence,
  uncapped,
  busy,
  onYes,
  onCancel,
}: {
  sentence: string;
  uncapped: boolean;
  busy: boolean;
  onYes: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className={
        uncapped ? "notice notice--error" : "notice notice--warning"
      }
      role="alert"
    >
      <p className="notice__message">{sentence}</p>
      <button
        type="button"
        className="button button--primary"
        disabled={busy}
        onClick={onYes}
      >
        {busy ? "Starting…" : "Yes, start it"}
      </button>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

function RunReport({
  run,
  busy,
  onRefresh,
  onRetry,
  asking,
  onAskAgain,
  level,
  planning,
  onPropose,
}: {
  run: RunDetail;
  busy: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  asking: boolean;
  onAskAgain: () => void;
  level: string | null;
  planning: boolean;
  onPropose: (scope: RunScope, describedAs: string) => void;
}) {
  const failures = run.failures ?? [];
  const unanswered = run.unanswered ?? [];
  return (
    // A labelled region, so "the run report" is something a reader -- or a screen reader --
    // can address, rather than the nearest box that happens to contain the heading.
    <section className="panel" aria-labelledby={`run-${run.id}`}>
      <h3 id={`run-${run.id}`} className="panel__heading">
        Acquisition {run.id}
      </h3>
      <dl className="stat-list stat-list--inline">
        <Stat label="Status" value={run.run_status} />
        <Stat label="Started" value={formatDateTime(run.started_at)} />
        <Stat label="Finished" value={formatDateTime(run.finished_at)} />
        <Stat
          label="Answered"
          value={formatCount(run.progress?.items_completed)}
        />
        <Stat label="Of" value={formatCount(run.progress?.items_total)} />
        <Stat label="Failed" value={formatCount(run.progress?.items_failed)} />
        {/* The third count, and the one that closes the arithmetic: asked about, and neither
            answered nor failed. Before `reqs.md` Q217 such an item was in no count at all, so
            a run that learned nothing about a country reported that nothing had failed. */}
        <Stat
          label="Unanswered"
          value={formatCount(run.progress?.items_unanswered)}
        />
      </dl>
      <RunProgress progress={run.progress} />

      <button type="button" className="button" onClick={onRefresh}>
        Refresh
      </button>

      {unanswered.length > 0 && (
        <>
          <div className="table-card">
            <table className="table">
              <caption>
                Asked about, and answered by nobody. Every source that could
                answer did answer, and none of them had a figure for that
                candidate -- which is not a failure and is not a score.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">Attribute</th>
                </tr>
              </thead>
              <tbody>
                {unanswered.map((item) => (
                  <tr key={`${item.candidate}-${item.attribute}`}>
                    <th scope="row">{item.candidate}</th>
                    <td>{item.attribute}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="button"
            disabled={asking}
            onClick={onAskAgain}
          >
            {asking ? "Asking…" : "Ask again about all of them"}
          </button>

          {level !== null && (
            <ItemGroups
              items={unanswered}
              groupedBy="attribute"
              caption="Attributes nobody answered"
              level={level}
              act="Ask again about"
              busy={planning}
              onPropose={onPropose}
            />
          )}
        </>
      )}

      {failures.length === 0 ? (
        <p className="panel__hint">Nothing failed in this acquisition.</p>
      ) : (
        <>
          <div className="table-card">
            <table className="table">
              <caption>
                What went wrong, source by source. A source that failed on one
                attribute may have answered on another.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Attribute</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((item) => (
                  <tr
                    key={`${item.data_source}-${item.candidate}-${item.attribute}`}
                  >
                    <th scope="row">{item.data_source}</th>
                    <td>{item.candidate}</td>
                    <td>{item.attribute}</td>
                    <td>{item.error_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onRetry}
          >
            {busy ? "Retrying…" : "Retry everything that failed"}
          </button>

          {level !== null && (
            <ItemGroups
              items={failures}
              groupedBy="data_source"
              caption="What failed, by source"
              level={level}
              act="Retry"
              busy={planning}
              onPropose={onPropose}
            />
          )}
        </>
      )}
    </section>
  );
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
            <th scope="col">Run</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col">Cost</th>
            <th scope="col"> </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <th scope="row">{run.id}</th>
              <td>
                <span className={`chip chip--${run.run_status}`}>
                  {run.run_status.replace(/_/g, " ")}
                </span>
              </td>
              <td>{formatDateTime(run.started_at)}</td>
              <td>{formatMoney(run.cost_eur, "EUR")}</td>
              <td>
                <button
                  type="button"
                  className="button"
                  onClick={() => onOpen(run)}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}
