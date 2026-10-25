import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { readSettings } from "./settings";

/**
 * PL-062 against the real stack: **a score is drawn and labelled on the scale it was computed
 * on**, which is a setting and not always 100. The interface used to clamp a pillar to 100 and
 * label every range "0–100", so on any other scale a bar lied and its label disagreed with the
 * figure the server sent.
 *
 * It changes a global setting, so it puts it back in `finally` -- from a read taken before
 * anything changed, and only once that read succeeded (NEW-32): a restore built from a failed
 * read would send a body without the field and clear the household's own choice. **The first
 * write is inside the `try`**, because a write the server committed can still fail on its way
 * back, and that one needs putting back as much as any.
 */

const A_SCALE_THAT_IS_NOT_100 = 150;

interface PillarScore {
  pillar: string;
  score: number | null;
  weight: number;
}

interface RankedCandidate {
  name: string;
  pillar_scores?: PillarScore[];
}

interface Ranking {
  score_scale_max: number;
  candidates: RankedCandidate[];
}

test("draws and labels the ranking on the scale it was scored on", async ({ page }) => {
  // The design's width: below 1468px the narrow layout hides the Pillars column (PL-082), and
  // its bars are what this spec reads.
  await page.setViewportSize({ width: 1560, height: 900 });
  const original = await scaleToPutBack(page.request);
  try {
    await setScale(page.request, A_SCALE_THAT_IS_NOT_100);
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/v1/rankings",
    );
    await page.goto("/rank");
    const response = await answered;
    expect(response.ok(), `the ranking was refused: HTTP ${response.status()}`).toBe(true);
    const ranking = (await response.json()) as Ranking;
    expect(ranking.score_scale_max).toBe(A_SCALE_THAT_IS_NOT_100);

    // The specs find the score column by this exact heading, so the scale never joins it.
    await expect(page.getByRole("columnheader", { name: "Score", exact: true })).toBeVisible();

    const { candidate, pillar } = highestPillarScore(ranking);
    // **By the name's own button**, never by the rowheader's name: home's row adds "home" to
    // it. `has` is queried inside each row, so it is built from the page, not from the table.
    const nameButton = (within: Page | Locator) =>
      within.getByRole("rowheader").getByRole("button", { name: candidate, exact: true });
    const row = page
      .getByRole("table", { name: "Ranked candidates" })
      .locator("tbody tr")
      .filter({ has: nameButton(page) });
    const opener = nameButton(row);

    // The bar says the server's number, unclamped -- above 100 when the scale lets it be. Named
    // whole, pillar and weight included, so a tie between two pillars is still one bar.
    const reading =
      `${await pillarName(page, pillar.pillar)}: ${pillar.score!.toFixed(0)}, ` +
      `weight ${pillar.weight.toFixed(1)}%`;
    await expect(row.getByRole("button", { name: reading, exact: true })).toHaveCount(1);

    await opener.click();
    await expect(
      page.getByRole("columnheader", { name: `Score 0–${A_SCALE_THAT_IS_NOT_100}` }),
    ).toBeVisible();
    await expect(page.getByText(/Score 0–100/)).toHaveCount(0);
  } finally {
    await setScale(page.request, original);
  }
});

/** The scale as it was, refused rather than guessed when the settings do not carry one. */
async function scaleToPutBack(request: APIRequestContext): Promise<number | null> {
  const scale = (await readSettings(request))["score_scale_max"];
  if (scale === null || typeof scale === "number") return scale;
  throw new Error(`the settings carry no score scale to put back: ${JSON.stringify(scale)}`);
}

/** Every other setting is written back as it is: `PUT /v1/settings` replaces them whole. */
async function setScale(request: APIRequestContext, scale: number | null): Promise<void> {
  const response = await request.put("/v1/settings", {
    data: { ...(await readSettings(request)), score_scale_max: scale },
  });
  expect(response.ok(), `the score scale was not set: HTTP ${response.status()}`).toBe(true);
}

/**
 * The highest pillar score in the ranking, which is the bar a clamp would flatten -- kept with
 * its pillar, so the bar is found by what it is rather than by a number another may share.
 */
function highestPillarScore(ranking: Ranking): { candidate: string; pillar: PillarScore } {
  let best: { candidate: string; pillar: PillarScore } | null = null;
  for (const candidate of ranking.candidates) {
    for (const pillar of candidate.pillar_scores ?? []) {
      if (
        typeof pillar.score === "number" &&
        (best === null || pillar.score > (best.pillar.score ?? 0))
      ) {
        best = { candidate: candidate.name, pillar };
      }
    }
  }
  if (best === null) throw new Error("no candidate in the ranking carries a pillar score");
  return best;
}

/** What the screen calls a pillar: the catalog's name, which is what a bar is labelled with. */
async function pillarName(page: Page, pillar: string): Promise<string> {
  const response = await page.request.get("/v1/pillars");
  expect(response.ok(), `the pillars could not be read: HTTP ${response.status()}`).toBe(true);
  const { items } = (await response.json()) as { items: { id: string; name: string }[] };
  const found = items.find((each) => each.id === pillar);
  if (found === undefined) throw new Error(`the catalog has no pillar ${pillar}`);
  return found.name;
}
