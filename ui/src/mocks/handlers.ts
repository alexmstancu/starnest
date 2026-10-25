/**
 * A mock of the contract, so the interface runs standalone before the backend answers.
 *
 * It covers the paths the shell actually calls, and answers every other `/v1` path with the
 * documented error shape rather than a 404 page. That matters: a screen added in P6 that calls
 * an unmocked endpoint gets a real `ApiError` with a code, which is visibly "not mocked yet"
 * rather than a mystery.
 *
 * The mock is never loaded in a production build -- `main.tsx` imports it dynamically, behind
 * an opt-in flag.
 */

import { http, HttpResponse } from "msw";
import type { components } from "../api/schema";
import {
  ATTRIBUTES,
  PILLARS,
  attributeScoresOf,
  COMPOUND_RULES,
  CRITERIA_SETS,
  DATA_SOURCES,
  EXTERNAL_SCORES,
  HOLDINGS_GAPS,
  HOLDINGS_OLDER_THAN_REFETCH_AGE,
  HOLDINGS_PAIRS_TOTAL,
  HOLDINGS_PAST_ALLOWED_AGE,
  HOUSEHOLD,
  LEVELS,
  MATCH_RULES,
  MATCH_RULE_RESULTS,
  RESEARCHED_PROPOSALS,
  RESEARCH_CALL_COST_EUR,
  RESEARCH_PLAN,
  RUNS,
  RUN_DETAILS,
  RUN_ITEMS,
  RUN_REUSES,
  RUN_PLAN,
  SETTINGS,
  STARTED_RUN,
  STARTED_RUN_DETAIL,
  STORED_VALUES,
  candidatesForLevel,
  comparisonFor,
  makeCriteriaSetDetails,
  rankingFor,
  savedAttributeScoresOf,
} from "./fixtures";

type Criterion = components["schemas"]["Criterion"];
type MatchRuleResult = components["schemas"]["MatchRuleResult"];
type CriteriaSet = components["schemas"]["CriteriaSet"];
type CriteriaSetSummary = components["schemas"]["CriteriaSetSummary"];
type PillarWeight = components["schemas"]["PillarWeight"];
type Settings = components["schemas"]["Settings"];
type RunDetail = components["schemas"]["RunDetail"];
type Household = components["schemas"]["HouseholdInput"];
type EvaluationSummary = components["schemas"]["EvaluationSummary"];
type CandidateResult = components["schemas"]["CandidateResult"];
type DataSource = components["schemas"]["DataSource"];
type RuleOutcome = components["schemas"]["RuleOutcome"];

const BASE = "/v1";

/**
 * The one piece of the mock that is mutable, because a weight change that did not stick would
 * not exercise the screen it exists for.
 *
 * `resetMockData` puts it back between tests -- msw's `resetHandlers()` restores handlers, not
 * anything they wrote.
 */
let criteriaSetDetails = makeCriteriaSetDetails();
let criteriaSetSummaries: CriteriaSetSummary[] = [...CRITERIA_SETS];
let settings: Settings = { ...SETTINGS };
let household: Household = { ...HOUSEHOLD };
// Copied element by element, as `dataSources` is: a spread clones the array and leaves every
// element shared with the constant, so one in-place assignment would write into the fixture
// and leak into every test that ran afterwards.
let matchRuleResults: MatchRuleResult[] = MATCH_RULE_RESULTS.map((each) => ({ ...each }));
// Nothing is saved until somebody saves it, so the list starts empty -- which is also the
// state a reader meets on a fresh install, and the one the empty message is written for.
// A copy, because the switch writes to it: serving the shared constant would let one test's
// switched-off source leak into every test after it.
let dataSources: DataSource[] = DATA_SOURCES.map((each) => ({ ...each }));
/** A kept ranking: its summary and the results frozen with it, as the server stores both. */
interface SavedEvaluation {
  summary: EvaluationSummary;
  candidates: CandidateResult[];
}
let savedEvaluations: SavedEvaluation[] = [];
let nextEvaluationId = 1;
/**
 * Every research call billed, as the server's ledger keeps it (`match_rule_research_spend`): one
 * row per call, dated when it was made. Never served row by row -- only `/holdings` sums it.
 */
let researchSpend: { researched_at: string; cost_eur: number }[] = [];
/** When a stopped run records that somebody asked. Fixed, so a test can assert on it. */
const STOPPED_AT = "2026-09-12T09:00:06Z";

export function resetMockData(): void {
  criteriaSetDetails = makeCriteriaSetDetails();
  criteriaSetSummaries = [...CRITERIA_SETS];
  settings = { ...SETTINGS };
  household = { ...HOUSEHOLD };
  matchRuleResults = MATCH_RULE_RESULTS.map((each) => ({ ...each }));
  dataSources = DATA_SOURCES.map((each) => ({ ...each }));
  savedEvaluations = [];
  nextEvaluationId = 1;
  researchSpend = [];
}

export const handlers = [
  http.get(`${BASE}/levels`, () => HttpResponse.json({ items: LEVELS })),

  http.patch(`${BASE}/data-sources/:dataSourceId`, async ({ params, request }) => {
    const source = dataSources.find(
      (each) => each.id === String(params["dataSourceId"]),
    );
    if (!source) {
      return HttpResponse.json(
        {
          code: "unknown_data_source",
          message: `no data source called ${String(params["dataSourceId"])}`,
        },
        { status: 422 },
      );
    }
    const body = (await request.json()) as {
      is_enabled?: boolean;
      default_priority?: number;
    };
    // Coalesced, like the query: either may be left out to keep what is there.
    if (body.is_enabled !== undefined) source.is_enabled = body.is_enabled;
    if (body.default_priority !== undefined) {
      source.default_priority = body.default_priority;
    }
    return HttpResponse.json(source);
  }),

  // As `reorder_keeping_tiers` does (D36): refused whole unless every source is named once;
  // otherwise the stored numbers are handed back out in the new order, never renumbered.
  http.put(`${BASE}/data-sources/order`, async ({ request }) => {
    const { order } = (await request.json()) as { order?: unknown };
    const malformed = orderProblems(order);
    if (malformed.length > 0) {
      return HttpResponse.json(invalidRequest(...malformed), { status: 422 });
    }
    const names = order as string[];
    const known = dataSources.map((source) => source.id);
    const details = {
      missing: [...known].sort().filter((id) => !names.includes(id)),
      repeated: [...new Set(names.filter((id, at) => names.indexOf(id) !== at))].sort(),
      unknown: [...new Set(names)].filter((id) => !known.includes(id)),
    };
    if (details.missing.length + details.repeated.length + details.unknown.length > 0) {
      return HttpResponse.json(
        {
          code: "invalid_source_order",
          message: "a source order names every source exactly once",
          details,
        },
        { status: 422 },
      );
    }
    const slots = dataSources.map((source) => source.default_priority).sort((a, b) => a - b);
    let previous: { priority: number; id: string } | null = null;
    for (const [at, id] of names.entries()) {
      let priority = slots[at] ?? 0;
      // A tie reads back by id, so one the new order puts against the id order is broken by
      // giving the later source one more than the earlier.
      if (previous !== null && priority <= previous.priority) {
        priority = id > previous.id ? previous.priority : previous.priority + 1;
      }
      const source = dataSources.find((each) => each.id === id);
      if (source) source.default_priority = priority;
      previous = { priority, id };
    }
    return HttpResponse.json({ items: inStoredOrder(dataSources) });
  }),

  http.get(`${BASE}/criteria-sets`, () =>
    HttpResponse.json({ items: criteriaSetSummaries }),
  ),

  // A duplicate is a **full copy**, never a sparse overlay (`reqs.md` Q191), which is the
  // whole reason it is a distinct operation from creating an empty set.
  http.post(
    `${BASE}/criteria-sets/:criteriaSetId/duplicate`,
    async ({ params, request }) => {
      const source = criteriaSetDetails[String(params["criteriaSetId"])];
      if (!source) return notFound(String(params["criteriaSetId"]));

      const body = (await request.json()) as { id: string; name: string };
      if (criteriaSetDetails[body.id]) {
        return HttpResponse.json(
          {
            code: "criteria_set_exists",
            message: `A criteria set called ${body.id} already exists.`,
          },
          { status: 409 },
        );
      }

      const copy: CriteriaSet = {
        ...structuredClone(source),
        id: body.id,
        name: body.name,
      };
      criteriaSetDetails[body.id] = copy;
      criteriaSetSummaries = [
        ...criteriaSetSummaries,
        { id: body.id, name: body.name },
      ];
      return HttpResponse.json(copy, { status: 201 });
    },
  ),

  http.post(`${BASE}/criteria-sets`, async ({ request }) => {
    const body = (await request.json()) as { id: string; name: string };
    if (criteriaSetDetails[body.id]) {
      return HttpResponse.json(
        {
          code: "criteria_set_exists",
          message: `A criteria set called ${body.id} already exists.`,
        },
        { status: 409 },
      );
    }
    // Empty, as the contract says: copying another set's priorities would be deciding for the
    // user. `POST /criteria-sets/{id}/duplicate` is how somebody asks for a copy.
    const created: CriteriaSet = {
      id: body.id,
      name: body.name,
      pillar_weights: [],
      criteria: [],
      enforced_match_rules: [],
      applied_compound_rules: [],
      match_rule_outcomes: {},
      compound_rule_outcomes: {},
    };
    criteriaSetDetails[body.id] = created;
    criteriaSetSummaries = [
      ...criteriaSetSummaries,
      { id: body.id, name: body.name },
    ];
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch(
    `${BASE}/criteria-sets/:criteriaSetId`,
    async ({ params, request }) => {
      const id = String(params["criteriaSetId"]);
      const set = criteriaSetDetails[id];
      if (!set) return notFound(id);
      const body = (await request.json()) as { name?: string };
      if (body.name !== undefined) {
        set.name = body.name;
        criteriaSetSummaries = criteriaSetSummaries.map((summary) =>
          summary.id === id ? { ...summary, name: body.name! } : summary,
        );
      }
      return HttpResponse.json(set);
    },
  ),

  http.delete(`${BASE}/criteria-sets/:criteriaSetId`, ({ params }) => {
    const id = String(params["criteriaSetId"]);
    if (!criteriaSetDetails[id]) return notFound(id);
    delete criteriaSetDetails[id];
    criteriaSetSummaries = criteriaSetSummaries.filter(
      (summary) => summary.id !== id,
    );
    return new HttpResponse(null, { status: 204 });
  }),

  http.put(
    `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
    async ({ params, request }) => {
      const set = criteriaSetDetails[String(params["criteriaSetId"])];
      if (!set) return notFound(String(params["criteriaSetId"]));

      const pillarId = String(params["pillarId"]);
      const weights = set.pillar_weights ?? [];
      const edited = weights.find((weight) => weight.pillar === pillarId);
      if (!edited) return notFound(pillarId);

      const body = (await request.json()) as {
        weight?: number;
        weight_locked?: boolean;
      };

      // **A locked weight cannot be moved, not even to the value it already holds** (P68).
      // `rebalancing.py` refuses it, and this accepted it -- so the mock certified a protocol
      // the server rejects, which is how the disc came to send a lock and a weight together
      // and lock a pillar that could then never be released. `rebalancePillarWeights` only
      // ever checked whether the *others* were locked.
      if (body.weight !== undefined && edited.weight_locked) {
        return HttpResponse.json(
          {
            code: "weights_all_locked",
            message: `${pillarId} is itself locked. A lock holds that weight where it is, so unlock it before moving it.`,
          },
          { status: 409 },
        );
      }

      if (body.weight_locked !== undefined)
        edited.weight_locked = body.weight_locked;
      // A lock-only request moves nothing; the weights come back as they are.
      if (body.weight === undefined) {
        return HttpResponse.json({ items: weights });
      }
      return rebalancePillarWeights(weights, edited, body.weight);
    },
  ),

  http.put(
    `${BASE}/criteria-sets/:criteriaSetId/match-rules/:matchRuleId`,
    async ({ params, request }) => {
      const set = criteriaSetDetails[String(params["criteriaSetId"])];
      if (!set) return notFound(String(params["criteriaSetId"]));
      const body = (await request.json()) as {
        is_enforced: boolean;
        outcome?: RuleOutcome;
      };
      const gate = String(params["matchRuleId"]);
      if (!body.is_enforced && body.outcome !== undefined) return outcomeForARuleOff(gate);
      set.enforced_match_rules = withMembership(
        set.enforced_match_rules ?? [],
        gate,
        body.is_enforced,
      );
      // As the server holds them (D56): one outcome per gate that is on, a gate newly enforced
      // is a gate, and a gate released drops its outcome.
      set.match_rule_outcomes = withOutcome(
        set.match_rule_outcomes ?? {},
        gate,
        body.is_enforced ? (body.outcome ?? set.match_rule_outcomes?.[gate] ?? "not_matching") : null,
      );
      return new HttpResponse(null, { status: 204 });
    },
  ),

  http.put(
    `${BASE}/criteria-sets/:criteriaSetId/compound-rules/:compoundRuleId`,
    async ({ params, request }) => {
      const set = criteriaSetDetails[String(params["criteriaSetId"])];
      if (!set) return notFound(String(params["criteriaSetId"]));
      const body = (await request.json()) as {
        is_applied: boolean;
        outcome?: RuleOutcome;
      };
      const ruleId = String(params["compoundRuleId"]);
      if (!body.is_applied && body.outcome !== undefined) return outcomeForARuleOff(ruleId);
      set.applied_compound_rules = withMembership(
        set.applied_compound_rules ?? [],
        ruleId,
        body.is_applied,
      );
      // A rule newly applied takes the catalog's outcome.
      const catalog = COMPOUND_RULES.find((rule) => rule.id === ruleId)?.outcome ?? "warning";
      set.compound_rule_outcomes = withOutcome(
        set.compound_rule_outcomes ?? {},
        ruleId,
        body.is_applied ? (body.outcome ?? set.compound_rule_outcomes?.[ruleId] ?? catalog) : null,
      );
      return new HttpResponse(null, { status: 204 });
    },
  ),

  http.get(`${BASE}/match-rules`, ({ request }) => {
    const level = new URL(request.url).searchParams.get("level");
    // A rule with no level is asked at every level, so it stays in every answer.
    const items = MATCH_RULES.filter(
      (rule) => rule.level === null || rule.level === level,
    );
    return HttpResponse.json({ items });
  }),

  http.get(`${BASE}/match-rule-results`, () =>
    HttpResponse.json({ items: matchRuleResults }),
  ),

  http.post(`${BASE}/match-rule-research/plan`, () =>
    HttpResponse.json(RESEARCH_PLAN),
  ),

  /**
   * One research request, answered as the server answers it since UI-01: it asks only a gate
   * research can answer, about the one candidate that gate concerns, and never one a person has
   * already answered -- one call each, at a few cents. A request for any other gate asks
   * nothing and costs nothing, which is what lets the page ask about every gate.
   *
   * **No model is involved and none should be**: what a mock can be right about is the
   * application's own rules -- a proposal is stored, it is marked unconfirmed, and it rules
   * nothing out -- and those hold whoever answered.
   */
  http.post(`${BASE}/match-rule-research`, async ({ request }) => {
    const scope = (await request.json()) as {
      level: string;
      match_rules?: string[] | null;
    };
    const named =
      scope.match_rules ??
      MATCH_RULES.filter(
        (rule) => rule.level === null || rule.level === scope.level,
      ).map((rule) => rule.id);
    const asked = RESEARCHED_PROPOSALS.filter(
      (finding) =>
        named.includes(finding.match_rule) &&
        !matchRuleResults.some(
          (stored) => isSameAnswer(stored, finding) && stored.is_proposal !== true,
        ),
    );
    // A proposal replaces an earlier one for the same gate and candidate, as the store's does.
    matchRuleResults = [
      ...matchRuleResults.filter(
        (stored) => !asked.some((finding) => isSameAnswer(stored, finding)),
      ),
      ...asked.map((finding) => ({ ...finding })),
    ];
    const researchedAt = new Date().toISOString();
    researchSpend = [
      ...researchSpend,
      ...asked.map(() => ({ researched_at: researchedAt, cost_eur: RESEARCH_CALL_COST_EUR })),
    ];
    return HttpResponse.json({
      proposals: asked,
      refusals: [],
      cost_eur: asked.length * RESEARCH_CALL_COST_EUR,
      calls: asked.length,
      halted_on_spend_cap: false,
    });
  }),

  /**
   * Confirming a proposal **replaces** it rather than sitting beside it (`reqs.md` 6.10 use 3):
   * one row, so a proposal and a finding can never disagree about the same gate.
   */
  http.put(
    `${BASE}/match-rule-results/:matchRuleId/:candidateId`,
    async ({ params, request }) => {
      const body = (await request.json()) as Partial<MatchRuleResult>;
      // **Only the fields the contract lets a caller send.** Spreading the whole body echoed
      // anything at all back, so the mock could never be seen refusing a field the server
      // refuses -- and a test sending one would pass on a response the API would not give.
      // **And every one of those the server keeps** (NEW-05): the period, the pages and the
      // override were dropped here, so a screen sending them could never be seen keeping them.
      const now = new Date().toISOString();
      const answer: MatchRuleResult = {
        match_result: body.match_result ?? "unknown",
        reason: body.reason ?? null,
        data_source: body.data_source ?? "manual",
        match_rule: String(params["matchRuleId"]),
        candidate: String(params["candidateId"]),
        reference_period: body.reference_period ?? null,
        retrieval_date: body.retrieval_date ?? now,
        override_reason: body.override_reason ?? null,
        // The moment is the server's, never the caller's: an audit trail whose dates the
        // audited party supplies is not one (`api/rules.py`).
        override_date: body.override_reason ? now : null,
        citations: body.citations ?? [],
        is_proposal: false,
      };
      matchRuleResults = [
        ...matchRuleResults.filter(
          (stored) =>
            !(
              stored.match_rule === answer.match_rule &&
              stored.candidate === answer.candidate
            ),
        ),
        answer,
      ];
      return HttpResponse.json(answer);
    },
  ),

  http.get(`${BASE}/compound-rules`, ({ request }) => {
    const level = new URL(request.url).searchParams.get("level");
    return HttpResponse.json({
      items: COMPOUND_RULES.filter((rule) => rule.level === level),
    });
  }),

  http.get(`${BASE}/data-sources`, () =>
    HttpResponse.json({ items: inStoredOrder(dataSources) }),
  ),

  http.get(`${BASE}/household`, () => HttpResponse.json(household)),

  http.put(`${BASE}/household`, async ({ request }) => {
    const body = (await request.json()) as Household;
    const problems = refusedFields(body, HOUSEHOLD_BOUNDS);
    if (problems.length > 0) {
      return HttpResponse.json(invalidRequest(...problems), { status: 422 });
    }
    household = body;
    return HttpResponse.json(household);
  }),

  http.get(`${BASE}/settings`, () => HttpResponse.json(settings)),

  http.put(`${BASE}/settings`, async ({ request }) => {
    const body = (await request.json()) as Settings;
    const problems = refusedFields(body, SETTINGS_BOUNDS);
    if (problems.length > 0) {
      return HttpResponse.json(invalidRequest(...problems), { status: 422 });
    }
    settings = body;
    return HttpResponse.json(settings);
  }),

  http.get(`${BASE}/candidates`, ({ request }) => {
    const level = new URL(request.url).searchParams.get("level");
    return HttpResponse.json({ items: candidatesForLevel(level) });
  }),

  http.get(`${BASE}/rankings`, ({ request }) => {
    const query = new URL(request.url).searchParams;
    const missing = missingFrom(query, ["criteria_set", "level"]);
    if (missing) return missing;
    const criteriaSet = query.get("criteria_set")!;
    const level = query.get("level")!;
    const refused = refusedBeforeScoring(criteriaSet);
    if (refused) return refused;

    return HttpResponse.json(rankingFor(criteriaSet, level, scaleInForce()));
  }),

  /**
   * Why one candidate scores what it scores, in the live ranking.
   *
   * **Built from the same ranking the table reads**, so the drill-down cannot show figures for
   * a candidate the table never listed -- which is the fault a hand-written detail fixture
   * invites. The attribute scores are the fixture's; the header is this candidate's own row.
   */
  http.get(`${BASE}/rankings/candidates/:candidateId`, ({ params, request }) => {
    const query = new URL(request.url).searchParams;
    const missing = missingFrom(query, ["criteria_set", "level"]);
    if (missing) return missing;
    const criteriaSet = query.get("criteria_set")!;
    const level = query.get("level")!;

    const refused = refusedBeforeScoring(criteriaSet);
    if (refused) return refused;
    const candidateId = String(params["candidateId"]);
    const ranked = rankingFor(criteriaSet, level, scaleInForce()).candidates.find(
      (each) => each.candidate === candidateId,
    );
    if (!ranked) return notFound(candidateId);

    return HttpResponse.json({
      ...ranked,
      score_scale_max: scaleInForce(),
      attribute_scores: attributeScoresOf(candidateId, scaleInForce()),
    });
  }),

  // Saved rankings. The store is module state rather than a fixture, because the thing worth
  // testing is that saving puts something in the list that was not there before.
  http.get(`${BASE}/evaluations`, () =>
    HttpResponse.json({ items: savedEvaluations.map((saved) => saved.summary) }),
  ),

  http.post(`${BASE}/evaluations`, async ({ request }) => {
    const body = (await request.json()) as {
      criteria_set: string;
      level: string;
      note?: string;
    };
    const refused = refusedBeforeScoring(body.criteria_set);
    if (refused) return refused;
    // Frozen with it: a saved ranking keeps the scale it was computed on, and the results it
    // computed, whatever the setting and the figures do afterwards.
    const ranking = rankingFor(body.criteria_set, body.level, scaleInForce());
    // Who was ranked first, by the roster's name; nobody when nothing was ranked (PL-145).
    const first = ranking.candidates.find((each) => each.rank === 1);
    const summary: EvaluationSummary = {
      id: nextEvaluationId++,
      criteria_set: body.criteria_set,
      level: body.level,
      computed_at: "2026-09-21T09:00:00Z",
      score_scale_max: ranking.score_scale_max,
      ...(body.note === undefined ? {} : { note: body.note }),
      leader: first ? { candidate: first.candidate, name: first.name } : null,
    };
    savedEvaluations = [{ summary, candidates: ranking.candidates }, ...savedEvaluations];
    return HttpResponse.json(summary, { status: 201 });
  }),

  // A saved ranking answers in the same shape as a live one, which is what lets one table
  // render both -- with no `evaluation` field, which the server does not send either. Each
  // refusal and warning carries the evidence it read, frozen with it (D46); only the
  // difference from home is today's, because the anchor is the household's current home.
  http.get(`${BASE}/evaluations/:evaluationId`, ({ params }) => {
    const saved = savedEvaluationOf(params["evaluationId"]);
    if (!saved) return evaluationNotFound(params["evaluationId"]);
    return HttpResponse.json({
      criteria_set: saved.summary.criteria_set,
      level: saved.summary.level,
      computed_at: saved.summary.computed_at,
      score_scale_max: saved.summary.score_scale_max,
      candidates: againstHome(saved.candidates, household.home_country_candidate),
    });
  }),

  // Discarded with its whole tree (D47): 204, or 404 naming an id nobody kept.
  http.delete(`${BASE}/evaluations/:evaluationId`, ({ params }) => {
    const saved = savedEvaluationOf(params["evaluationId"]);
    if (!saved) return evaluationNotFound(params["evaluationId"]);
    savedEvaluations = savedEvaluations.filter((each) => each !== saved);
    return new HttpResponse(null, { status: 204 });
  }),

  // One saved candidate's contributions, each with the row it scored (D46), on the frozen scale.
  http.get(`${BASE}/evaluations/:evaluationId/candidates/:candidateId`, ({ params }) => {
    const saved = savedEvaluationOf(params["evaluationId"]);
    if (!saved) return evaluationNotFound(params["evaluationId"]);
    const candidateId = String(params["candidateId"]);
    const result = againstHome(saved.candidates, household.home_country_candidate).find(
      (each) => each.candidate === candidateId,
    );
    if (!result) {
      return HttpResponse.json(
        {
          code: "not_found",
          message: `evaluation ${saved.summary.id} has no result for '${candidateId}'`,
        },
        { status: 404 },
      );
    }
    return HttpResponse.json({
      ...result,
      score_scale_max: saved.summary.score_scale_max,
      attribute_scores: savedAttributeScoresOf(candidateId, saved.summary.score_scale_max),
    });
  }),

  http.get(`${BASE}/criteria-sets/:criteriaSetId`, ({ params }) => {
    const set = criteriaSetDetails[String(params["criteriaSetId"])];
    if (!set) return notFound(String(params["criteriaSetId"]));
    return HttpResponse.json(set);
  }),

  http.patch(
    `${BASE}/criteria-sets/:criteriaSetId/criteria/:attributeId`,
    async ({ params, request }) => {
      const set = criteriaSetDetails[String(params["criteriaSetId"])];
      if (!set) return notFound(String(params["criteriaSetId"]));

      const attributeId = String(params["attributeId"]);
      const criterion = (set.criteria ?? []).find(
        (entry) => entry.attribute === attributeId,
      );
      if (!criterion) return notFound(attributeId);

      const body = (await request.json()) as Partial<Criterion>;

      // **A locked weight cannot be moved, not even to the value it already holds.** The real
      // backend refuses this, and a mock that accepted it certified a protocol the server
      // rejects -- which is how `weight_locked` shipped travelling with a weight and failed
      // the moment a browser drove it. Unlocking is its own change.
      if (body.weight !== undefined && criterion.weight_locked) {
        return HttpResponse.json(
          {
            code: "weights_all_locked",
            message: `cannot change the weight of ${attributeId}: it is itself locked. A lock holds that weight where it is, so unlock it before moving it.`,
            details: { locked: [attributeId] },
          },
          { status: 409 },
        );
      }

      // A rule change, or a lock on its own: the fields that move no weight. Applied in
      // place, because the point of a mock here is that the screen can read back what it sent.
      if (body.weight === undefined) {
        const refused = refusedRule(criterion, body);
        if (refused !== null) return HttpResponse.json(refused, { status: 422 });
        Object.assign(criterion, body);
        return HttpResponse.json({
          pillar: criterion.pillar,
          criteria: (set.criteria ?? []).filter(
            (entry) => entry.pillar === criterion.pillar,
          ),
        });
      }

      if (typeof body.weight !== "number" || !Number.isFinite(body.weight)) {
        return HttpResponse.json(
          invalidRequest({
            location: ["body", "weight"],
            problem:
              "Null is not a value this field takes; leave it out to keep what is stored.",
            kind: "null_not_allowed",
          }),
          { status: 422 },
        );
      }

      return rebalancePillar(set.criteria ?? [], criterion, body.weight);
    },
  ),

  http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
    // **Paged as the server pages, offset and all.** A reader that follows the pages was
    // served the first page again at every offset, so the mock disagreed with the server
    // about exactly the caller that pages.
    const query = new URL(request.url).searchParams;
    const offset = Number(query.get("offset") ?? 0);
    const limit = Number(query.get("limit") ?? RUNS.length);
    return HttpResponse.json({
      items: RUNS.slice(offset, offset + limit),
      total: RUNS.length,
    });
  }),

  /**
   * **Refuses what the server refuses, in its order and with its codes** (PL-091): the required
   * parameters first, then the set and the score range (`the_ranking`), then the limit being set
   * (`comparisons.py`), then `compare`'s own checks
   * -- none, too many, the focus among them, one named twice, and a candidate this level's
   * ranking does not hold, which is how a mixed-level request is refused.
   */
  http.get(`${BASE}/comparisons`, ({ request }) => {
    const query = new URL(request.url).searchParams;
    const missing = missingFrom(query, ["criteria_set", "level", "focus"]);
    if (missing) return missing;
    const criteriaSet = query.get("criteria_set")!;
    const level = query.get("level")!;
    const focus = query.get("focus")!;
    const comparators = query.getAll("comparators");
    const beforeScoring = refusedBeforeScoring(criteriaSet);
    if (beforeScoring) return beforeScoring;
    if (settings.comparator_limit === null || settings.comparator_limit === undefined) {
      return HttpResponse.json(
        {
          code: "comparator_limit_not_set",
          message:
            "comparator_limit is not set, so there is no bound on how many comparators a " +
            "comparison may hold. Set it in Settings; it is provisional by design and has " +
            "no default.",
        },
        { status: 409 },
      );
    }
    if (comparators.length > settings.comparator_limit) {
      return HttpResponse.json(
        {
          code: "comparator_limit_exceeded",
          message: `${comparators.length} comparators is more than the configured limit of ${settings.comparator_limit}`,
          details: { limit: settings.comparator_limit, asked: comparators.length },
        },
        { status: 409 },
      );
    }
    const repeated = [...new Set(comparators.filter((each, at) => comparators.indexOf(each) !== at))];
    const ranked = new Map(
      rankingFor(criteriaSet, level, scaleInForce()).candidates.map((result) => [result.candidate, result]),
    );
    const unranked = [focus, ...comparators].find((candidate) => !ranked.has(candidate));
    const refused: [string, string[]] | null =
      comparators.length === 0
        ? ["a comparison needs at least one comparator", [focus]]
        : comparators.includes(focus)
          ? [`${focus} cannot be compared with itself`, [focus]]
          : repeated.length > 0
            ? ["a comparator appears twice, which would draw the same column twice", repeated]
            : unranked !== undefined
              ? [`'${unranked}' is not in this ranking, so it cannot be compared within it`, [unranked]]
              : null;
    if (refused) {
      return HttpResponse.json(
        { code: "invalid_comparison", message: refused[0], details: { candidates: refused[1] } },
        { status: 409 },
      );
    }
    return HttpResponse.json(
      comparisonFor(
        criteriaSet,
        level,
        ranked.get(focus)!,
        comparators.map((candidate) => ranked.get(candidate)!),
        scaleInForce(),
      ),
    );
  }),

  /**
   * A figure typed by hand.
   *
   * **Refuses what the server refuses.** The catalog decides which attributes accept one, and a
   * mock that accepted every attribute would certify a form the backend rejects -- the fault the
   * locked-criterion PATCH shipped with.
   */
  http.post(`${BASE}/values/manual`, async ({ request }) => {
    const body = (await request.json()) as {
      candidate: string;
      attribute: string;
      payload: unknown;
      reference_period: { start: string; end: string };
      retrieval_date: string;
      confidence_level?: string;
      quote?: string | null;
      citations?: string[];
    };
    // The body is validated before the route runs, so a citation that is not a full web
    // address is refused before any catalog check, every such citation named.
    const notWebAddresses = (body.citations ?? []).flatMap((citation, index) =>
      WEB_ADDRESS.test(citation) ? [] : [index],
    );
    if (notWebAddresses.length > 0) {
      return HttpResponse.json(
        invalidRequest(
          ...notWebAddresses.map((index) => ({
            // `errors.py` names every part of a location as a string, an index included.
            location: ["body", "citations", String(index)],
            problem: `String should match pattern '${WEB_ADDRESS_PATTERN}'`,
            kind: "string_pattern_mismatch",
          })),
        ),
        { status: 422 },
      );
    }
    const attribute = ATTRIBUTES.find((each) => each.id === body.attribute);
    if (attribute?.manual_entry !== true) {
      return HttpResponse.json(
        {
          code: "manual_entry_not_permitted",
          message: `${body.attribute} does not accept a figure typed by hand`,
        },
        { status: 409 },
      );
    }
    // `data/manual.py`'s order: permission, then the switch, so the refusal names the remedy
    // that applies first. A switched-off source is left out of scoring, so nothing is stored.
    if (dataSources.some((each) => each.id === "manual" && !each.is_enabled)) {
      return HttpResponse.json(
        {
          code: "manual_entry_switched_off",
          message:
            "manual entry is switched off, and a switched-off source is left out of scoring, so a figure typed now could not count. Switch it on in Configure to type one.",
        },
        { status: 409 },
      );
    }
    return HttpResponse.json(
      {
        id: 9001,
        candidate: body.candidate,
        attribute: body.attribute,
        value_type: attribute.value_type,
        payload: body.payload,
        // Never the publisher's name: a hand-typed figure arrives as `manual` and ranks last.
        data_source: "manual",
        reference_period: body.reference_period,
        retrieval_date: body.retrieval_date,
        confidence_level: body.confidence_level ?? "medium",
        is_active: true,
        // Derived as the server derives them, never assumed: a typed figure can describe an
        // old period, and the `manual` source can be switched off.
        is_fresh: endedWithin(body.reference_period.end, attribute.max_age_months),
        source_is_enabled: dataSources.find((each) => each.id === "manual")?.is_enabled ?? false,
        quote: body.quote ?? null,
        citations: body.citations ?? [],
        data_acquisition_run: null,
      },
      { status: 201 },
    );
  }),

  /**
   * What the database holds at a level, refused as `api/holdings.py` refuses: a missing
   * parameter, a `since` with no zone (the reader's month start, C04-N10), then an unknown
   * level. The spend is summed from `since` over the runs and the research ledger; values
   * stored are the pairs total less the gaps, the sum the server's one statement closes.
   */
  http.get(`${BASE}/holdings`, ({ request }) => {
    const query = new URL(request.url).searchParams;
    const missing = missingFrom(query, ["level", "since"]);
    if (missing) return missing;
    const level = query.get("level")!;
    const since = zonedMoment(query.get("since")!);
    if (since === null) {
      return HttpResponse.json(
        invalidRequest({
          location: ["query", "since"],
          problem: "Input should have timezone info",
          kind: "timezone_aware",
        }),
        { status: 422 },
      );
    }
    if (!LEVELS.some((each) => each.id === level)) {
      return HttpResponse.json(
        {
          code: "unknown_scope",
          message: `the scope names 1 id(s) that exist at no row at level ${level}: ${level}. Nothing runs until every named id exists.`,
          details: { level, unknown_levels: [level] },
        },
        { status: 422 },
      );
    }
    const atCountry = level === "country";
    const gaps = atCountry ? HOLDINGS_GAPS : { failed: [], unanswered: [], not_reached: [] };
    const pairsTotal = atCountry ? HOLDINGS_PAIRS_TOTAL : 0;
    const gapCount = gaps.failed.length + gaps.unanswered.length + gaps.not_reached.length;
    const runsEur = sumFrom(since, RUNS.map((run) => ({ at: run.started_at, eur: run.cost_eur ?? 0 })));
    const researchEur = sumFrom(
      since,
      researchSpend.map((call) => ({ at: call.researched_at, eur: call.cost_eur })),
    );
    return HttpResponse.json({
      level,
      pairs_total: pairsTotal,
      values_stored: pairsTotal - gapCount,
      values_past_allowed_age: atCountry ? HOLDINGS_PAST_ALLOWED_AGE : 0,
      values_older_than_refetch_age:
        settings.refetch_older_than_days === null || settings.refetch_older_than_days === undefined
          ? null
          : atCountry
            ? HOLDINGS_OLDER_THAN_REFETCH_AGE
            : 0,
      spent: {
        since: new Date(since).toISOString(),
        runs_eur: runsEur,
        research_eur: researchEur,
        total_eur: runsEur + researchEur,
      },
      gaps,
    });
  }),

  http.post(`${BASE}/data-acquisition-runs/plan`, () =>
    HttpResponse.json(RUN_PLAN),
  ),

  http.post(`${BASE}/data-acquisition-runs`, () =>
    HttpResponse.json(STARTED_RUN, { status: 202 }),
  ),

  http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
    HttpResponse.json(runDetailOf(Number(params["runId"]))),
  ),

  /**
   * Stop a run, keeping what it completed.
   *
   * **Mutable, like the criteria sets.** A stop that did not stick would not exercise the
   * screen it exists for: the button goes, the pill reads `stopping`, and neither happens
   * unless the run comes back carrying `stop_requested_at`.
   */
  http.post(`${BASE}/data-acquisition-runs/:runId/stop`, ({ params }) =>
    HttpResponse.json(
      {
        ...runDetailOf(Number(params["runId"])),
        run_status: "running",
        stop_requested_at: STOPPED_AT,
      },
      { status: 202 },
    ),
  ),

  http.post(
    `${BASE}/data-acquisition-runs/:runId/retry`,
    async ({ request }) => {
      // Which part of the run: the failures by default, the unanswered items on request
      // (`reqs.md` Q217). The mock refuses the kind the run has none of, as the API does.
      const body = (await request.json().catch(() => ({}))) as {
        items?: "failed" | "unanswered";
      };
      const items = body.items ?? "failed";
      const available =
        items === "unanswered"
          ? (STARTED_RUN_DETAIL.unanswered ?? [])
          : (STARTED_RUN_DETAIL.failures ?? []);
      if (available.length === 0) {
        return HttpResponse.json(
          {
            code:
              items === "unanswered"
                ? "nothing_to_ask_again"
                : "nothing_to_retry",
            message: `this run has no ${items} items, so a new run would do nothing`,
          },
          { status: 409 },
        );
      }
      return HttpResponse.json(
        {
          ...STARTED_RUN,
          id: STARTED_RUN.id + (items === "unanswered" ? 2 : 1),
        },
        { status: 202 },
      );
    },
  ),

  http.get(`${BASE}/values`, ({ request }) => {
    // Both axes the contract offers: every value for one candidate, or every candidate's
    // value for one attribute (`reqs.md` 8.4). The real endpoint has always taken both.
    const query = new URL(request.url).searchParams;
    const candidate = query.get("candidate");
    const attribute = query.get("attribute");
    // `include_superseded` is honoured, because the two drill-downs want different things: a
    // candidate's own detail shows every figure ever stored, and the attribute view wants one
    // row per candidate -- the active one.
    const superseded = query.get("include_superseded") === "true";
    // Which run produced it. This is what makes an acquisition diff two requests rather than
    // a walk of the whole corpus.
    const fromRun = query.get("data_acquisition_run");
    // What a run re-confirmed rather than stored: the rows its `reconfirmed` names (PL-049).
    // Refused beside `data_acquisition_run`, as the server refuses it (`values.py`).
    const reconfirmedBy = query.get("reconfirmed_by_run");
    if (fromRun !== null && reconfirmedBy !== null) {
      return HttpResponse.json(
        invalidRequest({
          location: ["query", "reconfirmed_by_run"],
          problem: "cannot be asked for together with data_acquisition_run",
          kind: "mutually_exclusive",
        }),
        { status: 422 },
      );
    }
    const restated =
      reconfirmedBy === null
        ? null
        : (runDetailOf(Number(reconfirmedBy)).reconfirmed ?? []).map((each) => each.value);
    const items = STORED_VALUES.filter(
      (value) =>
        (candidate === null || value.candidate === candidate) &&
        (attribute === null || value.attribute === attribute) &&
        (fromRun === null ||
          String(value.data_acquisition_run ?? "") === fromRun) &&
        (restated === null || restated.includes(value.id)) &&
        (superseded || value.is_active),
    );
    // **Paged as the server pages.** `limit` and `offset` were read from nobody, so every
    // request got the whole corpus and a caller that forgot to page looked correct here and
    // truncated in production -- `total` is the field that tells them, and it has to mean
    // something for that to work.
    const offset = Number(query.get("offset") ?? 0);
    const limit = Number(query.get("limit") ?? items.length);
    return HttpResponse.json({
      items: items.slice(offset, offset + limit),
      total: items.length,
    });
  }),

  // A pillar carries no level (`reqs.md` Q187), so one list serves every level.
  http.get(`${BASE}/pillars`, () => HttpResponse.json({ items: PILLARS })),

  // **The filters the server applies, applied here** (P85). This returned the whole catalog
  // whatever it was asked, so a test asserting "the city level has no attributes" passed
  // because the fixture happens to hold only country ones -- it would keep passing with the
  // filter deleted from the server, and start lying the day one city attribute is added.
  // `pillar` and `scorable_only` are in the contract and not yet served; honoured here so the
  // mock is never the laxer of the two.
  http.get(`${BASE}/attributes`, ({ request }) => {
    const query = new URL(request.url).searchParams;
    const level = query.get("level");
    const pillar = query.get("pillar");
    const scorableOnly = query.get("scorable_only") === "true";
    // `include_retired` is not filtered here: `Attribute` carries no `lifecycle_status`, so a
    // retired attribute is indistinguishable from an active one on the wire. The server knows
    // because it reads the catalog; this only ever sees what the catalog chose to send.
    return HttpResponse.json({
      items: ATTRIBUTES.filter(
        (attribute) =>
          (level === null || attribute.level === level) &&
          (pillar === null || attribute.pillar === pillar) &&
          (!scorableOnly || attribute.pillar !== null),
      ),
    });
  }),

  http.get(`${BASE}/external-scores`, ({ request }) => {
    const candidate = new URL(request.url).searchParams.get("candidate");
    const items = EXTERNAL_SCORES.filter(
      (score) => score.candidate === candidate,
    );
    return HttpResponse.json({ items });
  }),

  http.all(`${BASE}/*`, ({ request }) => {
    const path = new URL(request.url).pathname;
    // The one code here no server sends, on purpose: a gap in the mock must not pass for one of
    // the server's own answers (`refusalCodes.test.ts`).
    return HttpResponse.json(
      {
        code: "not_mocked",
        message: `${request.method} ${path} is not in the mock server yet.`,
        details: { path, method: request.method },
      },
      { status: 501 },
    );
  }),
];

/**
 * A required query parameter left out, refused as FastAPI refuses it and `errors.py` renders
 * it: 422 `invalid_request`, each missing one located in the query.
 */
/** A time that names its zone, as `AwareDatetime` takes one; null for any other text. */
function zonedMoment(text: string): number | null {
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
  const moment = Date.parse(text);
  return Number.isNaN(moment) ? null : moment;
}

/** What was spent at or after `since`, which is the server's comparison (`>=`). */
function sumFrom(since: number, spends: readonly { at: string; eur: number }[]): number {
  return spends
    .filter((spend) => Date.parse(spend.at) >= since)
    .reduce((total, spend) => total + spend.eur, 0);
}

function missingFrom(query: URLSearchParams, required: readonly string[]) {
  const missing = required.filter((name) => !query.has(name));
  if (missing.length === 0) return null;
  return HttpResponse.json(
    {
      code: "invalid_request",
      message: "The request does not match what this operation accepts.",
      details: {
        errors: missing.map(
          (name): FieldProblem => ({
            location: ["query", name],
            problem: "Field required",
            kind: "missing",
          }),
        ),
      },
    },
    { status: 422 },
  );
}

/**
 * **What the server answers in place of a score, in its precedence** (`rankings.py::the_ranking`):
 * after the request's own parameters, the criteria set named is read first -- a 404 `not_found`
 * for one that does not exist, whatever the settings say -- and only then is an unset top of the
 * range a 409 `score_scale_not_set`. Every handler that scores asks this first, so a mock that
 * scored onto a range nobody chose can no longer hide a screen that mishandles the refusal
 * (PL-005).
 */
function refusedBeforeScoring(criteriaSet: string): Response | null {
  if (!criteriaSetDetails[criteriaSet]) return notFound(criteriaSet);
  return refusedForAnUnsetScale();
}

/** The 409 for an unset top of the score range, or nothing while it is set. */
function refusedForAnUnsetScale(): Response | null {
  if (settings.score_scale_max !== null && settings.score_scale_max !== undefined) return null;
  return HttpResponse.json(
    {
      code: "score_scale_not_set",
      message:
        "score_scale_max is not set, so there is no scale to score onto. Set it in Settings; " +
        "it is provisional by design and has no default.",
    },
    { status: 409 },
  );
}

/** The scale a live score is on: the setting, which `refusedBeforeScoring` has checked. */
function scaleInForce(): number {
  if (settings.score_scale_max === null || settings.score_scale_max === undefined) {
    throw new Error("a handler scored before refusing an unset score range");
  }
  return settings.score_scale_max;
}

type FieldProblem = components["schemas"]["FieldProblem"];

/**
 * **A rule the domain refuses, refused in the server's words and order** (PL-026): the body's
 * threshold first (`api/criteria.py` builds it), then `Criterion`'s validators as
 * `_reject_a_criterion_that_is_not_a_rule` runs them, then the anchors this request wrote
 * against the top of the score range. Each names the fields it concerns in `details.errors`, as
 * `errors.py` renders a domain refusal. A reducer and a threshold of another shape are not
 * modelled: the rule form edits neither.
 */
function refusedRule(stored: Criterion, sent: Partial<Criterion>) {
  const rule = { ...stored, ...sent };
  const refusal =
    thresholdRefusal(sent) ?? domainRefusal(stored.attribute, rule) ?? anchorsAboveTheRange(stored, sent);
  if (refusal === null) return null;
  const { message, fields, limit, details = {} } = refusal;
  return {
    code: "invalid_criterion",
    message,
    details: {
      ...details,
      errors: fields.map((field) => ({
        location: ["body", field],
        problem: message,
        kind: "invalid_criterion",
        ...(limit !== undefined && { limit }),
      })),
    },
  };
}

interface RuleRefusal {
  message: string;
  fields: string[];
  limit?: number;
  details?: Record<string, unknown>;
}

function thresholdRefusal(sent: Partial<Criterion>): RuleRefusal | null {
  const threshold = sent.matching_threshold as { min_value?: number | null; max_value?: number | null } | null | undefined;
  if (threshold === null || threshold === undefined) return null;
  if (!("min_value" in threshold) && !("max_value" in threshold)) return null;
  const { min_value: low = null, max_value: high = null } = threshold;
  if (low === null && high === null) {
    return {
      message:
        "a range threshold needs a minimum, a maximum, or both; one open at both ends excludes nothing",
      fields: ["matching_threshold"],
    };
  }
  if (low !== null && high !== null && low > high) {
    return { message: `minimum ${String(low)} is above maximum ${String(high)}`, fields: ["matching_threshold"] };
  }
  return null;
}

/** `criterion.py`'s `_LEGAL_METHODS`: a type absent here is unconstrained. */
const LEGAL_METHODS: Record<string, readonly string[]> = {
  Monetary: ["fixed"],
  Quantity: ["fixed", "percentile"],
  Count: ["fixed", "percentile"],
  Ratio: ["as_is", "fixed", "percentile"],
  Index: ["as_is", "percentile"],
  AssignedScore: ["as_is"],
};

function domainRefusal(attribute: string, rule: Criterion): RuleRefusal | null {
  const {
    goal,
    normalisation_method: method,
    target_range_min: low = null,
    target_range_max: high = null,
    zero_score_below: zeroBelow = null,
    zero_score_above: zeroAbove = null,
  } = rule;
  if (goal === "target_range") {
    const unset = [
      ["target_range_min", low],
      ["target_range_max", high],
    ].flatMap(([name, bound]) => (bound === null ? [String(name)] : []));
    if (unset.length > 0) {
      return {
        message:
          `${attribute} aims at a target range but names no band; a target range needs both a ` +
          "minimum and a maximum, in the attribute's own unit",
        fields: unset,
      };
    }
    if (method !== "fixed") {
      return {
        message:
          `${attribute} aims at a target range and normalises \`${String(method)}\`, which ` +
          "cannot express a band: `percentile` scores by standing among the candidates and " +
          "`as_is` reads the figure as a score. A target range is a `fixed` scale -- the band, " +
          "and where the score reaches zero on each side",
        fields: ["goal", "normalisation_method"],
      };
    }
  }
  const valueType = ATTRIBUTES.find((each) => each.id === attribute)?.value_type;
  const legal = valueType === undefined ? undefined : LEGAL_METHODS[valueType];
  if (legal !== undefined && method !== undefined && !legal.includes(method)) {
    return {
      message:
        `${attribute} is a ${String(valueType)} and normalises \`${method}\`, which \`reqs.md\` ` +
        `3.3a does not permit for that type; the legal methods for a ${String(valueType)} are: ` +
        legal.join(", "),
      fields: ["normalisation_method"],
    };
  }
  if (low !== null && high !== null && low > high) {
    return {
      message: `the target range of ${attribute} runs ${String(low)} to ${String(high)}, which is backwards`,
      fields: ["target_range_min", "target_range_max"],
    };
  }
  if (zeroBelow !== null && low !== null && zeroBelow > low) {
    return {
      message: `${attribute} scores 0 below ${String(zeroBelow)}, which is inside its target band starting at ${String(low)}`,
      fields: ["target_range_min", "zero_score_below"],
    };
  }
  if (zeroAbove !== null && high !== null && zeroAbove < high) {
    return {
      message: `${attribute} scores 0 above ${String(zeroAbove)}, which is inside its target band ending at ${String(high)}`,
      fields: ["target_range_max", "zero_score_above"],
    };
  }
  return anchorRefusal(attribute, rule);
}

function anchorRefusal(attribute: string, rule: Criterion): RuleRefusal | null {
  const anchors = rule.scale_anchors ?? [];
  if (anchors.length === 1) {
    return {
      message:
        `${attribute} has one scale anchor, which maps that single value and nothing else; a ` +
        "fixed scale needs at least two points, or none at all",
      fields: ["scale_anchors"],
    };
  }
  const inputs = anchors.map((anchor) => anchor.input_value);
  if (new Set(inputs).size !== inputs.length) {
    return {
      message: `${attribute} anchors the same input value twice, so it maps to two different scores`,
      fields: ["scale_anchors"],
    };
  }
  if (rule.goal === "target_range" || anchors.length < 2) return null;
  const scores = [...anchors].sort((one, other) => one.input_value - other.input_value).map((anchor) => anchor.score);
  const rising = scores.some((score, at) => at > 0 && score > (scores[at - 1] ?? score));
  const falling = scores.some((score, at) => at > 0 && score < (scores[at - 1] ?? score));
  if (rule.goal === "minimise" && rising) {
    return {
      message:
        `${attribute} is to minimise, but its anchors' scores rise as the value rises -- it ` +
        "would reward exactly what it means to penalise",
      fields: ["goal", "scale_anchors"],
    };
  }
  if (rule.goal === "maximise" && falling) {
    return {
      message:
        `${attribute} is to maximise, but its anchors' scores fall as the value rises -- it ` +
        "would penalise exactly what it means to reward",
      fields: ["goal", "scale_anchors"],
    };
  }
  return null;
}

/** Only the anchors this request wrote, against a range that is set (`api/criteria.py`). */
function anchorsAboveTheRange(stored: Criterion, sent: Partial<Criterion>): RuleRefusal | null {
  const top = settings.score_scale_max;
  if (top === null || top === undefined || sent.scale_anchors === undefined) return null;
  const key = (anchor: { input_value: number; score: number; label?: string | null }) =>
    JSON.stringify([anchor.input_value, anchor.score, anchor.label ?? null]);
  const before = new Set((stored.scale_anchors ?? []).map(key));
  const after = sent.scale_anchors ?? [];
  if (after.length === before.size && after.every((anchor) => before.has(key(anchor)))) return null;
  const over = after.find((anchor) => anchor.score > top);
  if (over === undefined) return null;
  return {
    message: `${stored.attribute} anchors ${pythonFloat(over.input_value)} to a score of ${String(over.score)}, and the score scale stops at ${String(top)}`,
    fields: ["scale_anchors"],
    limit: top,
    details: {
      reason: "anchor_above_scale",
      attribute: stored.attribute,
      anchor_score: over.score,
      score_scale_max: top,
    },
  };
}

/** An anchor's figure as the server prints it: a float there, so a whole one keeps its ".0". */
function pythonFloat(value: number): string {
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

/** One body field as `api/household.py` and `api/settings.py` declare it, which is the contract's. */
interface FieldBound {
  name: string;
  type: "number" | "integer" | "string" | "list";
  required?: boolean;
  /** `ge`. */
  minimum?: number;
  /** `le`. */
  maximum?: number;
}

const HOUSEHOLD_BOUNDS: readonly FieldBound[] = [
  { name: "net_income", type: "number", required: true, minimum: 0 },
  { name: "number_adults", type: "integer", required: true, minimum: 1 },
  { name: "number_children", type: "integer", required: true, minimum: 0 },
  { name: "home_country_candidate", type: "string", required: true },
  { name: "citizenships", type: "list", required: true },
  { name: "target_monthly_spend", type: "number", minimum: 0 },
  { name: "max_rent", type: "number", minimum: 0 },
];

const SETTINGS_BOUNDS: readonly FieldBound[] = [
  { name: "min_coverage", type: "number", minimum: 0, maximum: 100 },
  { name: "score_scale_max", type: "integer", minimum: 1 },
  { name: "comparator_limit", type: "integer", minimum: 1, maximum: 20 },
  { name: "run_spend_cap_eur", type: "number", minimum: 0 },
  { name: "refetch_older_than_days", type: "integer", minimum: 1 },
];

/**
 * **Every field the server would refuse, refused as Pydantic words it** (PL-028, C02-S2): all of
 * them at once, each with its `kind` and, for a bound, its `limit`. The mock once refused one
 * field with a code the server never sends, which certified a form the real refusal never
 * reached.
 */
function refusedFields(body: object, bounds: readonly FieldBound[]): FieldProblem[] {
  const values = body as Record<string, unknown>;
  return bounds.flatMap((bound): FieldProblem[] => {
    const value = values[bound.name];
    const location = ["body", bound.name];
    if (value === undefined || value === null) {
      return bound.required === true
        ? [{ location, problem: "Field required", kind: "missing" }]
        : [];
    }
    if (bound.type === "list") {
      return Array.isArray(value) && value.length === 0
        ? [
            {
              location,
              problem: "Tuple should have at least 1 item after validation, not 0",
              kind: "too_short",
            },
          ]
        : [];
    }
    if (bound.type === "string") {
      return value === ""
        ? [{ location, problem: "String should have at least 1 character", kind: "string_too_short" }]
        : [];
    }
    if (typeof value !== "number") return [];
    if (bound.type === "integer" && !Number.isInteger(value)) {
      return [
        {
          location,
          problem: "Input should be a valid integer, got a number with a fractional part",
          kind: "int_from_float",
        },
      ];
    }
    if (bound.minimum !== undefined && value < bound.minimum) {
      return [
        {
          location,
          problem: `Input should be greater than or equal to ${String(bound.minimum)}`,
          kind: "greater_than_equal",
          limit: bound.minimum,
        },
      ];
    }
    if (bound.maximum !== undefined && value > bound.maximum) {
      return [
        {
          location,
          problem: `Input should be less than or equal to ${String(bound.maximum)}`,
          kind: "less_than_equal",
          limit: bound.maximum,
        },
      ];
    }
    return [];
  });
}

/**
 * `api/values.py`'s `WEB_ADDRESS`, character for character: a citation typed by hand must be a
 * full http or https address, and the refusal quotes the pattern as Pydantic does.
 */
const WEB_ADDRESS_PATTERN = "^[Hh][Tt][Tt][Pp][Ss]?://[^\\s/?#]+[^\\s]*$";
const WEB_ADDRESS = new RegExp(WEB_ADDRESS_PATTERN);

/**
 * A body field refused at the boundary, as `errors.py` renders it: the one sentence for every
 * malformed request, and each offending field as a `FieldProblem` in `details.errors` (a list).
 */
function invalidRequest(...errors: FieldProblem[]) {
  return {
    code: "invalid_request",
    message: "The request does not match what this operation accepts.",
    details: { errors },
  };
}

/** `select_data_sources`: priority first, and a tie broken by id (P76). */
function inStoredOrder(sources: readonly DataSource[]): DataSource[] {
  return [...sources].sort(
    (one, other) =>
      one.default_priority - other.default_priority || (one.id < other.id ? -1 : one.id > other.id ? 1 : 0),
  );
}

/** A reorder's body as pydantic refuses it: no list, or a member that is not a string. */
function orderProblems(order: unknown): FieldProblem[] {
  if (order === undefined) {
    return [{ location: ["body", "order"], problem: "Field required", kind: "missing" }];
  }
  if (!Array.isArray(order)) {
    return [{ location: ["body", "order"], problem: "Input should be a valid list", kind: "list_type" }];
  }
  return order.flatMap((each: unknown, at) =>
    typeof each === "string"
      ? []
      : [{ location: ["body", "order", String(at)], problem: "Input should be a valid string", kind: "string_type" }],
  );
}

function savedEvaluationOf(id: unknown): SavedEvaluation | undefined {
  return savedEvaluations.find((saved) => String(saved.summary.id) === String(id));
}

/** The server's refusal for an evaluation nobody kept: its own words, and the id it names. */
function evaluationNotFound(id: unknown) {
  return HttpResponse.json(
    {
      code: "not_found",
      message: `there is no evaluation numbered ${String(id)}`,
      details: { evaluation: Number(id) },
    },
    { status: 404 },
  );
}

/**
 * Each candidate's score minus home's, as `against_home` takes it: nothing for home itself, and
 * nothing where either score is missing -- including a home this ranking never scored.
 */
function againstHome(
  candidates: readonly CandidateResult[],
  home: string | null | undefined,
): CandidateResult[] {
  const homeScore = candidates.find((each) => each.candidate === home)?.score ?? null;
  return candidates.map((each) => ({
    ...each,
    delta_vs_home:
      each.candidate === home || homeScore === null || each.score === null
        ? null
        : each.score - homeScore,
  }));
}

/**
 * A run's detail. **What it re-confirmed is limited to its own items**, as `select_run` joins
 * them: a reuse recorded for a pair the run never asked about is nothing it produced. A run over
 * exact pairs has those pairs as its items (`RUN_ITEMS`), never the rectangle around them.
 */
function runDetailOf(id: number): RunDetail {
  const detail: RunDetail = RUN_DETAILS[id] ?? { ...STARTED_RUN_DETAIL, id };
  return {
    ...detail,
    reconfirmed: RUN_REUSES.filter(
      (reuse) => reuse.data_acquisition_run === id && isItemOf(id, detail.scope, reuse),
    ).map(({ data_source, candidate, attribute, value }) => ({
      data_source,
      candidate,
      attribute,
      value,
    })),
  };
}

function isItemOf(
  run: number,
  scope: RunDetail["scope"],
  pair: { candidate: string; attribute: string },
): boolean {
  const exact = RUN_ITEMS[run];
  if (exact !== undefined) {
    return exact.some(
      (item) => item.candidate === pair.candidate && item.attribute === pair.attribute,
    );
  }
  const listed = (names: string[] | null | undefined, name: string) =>
    names === null || names === undefined || names.includes(name);
  return listed(scope?.candidates, pair.candidate) && listed(scope?.attributes, pair.attribute);
}

function notFound(id: string) {
  return HttpResponse.json(
    { code: "not_found", message: `No such resource: ${id}.` },
    { status: 404 },
  );
}

/**
 * The server's arithmetic, standing in for the server's arithmetic (`arch.md` 8.3).
 *
 * **It lives here rather than in the interface on purpose.** The screen sends one weight and
 * renders what comes back; if this ever moved into a component, the interface would be
 * deciding what a score is made of. The rule it keeps is the only one that matters: the pillar
 * sums to 100 afterwards, and locked weights do not move.
 */
function rebalancePillar(
  criteria: Criterion[],
  edited: Criterion,
  weight: number,
) {
  const pillar = criteria.filter((entry) => entry.pillar === edited.pillar);
  const siblings = pillar.filter((entry) => entry !== edited);
  const unlocked = siblings.filter((entry) => !entry.weight_locked);
  const lockedTotal = siblings
    .filter((entry) => entry.weight_locked)
    .reduce((total, entry) => total + (entry.weight ?? 0), 0);
  const room = 100 - weight - lockedTotal;

  if (unlocked.length === 0 || room < 0) {
    return HttpResponse.json(
      {
        code: "weights_all_locked",
        message:
          "The change cannot be absorbed: the other weights in this pillar are locked.",
        details: {
          locked: siblings
            .filter((entry) => entry.weight_locked)
            .map((entry) => entry.attribute),
        },
      },
      { status: 409 },
    );
  }

  const before = unlocked.reduce(
    (total, entry) => total + (entry.weight ?? 0),
    0,
  );
  edited.weight = weight;

  let distributed = 0;
  unlocked.forEach((sibling, index) => {
    const isLast = index === unlocked.length - 1;
    const share =
      before > 0 ? (sibling.weight ?? 0) / before : 1 / unlocked.length;
    // The last sibling takes the residual, so rounding can never leave the pillar off 100.
    sibling.weight = isLast ? round(room - distributed) : round(room * share);
    distributed += sibling.weight;
  });

  return HttpResponse.json({ pillar: edited.pillar, criteria: pillar });
}

/**
 * The same rebalance one level up: pillar weights sum to 100 within a level.
 *
 * Written twice rather than generalised over "things with a weight and a lock". The two differ
 * in what identifies a row and in what the refusal names, and a shared helper here would earn
 * a parameter for each of those differences -- a little copy against a little dependency.
 */
function rebalancePillarWeights(
  weights: PillarWeight[],
  edited: PillarWeight,
  weight: number,
) {
  const others = weights.filter((entry) => entry !== edited);
  const unlocked = others.filter((entry) => !entry.weight_locked);
  const lockedTotal = others
    .filter((entry) => entry.weight_locked)
    .reduce((total, entry) => total + entry.weight, 0);
  const room = 100 - weight - lockedTotal;

  if (unlocked.length === 0 || room < 0) {
    return HttpResponse.json(
      {
        code: "weights_all_locked",
        message:
          "The change cannot be absorbed: the other pillar weights are locked.",
        details: {
          locked: others
            .filter((entry) => entry.weight_locked)
            .map((entry) => entry.pillar),
        },
      },
      { status: 409 },
    );
  }

  const before = unlocked.reduce((total, entry) => total + entry.weight, 0);
  edited.weight = weight;

  let distributed = 0;
  unlocked.forEach((other, index) => {
    const isLast = index === unlocked.length - 1;
    const share = before > 0 ? other.weight / before : 1 / unlocked.length;
    other.weight = isLast ? round(room - distributed) : round(room * share);
    distributed += other.weight;
  });

  return HttpResponse.json({ items: weights });
}

/** The server's refusal of an outcome sent for a rule being switched off (`criteria_set.py`). */
function outcomeForARuleOff(rule: string) {
  return HttpResponse.json(
    {
      code: "invalid_criteria_set",
      message: `${rule} is being switched off, and a rule that is off holds no outcome`,
    },
    { status: 422 },
  );
}

/** A set's outcomes with one rule's set, or dropped when it is null. */
function withOutcome(
  current: Record<string, RuleOutcome>,
  rule: string,
  outcome: RuleOutcome | null,
): Record<string, RuleOutcome> {
  const rest = Object.fromEntries(
    Object.entries(current).filter(([held]) => held !== rule),
  );
  return outcome === null ? rest : { ...rest, [rule]: outcome };
}

/** Membership in a list of rule ids, which is what both enforcement toggles amount to. */
function withMembership(
  current: string[],
  id: string,
  wanted: boolean,
): string[] {
  if (wanted) return current.includes(id) ? current : [...current, id];
  return current.filter((each) => each !== id);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Two answers about the same gate for the same candidate: one row, whoever wrote it. */
function isSameAnswer(one: MatchRuleResult, other: MatchRuleResult): boolean {
  return one.match_rule === other.match_rule && one.candidate === other.candidate;
}

/** Whether a period that ended on `end` is still within `months` of today; no limit is fresh. */
function endedWithin(end: string, months: number | null | undefined): boolean {
  if (months === null || months === undefined) return true;
  const limit = new Date(`${end}T00:00:00Z`);
  limit.setUTCMonth(limit.getUTCMonth() + months);
  return limit.getTime() >= Date.now();
}
