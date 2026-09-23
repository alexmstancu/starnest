import { useCallback, useId, useState } from "react";
import {
  fetchCriteriaSet,
  fetchExternalScores,
  fetchRankedCandidateDetail,
  fetchValues,
  type ExternalScore,
  type StoredValue,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import {
  ABSENT,
  formatDate,
  formatIdentifier,
  formatDateTime,
  formatPercentage,
  formatSigned,
  safeHttpUrl,
} from "../../format/display";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
import { describeFigure } from "../../format/figure";
import {
  judgementsByAttribute,
  pillarsByAttribute,
  valuesInPillar,
  type Judgement,
} from "./pillarFilter";
import { pillarCompleteness, type Completeness } from "./pillarCompleteness";
import { type PillarScore, pillarBars } from "./rankTable";
import { scoresByAttribute, type ScoreReading } from "./attributeScores";

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
      (signal: AbortSignal) =>
        fetchCriteriaSet(criteriaSetId ?? "", { signal }),
      [criteriaSetId],
    ),
    criteriaSetId !== null,
  );
  /**
   * What each attribute actually contributed, from the ranking on screen.
   *
   * **A separate read, and a silent one.** It answers a different question from the values --
   * those are what is stored, this is what the pass made of it -- and the table is worth
   * showing without it: a figure, its source and its dates are facts whether or not the
   * scoring arithmetic arrived. So a failure here empties three columns rather than replacing
   * the table with an error.
   */
  const { levelId } = useSelection();
  const scored = useResource(
    useCallback(
      (signal: AbortSignal) =>
        fetchRankedCandidateDetail(
          candidate,
          criteriaSetId ?? "",
          levelId ?? "",
          { signal },
        ),
      [candidate, criteriaSetId, levelId],
    ),
    criteriaSetId !== null && levelId !== null,
  );
  const contributions = scoresByAttribute(
    scored.resource.status === "ready"
      ? scored.resource.data.attribute_scores
      : null,
  );

  const [pillar, setPillar] = useState<string | null>(null);
  const setCriteria =
    criteria.resource.status === "ready" ? criteria.resource.data.criteria : null;
  const byAttribute = pillarsByAttribute(setCriteria);
  const judgements = judgementsByAttribute(setCriteria);

  // **Unique per open panel.** Several candidates' evidence can be open at once, and a
  // hardcoded id would repeat in the document -- so every panel would be announced with the
  // first one's name, and the duplicate ids would be invalid markup besides.
  const headingId = useId();

  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel__head">
        <h3 id={headingId} className="panel__heading">
          {name}: every value behind the score
        </h3>
        {/* Said once, at the top, rather than as a caption on the table: it is a fact about
            how this application treats evidence, not about this table. */}
        <span className="panel__count">
          Superseded and rejected values are kept, never deleted.
        </span>
      </div>

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
        <h4 className="drill__title">
          {pillar === null
            ? "Every stored value"
            : `${formatIdentifier(pillar)} — stored values`}
        </h4>
      )}
      {values.resource.status === "ready" && (
        <CompletenessNote
          completeness={pillarCompleteness(
            setCriteria,
            values.resource.data.items,
            pillar,
          )}
        />
      )}
      {values.resource.status === "ready" && (
        <ValueTable
          judgements={judgements}
          contributions={contributions}
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

/**
 * How much of what is being scored has a figure at all, said above the figures.
 *
 * **The design says "weight was redistributed"; this says what we can see.** A ranking reports
 * a pillar's weight after redistribution but never which criterion lost its share, so naming
 * redistribution here would be the interface asserting something the server did not tell it.
 * The count of attributes with nothing stored is the same fact from the side we can check --
 * and the reader can check it against the table directly below.
 *
 * Amber when something is missing, a quiet line when nothing is: a state worth noticing and a
 * state worth confirming are not the same thing, and tinting both teaches the reader to ignore
 * the tint.
 */
function CompletenessNote({
  completeness,
}: {
  completeness: Completeness | null;
}) {
  if (completeness === null) return null;

  if (completeness.missing === 0) {
    return <p className="drill__complete">{completeness.sentence}</p>;
  }

  return (
    <div className="drill__gap">
      {/* The disc carries no information the sentence does not; it is what makes the block
          read as a warning at a glance. */}
      <span className="drill__gap-mark" aria-hidden="true">
        !
      </span>
      <p className="drill__gap-text">{completeness.sentence}</p>
    </div>
  );
}

function ValueTable({
  values,
  pillar,
  judgements,
  contributions,
}: {
  values: StoredValue[];
  pillar: string | null;
  /** What the active set decided about each attribute: its weight, and whether it blocks. */
  judgements: Map<string, Judgement>;
  /** What the pass made of each figure, from the ranking on screen. Empty until it arrives. */
  contributions: ReadonlyMap<string, ScoreReading>;
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
    <div className="table-card table-card--values">
      <table className="table table--values" aria-label="Every stored value">
        <thead>
          <tr>
            <th scope="col">Attribute</th>
            <th scope="col">Stored value</th>
            {/* **Three columns the criteria set alone cannot give.** The weight a set
                configures is a different number from the weight the pass used: an attribute
                with no figure drops out and its share spreads over the ones that have one
                (`reqs.md` 5.4), so showing only the configured weight leaves a reader unable
                to see where a missing figure went. */}
            <th scope="col" className="col--right">
              Score 0–100
            </th>
            <th scope="col" className="col--right">
              Weight
            </th>
            <th scope="col" className="col--right">
              Weight used
            </th>
            <th scope="col" className="col--right">
              Points added
            </th>
            <th scope="col">Confidence</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {values.map((value) => {
            const judged = judgements.get(value.attribute);
            return (
              <tr
                key={value.id}
                className={
                  value.is_active
                    ? "table__row"
                    : "table__row table__row--superseded"
                }
              >
                {/* **The provenance stacks under the name it belongs to.** Source, period and
                    retrieval date were three columns, which made the table nine wide and wrapped
                    every date over three lines. They are facts *about* this figure rather than
                    columns to compare across rows, so they read as a block. */}
                <th scope="row" className="value-cell">
                  <span className="value-cell__head">
                    <span className="value-cell__name">{value.attribute}</span>
                    {judged?.required === true && (
                      <span className="chip chip--accent">Required</span>
                    )}
                  </span>
                  <span className="value-cell__meta">
                    <span className="value-cell__label">Source</span>
                    <span className="value-cell__fact">
                      {value.data_source}
                      <Citations citations={value.citations} />
                    </span>
                    <span className="value-cell__label">Describes</span>
                    <span className="value-cell__fact">
                      {formatDate(value.reference_period.start)} to{" "}
                      {formatDate(value.reference_period.end)}
                    </span>
                    <span className="value-cell__label">Fetched</span>
                    <span className="value-cell__fact">
                      {formatDateTime(value.retrieval_date)}
                    </span>
                  </span>
                </th>

                <td className="figure-cell">
                  <span className="figure-cell__figure">
                    {describeFigure(value)}
                  </span>
                  {/* What the publisher said, where they said anything: the scale a figure is
                      on is not always readable from the figure. */}
                  {value.quote != null && value.quote !== "" && (
                    <span className="figure-cell__scale">{value.quote}</span>
                  )}
                </td>

                <td className="col--right value-weight">
                  {contributions.get(value.attribute)?.score ?? ABSENT}
                </td>

                {/* **The weight this set gives it, and nothing where it gives none.** An
                    attribute the set does not score is not judged here at all, and a zero
                    would read as "worth nothing" -- a different claim. */}
                <td className="col--right value-weight">
                  {judged?.weight == null
                    ? ABSENT
                    : formatPercentage(judged.weight)}
                </td>

                <td className="col--right value-weight">
                  {contributions.get(value.attribute)?.weightUsed ?? ABSENT}
                </td>

                <td className="col--right value-weight">
                  {contributions.get(value.attribute)?.pointsAdded ?? ABSENT}
                </td>

                <td>
                  <span className={`chip chip--${value.confidence_level}`}>
                    {value.confidence_level}
                  </span>
                </td>

                {/* Three states, and the design gives each its own tint: a figure being
                    scored, one a better source displaced, and one the catalog refused. They
                    are not degrees of the same thing, which one column of plain words made
                    them look like. */}
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
            );
          })}
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
  const headingId = useId();
  const bars = pillarBars(pillars);
  if (bars.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <h4 id={headingId} className="panel__heading">
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
                <span className="pillar-card__name">
                  {formatIdentifier(pillar.pillar)}
                </span>
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
                {/* The same ramp the row's bars use, so a pillar is the same colour
                    wherever it appears. `fill` is an attribute, not a style, which is what
                    lets a datum decide a colour without design leaving `styles.css`. */}
                <rect
                  className="pillar-card__fill"
                  fill={bars[at]?.fill?.bottom ?? "#eaecf0"}
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

/**
 * The pages a figure was actually read from (`reqs.md` 6.10).
 *
 * The LLM path is *required* to display them, and a structured adapter may carry them too.
 * They were stored and never shown, which made "full provenance on every displayed number"
 * true of the database and not of the screen.
 */
function Citations({ citations }: { citations?: readonly string[] | null }) {
  const links = (citations ?? [])
    .map((citation) => safeHttpUrl(citation))
    .filter((href): href is string => href !== null);
  if (links.length === 0) return null;

  return (
    <ul className="citations">
      {links.map((href, at) => (
        <li key={href}>
          <a href={href} target="_blank" rel="noreferrer noopener">
            {/* Numbered rather than named: a publisher's URL is rarely readable, and the
                figure's own source column already says who published it. */}
            source {at + 1}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A publisher, linked to how it says it arrived at its number, where it says so. */
function PublisherName({
  publisher,
  methodology,
}: {
  publisher: string;
  methodology?: string | null;
}) {
  const href = safeHttpUrl(methodology);
  if (!href) return <>{publisher}</>;

  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {publisher}
    </a>
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
    // **Dashed, and the design means it**: a solid card is what every table that feeds the
    // score is drawn in, so the broken border is the one visual difference saying this one
    // does not (`reqs.md` 3.5a). The caption that said so in words is gone -- the heading
    // above already says these are never counted, and saying it twice reads as a hedge.
    <div className="table-card table-card--outside">
      <table className="table table--external" aria-label="Outside opinions">
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
              <th scope="row">
                <PublisherName
                  publisher={score.data_source}
                  methodology={score.methodology_url}
                />
              </th>
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
    </div>
  );
}
