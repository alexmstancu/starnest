import { useCallback } from "react";
import { fetchDataSources } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";

/**
 * The source priority order, shown and not editable.
 *
 * **Deliberately read-only.** Source priority is domain configuration shipped as migrations
 * (`arch.md` 1.2, 7.5), and the user's role does not include connecting sources. It is on this
 * screen because the order decides which figure is the active one, and a ranking nobody can
 * see the priority behind is not explained.
 *
 * **A lower number wins**, which is stated rather than left to be inferred from the sort.
 */
export function DataSourcesPanel() {
  const { resource, reload } = useResource(
    useCallback((signal: AbortSignal) => fetchDataSources({ signal }), []),
  );

  return (
    <section className="panel" aria-labelledby="data-sources-heading">
      <h3 id="data-sources-heading" className="panel__heading">
        Source priority
      </h3>
      <p className="panel__hint">
        Which source wins when two answer the same attribute. A lower number
        wins. Changed by a migration, not here -- nothing about a measurement is
        a preference.
      </p>

      {resource.status === "error" && (
        <ErrorNotice error={resource.error} onRetry={reload} />
      )}
      {resource.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}

      {resource.status === "ready" && (
        <table className="table">
          <caption>Every configured source, in priority order</caption>
          <thead>
            <tr>
              <th scope="col">Priority</th>
              <th scope="col">Source</th>
              <th scope="col">Kind</th>
              <th scope="col">Reliability</th>
            </tr>
          </thead>
          <tbody>
            {[...resource.data.items]
              .sort(
                (one, other) => one.default_priority - other.default_priority,
              )
              .map((source) => (
                <tr key={source.id}>
                  <td className="table__cell--numeric">
                    {source.default_priority}
                  </td>
                  <th scope="row">{source.name}</th>
                  <td>{source.source_kind}</td>
                  <td>{source.reliability_tier}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
