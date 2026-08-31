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
import {
  CRITERIA_SETS,
  LEVELS,
  RUNS,
  SETTINGS,
  candidatesForLevel,
  rankingFor,
} from "./fixtures";

const BASE = "/v1";

export const handlers = [
  http.get(`${BASE}/levels`, () => HttpResponse.json({ items: LEVELS })),

  http.get(`${BASE}/criteria-sets`, () => HttpResponse.json({ items: CRITERIA_SETS })),

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

  http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? RUNS.length);
    return HttpResponse.json({ items: RUNS.slice(0, limit), total: RUNS.length });
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
