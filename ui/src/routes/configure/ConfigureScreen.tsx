import { useCallback, useState } from "react";
import type { RouteDefinition } from "../../navigation/routes";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
import { CriteriaPanel } from "./criteria/CriteriaPanel";
import { CriteriaSetsPanel } from "./sets/CriteriaSetsPanel";
import { DataSourcesPanel } from "./sources/DataSourcesPanel";
import { HouseholdPanel } from "./household/HouseholdPanel";
import { PillarWeightsPanel } from "./pillars/PillarWeightsPanel";
import { ProposalsPanel } from "./proposals/ProposalsPanel";
import { useResearchPass } from "./proposals/useResearchPass";
import { RulesPanel } from "./rules/RulesPanel";
import { SettingsPanel } from "./settings/SettingsPanel";
import { RecentChanges } from "./RecentChanges";
import { useAttributeCatalog } from "./useAttributeCatalog";
import { useChangeHistory } from "./useChangeHistory";
import { useCriteriaEditor } from "./useCriteriaEditor";
import { countByPillar } from "./weights";

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
  const history = useChangeHistory();
  // Once for the screen rather than once per opened pillar: every criterion row wants the
  // same copy of what the attributes are, and the panel inside a pillar is mounted and
  // unmounted each time one is opened. The history names its changes from it too.
  const catalog = useAttributeCatalog(levelId);
  const editor = useCriteriaEditor(criteriaSetId, history, catalog);
  // **One signal that the gate answers have moved** (UI-12). The rules and the proposals read
  // the answers separately, so a confirm or a research pass re-read only the proposals, and a
  // gate went on describing answers that had since changed until the screen was remounted.
  const [answersVersion, setAnswersVersion] = useState(0);
  const noteAnswered = useCallback(
    () => setAnswersVersion((version) => version + 1),
    [],
  );
  // **The research pass is the screen's, not the panel's** (UI-01). Switching the criteria set
  // remounts the rules and the proposals inside them, and a pass held there would end with
  // them; leaving Configure is what ends one.
  const pass = useResearchPass(noteAnswered);

  return (
    <section className="screen screen--configure" aria-labelledby="screen-heading">
      <header className="screen__header">
        <h2 id="screen-heading" className="screen__heading">
          {route.label}
        </h2>
        <p className="screen__summary">
          Everything that is a judgement rather than a measurement. Nothing on
          this screen computes.
        </p>
      </header>

      <div className="configure">
        {/* **The stages are a sequence, and their numbers come from this order.** The
            counter lives on `.configure__stages`, so moving a card moves its numeral with
            it and the two cannot disagree. The order is the order the decisions depend on
            each other: which set you are editing, who is moving, what matters and how much,
            what rules out, which source wins, and what an acquisition may spend. */}
        <div className="configure__stages">
          <CriteriaSetsPanel />
          <HouseholdPanel />

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
                  weights, the rules it enforces -- as state they then edit. Switching sets
                  has to start that state again from the new set rather than carry the old
                  set's answers into it. */}
              {/* **Inside the weights, not beside them.** A criterion's weight is a share
                  of its pillar's, so the two are one decision at two depths -- which is how
                  the design draws it, and why opening a pillar is what reveals the
                  attributes under it. */}
              <PillarWeightsPanel
                key={editor.criteriaSet.id}
                criteriaSet={editor.criteriaSet}
                criteriaCounts={countByPillar(editor.criteria)}
                criteriaFor={(pillar) => (
                  <CriteriaPanel
                    editor={editor}
                    pillar={pillar}
                    catalog={catalog}
                  />
                )}
              />

              {levelId !== null && (
                <RulesPanel
                  key={`${editor.criteriaSet.id}-${levelId}`}
                  criteriaSet={editor.criteriaSet}
                  levelId={levelId}
                  answersFreshness={answersVersion}
                >
                  {/* Beside the gates, because that is where a gate is enforced and
                      released: a proposal is an answer to one of the rules listed above
                      it. Its own stage would give a feature that produces a handful of
                      rows the same weight as the household. */}
                  <ProposalsPanel
                    key={`proposals-${levelId}`}
                    levelId={levelId}
                    onAnswered={noteAnswered}
                    answersFreshness={answersVersion}
                    pass={pass}
                  />
                </RulesPanel>
              )}
            </>
          )}

          <DataSourcesPanel />
          <SettingsPanel />
        </div>

        {/* **It never scrolls away.** The only question worth asking while changing things
            is "what have I just done?", and an answer that has to be scrolled back to is an
            answer nobody reads. */}
        <aside className="configure__rail">
          <RecentChanges history={history} busy={editor.busy} />
        </aside>
      </div>
    </section>
  );
}
