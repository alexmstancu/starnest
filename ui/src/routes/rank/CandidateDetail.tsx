import { useCallback } from "react";
import {
  fetchExternalScores,
  fetchValues,
  type ExternalScore,
  type StoredValue,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { formatDate, formatDateTime } from "../../format/display";
import { ErrorNotice } from "../../shell/ErrorNotice";

/**
 * One candidate's evidence: every stored value, and the outside indices beside them.
 *
 * **Every value, not only the one being scored** (`reqs.md` 3.6). The figure in use, the ones
 * it supersedes and any that were rejected are all here with their source, both dates and their
 * confidence -- which is what makes "nothing is ever discarded" something a reader can check
 * rather than a claim in a document.
 *
 * **External scores sit apart, and must keep sitting apart** (`reqs.md` 3.5a). They are
 * published composites shown beside our numbers and never fed into them; putting them in the
 * same table would be the first step towards scoring them.
 */
export function CandidateDetail({
  candidate,
  name,
}: {
  candidate: string;
  name: string;
}) {
  const values = useResource(
    useCallback(
      (signal: AbortSignal) => fetchValues(candidate, { signal }),
      [candidate],
    ),
  );
  const external = useResource(
    useCallback(
      (signal: AbortSignal) => fetchExternalScores(candidate, { signal }),
      [candidate],
    ),
  );

  return (
    <section className="panel" aria-labelledby="detail-heading">
      <h3 id="detail-heading" className="panel__heading">
        {name}: every figure behind the score
      </h3>

      {values.resource.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {values.resource.status === "error" && (
        <ErrorNotice error={values.resource.error} onRetry={values.reload} />
      )}
      {values.resource.status === "ready" && (
        <ValueTable values={values.resource.data.items} />
      )}

      <h4 className="panel__heading">Outside opinions</h4>
      <p className="panel__hint">
        Published composites, shown beside the score and never counted in it.
      </p>
      {external.resource.status === "error" && (
        <ErrorNotice
          error={external.resource.error}
          onRetry={external.reload}
        />
      )}
      {external.resource.status === "ready" && (
        <ExternalScoreTable scores={external.resource.data.items} />
      )}
    </section>
  );
}

function ValueTable({ values }: { values: StoredValue[] }) {
  if (values.length === 0) {
    return (
      <p className="screen__note">
        No figure has been stored for this candidate yet.
      </p>
    );
  }
  return (
    <table className="table">
      <caption>
        Every stored value, the active one marked. A superseded figure is kept,
        never deleted.
      </caption>
      <thead>
        <tr>
          <th scope="col">Attribute</th>
          <th scope="col">Figure</th>
          <th scope="col">Source</th>
          <th scope="col">Describes</th>
          <th scope="col">Fetched</th>
          <th scope="col">Confidence</th>
          <th scope="col">In use</th>
        </tr>
      </thead>
      <tbody>
        {values.map((value) => (
          <tr
            key={value.id}
            className={
              value.is_active
                ? "table__row"
                : "table__row table__row--superseded"
            }
          >
            <th scope="row">{value.attribute}</th>
            <td title={value.quote ?? undefined}>{describeFigure(value)}</td>
            <td>{value.data_source}</td>
            <td>
              {formatDate(value.reference_period.start)} to{" "}
              {formatDate(value.reference_period.end)}
            </td>
            <td>{formatDateTime(value.retrieval_date)}</td>
            <td>{value.confidence_level}</td>
            <td>
              {value.is_active
                ? "Scored"
                : value.rejection_reason
                  ? "Rejected"
                  : "Superseded"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExternalScoreTable({ scores }: { scores: ExternalScore[] }) {
  if (scores.length === 0) {
    return (
      <p className="screen__note">
        No outside index has been stored for this candidate.
      </p>
    );
  }
  return (
    <table className="table table--external">
      <caption>Not part of any score.</caption>
      <thead>
        <tr>
          <th scope="col">Publisher</th>
          <th scope="col">Published</th>
          <th scope="col">Scale</th>
          <th scope="col">Caveats</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((score) => (
          <tr key={`${score.data_source}-${score.candidate}`}>
            <th scope="row">{score.data_source}</th>
            <td>
              {score.published_value ?? "—"}
              {score.published_rank != null &&
                ` (rank ${score.published_rank})`}
            </td>
            <td>{score.published_scale}</td>
            <td>{score.caveats ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A payload as one line. **The shape follows the value type**, which is the server's word for
 * what the figure is; nothing here converts, rounds or rescales it.
 */
function describeFigure(value: StoredValue): string {
  const payload = value.payload as Record<string, unknown>;
  if ("magnitude" in payload)
    return `${String(payload["magnitude"])} ${String(payload["unit"])}`;
  if ("amount_eur" in payload)
    return `${String(payload["amount"])} ${String(payload["currency"])}`;
  if ("value" in payload && "provider" in payload)
    return String(payload["value"]);
  if ("value" in payload) return String(payload["value"]);
  if ("count" in payload) return String(payload["count"]);
  if ("labels" in payload) return (payload["labels"] as string[]).join(", ");
  if ("body" in payload) return String(payload["body"]);
  if ("shares" in payload)
    return (payload["shares"] as { label: string; share: number }[])
      .map((share) => `${share.label} ${share.share}%`)
      .join(", ");
  return "—";
}
