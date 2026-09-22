import { ErrorNotice } from "../../../shell/ErrorNotice";
import { inPriorityOrder, positionsOf } from "./sourceOrder";
import { useDataSources } from "./useDataSources";

/**
 * Which sources are consulted, and in what order.
 *
 * **Editable since Q232.** `reqs.md` 2 keeps the catalog -- what exists, in what unit, of what
 * type -- a developer action in config, and that still holds. What is editable here is
 * narrower and different in kind: whether a source already declared is consulted, and where it
 * stands. That is a judgement about which evidence to trust, not a change to what is measured,
 * and it cannot put the catalog into an inconsistent state.
 *
 * **Switching one off keeps every figure it produced.** The values stay stored, stay visible
 * in the drill-down with their provenance, and come back to the ranking the moment it is
 * switched on again (`reqs.md` 3.6). What changes is which figure scores.
 *
 * **A lower number wins**, which is stated rather than left to be inferred from the sort.
 */
export function DataSourcesPanel() {
  const sources = useDataSources();
  const positions = positionsOf(sources.sources);

  return (
    <section className="stage" aria-labelledby="data-sources-heading">
      <header className="stage__head">
        {/* The numeral is a CSS counter on `.stage__number`, so a stage cannot claim a
            position it does not hold -- nothing fails when a hard-coded 4 sits fifth. */}
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          <h3 id="data-sources-heading" className="stage__title">
            Source priority
          </h3>
    <p className="stage__lead">
            Which source wins when two answer the same attribute. A lower number
            wins. Switching one off stops its figures being scored and stops a run
            asking it — every figure it has already produced is kept, and comes
            back if you switch it on again.
          </p>
        </div>
      </header>
      {sources.error != null && (
        <ErrorNotice error={sources.error} onRetry={sources.reload} />
      )}
      {sources.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}

      {sources.status === "ready" && (
        <ul className="source-list" aria-label="Every configured source, in priority order">
          {inPriorityOrder(sources.sources).map((source) => {
            const position = positions.get(source.id) ?? null;
            const busy = sources.saving === source.id;
            return (
              <li
                key={source.id}
                aria-label={source.name}
                className={
                  source.is_enabled ? "source-row" : "source-row source-row--off"
                }
              >
                {/* **A switch, not a checkbox.** Consulting a source is a state it is in, and
                    the design draws it as one; `role="switch"` is what says so to a screen
                    reader, which a styled checkbox behind a label could not (P52). */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={source.is_enabled}
                  aria-label={`Consult ${source.name}`}
                  className="switch"
                  disabled={busy}
                  title="Consult this source at all"
                  onClick={() =>
                    sources.setEnabled(source.id, !source.is_enabled)
                  }
                >
                  <span className="switch__knob" aria-hidden="true" />
                </button>

                {/* No number for a source that is not consulted: showing one would say it is
                    next in line when it is not in the contest at all. */}
                <span className="source-row__priority">
                  {position ?? "—"}
                </span>
                <span className="source-row__name">{source.name}</span>
                <span className="source-row__meta">
                  {position === null
                    ? "not consulted"
                    : `${source.source_kind}, ${source.reliability_tier}`}
                </span>

                <span className="source-row__move">
                  <button
                    type="button"
                    className="arrow"
                    disabled={busy || sources.moveTo(source.id, "up") === null}
                    title="Higher priority"
                    onClick={() => sources.move(source.id, "up")}
                  >
                    <span className="visually-hidden">
                      Move {source.name} up
                    </span>
                    <span aria-hidden="true">▲</span>
                  </button>
                  <button
                    type="button"
                    className="arrow"
                    disabled={busy || sources.moveTo(source.id, "down") === null}
                    title="Lower priority"
                    onClick={() => sources.move(source.id, "down")}
                  >
                    <span className="visually-hidden">
                      Move {source.name} down
                    </span>
                    <span aria-hidden="true">▼</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
