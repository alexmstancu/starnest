/**
 * The calls the shell makes, named after what they fetch.
 *
 * Every screen goes through here rather than calling `getJson` with a path literal, so the set
 * of endpoints the interface actually depends on is one file long -- which is what makes a
 * contract change visible instead of scattered.
 */

import {
  deleteResource,
  getJson,
  patchJson,
  postJson,
  putJson,
  type PatchResult,
  type RequestOptions,
} from "./client";
import type { components } from "./schema";

export type Level = components["schemas"]["Level"];
export type Attribute = components["schemas"]["Attribute"];
export type Candidate = components["schemas"]["Candidate"];
export type CriteriaSetSummary = components["schemas"]["CriteriaSetSummary"];
export type Run = components["schemas"]["Run"];
export type Ranking = components["schemas"]["Ranking"];
export type CandidateResult = components["schemas"]["CandidateResult"];
export type Settings = components["schemas"]["Settings"];
export type CriteriaSet = components["schemas"]["CriteriaSet"];
export type Criterion = components["schemas"]["Criterion"];
export type EvaluationSummary = components["schemas"]["EvaluationSummary"];
export type EvaluationCriterion =
  components["schemas"]["EvaluationCriterion"];
export type CandidateScoreDetail =
  components["schemas"]["CandidateScoreDetail"];

/**
 * What a weight change answers with: the affected pillar and every criterion in it, already
 * rebalanced (`arch.md` 8.3). The client sends one number and is told what the others became.
 */
export type RebalancedPillar =
  PatchResult<"/criteria-sets/{criteriaSetId}/criteria/{attributeId}">;

export function fetchLevels(
  options?: RequestOptions,
): Promise<{ items: Level[] }> {
  return getJson("/levels", undefined, options);
}

export function fetchCriteriaSets(
  options?: RequestOptions,
): Promise<{ items: CriteriaSetSummary[] }> {
  return getJson("/criteria-sets", undefined, options);
}

export function fetchCandidates(
  level: string,
  options?: RequestOptions,
): Promise<{ items: Candidate[] }> {
  return getJson("/candidates", { level }, options);
}

export function fetchRanking(
  criteriaSet: string,
  level: string,
  options?: RequestOptions,
): Promise<Ranking> {
  return getJson("/rankings", { criteria_set: criteriaSet, level }, options);
}

export function fetchRuns(
  limit: number,
  options?: RequestOptions,
): Promise<{ items: Run[]; total: number }> {
  return getJson("/data-acquisition-runs", { limit }, options);
}

export function fetchCriteriaSet(
  criteriaSetId: string,
  options?: RequestOptions,
): Promise<CriteriaSet> {
  return getJson("/criteria-sets/{criteriaSetId}", undefined, {
    ...options,
    pathParams: { criteriaSetId },
  });
}

/**
 * Changes one criterion's weight.
 *
 * **The rebalance is not computed here and must not be.** Which siblings absorb the change
 * depends on which weights are locked, and a pillar that does not sum to 100 is a broken
 * score -- so the server owns the arithmetic and this returns whatever it decided.
 */
/**
 * One criterion's weight within its pillar, and whether it is locked against rebalancing.
 *
 * The two travel together because the server treats them together: it rebalances the
 * *unlocked* siblings to 100, so which of them absorb a change depends on what is locked at
 * the moment it is made. Sending the lock separately would mean two requests whose order
 * decides the answer.
 *
 * Refused with `409 weights_all_locked` when everything else in the pillar is locked, because
 * then there is nothing to rebalance into.
 */
export function updateCriterionWeight(
  criteriaSetId: string,
  attributeId: string,
  weight: number,
  options?: RequestOptions,
): Promise<RebalancedPillar> {
  return patchJson(
    "/criteria-sets/{criteriaSetId}/criteria/{attributeId}",
    { weight },
    { ...options, pathParams: { criteriaSetId, attributeId } },
  );
}

/**
 * Lock or unlock one criterion's weight.
 *
 * **The lock travels alone, without a weight.** A lock holds its weight where it is, and the
 * server enforces that against the weight's *own current value* too: sending
 * `{ weight, weight_locked: false }` for a locked criterion is refused with
 * `409 weights_all_locked`, because the request asks to move a weight that is locked at the
 * moment it arrives. So unlocking is its own change, and moving the weight comes after.
 *
 * Found by driving the real backend. A mock that accepted both together certified a protocol
 * the server rejects.
 */
export function updateCriterionLock(
  criteriaSetId: string,
  attributeId: string,
  weightLocked: boolean,
  options?: RequestOptions,
): Promise<RebalancedPillar> {
  return patchJson(
    "/criteria-sets/{criteriaSetId}/criteria/{attributeId}",
    { weight_locked: weightLocked },
    { ...options, pathParams: { criteriaSetId, attributeId } },
  );
}

/** The scoring half of a criterion: how it judges, never how much it weighs. */
export type CriterionRule = Omit<
  components["schemas"]["CriterionInput"],
  "weight" | "is_scored" | "weight_locked"
>;

/**
 * Change how one criterion judges its attribute -- goal, method, band, anchors, threshold.
 *
 * **Separate from the weight** because the two mean different things to the server: a weight
 * rebalances its pillar, and none of these fields moves a number that has to sum to anything.
 * The response is the pillar either way, so the screen re-renders from what came back rather
 * than from what it sent.
 */
export function updateCriterionRule(
  criteriaSetId: string,
  attributeId: string,
  rule: CriterionRule,
  options?: RequestOptions,
): Promise<RebalancedPillar> {
  return patchJson(
    "/criteria-sets/{criteriaSetId}/criteria/{attributeId}",
    rule,
    { ...options, pathParams: { criteriaSetId, attributeId } },
  );
}

export function fetchSettings(options?: RequestOptions): Promise<Settings> {
  return getJson("/settings", undefined, options);
}

export type Comparison = components["schemas"]["Comparison"];
export type ComparisonAttributeRow =
  components["schemas"]["ComparisonAttributeRow"];
export type RunPlan = components["schemas"]["RunPlan"];
export type RunDetail = components["schemas"]["RunDetail"];
export type RunScope = components["schemas"]["RunScope"];

/**
 * A focus candidate against comparators (`reqs.md` 8.5).
 *
 * **The comparator limit is not enforced here.** It is a setting the server reads, and a copy
 * of it in the interface would be a second bound that could disagree with the first; the screen
 * shows the limit and the server refuses anything past it.
 */
export function fetchComparison(
  criteriaSet: string,
  level: string,
  focus: string,
  comparators: readonly string[],
  options?: RequestOptions,
): Promise<Comparison> {
  return getJson(
    "/comparisons",
    { criteria_set: criteriaSet, level, focus, comparators: [...comparators] },
    options,
  );
}

/** What a run would do, before it does any of it (`reqs.md` 6.3). */
export function planRun(
  scope: RunScope,
  options?: RequestOptions,
): Promise<RunPlan> {
  return postJson("/data-acquisition-runs/plan", scope, options);
}

/**
 * Start a run.
 *
 * `accept_uncapped_spend` is the bypass of `reqs.md` 6.3: a run that can cost money is refused
 * while no spend cap is set, and this accepts one uncapped run. **Per request, never
 * remembered** -- it is a sentence about this run, and storing it would turn a deliberate act
 * into a default. Sent as `false` unless the caller says otherwise, so the refusal is what
 * happens by default.
 */
export function startRun(
  scope: RunScope & { accept_uncapped_spend?: boolean },
  options?: RequestOptions,
): Promise<Run> {
  return postJson(
    "/data-acquisition-runs",
    { accept_uncapped_spend: false, ...scope },
    options,
  );
}

export function fetchRun(
  runId: number,
  options?: RequestOptions,
): Promise<RunDetail> {
  return getJson("/data-acquisition-runs/{runId}", undefined, {
    ...options,
    pathParams: { runId },
  });
}

/**
 * A new run over part of an earlier one (`reqs.md` 6.4, Q217). The old run keeps its record.
 *
 * `failed` asks the sources that failed about what they failed on. `unanswered` asks again
 * about the items that produced neither a figure nor a failure -- where there is no source to
 * narrow to, because none failed.
 */
export function retryRun(
  runId: number,
  items: "failed" | "unanswered" = "failed",
  options?: RequestOptions,
): Promise<Run> {
  return postJson(
    "/data-acquisition-runs/{runId}/retry",
    { items },
    { ...options, pathParams: { runId } },
  );
}

export type StoredValue = components["schemas"]["Value"];
export type ExternalScore = components["schemas"]["ExternalScore"];

/**
 * Every stored value for one candidate, superseded ones included (`reqs.md` 3.6).
 *
 * **Not only the active one.** The drill-down's job is to show that nothing was discarded: the
 * figure being scored, the ones it beat, and any that were rejected, each with its source and
 * both its dates.
 */
export function fetchValues(
  candidate: string,
  options?: RequestOptions,
): Promise<{ items: StoredValue[]; total: number }> {
  return getJson(
    "/values",
    { candidate, include_superseded: true, limit: 500 },
    options,
  );
}

/**
 * Every candidate's figure for one attribute (`reqs.md` 8.4).
 *
 * **The other axis from `fetchValues`.** That one asks "what do we know about this country?";
 * this asks "who has a figure for this at all, and where did each one come from?" -- which is
 * the question behind a pillar that scores badly for want of data rather than for want of
 * merit. The backend has always taken the filter; nothing asked for it.
 */
/**
 * Every value one acquisition produced.
 *
 * **Two requests, not nine.** Without the run filter, comparing two acquisitions means paging
 * the whole corpus and grouping client-side -- 8,488 values at 1,000 a page. A value keeps the
 * run that produced it for the life of the row, so this answers the same way however much has
 * happened since.
 */
export function fetchValuesFromRun(
  run: number,
  options?: RequestOptions,
): Promise<{ items: StoredValue[]; total: number }> {
  return getJson(
    "/values",
    { data_acquisition_run: run, include_superseded: true, limit: 1000 },
    options,
  );
}

export function fetchValuesForAttribute(
  attribute: string,
  options?: RequestOptions,
): Promise<{ items: StoredValue[]; total: number }> {
  return getJson(
    "/values",
    { attribute, include_superseded: false, limit: 500 },
    options,
  );
}

/** The catalog's attributes at one level, each with the pillar it belongs to. */
export function fetchAttributes(
  level: string,
  options?: RequestOptions,
): Promise<{ items: Attribute[] }> {
  return getJson("/attributes", { level }, options);
}

/** Published composites, shown beside our score and never fed into it (`reqs.md` 3.5a). */
export function fetchExternalScores(
  candidate: string,
  options?: RequestOptions,
): Promise<{ items: ExternalScore[] }> {
  return getJson("/external-scores", { candidate }, options);
}

export type Household = components["schemas"]["HouseholdInput"];
export type DataSource = components["schemas"]["DataSource"];

export function fetchHousehold(options?: RequestOptions): Promise<Household> {
  return getJson("/household", undefined, options);
}

/** Replaced whole: a change must reach criterion defaults and rules at once (`reqs.md` 3.9). */
export function replaceHousehold(
  household: Household,
  options?: RequestOptions,
): Promise<Household> {
  return putJson("/household", household, options);
}

export function replaceSettings(
  settings: Settings,
  options?: RequestOptions,
): Promise<Settings> {
  return putJson("/settings", settings, options);
}

/**
 * Moves one pillar's weight, and is told what every pillar at that level became.
 *
 * The rebalance is the server's, as it is for a criterion: which siblings absorb the change
 * depends on which are locked, and a second answer computed here would drift from the first.
 */
export function updatePillarWeight(
  criteriaSetId: string,
  pillarId: string,
  weight: number,
  weightLocked?: boolean,
  options?: RequestOptions,
): Promise<{ items: components["schemas"]["PillarWeight"][] }> {
  return putJson(
    "/criteria-sets/{criteriaSetId}/pillar-weights/{pillarId}",
    weightLocked === undefined
      ? { weight }
      : { weight, weight_locked: weightLocked },
    { ...options, pathParams: { criteriaSetId, pillarId } },
  );
}

export function createCriteriaSet(
  id: string,
  name: string,
  options?: RequestOptions,
): Promise<CriteriaSet> {
  return postJson("/criteria-sets", { id, name }, options);
}

/**
 * A full, independent copy of a set, under a new id.
 *
 * **The contract calls this the safe way to experiment** (`reqs.md` Q168): editing a weight
 * changes the set in place, so trying an idea out means either losing what was there or
 * copying it first. A set is a full copy and never a sparse overlay (Q191), so what comes
 * back is a complete opinion about the same attributes rather than a reference to the
 * original.
 */
export function duplicateCriteriaSet(
  criteriaSetId: string,
  id: string,
  name: string,
  options?: RequestOptions,
): Promise<CriteriaSet> {
  return postJson(
    "/criteria-sets/{criteriaSetId}/duplicate",
    { id, name },
    { ...options, pathParams: { criteriaSetId } },
  );
}

export function renameCriteriaSet(
  criteriaSetId: string,
  name: string,
  options?: RequestOptions,
): Promise<CriteriaSet> {
  return patchJson(
    "/criteria-sets/{criteriaSetId}",
    { name },
    { ...options, pathParams: { criteriaSetId } },
  );
}

export function deleteCriteriaSet(
  criteriaSetId: string,
  options?: RequestOptions,
): Promise<void> {
  return deleteResource("/criteria-sets/{criteriaSetId}", {
    ...options,
    pathParams: { criteriaSetId },
  });
}

export function fetchDataSources(
  options?: RequestOptions,
): Promise<{ items: DataSource[] }> {
  return getJson("/data-sources", undefined, options);
}

export type MatchRule = components["schemas"]["MatchRule"];
export type MatchRuleResult = components["schemas"]["MatchRuleResult"];
export type MatchRuleResultInput =
  components["schemas"]["MatchRuleResultInput"];
export type ResearchPlan = components["schemas"]["ResearchPlan"];
export interface ResearchScope {
  level: string;
  match_rules?: string[] | null;
}

/**
 * Every gate answer recorded, proposals included (`reqs.md` 3.7).
 *
 * A proposal carries `is_proposal: true` -- a model answered and nobody has confirmed it, so it
 * rules nothing out (`reqs.md` 6.10 use 3). The screen needs both kinds in one list: a reader
 * deciding whether to trust one wants to see what has already been settled beside it.
 */
/**
 * Switch a source on or off, and set where it stands in the global order.
 *
 * **Switching one off stops its figures being scored and keeps every one of them**
 * (`reqs.md` 3.6, Q232): the values stay stored, stay visible in the drill-down with their
 * provenance, and return to the ranking when it is switched back on. **Scores move when this
 * changes**, because the active-value rule is evaluated on every read -- so a ranking on
 * screen is refetched rather than adjusted here.
 *
 * Both fields are optional and independent: switching one off does not restate its priority.
 */
export function updateDataSource(
  dataSourceId: string,
  change: { is_enabled?: boolean; default_priority?: number },
  options?: RequestOptions,
): Promise<DataSource> {
  return patchJson("/data-sources/{dataSourceId}", change, {
    ...options,
    pathParams: { dataSourceId },
  });
}

export function fetchMatchRuleResults(
  options?: RequestOptions,
): Promise<{ items: MatchRuleResult[] }> {
  return getJson("/match-rule-results", undefined, options);
}

/** What researching the gates would ask and cost, without asking (`reqs.md` 6.3). */
export function planMatchRuleResearch(
  scope: ResearchScope,
  options?: RequestOptions,
): Promise<ResearchPlan> {
  return postJson("/match-rule-research/plan", scope, options);
}

/**
 * Ask a model to read the official pages about every unconfirmed gate. **This spends money.**
 *
 * `accept_uncapped_spend` is the same bypass a run takes: refused while no cap is set, accepted
 * per request and never remembered.
 */
export function researchMatchRules(
  scope: ResearchScope & { accept_uncapped_spend?: boolean },
  options?: RequestOptions,
): Promise<{
  proposals: MatchRuleResult[];
  refusals?: string[];
  cost_eur: number;
  calls: number;
  halted_on_spend_cap: boolean;
}> {
  return postJson(
    "/match-rule-research",
    { accept_uncapped_spend: false, ...scope },
    options,
  );
}

/**
 * Record a gate's answer by hand -- and how a proposal is confirmed.
 *
 * **Confirming means writing the same answer as `manual`, which replaces the proposal**
 * (`reqs.md` 6.10 use 3). One row, not two: a proposal and a finding can never disagree about
 * the same gate, and it is the replacement that makes the gate start ruling candidates out.
 */
export function putMatchRuleResult(
  matchRuleId: string,
  candidateId: string,
  answer: MatchRuleResultInput,
  options?: RequestOptions,
): Promise<MatchRuleResult> {
  return putJson("/match-rule-results/{matchRuleId}/{candidateId}", answer, {
    ...options,
    pathParams: { matchRuleId, candidateId },
  });
}
export type CompoundRule = components["schemas"]["CompoundRule"];

/** The gates that exist at a level. Which of them a set enforces is the set's own business. */
export function fetchMatchRules(
  level: string,
  options?: RequestOptions,
): Promise<{ items: MatchRule[] }> {
  return getJson("/match-rules", { level }, options);
}

export function fetchCompoundRules(
  level: string,
  options?: RequestOptions,
): Promise<{ items: CompoundRule[] }> {
  return getJson("/compound-rules", { level }, options);
}

/**
 * Whether this set lets a gate rule a candidate out (`reqs.md` 3.7).
 *
 * A gate belongs to the catalog; **enforcing it is a judgement, so it belongs to the set** --
 * which is why this is addressed under the criteria set and not under the rule.
 */
export function setMatchRuleEnforcement(
  criteriaSetId: string,
  matchRuleId: string,
  isEnforced: boolean,
  options?: RequestOptions,
): Promise<void> {
  return putJson(
    "/criteria-sets/{criteriaSetId}/match-rules/{matchRuleId}",
    { is_enforced: isEnforced },
    { ...options, pathParams: { criteriaSetId, matchRuleId } },
  );
}

export function setCompoundRuleApplication(
  criteriaSetId: string,
  compoundRuleId: string,
  isApplied: boolean,
  options?: RequestOptions,
): Promise<void> {
  return putJson(
    "/criteria-sets/{criteriaSetId}/compound-rules/{compoundRuleId}",
    { is_applied: isApplied },
    { ...options, pathParams: { criteriaSetId, compoundRuleId } },
  );
}

/**
 * A ranking kept on purpose, and the four ways to read one back.
 *
 * **`/rankings` computes and stores nothing.** That is what makes re-weighting instant -- the
 * ranking is arithmetic over stored values, recomputed on every request -- and it is also why
 * saving has to be a separate act rather than a side effect of looking. Nothing is kept until
 * somebody says so.
 *
 * An evaluation freezes the criteria it used *and* the score scale it used (`arch.md`
 * `0107`), so a saved ranking keeps meaning what it meant. Read it back rather than
 * recomputing it: the criteria set it names may have moved since.
 */
export function saveEvaluation(
  criteriaSet: string,
  level: string,
  note: string,
  options?: RequestOptions,
): Promise<EvaluationSummary> {
  // An empty note is no note. The contract makes it optional, and storing "" would be a note
  // that says nothing while looking like one that does.
  const trimmed = note.trim();
  return postJson(
    "/evaluations",
    {
      criteria_set: criteriaSet,
      level,
      ...(trimmed === "" ? {} : { note: trimmed }),
    },
    options,
  );
}

export function fetchEvaluations(
  options?: RequestOptions,
): Promise<{ items: EvaluationSummary[] }> {
  return getJson("/evaluations", undefined, options);
}

/**
 * One saved ranking, in the same shape `GET /rankings` answers with.
 *
 * Which is why the saved view needs no table of its own: a frozen ranking and a live one are
 * the same thing seen at different moments, and rendering them through one component is what
 * keeps them saying the same thing.
 */
export function fetchEvaluation(
  evaluationId: number,
  options?: RequestOptions,
): Promise<Ranking> {
  return getJson("/evaluations/{evaluationId}", undefined, {
    ...options,
    pathParams: { evaluationId },
  });
}

/** The criteria as they were when this was saved -- a full copy, never a reference. */
export function fetchEvaluationCriteria(
  evaluationId: number,
  options?: RequestOptions,
): Promise<{ criteria: EvaluationCriterion[] }> {
  return getJson("/evaluations/{evaluationId}/criteria", undefined, {
    ...options,
    pathParams: { evaluationId },
  });
}

export function fetchCandidateScoreDetail(
  evaluationId: number,
  candidateId: string,
  options?: RequestOptions,
): Promise<CandidateScoreDetail> {
  return getJson(
    "/evaluations/{evaluationId}/candidates/{candidateId}",
    undefined,
    { ...options, pathParams: { evaluationId, candidateId } },
  );
}
