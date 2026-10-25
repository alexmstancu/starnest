import { useCallback, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  type EvaluationSummary,
  fetchCandidates,
  fetchEvaluations,
  fetchHousehold,
} from "../api/endpoints";
import { hasErrorCode } from "../api/ApiError";
import type { Idle, Read } from "../api/read";
import { useRead } from "../api/useRead";
import { useCandidateNames } from "../api/useCandidateNames";
import { useAppConfig } from "../config/AppConfigContext";
import {
  ABSENT,
  candidateName,
  formatCount,
  formatDateTime,
  formatIdentifier,
  formatMoney,
  formatMoneyPerMonth,
  formatCountInWords,
} from "../format/display";
import {
  describeSaved,
  newestFirst,
  requestedSavedRanking,
  ledOn,
  type SetNames,
} from "../format/savedRanking";
import { HOUSEHOLD_LABELS } from "../format/vocabulary";
import { HISTORY_ANCHOR, ROUTES } from "../navigation/routes";
import { LoadedRegion } from "./LoadedRegion";
import { SavedRankingRow } from "./SavedRankingRow";
import { useSelection } from "./SelectionContext";
import { RunStatusChip } from "./RunStatusChip";
import { Skeleton } from "./Skeleton";
import { levelsWithCandidates, noRankingBecause } from "./candidateCounts";
import { useScreenChanges } from "./useScreenChanges";
import { type FocusRegion, useFocusRegion, useFocusWhenLost } from "./useFocusWhenLost";
import { useShellSummary, type ShellSummary } from "./useShellSummary";

/**
 * Where two screens live, found once by name.
 *
 * The sidebar linked to `ROUTES[1]`, which meant Acquire only for as long as nobody reordered
 * the list -- and reordering it is a change nothing would have failed on.
 */
const ACQUIRE = ROUTES.find((route) => route.label === "Acquire")!;
const CONFIGURE = ROUTES.find((route) => route.label === "Configure")!;
const RANK = ROUTES.find((route) => route.label === "Rank")!;

/**
 * The persistent sidebar of `reqs.md` 8.1, in the design's own order: the household first,
 * then what is being looked at, then what has been found.
 *
 * **The household leads because everything else is relative to it.** Attribute defaults,
 * gate answers and several warnings all read it, so a reader who does not know the household
 * cannot interpret a single number further down.
 *
 * **A card reports; a bare group chooses.** The criteria set and the level are controls, and
 * the design leaves them on the sidebar's own white rather than boxing them -- four bordered
 * cards in a column reads as four things to decide rather than two.
 *
 * Everything numeric in here came from the API. The only thing the sidebar computes is which
 * tab is current, which react-router already knows.
 *
 * **What it shows is read again when the screen changes, and when a run it saw running ends**
 * (UI-11) -- the two moments something it reports is likely to have moved elsewhere. A save is
 * seen once the reader moves on, not the moment it lands: the household's choice of the smaller
 * fix.
 */
export function Sidebar() {
  const { displayName } = useAppConfig();
  const selection = useSelection();
  const screenChanges = useScreenChanges();
  // Both only ever grow, so the sum changes whenever either does. The household is written on
  // Configure alone, so a run's end leaves it be.
  const summary = useShellSummary(
    selection.criteriaSetId,
    selection.levelId,
    screenChanges + selection.acquisitionsEnded,
  );

  return (
    <aside className="sidebar">
      <header className="sidebar__brand">
        {/* The initial, not a logo: the product name is configuration (`CLAUDE.md`), so the
            badge derives from it rather than being an asset that would have to be redrawn. */}
        <span className="sidebar__badge" aria-hidden="true">
          {displayName.slice(0, 1)}
        </span>
        <span className="sidebar__identity">
          <p className="sidebar__title">{displayName}</p>
          <span className="sidebar__subtitle">Local instance</span>
        </span>
      </header>

      <HouseholdCard freshness={screenChanges} />

      {/* **The selection's own state first** (PL-009): a list still coming or one that failed
          never reads as "No criteria sets". Said once, here, as a compact line (N4). */}
      <LoadedRegion
        read={selection.read}
        what="The criteria sets and levels"
        skeleton="lines"
        prominence="region"
        onRetry={selection.reloadAndWait}
      >
        {() => <SelectionControls />}
      </LoadedRegion>

      <CandidateCountsCard summary={summary} />
      <LastAcquisitionCard summary={summary} />
      <SavedRankingsCard />
    </aside>
  );
}

function SelectionControls() {
  const {
    levels,
    criteriaSets,
    levelId,
    criteriaSetId,
    selectLevel,
    selectCriteriaSet,
    missingCriteriaSet,
  } = useSelection();
  const opened = criteriaSets.find((set) => set.id === criteriaSetId);

  // **Which levels can be chosen is data, not a name.** A level with no candidate nominated
  // for it would rank an empty list, so it is offered as soon as it holds one and not before
  // -- which is how v1 comes to be country-only without a line of code saying so.
  const { read: roster, reload: reloadRoster } = useRead(
    useCallback((signal: AbortSignal) => fetchCandidates(undefined, { signal }), []),
  );
  // **Offered only once a successful read shows it holds candidates** (PL-009). Until then
  // every level is held -- `aria-disabled`, so focus stays where it is -- and one the roster
  // could not be read for stays held, with the reason beside it.
  const populated = roster.state === "ready" ? levelsWithCandidates(roster.data.items) : null;
  const empty = populated === null ? undefined : levels.find((level) => !populated.has(level.id));

  return (
    <>
      <div className="sidebar__group">
        <label className="field">
          <span className="field__label">Active criteria set</span>
          <select
            className="field__control"
            value={criteriaSetId ?? ""}
            onChange={(event) => selectCriteriaSet(event.target.value)}
            disabled={criteriaSets.length === 0}
          >
            {criteriaSets.length === 0 && <option value="">No criteria set yet</option>}
            {criteriaSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        </label>
        {/* **Said, not silently swapped** (PL-017): editing writes through, so landing on
            another set unannounced invites editing the wrong one. */}
        {missingCriteriaSet !== null && (
          <p className="sidebar__note" role="status">
            The criteria set you last used, {missingCriteriaSet.name}, no longer exists
            {opened === undefined ? "." : `, so ${opened.name} is open instead.`}
          </p>
        )}
      </div>

      <div className="sidebar__group">
        <fieldset className="fieldset">
          <legend className="field__label">Level</legend>
          {/* **Segments, not radios.** The design draws the levels as two buttons sharing the
              sidebar's width, which is how a choice between two named things reads at this
              size; a radio list reads as the first of a longer set.

              **Everything below the shallowest level is disabled, and the note says why.**
              v1 ranks countries (`reqs.md` 1.3): the deeper level has a catalog and no
              candidates, so offering it would offer an empty ranking. Which level is
              shallowest is `depth_order`, not a name -- no code here may assume there are
              exactly two (`reqs.md` 3.1). */}
          <div className="level-group">
            {levels.map((level) => {
              const held = populated === null;
              const available = held || populated.has(level.id);
              return (
                <button
                  key={level.id}
                  type="button"
                  className={
                    levelId === level.id
                      ? "level-group__option level-group__option--current"
                      : "level-group__option"
                  }
                  aria-pressed={levelId === level.id}
                  aria-disabled={held || undefined}
                  disabled={!available}
                  onClick={() => {
                    if (!held) selectLevel(level.id);
                  }}
                >
                  {formatIdentifier(level.id)}
                </button>
              );
            })}
          </div>
        </fieldset>
        {empty !== undefined && (
          <p className="sidebar__note">
            {formatIdentifier(empty.id)} level arrives after v1 (reqs 1.3).
          </p>
        )}
        {roster.state === "failed" && (
          <p className="sidebar__note">
            Could not check which levels hold candidates.{" "}
            <button
              type="button"
              className="button button--quiet"
              onClick={() => void reloadRoster()}
            >
              Try again
            </button>
          </p>
        )}
      </div>
    </>
  );
}

/**
 * The household, in the same words Configure uses for it, and in the design's teal.
 *
 * **The labels come from one constant**, so the two screens cannot drift into calling the
 * same field by two names (UX review I). A reader seeing "Adults" here and "Household size"
 * there has to work out whether they are the same thing.
 *
 * It says "not recorded" rather than showing nothing: a household nobody has filled in is the
 * shipped state, and several gates and criterion defaults read it. **But only when the server
 * says so** (PL-008): any other failure is a failure, with Try again.
 */
function HouseholdCard({ freshness }: { freshness: number }) {
  const { read, reload } = useRead(
    useCallback((signal: AbortSignal) => fetchHousehold({ signal }), []),
    { freshness },
  );
  const household = asked(read);
  // **The home country and the passports are candidate ids** -- `country.romania` -- and the
  // card was printing them raw, the same programmatic identifier the rest of the app was
  // taught not to show. The names come from the shared roster, fetched once.
  const candidateNames = useCandidateNames();

  return (
    <section className="panel panel--household" aria-labelledby="household-summary-heading">
      <div className="panel__head">
        {/* "Household summary", not "Household": the Configure panel is the household and
            this is a view of it, and two landmarks with one name is ambiguous to a screen
            reader as well as to a test. The *field* labels are identical, which is what one
            vocabulary means (UX review I). */}
        <h2 id="household-summary-heading" className="panel__heading">
          Household summary
        </h2>
        <Link className="panel__link" to={CONFIGURE.path}>
          Edit
        </Link>
      </div>
      {household.state === "failed" && hasErrorCode(household.error, "household_not_configured") ? (
        <p className="panel__hint">Nothing has been recorded about the household yet.</p>
      ) : (
        <LoadedRegion
          read={household}
          what="The household"
          skeleton="lines"
          prominence="region"
          onRetry={reload}
        >
          {(recorded) => (
            <dl className="stat-list">
              <Stat
                label={HOUSEHOLD_LABELS.number_adults}
                value={formatCountInWords(recorded.number_adults)}
              />
              <Stat
                label={HOUSEHOLD_LABELS.number_children}
                value={formatCountInWords(recorded.number_children, "None")}
              />
              <Stat
                label={HOUSEHOLD_LABELS.net_income}
                value={formatMoneyPerMonth(recorded.net_income, "EUR")}
              />
              <Stat
                label={HOUSEHOLD_LABELS.target_monthly_spend}
                value={formatMoneyPerMonth(recorded.target_monthly_spend, "EUR")}
              />
              <Stat
                label={HOUSEHOLD_LABELS.max_rent}
                value={formatMoneyPerMonth(recorded.max_rent, "EUR")}
              />
              <Stat
                label={HOUSEHOLD_LABELS.home_country_candidate}
                value={
                  recorded.home_country_candidate === null
                    ? ABSENT
                    : candidateName(candidateNames, recorded.home_country_candidate)
                }
              />
              <Stat
                label={HOUSEHOLD_LABELS.citizenships}
                value={
                  recorded.citizenships.length === 0
                    ? ABSENT
                    : recorded.citizenships
                        .map((id) => candidateName(candidateNames, id))
                        .join(", ")
                }
              />
            </dl>
          )}
        </LoadedRegion>
      )}
    </section>
  );
}

/**
 * Total, then how the ranking splits it (PL-005). **Two reads**: Total needs no score, so a
 * ranking the server refuses -- the top of the score range unset, a set that cannot be ranked
 * -- takes the three counts away and leaves Total, with the reason in words in their place.
 */
function CandidateCountsCard({ summary }: { summary: ShellSummary }) {
  const { read: selection } = useSelection();
  const { total, counts } = summary;
  // The region a reason inherits focus from, when it replaces the Try again that was pressed.
  const focusRegion = useFocusRegion();

  return (
    <section
      className="panel"
      aria-labelledby="candidate-counts-heading"
      onFocus={focusRegion.claim}
    >
      <h2 id="candidate-counts-heading" className="panel__heading">
        Candidates
      </h2>
      {total.state === "idle" ? (
        <NothingSelected selection={selection} />
      ) : (
        <LoadedRegion
          read={total}
          what="The candidate total"
          skeleton="lines"
          prominence="region"
          onRetry={summary.reloadTotal}
        >
          {(candidates) => (
            <dl className="stat-list">
              <Stat label="Total" value={formatCount(candidates)} />
            </dl>
          )}
        </LoadedRegion>
      )}
      <MatchCountsRegion counts={counts} onRetry={summary.reloadCounts} region={focusRegion} />
    </section>
  );
}

function NothingSelected({ selection }: { selection: Read<unknown> }) {
  // A selection still coming is drawn as coming; one that failed has said so above, once.
  if (selection.state === "pending") {
    return (
      <div aria-busy="true">
        <Skeleton shape="lines" />
      </div>
    );
  }
  if (selection.state === "failed") return null;
  return <p className="panel__hint">Nothing to count until there is a criteria set and a level.</p>;
}

function MatchCountsRegion({
  counts,
  onRetry,
  region,
}: {
  counts: ShellSummary["counts"];
  onRetry: () => Promise<void>;
  region: FocusRegion;
}) {
  if (counts.state === "idle") return null;
  // **A re-read refused for an unset range takes the shown counts with it**: they cannot be
  // computed now, so they are not current, and a Try again would be refused for as long as
  // the range stays unset.
  const failure =
    counts.state === "failed"
      ? counts.error
      : counts.state === "ready" && typeof counts.refresh === "object"
        ? counts.refresh.failed
        : null;
  const unranked = noRankingBecause(failure);
  if (unranked !== null) {
    return <NoRankingNote reason={unranked} region={region} />;
  }

  return (
    <LoadedRegion
      read={counts}
      what="The match counts"
      skeleton="lines"
      prominence="region"
      onRetry={onRetry}
    >
      {(tally) => (
        <dl className="stat-list">
          {/* The ranking's own three colours, so the sidebar says what the table says without
              repeating its words. */}
          <Stat label="Matching" value={formatCount(tally.matching)} tone="matching" />
          <Stat label="Not matching" value={formatCount(tally.notMatching)} tone="not-matching" />
          <Stat
            label="Insufficient data"
            value={formatCount(tally.insufficientData)}
            tone="insufficient"
          />
        </dl>
      )}
    </LoadedRegion>
  );
}

/**
 * Why there are no counts. **When it replaces the Try again that was pressed** -- a retry
 * refused for an unset range, whether counts had been shown or never loaded -- it takes the
 * focus that button had, rather than leaving it on the page.
 */
function NoRankingNote({ reason, region }: { reason: string; region: FocusRegion }) {
  const note = useFocusWhenLost<HTMLParagraphElement>(region);
  return (
    <p ref={note} tabIndex={-1} className="sidebar__note sidebar__note--warning">
      {reason}
    </p>
  );
}

function LastAcquisitionCard({ summary }: { summary: ShellSummary }) {
  const lastRun = asked(summary.lastRun);

  return (
    <section className="panel" aria-labelledby="last-run-heading">
      <h2 id="last-run-heading" className="panel__heading">
        Last acquisition
      </h2>
      <LoadedRegion
        read={lastRun}
        what="The last acquisition"
        skeleton="lines"
        prominence="region"
        onRetry={summary.reloadLastRun}
      >
        {(run) =>
          run === null ? (
            <p className="panel__hint">No acquisition yet.</p>
          ) : (
            <dl className="stat-list">
              <div className="stat">
                <dt className="stat__label">Status</dt>
                <dd className="stat__value">
                  <RunStatusChip status={run.run_status} />
                </dd>
              </div>
              <Stat label="Started" value={formatDateTime(run.started_at)} />
              <Stat label="Cost" value={formatMoney(run.cost_eur, "EUR")} />
            </dl>
          )
        }
      </LoadedRegion>
      {/* Found by label rather than by position: `ROUTES[1]` meant "Acquire" only for as long
          as nobody reordered the list, and reordering it is a change nothing would have
          failed on. */}
      {/* To the table itself, not the top of Acquire (PL-127). */}
      <Link className="panel__link" to={{ pathname: ACQUIRE.path, hash: HISTORY_ANCHOR }}>
        Acquisition history
      </Link>
    </section>
  );
}

/**
 * Rankings kept on purpose, listed where they are always in reach.
 *
 * **A saved ranking is about the session, not about the screen that made it.** The design
 * puts it in the sidebar for that reason, and the panel on Rank keeps the control that saves
 * one and the frozen view that opens one.
 *
 * **Opening one shows it; it does not restore it** -- the deliberate divergence recorded in
 * `CLAUDE.md`. The row is a link carrying the evaluation's id, so Rank opens exactly the one
 * that was clicked and the address says which.
 */
function SavedRankingsCard() {
  // Re-read when Rank says it has saved one: the two live in different subtrees, and a list
  // that only refreshes on a reload would tell the reader their save did not happen.
  const { savedRankingsVersion, criteriaSets } = useSelection();
  const sets = new Map(criteriaSets.map((set) => [set.id, set.name]));
  const { read, reload } = useRead(
    useCallback((signal: AbortSignal) => fetchEvaluations({ signal }), []),
    { freshness: savedRankingsVersion },
  );
  const evaluations = asked(read);
  const kept = evaluations.state === "ready" ? evaluations.data.items.length : 0;
  const heading = useRef<HTMLHeadingElement>(null);
  // Said once a deletion found the ranking already gone, so the row vanishing is explained --
  // until the next save, which makes it old news.
  const [alreadyGoneAt, setAlreadyGoneAt] = useState<number | null>(null);
  const alreadyGone = alreadyGoneAt === savedRankingsVersion;
  // **The heading takes the keyboard once a row is gone** (PL-145): the × that had it went
  // with the row, and focus left on nothing falls to the page.
  const gone = useCallback(
    (wasAlreadyGone: boolean) => {
      setAlreadyGoneAt(wasAlreadyGone ? savedRankingsVersion : null);
      void reload();
      heading.current?.focus();
    },
    [reload, savedRankingsVersion],
  );

  return (
    <section className="panel" aria-labelledby="saved-rankings-heading">
      <div className="panel__head">
        <h2
          id="saved-rankings-heading"
          className="panel__heading"
          ref={heading}
          tabIndex={-1}
        >
          Saved rankings
        </h2>
        {kept > 0 && <span className="panel__count">{formatCount(kept)} kept</span>}
      </div>
      {alreadyGone && (
        <p className="sidebar__note">That ranking had already been deleted.</p>
      )}
      <LoadedRegion
        read={evaluations}
        what="The saved rankings"
        skeleton="lines"
        prominence="region"
        onRetry={reload}
      >
        {(answer) => (
          <SavedRankingsList saved={newestFirst(answer.items)} sets={sets} onGone={gone} />
        )}
      </LoadedRegion>
    </section>
  );
}

function SavedRankingsList({
  saved,
  sets,
  onGone,
}: {
  saved: readonly EvaluationSummary[];
  sets: SetNames;
  onGone: (alreadyGone: boolean) => void;
}) {
  // **Only the ranking that is open is the current page** (PL-021). A `NavLink` matched the
  // path alone, so on Rank every saved row claimed to be where the reader already was.
  const { pathname } = useLocation();
  const [parameters, setParameters] = useSearchParams();
  const open = pathname === RANK.path ? requestedSavedRanking(parameters.get("saved")) : null;
  if (saved.length === 0) {
    return (
      <p className="sidebar__note">
        None yet. Save one from Rank and the weights behind it are frozen with it.
      </p>
    );
  }
  // A deleted ranking that was open closes with it, rather than staying on screen to be read
  // as one that still exists.
  const goneFrom = (id: number) => (alreadyGone: boolean) => {
    if (id === open) {
      const next = new URLSearchParams(parameters);
      next.delete("saved");
      setParameters(next, { replace: true });
    }
    onGone(alreadyGone);
  };
  return (
    <ul className="saved-list">
      {saved.map((entry) => (
        <SavedRankingRow
          key={entry.id}
          evaluationId={entry.id}
          name={describeSaved(entry, sets)}
          meta={ledOn(entry)}
          href={`${RANK.path}?saved=${entry.id}`}
          current={entry.id === open}
          onGone={goneFrom(entry.id)}
        />
      ))}
    </ul>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "matching" | "not-matching" | "insufficient";
}) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className={tone ? `stat__value stat__value--${tone}` : "stat__value"}>{value}</dd>
    </div>
  );
}

/**
 * A read that is always asked for, as a `Read`. `useRead` is idle only when disabled, and these
 * never are; the narrowing keeps "nothing was asked" out of a region that cannot draw it.
 */
function asked<T>(read: Read<T> | Idle): Read<T> {
  return read.state === "idle" ? { state: "pending" } : read;
}
