import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

/**
 * GATE C -- the product, driven by a browser (`devplan.md`).
 *
 * Seven requirements made executable. They run against the real stack: the real API, the real
 * database, the figures Gate B fetched. Nothing here imports from `src/`, and nothing asserts a
 * particular country's score -- the figures are Eurostat's and change when Eurostat publishes.
 * What must hold is that the product tells the truth about them.
 *
 * **Two of the seven describe states the shipped data does not reach on its own.** Nothing is
 * `not_matching` until a gate is enforced and answered, and nothing is `insufficient_data`
 * until a coverage floor is set -- both are decisions, not defaults (`reqs.md` 3.10). Those two
 * tests arrange the decision, assert what the screen says, and put it back.
 */

const SCORING_SET = "minimal";
const A_CRITERION = "country.housing_cost_overburden_rate";
const SHIPPED_WEIGHT = "50";
const A_DIFFERENT_WEIGHT = "75";

/** Eurostat publishes almost nothing for Liechtenstein, so it is where coverage runs thin. */
const THE_SPARSE_ONE = "Liechtenstein";
/** Any country will do for a gate; this one is neither first nor last in the ranking. */
const THE_EXCLUDED_ONE = { id: "country.greece", name: "Greece" };
const THE_GATE = "not_manually_excluded";

test.describe("the weight change, end to end", () => {
  // Both ends, not just the cleanup: a previous run that died between the change and its
  // restore would otherwise leave the weight already at the value this test moves it to, and
  // "the ranking did not change" would be the honest result of changing nothing.
  test.beforeEach(async ({ page }) => {
    await setCriterionWeight(page, A_CRITERION, SHIPPED_WEIGHT);
  });

  test.afterEach(async ({ page }) => {
    await setCriterionWeight(page, A_CRITERION, SHIPPED_WEIGHT);
  });

  test("moves one weight, rebalances its pillar to 100, and re-ranks", async ({ page }) => {
    const before = await rankedOrder(page);

    await page.goto("/configure");
    await chooseScoringSet(page);

    // The PATCH is the interaction the product turns on (`arch.md` 8.3): one weight goes out,
    // the whole rebalanced pillar comes back.
    const patch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" && response.url().includes("/criteria/"),
    );
    await setCriterionWeight(page, A_CRITERION, A_DIFFERENT_WEIGHT);
    expect((await patch).ok()).toBe(true);

    // Every weight in that pillar, as the table shows them after the response. A pillar that
    // does not sum to 100 is a broken score, and this is the screen the user is looking at.
    const pillar = await pillarOf(page, A_CRITERION);
    const total = (await weightsInPillar(page, pillar)).reduce((sum, each) => sum + each, 0);
    expect(total).toBeCloseTo(100, 2);

    expect(await rankedOrder(page)).not.toEqual(before);
  });
});

test.describe("provenance on a displayed number", () => {
  test("every figure names its source, what it describes and when it was fetched", async ({
    page,
  }) => {
    await openTheRanking(page);

    const row = page.getByRole("row").filter({ hasText: "Finland" }).first();
    await row.getByRole("button", { name: "Show figures" }).click();

    const figures = page.getByRole("table").filter({ hasText: "Fetched" });
    await expect(figures).toBeVisible();
    for (const column of ["Attribute", "Figure", "Source", "Describes", "Fetched", "Confidence"]) {
      await expect(figures.getByRole("columnheader", { name: column })).toBeVisible();
    }

    // Not merely that the columns exist: that the first figure actually fills them. A
    // provenance table with empty cells is the failure this requirement is about.
    const first = figures.getByRole("row").nth(1);
    const cells = await first.getByRole("cell").allTextContents();
    expect(cells.filter((text) => text.trim() !== "").length).toBeGreaterThanOrEqual(5);
  });
});

test.describe("a candidate a gate ruled out", () => {
  test.beforeEach(async ({ request }) => {
    await answerTheGate(request, "not_matching", "Gate C: recorded by the browser suite");
    await enforceTheGate(request, true);
  });

  test.afterEach(async ({ request }) => {
    await answerTheGate(request, "matching", null);
    await enforceTheGate(request, false);
  });

  test("stays in the table, keeps its score, loses its rank, and says why", async ({ page }) => {
    await openTheRanking(page);

    const row = page.getByRole("row").filter({ hasText: THE_EXCLUDED_ONE.name }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Not matching");
    await expect(row).toContainText("Gate C: recorded by the browser suite");

    // The score survives the gate (`reqs.md` 5.5): a candidate that led on merit and died on
    // one rule is visible as exactly that.
    await expect(row).not.toContainText("No score");
    const rank = await row.getByRole("cell").first().textContent();
    expect(rank?.trim()).toBe("—");
  });
});

test.describe("insufficient data", () => {
  // **Restored to whatever it was, never to null.** The floor is the household's decision
  // (`reqs.md` Q214, currently 60) and a suite that reset it to "unset" would quietly undo that
  // every time it ran -- a test with a side effect on the product's own configuration.
  let floorBefore: number | null = null;

  test.beforeEach(async ({ request }) => {
    floorBefore = await coverageFloor(request);
  });

  test.afterEach(async ({ request }) => {
    await setCoverageFloor(request, floorBefore);
  });

  test("is labelled and left unscored once a floor is set", async ({ page }) => {
    // Set through the product, because that is the claim: the floor is the household's to
    // choose and the screen is where it chooses it.
    await page.goto("/configure");
    const floor = page.getByLabel("Minimum coverage");
    await floor.fill("60");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await openTheRanking(page);
    const row = page.getByRole("row").filter({ hasText: THE_SPARSE_ONE }).first();

    await expect(row).toContainText("Insufficient data");
    await expect(row).toContainText("No score");
    // And it says why, in the figures it was judged on.
    await expect(row).toContainText(/floor of 60/);
  });
});

test.describe("switching criteria sets", () => {
  test("re-ranks from stored figures and fetches nothing", async ({ page }) => {
    const acquisition: string[] = [];
    const rankings: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      // A POST is a fetch being started; the sidebar's GET of the last run is a read of
      // history, and counting it would make this test fail for the wrong reason.
      if (url.includes("/v1/data-acquisition-runs") && request.method() === "POST") {
        acquisition.push(request.method() + " " + url);
      }
      if (url.includes("/v1/rankings")) rankings.push(url);
    });

    await openTheRanking(page);
    const before = await scoreOf(page, "Finland");

    await page.getByLabel("Active criteria set").selectOption("local_employment");
    await expect
      .poll(async () => await scoreOf(page, "Finland"), { timeout: 10_000 })
      .not.toBe(before);

    // The second ranking was computed, not fetched: scoring and acquisition are separate
    // operations, and a re-score that re-fetched would make every weight change cost money.
    expect(rankings.length).toBeGreaterThanOrEqual(2);
    expect(acquisition).toEqual([]);
  });
});

test.describe("a run", () => {
  test("is estimated before anything is fetched", async ({ page }) => {
    const started: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/v1/data-acquisition-runs")
      ) {
        started.push(request.url());
      }
    });

    await page.goto("/run");
    await page.getByRole("button", { name: "Estimate a run" }).click();

    const plan = page.getByRole("heading", { name: "What this run would do" });
    await expect(plan).toBeVisible();
    await expect(page.getByRole("table").filter({ hasText: "Source" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start this run" })).toBeVisible();

    // The estimate is an estimate. Nothing was started, which is the whole point of showing it.
    expect(started).toEqual([]);
  });

  test("can be opened from the history and reports what it did", async ({ page, request }) => {
    // Narrow on purpose: one candidate, one attribute. A full run asks every source about every
    // country, which is a real cost to pay for a test of a screen.
    const run = await startNarrowRun(request);

    await page.goto("/run");
    const row = page.getByRole("row").filter({ hasText: String(run) }).first();
    await row.getByRole("button", { name: "Open" }).click();

    const report = page.getByRole("heading", { name: `Run ${run}` });
    await expect(report).toBeVisible();
    // Scoped to the report: "completed" also appears in the history table below it.
    await expect(page.getByRole("definition").filter({ hasText: "completed" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  });
});

test.describe("a comparison", () => {
  test("shows the deltas and the synthesis, within one level", async ({ page }) => {
    await page.goto("/compare");
    await chooseScoringSet(page);

    await page.getByLabel("Focus").selectOption({ label: "Portugal" });
    await page.getByRole("checkbox", { name: "Spain" }).check();
    await page.getByRole("checkbox", { name: "Netherlands" }).check();
    await page.getByRole("button", { name: "Compare" }).click();

    await expect(page.getByRole("heading", { name: /Portugal against/ })).toBeVisible();

    // The synthesis is the server's sentences, ordered by what each difference is worth. The
    // test asserts that they are there and attributed, never what they say.
    const ahead = page.getByText("Ahead on").first();
    await expect(ahead).toBeVisible();

    const table = page.getByRole("table").filter({ hasText: "Attribute" });
    await expect(table.getByRole("columnheader", { name: "Portugal" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Spain" })).toBeVisible();

    // Never mixing levels (`reqs.md` 8.5): the roster offered is the selected level's, so a
    // city cannot appear beside a country even once cities exist.
    const offered = await page.getByRole("checkbox").allInnerTexts();
    expect(offered.every((name) => !name.includes("city."))).toBe(true);
  });
});

// --- the arrangements, all of them reversible ---------------------------------------------

async function chooseScoringSet(page: Page): Promise<void> {
  await page.getByLabel("Active criteria set").selectOption(SCORING_SET);
}

async function openTheRanking(page: Page): Promise<void> {
  await page.goto("/rank");
  await chooseScoringSet(page);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Finland" })).toHaveCount(1);
}

async function rankedOrder(page: Page): Promise<string[]> {
  await openTheRanking(page);
  return page.getByRole("table").getByRole("row").allTextContents();
}

async function scoreOf(page: Page, country: string): Promise<string> {
  const row = page.getByRole("row").filter({ hasText: country }).first();
  const cells = await row.getByRole("cell").allTextContents();
  return cells[1] ?? "";
}

async function setCriterionWeight(page: Page, attribute: string, weight: string): Promise<void> {
  await page.goto("/configure");
  await chooseScoringSet(page);
  const input = page.getByRole("spinbutton", { name: `Weight for ${attribute}` });
  await input.waitFor();
  if ((await input.inputValue()) === weight) return;

  await input.fill(weight);
  await page
    .getByRole("row")
    .filter({ hasText: attribute })
    .getByRole("button", { name: "Save" })
    .click();
  await expect(input).toHaveValue(weight);
}

async function pillarOf(page: Page, attribute: string): Promise<string> {
  const row = page.getByRole("row").filter({ hasText: attribute }).first();
  const cells = await row.getByRole("cell").allTextContents();
  return (cells[0] ?? "").trim();
}

async function weightsInPillar(page: Page, pillar: string): Promise<number[]> {
  const rows = await page.getByRole("row").filter({ hasText: pillar }).all();
  const weights: number[] = [];
  for (const row of rows) {
    const input = row.getByRole("spinbutton");
    if ((await input.count()) === 0) continue;
    weights.push(Number(await input.inputValue()));
  }
  return weights;
}

async function answerTheGate(
  request: APIRequestContext,
  result: "matching" | "not_matching",
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
    `/v1/criteria-sets/${SCORING_SET}/match-rules/${THE_GATE}`,
    { data: { is_enforced: enforced } },
  );
  expect(response.ok()).toBe(true);
}

async function coverageFloor(request: APIRequestContext): Promise<number | null> {
  const settings = (await (await request.get("/v1/settings")).json()) as {
    min_coverage: number | null;
  };
  return settings.min_coverage;
}

/** The floor is the household's decision, so the suite leaves it exactly as it found it. */
async function setCoverageFloor(request: APIRequestContext, floor: number | null): Promise<void> {
  const current = await (await request.get("/v1/settings")).json();
  const response = await request.put("/v1/settings", {
    data: { ...current, min_coverage: floor },
  });
  expect(response.ok()).toBe(true);
}

async function startNarrowRun(request: APIRequestContext): Promise<number> {
  const response = await request.post("/v1/data-acquisition-runs", {
    data: {
      level: "country",
      candidates: ["country.portugal"],
      attributes: [A_CRITERION],
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: number }).id;
}
