import { useCallback, useRef, useState } from "react";
import type { RouteDefinition } from "../../navigation/routes";
import type { Idle, Read } from "../../api/read";
import type { CriteriaSet, MatchRuleResult } from "../../api/endpoints";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { useSelection } from "../../shell/SelectionContext";
import { type AnswerForm, GateAnswersPanel } from "./answers/GateAnswersPanel";
import { CriteriaPanel } from "./criteria/CriteriaPanel";
import { CriteriaSetsPanel } from "./sets/CriteriaSetsPanel";
import { useCriteriaSets } from "./sets/useCriteriaSets";
import { DataSourcesPanel } from "./sources/DataSourcesPanel";
import { HouseholdPanel } from "./household/HouseholdPanel";
import { PillarWeightsPanel } from "./pillars/PillarWeightsPanel";
import { ProposalsPanel } from "./proposals/ProposalsPanel";
import { useResearchPass } from "./proposals/useResearchPass";
import { RulesPanel } from "./rules/RulesPanel";
import { SettingsPanel } from "./settings/SettingsPanel";
import { RecentChanges } from "./RecentChanges";
import { Stage } from "./Stage";
import { useAttributeCatalog } from "./useAttributeCatalog";
import { useConfigurationSession } from "./useConfigurationSession";
import { useCriteriaEditor } from "./useCriteriaEditor";
import { countByPillar, requiredAttributes, unsourcedShareByPillar } from "./weights";

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
  const selection = useSelection();
  const { criteriaSetId, levelId } = selection;
  // The history, its one write in flight and where answers go outlive this screen (PL-033).
  const { history, pillarAnswers, criteriaAnswers } = useConfigurationSession();
  // Once for the screen rather than once per opened pillar: every criterion row wants the
  // same copy of what the attributes are, and the panel inside a pillar is mounted and
  // unmounted each time one is opened. The history names its changes from it too.
  const catalog = useAttributeCatalog(levelId);
  const editor = useCriteriaEditor(criteriaSetId, history, catalog.catalog, criteriaAnswers);
  // **The one writer of sets, here rather than in its panel** (D-C03-9): its entries and the
  // holds between it and the other writers belong to the screen that owns the history.
  const sets = useCriteriaSets({ selection, history });
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
  // A proposal answered otherwise opens the answers area's form, which lives beside it (PL-153).
  const answerForm = useRef<AnswerForm>(null);
  const answerDifferently = useCallback(
    (proposal: MatchRuleResult) => answerForm.current?.answerOtherwise(proposal),
    [],
  );
  // **A pass keeps its Stop, whatever the set's read does** (UIC-A4). Gate research is
  // level-wide and needs no criteria set, but its panel is drawn beside a loaded set's rules; a
  // read that failed, or one still loading, hid Stop, the progress and the spend while the pass
  // went on asking -- and paying. Drawn in stage 4 even then, so there is never a second Stop.
  const passPanel = levelId !== null && (pass.running || pass.dismissable) && (
    <ProposalsPanel
      key={`proposals-${levelId}`}
      levelId={levelId}
      onAnswered={noteAnswered}
      answersFreshness={answersVersion}
      pass={pass}
      standsAlone
      onAnswerDifferently={answerDifferently}
    />
  );

  return (
    <section className="screen screen--configure" aria-labelledby="screen-heading">
      <header className="screen__header">
        <h1 id="screen-heading" className="screen__heading">
          {route.label}
        </h1>
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
          <CriteriaSetsPanel form={sets} />
          <HouseholdPanel />

          {/* **Six cards, whatever each read is doing** (PL-013). Stages 3 and 4 show the set,
              so their cards are drawn here and stay the same elements while it is read: what
              is inside says why the set is not there yet, or shows it. */}
          <Stage {...PILLAR_WEIGHTS_STAGE}>
            {editor.criteriaSet === null ? (
              <SetNotRead
                read={editor.read}
                onRetry={editor.reload}
                lists={selection.read}
                onRetryLists={selection.reloadAndWait}
                idleNote="Choose a criteria set to see its criteria."
                prominence="screen"
              />
            ) : (
              // Keyed by the set, because the panel holds the set's pillar weights as state
              // it then edits: switching sets starts that state again from the new set.
              // **Criteria inside the weights, not beside them**: a criterion's weight is a
              // share of its pillar's, so opening a pillar reveals the attributes under it.
              <PillarWeightsPanel
                key={editor.criteriaSet.id}
                criteriaSet={editor.criteriaSet}
                criteriaCounts={countByPillar(editor.criteria)}
                unsourcedShares={
                  catalog.read.state === "ready"
                    ? unsourcedShareByPillar(editor.criteria, catalog.catalog)
                    : "unknown"
                }
                history={history}
                answers={pillarAnswers}
                catalog={catalog}
                criteriaFor={(pillar) => (
                  <CriteriaPanel
                    editor={editor}
                    pillar={pillar}
                    catalog={catalog.catalog}
                  />
                )}
              />
            )}
          </Stage>

          <Stage {...RULES_STAGE}>
            {editor.criteriaSet === null && (
              <>
                <SetNotRead
                  read={editor.read}
                  onRetry={editor.reload}
                  lists={selection.read}
                  onRetryLists={selection.reloadAndWait}
                  idleNote="Once a criteria set is chosen, the rules it lets act are listed here."
                  prominence="region"
                />
                {passPanel}
              </>
            )}
            {editor.criteriaSet !== null && levelId === null && (
              <p className="screen__note">The rules are read once the level is known.</p>
            )}
            {editor.criteriaSet !== null && levelId !== null && (
              <RulesPanel
                key={`${editor.criteriaSet.id}-${levelId}`}
                criteriaSet={editor.criteriaSet}
                levelId={levelId}
                answersFreshness={answersVersion}
              >
                {/* Beside the gates, because that is where a gate is enforced and released:
                    a proposal is an answer to one of the rules listed above it. */}
                <ProposalsPanel
                  key={`proposals-${levelId}`}
                  levelId={levelId}
                  onAnswered={noteAnswered}
                  answersFreshness={answersVersion}
                  pass={pass}
                  onAnswerDifferently={answerDifferently}
                />
              </RulesPanel>
            )}
            {/* **Outside the set's rules, keyed by level only** (D4): an answer belongs to no
                set, so a set switch keeps a half-typed one and a failed set read hides none. */}
            {levelId !== null && (
              <GateAnswersPanel
                key={`answers-${levelId}`}
                levelId={levelId}
                answersFreshness={answersVersion}
                onAnswered={noteAnswered}
                pass={pass}
                form={answerForm}
              />
            )}
          </Stage>

          {/* Null while the set is unread: its criteria are then [], which is not a set that
              requires nothing. */}
          <DataSourcesPanel
            catalog={catalog}
            required={editor.criteriaSet === null ? null : requiredAttributes(editor.criteria)}
          />
          <SettingsPanel />
        </div>

        {/* **It never scrolls away.** The only question worth asking while changing things
            is "what have I just done?", and an answer that has to be scrolled back to is an
            answer nobody reads. */}
        <aside className="configure__rail">
          <RecentChanges
            history={history}
            busy={sets.listPending}
            isDeleted={sets.isDeleted}
          />
        </aside>
      </div>
    </section>
  );
}

const PILLAR_WEIGHTS_STAGE = {
  id: "pillar-weights",
  title: "Pillar weights",
  lead:
    "What matters, and how much. Moving one weight rebalances the unlocked others in " +
    "proportion — locks hold, the total is always 100. Open a pillar to see the attributes " +
    "inside it.",
};

const RULES_STAGE = {
  id: "rules",
  title: "Match rules & gates",
  // What a gate and a warning are is the panel's note; said here too, it was said twice (PL-162).
  lead: "Which rules this set lets act, and what each one does when it fires.",
};

/** Stages 3 and 4 while the set they show is not on screen: none chosen, pending or failed. */
function SetNotRead({
  read,
  onRetry,
  lists,
  onRetryLists,
  idleNote,
  prominence,
}: {
  read: Read<CriteriaSet> | Idle;
  onRetry: () => Promise<void>;
  /** The lists a set is chosen from: until they are read, "choose a set" is not yet true. */
  lists: Read<unknown>;
  onRetryLists: () => Promise<void>;
  idleNote: string;
  /** The full card once, in stage 3; stage 4 says the same in a line (N4). */
  prominence: "screen" | "region";
}) {
  if (read.state === "idle" && lists.state !== "ready") {
    return (
      <LoadedRegion
        read={lists}
        what="The criteria sets"
        skeleton="configure-stage"
        onRetry={onRetryLists}
        prominence={prominence}
      >
        {() => null}
      </LoadedRegion>
    );
  }
  if (read.state === "idle") return <p className="screen__note">{idleNote}</p>;
  return (
    <LoadedRegion
      read={read}
      what="The criteria set"
      skeleton="configure-stage"
      onRetry={onRetry}
      prominence={prominence}
    >
      {() => null}
    </LoadedRegion>
  );
}
