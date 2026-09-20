import { useCallback, useState } from "react";
import {
  fetchCriteriaSet,
  fetchExternalScores,
  fetchValues,
  type ExternalScore,
  type StoredValue,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import {
  formatDate,
  formatDateTime,
  formatPercentage,
  formatSigned,
} from "../../format/display";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
import { pillarsByAttribute, valuesInPillar } from "./pillarFilter";
import { type PillarScore, pillarBars } from "./rankTable";

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
  pillars,
}: {
  candidate: string;
  name: string;
  pillars?: readonly PillarScore[] | null;
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
  // The active set is what files an attribute under a pillar, so the filter is that set's
  // opinion rather than the catalog's -- an attribute this set does not score has no pillar,
  // which is the truthful answer rather than a lookup that failed.
  const { criteriaSetId } = useSelection();
  const criteria = useResource(
    useCallback(
      (signal: AbortSignal) => fetchCriteriaSet(criteriaSetId ?? "", { signal }),
      [criteriaSetId],
    ),
    criteriaSetId !== null,
  );
  const [pillar, setPillar] = useState<string | null>(null);
  const byAttribute = pillarsByAttribute(
    criteria.resource.status === "ready"
      ? criteria.resource.data.criteria
      : null,
  );

  return (
    <section className="panel" aria-labelledby="detail-heading">
      <h3 id="detail-heading" className="panel__heading">
        {name}: every figure behind the score
      </h3>

      <PillarContributions
        pillars={pillars}
        chosen={pillar}
        onChoose={(each) => setPillar(each === pillar ? null : each)}
      />

      {values.resource.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}
      {values.resource.status === "error" && (
        <ErrorNotice error={values.resource.error} onRetry={values.reload} />
      )}
      {values.resource.status === "ready" && (
        <ValueTable
          values={valuesInPillar(
            values.resource.data.items,
            byAttribute,
            pillar,
          )}
          pillar={pillar}
        />
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
      {(external.resource.status === "loading" ||
        external.resource.status === "idle") && (
        <p className="screen__note">Loading…</p>
      )}
      {external.resource.status === "ready" && (
        <ExternalScoreTable scores={external.resource.data.items} />
      )}
    </section>
  );
}

function ValueTable({
  values,
  pillar,
}: {
  values: StoredValue[];
  pillar: string | null;
}) {
  if (values.length === 0) {
    return (
      <p className="screen__note">
        {pillar === null
          ? "No figure has been stored for this candidate yet."
          : `No figure has been stored for anything in ${pillar}.`}
      </p>
    );
  }
  return (
    <div className="table-card">
      <table className="table">
        <caption>
          Every stored value, the active one marked. A superseded figure is
          kept, never deleted.
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
              <td>
                <span className={`chip chip--${value.confidence_level}`}>
                  {value.confidence_level}
                </span>
              </td>
              {/* Three states, and the design gives each its own tint: a figure being scored, one
                a better source displaced, and one the catalog refused. They are not degrees of
                the same thing, which one column of plain words made them look like. */}
              <td>
                {value.is_active ? (
                  <span className="chip chip--accent">Scored</span>
                ) : value.rejection_reason ? (
                  <span className="chip chip--not_matching">Rejected</span>
                ) : (
                  <span className="chip chip--neutral">Superseded</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What each pillar put into the total, as the cards the design draws.
 *
 * **The same `pillar_scores` the ranking row's chart reads**, so the chart and the cards can
 * never disagree -- they are one number rendered twice. A pillar with no score says so in
 * words here, where the chart only has a flat bar to say it with.
 */
function PillarContributions({
  pillars,
  chosen,
  onChoose,
}: {
  pillars?: readonly PillarScore[] | null;
  chosen: string | null;
  onChoose: (pillar: string) => void;
}) {
  const bars = pillarBars(pillars);
  if (bars.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="pillar-contributions">
      <h4 id="pillar-contributions" className="panel__heading">
        Pillar contributions — select one to filter the values below
      </h4>
      <ul className="pillar-cards">
        {(pillars ?? []).map((pillar, at) => (
          <li key={pillar.pillar}>
            <button
              type="button"
              className={
                chosen === pillar.pillar
                  ? "pillar-card pillar-card--chosen"
                  : "pillar-card"
              }
              aria-pressed={chosen === pillar.pillar}
              onClick={() => onChoose(pillar.pillar)}
            >
              <div className="pillar-card__head">
                <span className="pillar-card__name">{pillar.pillar}</span>
                <span className="pillar-card__score">
                  {typeof pillar.score === "number" ? pillar.score : "No score"}
                </span>
              </div>
              <svg
                className="pillar-card__track"
                viewBox="0 0 100 4"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect
                  className={`pillar-card__fill pillar-card__fill--${bars[at]?.tone ?? "none"}`}
                  width={
                    typeof pillar.score === "number" ? `${pillar.score}%` : "0%"
                  }
                  height="4"
                />
              </svg>
              <div className="pillar-card__foot">
                <span>weight {formatPercentage(pillar.weight)}</span>
                <span>{formatSigned(pillar.contribution)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
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
          // A publisher may have more than one opinion of a candidate: the natural key in
          // `external_score` is the publisher, the period and the moment it was read, so the
          // key here is the same one. Keyed on publisher alone, two Numbeo indices for one
          // country collided and React rendered one of them twice.
          <tr
            key={[
              score.data_source,
              score.reference_period?.start ?? "",
              score.retrieval_date ?? "",
            ].join("-")}
          >
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
  // **An index carries its bounds, because the bounds are what make it mean anything** (P57).
  // `reqs.md` reserves `Index` for figures whose scale does the work -- a World Bank governance
  // figure of 1.07 sits on -2.5 to 2.5, and printed bare it reads like a percentage. This
  // branch and the next were duplicates, so both types lost everything but the number.
  if ("value" in payload && "provider" in payload)
    return (
      `${String(payload["value"])} on ${String(payload["scale_min"])}` +
      `–${String(payload["scale_max"])} (${String(payload["provider"])})`
    );
  // An assigned score carries its range and who assigned it: a 7 out of 10 from a model is a
  // different claim from a 7 out of 10 somebody wrote down (`reqs.md` 3.3a).
  if ("value" in payload && "assigned_by" in payload)
    return (
      `${String(payload["value"])} on ${String(payload["range_min"])}` +
      `–${String(payload["range_max"])} (assigned by ${String(payload["assigned_by"])})`
    );
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
