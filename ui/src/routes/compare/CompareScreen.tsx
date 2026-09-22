import { useCallback, useState } from "react";
import { ComparisonMatrix } from "./ComparisonMatrix";
import { droppedByLimit, withinLimit } from "./comparatorLimit";
import {
  fetchCandidates,
  fetchComparison,
  fetchSettings,
  type Candidate,
  type Comparison,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import type { RouteDefinition } from "../../navigation/routes";
import { ABSENT, formatScore, formatSigned } from "../../format/display";
import { describeFigure } from "../../format/figure";
import { ErrorNotice } from "../../shell/ErrorNotice";
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
          onFocus={setFocus}
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
      {comparison.resource.status === "error" && (
        <ErrorNotice
          error={comparison.resource.error}
          onRetry={comparison.reload}
        />
      )}
      {comparison.resource.status === "ready" && (
        <ComparisonTable
          comparison={comparison.resource.data}
          shownAs={shownAs}
          onShownAs={setShownAs}
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
}) {
  return (
    <div className="panel">
      <h3 className="panel__heading">What to compare</h3>
      <p className="panel__hint">
        {limit === null
          ? "No comparator limit is configured, so the server will refuse a comparison."
          : `Up to ${limit} comparators, the limit configured in Configure.`}
      </p>

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
        <legend className="field__label">Comparators</legend>
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

      <button
        type="button"
        className="button"
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
  onShownAs,
}: {
  comparison: Comparison;
  shownAs: "score" | "raw";
  onShownAs: (how: "score" | "raw") => void;
}) {
  const comparators = comparison.comparators ?? [];
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
        <section key={`${pair.comparator ?? "pair"}-${at}`} className="panel synthesis__card">
          <div className="panel__head">
            <h4 className="synthesis__name">
              {nameOf(comparison, pair.comparator ?? "")}
            </h4>
            <span
              className={
                pair.score_delta != null && pair.score_delta < 0
                  ? "synthesis__delta synthesis__delta--behind"
                  : "synthesis__delta synthesis__delta--ahead"
              }
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
                <ul className="line-list">
                  {(pair.advantages ?? []).map((line, at) => (
                    <li key={`${at}-${line}`}>{line}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div className="stat stat--behind">
              <dt className="stat__label">Behind on</dt>
              <dd className="stat__value">
                <ul className="line-list">
                  {(pair.disadvantages ?? []).map((line, at) => (
                    <li key={`${at}-${line}`}>{line}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </section>
      ))}
      </div>

      {/* **Raw figures exist per attribute, never per pillar.** A pillar is a weighted mean
          of things measured in different units, so it has no unit of its own -- which is why
          this toggle governs the attribute rows and the synthesis stays in points. */}
      {/* **The matrix first, the attributes under it.** The pillars are the shape of the
          answer; the attributes are the evidence for it, and a reader who wants the evidence
          knows to look down. */}
      <ComparisonMatrix comparison={comparison} />

      <fieldset className="field">
        <legend className="field__label">Show attribute values as</legend>
        <div className="toggle-group">
          <label className="toggle">
            <input
              type="radio"
              name="shown-as"
              checked={shownAs === "score"}
              onChange={() => onShownAs("score")}
            />
            Score 0&ndash;100
          </label>
          <label className="toggle">
            <input
              type="radio"
              name="shown-as"
              checked={shownAs === "raw"}
              onChange={() => onShownAs("raw")}
            />
            Raw figures
          </label>
        </div>
      </fieldset>

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
              <th scope="row">{row.attribute}</th>
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

function nameOf(comparison: Comparison, candidate: string): string {
  return (
    (comparison.comparators ?? []).find((each) => each.candidate === candidate)
      ?.name ?? candidate
  );
}

