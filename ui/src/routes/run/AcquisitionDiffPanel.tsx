import { useCallback, useId, useState } from "react";
import { type Run, fetchValuesFromRun } from "../../api/endpoints";
import { useAttributeNames } from "../../api/useAttributeNames";
import { useCandidateNames } from "../../api/useCandidateNames";
import { useRead } from "../../api/useRead";
import { useSourceNames } from "../../api/useSourceNames";
import {
  attributeName,
  candidateName,
  formatCount,
  formatDateTime,
  sourceName,
} from "../../format/display";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { diffAcquisitions, progressOf, runIdFrom } from "./acquisitionDiff";
import { useVersionOf } from "./useVersionOf";

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
  const attributes = useAttributeNames();
  const candidates = useCandidateNames();
  const sources = useSourceNames();

  // Read again when either run may have moved on, which a refresh of the history reveals
  // (UIR-A1, RB-3). `runs` is a new list only when the history has been read again.
  const historyReads = useVersionOf(runs);
  const freshness = useVersionOf(progressOf(runs, [earlier, later], historyReads));

  const values = useRead(
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
    { enabled: earlier !== null && later !== null, freshness },
  );

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel__heading">
        What changed between two acquisitions
      </h2>
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
            <option value="">Choose an acquisition…</option>
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
            <option value="">Choose an acquisition…</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {labelFor(run)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {values.read.state === "idle" ? (
        <p className="screen__note">Choose two acquisitions to compare.</p>
      ) : (
        <LoadedRegion
          read={values.read}
          what="The comparison"
          skeleton="lines"
          prominence="region"
          onRetry={values.reload}
        >
          {(diff) => (
            <>
              {/* **Four counts, not three.** "Refreshed" used to mean both "the figure moved" and
                  "the same figure came back", which are different answers to the only question
                  this panel asks. A run that re-fetched a thousand figures and moved none of them
                  cost something and changed nothing, and one count hid exactly that. */}
              <dl className="tiles">
                <Tile
                  label="Newly acquired"
                  value={formatCount(diff.newlyAcquired)}
                  note="No figure for that pair before this run"
                />
                <Tile
                  label="Refreshed"
                  value={formatCount(diff.refreshed)}
                  note="A figure that moved"
                />
                <Tile
                  label="Unchanged"
                  value={formatCount(diff.unchanged)}
                  note="Re-fetched and identical"
                />
                <Tile
                  label="Went missing"
                  value={formatCount(diff.wentMissing)}
                  note="The later run produced none — the earlier figure is still stored"
                />
              </dl>

              {diff.rows.length === 0 ? (
                <p className="screen__note">
                  Neither acquisition produced a figure for any candidate, so there
                  is nothing to compare. Two runs that produced the same pairs are
                  not empty — every pair reads as refreshed or unchanged.
                </p>
              ) : (
                <div className="table-card">
                  <table className="table" aria-label="What changed">
                    <thead>
                      <tr>
                        <th scope="col">Candidate</th>
                        <th scope="col">Attribute</th>
                        <th scope="col">Source</th>
                        {/* The two figures themselves, which is what makes the verdict in the
                            last column checkable rather than something to take on trust. */}
                        <th scope="col" className="col--right">
                          Earlier
                        </th>
                        <th scope="col" className="col--right">
                          Later
                        </th>
                        <th scope="col">What happened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.rows.map((row) => (
                        <tr key={`${row.candidate}-${row.attribute}-${row.change}`}>
                          <th scope="row">
                            {candidateName(candidates, row.candidate)}
                          </th>
                          <td>{attributeName(attributes, row.attribute)}</td>
                          <td>
                            {row.data_source == null
                              ? "—"
                              : sourceName(sources, row.data_source)}
                          </td>
                          <td className="col--right">{row.earlier ?? "—"}</td>
                          <td className="col--right">{row.later ?? "—"}</td>
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
        </LoadedRegion>
      )}
    </section>
  );
}

/** Four outcomes, four tints: they are four different facts, not degrees of one. */
function chipFor(change: string): string {
  if (change === "newly acquired") return "chip--accent";
  if (change === "refreshed") return "chip--neutral";
  // A figure that did not move is the quietest thing on the screen, and reads that way.
  if (change === "unchanged") return "chip--quiet";
  return "chip--not_matching";
}

function labelFor(run: Run): string {
  return `Acquisition ${run.id} — ${formatDateTime(run.started_at)}`;
}

/** A count with what it counts said underneath, because "refreshed" alone is ambiguous. */
function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="tile">
      <dt className="tile__label">{label}</dt>
      <dd className="tile__value">{value}</dd>
      <dd className="tile__note">{note}</dd>
    </div>
  );
}
