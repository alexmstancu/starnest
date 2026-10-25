import { useCallback, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ComparisonMatrix } from "./ComparisonMatrix";
import { ViewChoices } from "./ViewChoices";
import type { Measure } from "./pillarMatrix";
import { droppedByLimit, withinLimit } from "./comparatorLimit";
import { asksTheSame, requestFor, type ComparisonRequest } from "./comparisonRequest";
import { pillarPriority, pillarWeightsAt } from "./ordering";
import { StatusChip } from "./StatusChip";
import {
  fetchCandidates,
  fetchComparison,
  fetchCriteriaSet,
  fetchSettings,
  type Candidate,
  type Comparison,
} from "../../api/endpoints";
import { ApiError, hasErrorCode } from "../../api/ApiError";
import { combine, map, type Idle, type Read } from "../../api/read";
import { useRead } from "../../api/useRead";
import { usePillarNames } from "../../api/usePillarNames";
import type { RouteDefinition } from "../../navigation/routes";
import { deltaTone, formatSigned, pillarName } from "../../format/display";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { NothingSelected } from "../../shell/NothingSelected";
import { SCORE_SCALE_NOT_SET } from "../../shell/refusalRemedy";
import { NO_COMPARATOR_LIMIT, UnsetSetting } from "../../shell/UnsetSetting";
import { type FocusRegion, useFocusRegion, useFocusWhenLost } from "../../shell/useFocusWhenLost";
import { type SelectionLists, useSelection } from "../../shell/SelectionContext";

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
  const focusRegion = useFocusRegion();

  return (
    // The region a notice inherits focus from, when it replaces the Compare that was pressed.
    <section className="screen" aria-labelledby="screen-heading" onFocus={focusRegion.claim}>
      <header className="screen__header">
        <h1 id="screen-heading" className="screen__heading">
          {route.label}
        </h1>
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
        focusRegion={focusRegion}
      />
    </section>
  );
}

function TheComparison({
  criteriaSetId,
  levelId,
  focusRegion,
}: {
  criteriaSetId: string | null;
  levelId: string | null;
  focusRegion: FocusRegion;
}) {
  const selection = useSelection();
  const [focus, setFocus] = useState<string | null>(null);
  const [comparators, setComparators] = useState<string[]>([]);
  // How the attribute rows read: the normalised score, or the figure in its own unit.
  const [shownAs, setShownAs] = useState<"score" | "raw">("score");
  const [measure, setMeasure] = useState<Measure>("points");
  const [asked, setAsked] = useState<ComparisonRequest | null>(null);

  const candidates = useRead(
    useCallback(
      (signal: AbortSignal) => fetchCandidates(levelId ?? "", { signal }),
      [levelId],
    ),
    { enabled: levelId !== null },
  );
  const settings = useRead(
    useCallback((signal: AbortSignal) => fetchSettings({ signal }), []),
  );
  // **The set's configured pillar weights** (PL-104), read as Rank reads them: what the Weight
  // column shows and what "#N priority" ranks, so neither moves when only the focus changes.
  // **A read like the others** (PL-001): the comparison is drawn once they are read, and says
  // so when they could not be, rather than standing without them.
  const criteriaSet = useRead(
    useCallback(
      (signal: AbortSignal) => fetchCriteriaSet(criteriaSetId ?? "", { signal }),
      [criteriaSetId],
    ),
    { enabled: criteriaSetId !== null },
  );

  const comparison = useRead(
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
    { enabled: asked !== null },
  );

  // Names for a refusal that lists candidates (PL-007), from the roster once it is read.
  const rosterNames = new Map(
    (candidates.read.state === "ready" ? candidates.read.data.items : []).map((each) => [
      each.id,
      each.name,
    ]),
  );

  if (criteriaSetId === null || levelId === null) {
    return <SelectionNotReady lists={selection.read} />;
  }

  // **No score range, nothing to compare** (PL-005): known from the settings before anything
  // is picked, and from the comparison's refusal -- first read or read again -- when the range
  // was cleared meanwhile.
  const comparisonFailure = failureOf(comparison.read);
  const refusedForTheRange =
    comparisonFailure !== null && hasErrorCode(comparisonFailure, "score_scale_not_set");
  if (settings.read.state === "ready" && settings.read.data.score_scale_max === null) {
    return <NothingToCompare error={UNSET_SCORE_RANGE} region={focusRegion} />;
  }
  if (refusedForTheRange) return <NothingToCompare error={comparisonFailure} region={focusRegion} />;

  // The comparison's own failure, or the weights' if it is theirs: Try again reads what failed.
  const weights = map(asRead(criteriaSet.read), (set) => pillarWeightsAt(set, levelId));
  const weightsFailed = weights.state === "failed";

  return (
    <>
      {/* **Drawn from a read roster and a read limit, never from their absence** (PL-001): a
          pending roster was an empty Focus list, and a pending limit "No comparator limit is
          configured". */}
      <LoadedRegion
        read={combine(asRead(candidates.read), asRead(settings.read))}
        what="The candidates and the comparator limit"
        skeleton="compare-picker"
        onRetry={async () => {
          await Promise.all([candidates.reload(), settings.reload()]);
        }}
      >
        {([roster, { comparator_limit: limit }]) =>
          // **An unset limit is a state, said before anything is picked** (PL-019).
          limit === null || limit === undefined ? (
            <UnsetSetting error={NO_COMPARATOR_LIMIT} title="Nothing to compare" detail="" />
          ) : (
          <ComparisonPicker
            roster={roster.items}
            focus={focus}
            chosen={comparators}
            limit={limit ?? null}
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
            onCompare={(request) => {
              if (asksTheSame(request, asked)) void comparison.reload();
              else setAsked(request);
            }}
          />
          )
        }
      </LoadedRegion>

      {comparison.read.state === "failed" && (
        <UnsetSetting
          error={comparison.read.error}
          title="Nothing to compare"
          detail={UNSET_DETAIL}
          onRetry={() => void comparison.reload()}
          names={{ candidate: (id) => rosterNames.get(id) }}
        />
      )}
      {(comparison.read.state === "pending" || comparison.read.state === "ready") && (
        <LoadedRegion
          read={combine(comparison.read, weights)}
          what={weightsFailed ? "The criteria set's weights" : "The comparison"}
          skeleton="rank-table"
          onRetry={weightsFailed ? criteriaSet.reload : comparison.reload}
        >
          {([drawn, pillarWeights]) => (
            <ComparisonTable
              comparison={drawn}
              shownAs={shownAs}
              measure={measure}
              pillarWeights={pillarWeights}
            />
          )}
        </LoadedRegion>
      )}
    </>
  );
}

/**
 * "Nothing to compare", in place of the whole comparison. **When it replaces the Compare the
 * reader pressed** it takes the focus that button had, rather than leaving it on the page; drawn
 * from the settings before anything was pressed, it takes none.
 */
function NothingToCompare({ error, region }: { error: unknown; region: FocusRegion }) {
  const notice = useFocusWhenLost<HTMLDivElement>(region);
  return (
    <div ref={notice} tabIndex={-1}>
      <UnsetSetting error={error} title="Nothing to compare" detail={UNSET_DETAIL} />
    </div>
  );
}

/** Why a read did not answer: its first read failed, or a read of it again did. */
function failureOf(read: Read<unknown> | Idle): unknown {
  if (read.state === "failed") return read.error;
  if (read.state === "ready" && typeof read.refresh === "object") return read.refresh.failed;
  return null;
}

/**
 * The refusal the server gives a comparison while the score range is unset, known from the
 * settings before one is asked for: the same card for the same state, whichever said it first.
 */
const UNSET_SCORE_RANGE = new ApiError({
  code: SCORE_SCALE_NOT_SET,
  message: "The top of the score range is not set.",
  status: 409,
});

const UNSET_DETAIL =
  "A comparison is a difference between two scores, and no score can be computed without a top of the range. Set it and the comparison returns.";

/** A read always asked for here, as a `Read`: it is idle only before its prerequisite exists. */
function asRead<T>(read: Read<T> | Idle): Read<T> {
  return read.state === "idle" ? PENDING : read;
}

/**
 * Nothing chosen in the sidebar. **While its lists are coming, or hold a set and a level the
 * selection is about to choose**, the screen is still being read (PL-009); once they failed or
 * hold nothing to choose, the shell's `NothingSelected` says which (PL-002).
 */
function SelectionNotReady({ lists }: { lists: Read<SelectionLists> }) {
  const choosing =
    lists.state === "ready" &&
    lists.data.levels.length > 0 &&
    lists.data.criteriaSets.length > 0;
  if (lists.state === "pending" || choosing) {
    return (
      <LoadedRegion
        read={PENDING}
        what="The criteria sets and levels"
        skeleton="compare-picker"
        onRetry={() => undefined}
      >
        {() => null}
      </LoadedRegion>
    );
  }
  return <NothingSelected toSee="to compare candidates" />;
}

const PENDING: Read<never> = { state: "pending" };

function ComparisonPicker({
  roster,
  focus,
  chosen,
  limit,
  onFocus,
  onToggleComparator,
  onCompare,
  choices,
}: {
  roster: Candidate[];
  focus: string | null;
  /** Every comparator ticked, before the limit trims them. */
  chosen: string[];
  limit: number | null;
  onFocus: (candidate: string | null) => void;
  onToggleComparator: (candidate: string) => void;
  onCompare: (request: ComparisonRequest) => void;
  /** The two questions about how to read the comparison, answered before it is drawn. */
  choices: ReactNode;
}) {
  // **Trimmed as it is rendered, not on a click.** The limit was enforced only when adding, so
  // lowering it in Configure left a selection above it in place -- and `/comparisons` answers
  // 409 above the limit, so that was a request this application could never make (R4).
  const comparators = withinLimit(chosen, limit);
  // How many the limit is holding back, so the screen says so rather than losing them.
  const dropped = droppedByLimit(chosen, limit);
  const request = requestFor(focus, comparators);
  const full = limit !== null && comparators.length >= limit;

  return (
    <div className="panel">
      {/* The limit sits beside the heading rather than under it: it is a fact about this
          panel's one control, and a reader only needs it when they reach for another chip. */}
      <div className="panel__head">
        <h2 className="panel__heading">What to compare</h2>
        <span className="picker__limit">
          <span className={full ? "picker__limit-note picker__limit-note--full" : "picker__limit-note"}>
            {limit === null
              ? ""
              : full
                ? `You have ${String(comparators.length)} of ${String(limit)} — the limit set in Configure. Remove one to add another, or raise the limit there.`
                : `Up to ${String(limit)} comparators, the limit set in Configure.`}
          </span>
          <Link className="action" to="/configure">
            Change it in Configure
          </Link>
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
      <h2 className="panel__heading">
        {comparison.focus.name} against{" "}
        {comparators.map((each) => each.name).join(", ")}
      </h2>

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
  const theirs = (comparison.comparators ?? []).find((each) => each.candidate === pair.comparator);

  return (
    <section className="panel synthesis__card">
      <div className="panel__head">
        <h3 className="synthesis__name">{nameOf(comparison, pair.comparator)}</h3>
        {theirs && <StatusChip result={theirs} />}
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
