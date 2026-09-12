import { type Run, type RunDetail, type RunPlan } from "../../api/endpoints";
import { formatCount, formatDateTime, formatMoney } from "../../format/display";
import type { RouteDefinition } from "../../navigation/routes";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
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
    <section className="screen" aria-labelledby="screen-heading">
      <h2 id="screen-heading" className="screen__heading">
        {route.label}
      </h2>

      {levelId === null ? (
        <p className="screen__note">Choose a level to plan a run.</p>
      ) : (
        <div className="panel">
          <h3 className="panel__heading">
            A run over every {levelId} candidate
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
            {run.busy === "planning" ? "Estimating…" : "Estimate a run"}
          </button>

          {run.plan && (
            <PlannedRun
              plan={run.plan}
              busy={run.busy === "running"}
              onStart={() => run.start(levelId)}
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
        />
      )}

      <h3 className="panel__heading">Recent runs</h3>
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
      <h4 className="panel__heading">What this run would do</h4>
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
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={onStart}
      >
        {busy ? "Running…" : "Start this run"}
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
}: {
  run: RunDetail;
  busy: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  asking: boolean;
  onAskAgain: () => void;
}) {
  const failures = run.failures ?? [];
  const unanswered = run.unanswered ?? [];
  return (
    <div className="panel">
      <h3 className="panel__heading">Run {run.id}</h3>
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
      <button type="button" className="button" onClick={onRefresh}>
        Refresh
      </button>

      {unanswered.length > 0 && (
        <>
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
          <button
            type="button"
            className="button"
            disabled={asking}
            onClick={onAskAgain}
          >
            {asking ? "Asking…" : "Ask again"}
          </button>
        </>
      )}

      {failures.length === 0 ? (
        <p className="panel__hint">Nothing failed in this run.</p>
      ) : (
        <>
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
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onRetry}
          >
            {busy ? "Retrying…" : "Retry only what failed"}
          </button>
        </>
      )}
    </div>
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
    return <p className="screen__note">No run has been started yet.</p>;
  return (
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
            <td>{run.run_status}</td>
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
