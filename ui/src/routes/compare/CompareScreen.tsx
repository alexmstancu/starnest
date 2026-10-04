import { useCallback, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ComparisonMatrix } from "./ComparisonMatrix";
import { ViewChoices } from "./ViewChoices";
import type { Measure } from "./pillarMatrix";
import { droppedByLimit, withinLimit } from "./comparatorLimit";
import { tagByImpact, type TaggedLine } from "./synthesisImpact";
import {
  fetchCandidates,
  fetchComparison,
  fetchSettings,
  type Candidate,
  type Comparison,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import type { RouteDefinition } from "../../navigation/routes";
import {
  ABSENT,
  deltaTone,
  formatScore,
  formatSigned,
  attributeName,
} from "../../format/display";
import { describeFigure } from "../../format/figure";
import { UnsetSetting } from "../../shell/UnsetSetting";
import { useAttributeNames } from "../../api/useAttributeNames";
import { useSelection } from "../../shell/SelectionContext";

/**
 * One focus candidate against comparators (`reqs.md` 8.5).
 *
 * **Every number and every sentence here is the server's.** The deltas, what each delta is
 * worth, and the advantages and disadvantages all arrive from `GET /v1/comparisons`; the
 * synthesis is templated from the arithmetic there, never written here (`arch.md` 8.1).
 *
 * **The comparator limit is the server's too.** It is shown so the reader knows the bound, and
 * enforced where it is configured -- a copy of the number here would be a second bound that
 * could disagree with the first.
 */
export function CompareScreen({ route }: { route: RouteDefinition }) {
  const { criteriaSetId, levelId } = useSelection();

  return (
    <section className="screen" aria-labelledby="screen-heading">
      <header className="screen__header">
        <h2 id="screen-heading" className="screen__heading">
          {route.label}
        </h2>
        <p className="screen__summary">
          One focus candidate against the ones you compare it with. Differences
          are per pillar, in score points, never averaged into one verdict.
        </p>
      </header>
      {/* Keyed by the selection (P54). **A comparison never mixes levels** (`reqs.md`), and
          the focus and comparators are candidate ids at one level, so they mean nothing at
          another: keeping them across a switch re-asked for `level=city&focus=country.…`,
          which the contract refuses with 409 "Levels mixed", while the picker showed the new
          roster with a stale focus still selected and the button still enabled. */}
      <TheComparison
        key={`${criteriaSetId}-${levelId}`}
        criteriaSetId={criteriaSetId}
        levelId={levelId}
      />
    </section>
  );
}

function TheComparison({
  criteriaSetId,
  levelId,
}: {
  criteriaSetId: string | null;
  levelId: string | null;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [comparators, setComparators] = useState<string[]>([]);
  // How the attribute rows read: the normalised score, or the figure in its own unit.
  const [shownAs, setShownAs] = useState<"score" | "raw">("score");
  const [measure, setMeasure] = useState<Measure>("points");
  const [asked, setAsked] = useState<{
    focus: string;
    comparators: string[];
  } | null>(null);

  const candidates = useResource(
    useCallback(
      (signal: AbortSignal) => fetchCandidates(levelId ?? "", { signal }),
      [levelId],
    ),
    levelId !== null,
  );
  const settings = useResource(
    useCallback((signal: AbortSignal) => fetchSettings({ signal }), []),
  );

  const comparison = useResource(
    useCallback(
      async (signal: AbortSignal): Promise<Comparison> => {
        if (!criteriaSetId || !levelId || !asked)
          throw new Error("nothing asked for");
        return fetchComparison(
          criteriaSetId,
          levelId,
          asked.focus,
          asked.comparators,
          { signal },
        );
      },
      [criteriaSetId, levelId, asked],
    ),
    asked !== null,
  );

  const roster =
    candidates.resource.status === "ready"
      ? candidates.resource.data.items
      : [];
  const limit =
    settings.resource.status === "ready"
      ? settings.resource.data.comparator_limit
      : null;

  // **Trimmed as it is rendered, not on a click.** The limit was enforced only when adding, so
  // lowering it in Configure left a selection above it in place -- and `/comparisons` answers
  // 409 above the limit, so that was a request this application could never make (R4).
  const kept = withinLimit(comparators, limit);
  const dropped = droppedByLimit(comparators, limit);

  return (
    <>
      {criteriaSetId === null || levelId === null ? (
        <p className="screen__note">
          Choose a criteria set and a level to compare candidates.
        </p>
      ) : (
        <ComparisonPicker
          roster={roster}
          focus={focus}
          comparators={kept}
          limit={limit ?? null}
          dropped={dropped}
          choices={
            <ViewChoices
              shownAs={shownAs}
              onShownAs={setShownAs}
              measure={measure}
              onMeasure={setMeasure}
            />
          }
          // **Choosing a focus drops it from the comparators** (P81). The chips already hide
          // the focus, so a candidate ticked first and then made the focus vanished from the
          // screen while staying in the request -- and the server refuses comparing a
          // candidate with itself, so every Compare answered 409 with nothing on screen to
          // untick. Pruning here keeps what is sent and what is shown the same list.
          onFocus={(candidate) => {
            setFocus(candidate);
            setComparators((chosen) => chosen.filter((each) => each !== candidate));
          }}
          onToggleComparator={(candidate) =>
            setComparators((chosen) =>
              chosen.includes(candidate)
                ? chosen.filter((each) => each !== candidate)
                : [...chosen, candidate],
            )
          }
          onCompare={() => focus && setAsked({ focus, comparators: kept })}
        />
      )}

      {comparison.resource.status === "loading" && (
        <p className="screen__note">Comparing…</p>
      )}
      {/* A comparison is a difference between two scores, so it goes the same way a score
          does when the range it is measured on has not been decided. */}
      {comparison.resource.status === "error" && (
        <UnsetSetting
          error={comparison.resource.error}
          title="Nothing to compare"
          detail="A comparison is a difference between two scores, and no score can be computed without a top of the range. Set it and the comparison returns."
          onRetry={comparison.reload}
        />
      )}
      {comparison.resource.status === "ready" && (
        <ComparisonTable
          comparison={comparison.resource.data}
          shownAs={shownAs}
          measure={measure}
        />
      )}
    </>
  );
}

function ComparisonPicker({
  roster,
  focus,
  comparators,
  limit,
  onFocus,
  onToggleComparator,
  onCompare,
  dropped,
  choices,
}: {
  roster: Candidate[];
  focus: string | null;
  comparators: string[];
  limit: number | null;
  onFocus: (candidate: string) => void;
  onToggleComparator: (candidate: string) => void;
  onCompare: () => void;
  /** How many the limit is holding back, so the screen says so rather than losing them. */
  dropped: number;
  /** The two questions about how to read the comparison, answered before it is drawn. */
  choices: ReactNode;
}) {
  const full = limit !== null && comparators.length >= limit;

  return (
    <div className="panel">
      {/* The limit sits beside the heading rather than under it: it is a fact about this
          panel's one control, and a reader only needs it when they reach for another chip. */}
      <div className="panel__head">
        <h3 className="panel__heading">What to compare</h3>
        <span className="picker__limit">
          <span className={full ? "picker__limit-note picker__limit-note--full" : "picker__limit-note"}>
            {limit === null
              ? "No comparator limit is configured, so the server will refuse a comparison."
              : full
                ? `You have ${String(comparators.length)} of ${String(limit)} — the limit set in Configure. Remove one to add another, or raise the limit there.`
                : `Up to ${String(limit)} comparators, the limit set in Configure.`}
          </span>
          <NavLink className="action" to="/configure">
            Change it in Configure
          </NavLink>
        </span>
      </div>

      {/* Said out loud, because a selection silently shrinking is worse than one that
          refuses. The newest are kept: the last clicks are the ones being thought about. */}
      {dropped > 0 && (
        <div className="notice notice--warning" role="alert">
          <p className="notice__message">
            The comparator limit is lower than what was picked, so the{" "}
            {dropped === 1 ? "oldest choice is" : `oldest ${dropped} choices are`}{" "}
            no longer in the comparison. Raise the limit in Configure to bring
            them back.
          </p>
        </div>
      )}

      {/* **The two questions before the two lists.** What a cell shows, and what a difference
          is measured in, decide how everything below reads -- so they are answered first,
          each with the sentence that says what the choice means. */}
      <div className="picker__choices">{choices}</div>

      <div className="picker__who">
      <label className="field">
        <span className="field__label">Focus</span>
        <select
          className="field__control"
          value={focus ?? ""}
          onChange={(event) => onFocus(event.target.value)}
        >
          <option value="">Choose a candidate…</option>
          {roster.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="field">
        <legend className="field__label">Compare with</legend>
        {/* The design wraps these as chips in a box that scrolls, because a roster is 32 long
            and a column of 32 full-width rows buries everything under it. The checkboxes stay:
            this is a multiple choice, and a chip is what it looks like, not what it is. */}
        <div className="toggle-group toggle-group--wrap">
          {roster
            .filter((candidate) => candidate.id !== focus)
            .map((candidate) => (
              <label key={candidate.id} className="toggle">
                <input
                  type="checkbox"
                  checked={comparators.includes(candidate.id)}
                  onChange={() => onToggleComparator(candidate.id)}
                />
                {candidate.name}
              </label>
            ))}
        </div>
      </fieldset>
      </div>

      <button
        type="button"
        className="button button--primary"
        disabled={focus === null || comparators.length === 0}
        onClick={onCompare}
      >
        Compare
      </button>
    </div>
  );
}

function ComparisonTable({
  comparison,
  shownAs,
  measure,
}: {
  comparison: Comparison;
  shownAs: "score" | "raw";
  measure: Measure;
}) {
  const comparators = comparison.comparators ?? [];
  const attributeNames = useAttributeNames();
  return (
    <>
      <h3 className="panel__heading">
        {comparison.focus.name} against{" "}
        {comparators.map((each) => each.name).join(", ")}
      </h3>

      {/* **Side by side, one card per comparator.** Five of them stacked is five screens of
          scrolling to answer "which of these is closest"; in a row the totals line up and the
          answer is the shape of the column.

          Keyed by position as well as by name: `comparator` is optional in the contract, so
          two pairs without one shared the key "pair" -- and a sentence can legitimately repeat
          between pairs. A key has to be unique among siblings, not meaningful. */}
      <div className="synthesis">
      {(comparison.synthesis ?? []).map((pair, at) => (
        <SynthesisCard
          key={`${pair.comparator ?? "pair"}-${at}`}
          name={nameOf(comparison, pair.comparator ?? "")}
          pair={pair}
        />
      ))}
      </div>

      {/* **Raw figures exist per attribute, never per pillar.** A pillar is a weighted mean
          of things measured in different units, so it has no unit of its own -- which is why
          this toggle governs the attribute rows and the synthesis stays in points. */}
      {/* **The matrix first, the attributes under it.** The pillars are the shape of the
          answer; the attributes are the evidence for it, and a reader who wants the evidence
          knows to look down. */}
      <ComparisonMatrix comparison={comparison} measure={measure} />


      <table className="table">
        <caption>
          {shownAs === "raw"
            ? "Every attribute as published, with the gap in its own unit"
            : "Every attribute, with the gap and what it is worth"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Attribute</th>
            <th scope="col">{comparison.focus.name}</th>
            {comparators.map((each) => (
              <th key={each.candidate} scope="col">
                {each.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.attributes.map((row) => (
            <tr key={row.attribute}>
              <th scope="row">{attributeName(attributeNames, row.attribute)}</th>
              <td>
                {shownAs === "raw"
                  ? (row.focus?.value
                      ? describeFigure(row.focus.value)
                      : ABSENT)
                  : formatScore(row.focus?.normalised_score)}
              </td>
              {comparators.map((each) => {
                const cell = (row.comparators ?? []).find(
                  (candidate) => candidate.candidate === each.candidate,
                );
                return (
                  <td key={each.candidate}>
                    {shownAs === "raw" ? (
                      <>
                        {cell?.value ? describeFigure(cell.value) : ABSENT}
                        {/* `delta` is documented as being in the attribute's own unit, so it
                            belongs with the raw figure and not beside a score. */}
                        {cell?.delta != null && (
                          <span className="table__note">
                            {" "}
                            ({formatSigned(cell.delta)})
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {formatScore(cell?.normalised_score)}
                        {cell?.weighted_contribution != null && (
                          <span className="table__note">
                            {" "}
                            ({formatSigned(cell.weighted_contribution)} points)
                          </span>
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * One comparator's synthesis: the score gap, then what made it, ordered by what each gap is
 * worth.
 *
 * **The three tags are the only thing here this screen decides, and they decide nothing.**
 * They mark which lines the server's own numbers put first when both lists are read together
 * -- see `tagByImpact`, which withholds every tag rather than guess at one.
 */
function SynthesisCard({
  name,
  pair,
}: {
  name: string;
  pair: NonNullable<Comparison["synthesis"]>[number];
}) {
  const ranked = tagByImpact(pair.advantages, pair.disadvantages);

  return (
    <section className="panel synthesis__card">
      <div className="panel__head">
        <h4 className="synthesis__name">{name}</h4>
        <span
          // **Three states, because there are three** (P83). A null delta fell into the
          // `else` and was coloured as an advantage, so "—" rendered green: the screen
          // claiming a lead where it has nothing to compare. The ranked table's own
          // `deltaTone` already keeps a level state for exactly this.
          className={`synthesis__delta synthesis__delta--${deltaTone(pair.score_delta)}`}
        >
          {formatSigned(pair.score_delta)}
        </span>
      </div>
      <p className="synthesis__lead">
        By impact on the total, not by how large the gap looks.
      </p>
      {/* Stacked, not label-and-value: a list is not a figure, and pushing it to the
          right of its own label left a column of text hard against the card's edge. The
          design colours the two labels instead -- ahead in the success green, behind in
          the danger red -- so the direction is readable before the words are. */}
      <dl className="stat-list stat-list--stacked">
        <div className="stat stat--ahead">
          <dt className="stat__label">Ahead on</dt>
          <dd className="stat__value">
            <ImpactLines lines={ranked.advantages} />
          </dd>
        </div>
        <div className="stat stat--behind">
          <dt className="stat__label">Behind on</dt>
          <dd className="stat__value">
            <ImpactLines lines={ranked.disadvantages} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * The sentences of one list, each with its place across both lists where it has one.
 *
 * **The tag leads the line rather than trailing it.** Every sentence ends in the number it was
 * ranked on, and a "#1" after that number reads as part of the arithmetic.
 */
function ImpactLines({ lines }: { lines: readonly TaggedLine[] }) {
  return (
    <ul className="line-list">
      {lines.map((each, at) => (
        <li key={`${at}-${each.line}`}>
          {each.tag !== null && (
            <span className="line-list__tag">{each.tag}</span>
          )}
          <span className="line-list__line">{each.line}</span>
        </li>
      ))}
    </ul>
  );
}

function nameOf(comparison: Comparison, candidate: string): string {
  return (
    (comparison.comparators ?? []).find((each) => each.candidate === candidate)
      ?.name ?? candidate
  );
}

