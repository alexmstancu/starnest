import { useCallback, useId, useState } from "react";
import {
  type Run,
  fetchRun,
  fetchValuesFromRun,
  fetchValuesReconfirmedByRun,
} from "../../api/endpoints";
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
import {
  accountedFor,
  askedOfSources,
  describeLeftOut,
  describeNotReached,
  describeRecord,
  diffAcquisitions,
  levelHeading,
  producedBy,
  progressOf,
  readsBackwards,
  runIdFrom,
} from "./acquisitionDiff";
import { describeScope } from "./databaseHolds";
import { useVersionOf } from "./useVersionOf";

/**
 * One run's record, as the diff reads it (PL-049): its detail, the values it stored and the
 * values it re-confirmed -- a re-read that restates a figure on record writes no row.
 */
async function readRun(run: number, signal: AbortSignal) {
  const [detail, stored, reconfirmed] = await Promise.all([
    fetchRun(run, { signal }),
    fetchValuesFromRun(run, { signal }),
    fetchValuesReconfirmedByRun(run, { signal }),
  ]);
  const produced = producedBy({
    stored: stored.items,
    reconfirmed: detail.reconfirmed ?? [],
    reconfirmedValues: reconfirmed.items,
  });
  return { detail, produced };
}

/**
 * What changed between two acquisitions.
 *
 * **It compares what the two runs produced, not what the store holds**, and only over the values
 * the later one asked for (PL-060). "Went missing" means the later run asked and produced no
 * usable figure for that pair -- never that the figure is gone. The earlier value is still
 * stored, still in the drill-down, and may still be the active one; this application does not
 * delete values (`reqs.md` 3.6), and a screen implying otherwise would be claiming a thing that
 * never happens.
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
  const samePick = earlier !== null && earlier === later;

  // Read again when either run may have moved on, which a refresh of the history reveals
  // (UIR-A1, RB-3). `runs` is a new list only when the history has been read again.
  const historyReads = useVersionOf(runs);
  const freshness = useVersionOf(progressOf(runs, [earlier, later], historyReads));

  const values = useRead(
    useCallback(
      async (signal: AbortSignal) => {
        if (earlier === null || later === null) throw new Error("no pair chosen");
        const [before, after] = await Promise.all([
          readRun(earlier, signal),
          readRun(later, signal),
        ]);
        const asked = askedOfSources(after.produced, after.detail.failures ?? []);
        const diff = diffAcquisitions(before.produced, after.produced, asked);
        return {
          ...diff,
          leftOutNote: describeLeftOut(diff.leftOut),
          notReachedNote: describeNotReached(after.detail),
          record: describeRecord(
            accountedFor(after.produced, after.detail),
            after.detail,
          ),
          level: after.detail.scope?.level,
        };
      },
      [earlier, later],
    ),
    { enabled: earlier !== null && later !== null && !samePick, freshness },
  );

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel__heading">
        What changed between two acquisitions
      </h2>
      <p className="panel__hint">
        What each acquisition produced — the figures it stored and the ones it
        re-confirmed — compared over what the later one asked each source for.
        &ldquo;Went missing&rdquo; means the later acquisition asked and produced
        no usable figure — the earlier figure is still stored and may still be
        the one being scored.
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

      {samePick ? (
        <p className="notice notice--error" role="alert">
          Pick two different acquisitions.
        </p>
      ) : values.read.state === "idle" ? (
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
              {earlier !== null && later !== null && readsBackwards(runs, earlier, later) && (
                <p className="notice notice--warning">
                  Acquisition {earlier} started after acquisition {later}, so this
                  reads backwards in time.
                </p>
              )}
              {diff.record !== null && <p className="screen__note">{diff.record}</p>}
              {/* **Four counts, not three.** "Refreshed" used to mean both "the figure moved" and
                  "the same figure came back", which are different answers to the only question
                  this panel asks. A run that re-fetched a thousand figures and moved none of them
                  cost something and changed nothing, and one count hid exactly that. */}
              <dl className="tiles">
                <Tile
                  label="Newly acquired"
                  value={formatCount(diff.newlyAcquired)}
                  note="No figure in the earlier acquisition, one in the later"
                />
                <Tile
                  label="Refreshed"
                  value={formatCount(diff.refreshed)}
                  note="Asked again and the figure moved"
                />
                <Tile
                  label="Unchanged"
                  value={formatCount(diff.unchanged)}
                  note="Asked again and the same figure came back"
                />
                <Tile
                  label="Went missing"
                  value={formatCount(diff.wentMissing)}
                  note="The later acquisition produced none; the earlier figure is still stored"
                />
              </dl>
              {diff.notReachedNote !== null && (
                <p className="screen__note">{diff.notReachedNote}</p>
              )}
              {diff.leftOutNote !== null && (
                <p className="screen__note">{diff.leftOutNote}</p>
              )}

              {diff.rows.length === 0 ? (
                <p className="screen__note">
                  Neither acquisition produced a usable figure for anything the
                  later one asked for, so there is nothing to compare. Two runs that
                  produced the same figures are not empty — each reads as unchanged.
                </p>
              ) : (
                <div className="table-card">
                  <table className="table" aria-label="What changed">
                    <thead>
                      <tr>
                        <th scope="col">{levelHeading(diff.level)}</th>
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
                        <tr key={`${row.candidate}-${row.attribute}-${row.data_source ?? ""}`}>
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

/** The design's picker line: the acquisition, when, and how big it was (C04-N14). */
function labelFor(run: Run): string {
  const scope = describeScope(run);
  const label = `Acquisition ${run.id} — ${formatDateTime(run.started_at)}`;
  return scope === "—" ? label : `${label} (${scope})`;
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
