import { useCallback } from "react";
import { NavLink } from "react-router-dom";
import {
  fetchCandidates,
  fetchEvaluations,
  fetchHousehold,
} from "../api/endpoints";
import { useResource } from "../api/useResource";
import { useAppConfig } from "../config/AppConfigContext";
import {
  ABSENT,
  formatCount,
  formatDateTime,
  formatIdentifier,
  formatMoney,
} from "../format/display";
import { describeSaved, newestFirst, summariseSaved } from "../format/savedRanking";
import { HOUSEHOLD_LABELS } from "../format/vocabulary";
import { ROUTES } from "../navigation/routes";
import { ErrorNotice } from "./ErrorNotice";
import { useSelection } from "./SelectionContext";
import { levelsWithCandidates } from "./candidateCounts";
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
 */
export function Sidebar() {
  const { displayName } = useAppConfig();
  const selection = useSelection();
  const summary = useShellSummary(selection.criteriaSetId, selection.levelId);

  return (
    <aside className="sidebar">
      <header className="sidebar__brand">
        {/* The initial, not a logo: the product name is configuration (`CLAUDE.md`), so the
            badge derives from it rather than being an asset that would have to be redrawn. */}
        <span className="sidebar__badge" aria-hidden="true">
          {displayName.slice(0, 1)}
        </span>
        <span className="sidebar__identity">
          <h1 className="sidebar__title">{displayName}</h1>
          <span className="sidebar__subtitle">Local instance</span>
        </span>
      </header>

      <HouseholdCard />

      {selection.status === "error" ? (
        <ErrorNotice error={selection.error} onRetry={selection.reload} />
      ) : (
        <SelectionControls />
      )}

      <CandidateCountsCard summary={summary} />
      <LastAcquisitionCard summary={summary} />
      <SavedRankingsCard />
    </aside>
  );
}

function SelectionControls() {
  const { levels, criteriaSets, levelId, criteriaSetId, selectLevel, selectCriteriaSet } =
    useSelection();

  // **Which levels can be chosen is data, not a name.** A level with no candidate nominated
  // for it would rank an empty list, so it is offered as soon as it holds one and not before
  // -- which is how v1 comes to be country-only without a line of code saying so.
  const { resource } = useResource(
    useCallback((signal: AbortSignal) => fetchCandidates(undefined, { signal }), []),
  );
  const populated =
    resource.status === "ready"
      ? levelsWithCandidates(resource.data.items)
      : null;
  // Until the roster arrives nothing is disabled: a control that flickers from enabled to
  // disabled is worse than one that waits a moment to say so.
  const offers = (level: string) => populated === null || populated.has(level);
  const empty = levels.find((level) => !offers(level.id));

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
            {criteriaSets.length === 0 && <option value="">No criteria sets</option>}
            {criteriaSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        </label>
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
              const available = offers(level.id);
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
                  disabled={!available}
                  onClick={() => selectLevel(level.id)}
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
 * It says "not set" rather than showing nothing: a household nobody has filled in is the
 * shipped state, and several gates and criterion defaults read it.
 */
function HouseholdCard() {
  const { resource, reload } = useResource(
    useCallback((signal: AbortSignal) => fetchHousehold({ signal }), []),
  );

  return (
    <section
      className="panel panel--household"
      aria-labelledby="household-summary-heading"
    >
      <div className="panel__head">
        {/* "Household summary", not "Household": the Configure panel is the household and
            this is a view of it, and two landmarks with one name is ambiguous to a screen
            reader as well as to a test. The *field* labels are identical, which is what one
            vocabulary means (UX review I). */}
        <h2 id="household-summary-heading" className="panel__heading">
          Household summary
        </h2>
        <NavLink className="panel__link" to={CONFIGURE.path}>
          Edit
        </NavLink>
      </div>
      {resource.status === "loading" && <p className="panel__hint">Loading…</p>}
      {resource.status === "error" && (
        <p className="panel__hint">
          Nothing has been recorded about the household yet.
        </p>
      )}
      {resource.status === "ready" && (
        <dl className="stat-list">
          <Stat
            label={HOUSEHOLD_LABELS.number_adults}
            value={formatCount(resource.data.number_adults)}
          />
          <Stat
            label={HOUSEHOLD_LABELS.number_children}
            value={formatCount(resource.data.number_children)}
          />
          <Stat
            label={HOUSEHOLD_LABELS.net_income}
            value={formatMoney(resource.data.net_income, "EUR")}
          />
          <Stat
            label={HOUSEHOLD_LABELS.target_monthly_spend}
            value={formatMoney(resource.data.target_monthly_spend, "EUR")}
          />
          <Stat
            label={HOUSEHOLD_LABELS.max_rent}
            value={formatMoney(resource.data.max_rent, "EUR")}
          />
          <Stat
            label={HOUSEHOLD_LABELS.home_country_candidate}
            value={resource.data.home_country_candidate ?? ABSENT}
          />
          <Stat
            label={HOUSEHOLD_LABELS.citizenships}
            value={
              resource.data.citizenships.length === 0
                ? ABSENT
                : resource.data.citizenships.join(", ")
            }
          />
        </dl>
      )}
      {resource.status === "idle" && (
        <button type="button" className="button" onClick={reload}>
          Reload
        </button>
      )}
    </section>
  );
}

function CandidateCountsCard({ summary }: { summary: ShellSummary }) {
  const { counts } = summary;

  return (
    <section className="panel" aria-labelledby="candidate-counts-heading">
      <h2 id="candidate-counts-heading" className="panel__heading">
        Candidates
      </h2>
      {counts.status === "idle" && (
        <p className="panel__hint">Choose a criteria set and a level to see the counts.</p>
      )}
      {counts.status === "loading" && <p className="panel__hint">Loading…</p>}
      {counts.status === "error" && <ErrorNotice error={counts.error} onRetry={summary.reload} />}
      {counts.status === "ready" && (
        <dl className="stat-list">
          <Stat label="Total" value={formatCount(counts.data.total)} />
          {/* The ranking's own three colours, so the sidebar says what the table says without
              repeating its words. */}
          <Stat
            label="Matching"
            value={formatCount(counts.data.matching)}
            tone="matching"
          />
          <Stat
            label="Not matching"
            value={formatCount(counts.data.notMatching)}
            tone="not-matching"
          />
          <Stat
            label="Insufficient data"
            value={formatCount(counts.data.insufficientData)}
            tone="insufficient"
          />
        </dl>
      )}
    </section>
  );
}

function LastAcquisitionCard({ summary }: { summary: ShellSummary }) {
  const { lastRun } = summary;

  return (
    <section className="panel" aria-labelledby="last-run-heading">
      <h2 id="last-run-heading" className="panel__heading">
        Last acquisition
      </h2>
      {lastRun.status === "loading" && <p className="panel__hint">Loading…</p>}
      {lastRun.status === "error" && <ErrorNotice error={lastRun.error} onRetry={summary.reload} />}
      {lastRun.status === "ready" &&
        (lastRun.data === null ? (
          <p className="panel__hint">No acquisition yet.</p>
        ) : (
          <dl className="stat-list">
            <Stat label="Status" value={lastRun.data.run_status.replace(/_/g, " ")} />
            <Stat label="Started" value={formatDateTime(lastRun.data.started_at)} />
            <Stat label="Cost" value={formatMoney(lastRun.data.cost_eur, "EUR")} />
          </dl>
        ))}
      {/* Found by label rather than by position: `ROUTES[1]` meant "Acquire" only for as long
          as nobody reordered the list, and reordering it is a change nothing would have
          failed on. */}
      <NavLink className="panel__link" to={ACQUIRE.path}>
        Acquisition history
      </NavLink>
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
  const { savedRankingsVersion } = useSelection();
  const { resource, reload } = useResource(
    useCallback((signal: AbortSignal) => fetchEvaluations({ signal }), []),
    true,
    savedRankingsVersion,
  );
  const saved = resource.status === "ready" ? newestFirst(resource.data.items) : [];

  return (
    <section className="panel" aria-labelledby="saved-rankings-heading">
      <div className="panel__head">
        <h2 id="saved-rankings-heading" className="panel__heading">
          Saved rankings
        </h2>
        {saved.length > 0 && <span className="panel__count">{saved.length} kept</span>}
      </div>
      {resource.status === "loading" && <p className="panel__hint">Loading…</p>}
      {resource.status === "error" && (
        <ErrorNotice error={resource.error} onRetry={reload} />
      )}
      {resource.status === "ready" && saved.length === 0 && (
        <p className="sidebar__note">
          None yet. Save one from Rank and the weights behind it are frozen with it.
        </p>
      )}
      {saved.length > 0 && (
        <ul className="saved-list">
          {saved.map((entry) => (
            <li key={entry.id} className="saved-list__row">
              <NavLink
                className="saved-list__open"
                to={`${RANK.path}?saved=${entry.id}`}
                title="Open this saved ranking"
              >
                <span className="saved-list__name">{describeSaved(entry)}</span>
                <span className="saved-list__meta">{summariseSaved(entry)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      <dd className={tone ? `stat__value stat__value--${tone}` : "stat__value"}>
        {value}
      </dd>
    </div>
  );
}
