import { useSelection } from "../shell/SelectionContext";
import type { RouteDefinition } from "../app/routes";

/**
 * What a tab shows until P6 builds it.
 *
 * It states what the screen will contain and echoes the current selection, which is the point:
 * it proves the sidebar's criteria set and level actually reach the routes, without any screen
 * pretending to work yet. Showing a plausible-looking empty table instead would be the
 * interface equivalent of fabricating a score.
 */
export function PlaceholderScreen({ route }: { route: RouteDefinition }) {
  const { criteriaSetId, levelId, criteriaSets } = useSelection();
  const criteriaSetName =
    criteriaSets.find((set) => set.id === criteriaSetId)?.name ?? criteriaSetId ?? "none";

  return (
    <section className="screen" aria-labelledby="screen-heading">
      <h2 id="screen-heading" className="screen__heading">
        {route.label}
      </h2>
      <p className="screen__summary">{route.summary}</p>

      <dl className="stat-list stat-list--inline">
        <div className="stat">
          <dt className="stat__label">Criteria set</dt>
          <dd className="stat__value">{criteriaSetName}</dd>
        </div>
        <div className="stat">
          <dt className="stat__label">Level</dt>
          <dd className="stat__value">{levelId ?? "none"}</dd>
        </div>
      </dl>

      <p className="screen__note">This screen is built in P6. Nothing on it is live yet.</p>
    </section>
  );
}
