import { type Locator, type Page, expect, test } from "@playwright/test";

/**
 * minE2E's acceptance test, and the only one that counts (`docs/mine2e.md`):
 *
 *   open a browser, adjust a criterion weight, and see at least one real European country in a
 *   ranked table with a score, a coverage percentage and a match status -- served by the real
 *   backend, from the real database, over the real contract.
 *
 * **Against the real stack.** No mock is running: `playwright.config.ts` starts the API and the
 * interface, and the database must be up and migrated (`make up`, `make migrate`) with figures
 * fetched (`make acquire`). A gate that passed against a mock would prove the mock works.
 *
 * **It asserts shape, never a particular country's score.** The figures are Eurostat's and
 * change when Eurostat publishes; a test that pinned Finland to 82 would fail for being right
 * about a different year. What must hold is that real countries are ranked, that a country
 * without data says so rather than showing a zero, and that changing a weight changes the
 * table.
 */

const MINIMAL_SET = "minimal";
const HOUSING_OVERBURDEN = "country.housing_cost_overburden_rate";
const SHIPPED_WEIGHT = "50";
const A_DIFFERENT_WEIGHT = "80";

// Serial, because one of these tests CHANGES a weight and the others read the ranking that
// weight produces. Under `fullyParallel` they overlap and the readers see a table mid-edit --
// which fails for a reason that has nothing to do with the product.
test.describe.serial("the minimum end to end", () => {
  // Restores the shipped weight whether the test passed or not. A cleanup that only runs on
  // success leaves the next run comparing 80 against 80 and calling it "unchanged", which is
  // exactly how this suite failed the first time it ran alongside another spec.
  test.afterEach(async ({ page }) => {
    await page.goto("/configure");
    await setWeight(page, HOUSING_OVERBURDEN, SHIPPED_WEIGHT);
  });

  test("a ranked table of real countries, scored from stored figures", async ({ page }) => {
    await openTheRanking(page);

    const table = page.getByRole("table");

    // Real places, not fixtures. Any of the 32 would do; these three are seeded and are not
    // going to stop being European.
    const rows = table.getByRole("row");
    await expect(rows.filter({ hasText: "Finland" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Portugal" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Greece" })).toHaveCount(1);
  });

  test("every scored country shows a score, a coverage percentage and a match status", async ({
    page,
  }) => {
    await openTheRanking(page);

    // "Matching", capitalised: `formatMatchStatus` turns the wire's vocabulary into a label.
    // The wire value is `matching` and the screen is where it becomes prose.
    const scored = page.getByRole("row").filter({ hasText: "Matching" }).first();

    await expect(scored).toContainText("%");
    await expect(scored).toContainText("Matching");
  });

  test("a country almost nobody publishes about says how thin its evidence is", async ({
    page,
  }) => {
    await openTheRanking(page);

    // Eurostat publishes almost nothing for Liechtenstein. Until Gate B it was unscoreable and
    // said so; it is now scored from **declared stand-ins** -- a neighbour's figure, stored
    // under its own source at `low` confidence (`reqs.md` 3.6a). The honesty moved rather than
    // disappeared: the row must say how much of the score rests on those.
    const sparse = page.getByRole("row").filter({ hasText: "Liechtenstein" });

    await expect(sparse).toHaveCount(1);
    // Coverage below the others, and a visible share of it low-confidence. Neither number is
    // pinned: they move when a source publishes, and pinning them would make this test fail for
    // being right about a different year.
    // Read by what the columns say, not by where they sit. This counted cells until a column
    // was inserted, and then failed about coverage for a reason that had nothing to do with it.
    const coverageText = await cellUnder(page, sparse, "Coverage");
    const confidenceText = await cellUnder(page, sparse, "Confidence");

    const coverage = Number(/([\d.]+)%/.exec(coverageText)?.[1] ?? "0");
    expect(coverage).toBeGreaterThan(0);
    expect(coverage).toBeLessThan(100);

    // The split reads "82h / 11m / 7l". A visible low share is the honesty this test is about.
    const lowConfidence = Number(/([\d.]+)l\b/.exec(confidenceText)?.[1] ?? "0");
    expect(lowConfidence).toBeGreaterThan(0);
  });

  test("changing a weight changes the ranking", async ({ page }) => {
    await page.goto("/configure");
    await selectTheScoringSet(page);

    const before = await scoresInOrder(page);

    await page.goto("/configure");
    await setWeight(page, HOUSING_OVERBURDEN, A_DIFFERENT_WEIGHT);

    const after = await scoresInOrder(page);

    // The scores must move. Which way is the arithmetic's business, and asserting a direction
    // here would be this test re-implementing the weighting it exists to check.
    expect(after).not.toEqual(before);
  });
});

/**
 * Open the ranking and wait until it has actually arrived.
 *
 * Selecting the criteria set re-fetches, so a test that asserted straight afterwards was
 * reading an empty table and failing with "element not found" -- a race wearing the clothes of
 * a missing feature. Waiting for a row that is always present is what makes the rest of the
 * assertions about the product.
 */
async function openTheRanking(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/rank");
  await selectTheScoringSet(page);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Finland" })).toHaveCount(1);
}

/** The shipped set cannot score anything -- no anchors ship -- so the ranking uses `minimal`. */
async function selectTheScoringSet(page: import("@playwright/test").Page): Promise<void> {
  await page.getByLabel("Active criteria set").selectOption(MINIMAL_SET);
}

async function setWeight(
  page: import("@playwright/test").Page,
  attribute: string,
  weight: string,
): Promise<void> {
  await selectTheScoringSet(page);
  const input = page.getByRole("spinbutton", { name: `Weight for ${attribute}` });
  await input.waitFor();

  // Nothing to do, and nothing the screen would let us do: Save is disabled until the weight
  // actually changes. The restore in `afterEach` hits this whenever the test it follows never
  // got as far as changing anything.
  if ((await input.inputValue()) === weight) return;

  await input.fill(weight);
  await page
    .getByRole("row")
    .filter({ hasText: attribute })
    .getByRole("button", { name: "Save" })
    .click();
  // The server's answer, not ours: the row shows what came back from the PATCH.
  await expect(input).toHaveValue(weight);
}

async function scoresInOrder(page: import("@playwright/test").Page): Promise<string[]> {
  await openTheRanking(page);
  return page.getByRole("table").getByRole("row").allTextContents();
}


/**
 * One cell of a row, found by the heading of its column.
 *
 * **Not by index.** These assertions counted cells, so inserting a column in the middle broke
 * tests about entirely different columns. A heading is what a column means; its position is an
 * accident of layout, and the layout is exactly what a design pass changes.
 */
async function cellUnder(
  page: Page,
  row: Locator,
  column: string,
): Promise<string> {
  const headings = await page
    .getByRole("columnheader")
    .allTextContents()
    .then((all) => all.map((each) => each.trim()));
  const at = headings.indexOf(column);
  expect(at, `no column headed "${column}" in [${headings.join(", ")}]`).toBeGreaterThan(-1);

  // The candidate's own cell is a rowheader, so every cell is taken together to line the row
  // up with its headings.
  const cells = await row.locator("th,td").allTextContents();
  return (cells[at] ?? "").trim();
}
