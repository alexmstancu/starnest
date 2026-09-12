import { useCallback, useState } from "react";
import {
  fetchCandidates,
  fetchComparison,
  fetchSettings,
  type Candidate,
  type Comparison,
} from "../api/endpoints";
import { useResource } from "../api/useResource";
import type { RouteDefinition } from "../app/routes";
import { formatScore } from "../format/display";
import { ErrorNotice } from "../shell/ErrorNotice";
import { useSelection } from "../shell/SelectionContext";

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
  const [focus, setFocus] = useState<string | null>(null);
  const [comparators, setComparators] = useState<string[]>([]);
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

  return (
    <section className="screen" aria-labelledby="screen-heading">
      <h2 id="screen-heading" className="screen__heading">
        {route.label}
      </h2>

      {criteriaSetId === null || levelId === null ? (
        <p className="screen__note">
          Choose a criteria set and a level to compare candidates.
        </p>
      ) : (
        <ComparisonPicker
          roster={roster}
          focus={focus}
          comparators={comparators}
          limit={limit ?? null}
          onFocus={setFocus}
          onToggleComparator={(candidate) =>
            setComparators((chosen) =>
              chosen.includes(candidate)
                ? chosen.filter((each) => each !== candidate)
                : [...chosen, candidate],
            )
          }
          onCompare={() => focus && setAsked({ focus, comparators })}
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
        <ComparisonTable comparison={comparison.resource.data} />
      )}
    </section>
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
}: {
  roster: Candidate[];
  focus: string | null;
  comparators: string[];
  limit: number | null;
  onFocus: (candidate: string) => void;
  onToggleComparator: (candidate: string) => void;
  onCompare: () => void;
}) {
  return (
    <div className="panel">
      <h3 className="panel__heading">What to compare</h3>
      <p className="panel__hint">
        {limit === null
          ? "No comparator limit is configured, so the server will refuse a comparison."
          : `Up to ${limit} comparators, the limit configured in Settings.`}
      </p>

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

function ComparisonTable({ comparison }: { comparison: Comparison }) {
  const comparators = comparison.comparators ?? [];
  return (
    <>
      <h3 className="panel__heading">
        {comparison.focus.name} against{" "}
        {comparators.map((each) => each.name).join(", ")}
      </h3>

      {(comparison.synthesis ?? []).map((pair) => (
        <section key={pair.comparator ?? "pair"} className="panel">
          <h4 className="panel__heading">
            {nameOf(comparison, pair.comparator ?? "")}: {formatSigned(pair.score_delta)} points
          </h4>
          <p className="panel__hint">
            Ordered by what each difference is worth to the score, not by how
            large it looks.
          </p>
          <dl className="stat-list">
            <div className="stat">
              <dt className="stat__label">Ahead on</dt>
              <dd className="stat__value">
                <ul>
                  {(pair.advantages ?? []).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div className="stat">
              <dt className="stat__label">Behind on</dt>
              <dd className="stat__value">
                <ul>
                  {(pair.disadvantages ?? []).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </section>
      ))}

      <table className="table">
        <caption>Every attribute, with the gap and what it is worth</caption>
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
              <td>{formatScore(row.focus?.normalised_score)}</td>
              {comparators.map((each) => {
                const cell = (row.comparators ?? []).find(
                  (candidate) => candidate.candidate === each.candidate,
                );
                return (
                  <td key={each.candidate}>
                    {formatScore(cell?.normalised_score)}
                    {cell?.weighted_contribution != null && (
                      <span className="table__note">
                        {" "}
                        ({formatSigned(cell.weighted_contribution)} points)
                      </span>
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

/** A signed number reads as a direction, which is what a delta is. */
function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
