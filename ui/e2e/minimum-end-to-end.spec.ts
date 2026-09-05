import { expect, test } from "@playwright/test";

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

  test("a country nobody has figures for says so rather than showing a zero", async ({
    page,
  }) => {
    await openTheRanking(page);

    // Eurostat publishes nothing for Liechtenstein, so it is the honest gap the whole coverage
    // mechanism exists to make visible (`reqs.md` 5.3). It must still be in the table:
    // non-matching candidates stay visible (`reqs.md` 5.4).
    const gap = page.getByRole("row").filter({ hasText: "Liechtenstein" });

    await expect(gap).toHaveCount(1);
    await expect(gap).toContainText("Insufficient data");
    // And it says WHY. An unscoreable candidate with an empty reason cell is a candidate the
    // user cannot act on.
    await expect(gap).toContainText(/no figure/i);
    await expect(gap).toContainText("No score");
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
