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
  HOUSEHOLD,
  LEVELS,
  MATCH_RULES,
  MATCH_RULE_RESULTS,
  RESEARCHED_PROPOSALS,
  RESEARCH_CALL_COST_EUR,
  RESEARCH_PLAN,
  RUNS,
  RUN_PLAN,
  SETTINGS,
  STARTED_RUN,
  STARTED_RUN_DETAIL,
  STORED_VALUES,
  candidatesForLevel,
  comparisonFor,
  makeCriteriaSetDetails,
  rankingFor,
} from "./fixtures";

type Criterion = components["schemas"]["Criterion"];
type MatchRuleResult = components["schemas"]["MatchRuleResult"];
type CriteriaSet = components["schemas"]["CriteriaSet"];
type CriteriaSetSummary = components["schemas"]["CriteriaSetSummary"];
type PillarWeight = components["schemas"]["PillarWeight"];
type Settings = components["schemas"]["Settings"];
type Household = components["schemas"]["HouseholdInput"];
type EvaluationSummary = components["schemas"]["EvaluationSummary"];
type DataSource = components["schemas"]["DataSource"];

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
let savedEvaluations: EvaluationSummary[] = [];
let nextEvaluationId = 1;
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
      const body = (await request.json()) as { is_enforced: boolean };
      set.enforced_match_rules = withMembership(
        set.enforced_match_rules ?? [],
        String(params["matchRuleId"]),
        body.is_enforced,
      );
      return new HttpResponse(null, { status: 204 });
    },
  ),

  http.put(
    `${BASE}/criteria-sets/:criteriaSetId/compound-rules/:compoundRuleId`,
    async ({ params, request }) => {
      const set = criteriaSetDetails[String(params["criteriaSetId"])];
      if (!set) return notFound(String(params["criteriaSetId"]));
      const body = (await request.json()) as { is_applied: boolean };
      set.applied_compound_rules = withMembership(
        set.applied_compound_rules ?? [],
        String(params["compoundRuleId"]),
        body.is_applied,
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
    HttpResponse.json({ items: dataSources }),
  ),

  http.get(`${BASE}/household`, () => HttpResponse.json(household)),

  http.put(`${BASE}/household`, async ({ request }) => {
    const body = (await request.json()) as Household;
    if ((body.citizenships ?? []).length === 0) {
      return HttpResponse.json(
        {
          code: "invalid_request",
          message: "A household needs at least one citizenship.",
          details: { field: "citizenships" },
        },
        { status: 422 },
      );
    }
    household = body;
    return HttpResponse.json(household);
  }),

  http.get(`${BASE}/settings`, () => HttpResponse.json(settings)),

  http.put(`${BASE}/settings`, async ({ request }) => {
    const body = (await request.json()) as Settings;
    if (
      body.score_scale_max !== null &&
      body.score_scale_max !== undefined &&
      body.score_scale_max < 1
    ) {
      return HttpResponse.json(
        {
          code: "invalid_request",
          message: "The score scale maximum must be at least 1.",
          details: { field: "score_scale_max" },
        },
        { status: 422 },
      );
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

    return HttpResponse.json(rankingFor(criteriaSet, level));
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

    const candidateId = String(params["candidateId"]);
    const ranked = rankingFor(criteriaSet, level).candidates.find(
      (each) => each.candidate === candidateId,
    );
    if (!ranked) return notFound(candidateId);

    return HttpResponse.json({ ...ranked, attribute_scores: attributeScoresOf(candidateId) });
  }),

  // Saved rankings. The store is module state rather than a fixture, because the thing worth
  // testing is that saving puts something in the list that was not there before.
  http.get(`${BASE}/evaluations`, () =>
    HttpResponse.json({ items: [...savedEvaluations] }),
  ),

  http.post(`${BASE}/evaluations`, async ({ request }) => {
    const body = (await request.json()) as {
      criteria_set: string;
      level: string;
      note?: string;
    };
    const saved = {
      id: nextEvaluationId++,
      criteria_set: body.criteria_set,
      level: body.level,
      computed_at: "2026-09-21T09:00:00Z",
      score_scale_max: 100,
      ...(body.note === undefined ? {} : { note: body.note }),
    };
    savedEvaluations = [saved, ...savedEvaluations];
    return HttpResponse.json(saved, { status: 201 });
  }),

  // A saved ranking answers in the same shape as a live one, which is what lets one table
  // render both.
  http.get(`${BASE}/evaluations/:evaluationId`, ({ params }) => {
    const saved = savedEvaluations.find(
      (entry) => String(entry.id) === String(params["evaluationId"]),
    );
    if (!saved) return notFound(String(params["evaluationId"]));
    return HttpResponse.json(rankingFor(saved.criteria_set, saved.level));
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
          {
            code: "invalid_request",
            message: "weight must be a number between 0 and 100.",
            details: { field: "weight" },
          },
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
   * parameters first, then the limit being set (`comparisons.py`), then `compare`'s own checks
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
      rankingFor(criteriaSet, level).candidates.map((result) => [result.candidate, result]),
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
        quote: body.quote ?? null,
        citations: body.citations ?? [],
        data_acquisition_run: null,
      },
      { status: 201 },
    );
  }),

  http.post(`${BASE}/data-acquisition-runs/plan`, () =>
    HttpResponse.json(RUN_PLAN),
  ),

  http.post(`${BASE}/data-acquisition-runs`, () =>
    HttpResponse.json(STARTED_RUN, { status: 202 }),
  ),

  http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
    HttpResponse.json({ ...STARTED_RUN_DETAIL, id: Number(params["runId"]) }),
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
        ...STARTED_RUN_DETAIL,
        id: Number(params["runId"]),
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
    const items = STORED_VALUES.filter(
      (value) =>
        (candidate === null || value.candidate === candidate) &&
        (attribute === null || value.attribute === attribute) &&
        (fromRun === null ||
          String(value.data_acquisition_run ?? "") === fromRun) &&
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
function missingFrom(query: URLSearchParams, required: readonly string[]) {
  const missing = required.filter((name) => !query.has(name));
  if (missing.length === 0) return null;
  return HttpResponse.json(
    {
      code: "invalid_request",
      message: "The request does not match what this operation accepts.",
      details: {
        errors: missing.map((name) => ({ location: ["query", name], problem: "Field required" })),
      },
    },
    { status: 422 },
  );
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
