import { NavLink } from "react-router-dom";
import { useAppConfig } from "../config/AppConfigContext";
import { formatCount, formatDateTime, formatMoney } from "../format/display";
import { ROUTES } from "../navigation/routes";

/**
 * Where the Run screen lives, found once by name.
 *
 * The sidebar linked to `ROUTES[1]`, which meant Run only for as long as nobody reordered the
 * list -- and reordering it is a change nothing would have failed on.
 */
const ACQUIRE = ROUTES.find((route) => route.label === "Acquire")!;
import { ErrorNotice } from "./ErrorNotice";
import { useSelection } from "./SelectionContext";
import { useShellSummary } from "./useShellSummary";

/**
 * The persistent sidebar of `reqs.md` 8.1: display name, active criteria set, level toggle,
 * candidate counts, last-run summary and a link to run history.
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

      {selection.status === "error" ? (
        <ErrorNotice error={selection.error} onRetry={selection.reload} />
      ) : (
        <SelectionControls />
      )}

      <CandidateCountsPanel summary={summary} />
      <LastRunPanel summary={summary} />
    </aside>
  );
}

function SelectionControls() {
  const { levels, criteriaSets, levelId, criteriaSetId, selectLevel, selectCriteriaSet } =
    useSelection();

  return (
    <>
      <section className="panel">
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
      </section>

      <section className="panel">
        <fieldset className="fieldset">
          <legend className="field__label">Level</legend>
          <div className="toggle-group">
            {levels.map((level) => (
              <label key={level.id} className="toggle">
                <input
                  type="radio"
                  name="level"
                  value={level.id}
                  checked={levelId === level.id}
                  onChange={() => selectLevel(level.id)}
                />
                <span>{level.id}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
    </>
  );
}

function CandidateCountsPanel({ summary }: { summary: ReturnType<typeof useShellSummary> }) {
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
          <Stat label="Matching" value={formatCount(counts.data.matching)} />
          <Stat label="Not matching" value={formatCount(counts.data.notMatching)} />
          <Stat label="Insufficient data" value={formatCount(counts.data.insufficientData)} />
        </dl>
      )}
    </section>
  );
}

function LastRunPanel({ summary }: { summary: ReturnType<typeof useShellSummary> }) {
  const { lastRun } = summary;

  return (
    <section className="panel" aria-labelledby="last-run-heading">
      <h2 id="last-run-heading" className="panel__heading">
        Last run
      </h2>
      {lastRun.status === "loading" && <p className="panel__hint">Loading…</p>}
      {lastRun.status === "error" && <ErrorNotice error={lastRun.error} onRetry={summary.reload} />}
      {lastRun.status === "ready" &&
        (lastRun.data === null ? (
          <p className="panel__hint">No data acquisition run yet.</p>
        ) : (
          <dl className="stat-list">
            <Stat label="Status" value={lastRun.data.run_status.replace(/_/g, " ")} />
            <Stat label="Started" value={formatDateTime(lastRun.data.started_at)} />
            <Stat label="Cost" value={formatMoney(lastRun.data.cost_eur, "EUR")} />
          </dl>
        ))}
      {/* Found by label rather than by position: `ROUTES[1]` meant "Run" only for as long as
          nobody reordered the list, and reordering it is a change nothing would have failed on. */}
      <NavLink className="panel__link" to={ACQUIRE.path}>
        Run history
      </NavLink>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}
