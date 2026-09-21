import { useCallback, useId, useState } from "react";
import { type Run, fetchValuesFromRun } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { formatCount, formatDateTime } from "../../format/display";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { diffAcquisitions, runIdFrom } from "./acquisitionDiff";

/**
 * What changed between two acquisitions.
 *
 * **It compares what the two runs produced, not what the store holds.** "Went missing" means
 * the later run did not produce a figure for that pair -- never that the figure is gone. The
 * earlier value is still stored, still in the drill-down, and may still be the active one;
 * this application does not delete values (`reqs.md` 3.6), and a screen implying otherwise
 * would be claiming a thing that never happens.
 */
export function AcquisitionDiffPanel({ runs }: { runs: readonly Run[] }) {
  const headingId = useId();
  const earlierId = useId();
  const laterId = useId();
  const [earlier, setEarlier] = useState<number | null>(null);
  const [later, setLater] = useState<number | null>(null);

  const values = useResource(
    useCallback(
      async (signal: AbortSignal) => {
        if (earlier === null || later === null) throw new Error("no pair chosen");
        // Two requests, one per run. The filter is what keeps this from being a walk of the
        // whole corpus.
        const [before, after] = await Promise.all([
          fetchValuesFromRun(earlier, { signal }),
          fetchValuesFromRun(later, { signal }),
        ]);
        return diffAcquisitions(before.items, after.items);
      },
      [earlier, later],
    ),
    earlier !== null && later !== null,
  );

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        What changed between two acquisitions
      </h3>
      <p className="panel__hint">
        What each run produced, compared. &ldquo;Went missing&rdquo; means the
        later run did not produce a figure for that pair — the earlier figure is
        still stored and may still be the one being scored.
      </p>

      <div className="diff__pick">
        <label className="field">
          <span className="field__label" id={earlierId}>
            Earlier acquisition
          </span>
          <select
            className="field__control"
            aria-labelledby={earlierId}
            value={earlier ?? ""}
            onChange={(event) => setEarlier(runIdFrom(event.target.value))}
          >
            <option value="">Choose a run…</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {labelFor(run)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label" id={laterId}>
            Later acquisition
          </span>
          <select
            className="field__control"
            aria-labelledby={laterId}
            value={later ?? ""}
            onChange={(event) => setLater(runIdFrom(event.target.value))}
          >
            <option value="">Choose a run…</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {labelFor(run)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {values.resource.status === "idle" && (
        <p className="screen__note">Choose two acquisitions to compare.</p>
      )}
      {values.resource.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {values.resource.status === "error" && (
        <ErrorNotice error={values.resource.error} onRetry={values.reload} />
      )}

      {values.resource.status === "ready" && (
        <>
          <dl className="stat-list stat-list--inline">
            <Stat
              label="Newly acquired"
              value={formatCount(values.resource.data.newlyAcquired)}
            />
            <Stat
              label="Refreshed"
              value={formatCount(values.resource.data.refreshed)}
            />
            <Stat
              label="Went missing"
              value={formatCount(values.resource.data.wentMissing)}
            />
          </dl>

          {values.resource.data.rows.length === 0 ? (
            <p className="screen__note">
              Neither acquisition produced a figure for any candidate, so there
              is nothing to compare. Two runs that produced the same pairs are
              not empty — every pair reads as refreshed.
            </p>
          ) : (
            <div className="table-card">
              <table className="table" aria-label="What changed">
                <thead>
                  <tr>
                    <th scope="col">Candidate</th>
                    <th scope="col">Attribute</th>
                    <th scope="col">Source</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {values.resource.data.rows.map((row) => (
                    <tr key={`${row.candidate}-${row.attribute}-${row.change}`}>
                      <th scope="row">{row.candidate}</th>
                      <td>{row.attribute}</td>
                      <td>{row.data_source ?? "—"}</td>
                      <td>
                        <span className={`chip ${chipFor(row.change)}`}>
                          {row.change}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Three outcomes, three tints: they are three different facts, not degrees of one. */
function chipFor(change: string): string {
  if (change === "newly acquired") return "chip--accent";
  if (change === "refreshed") return "chip--neutral";
  return "chip--not_matching";
}

function labelFor(run: Run): string {
  return `Run ${run.id} — ${formatDateTime(run.started_at)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}
