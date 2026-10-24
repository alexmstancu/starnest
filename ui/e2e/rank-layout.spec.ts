import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * PL-075 (UF-119): a ranking row shows its state, at every width the interface supports.
 *
 * **Only a browser can see this.** The state classes were on the rows and the rules were in the
 * sheet, and the row's own base rule out-ranked them, so an open row and a ruled-out row both
 * drew on plain white. The static guard in `rankingRowStyles.test.ts` reads the cause; this
 * reads the effect, as computed backgrounds, with the pointer away so no hover tint stands in.
 *
 * **A non-match is arranged, then put back**, as Gate C does: nothing is `not_matching` until
 * a gate is enforced and answered. The set is this spec's own copy, so the enforcement reaches
 * no other spec.
 */

const LAYOUT_SET = "e2e_rank_layout";
const SHIPPED_SOURCE = "minimal";
const THE_GATE = "not_manually_excluded";
const THE_EXCLUDED_ONE = { id: "country.greece", name: "Greece" };
const THE_OPENED_ONE = "Poland";

/** `--colour-accent-surface` and `--colour-surface-raised`, as the browser computes them. */
const OPEN_GROUND = "rgb(240, 253, 250)";
const NOT_MATCHING_GROUND = "rgb(252, 252, 253)";

/** 1280 is the narrowest the interface supports; 1560 is the design's own width. */
const WIDTHS = [1920, 1560, 1440, 1280] as const;

interface GateAnswer {
  match_result: "matching" | "not_matching";
  reason: string | null;
}

// `undefined` until the read succeeds, so a read that failed restores nothing (NEW-32).
let priorAnswer: GateAnswer | null | undefined;

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  await api.delete(`/v1/criteria-sets/${LAYOUT_SET}`);
  const made = await api.post(`/v1/criteria-sets/${SHIPPED_SOURCE}/duplicate`, {
    data: { id: LAYOUT_SET, name: LAYOUT_SET },
  });
  const already = made.status() === 409 && (await made.text()).includes("criteria_set_exists");
  expect(made.ok() || already, await made.text()).toBe(true);

  priorAnswer = await readTheGateAnswer(api);
  await answerTheGate(api, "not_matching", "Rank layout: recorded by the browser suite");
  await enforceTheGate(api, true);
  await api.dispose();
});

test.afterAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  // There is no delete for a gate answer, so one that was absent becomes the benign default.
  if (priorAnswer !== undefined) {
    await answerTheGate(
      api,
      priorAnswer?.match_result ?? "matching",
      priorAnswer?.reason ?? null,
    );
  }
  await enforceTheGate(api, false);
  await api.delete(`/v1/criteria-sets/${LAYOUT_SET}`);
  await api.dispose();
});

for (const width of WIDTHS) {
  test(`an open row and a not-matching row show their grounds at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openTheRanking(page);

    await rowOf(page, THE_OPENED_ONE)
      .getByRole("button", { name: THE_OPENED_ONE, exact: true })
      .click();
    await expect(
      rowOf(page, THE_OPENED_ONE).getByRole("button", { name: THE_OPENED_ONE, exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    // The pointer away, so the ground read is the state's and not the hover tint's.
    await page.mouse.move(0, 0);

    await expect(rowOf(page, THE_OPENED_ONE)).toHaveCSS("background-color", OPEN_GROUND);
    const excluded = rowOf(page, THE_EXCLUDED_ONE.name);
    await expect(excluded).toContainText("Not matching");
    await expect(excluded).toHaveCSS("background-color", NOT_MATCHING_GROUND);
  });
}

async function openTheRanking(page: Page): Promise<void> {
  await page.goto("/rank");
  await page.getByLabel("Active criteria set").selectOption(LAYOUT_SET);
  await expect(page.getByRole("table", { name: "Ranked candidates" })).toBeVisible();
  await expect(rowOf(page, THE_OPENED_ONE)).toBeVisible();
}

/** A candidate's own row: the one holding its toggle, not the evidence row under it. */
function rowOf(page: Page, name: string) {
  return page
    .getByRole("table", { name: "Ranked candidates" })
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}

async function readTheGateAnswer(request: APIRequestContext): Promise<GateAnswer | null> {
  const response = await request.get(`/v1/match-rule-results?candidate=${THE_EXCLUDED_ONE.id}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    items: { match_rule: string; match_result: string; reason: string | null }[];
  };
  const found = body.items.find((item) => item.match_rule === THE_GATE);
  return found
    ? { match_result: found.match_result as GateAnswer["match_result"], reason: found.reason }
    : null;
}

async function answerTheGate(
  request: APIRequestContext,
  result: GateAnswer["match_result"],
  reason: string | null,
): Promise<void> {
  const response = await request.put(
    `/v1/match-rule-results/${THE_GATE}/${THE_EXCLUDED_ONE.id}`,
    { data: { match_result: result, reason } },
  );
  expect(response.ok()).toBe(true);
}

async function enforceTheGate(request: APIRequestContext, enforced: boolean): Promise<void> {
  const response = await request.put(
    `/v1/criteria-sets/${LAYOUT_SET}/match-rules/${THE_GATE}`,
    { data: { is_enforced: enforced } },
  );
  expect(response.ok()).toBe(true);
}
