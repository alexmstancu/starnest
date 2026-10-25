import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * PL-075 (UF-119): a ranking row shows its state, at every width the interface supports.
 *
 * **Only a browser can see this.** The state classes were on the rows and the rules were in the
 * sheet, and the row's own base rule out-ranked them, so an open row and a ruled-out row both
 * drew on plain white -- and the sheet's generic `.table tbody tr:hover` out-ranked the base in
 * turn, tinting a saved row that opens nothing. The static guard in `rankingRowStyles.test.ts`
 * reads the causes; this reads the effects, as computed backgrounds.
 *
 * **What is covered**, at each width: an open row's ground with the pointer away and with the
 * pointer on it, and a not-matching row's ground. Once, at the design's width: a saved
 * matching row keeps the plain ground under the pointer. Not covered: a live closed row's hover
 * tint, which `rankingRowStyles.test.ts` holds as a rule rather than as a pixel.
 *
 * **Every spec in one `make e2e` shares one database copy**, so this spec writes nothing another
 * spec reads. A non-match is arranged by a matching threshold **on this spec's own copy of the
 * set**, never by a gate answer: an answer is held per candidate for every set at once, and the
 * contract has no delete for one, so an answer that was absent could never be put back as
 * absent. The copy is deleted afterwards, in `finally`, and the delete is checked.
 *
 * **The saved ranking is deleted afterwards too** (D47). It is saved from the shipped set (never
 * this spec's copy, which it would hold by foreign key) and carries the marker the boot sweep
 * discards, should the delete never run.
 */

const LAYOUT_SET = "e2e_rank_layout";
const SHIPPED_SOURCE = "minimal";
const LEVEL = "country";
/** A `Ratio` every country but a few answers, and one the shipped `minimal` set scores. */
const THE_THRESHOLD_ATTRIBUTE = "country.housing_cost_overburden_rate";
/** `TEST_EVALUATION_MARKER` in `backend/src/starnest/storage/evaluation_store.py`. */
const TEST_EVALUATION_MARKER = "[e2e] ";

/** `--colour-accent-surface`, `--colour-surface-raised` and `--colour-surface`, computed. */
const OPEN_GROUND = "rgb(240, 253, 250)";
const NOT_MATCHING_GROUND = "rgb(252, 252, 253)";
const PLAIN_GROUND = "rgb(255, 255, 255)";
/** `--colour-surface-raised`: the tint a row that opens takes under the pointer. */
const RAISED_GROUND = "rgb(252, 252, 253)";

/** 1280 is the narrowest the interface supports; 1560 is the design's own width. */
const WIDTHS = [1920, 1560, 1440, 1280] as const;

interface Arranged {
  /** The candidate the threshold rules out, by name. */
  excluded: string;
  /** A candidate that still matches, to open. */
  opened: string;
  savedEvaluation: number;
  /** A candidate that matches in the saved ranking. */
  savedMatching: string;
}

interface RankedCandidate {
  candidate: string;
  name: string;
  match_status: "matching" | "not_matching" | "insufficient_data";
}

let arranged: Arranged | undefined;

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    await api.delete(`/v1/criteria-sets/${LAYOUT_SET}`);
    const made = await api.post(`/v1/criteria-sets/${SHIPPED_SOURCE}/duplicate`, {
      data: { id: LAYOUT_SET, name: LAYOUT_SET },
    });
    if (made.status() === 409 && (await made.text()).includes("criteria_set_exists")) {
      // A deleted set keeps its id, so the copy an earlier run deleted still holds this one.
      const restored = await api.post(`/v1/criteria-sets/${LAYOUT_SET}/restore`);
      expect(restored.ok(), await restored.text()).toBe(true);
    } else {
      expect(made.ok(), await made.text()).toBe(true);
    }

    const excludedId = await ruleOutTheHighest(api);
    const live = await rankingOf(api, `/v1/rankings?criteria_set=${LAYOUT_SET}&level=${LEVEL}`);
    const excluded = live.find((entry) => entry.candidate === excludedId);
    expect(excluded?.match_status).toBe("not_matching");
    const opened = live.find((entry) => entry.match_status === "matching");
    expect(opened).toBeDefined();

    const saved = await api.post("/v1/evaluations", {
      data: {
        criteria_set: SHIPPED_SOURCE,
        level: LEVEL,
        note: `${TEST_EVALUATION_MARKER}rank layout ${Date.now()}`,
      },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    const savedEvaluation = ((await saved.json()) as { id: number }).id;
    const savedMatching = (await rankingOf(api, `/v1/evaluations/${savedEvaluation}`)).find(
      (entry) => entry.match_status === "matching",
    );
    expect(savedMatching).toBeDefined();

    arranged = {
      excluded: excluded?.name ?? "",
      opened: opened?.name ?? "",
      savedEvaluation,
      savedMatching: savedMatching?.name ?? "",
    };
  } finally {
    await api.dispose();
  }
});

test.afterAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    if (arranged !== undefined) {
      const discarded = await api.delete(`/v1/evaluations/${arranged.savedEvaluation}`);
      expect(discarded.status() === 204 || discarded.status() === 404, await discarded.text()).toBe(
        true,
      );
    }
    // The threshold lives in the copy, so deleting the copy takes it too.
    const deleted = await api.delete(`/v1/criteria-sets/${LAYOUT_SET}`);
    expect(deleted.ok() || deleted.status() === 404, await deleted.text()).toBe(true);
  } finally {
    await api.dispose();
  }
});

for (const width of WIDTHS) {
  test(`an open row and a not-matching row show their grounds at ${width}px`, async ({
    page,
  }) => {
    const { opened, excluded } = theArrangement();
    await page.setViewportSize({ width, height: 900 });
    await openTheRanking(page, opened);

    const openedRow = liveRowOf(page, opened);
    await openedRow.getByRole("button", { name: opened, exact: true }).click();
    await expect(
      openedRow.getByRole("button", { name: opened, exact: true }),
    ).toHaveAttribute("aria-expanded", "true");

    // The pointer is on it after the click: the hover tint must not take the ground back.
    await openedRow.hover();
    await expect(openedRow).toHaveCSS("background-color", OPEN_GROUND);

    // The pointer away, so the ground read is the state's and not the hover tint's.
    await page.mouse.move(0, 0);
    await expect(openedRow).toHaveCSS("background-color", OPEN_GROUND);
    const excludedRow = liveRowOf(page, excluded);
    await expect(excludedRow).toContainText("Not matching");
    await expect(excludedRow).toHaveCSS("background-color", NOT_MATCHING_GROUND);
  });
}

/**
 * PL-082. **Every cell inside its row's ground and the header's, at every supported width.**
 * The table is a grid: a column hidden without its track slides every later cell one column
 * left, and a row narrower than its tracks spills past its ground. Δ home goes at 1440 and
 * below, Pillars at 1280, and at 1280 the sidebar narrows to 200px so nothing scrolls sideways.
 */
for (const width of WIDTHS) {
  test(`every ranking cell sits inside its row at ${width}px`, async ({ page }) => {
    const { opened } = theArrangement();
    await page.setViewportSize({ width, height: 900 });
    await openTheRanking(page, opened);
    const table = page.getByRole("table", { name: "Ranked candidates" });

    const delta = table.getByRole("columnheader", { name: "Δ home" });
    const pillars = table.getByRole("columnheader", { name: "Pillars" });
    if (width <= 1440) await expect(delta).toBeHidden();
    else await expect(delta).toBeVisible();
    if (width <= 1280) await expect(pillars).toBeHidden();
    else await expect(pillars).toBeVisible();

    const spills = await table.evaluate((element) => {
      const header = element.querySelector("thead tr")!.getBoundingClientRect();
      const rows = [element.querySelector("thead tr")!, ...element.querySelectorAll("tbody tr")]
        .filter((row) => row.querySelector('th[scope="row"], th[scope="col"]') !== null);
      const visibleCells = (row: Element) =>
        [...row.children].filter((cell) => getComputedStyle(cell).display !== "none");
      const found: string[] = [];
      for (const row of rows) {
        const ground = row.getBoundingClientRect();
        const cells = visibleCells(row);
        if (cells.length !== visibleCells(rows[0]!).length) {
          found.push(`${row.textContent?.slice(0, 20)}: ${cells.length} visible cells`);
        }
        const last = cells.at(-1)!.getBoundingClientRect();
        if (last.right > Math.min(ground.right, header.right) + 0.5) {
          found.push(`${row.textContent?.slice(0, 20)}: last cell ends at ${last.right}`);
        }
      }
      return found;
    });
    expect(spills).toEqual([]);

    if (width === 1280 || width === 1920) {
      const scrolls = await table.evaluate((element) => {
        const card = element.parentElement!;
        return {
          card: card.scrollWidth > card.clientWidth,
          page: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      expect(scrolls).toEqual({ card: false, page: false });
    }
    if (width === 1280) {
      const sidebar = await page.getByRole("complementary").first().boundingBox();
      expect(sidebar?.width).toBe(200);
    }
  });
}

test("a saved row opens its saved figures, so it takes the hover tint", async ({ page }) => {
  const { savedEvaluation, savedMatching } = theArrangement();
  await page.setViewportSize({ width: 1560, height: 900 });
  await page.goto(`/rank?saved=${savedEvaluation}`);
  const opened = page.getByRole("region", { name: "A saved ranking" });
  const savedTable = opened.getByRole("table", { name: "Ranked candidates" });
  await expect(savedTable).toBeVisible();

  // By its row header, not by text: a row's text runs its cells together ("1Netherlands71").
  const row = savedTable
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: savedMatching, exact: true }) });
  await expect(row).not.toContainText("Not matching");
  await page.mouse.move(0, 0);
  await expect(row).toHaveCSS("background-color", PLAIN_GROUND);

  await row.hover();
  await expect(row).toHaveCSS("background-color", RAISED_GROUND);

  // PL-144: what it opens is the evidence frozen with it, each figure with its provenance.
  await row.getByRole("button", { name: savedMatching, exact: true }).click();
  await expect(
    opened.getByRole("region", { name: `${savedMatching}: every figure behind the saved score` }),
  ).toBeVisible();
});

function theArrangement(): Arranged {
  if (arranged === undefined) throw new Error("beforeAll arranged nothing");
  return arranged;
}

async function openTheRanking(page: Page, aCandidate: string): Promise<void> {
  await page.goto("/rank");
  await page.getByLabel("Active criteria set").selectOption(LAYOUT_SET);
  await expect(page.getByRole("table", { name: "Ranked candidates" })).toBeVisible();
  await expect(liveRowOf(page, aCandidate)).toBeVisible();
}

/** A candidate's own row: the one holding its toggle, not the evidence row under it. */
function liveRowOf(page: Page, name: string) {
  return page
    .getByRole("table", { name: "Ranked candidates" })
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}

/**
 * Sets a ceiling on this spec's copy just under the highest figure stored, so the candidate
 * holding it -- and only candidates level with it -- stop matching. Read from the data rather
 * than written as a number, because the copy is of whatever backup the run restored.
 */
async function ruleOutTheHighest(request: APIRequestContext): Promise<string> {
  const response = await request.get(
    `/v1/values?attribute=${THE_THRESHOLD_ATTRIBUTE}&limit=1000`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as {
    items: { candidate: string; is_active: boolean; payload: { value?: unknown } }[];
  };
  const figures = body.items
    .filter((item) => item.is_active && typeof item.payload.value === "number")
    .map((item) => ({ candidate: item.candidate, value: item.payload.value as number }))
    .sort((left, right) => right.value - left.value);
  const [highest] = figures;
  const below = figures.find((figure) => figure.value < (highest?.value ?? 0));
  expect(highest && below, "two different figures to put a ceiling between").toBeTruthy();
  const ceiling = ((highest?.value ?? 0) + (below?.value ?? 0)) / 2;

  const patched = await request.patch(
    `/v1/criteria-sets/${LAYOUT_SET}/criteria/${THE_THRESHOLD_ATTRIBUTE}`,
    { data: { matching_threshold: { min_value: null, max_value: ceiling } } },
  );
  expect(patched.ok(), await patched.text()).toBe(true);
  return highest?.candidate ?? "";
}

async function rankingOf(request: APIRequestContext, path: string): Promise<RankedCandidate[]> {
  const response = await request.get(path);
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { candidates: RankedCandidate[] }).candidates;
}
