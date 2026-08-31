import { expect, test } from "@playwright/test";

/**
 * A smoke test, and only that: the app boots, the four routes render, and the sidebar shows
 * the configured display name.
 *
 * **This spec is scaffolding.** End-to-end tests belong to the master agent (`devplan.md`
 * §0.2), and this one is replaced at Gate A by a suite written from `reqs.md` against the real
 * backend. Its job until then is to prove the Playwright harness runs at all -- a harness
 * discovered to be broken at a gate is discovered too late.
 *
 * It runs against the msw mock (`npm run dev:mock`), which is why it asserts that screens
 * appear rather than what any number on them is. A gate that passed against a mock would
 * prove the mock works.
 */

const TABS = ["Configure", "Run", "Rank", "Compare"] as const;

test("the shell boots and shows the configured display name", async ({ page }) => {
  await page.goto("/");

  // Redirected to the first tab, because the household is configured first.
  await expect(page).toHaveURL(/\/configure$/);

  const displayName = await readConfiguredDisplayName(page.request);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(displayName);
});

test("all four routes render", async ({ page }) => {
  await page.goto("/configure");

  for (const tab of TABS) {
    await page.getByRole("link", { name: tab, exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: tab })).toBeVisible();
  }
});

test("the sidebar shows the selectors and the candidate counts", async ({ page }) => {
  await page.goto("/rank");

  await expect(page.getByLabel("Active criteria set")).toBeVisible();
  await expect(page.getByRole("radio", { name: "country" })).toBeChecked();

  const counts = page.getByRole("region", { name: "Candidates" });
  await expect(counts.getByText("Matching", { exact: true })).toBeVisible();
});

/**
 * Read the name from the same file the app reads, rather than asserting a literal. Hardcoding
 * "Starnest" here would make renaming the product break the test suite -- the exact coupling
 * the configuration file exists to avoid.
 */
async function readConfiguredDisplayName(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const response = await request.get("/config.json");
  expect(response.ok()).toBe(true);
  const config = (await response.json()) as { display_name: string };
  return config.display_name;
}
