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
  CRITERIA_SETS,
  LEVELS,
  RUNS,
  RUN_PLAN,
  SETTINGS,
  STARTED_RUN,
  STARTED_RUN_DETAIL,
  candidatesForLevel,
  comparisonFor,
  makeCriteriaSetDetails,
  rankingFor,
} from "./fixtures";

type Criterion = components["schemas"]["Criterion"];

const BASE = "/v1";

/**
 * The one piece of the mock that is mutable, because a weight change that did not stick would
 * not exercise the screen it exists for.
 *
 * `resetMockData` puts it back between tests -- msw's `resetHandlers()` restores handlers, not
 * anything they wrote.
 */
let criteriaSetDetails = makeCriteriaSetDetails();

export function resetMockData(): void {
  criteriaSetDetails = makeCriteriaSetDetails();
}

export const handlers = [
  http.get(`${BASE}/levels`, () => HttpResponse.json({ items: LEVELS })),

  http.get(`${BASE}/criteria-sets`, () =>
    HttpResponse.json({ items: CRITERIA_SETS }),
  ),

  http.get(`${BASE}/settings`, () => HttpResponse.json(SETTINGS)),

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
    if (comparators.length > (SETTINGS.comparator_limit ?? 0)) {
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
