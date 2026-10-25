import { useCandidateNames } from "../../api/useCandidateNames";
import { useCallback, useState } from "react";
import {
  fetchAttributes,
  fetchCriteriaSet,
  fetchValuesForAttribute,
  type Attribute,
  type StoredValue,
} from "../../api/endpoints";
import { useRead } from "../../api/useRead";
import { useSourceNames } from "../../api/useSourceNames";
import {
  formatDate,
  formatDateTime,
  candidateName,
  sourceName,
} from "../../format/display";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { useSelection } from "../../shell/SelectionContext";
import { describeFigure } from "../../format/figure";
import { describeFigureCount } from "./figureCount";
import { judgementsByAttribute } from "./pillarFilter";
import { ConfidenceChip } from "./ConfidenceChip";

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
export function AttributeDrillDown({
  levelId,
  criteriaSetId,
  rosterSize,
}: {
  levelId: string | null;
  criteriaSetId: string | null;
  /** How many candidates the level has, once its roster has arrived. */
  rosterSize?: number;
}) {
  const [attribute, setAttribute] = useState<string | null>(null);
  const { acquisitionsEnded } = useSelection();

  const attributes = useRead(
    useCallback(
      (signal: AbortSignal) => fetchAttributes(levelId ?? "", { signal }),
      [levelId],
    ),
    { enabled: levelId !== null },
  );
  // Read again when an acquisition ends (UI-11), kept on screen meanwhile (PL-010).
  const values = useRead(
    useCallback(
      (signal: AbortSignal) =>
        fetchValuesForAttribute(attribute ?? "", { signal }),
      [attribute],
    ),
    { enabled: attribute !== null, freshness: acquisitionsEnded },
  );
  // **Whether the active set scores it**, which only the set can say: a descriptive attribute
  // or an excluded one has no weight to spread. A silent read -- the figures stand without it,
  // and saying nothing about weight is true until it arrives.
  const set = useRead(
    useCallback(
      (signal: AbortSignal) => fetchCriteriaSet(criteriaSetId ?? "", { signal }),
      [criteriaSetId],
    ),
    { enabled: criteriaSetId !== null },
  );
  const scored =
    attribute !== null &&
    set.read.state === "ready" &&
    judgementsByAttribute(set.read.data.criteria).get(attribute)?.scored === true;

  return (
    <section className="panel" aria-labelledby="attribute-drill-heading">
      <h2 id="attribute-drill-heading" className="panel__heading">
        One attribute, every candidate
      </h2>

      {/* **The choice is drawn from the catalog once it is read**, never an empty list that
          reads as a level with nothing to measure (PL-001). */}
      {attributes.read.state !== "idle" && (
        <LoadedRegion
          read={attributes.read}
          what="The list of attributes"
          skeleton="lines"
          onRetry={attributes.reload}
        >
          {(catalog) => (
            <AttributePicker
              attributes={catalog.items}
              attribute={attribute}
              onChoose={setAttribute}
            />
          )}
        </LoadedRegion>
      )}

      {attribute !== null && values.read.state !== "idle" && (
        <LoadedRegion
          read={values.read}
          what="The figures for this attribute"
          skeleton="rank-table"
          onRetry={values.reload}
        >
          {(figures) => (
            <AcrossCandidates
              values={figures.items}
              rosterSize={rosterSize}
              scored={scored}
            />
          )}
        </LoadedRegion>
      )}
    </section>
  );
}

function AttributePicker({
  attributes,
  attribute,
  onChoose,
}: {
  attributes: readonly Attribute[];
  attribute: string | null;
  onChoose: (attribute: string | null) => void;
}) {
  return (
    <>
      <label className="field">
        <span className="field__label">Attribute</span>
        <select
          className="field__control"
          value={attribute ?? ""}
          onChange={(event) => onChoose(event.target.value || null)}
        >
          <option value="">Choose an attribute…</option>
          {attributes.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </select>
      </label>
      {attribute === null && (
        <p className="panel__hint">
          Choose an attribute to see which candidates have a figure for it, and
          where each one came from.
        </p>
      )}
    </>
  );
}

function AcrossCandidates({
  values,
  rosterSize,
  scored,
}: {
  values: StoredValue[];
  rosterSize?: number;
  scored: boolean;
}) {
  const candidateNames = useCandidateNames();
  const sourceNames = useSourceNames();
  if (values.length === 0) {
    return (
      <p className="screen__note">
        {/* The whole point of this view: an attribute nobody has a figure for is said to be
            one, rather than rendered as an empty table. Its weight goes to every attribute
            that has a figure, not to its pillar's (`reqs.md` 5.3) -- and only a scored
            attribute has any. */}
        No candidate has a figure for this attribute.
        {scored &&
          " Its weight is spread over the attributes that have a figure."}
      </p>
    );
  }

  return (
    <>
      <p className="panel__hint">{describeFigureCount(values, rosterSize)}</p>
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
                <th scope="row">{candidateName(candidateNames, value.candidate)}</th>
                <td title={value.quote ?? undefined}>
                  {describeFigure(value)}
                </td>
                <td>{sourceName(sourceNames, value.data_source)}</td>
                <td>
                  {formatDate(value.reference_period.start)} to{" "}
                  {formatDate(value.reference_period.end)}
                </td>
                <td>{formatDateTime(value.retrieval_date)}</td>
                <td>
                  <ConfidenceChip figure={value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
