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
        <table className="table">
          <caption>Every configured source, in priority order</caption>
          <thead>
            <tr>
              <th scope="col">Priority</th>
              <th scope="col">Source</th>
              <th scope="col">Kind</th>
              <th scope="col">Reliability</th>
              <th scope="col">Consulted</th>
              <th scope="col">Move</th>
            </tr>
          </thead>
          <tbody>
            {inPriorityOrder(sources.sources).map((source) => {
              const position = positions.get(source.id) ?? null;
              const busy = sources.saving === source.id;
              return (
                <tr
                  key={source.id}
                  className={
                    source.is_enabled ? "table__row" : "table__row--superseded"
                  }
                >
                  <td className="table__cell--numeric">
                    {/* No number for a source that is not consulted: showing one would say
                        it is next in line when it is not in the contest at all. */}
                    {position ?? "not consulted"}
                  </td>
                  <th scope="row">{source.name}</th>
                  <td>{source.source_kind}</td>
                  <td>{source.reliability_tier}</td>
                  <td>
                    <label className="toggle toggle--lock">
                      <input
                        type="checkbox"
                        aria-label={`Consult ${source.name}`}
                        checked={source.is_enabled}
                        disabled={busy}
                        onChange={(event) =>
                          sources.setEnabled(source.id, event.target.checked)
                        }
                      />
                      <span aria-hidden="true">
                        {source.is_enabled ? "Consulted" : "Off"}
                      </span>
                    </label>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button"
                      disabled={busy || sources.moveTo(source.id, "up") === null}
                      onClick={() => sources.move(source.id, "up")}
                    >
                      <span className="visually-hidden">
                        Move {source.name} up
                      </span>
                      <span aria-hidden="true">▲</span>
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={
                        busy || sources.moveTo(source.id, "down") === null
                      }
                      onClick={() => sources.move(source.id, "down")}
                    >
                      <span className="visually-hidden">
                        Move {source.name} down
                      </span>
                      <span aria-hidden="true">▼</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
