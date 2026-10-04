import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
/** Where the API lives for these setup calls -- the same origin the config gives the browser. */
const BASE_URL = process.env["UI_ORIGIN"] ?? "http://localhost:5173";


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

/**
 * A criteria set this spec owns outright, duplicated from `minimal` before the first test
 * and deleted after the last.
 *
 * **Sharing one was the flake.** This spec and `minimum-end-to-end.spec.ts` both moved the same criterion in
 * `minimal` and then asserted on the whole ranking, so each could land inside the other's
 * before-and-after. Restoring what they found made that rarer; owning the set removes it. A
 * set is a full copy, never a sparse overlay (`reqs.md` Q191), so a duplicate is a complete
 * and independent opinion about the same attributes -- which is what a mutating test needs
 * and what sharing cannot give it.
 */
const SCORING_SET = "e2e_gate_c";
const SHIPPED_SOURCE = "minimal";

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL });
  await api.delete(`/v1/criteria-sets/${SCORING_SET}`);
  const made = await api.post(`/v1/criteria-sets/${SHIPPED_SOURCE}/duplicate`, {
    data: { id: SCORING_SET, name: SCORING_SET },
  });
  // **A set left by an earlier run of this spec is this spec's set.** The delete above is
  // refused once anything has saved a ranking from it -- an evaluation holds its criteria set
  // by foreign key, which is the point of freezing them -- so a run that saved one leaves the
  // set behind for good. Insisting on a fresh copy would make the suite fail for ever after
  // the first save. `beforeEach` puts the weight back regardless, which is what actually
  // makes each test independent.
  const already = made.status() === 409 && (await made.text()).includes("criteria_set_exists");
  expect(made.ok() || already, await made.text()).toBe(true);
  await api.dispose();
});

test.afterAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: BASE_URL });
  await api.delete(`/v1/criteria-sets/${SCORING_SET}`);
  await api.dispose();
});
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

    // **A target different from whatever is there, and put back afterwards.** This set a fixed
    // 75 and restored nothing, while minE2E moved the same criterion to a fixed 80 and restored
    // to a constant -- so whichever ran second eventually found the weight already at its
    // target, changed nothing, and failed asserting that the ranking had changed. A test that
    // only works on a clean database is a test that works once.
    const shipped = await currentWeight(page, A_CRITERION);
    const target = shipped === A_DIFFERENT_WEIGHT ? "70" : A_DIFFERENT_WEIGHT;

    // The PATCH is the interaction the product turns on (`arch.md` 8.3): one weight goes out,
    // the whole rebalanced pillar comes back.
    const patch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" && response.url().includes("/criteria/"),
    );
    await setCriterionWeight(page, A_CRITERION, target);
    expect((await patch).ok()).toBe(true);

    // Every weight in that pillar, as the table shows them after the response. A pillar that
    // does not sum to 100 is a broken score, and this is the screen the user is looking at.
    const total = (await weightsInPillar(page, A_CRITERION)).reduce(
      (sum, each) => sum + each,
      0,
    );
    expect(total).toBeCloseTo(100, 2);

    expect(await rankedOrder(page)).not.toEqual(before);

    // Left as it was found, so the next run starts where this one did.
    await page.goto("/configure");
    await setCriterionWeight(page, A_CRITERION, shipped);
  });
});

test.describe("provenance on a displayed number", () => {
  test("every figure names its source, what it describes and when it was fetched", async ({
    page,
  }) => {
    await openTheRanking(page);

    // The candidate's name is the toggle: the whole row opens, and the name is what a
    // keyboard reaches.
    const row = page.getByRole("row").filter({ hasText: "Finland" }).first();
    await row.getByRole("button", { name: "Finland" }).click();

    // **Named, not filtered.** The evidence opens inside the ranking table now, so the outer
    // table contains the word "Fetched" too and a filter matches both.
    const figures = page.getByRole("table", { name: /every stored value/i });
    await expect(figures).toBeVisible();

    // **The facts, not the column headings.** The requirement is that every figure names its
    // source, the period it describes and when it was fetched -- and those are now stacked
    // under the attribute they belong to rather than being three columns of their own, which
    // is a layout decision and not a change to what is claimed.
    const first = figures.getByRole("row").nth(1);
    for (const fact of ["Source", "Describes", "Fetched"]) {
      await expect(first.getByText(fact, { exact: true })).toBeVisible();
    }

    // Not merely that the labels exist: that the first figure actually fills them. A
    // provenance table with empty cells is the failure this requirement is about.
    const written = await first.allInnerTexts();
    const lines = written
      .join("\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(lines.length).toBeGreaterThanOrEqual(5);
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
    // The caret that says the row opens shares the cell and is not part of the reading.
    const rank = await row.getByRole("cell").first().textContent();
    expect(rank?.replace(/[\u25B8\u25BE]/g, "").trim()).toBe("—");
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

    await page.goto("/acquire");
    await page.getByRole("button", { name: "Estimate an acquisition" }).click();

    // **The figures sit inside the card that asked for them.** Three remedies stand side by
    // side, and an estimate under the row of them cannot say which of the three it is about.
    const card = page.getByRole("region", {
      name: /An acquisition over every country candidate/,
    });
    await expect(card.getByText("At most")).toBeVisible();
    await expect(card.getByText("Paid calls")).toBeVisible();
    // **Named, not filtered.** The last acquisition's report opens with the screen now, and
    // its per-source breakdown names each source.
    await expect(page.getByRole("table", { name: /per source/i })).toBeVisible();
    await expect(card.getByRole("button", { name: "Start this acquisition" })).toBeVisible();

    // The estimate is an estimate. Nothing was started, which is the whole point of showing it.
    expect(started).toEqual([]);
  });

  test("can be opened from the history and reports what it did", async ({ page, request }) => {
    // Narrow on purpose: one candidate, one attribute. A full run asks every source about every
    // country, which is a real cost to pay for a test of a screen.
    const run = await startNarrowRun(request);

    await page.goto("/acquire");
    const row = page.getByRole("row").filter({ hasText: String(run) }).first();
    // The acquisition's own number is what opens it, as the design has it.
    await row.getByRole("button", { name: String(run) }).click();

    // **The region, not the heading.** The card is headed by its *state* -- "Acquiring now",
    // "Acquisition finished", "Acquisition did not finish" -- as the design has it, so the
    // number is on the line beneath and in the region's accessible name. The region is what
    // the rest of this test already reads.
    await expect(page.getByRole("region", { name: `Acquisition ${run}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

    // **Polled, because a run no longer finishes before the request returns.** P35 made the
    // 202 true: `POST /data-acquisition-runs` opens the run and hands the fetching to a
    // background task, so the screen shows `running` first and `completed` when it is. This
    // asserted the end state immediately and passed only while the endpoint blocked -- the
    // refresh button beside it exists for exactly this.
    // Scoped to the card, which carries the status as a pill beside its heading. Read off the
    // whole card rather than one node: the status is a word in the design's own shape, and a
    // test that pinned which element holds it would break on the next time it moves.
    const card = page.getByRole("region", { name: `Acquisition ${run}` });
    await expect
      .poll(async () => {
        await page.getByRole("button", { name: "Refresh" }).click();
        return card.textContent();
      }, { timeout: 30_000, message: "the run never reported a terminal status" })
      .toMatch(/completed|failed|halted/);
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
  await expect(page.getByRole("table", { name: "Ranked candidates" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Finland" })).toHaveCount(1);
}

async function rankedOrder(page: Page): Promise<string[]> {
  await openTheRanking(page);
  return page.getByRole("table", { name: "Ranked candidates" }).getByRole("row").allTextContents();
}

/**
 * A country's score, read by the heading of its column.
 *
 * **It read `cells[1]`, and `cells[1]` stopped being the score.** A `Pillars` column was
 * inserted before it, so this returned the pillar chart's tooltip text instead -- which differs
 * between criteria sets often enough that the test went on passing, and failed about one run in
 * three when two sets happened to weight their pillars alike. A heading cannot drift like that.
 */
async function scoreOf(page: Page, country: string): Promise<string> {
  // **Waits for the table rather than asserting on it.** Switching criteria sets replaces the
  // table with "Loading…" for a beat, so a read taken mid-swap saw no columns at all -- and
  // asserting there aborted the poll that was meant to tolerate exactly this.
  await page.getByRole("columnheader", { name: "Score", exact: true }).waitFor();
  const headings = (await page.getByRole("columnheader").allTextContents()).map((each) =>
    each.trim(),
  );
  const at = headings.indexOf("Score");

  const row = page.getByRole("row").filter({ hasText: country }).first();
  // Taken together with the rowheader, so the row lines up with its headings.
  // **Visible cells only.** A column hidden at a narrow width leaves the accessibility tree
  // but stays in the DOM, so the headings and the cells would count differently and every
  // lookup would be off by one.
  const cells = await row.locator("th:visible, td:visible").allTextContents();
  return (cells[at] ?? "").trim();
}

/** What a criterion's weight is right now, so a test can move it somewhere else. */
/**
 * Opens the pillar an attribute is weighed inside, and names it.
 *
 * **A criterion's weight is a share of its pillar's**, so the screen keeps it there and the
 * way to reach one is to open the pillar. Which pillar holds what belongs to the catalog, so
 * this looks rather than carrying a copy of it.
 */
async function openPillarOf(page: Page, attribute: string): Promise<string> {
  const weight = page.getByRole("slider", { name: `Weight for ${attribute}` });
  const weights = page.getByRole("region", { name: "Pillar weights" });
  // **`all()` does not wait.** It reads the rows that exist at this instant, and the criteria
  // set is still in flight when a test has just navigated -- so the list comes back empty and
  // the scan below concludes no pillar holds anything.
  await weights.getByRole("group").first().waitFor({ state: "visible" });
  // **Names, never indices.** `all()` hands back `nth(i)` locators resolved when they are
  // used, and opening a pillar inserts its attribute rows into the same region -- so every
  // index after the one just opened addresses something else. The scan below opens pillars as
  // it goes, which is exactly the mutation that invalidates them. Each row is addressed by its
  // accessible name instead, which survives the insertion. (`sanity.spec.ts` carries the same
  // warning for the ranked table, where opening a row inserts its evidence.)
  const names: string[] = [];
  for (const row of await weights.getByRole("group").all()) {
    names.push((await row.getAttribute("aria-label")) ?? "");
  }

  // **The likely pillar first.** An attribute is usually named after the pillar it is in --
  // `country.housing_cost_overburden_rate` is housing -- so trying that one first turns a scan
  // of eleven into a single click. It is a shortcut, not a rule: anything it misses is found
  // by the scan that follows, which is why the pillar is never written down here.
  //
  // **Compared without case.** The attribute is a catalog id and the pillar is now a display
  // name -- `housing` against "Housing" -- so a case-sensitive test matched nothing the day
  // `0484` gave the pillars real names, and the shortcut silently stopped shortening anything.
  names.sort(
    (left, right) =>
      Number(attribute.includes(right.toLowerCase())) -
      Number(attribute.includes(left.toLowerCase())),
  );

  for (const pillar of names) {
    const row = weights.getByRole("group", { name: pillar, exact: true });
    const opener = row.getByRole("button", { name: new RegExp(`^${pillar}`) });
    if ((await opener.getAttribute("aria-expanded")) !== "true") {
      await opener.click();
    }
    // **Waited for, not counted.** `count()` reads the DOM as it is; opening a pillar is a
    // render away, so a bare count says "not here" for a pillar that is about to hold it.
    try {
      await weight.waitFor({ state: "visible", timeout: 1200 });
      return pillar;
    } catch {
      // Not this pillar. Try the next.
    }
  }
  throw new Error(`no pillar on screen holds ${attribute}`);
}

async function currentWeight(page: Page, attribute: string): Promise<string> {
  await openPillarOf(page, attribute);
  const input = page.getByRole("slider", { name: `Weight for ${attribute}` });
  await input.waitFor();
  return input.inputValue();
}

async function setCriterionWeight(page: Page, attribute: string, weight: string): Promise<void> {
  await page.goto("/configure");
  await chooseScoringSet(page);
  await openPillarOf(page, attribute);
  // **A slider that commits on release**, as the design draws it. There is no Save: letting
  // go is the save, so the gesture is a fill followed by the pointer coming up.
  const input = page.getByRole("slider", { name: `Weight for ${attribute}` });
  await input.waitFor();
  if ((await input.inputValue()) === weight) return;

  await input.fill(weight);
  await input.dispatchEvent("pointerup");
  await expect(input).toHaveValue(weight);
}

/**
 * Every weight inside one pillar, read from the block the pillar opens.
 *
 * **Read from inside the pillar, not by filtering rows that mention its name.** The pillar is
 * now the row above these rather than a column repeated down each of them, which is exactly
 * why the block is the right place to count.
 */
async function weightsInPillar(page: Page, attribute: string): Promise<number[]> {
  await openPillarOf(page, attribute);
  const inside = page.getByRole("region", {
    name: "Attribute weights inside this pillar",
  });
  const inputs = await inside.getByRole("slider").all();
  const weights: number[] = [];
  for (const input of inputs) {
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
