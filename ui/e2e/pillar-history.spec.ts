import { expect, test } from "@playwright/test";

/**
 * NEW-67 (PL-138), in a browser against the real server: a pillar weight moved is listed in
 * Recent changes, and its Undo puts the stored weight back. The unit tests prove it against the
 * mock; this proves the server's own answer is noted too.
 *
 * The set is this spec's own, a copy of `minimal`, deleted afterwards. A deleted set keeps its
 * id, so one an earlier run deleted is restored rather than made again.
 */

const HISTORY_SET = "e2e_pillar_history";
const SOURCE = "minimal";

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const made = await api.post(`/v1/criteria-sets/${SOURCE}/duplicate`, {
      data: { id: HISTORY_SET, name: HISTORY_SET },
    });
    if (made.status() === 409 && (await made.text()).includes("criteria_set_exists")) {
      const restored = await api.post(`/v1/criteria-sets/${HISTORY_SET}/restore`);
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
    const deleted = await api.delete(`/v1/criteria-sets/${HISTORY_SET}`);
    expect(deleted.ok() || deleted.status() === 404, await deleted.text()).toBe(true);
  } finally {
    await api.dispose();
  }
});

const isPillarWrite = (method: string, url: string) =>
  method === "PUT" && /\/criteria-sets\/[^/]+\/pillar-weights\//.test(new URL(url).pathname);

test("a pillar weight moved is listed in Recent changes, and its Undo puts it back", async ({
  page,
}) => {
  await page.goto("/configure");
  await page.getByRole("combobox", { name: "Active criteria set" }).selectOption(HISTORY_SET);
  const history = page.getByRole("region", { name: /^Recent changes/ });
  const weights = page.getByRole("region", { name: "Pillar weights" });
  await weights.getByRole("group").first().waitFor({ state: "visible" });
  await expect(history.getByText("No changes yet.")).toBeVisible();

  // The first pillar free to move: a locked one is held, and moves nothing.
  const slider = weights.locator('input[type="range"]:not([aria-disabled])').first();
  const pillar = ((await slider.getAttribute("aria-label")) ?? "").replace(/ weight$/, "");
  const before = await slider.inputValue();
  const after = before === "20" ? "25" : "20";

  const stored = page.waitForResponse((response) =>
    isPillarWrite(response.request().method(), response.url()),
  );
  await slider.fill(after);
  await slider.dispatchEvent("pointerup");
  expect((await stored).ok()).toBe(true);

  const entry = history.getByRole("listitem").filter({ hasText: `Pillar weight for ${pillar}` });
  await expect(entry).toHaveCount(1);

  const undone = page.waitForResponse((response) =>
    isPillarWrite(response.request().method(), response.url()),
  );
  await entry.getByRole("button", { name: "Undo this" }).click();
  expect((await undone).ok()).toBe(true);
  await expect(slider).toHaveValue(before);
  await expect(entry).toHaveCount(0);
});
