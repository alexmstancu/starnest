import { useCallback, useState } from "react";
import {
  fetchAttributes,
  fetchValuesForAttribute,
  type StoredValue,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { formatDate, formatDateTime } from "../../format/display";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { describeFigure } from "./describeFigure";

/**
 * One attribute, every candidate (`reqs.md` 8.4).
 *
 * **The other axis of the drill-down, and the one that was missing.** The candidate detail
 * answers "what do we know about this country?"; this answers "who has a figure for this at
 * all, and where did each one come from?" -- which is the question behind a pillar that scores
 * badly for want of data rather than for want of merit. Recorded as P69: a v1 requirement that
 * nothing implemented and no document noticed, because every automated check anchors on the
 * contract and the contract was never the thing that lacked it.
 *
 * **Active figures only.** The superseded and rejected ones belong to the candidate's own
 * drill-down, where the question is what happened to a figure; here the question is coverage,
 * and one row per candidate is what answers it.
 */
export function AttributeDrillDown({ levelId }: { levelId: string | null }) {
  const [attribute, setAttribute] = useState<string | null>(null);

  const attributes = useResource(
    useCallback(
      (signal: AbortSignal) => fetchAttributes(levelId ?? "", { signal }),
      [levelId],
    ),
    levelId !== null,
  );
  const values = useResource(
    useCallback(
      (signal: AbortSignal) =>
        fetchValuesForAttribute(attribute ?? "", { signal }),
      [attribute],
    ),
    attribute !== null,
  );

  return (
    <section className="panel" aria-labelledby="attribute-drill-heading">
      <h3 id="attribute-drill-heading" className="panel__heading">
        One attribute, every candidate
      </h3>

      {attributes.resource.status === "loading" && (
        <p className="screen__note">Loading the catalog…</p>
      )}
      {attributes.resource.status === "error" && (
        <ErrorNotice
          error={attributes.resource.error}
          onRetry={attributes.reload}
        />
      )}

      <label className="field">
        <span className="field__label">Attribute</span>
        <select
          className="field__control"
          value={attribute ?? ""}
          onChange={(event) => setAttribute(event.target.value || null)}
          disabled={attributes.resource.status !== "ready"}
        >
          <option value="">Choose an attribute…</option>
          {attributes.resource.status === "ready" &&
            attributes.resource.data.items.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
        </select>
      </label>

      {attribute === null ? (
        <p className="panel__hint">
          Choose an attribute to see which candidates have a figure for it, and
          where each one came from.
        </p>
      ) : values.resource.status === "loading" ? (
        <p className="screen__note">Loading…</p>
      ) : values.resource.status === "error" ? (
        <ErrorNotice error={values.resource.error} onRetry={values.reload} />
      ) : values.resource.status === "ready" ? (
        <AcrossCandidates values={values.resource.data.items} />
      ) : null}
    </section>
  );
}

function AcrossCandidates({ values }: { values: StoredValue[] }) {
  if (values.length === 0) {
    return (
      <p className="screen__note">
        {/* The whole point of this view: an attribute nobody has a figure for is a hole in
            the score, and it says so rather than rendering an empty table. */}
        No candidate has a figure for this attribute. Its weight redistributes
        across the rest of its pillar.
      </p>
    );
  }

  return (
    <>
      <p className="panel__hint">
        {values.length} of the level&apos;s candidates have a figure for this
        attribute.
      </p>
      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col">Figure</th>
              <th scope="col">Source</th>
              <th scope="col">Describes</th>
              <th scope="col">Fetched</th>
              <th scope="col">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {values.map((value) => (
              <tr key={value.id} className="table__row">
                <th scope="row">{value.candidate}</th>
                <td title={value.quote ?? undefined}>
                  {describeFigure(value)}
                </td>
                <td>{value.data_source}</td>
                <td>
                  {formatDate(value.reference_period.start)} to{" "}
                  {formatDate(value.reference_period.end)}
                </td>
                <td>{formatDateTime(value.retrieval_date)}</td>
                <td>
                  <span className={`chip chip--${value.confidence_level}`}>
                    {value.confidence_level}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
