import { type Locator, type Page, expect, test } from "@playwright/test";

/**
 * The functional sanity suite: do the main flows still work?
 *
 * **Written after a design pass, because of what one costs.** Reproducing `Starnest Product`
 * moved the tabs out of the sidebar, turned cells into chips and bars, inserted two columns and
 * restyled every control. The unit suite stayed green throughout and three end-to-end tests did
 * not -- one because a checkbox had been made unclickable, two because they counted table cells
 * by position. Neither fault is visible in a component test, and both would have reached a
 * person using the application.
 *
 * So this suite walks the product the way somebody would, and asserts only what the product
 * *does*: that a tab opens a screen, a weight saves, a ranking ranks, a drill-down discloses,
 * a comparison compares. It is deliberately indifferent to how any of it looks.
 *
 * **Three rules, each from a bug this session actually produced:**
 *
 * 1. **Find by role and accessible name, never by class or position.** A class is styling and a
 *    position is layout; both are what a redesign changes.
 * 2. **Read a table cell by its column's heading.** Inserting a column must not fail a test
 *    about a different column.
 * 3. **Drive the real control.** Click the input a user clicks, not a wrapper -- that is what
 *    catches a control that has been made to look right and stopped working.
 *
 * It runs against the real stack, like every spec here. Nothing is mocked and no number is
 * pinned: figures move when a publisher publishes, and a test that pinned them would fail for
 * being right about a different year.
 */

const TABS = ["Configure", "Acquire", "Rank", "Compare"] as const;

test.describe("the shell", () => {
  test("opens each tab, and each one renders its own screen", async ({ page }) => {
    await page.goto("/configure");

    for (const tab of TABS) {
      await page.getByRole("link", { name: tab, exact: true }).click();
      await expect(
        page.getByRole("heading", { level: 2, name: tab, exact: true }),
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/${tab.toLowerCase()}$`));
    }
  });

  test("keeps the selection while moving between tabs", async ({ page }) => {
    await page.goto("/rank");
    const set = page.getByRole("combobox", { name: "Active criteria set" });
    // The catalog arrives after the first render, so the value is read once it is there.
    // Reading it earlier compares "" against whatever loaded, and fails about the wrong thing.
    await expect.poll(() => set.inputValue()).not.toBe("");
    const chosen = await set.inputValue();

    await page.getByRole("link", { name: "Compare", exact: true }).click();
    await page.getByRole("link", { name: "Rank", exact: true }).click();

    // A selection that reset on navigation would silently re-rank under the reader.
    await expect(set).toHaveValue(chosen);
  });
});

test.describe("the ranking", () => {
  test("ranks real candidates, each with a score and a match status", async ({
    page,
  }) => {
    await page.goto("/rank");
    const rows = page.getByRole("row");
    await expect.poll(() => rows.count()).toBeGreaterThan(5);

    const first = rows.nth(1);
    // The answer itself: who, how well, and whether it is even in the running.
    expect(await cellUnder(page, first, "Rank")).not.toBe("");
    expect(Number(await cellUnder(page, first, "Score"))).toBeGreaterThan(0);
    expect(await cellUnder(page, first, "Match status")).toMatch(
      /Matching|Not matching|Insufficient data/,
    );
    // Coverage is the disclosure that stops a score being read as certainty.
    expect(await cellUnder(page, first, "Coverage")).toMatch(/%/);
  });

  test("opens a candidate's figures, and closes them again", async ({
    page,
  }) => {
    await page.goto("/rank");
    const open = page.getByRole("button", { name: "Show figures" }).first();
    await open.click();

    // The provenance chain: the figures behind the score, and what each one is.
    await expect(
      page.getByRole("heading", { name: /every figure behind the score/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Source" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Hide figures" }).first().click();
    await expect(
      page.getByRole("heading", { name: /every figure behind the score/ }),
    ).toHaveCount(0);
  });
});

test.describe("configuring", () => {
  test("saves a settings change and reads it back", async ({ page }) => {
    await page.goto("/configure");
    // A textbox rather than a spinbutton: the field takes a decimal by `inputMode`, not a
    // number input with its stepper.
    const cap = page.getByRole("textbox", { name: /Run spend cap/ });
    await expect.poll(() => cap.inputValue()).not.toBe("");
    const before = await cap.inputValue();
    const after = before === "12" ? "13" : "12";

    await cap.fill(after);
    await page.getByRole("button", { name: "Save settings" }).click();

    await page.reload();
    await expect(cap).toHaveValue(after);

    // Left as it was found: a sanity test that edits the household's own settings and walks
    // away has changed the thing it was checking.
    await cap.fill(before);
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(cap).toHaveValue(before);
  });
});

test.describe("saved rankings", () => {
  /**
   * A ranking is recomputed on every request, so it moves as weights move -- which is why
   * keeping one is a deliberate act rather than a side effect of looking.
   *
   * **This leaves a row behind.** The contract has no `DELETE /evaluations`, deliberately: a
   * saved evaluation is a measurement somebody chose to keep, not a draft. So this test
   * marks what it creates rather than tidying it away.
   */
  test("keeps a ranking, lists it, and opens it again", async ({ page }) => {
    await page.goto("/rank");
    const panel = page.getByRole("region", { name: "Saved rankings" });
    const save = panel.getByRole("button", { name: "Save this ranking" });
    await expect(save).toBeEnabled();

    const note = `sanity suite ${Date.now()}`;
    await panel.getByRole("textbox", { name: /worth keeping/ }).fill(note);
    await save.click();

    const entry = panel.getByRole("listitem").filter({ hasText: note });
    await expect(entry).toHaveCount(1);

    await entry.getByRole("button", { name: "Open" }).click();
    // Frozen: the criteria and the score scale were copied with it, so it keeps meaning what
    // it meant even after a weight moves.
    await expect(panel.getByText(/As it was when it was saved/)).toBeVisible();
    await expect(
      panel.getByRole("table", { name: "Ranked candidates" }),
    ).toBeVisible();
  });

  test("opens several candidates' figures at once", async ({ page }) => {
    await page.goto("/rank");
    const open = page.getByRole("button", { name: "Show figures" });
    await open.first().click();
    // The second button, because the first has become "Hide figures".
    await page.getByRole("button", { name: "Show figures" }).first().click();

    await expect(
      page.getByRole("heading", { name: /every figure behind the score/ }),
    ).toHaveCount(2);
  });
});

test.describe("criteria sets", () => {
  test("duplicates a set as a full copy, then discards the copy", async ({
    page,
  }) => {
    await page.goto("/configure");
    const sets = page.getByRole("region", { name: "Criteria sets" });
    const id = `sanity_copy_${Date.now()}`;

    await sets
      .getByRole("textbox", { name: /Identifier for a copy of/ })
      .fill(id);
    await sets.getByRole("textbox", { name: /Name for the copy/ }).fill(id);
    await sets.getByRole("button", { name: /^Duplicate / }).click();

    const chosen = page.getByRole("combobox", { name: "Active criteria set" });
    await expect(chosen).toHaveValue(id);

    // A copy is a full set, never a sparse overlay (`reqs.md` Q191), so it must arrive with
    // criteria rather than empty like a newly created one.
    await expect(
      page.getByRole("region", { name: "Criteria" }).getByRole("row"),
    ).not.toHaveCount(1);

    // Left as it was found: the copy exists only for this test.
    await sets.getByRole("button", { name: `Discard ${id}` }).click();
    await expect(chosen).not.toHaveValue(id);
  });

  test("locks a criterion's weight and unlocks it again", async ({ page }) => {
    await page.goto("/configure");
    const criteria = page.getByRole("region", { name: "Criteria" });
    const lock = criteria.getByRole("checkbox").first();

    const before = await lock.isChecked();

    // **`click()` and then poll, never `setChecked()`.** This checkbox is controlled: it
    // flips only once the PATCH resolves, and `setChecked` asserts the new state the moment
    // it has clicked, so it throws "did not change its state" while the request is still in
    // flight. `toBeChecked` retries, which is what a server-backed toggle needs.
    //
    // Rule 3 of this suite still holds -- clicking is driving the real control. It was
    // `setChecked`'s impatience that did not fit, not the control.
    await lock.click();
    await expect(lock).toBeChecked({ checked: !before });

    await lock.click();
    await expect(lock).toBeChecked({ checked: before });
  });

  test("shows what each pillar's criteria come to", async ({ page }) => {
    await page.goto("/configure");
    const totals = page.getByRole("list", {
      name: "Weight totals by pillar",
    });

    await expect(totals).toBeVisible();
    // Weights sum to 100 within a pillar; the screen shows the rule holding.
    await expect(totals.getByRole("listitem").first()).toContainText("100");
  });
});

test.describe("a setting nobody has decided", () => {
  /**
   * Deliberately the **comparator limit** and not the score scale. Both may be unset, but an
   * unset score scale stops the whole product ranking -- and a sanity test that blocked the
   * application for the duration, or left it blocked if it failed halfway, would be a worse
   * fault than the one it was checking for.
   */
  test("says what a blank setting costs, then takes it back", async ({
    page,
  }) => {
    await page.goto("/configure");
    const limit = page.getByRole("textbox", { name: /Comparator limit/ });
    await expect.poll(() => limit.inputValue()).not.toBe("");
    const before = await limit.inputValue();

    await limit.fill("");
    await expect(
      page.getByText(/A comparison accepts as many comparators as you pick/),
    ).toBeVisible();
    await expect(limit).toHaveAttribute("placeholder", "Not set");

    await limit.fill(before);
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(limit).toHaveValue(before);
  });
});

test.describe("a run", () => {
  test("can be estimated without fetching anything", async ({ page }) => {
    await page.goto("/acquire");
    await page.getByRole("button", { name: /Estimate a run/ }).click();

    // The estimate is the whole point: what it would cost, before it costs it.
    await expect(
      page.getByRole("heading", { name: /What this run would do/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Start this run/ }),
    ).toBeEnabled();
  });

  test("lists past runs with what each one did", async ({ page }) => {
    await page.goto("/acquire");
    const history = page.getByRole("table").last();

    await expect(history.getByRole("row")).not.toHaveCount(0);
    await expect(
      history.getByRole("columnheader", { name: "Status" }),
    ).toBeVisible();
  });
});

test.describe("a comparison", () => {
  test("compares a focus against comparators and explains the difference", async ({
    page,
  }) => {
    await page.goto("/compare");

    const focus = page.getByRole("combobox", { name: "Focus" });
    // The roster is fetched, so there is one placeholder option until it lands.
    await expect.poll(() => focus.locator("option").count()).toBeGreaterThan(1);
    const options = await focus.locator("option").allTextContents();
    const chosen = options.find((each) => !each.startsWith("Choose"));
    expect(chosen, "the roster is empty, so there is nothing to compare").toBeDefined();
    await focus.selectOption({ label: chosen! });

    // **The real checkbox, not its label.** Making the input unclickable is precisely the bug
    // this suite exists to catch, and clicking the wrapper would have hidden it.
    const comparator = page.getByRole("checkbox").first();
    await comparator.check();
    await expect(comparator).toBeChecked();

    await page.getByRole("button", { name: "Compare", exact: true }).click();

    await expect(page.getByText("Ahead on").first()).toBeVisible();
    await expect(page.getByText("Behind on").first()).toBeVisible();
  });
});

/**
 * One cell of a row, found by the heading of its column.
 *
 * **Not by index.** Counting cells is what broke three tests when a column was inserted: each
 * failed about a column the change had not touched. A heading is what a column means; where it
 * sits is an accident of layout, and layout is what a design pass changes.
 */
async function cellUnder(
  page: Page,
  row: Locator,
  column: string,
): Promise<string> {
  const headings = (await page.getByRole("columnheader").allTextContents()).map(
    (each) => each.trim(),
  );
  const at = headings.indexOf(column);
  expect(
    at,
    `no column headed "${column}" in [${headings.join(", ")}]`,
  ).toBeGreaterThan(-1);

  // The candidate's own cell is a rowheader rather than a cell, so every cell is read together
  // to line the row up with its headings.
  // **Visible cells only.** A column hidden at a narrow width leaves the accessibility tree
  // but stays in the DOM, so headings and cells would count differently.
  const cells = await row.locator("th:visible, td:visible").allTextContents();
  return (cells[at] ?? "").trim();
}
