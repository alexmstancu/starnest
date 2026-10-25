import { expect, test } from "@playwright/test";
import { readSettings } from "./settings";

/**
 * PL-084 with PL-083. **A score typed by hand reads back, links into Rank, and scores on its own
 * scale**, on the real stack: 7 on a 0-10 scale, stored for one candidate, opens that candidate
 * at its pillar in Rank's drill-down, where the attribute scores 70% of the score range -- never
 * 7, which is the figure read as if it were already on the score scale.
 *
 * **It writes a figure nothing can delete** (there is no DELETE for values), so it runs in its own
 * project, after every other spec (`playwright.config.ts`), on a pair no other spec reads:
 * Slovenia's residency admin ease. `make e2e` restores the copy before the next run.
 */
const CANDIDATE = "Slovenia";
const ATTRIBUTE = "Residency admin ease";

test("a typed score reads back, links to Rank and scores on its own scale", async ({
  page,
  request,
}) => {
  const scale = Number((await readSettings(request))["score_scale_max"]);
  expect(scale > 0, "the score range must be set for a score to read at all").toBe(true);

  await page.goto("/acquire");
  const openToHand = page.getByRole("table", { name: "Attributes open to hand entry" });
  const row = openToHand
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: new RegExp(`^${ATTRIBUTE}`) }) });
  await row.getByRole("button", { name: "Enter a value by hand" }).click();

  const form = page.getByRole("region", { name: `Enter a value for ${ATTRIBUTE} by hand` });
  await form.getByLabel("Candidate").selectOption({ label: CANDIDATE });
  await form.getByLabel("Score", { exact: true }).fill("7");
  await form.getByLabel("Scale, lowest").fill("0");
  await form.getByLabel("Scale, highest").fill("10");
  await form.getByLabel("Describes, from").fill("2026-01-01");
  await form.getByLabel("Describes, to").fill("2026-06-30");
  await form.getByRole("button", { name: "Store this figure" }).click();

  const toRank = form.getByRole("link", { name: "See it in the Rank drill-down" });
  await expect(toRank).toBeVisible();
  await toRank.click();

  // The candidate open, at the attribute's pillar, as the address asked.
  const ranked = page.getByRole("table", { name: /ranked candidates/i });
  await expect(ranked.getByRole("button", { name: CANDIDATE, exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    page.getByRole("button", { name: /^Governance/, pressed: true }).first(),
  ).toBeVisible();

  // 7 on 0-10 is 70% of the range (PL-083): 70 on a 100-point scale, whatever the scale is.
  const stored = page
    .getByRole("table", { name: "Every stored value" })
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: new RegExp(`^${ATTRIBUTE}`) }) });
  const expected = String(Math.round(0.7 * scale));
  await expect(stored.getByRole("cell").nth(1)).toHaveText(new RegExp(`^${expected}(\\.0+)?$`));
});
