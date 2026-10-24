import { expect, test } from "@playwright/test";

/**
 * A smoke test, and only that: the app boots, the four routes render, and the sidebar shows
 * the configured display name.
 *
 * **This spec is scaffolding.** End-to-end tests belong to the master agent (`devplan.md`
 * section 0.2), and this one is replaced at Gate A by a suite written from `reqs.md` against the real
 * backend. Its job until then is to prove the Playwright harness runs at all -- a harness
 * discovered to be broken at a gate is discovered too late.
 *
 * It runs against the same stack as every spec -- `make e2e`'s own backend and throwaway
 * database -- and still asserts only that screens appear, never what any number on them is:
 * the gates and the sanity suite check the numbers.
 */

const TABS = ["Configure", "Acquire", "Rank", "Compare"] as const;

test("the shell boots and shows the configured display name", async ({ page }) => {
  await page.goto("/");

  // Redirected to the first tab, because the household is configured first.
  await expect(page).toHaveURL(/\/configure$/);

  const displayName = await readConfiguredDisplayName(page.request);
  // The name is the sidebar's brand, not a heading: the page's one `h1` is the screen's title.
  await expect(
    page.getByRole("complementary").getByText(displayName, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configure");
});

test("all four routes render", async ({ page }) => {
  await page.goto("/configure");

  for (const tab of TABS) {
    await page.getByRole("link", { name: tab, exact: true }).click();
    // `exact` matters: an accessible name is matched as a substring by default, so "Run"
    // also matches the sidebar's "Last run" panel heading. That produced a strict-mode
    // violation only when the sidebar's data won the race to render -- a real selector bug
    // wearing a flake's clothing.
    await expect(
      page.getByRole("heading", { level: 1, name: tab, exact: true }),
    ).toBeVisible();
  }
});

test("the sidebar shows the selectors and the candidate counts", async ({ page }) => {
  await page.goto("/rank");

  await expect(page.getByLabel("Active criteria set")).toBeVisible();
  // Segments, as the design draws them; `aria-pressed` is what says which is current.
  await expect(
    page.getByRole("button", { name: "Country" }),
  ).toHaveAttribute("aria-pressed", "true");

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
