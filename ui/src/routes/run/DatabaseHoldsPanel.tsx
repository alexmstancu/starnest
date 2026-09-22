import { useCallback } from "react";
import { fetchRun, fetchSettings, type Run } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { formatCount, formatDateTime, formatMoney } from "../../format/display";
import {
  filledOf,
  newestRun,
  runningNow,
  spentThisMonth,
} from "./databaseHolds";

/**
 * What the database holds, at the top of Acquire.
 *
 * **The screen opens with what is already known.** Every other section here is about changing
 * that -- retrying what broke, asking again about what nobody answered, refreshing what has
 * aged -- and none of them mean anything without the number they would change. The design
 * leads with this for that reason, and so does this.
 *
 * **Four figures, each one a sum over what the API returned.** Nothing here is estimated.
 * What the last acquisition filled and failed to fill is that acquisition's own accounting
 * (`items_completed`, `items_failed` and `items_unanswered` sum to `items_total`, derived in
 * SQL rather than stored, Q217); what has been spent this month is an addition of costs the
 * server recorded against each run.
 */
export function DatabaseHoldsPanel({ runs }: { runs: readonly Run[] }) {
  const newest = newestRun(runs);
  const running = runningNow(runs);
  const newestId = newest?.id;

  return (
    <section className="panel" aria-labelledby="database-holds">
      <div className="panel__head">
        <h3 id="database-holds" className="panel__heading">
          What the database holds
        </h3>
        <dl className="meta-row">
          <Meta
            label="Last filled by"
            value={
              newest === undefined ? "Nothing yet" : `Acquisition ${newest.id}`
            }
          />
          <Meta
            label="Finished"
            value={
              newest?.finished_at == null
                ? "—"
                : formatDateTime(newest.finished_at)
            }
          />
          {/* **One at a time**, which the API enforces rather than this screen: starting a
              second acquisition while one is in flight is refused. */}
          <Meta
            label="Running now"
            value={
              running === undefined
                ? "None — one at a time"
                : `Acquisition ${running.id}`
            }
          />
        </dl>
      </div>

      {/* **Keyed by the acquisition it reads.** The figures belong to one run, so a newer one
          starts them again rather than leaving the previous run's counts on screen while the
          new ones arrive. Rendered only when there has been one, so the fetch never has to
          ask about a run that does not exist. */}
      {newestId === undefined ? (
        <p className="panel__hint">
          Nothing has been acquired yet, so the database holds no values. An
          estimate below says what a first acquisition would fetch.
        </p>
      ) : (
        <Figures key={newestId} runId={newestId} runs={runs} />
      )}
    </section>
  );
}

/**
 * What one acquisition reached, and what the month has cost.
 *
 * Separate from the panel because it asks about a particular run: a component that fetches
 * only sometimes has to express "sometimes" as a rejected promise, and the memoisation the
 * React compiler wants cannot survive that.
 */
function Figures({ runId, runs }: { runId: number; runs: readonly Run[] }) {
  const detail = useResource(
    useCallback(
      (signal: AbortSignal) => fetchRun(runId, { signal }),
      [runId],
    ),
  );
  const settings = useResource(
    useCallback((signal: AbortSignal) => fetchSettings({ signal }), []),
  );

  const progress =
    detail.resource.status === "ready" ? detail.resource.data.progress : null;
  const { filled, asked } = filledOf(progress);
  const cap =
    settings.resource.status === "ready"
      ? settings.resource.data.run_spend_cap_eur
      : null;

  return (
      <div className="big-stats">
        <BigStat
          label="Values filled"
          value={formatCount(filled)}
          note={`of ${formatCount(asked)} the last acquisition asked for`}
        />
        <BigStat
          label="Nobody answered"
          value={formatCount(progress?.items_unanswered ?? 0)}
          note="every source was asked and none had a row"
          tone={
            (progress?.items_unanswered ?? 0) > 0 ? "warning" : undefined
          }
        />
        <BigStat
          label="Failed"
          value={formatCount(progress?.items_failed ?? 0)}
          note="a source broke, so these are worth retrying"
          tone={(progress?.items_failed ?? 0) > 0 ? "danger" : undefined}
        />
        <BigStat
          label="Spent this month"
          value={formatMoney(spentThisMonth(runs, new Date()), "EUR")}
          note={
            cap == null
              ? "no cap is set, so an acquisition that would spend refuses"
              : `the cap is ${formatMoney(cap, "EUR")} per acquisition`
          }
        />
      </div>
  );
}

function BigStat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "warning" | "danger";
}) {
  return (
    <div className={tone ? `big-stat big-stat--${tone}` : "big-stat"}>
      <span className="big-stat__label">{label}</span>
      <span className="big-stat__value">{value}</span>
      <span className="big-stat__note">{note}</span>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-row__item">
      <dt className="meta-row__label">{label}</dt>
      <dd className="meta-row__value">{value}</dd>
    </div>
  );
}
