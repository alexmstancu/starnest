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
  COMPOUND_RULES,
  CRITERIA_SETS,
  DATA_SOURCES,
  EXTERNAL_SCORES,
  HOUSEHOLD,
  MATCH_RULES,
  LEVELS,
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
type CriteriaSet = components["schemas"]["CriteriaSet"];
type CriteriaSetSummary = components["schemas"]["CriteriaSetSummary"];
type PillarWeight = components["schemas"]["PillarWeight"];
type Settings = components["schemas"]["Settings"];
type Household = components["schemas"]["HouseholdInput"];

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

export function resetMockData(): void {
  criteriaSetDetails = makeCriteriaSetDetails();
  criteriaSetSummaries = [...CRITERIA_SETS];
  settings = { ...SETTINGS };
  household = { ...HOUSEHOLD };
}

export const handlers = [
  http.get(`${BASE}/levels`, () => HttpResponse.json({ items: LEVELS })),

  http.get(`${BASE}/criteria-sets`, () =>
    HttpResponse.json({ items: criteriaSetSummaries }),
  ),

  http.post(`${BASE}/criteria-sets`, async ({ request }) => {
    const body = (await request.json()) as { id: string; name: string };
    if (criteriaSetDetails[body.id]) {
      return HttpResponse.json(
        {
          code: "already_exists",
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
        weight: number;
        weight_locked?: boolean;
      };
      if (body.weight_locked !== undefined)
        edited.weight_locked = body.weight_locked;
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

  http.get(`${BASE}/compound-rules`, ({ request }) => {
    const level = new URL(request.url).searchParams.get("level");
    return HttpResponse.json({
      items: COMPOUND_RULES.filter((rule) => rule.level === level),
    });
  }),

  http.get(`${BASE}/data-sources`, () =>
    HttpResponse.json({ items: DATA_SOURCES }),
  ),

  http.get(`${BASE}/household`, () => HttpResponse.json(household)),

  http.put(`${BASE}/household`, async ({ request }) => {
    const body = (await request.json()) as Household;
    if ((body.citizenships ?? []).length === 0) {
      return HttpResponse.json(
        {
          code: "invalid_field",
          message: "A household needs at least one citizenship.",
          details: { field: "citizenships" },
        },
        { status: 400 },
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
          code: "invalid_field",
          message: "The score scale maximum must be at least 1.",
          details: { field: "score_scale_max" },
        },
        { status: 400 },
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
    const criteriaSet = query.get("criteria_set");
    const level = query.get("level");

    if (!criteriaSet || !level) {
      return HttpResponse.json(
        {
          code: "missing_query_parameter",
          message: "criteria_set and level are both required.",
        },
        { status: 400 },
      );
    }

    return HttpResponse.json(rankingFor(criteriaSet, level));
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

      const body = (await request.json()) as { weight?: number };
      if (typeof body.weight !== "number" || !Number.isFinite(body.weight)) {
        return HttpResponse.json(
          {
            code: "invalid_field",
            message: "weight must be a number between 0 and 100.",
            details: { field: "weight" },
          },
          { status: 400 },
        );
      }

      return rebalancePillar(set.criteria ?? [], criterion, body.weight);
    },
  ),

  http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
    const limit = Number(
      new URL(request.url).searchParams.get("limit") ?? RUNS.length,
    );
    return HttpResponse.json({
      items: RUNS.slice(0, limit),
      total: RUNS.length,
    });
  }),

  http.get(`${BASE}/comparisons`, ({ request }) => {
    const query = new URL(request.url).searchParams;
    const focus = query.get("focus");
    const comparators = query.getAll("comparators");
    if (!focus || comparators.length === 0) {
      return HttpResponse.json(
        {
          code: "invalid_comparison",
          message: "a comparison needs a focus and a comparator",
        },
        { status: 409 },
      );
    }
    if (comparators.length > (settings.comparator_limit ?? 0)) {
      return HttpResponse.json(
        {
          code: "invalid_comparison",
          message: `${comparators.length} comparators is more than the configured limit`,
        },
        { status: 409 },
      );
    }
    return HttpResponse.json(
      comparisonFor(
        query.get("criteria_set") ?? "minimal",
        query.get("level") ?? "country",
        focus,
        comparators,
      ),
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

  http.post(`${BASE}/data-acquisition-runs/:runId/retry`, () =>
    HttpResponse.json(
      { ...STARTED_RUN, id: STARTED_RUN.id + 1 },
      { status: 202 },
    ),
  ),

  http.get(`${BASE}/values`, ({ request }) => {
    const candidate = new URL(request.url).searchParams.get("candidate");
    const items = STORED_VALUES.filter(
      (value) => value.candidate === candidate,
    );
    return HttpResponse.json({ items, total: items.length });
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
