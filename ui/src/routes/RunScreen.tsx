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
import { useResource } from "../api/useResource";
import type { RouteDefinition } from "../app/routes";
import { formatCount, formatDateTime, formatMoney } from "../format/display";
import { ErrorNotice } from "../shell/ErrorNotice";
import { useSelection } from "../shell/SelectionContext";

/**
 * Data acquisition: what a run would do, then what it did (`reqs.md` 6.3, 6.4).
 *
 * **The estimate is shown before anything is fetched, and confirmed.** A run that started on a
 * click would be a run nobody chose to pay for -- and while every source today is free, the
 * confirmation is the mechanism the spend cap hangs off later.
 *
 * **A failure is a thing to act on, not a thing to read.** Each is listed with the source that
 * failed, and one action re-runs only what failed -- a new run, leaving the old one's record
 * intact (`reqs.md` 6.4).
 */
export function RunScreen({ route }: { route: RouteDefinition }) {
  const { levelId } = useSelection();
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [current, setCurrent] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState<
    "planning" | "running" | "retrying" | "asking" | null
  >(null);
  const [failure, setFailure] = useState<unknown>(null);

  const history = useResource(
    useCallback((signal: AbortSignal) => fetchRuns(10, { signal }), []),
  );

  const act = useCallback(
    async (
      what: "planning" | "running" | "retrying" | "asking",
      action: () => Promise<void>,
    ) => {
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
            disabled={busy !== null}
            onClick={() =>
              void act("planning", async () => {
                setCurrent(null);
                setPlan(await planRun({ level: levelId }));
              })
            }
          >
            {busy === "planning" ? "Estimating…" : "Estimate a run"}
          </button>

          {plan && (
            <PlannedRun
              plan={plan}
              busy={busy === "running"}
              onStart={() =>
                void act("running", async () => {
                  const started = await startRun({ level: levelId });
                  setPlan(null);
                  await watch(started);
                })
              }
            />
          )}
        </div>
      )}

      {failure !== null && (
        <ErrorNotice error={failure} onRetry={() => setFailure(null)} />
      )}

      {current && (
        <RunReport
          run={current}
          busy={busy === "retrying"}
          onRefresh={() =>
            void act("planning", async () =>
              setCurrent(await fetchRun(current.id)),
            )
          }
          onRetry={() =>
            void act("retrying", async () => {
              const retried = await retryRun(current.id, "failed");
              await watch(retried);
            })
          }
          asking={busy === "asking"}
          onAskAgain={() =>
            void act("asking", async () => {
              const asked = await retryRun(current.id, "unanswered");
              await watch(asked);
            })
          }
        />
      )}

      <h3 className="panel__heading">Recent runs</h3>
      {history.resource.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {history.resource.status === "error" && (
        <ErrorNotice error={history.resource.error} onRetry={history.reload} />
      )}
      {history.resource.status === "ready" && (
        <RunHistory
          runs={history.resource.data.items}
          onOpen={(run) => void watch(run)}
        />
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
