import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * The ranking table, tested against the three cases `reqs.md` makes rules about: a matching
 * candidate with a score, a **non-matching** candidate that keeps its score, and one with
 * **insufficient data** that must not show a number at all.
 *
 * Every assertion here is about a figure the mock served. There is no arithmetic in the
 * screen, so there is nothing else worth asserting.
 */

/**
 * Cells in document order: rank, score, coverage, low-confidence share, match status, reason,
 * and the button that opens the figures. The candidate's name is a rowheader, not a cell.
 */
async function rankingRow(name: string): Promise<HTMLElement> {
  // By name: an open drill-down puts more tables on the screen, and several can be open.
  const table = await screen.findByRole("table", { name: /ranked candidates/i });
  // **By its rowheader, not by the row's own name.** An open row is followed by a row
  // holding that candidate's evidence, whose heading names the candidate too -- so a query
  // by row name matches both, and which one it returns depends on whether the row happens
  // to be open.
  const heading = within(table)
    .getAllByRole("rowheader")
    .find((cell) => cell.textContent?.trim() === name);
  expect(heading, `no row for ${name}`).toBeDefined();
  return heading!.closest("tr")!;
}

/**
 * One cell of a candidate's row, found by its column heading.
 *
 * **Not by index.** These assertions counted cells until a column was inserted in the middle
 * and five tests failed for a reason none of them was about. A heading is what the column
 * means; its position is an accident of layout.
 */
async function cell(candidate: string, column: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table");
  const headings = within(table)
    .getAllByRole("columnheader")
    .map((heading) => heading.textContent?.trim() ?? "");
  const at = headings.indexOf(column);
  expect(
    at,
    `no column headed "${column}" in [${headings.join(", ")}]`,
  ).toBeGreaterThan(-1);

  const row = await rankingRow(candidate);
  // The candidate's own cell is a rowheader rather than a cell, so it is put back in place to
  // line the row up with its headings.
  const inOrder = [...row.querySelectorAll("th,td")] as HTMLElement[];
  const found = inOrder[at];
  expect(
    found,
    `row for ${candidate} has no cell under "${column}"`,
  ).toBeDefined();
  return found!;
}

describe("the ranking table", () => {
  it("shows a row per candidate the API returned, in the order it returned them", async () => {
    renderShell("/rank");

    const table = await screen.findByRole("table");
    const names = within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);

    expect(names).toEqual(["Portugal", "Netherlands", "Spain", "Estonia"]);
  });

  it("shows the score, coverage and match status the API computed", async () => {
    renderShell("/rank");

    expect(await cell("Portugal", "Rank")).toHaveTextContent("1");
    expect(await cell("Portugal", "Score")).toHaveTextContent("78");
    expect(await cell("Portugal", "Coverage")).toHaveTextContent("92.4%");
    expect(await cell("Portugal", "Match status")).toHaveTextContent(
      "Matching",
    );
  });

  it("names the criteria set and level the ranking was computed under", async () => {
    renderShell("/rank");

    const rank = within(await screen.findByRole("region", { name: "Rank" }));
    expect(
      (await rank.findByText("Criteria set")).nextSibling,
    ).toHaveTextContent("default");
    // Capitalised: the catalog ships ids, and a reader is shown a name.
    expect(rank.getByText("Level").nextSibling).toHaveTextContent("Country");
    expect(rank.getByText("Computed").nextSibling).toHaveTextContent(
      "30 Aug 2026, 09:15",
    );
  });
});

describe("the row the household lives in", () => {
  /**
   * Home is the row every delta on the screen is measured against, and nothing said which row
   * it was -- the dash in its own delta cell only makes sense once you already know.
   */
  it("marks the home country beside its name", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json({ ...HOUSEHOLD, home_country_candidate: "country.portugal" }),
      ),
    );
    renderShell("/rank");

    const pill = await screen.findByText("home");

    expect(pill.closest("tr")).toHaveTextContent("Portugal");
  });

  /** The shipped household lives outside the roster, and an unmarked table is the right answer. */
  it("marks nothing when no ranked candidate is home", async () => {
    renderShell("/rank");

    await screen.findByRole("table", { name: /ranked candidates/i });
    expect(screen.queryByText("home")).toBeNull();
  });
});

describe("what the table cannot say inside itself", () => {
  it("explains the rows with no rank and the ones with no score", async () => {
    renderShell("/rank");

    await screen.findByRole("table", { name: /ranked candidates/i });

    expect(
      screen.getByText(/a candidate a gate ruled out has no rank/i),
    ).toHaveTextContent("never a zero");
  });
});

describe("a candidate that does not match", () => {
  it("stays in the table, keeping the score it computed", async () => {
    renderShell("/rank");

    expect(await cell("Spain", "Score")).toHaveTextContent("64");
    expect(await cell("Spain", "Match status")).toHaveTextContent(
      "Not matching",
    );
  });

  it("shows why it does not match", async () => {
    renderShell("/rank");

    expect(await cell("Spain", "Why this status")).toHaveTextContent(
      "No visa route this household qualifies for.",
    );
  });

  it("has no rank, and says so rather than leaving the cell blank", async () => {
    renderShell("/rank");

    // The dash this screen prints wherever a number is genuinely absent. An empty cell reads
    // as a table that failed to render -- and the previous assertion here was
    // `toHaveTextContent("")`, which matches any content at all and so checked nothing.
    // The caret that says the row opens shares the cell and is not part of the reading.
    const rank = await cell("Spain", "Rank");
    expect(rank.textContent?.replace(/[\u25B8\u25BE]/g, "")).toBe("—");
  });
});

describe("a candidate with insufficient data", () => {
  it("shows no number where a score would be", async () => {
    renderShell("/rank");

    const score = await cell("Estonia", "Score");

    expect(score).toHaveTextContent("No score");
    expect(score.textContent).not.toMatch(/\d/);
  });

  it("still shows its coverage, which is what explains the status", async () => {
    renderShell("/rank");

    expect(await cell("Estonia", "Coverage")).toHaveTextContent("41%");
    expect(await cell("Estonia", "Match status")).toHaveTextContent(
      "Insufficient data",
    );
  });
});

describe("when the ranking cannot be shown", () => {
  it("reports the failure with its code, and retries when asked", async () => {
    mockServer.use(http.get("/v1/rankings", () => HttpResponse.error()));
    renderShell("/rank");

    const rank = within(await screen.findByRole("region", { name: "Rank" }));
    const alert = await rank.findByRole("alert");
    expect(alert).toHaveTextContent("client.unreachable");

    mockServer.resetHandlers();
    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  /**
   * UX review R3, and the design's own treatment of it. `score_scale_max` is provisional by
   * design and has no default, so the shipped state refuses to rank -- and a fresh
   * installation meeting that as a red alert learns the product is broken on the day it was
   * installed. It is a state with a name, an explanation and the one button that lifts it:
   * not a fault, so **not an alert**, and not a "Try again" that would fail identically.
   */
  it("names the missing score range and offers the way to it", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json(
          {
            code: "score_scale_not_set",
            message: "score_scale_max is not set, so there is no scale to score onto.",
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/rank");

    const unset = within(
      await screen.findByRole("region", { name: "No ranking" }),
    );

    expect(
      unset.getByText(/a score has no meaning without a top of the range/i),
    ).toBeInTheDocument();
    expect(
      unset.getByRole("link", { name: /set it in configure/i }),
    ).toHaveAttribute("href", "/configure");
    expect(unset.queryByRole("button", { name: /try again/i })).toBeNull();

    // **Not an alert, and no code.** An expected state announced urgently, with a machine
    // identifier beside it, tells the reader something went wrong. Something did not.
    const rank = within(screen.getByRole("region", { name: "Rank" }));
    expect(rank.queryByRole("alert")).toBeNull();
    expect(rank.queryByText("score_scale_not_set")).toBeNull();
  });

  it("shows no ranking table at all while the score range is unset", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json(
          { code: "score_scale_not_set", message: "not set" },
          { status: 409 },
        ),
      ),
    );
    renderShell("/rank");

    await screen.findByRole("region", { name: "No ranking" });
    expect(
      screen.queryByRole("table", { name: /ranked candidates/i }),
    ).toBeNull();
  });

  it("says the ranking is empty rather than showing an empty table", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json({
          evaluation: null,
          criteria_set: "default",
          level: "country",
          computed_at: "2026-08-30T09:15:00Z",
          candidates: [],
        }),
      ),
    );
    renderShell("/rank");

    expect(
      await screen.findByText(/no candidate has been evaluated/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("asks for a selection rather than fetching a ranking of nothing", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets", () => HttpResponse.json({ items: [] })),
      http.get("/v1/levels", () => HttpResponse.json({ items: [] })),
    );
    renderShell("/rank");

    const rank = within(await screen.findByRole("region", { name: "Rank" }));
    await waitFor(() =>
      expect(
        rank.getByText(/choose a criteria set and a level/i),
      ).toBeInTheDocument(),
    );
    expect(rank.queryByText("Loading…")).not.toBeInTheDocument();
  });
});

describe("the drill-down", () => {
  it("shows every stored value for a candidate, the superseded ones included", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(table).getAllByText("Superseded")).toHaveLength(1);
    expect(within(table).getAllByText("Scored")).toHaveLength(2);
  });

  it("shows each figure with its source, both dates and its confidence", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(table).getByRole("row", {
      name: /total_tax_rate_effective/i,
    });
    expect(estimate).toHaveTextContent("41.5");
    expect(estimate).toHaveTextContent("eurostat_estimate");
    expect(estimate).toHaveTextContent("low");
  });

  /**
   * UX review M. Opening a second candidate used to close the first, so comparing what two
   * countries are scored on meant holding one of them in your head.
   */
  it("keeps a candidate's figures open when another candidate is opened", async () => {
    renderShell("/rank");

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button"),
    );
    await screen.findByRole("heading", { name: /Portugal: every value/i });

    await userEvent.click(
      within(await rankingRow("Netherlands")).getByRole("button"),
    );

    expect(
      await screen.findByRole("heading", {
        name: /Netherlands: every value/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Portugal: every value/i }),
    ).toBeInTheDocument();
  });

  /** Each open panel must be announced as its own candidate, not as the first one opened. */
  it("labels each open panel with its own candidate", async () => {
    renderShell("/rank");

    for (const name of ["Portugal", "Netherlands"]) {
      await userEvent.click(
        within(await rankingRow(name)).getByRole("button"),
      );
    }

    await screen.findByRole("region", { name: /Netherlands: every value/i });
    expect(
      screen.getByRole("region", { name: /Portugal: every value/i }),
    ).toBeInTheDocument();
  });

  it("closes one open candidate without closing the others", async () => {
    renderShell("/rank");

    for (const name of ["Portugal", "Netherlands"]) {
      await userEvent.click(
        within(await rankingRow(name)).getByRole("button"),
      );
    }
    await screen.findByRole("heading", { name: /Netherlands: every value/i });

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button"),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /Portugal: every value/i }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("heading", { name: /Netherlands: every value/i }),
    ).toBeInTheDocument();
  });

  /**
   * UX review N. `methodology_url` and `citations` were stored and never rendered, so "full
   * provenance on every displayed number" was true of the database and not of the screen.
   */
  it("links a publisher to how it says it reached its number", async () => {
    renderShell("/rank");
    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button"),
    );

    // Named by the section it belongs to. The caption that used to name it said "Not part of
    // any score", which the heading above the table already says.
    const outside = await screen.findByRole("table", {
      name: /outside opinions/i,
    });
    expect(
      within(outside).getByRole("link", { name: "numbeo" }),
    ).toHaveAttribute(
      "href",
      "https://www.numbeo.com/crime/indices_explained.jsp",
    );
  });

  it("links a figure to the pages it was read from", async () => {
    renderShell("/rank");
    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button"),
    );

    const figures = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(figures).getByRole("row", {
      name: /total_tax_rate_effective/i,
    });
    expect(within(estimate).getByRole("link", { name: /source 1/i })).toHaveAttribute(
      "href",
      "https://ec.europa.eu/eurostat/tax-benefit",
    );
  });

  /** The reason the URL is parsed rather than passed straight into `href`. */
  it("refuses to link a citation whose scheme would run something", async () => {
    renderShell("/rank");
    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button"),
    );

    const figures = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(figures).getByRole("row", {
      name: /total_tax_rate_effective/i,
    });
    expect(within(estimate).getAllByRole("link")).toHaveLength(1);
    expect(within(estimate).queryByRole("link", { name: /source 2/i })).toBeNull();
  });

  /**
   * The drill-down showed the figures a candidate has and said nothing about the ones it does
   * not, so a pillar scored from three attributes out of eight looked complete.
   */
  it("says how many of the set's attributes have no stored value", async () => {
    renderShell("/rank");

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button"),
    );

    // The set scores seven attributes; the mock stores figures for two of them.
    expect(
      await screen.findByText(
        "5 of the 7 attributes this set scores have no stored value.",
      ),
    ).toBeInTheDocument();
  });

  it("says so plainly when nothing is missing, rather than tinting that too", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({
          items: [
            "country.cost_of_living_index",
            "country.total_tax_rate_effective",
            "country.economic_outlook",
            "country.housing_cost_overburden_rate",
            "country.overcrowding_rate",
            "country.homicide_rate",
            "country.perceived_safety_index",
          ].map((attribute, at) => ({
            id: 700 + at,
            candidate: "country.portugal",
            attribute,
            value_type: "Count",
            payload: { count: at },
            data_source: "eurostat",
            reference_period: { start: "2025-01-01", end: "2025-12-31" },
            retrieval_date: "2026-09-11T08:00:00Z",
            confidence_level: "high",
            is_active: true,
          })),
          total: 7,
        }),
      ),
    );
    renderShell("/rank");

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button"),
    );

    expect(
      await screen.findByText(
        "Every attribute this set scores has a stored value.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps outside opinions in their own table, not among the figures", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );

    // Named by the section it belongs to. The caption that used to name it said "Not part of
    // any score", which the heading above the table already says.
    const outside = await screen.findByRole("table", {
      name: /outside opinions/i,
    });
    expect(
      within(outside).getByRole("rowheader", { name: "numbeo" }),
    ).toBeInTheDocument();
    const figures = screen.getByRole("table", { name: /every stored value/i });
    expect(within(figures).queryByText("numbeo")).toBeNull();
  });

  it("closes again", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );
    await userEvent.click(
      within(row).getByRole("button"),
    );

    expect(
      screen.queryByRole("table", { name: /every stored value/i }),
    ).toBeNull();
  });

  it("closes when the level changes under it", async () => {
    // P53: `chosen` was component state nothing cleared, so the open provenance panel survived
    // a switch to `city` while the table beneath it reloaded with cities. With no row matching
    // it, no button read "Hide figures" -- a stale panel with no visible way to close it.
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );
    expect(
      await screen.findByRole("table", { name: /every stored value/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "City" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("table", { name: /every stored value/i }),
      ).toBeNull(),
    );
  });

  it("closes when the criteria set changes under it", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );
    expect(
      await screen.findByRole("table", { name: /every stored value/i }),
    ).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /active criteria set/i }),
      "remote-only",
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("table", { name: /every stored value/i }),
      ).toBeNull(),
    );
  });

  it("says so when a candidate has no stored figures", async () => {
    renderShell("/rank");
    const row = await rankingRow("Estonia");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );

    expect(
      await screen.findByText(/no figure has been stored/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no outside index has been stored/i),
    ).toBeInTheDocument();
  });
});

describe("what a stored figure looks like, whatever its type", () => {
  /** One value of each payload shape the contract defines (`reqs.md` 3.3a). */
  const everyShape = [
    ["Quantity", { magnitude: 12.6, unit: "celsius" }, "12.6 celsius"],
    [
      "Monetary",
      { amount: 1410, currency: "EUR", amount_eur: 1410 },
      "1410 EUR",
    ],
    ["Ratio", { value: 26.4, basis: "households" }, "26.4"],
    ["Count", { count: 42 }, "42"],
    [
      // **An index means nothing without its bounds** (P57). This row used to expect the bare
      // "1.07", which locked in a render indistinguishable from a percentage -- and `reqs.md`
      // reserves `Index` for exactly the figures whose bounds do the work.
      "Index",
      { value: 1.07, provider: "World Bank", scale_min: -2.5, scale_max: 2.5 },
      "1.07 on -2.5–2.5 (World Bank)",
    ],
    [
      "AssignedScore",
      { value: 7, range_min: 0, range_max: 10, assigned_by: "human" },
      "7 on 0–10 (assigned by human)",
    ],
    ["LabelSet", { labels: ["Csb", "Csa"] }, "Csb, Csa"],
    ["Text", { body: "a note" }, "a note"],
    ["Boolean", { value: true }, "true"],
    [
      "ShareComposition",
      { shares: [{ label: "rail", share: 40 }] },
      "rail 40%",
    ],
  ] as const;

  it("prints each one in its own terms, converting nothing", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({
          items: everyShape.map(([valueType, payload], index) => ({
            id: 900 + index,
            candidate: "country.portugal",
            attribute: `country.example_${index}`,
            value_type: valueType,
            payload,
            data_source: "eurostat",
            reference_period: { start: "2025-01-01", end: "2025-12-31" },
            retrieval_date: "2026-09-11T08:00:00Z",
            confidence_level: "high",
            is_active: true,
          })),
          total: everyShape.length,
        }),
      ),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    for (const [, , shown] of everyShape) {
      expect(within(table).getByText(shown)).toBeInTheDocument();
    }
  });

  it("reports a failure to read the figures rather than showing an empty table", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json(
          { code: "not_found", message: "no such candidate" },
          { status: 404 },
        ),
      ),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no such candidate/i,
    );
  });

  it("reports a failure to read the outside opinions on its own", async () => {
    mockServer.use(
      http.get("/v1/external-scores", () =>
        HttpResponse.json(
          { code: "conflict", message: "cannot read outside scores" },
          { status: 409 },
        ),
      ),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cannot read outside scores/i,
    );
    expect(
      screen.getByRole("table", { name: /every stored value/i }),
    ).toBeInTheDocument();
  });

  it("shows a rejected figure as rejected, not as merely superseded", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({
          items: [
            {
              id: 950,
              candidate: "country.portugal",
              attribute: "country.cost_of_living_index",
              value_type: "Quantity",
              payload: { magnitude: 999, unit: "index_eu27_100" },
              data_source: "eurostat",
              reference_period: { start: "2025-01-01", end: "2025-12-31" },
              retrieval_date: "2026-09-11T08:00:00Z",
              confidence_level: "high",
              is_active: false,
              rejection_reason: "outside the attribute's allowed range",
            },
          ],
          total: 1,
        }),
      ),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button"),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    expect(within(table).getByText("Rejected")).toBeInTheDocument();
  });

  it("shows a warning beside the candidate it was raised for", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json({
          criteria_set: "default",
          level: "country",
          computed_at: "2026-09-12T09:00:00Z",
          candidates: [
            {
              candidate: "country.portugal",
              name: "Portugal",
              rank: 1,
              score: 78,
              coverage: 92,
              match_status: "matching",
              warnings: [
                {
                  compound_rule: "cheap_but_taxed",
                  detail: "cheap and heavily taxed",
                },
              ],
            },
          ],
        }),
      ),
    );
    renderShell("/rank");

    const row = await rankingRow("Portugal");

    expect(
      within(row).getByText(/cheap and heavily taxed/i),
    ).toBeInTheDocument();
  });
});
