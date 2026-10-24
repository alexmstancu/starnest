import { useCallback, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ComparisonMatrix } from "./ComparisonMatrix";
import { ViewChoices } from "./ViewChoices";
import type { Measure } from "./pillarMatrix";
import { droppedByLimit, withinLimit } from "./comparatorLimit";
import { requestFor, type ComparisonRequest } from "./comparisonRequest";
import { pillarPriority, pillarWeightsAt } from "./ordering";
import {
  fetchCandidates,
  fetchComparison,
  fetchCriteriaSet,
  fetchSettings,
  type Candidate,
  type Comparison,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { usePillarNames } from "../../api/usePillarNames";
import type { RouteDefinition } from "../../navigation/routes";
import { deltaTone, formatSigned, pillarName } from "../../format/display";
import { UnsetSetting } from "../../shell/UnsetSetting";
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
  const [asked, setAsked] = useState<ComparisonRequest | null>(null);

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
  // **The set's configured pillar weights** (PL-104), read as Rank reads them: what the Weight
  // column shows and what "#N priority" ranks, so neither moves when only the focus changes. A
  // failure is silence -- the comparison stands without its weights and tags.
  const criteriaSet = useResource(
    useCallback(
      (signal: AbortSignal) => fetchCriteriaSet(criteriaSetId ?? "", { signal }),
      [criteriaSetId],
    ),
    criteriaSetId !== null,
  );
  const pillarWeights = pillarWeightsAt(
    criteriaSet.resource.status === "ready" ? criteriaSet.resource.data : null,
    levelId,
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
  const request = requestFor(focus, kept);

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
          request={request}
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
          onCompare={setAsked}
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
          pillarWeights={pillarWeights}
        />
      )}
    </>
  );
}

function ComparisonPicker({
  roster,
  focus,
  comparators,
  request,
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
  /** What Compare would send, or null while there is nothing to compare. */
  request: ComparisonRequest | null;
  limit: number | null;
  onFocus: (candidate: string | null) => void;
  onToggleComparator: (candidate: string) => void;
  onCompare: (request: ComparisonRequest) => void;
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
          // The placeholder's value is "", which is no candidate: a cleared focus is none.
          onChange={(event) => onFocus(event.target.value || null)}
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

      {/* Disabled, and sending, from one answer -- the two used to disagree (UI-25). */}
      <button
        type="button"
        className="button button--primary"
        disabled={request === null}
        onClick={request === null ? undefined : () => onCompare(request)}
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
  pillarWeights,
}: {
  comparison: Comparison;
  shownAs: "score" | "raw";
  measure: Measure;
  pillarWeights: ReadonlyMap<string, number>;
}) {
  const comparators = comparison.comparators ?? [];
  // One priority for the cards and the matrix, so "#N" means one thing on the screen (PL-100).
  const priority = pillarPriority(pillarWeights);
  return (
    <>
      <h3 className="panel__heading">
        {comparison.focus.name} against{" "}
        {comparators.map((each) => each.name).join(", ")}
      </h3>

      {/* **Side by side, one card per comparator.** Five of them stacked is five screens of
          scrolling to answer "which of these is closest"; in a row the totals line up and the
          answer is the shape of the column.

          Keyed by position as well as by comparator: a key has to be unique among siblings,
          not meaningful. */}
      <div className="synthesis">
      {(comparison.synthesis ?? []).map((pair, at) => (
        <SynthesisCard
          key={`${pair.comparator}-${at}`}
          comparison={comparison}
          pair={pair}
          priority={priority}
        />
      ))}
      </div>

      {/* **The pillars are the whole table, and each opens to its own attributes.** The
          matrix is the answer; the evidence for a pillar lives under the pillar, not in a
          second table below -- so `shownAs` reaches the attribute rows that the toggle
          governs, while the pillar rows above them stay in points, having no unit of their
          own (a pillar is a weighted mean of figures measured in different ones). */}
      <ComparisonMatrix
        comparison={comparison}
        measure={measure}
        shownAs={shownAs}
        pillarWeights={pillarWeights}
        priority={priority}
      />
    </>
  );
}

type SynthesisPair = NonNullable<Comparison["synthesis"]>[number];
type SynthesisLine = SynthesisPair["ahead"][number];

/**
 * One comparator's synthesis: the total gap in points, then the pillars it leads and trails on,
 * each worth what the server says its gap adds to the total (PL-100).
 *
 * **Lines only where both totals exist** (PL-099, C07-F): a line is a share of the total gap,
 * and with either total missing there is no gap for it to be a share of. What either side left
 * unscored is named in the footnote rather than listed as a gap of nothing.
 */
function SynthesisCard({
  comparison,
  pair,
  priority,
}: {
  comparison: Comparison;
  pair: SynthesisPair;
  priority: ReadonlyMap<string, number>;
}) {
  const pillarNames = usePillarNames();
  const naming = (pillar: string) => pillarName(pillarNames, pillar);
  const comparable = pair.score_delta !== null;

  return (
    <section className="panel synthesis__card">
      <div className="panel__head">
        <h4 className="synthesis__name">{nameOf(comparison, pair.comparator)}</h4>
        <span
          // **Three states, because there are three** (P83): a gap nobody can measure is muted,
          // never coloured as a lead.
          className={`synthesis__delta synthesis__delta--${deltaTone(pair.score_delta)}`}
        >
          {comparable ? `${formatSigned(pair.score_delta, 0)} points` : "No comparable score"}
        </span>
      </div>
      {comparable ? (
        <>
          <p className="synthesis__lead">
            By impact on the total, in points: what each pillar&apos;s gap adds to it.
          </p>
          {/* Stacked, not label-and-value: a list is not a figure. The design colours the two
              labels, so the direction is readable before the words are. */}
          <dl className="stat-list stat-list--stacked">
            <div className="stat stat--ahead">
              <dt className="stat__label">Ahead on</dt>
              <dd className="stat__value">
                <PillarLines lines={pair.ahead} priority={priority} naming={naming} />
              </dd>
            </div>
            <div className="stat stat--behind">
              <dt className="stat__label">Behind on</dt>
              <dd className="stat__value">
                <PillarLines lines={pair.behind} priority={priority} naming={naming} />
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="synthesis__lead">{whyNotComparable(comparison, pair.comparator)}</p>
      )}
      {pair.not_comparable.length > 0 && (
        <p className="synthesis__lead synthesis__footnote">
          Not comparable, no data: {pair.not_comparable.map(naming).join(", ")}
        </p>
      )}
    </section>
  );
}

/**
 * One list's pillars, each with what its gap is worth and, for one of the set's heaviest, the
 * same "#N priority" the matrix row carries. An empty list says so rather than showing a label
 * over nothing (PL-107).
 */
function PillarLines({
  lines,
  priority,
  naming,
}: {
  lines: readonly SynthesisLine[];
  priority: ReadonlyMap<string, number>;
  naming: (pillar: string) => string;
}) {
  if (lines.length === 0) {
    return (
      <ul className="line-list">
        <li>Nothing</li>
      </ul>
    );
  }
  return (
    <ul className="line-list">
      {lines.map((line) => {
        const place = priority.get(line.pillar);
        return (
          <li key={line.pillar} className="synthesis__line">
            <span className="line-list__line">{naming(line.pillar)}</span>
            <span className="synthesis__worth">{formatSigned(line.worth, 1)}</span>
            {place !== undefined && (
              <span className="chip chip--accent">#{place + 1} priority</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Whose total is missing, in the server's words where it gave them. */
function whyNotComparable(comparison: Comparison, comparator: string): string {
  const theirs = (comparison.comparators ?? []).find((each) => each.candidate === comparator);
  const missing = [comparison.focus, theirs].filter(
    (side): side is Comparison["focus"] => side !== undefined && typeof side.score !== "number",
  );
  return missing
    .map((side) =>
      side.insufficient_reason
        ? `${side.name}: ${side.insufficient_reason}`
        : `${side.name} has no total score.`,
    )
    .join(" ");
}

function nameOf(comparison: Comparison, candidate: string): string {
  return (
    (comparison.comparators ?? []).find((each) => each.candidate === candidate)
      ?.name ?? candidate
  );
}
