import type { RouteDefinition } from "../navigation/routes";
import { ErrorNotice } from "../shell/ErrorNotice";
import { useSelection } from "../shell/SelectionContext";
import { CriteriaPanel } from "./configure/CriteriaPanel";
import { CriteriaSetsPanel } from "./configure/CriteriaSetsPanel";
import { DataSourcesPanel } from "./configure/DataSourcesPanel";
import { HouseholdPanel } from "./configure/HouseholdPanel";
import { PillarWeightsPanel } from "./configure/PillarWeightsPanel";
import { RulesPanel } from "./configure/RulesPanel";
import { SettingsPanel } from "./configure/SettingsPanel";
import { useCriteriaEditor } from "./useCriteriaEditor";

/**
 * Everything that is a judgement rather than a measurement, on one screen (`reqs.md` 8.2).
 *
 * The panels are ordered the way the decisions depend on each other: the household first,
 * because gates and criterion defaults read it; then the sets of priorities, the pillar
 * weights, the criteria inside them, and the rules the set lets act. The source priority comes
 * last and is read-only -- it is configuration, shown here only because it decides which
 * figure a score used.
 *
 * **Nothing on this screen computes.** Every weight, rebalance and refusal comes from the API;
 * the panels send one change at a time and render the answer (`arch.md` 8.1).
 */
export function ConfigureScreen({ route }: { route: RouteDefinition }) {
  const { criteriaSetId, levelId } = useSelection();
  const editor = useCriteriaEditor(criteriaSetId);

  return (
    <section className="screen" aria-labelledby="screen-heading">
      <h2 id="screen-heading" className="screen__heading">
        {route.label}
      </h2>

      <HouseholdPanel />
      <SettingsPanel />
      <CriteriaSetsPanel />

      {editor.status === "idle" && (
        <p className="screen__note">
          Choose a criteria set to see its criteria.
        </p>
      )}
      {editor.status === "loading" && <p className="screen__note">Loading…</p>}
      {editor.status === "error" && (
        <ErrorNotice error={editor.error} onRetry={editor.reload} />
      )}

      {editor.status === "ready" && editor.criteriaSet !== null && (
        <>
          {/* Keyed by the set, because both panels hold what the set says -- its pillar
              weights, the rules it enforces -- as state they then edit. Switching sets has to
              start that state again from the new set rather than carry the old set's answers
              into it. */}
          <PillarWeightsPanel
            key={editor.criteriaSet.id}
            criteriaSet={editor.criteriaSet}
          />
          <CriteriaPanel editor={editor} />
          {levelId !== null && (
            <RulesPanel
              key={`${editor.criteriaSet.id}-${levelId}`}
              criteriaSet={editor.criteriaSet}
              levelId={levelId}
            />
          )}
        </>
      )}

      <DataSourcesPanel />
    </section>
  );
}
