import { expect, test } from "@playwright/test";

/**
 * PL-041 (UF-066), T41-U1. **A long set name stays in its slot.** It is cut with an ellipsis, its
 * row holds it whole as a title, and the verbs on every row stay at the same x -- a check only a
 * browser can make, because jsdom lays nothing out.
 *
 * The set is this spec's own, made through the API with the longest name the contract takes, and
 * deleted afterwards. A deleted set keeps its id, so a set an earlier run deleted is restored
 * rather than made again.
 */

const LONG_SET = "e2e_long_set_name";
/** `CriteriaSetName.maxLength`: as long as a name can be, and wider than any slot. */
const LONG_NAME = "W".repeat(60);
/** 1280 is the narrowest the interface supports; 1560 is the design's own width. */
const WIDTHS = [1560, 1440, 1280] as const;

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const made = await api.post("/v1/criteria-sets", { data: { id: LONG_SET, name: LONG_NAME } });
    if (made.status() === 409 && (await made.text()).includes("criteria_set_exists")) {
      const restored = await api.post(`/v1/criteria-sets/${LONG_SET}/restore`);
      expect(restored.ok(), await restored.text()).toBe(true);
    } else {
      expect(made.ok(), await made.text()).toBe(true);
    }
  } finally {
    await api.dispose();
  }
});

test.afterAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const deleted = await api.delete(`/v1/criteria-sets/${LONG_SET}`);
    expect(deleted.ok() || deleted.status() === 404, await deleted.text()).toBe(true);
  } finally {
    await api.dispose();
  }
});

for (const width of WIDTHS) {
  test(`a long set name is cut to its slot, and the verbs stay in line, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/configure");
    const sets = page.getByRole("region", { name: /^Criteria set/ });
    const row = sets.getByRole("listitem", { name: LONG_NAME });
    const name = row.getByText(LONG_NAME, { exact: true });
    await expect(name).toBeVisible();

    await expect(name).toHaveAttribute("title", LONG_NAME);
    await expect(name).toHaveCSS("text-overflow", "ellipsis");
    expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

    // Every row's Rename at one x: a name that pushed its verbs along would move this one.
    const renames = sets.getByRole("button", { name: "Rename" });
    await expect(renames).not.toHaveCount(0);
    const xs = await renames.evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().x)),
    );
    expect(new Set(xs).size, `Rename buttons at ${xs.join(", ")}`).toBe(1);
    // And the long name's verbs sit on its own line, not wrapped under it.
    const nameBox = await name.boundingBox();
    const renameBox = await row.getByRole("button", { name: "Rename" }).boundingBox();
    expect(nameBox && renameBox && Math.abs(nameBox.y - renameBox.y) < renameBox.height).toBe(true);
  });
}
