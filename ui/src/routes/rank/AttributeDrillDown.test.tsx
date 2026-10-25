import { readFileSync } from "node:fs";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { StoredValue } from "../../api/endpoints";
import { renderShell } from "../../testing/renderShell";
import { serveSourceNames } from "../../testing/sourceNames";
import { STORED_VALUES } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";

/**
 * P69: one attribute, every candidate (`reqs.md` 8.4).
 *
 * **A v1 requirement nothing implemented.** It survived a full review and four gates because
 * every automated check anchors on the contract, and the contract had always offered the
 * filter -- so nothing was ever out of step with anything. Only reading the requirement
 * against the code found it.
 */
/**
 * The panel, once the screen has settled.
 *
 * **The table is awaited first on purpose.** `TheRanking` is keyed by the criteria set and
 * level, so it remounts the moment the selection resolves -- and a panel captured before that
 * is a detached node the new options never reach. Waiting for the table waits for the remount.
 */
async function theDrillDown(): Promise<HTMLElement> {
  await screen.findByRole("table");
  return screen.getByRole("region", { name: /one attribute, every candidate/i });
}

/**
 * Chooses an attribute by its name. The catalog arrives after the first render, so the option
 * is waited for -- the select exists immediately and holds only its placeholder.
 */
async function chooseAttribute(panel: HTMLElement, name: string): Promise<void> {
  const option = await within(panel).findByRole("option", { name });
  await userEvent
    .setup()
    .selectOptions(within(panel).getByRole("combobox", { name: "Attribute" }), option);
}

/** Portugal's active cost of living figure, which every served figure below varies. */
const A_FIGURE = STORED_VALUES.find((each) => each.id === 501)!;

/** Answers every question about an attribute's figures with these, and only these. */
function serveFigures(figures: Partial<StoredValue>[]): void {
  const items = figures.map((each, index) => ({ ...A_FIGURE, id: 9000 + index, ...each }));
  mockServer.use(
    // One attribute's figures; the count of everything stored (PL-011) is the mock's own.
    http.get("/v1/values", ({ request }) =>
      new URL(request.url).searchParams.has("attribute")
        ? HttpResponse.json({ items, total: items.length })
        : undefined,
    ),
  );
}

/** The sentence for an attribute the active set scores and nobody has a figure for. */
const SPREAD = /its weight is spread over the attributes that have a figure/i;

describe("the attribute drill-down", () => {
  it("asks for an attribute before fetching anything", async () => {
    renderShell("/rank");
    const panel = await theDrillDown();

    expect(
      await within(panel).findByText(/choose an attribute to see which candidates/i),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows every candidate that has a figure, with where it came from", async () => {
    const user = userEvent.setup();
    renderShell("/rank");
    const panel = await theDrillDown();

    // The catalog arrives after the first render, so a real option is waited for -- the select
    // exists immediately and holds only its placeholder.
    await within(panel).findByRole("option", { name: "Cost of living index" });
    await user.selectOptions(
      within(panel).getByRole("combobox", { name: "Attribute" }),
      "country.cost_of_living_index",
    );

    const table = await within(panel).findByRole("table");
    // The provenance `reqs.md` 8.4 asks for by name: value, source, both dates.
    for (const column of ["Candidate", "Figure", "Source", "Describes", "Fetched"]) {
      expect(within(table).getByRole("columnheader", { name: column })).toBeInTheDocument();
    }
    expect(within(table).getByRole("rowheader", { name: "Portugal" })).toBeInTheDocument();
    // **The name the catalog holds, which this screen cannot derive.** A `StoredValue` carries
    // the candidate id alone, so every name in this column is `useCandidateNames`' doing --
    // and "United Kingdom" is the one name in the roster that proves it, because the fallback
    // title-cases the id to "United kingdom". Asserting "Portugal" above proves nothing on its
    // own: it is what both paths produce, so the lookup could be deleted and this test would
    // still pass (it did).
    expect(
      within(table).getByRole("rowheader", { name: "United Kingdom" }),
    ).toBeInTheDocument();
    // RB-4: the source as the catalog names it, never its id.
    expect(await within(table).findAllByText("Eurostat")).toHaveLength(2);
    expect(table).not.toHaveTextContent(/\beurostat\b/);
  });

  /**
   * RB-4. **The catalog's name, which the id cannot be read into.** "Eurostat" above is what the
   * fallback makes of `eurostat` too, so it would pass with the lookup deleted; the estimated
   * tax rate's source is `eurostat_estimate`, which the catalog calls "Estimated from Eurostat
   * tax-benefit figures".
   */
  it("names where each figure came from as the catalog does", async () => {
    serveSourceNames({
      eurostat_estimate: "Estimated from Eurostat tax-benefit figures",
    });
    const user = userEvent.setup();
    renderShell("/rank");
    const panel = await theDrillDown();

    await within(panel).findByRole("option", { name: "Total effective tax rate" });
    await user.selectOptions(
      within(panel).getByRole("combobox", { name: "Attribute" }),
      "country.total_tax_rate_effective",
    );

    const table = await within(panel).findByRole("table");
    expect(
      await within(table).findByRole("cell", {
        name: "Estimated from Eurostat tax-benefit figures",
      }),
    ).toBeInTheDocument();
    expect(table).not.toHaveTextContent(/eurostat_estimate/);
  });

  it("says nobody has a figure rather than showing an empty table", async () => {
    const user = userEvent.setup();
    renderShell("/rank");
    const panel = await theDrillDown();

    // The catalog arrives after the first render, so a real option is waited for -- the select
    // exists immediately and holds only its placeholder.
    await within(panel).findByRole("option", { name: "Cost of living index" });
    await user.selectOptions(
      within(panel).getByRole("combobox", { name: "Attribute" }),
      "country.nobody_measures_this",
    );

    // **The case this view exists for.** An empty table would read as a failure to render;
    // a sentence says the absence is the answer.
    expect(
      await within(panel).findByText(/no candidate has a figure for this attribute/i),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("table")).not.toBeInTheDocument();
  });

  it("reports a failure and retries, rather than showing an empty table", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.get("/v1/values", () => HttpResponse.error()),
    );
    renderShell("/rank");
    const panel = await theDrillDown();

    // The catalog arrives after the first render, so a real option is waited for -- the select
    // exists immediately and holds only its placeholder.
    await within(panel).findByRole("option", { name: "Cost of living index" });
    await user.selectOptions(
      within(panel).getByRole("combobox", { name: "Attribute" }),
      "country.cost_of_living_index",
    );

    expect(await within(panel).findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

/**
 * PL-077. **Candidates, counted against the level's roster.** An attribute with breakdown
 * options has one active figure per option, so the rows outnumber the candidates -- and a
 * count of rows read as more of the level being measured than is.
 */
describe("how many candidates have a figure", () => {
  it("counts candidates, not rows: two options for one candidate count once, out of the roster", async () => {
    serveFigures([
      { candidate: "country.portugal", breakdown_option: "single" },
      { candidate: "country.portugal", breakdown_option: "couple" },
      { candidate: "country.united_kingdom" },
    ]);
    renderShell("/rank");
    const panel = await theDrillDown();

    await chooseAttribute(panel, "Cost of living index");

    // Six: the fixture level's roster, not the four candidates the ranking happens to list.
    expect(
      await within(panel).findByText(
        "2 of 6 candidates have a figure for this attribute.",
      ),
    ).toBeInTheDocument();
  });

  it("gives no total while the level's roster cannot be read", async () => {
    mockServer.use(
      http.get("/v1/candidates", ({ request }) =>
        // Only the level's roster: the names every screen shares are read without a level.
        new URL(request.url).searchParams.has("level") ? HttpResponse.error() : undefined,
      ),
    );
    renderShell("/rank");
    const panel = await theDrillDown();

    await chooseAttribute(panel, "Cost of living index");

    expect(
      await within(panel).findByText(
        "2 candidates have a figure for this attribute.",
      ),
    ).toBeInTheDocument();
  });
});

/**
 * PL-077. **Redistribution is level-wide, and only a scored attribute has weight to spread.**
 * The sentence used to say the weight "redistributes across the rest of its pillar" for any
 * attribute at all -- false for a descriptive one, which has no weight, and false for a scored
 * one too, because a missing figure's weight goes to every attribute that has one.
 */
describe("what an attribute nobody has a figure for costs", () => {
  it("says a scored attribute's weight is spread over the attributes that have a figure", async () => {
    serveFigures([]);
    renderShell("/rank");
    const panel = await theDrillDown();

    // The default set scores it.
    await chooseAttribute(panel, "Cost of living index");

    expect(await within(panel).findByText(SPREAD)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/pillar/i);
  });

  it("says nothing about redistribution for an attribute the set does not score", async () => {
    serveFigures([]);
    renderShell("/rank");
    const panel = await theDrillDown();
    // **A scored one first, so the set is known to have arrived.** Without it, the absence
    // below could be read before the set was, and would pass for the wrong reason.
    await chooseAttribute(panel, "Cost of living index");
    await within(panel).findByText(SPREAD);

    // No criterion of the default set judges it.
    await chooseAttribute(panel, "Nobody measures this");

    await waitFor(() => {
      expect(panel).toHaveTextContent(/no candidate has a figure for this attribute/i);
      // Any word about weight: it has none here to spread, under any wording.
      expect(panel).not.toHaveTextContent(/weight/i);
    });
  });
});

/**
 * The tint the stylesheet gives an element: the background, ink and border of every rule that
 * names one of its classes alone, a later rule winning as it does in the cascade.
 *
 * **Read from `styles.css`, because jsdom draws nothing** -- and the tint is the claim.
 */
function tintOf(element: HTMLElement): Record<string, string> {
  const sheet = readFileSync(join(__dirname, "../../styles.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const tint: Record<string, string> = {};
  for (const [, selectors = "", body = ""] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const classes = selectors
      .split(",")
      .map((selector) => /^\.([\w-]+)$/.exec(selector.trim())?.[1]);
    if (!classes.some((name) => name && element.classList.contains(name))) continue;
    for (const declaration of body.split(";")) {
      const [property = "", value = ""] = declaration.split(":").map((part) => part.trim());
      if (["background", "color", "border-color"].includes(property)) tint[property] = value;
    }
  }
  return tint;
}

/**
 * PL-079. **Medium is not a warning.** The design draws a medium figure's chip neutral and only
 * a low one amber; one rule tinted both, so half the figures on the screen read as a caution.
 */
describe("the confidence chips", () => {
  it("draws a medium figure's chip neutral and a low one's amber, as the design does", async () => {
    serveFigures([
      { candidate: "country.portugal", confidence_level: "medium" },
      { candidate: "country.united_kingdom", confidence_level: "low" },
    ]);
    renderShell("/rank");
    const panel = await theDrillDown();

    await chooseAttribute(panel, "Cost of living index");
    const table = within(await within(panel).findByRole("table"));

    expect(tintOf(table.getByText("medium"))).toEqual({
      background: "var(--colour-surface-sunken)",
      // The design's #344054, which this sheet calls text-strong; text-label is #475467.
      color: "var(--colour-text-strong)",
      "border-color": "var(--colour-border)",
    });
    expect(tintOf(table.getByText("low"))).toEqual({
      background: "var(--colour-warning-surface)",
      color: "var(--colour-warning)",
      "border-color": "var(--colour-warning-border)",
    });
  });
});

/**
 * PL-069, N10. **The stored grade stays; a mark says the figure has aged out**, which is what
 * counts it one grade lower in the ranking's confidence split.
 */
describe("a figure older than its allowed age", () => {
  it("is marked beside its chip, and a fresh one is not", async () => {
    serveFigures([
      { candidate: "country.portugal", is_fresh: false },
      { candidate: "country.united_kingdom", is_fresh: true },
    ]);
    renderShell("/rank");
    const panel = await theDrillDown();

    await chooseAttribute(panel, "Cost of living index");
    const table = within(await within(panel).findByRole("table"));

    const aged = table.getByRole("row", { name: /portugal/i });
    expect(within(aged).getByText("older than its allowed age")).toHaveAttribute(
      "title",
      "Counted one grade lower in the confidence split",
    );
    expect(within(aged).getByText("high")).toBeInTheDocument();
    const fresh = table.getByRole("row", { name: /united kingdom/i });
    expect(within(fresh).queryByText("older than its allowed age")).toBeNull();
  });
});
