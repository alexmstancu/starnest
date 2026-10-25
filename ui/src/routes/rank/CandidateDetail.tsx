import { useCallback, useId, useRef, useState } from "react";
import { describeRepeats } from "./repeatedValues";
import {
  fetchAttributes,
  fetchCriteriaSet,
  fetchExternalScores,
  fetchRankedCandidateDetail,
  fetchValues,
  type Attribute,
  type CandidateScoreDetail,
  type CriteriaSet,
  type Criterion,
  type ExternalScore,
  type StoredValue,
} from "../../api/endpoints";
import type { Idle, Read, Refresh } from "../../api/read";
import { useRead } from "../../api/useRead";
import {
  usePillarNames,
  usePillarOrder,
  type PillarNames,
} from "../../api/usePillarNames";
import {
  useAttributeNames,
  type AttributeNames,
} from "../../api/useAttributeNames";
import { useSourceNames, type SourceNames } from "../../api/useSourceNames";
import { attributeName, pillarName, sourceName } from "../../format/display";
import {
  ABSENT,
  formatDate,
  formatDateTime,
  formatPercentage,
  formatSigned,
  safeHttpUrl,
} from "../../format/display";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { ReadFailureCard } from "../../shell/ReadFailureCard";
import { useRetryFocus } from "../../shell/useRetryFocus";
import { useSelection } from "../../shell/SelectionContext";
import { describeFigure } from "../../format/figure";
import { scoreRange, scoreTrackWidth } from "../../format/scoreScale";
import { judgementsByAttribute, type Judgement } from "./pillarFilter";
import { drillRows, type DrillRow, type MissingWhy } from "./drillRows";
import { ConfidenceChip } from "./ConfidenceChip";
import { pillarCompleteness, type Completeness } from "./pillarCompleteness";
import { type PillarScore, pillarBars } from "./rankTable";
import {
  figureInUse,
  scoresByAttribute,
  type InUse,
  type ScoreReading,
  type WeightUsedTone,
} from "./attributeScores";
import { howScored } from "./howScored";
import { groupedByIndex, isEarlierEdition } from "./outsideEditions";

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
  scaleMax,
  chosen = null,
  onChoose,
}: {
  candidate: string;
  name: string;
  pillars?: readonly PillarScore[] | null;
  /** The top of the range `pillars` are on, from the ranking that carried them. */
  scaleMax: number | null | undefined;
  /**
   * Which pillar's values to show, or null for all of them.
   *
   * **Held by the caller, not here.** The chart of pillar scores sits in the ranking row,
   * outside this panel, and the two have to agree about which pillar is being read. A
   * `useState` in here could not be seen by a sibling, so choosing a pillar on the chart did
   * nothing and choosing one here left the chart unmarked.
   */
  chosen?: string | null;
  onChoose?: (pillar: string) => void;
}) {
  const names = usePillarNames();
  const pillarOrder = usePillarOrder();
  const attributeNames = useAttributeNames();
  const sourceNames = useSourceNames();
  const { criteriaSetId, levelId, acquisitionsEnded } = useSelection();
  // Read again with the ranking above them when an acquisition ends (UI-11), kept on screen
  // meanwhile (PL-010), so the figures never disagree with the scores they sit under.
  const values = useRead(
    useCallback(
      (signal: AbortSignal) => fetchValues(candidate, { signal }),
      [candidate],
    ),
    { freshness: acquisitionsEnded },
  );
  const external = useRead(
    useCallback(
      (signal: AbortSignal) => fetchExternalScores(candidate, { signal }),
      [candidate],
    ),
  );
  // **The active set's rules**: which attributes it requires, and how each is scored. A
  // failure leaves the figures and says what it took with it.
  const criteria = useRead(
    useCallback(
      (signal: AbortSignal) =>
        fetchCriteriaSet(criteriaSetId ?? "", { signal }),
      [criteriaSetId],
    ),
    { enabled: criteriaSetId !== null },
  );
  /**
   * What each attribute actually contributed, from the ranking on screen.
   *
   * **A separate read, joined to the values before anything is drawn** (PL-068): it says which
   * attributes this set scores, so it is what names the ones with no value in use. Drawn
   * before it lands, rows would appear late and jump. A failure here still leaves the figures
   * -- a figure, its source and its dates are facts whether or not the scoring arrived -- and
   * says that the scoring could not be loaded, rather than a dash that reads as "no score".
   */
  const scored = useRead(
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
    { enabled: criteriaSetId !== null && levelId !== null, freshness: acquisitionsEnded },
  );
  // What each attribute measures, for the "how was this scored" tooltip. **A failure is
  // silence**: the tooltip goes without its first line rather than without the rest.
  const catalog = useRead(
    useCallback(
      (signal: AbortSignal) => fetchAttributes(levelId ?? undefined, { signal }),
      [levelId],
    ),
  );
  const measured = new Map<string, Attribute>(
    catalog.read.state === "ready"
      ? catalog.read.data.items.map((each) => [each.id, each])
      : [],
  );

  const stored = asRead(values.read);
  const scoring = asRead(scored.read);
  const rules = asRead(criteria.read);
  // **The figures wait for the scoring and the rules to answer or fail the first time**, so no
  // row is drawn and then moved, and no gap or chip is guessed meanwhile. Once drawn they stay,
  // marked busy, while any of the three is read again -- a Try again included (PL-010).
  const [drawnOnce, setDrawnOnce] = useState(false);
  const waiting = scoring.state === "pending" || rules.state === "pending";
  const evidence: Read<{ items: StoredValue[]; total: number }> =
    stored.state !== "ready"
      ? stored
      : waiting && !drawnOnce
        ? PENDING
        : { ...stored, refresh: waiting ? "running" : refreshAcross([stored, scoring, rules]) };
  if (!drawnOnce && evidence.state === "ready") setDrawnOnce(true);
  const readEvidenceAgain = async () => {
    await Promise.all([values.reload(), scored.reload(), criteria.reload()]);
  };

  // **Unique per open panel.** Several candidates' evidence can be open at once, and a
  // hardcoded id would repeat in the document -- so every panel would be announced with the
  // first one's name, and the duplicate ids would be invalid markup besides.
  const headingId = useId();

  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel__head">
        <h2 id={headingId} className="panel__heading">
          {name}: every value behind the score
        </h2>
        {/* Said once, at the top, rather than as a caption on the table: it is a fact about
            how this application treats evidence, not about this table. */}
        <span className="panel__count">
          Superseded and rejected values are kept, never deleted.
        </span>
      </div>

      {/* The toggle-off lives in `choosePillar`, with the rest of the selection rule, so
          both ways in behave the same: clicking the chosen one again clears it, whether the
          click landed on this card or on the chart up in the row. */}
      <PillarContributions
        names={names}
        pillars={pillars}
        scaleMax={scaleMax}
        chosen={chosen}
        onChoose={(each) => onChoose?.(each)}
      />

      <LoadedRegion
        read={evidence}
        what="The figures"
        skeleton="rank-table"
        onRetry={readEvidenceAgain}
      >
        {(figures) => (
          <Evidence
            values={figures.items}
            scoring={scoring}
            rules={rules}
            chosen={chosen}
            fallbackScale={scaleMax}
            measured={measured}
            pillarOrder={pillarOrder}
            names={{ attributes: attributeNames, pillars: names, sources: sourceNames }}
            onRetryScoring={scored.reload}
            onRetryRules={criteria.reload}
          />
        )}
      </LoadedRegion>

      <h3 className="panel__heading">Outside opinions</h3>
      <p className="panel__hint">
        Published composites, shown beside the score and never counted in it.
      </p>
      <LoadedRegion
        read={asRead(external.read)}
        what="The outside opinions"
        skeleton="lines"
        onRetry={external.reload}
      >
        {(opinions) => (
          <ExternalScoreTable scores={opinions.items} names={sourceNames} />
        )}
      </LoadedRegion>
    </section>
  );
}

const PENDING: Read<never> = { state: "pending" };

/** A read this panel always asks for once there is a selection, as a `Read`. */
function asRead<T>(read: Read<T> | Idle): Read<T> {
  return read.state === "idle" ? PENDING : read;
}

/** How settled several reads drawn as one are: a failed re-read over one under way. */
function refreshAcross(reads: readonly Read<unknown>[]): Refresh {
  const refreshes = reads.flatMap((read) => (read.state === "ready" ? [read.refresh] : []));
  const failed = refreshes.find((refresh) => typeof refresh === "object");
  if (failed !== undefined) return failed;
  return refreshes.includes("running") ? "running" : "idle";
}

/**
 * The stored figures, with what the scoring and the set's rules make of them -- each said to
 * have failed where it did, beside figures that stand without it.
 */
function Evidence({
  values,
  scoring,
  rules,
  chosen,
  fallbackScale,
  measured,
  pillarOrder,
  names,
  onRetryScoring,
  onRetryRules,
}: {
  values: readonly StoredValue[];
  scoring: Read<CandidateScoreDetail>;
  rules: Read<CriteriaSet>;
  chosen: string | null;
  /** The ranking's scale, for the heading until the attribute scores carry their own. */
  fallbackScale: number | null | undefined;
  measured: ReadonlyMap<string, Attribute>;
  pillarOrder: ReadonlyMap<string, number>;
  names: { attributes: AttributeNames; pillars: PillarNames; sources: SourceNames };
  onRetryScoring: () => Promise<void>;
  onRetryRules: () => Promise<void>;
}) {
  // Null where there is no scoring to join: nothing is guessed from it, and no pillar can be
  // filtered by -- so the title says every value rather than claiming a filter it cannot apply.
  const scores =
    scoring.state === "ready" ? (scoring.data.attribute_scores ?? []) : null;
  const filter = scores === null ? null : chosen;
  const rows = drillRows({
    values,
    scores,
    pillarOrder,
    names: names.attributes,
    chosenPillar: filter,
  });
  const setCriteria = rules.state === "ready" ? rules.data.criteria : null;
  const judgements = judgementsByAttribute(setCriteria);
  const criteria = new Map<string, Criterion>(
    (setCriteria ?? []).map((each) => [each.attribute, each]),
  );
  // **The figures hold focus while the scoring or the rules are read again**, since each Try
  // again takes its own button away; a retry that fails again hands it to the new one.
  const figures = useRef<HTMLDivElement>(null);
  const scoringFocus = useRetryFocus(scoring, figures);
  const rulesFocus = useRetryFocus(rules, figures);

  return (
    <div ref={figures} tabIndex={-1}>
      <h3 className="drill__title">
        {filter === null
          ? "Every stored value"
          : `${pillarName(names.pillars, filter)} — stored values`}
      </h3>
      {scoring.state === "failed" && (
        <>
          <ReadFailureCard
            what="The scoring"
            error={scoring.error}
            onRetry={() => {
              scoringFocus.hold();
              void onRetryScoring();
            }}
            retryRef={scoringFocus.retryButton}
            prominence="region"
          />
          <p className="screen__note">
            Missing attributes and weights are not shown until it is read.
          </p>
        </>
      )}
      {rules.state === "failed" && (
        <ReadFailureCard
          what="The criteria set's rules"
          error={rules.error}
          onRetry={() => {
            rulesFocus.hold();
            void onRetryRules();
          }}
          retryRef={rulesFocus.retryButton}
          prominence="region"
        />
      )}
      <CompletenessNote
        completeness={pillarCompleteness(rows, filter, names.pillars)}
      />
      <ValueTable
        names={names.attributes}
        pillarNames={names.pillars}
        sourceNames={names.sources}
        judgements={judgements}
        rules={criteria}
        measured={measured}
        contributions={scoresByAttribute(scores)}
        scoring={scoring.state}
        scaleMax={scoring.state === "ready" ? scoring.data.score_scale_max : fallbackScale}
        rows={rows}
        pillar={filter}
      />
    </div>
  );
}

/**
 * How much of what is being scored has a figure in use, said above the rows that name each gap.
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
  rows,
  pillar,
  names,
  pillarNames,
  sourceNames,
  judgements,
  rules,
  measured,
  contributions,
  scoring,
  scaleMax,
}: {
  /** The drill-down's rows, in order, the gaps among them (`drillRows`). */
  rows: readonly DrillRow[];
  pillar: string | null;
  /** The catalog's attribute names, so no row prints a database key (`reqs.md` design rule). */
  names: AttributeNames;
  /** The catalog's pillar names, for the same rule in the sentence about an empty pillar. */
  pillarNames: PillarNames;
  /** The catalog's source names, for the same rule in each figure's provenance (RB-4). */
  sourceNames: SourceNames;
  /** What the active set decided about each attribute: its weight, and whether it blocks. */
  judgements: Map<string, Judgement>;
  /** The active set's criteria, by attribute, for what the tooltip says about the rule. */
  rules: ReadonlyMap<string, Criterion>;
  /** The catalog's attributes, by id, for what the tooltip says each measures. */
  measured: ReadonlyMap<string, Attribute>;
  /**
   * What the pass made of each attribute, from the ranking on screen, for the one figure it
   * scored (`figureInUse`). Empty until it arrives.
   */
  contributions: ReadonlyMap<string, ScoreReading>;
  /**
   * Where the scoring read stands. **Until it is read, an active figure's scoring columns say
   * which**: a dash is the sign for "no score", which nobody found (PL-001).
   */
  scoring: Read<unknown>["state"];
  /** The top of the range the attribute scores are on, for the column's heading. */
  scaleMax: number | null | undefined;
}) {
  const range = scoreRange(scaleMax);
  if (rows.length === 0) {
    return (
      <p className="screen__note">
        {pillar === null
          ? "No figure has been stored for this candidate yet."
          : `No figure has been stored for anything in ${pillarName(pillarNames, pillar)}.`}
      </p>
    );
  }
  return (
    <div className="table-card table-card--values">
      <table className="table table--values" aria-label="Every stored value">
        <caption className="table__caption">
          Weights are shares of the whole score.
        </caption>
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
              {range === "" ? "Score" : `Score ${range}`}
            </th>
            <th
              scope="col"
              className="col--right"
              title="Its share of the whole score, as configured"
            >
              Weight
            </th>
            <th
              scope="col"
              className="col--right"
              title="Its share of the whole score after redistribution: the weight of every attribute with no figure is spread over the ones that have one"
            >
              Weight used
            </th>
            <th scope="col" className="col--right">
              Contribution
            </th>
            <th scope="col">Confidence</th>
            <th scope="col">In use</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "missing") {
              return (
                <MissingRow
                  key={`missing-${row.attribute}`}
                  called={attributeName(names, row.attribute)}
                  why={row.why}
                  required={judgements.get(row.attribute)?.required === true}
                  reading={contributions.get(row.attribute) ?? null}
                />
              );
            }
            const { value, copies, firstRetrieved } = row.repeated;
            const judged = judgements.get(value.attribute);
            const { inUse, reading } = figureInUse(
              value,
              judged?.scored,
              contributions,
            );
            const weightUsedClass =
              WEIGHT_USED_TONE[reading?.weightUsedTone ?? "plain"];
            // Only the figure in use was ever going to carry a reading.
            const unread = value.is_active ? UNREAD[scoring] : ABSENT;
            const called = attributeName(names, value.attribute);
            const how = howScored({
              criterion: rules.get(value.attribute),
              attribute: measured.get(value.attribute),
              source: sourceName(sourceNames, value.data_source),
            });
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
                    <span className="value-cell__name">{called}</span>
                    {how !== null && (
                      <span
                        className="value-cell__how"
                        role="img"
                        aria-label={`How ${called} was scored`}
                        title={how}
                      >
                        i
                      </span>
                    )}
                    {judged?.required === true && (
                      <span className="chip chip--accent">Required</span>
                    )}
                  </span>
                  <span className="value-cell__meta">
                    <span className="value-cell__label">Source</span>
                    <span className="value-cell__fact">
                      {sourceName(sourceNames, value.data_source)}
                      <Citations citations={value.citations} />
                    </span>
                    {copies > 1 && (
                      <>
                        {/* **Said once, with a count, rather than as N identical rows.** Every
                            copy is still stored; what is folded here is the repetition, not
                            the evidence. A figure re-fetched unchanged is the same figure. */}
                        <span className="value-cell__label">Fetched again</span>
                        <span className="value-cell__fact">
                          {describeRepeats(copies, firstRetrieved)}
                        </span>
                      </>
                    )}
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
                  {reading?.score ?? unread}
                </td>

                {/* **The weight the server declared, on the basis of the weight used** (PL-063):
                    both shares of the whole score, so they differ only where a missing figure's
                    weight was spread. Nothing where the pass scored nothing -- a zero would read
                    as "worth nothing", a different claim. */}
                <td className="col--right value-weight">
                  {reading?.weight ?? unread}
                </td>

                <td className={weightUsedClass}>
                  {reading?.weightUsed ?? unread}
                </td>

                <td className="col--right value-weight">
                  {reading?.pointsAdded ?? unread}
                </td>

                <td>
                  <ConfidenceChip figure={value} />
                </td>

                {/* Four states, and each has its own tint: a figure being scored, one in use
                    that nothing counts, one a better source displaced, and one the catalog
                    refused. They are not degrees of the same thing, which one column of plain
                    words made them look like. */}
                <td>
                  <span className="in-use">
                    <span className={`chip ${IN_USE[inUse].tint}`}>
                      {IN_USE[inUse].label}
                    </span>
                    {/* Why, in words (PL-072): the server names the attribute as the catalog
                        does, so the reason is printed as served. */}
                    {inUse === "rejected" && value.rejection_reason && (
                      <span className="in-use__reason">
                        {value.rejection_reason}
                      </span>
                    )}
                    {inUse === "unplaced" && (
                      <span className="in-use__reason">
                        could not be placed on the score scale
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What a scoring column says for the figure in use, by where the scoring read stands. */
const UNREAD: Record<Read<unknown>["state"], string> = {
  pending: "…",
  failed: "Not loaded",
  ready: ABSENT,
};

/** PL-073: teal where redistribution moved the weight, amber where nothing was in use. */
const WEIGHT_USED_TONE: Record<WeightUsedTone, string> = {
  plain: "col--right value-weight",
  moved: "col--right value-weight value-weight--moved",
  missing: "col--right value-weight value-weight--missing",
};

/**
 * How the "In use" column names each state.
 *
 * **"Active" is the ontology's own word** (`reqs.md` Appendix A): the figure the active-value
 * rule chose for its attribute. Quiet, because a figure no criterion counts is context and
 * should not compete with the ones that are scored.
 */
const IN_USE: Record<InUse, { label: string; tint: string }> = {
  scored: { label: "Scored", tint: "chip--accent" },
  unplaced: { label: "Not placed", tint: "chip--warning" },
  active: { label: "Active", tint: "chip--quiet" },
  superseded: { label: "Superseded", tint: "chip--neutral" },
  switchedOff: { label: "Source switched off", tint: "chip--neutral" },
  rejected: { label: "Rejected", tint: "chip--not_matching" },
};

/**
 * What a gap row says, by why it is a gap (PL-068). **"Stored" and "in use" are kept apart**:
 * an attribute whose only figures were rejected, or come from a switched-off source, has
 * something stored and nothing in use, and the rows beneath it show which.
 */
const MISSING: Record<MissingWhy, { figure: string; why: string }> = {
  nothing_stored: {
    figure: "no value stored",
    why: "Nothing has been stored for it.",
  },
  rejected: {
    figure: "no value in use",
    why: "Every figure stored for it was rejected.",
  },
  switched_off: {
    figure: "no value in use",
    why: "Its figures come from a source that is switched off.",
  },
  rejected_or_switched_off: {
    figure: "no value in use",
    why: "Its figures were rejected or come from a source that is switched off.",
  },
  not_in_use: {
    figure: "no value in use",
    why: "None of its stored figures is in use.",
  },
};

/**
 * A scored attribute with no value in use, named in its place among the figures (PL-068).
 *
 * **The weight is the server's**: declared, and the nought the pass actually gave it once its
 * share was spread over the attributes that have a figure (`reqs.md` 5.3).
 */
function MissingRow({
  called,
  why,
  required,
  reading,
}: {
  called: string;
  why: MissingWhy;
  required: boolean;
  reading: ScoreReading | null;
}) {
  const weightUsedClass = WEIGHT_USED_TONE[reading?.weightUsedTone ?? "plain"];
  return (
    <tr className="table__row">
      <th scope="row" className="value-cell">
        <span className="value-cell__head">
          <span className="value-cell__name">{called}</span>
          {required && <span className="chip chip--accent">Required</span>}
        </span>
        <span className="value-cell__meta">
          <span className="value-cell__label">Why</span>
          <span className="value-cell__fact">
            {MISSING[why].why} Its weight is spread over the attributes that
            have a figure.
          </span>
        </span>
      </th>
      <td className="figure-cell">
        <span className="figure-cell__figure figure-cell__figure--missing">
          {MISSING[why].figure}
        </span>
      </td>
      <td className="col--right value-weight">{reading?.score ?? ABSENT}</td>
      <td className="col--right value-weight">{reading?.weight ?? ABSENT}</td>
      <td className={weightUsedClass}>
        {reading?.weightUsed ?? ABSENT}
      </td>
      <td className="col--right value-weight">
        {reading?.pointsAdded ?? ABSENT}
      </td>
      <td>{ABSENT}</td>
      <td>
        <span className="chip chip--insufficient_data">No value</span>
      </td>
    </tr>
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
  names,
  pillars,
  scaleMax,
  chosen,
  onChoose,
}: {
  names: PillarNames;
  pillars?: readonly PillarScore[] | null;
  scaleMax: number | null | undefined;
  chosen: string | null;
  onChoose: (pillar: string) => void;
}) {
  const headingId = useId();
  const bars = pillarBars(pillars, scaleMax, (pillar) => pillarName(names, pillar));
  if ((pillars ?? []).length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        Pillar contributions — select one to filter the values below
      </h3>
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
                  {pillarName(names, pillar.pillar)}
                </span>
                <span className="pillar-card__score">
                  {typeof pillar.score === "number" ? pillar.score : "No score"}
                </span>
              </div>
              {/* **No scale, no track** (PL-062): the score above still prints, and a length
                  against a guessed top would be a reading nobody made. */}
              {bars.length > 0 && (
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
                    width={scoreTrackWidth(pillar.score, scaleMax) ?? "0%"}
                    height="4"
                  />
                </svg>
              )}
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

function ExternalScoreTable({
  scores,
  names,
}: {
  scores: ExternalScore[];
  /**
   * The catalog's source names. **A publisher is a data source** -- `external_score.data_source`
   * references `data_source (id)` -- so it is named as every other source is (RB-4).
   */
  names: SourceNames;
}) {
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
        {/* **One body per index** (PL-171): a publisher and its series, in the server's order,
            with the edition that stands for it and the earlier ones kept as history. */}
        {groupedByIndex(scores).map((index) => (
          <tbody key={`${index.publisher} ${index.series}`}>
            {index.editions.map((score) => (
              <OutsideEdition
                // The natural key of `external_score` (`0113`, PL-171): the index, the whole
                // period and the moment it was read (UI-30).
                key={[
                  score.reference_period?.start ?? "",
                  score.reference_period?.end ?? "",
                  score.retrieval_date ?? "",
                ].join("-")}
                score={score}
                publisher={sourceName(names, score.data_source)}
                several={index.editions.length > 1}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function OutsideEdition({
  score,
  publisher,
  several,
}: {
  score: ExternalScore;
  publisher: string;
  /** Whether its index has more than one edition here, so the one that stands is said. */
  several: boolean;
}) {
  const earlier = isEarlierEdition(score);
  return (
    <tr className={earlier ? "table__row--history" : undefined}>
      <th scope="row">
        <PublisherName publisher={publisher} methodology={score.methodology_url} />
        <span className="outside-series">{score.series}</span>
        {earlier ? (
          <span className="chip chip--neutral">Earlier edition, kept as history</span>
        ) : (
          several && <span className="chip chip--quiet">Current edition</span>
        )}
        {/* **Both dates, as every stored figure has them** (UI-20): what period the
            opinion describes and when it was read. A 2019 index and this year's are
            different claims, and the row could not tell them apart. */}
        <span className="value-cell__meta">
          <span className="value-cell__label">Describes</span>
          <span className="value-cell__fact">
            {score.reference_period
              ? `${formatDate(score.reference_period.start)} to ${formatDate(score.reference_period.end)}`
              : ABSENT}
          </span>
          <span className="value-cell__label">Fetched</span>
          <span className="value-cell__fact">{formatDateTime(score.retrieval_date)}</span>
        </span>
      </th>
      <td>
        {score.published_value ?? "—"}
        {score.published_rank != null &&
          (score.published_rank_of != null
            ? ` (rank ${score.published_rank} of ${score.published_rank_of})`
            : ` (rank ${score.published_rank})`)}
      </td>
      <td>{score.published_scale}</td>
      <td>{score.caveats ?? ""}</td>
    </tr>
  );
}
