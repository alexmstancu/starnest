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

    expect(await cell("Estonia", "Coverage")).toHaveTextContent("41.0%");
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

describe("choosing a pillar, from either half", () => {
  /**
   * **The chart and the cards are one selection shown twice.** The chart lives in the ranking
   * row and the cards in the panel underneath, and a reader who clicks one expects the other
   * to agree -- so the chosen pillar is held on the open row, above both.
   *
   * **A browser found what these tests could not.** The chart marked itself chosen while the
   * panel carried on showing every value, because `CandidateRow` built the row object it hands
   * to `detail()` without the chosen pillar on it. Both halves rendered, both were "correct",
   * and they disagreed. Asserting one and not the other is what let that through.
   */
  it("filters the panel when a bar in the row is clicked", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    await userEvent.click(
      await within(row).findByRole("button", { name: /^Economy:/ }),
    );

    // The panel's own heading is the proof: it names the pillar it is filtered to.
    expect(
      await screen.findByRole("heading", { name: /economy — stored values/i }),
    ).toBeInTheDocument();
  });

  it("marks the bar in the row when a card in the panel is clicked", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    // Scoped to the panel: "Economy" names the bar in the row *and* the card below it, which
    // is exactly what this feature is about, so an unscoped query is ambiguous by design.
    const panel = await screen.findByRole("region", {
      name: /Portugal: every value/i,
    });
    await userEvent.click(
      within(panel).getByRole("button", { name: /^Economy\b/ }),
    );

    await waitFor(() =>
      expect(
        within(row).getByRole("button", { name: /^Economy:/ }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("clears both halves when the chosen pillar is chosen again", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));
    const bar = await within(row).findByRole("button", { name: /^Economy:/ });

    await userEvent.click(bar);
    await waitFor(() => expect(bar).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(bar);

    await waitFor(() => expect(bar).toHaveAttribute("aria-pressed", "false"));
    expect(
      await screen.findByRole("heading", { name: /every stored value/i }),
    ).toBeInTheDocument();
  });

  /**
   * Clicking a bar must not toggle the row shut: the row itself is the open/close target, so
   * the bar stops the click from reaching it.
   *
   * **This test is kept for its failure message, not for its coverage.** It detects exactly
   * one mutation -- the lost `stopPropagation` in `RankingTable`'s pillar bar -- and the two
   * tests above it detect that one too. What it adds is how it fails: a direct `expect` that
   * goes red in under half a second and names the row closing, where the others fail by a
   * five-second `waitFor` timeout on a heading that never arrives. In CI that is the
   * difference between reading the cause and going looking for it. Were the bar's handler
   * ever moved onto the row, this would be the test to delete rather than the one to fix.
   */
  it("leaves the row open when a bar inside it is clicked", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));
    await screen.findByRole("heading", { name: /every value behind the score/i });

    await userEvent.click(
      await within(row).findByRole("button", { name: /^Safety:/ }),
    );

    expect(
      screen.getByRole("heading", { name: /every value behind the score/i }),
    ).toBeInTheDocument();
  });
});

describe("the drill-down", () => {
  it("shows every stored value for a candidate, the superseded ones included", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const rows = within(table).getAllByRole("row").slice(1);
    // Four figures: two for the cost of living index, of which one is superseded, the tax
    // estimate, and the air connectivity count that no criterion scores.
    expect(rows).toHaveLength(4);
    expect(within(table).getAllByText("Superseded")).toHaveLength(1);
    expect(within(table).getAllByText("Scored")).toHaveLength(3);
  });

  it("shows each figure with its source, both dates and its confidence", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(table).getByRole("row", {
      name: /total effective tax rate/i,
    });
    expect(estimate).toHaveTextContent("41.5");
    expect(estimate).toHaveTextContent("eurostat_estimate");
    expect(estimate).toHaveTextContent("low");
  });

  /**
   * **The folding, as a reader meets it.** `repeatedValues.ts` is tested thoroughly and none
   * of it was rendered: deleting the whole "Fetched again" block from `CandidateDetail` left
   * every test in this folder green, so the feature could stop appearing and the only thing
   * that would notice is a person looking at the screen.
   *
   * An acquisition appends what it fetched without asking whether it changed, so one Eurostat
   * figure can sit in the store twenty-six times. The panel says that once, with a count, in
   * place of twenty-six identical rows -- and says what did not change rather than printing a
   * bare number beside a date.
   */
  it("says once that a figure was stored again, instead of repeating the row", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const connectivity = within(table).getByRole("row", {
      name: /european air connectivity/i,
    });
    expect(connectivity).toHaveTextContent("Fetched again");
    expect(connectivity).toHaveTextContent(
      "unchanged across 2 acquisitions, first on 11 Sept 2025",
    );
  });

  /**
   * **The other half of the same claim.** "Fetched again" on a figure stored once would be a
   * line about an event that did not happen, which is worse than no line -- and a test that
   * only asserts the sentence appears would pass with the `copies > 1` guard deleted.
   */
  it("says nothing about repeats for a figure stored only once", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(table).getByRole("row", {
      name: /total effective tax rate/i,
    });
    expect(estimate).not.toHaveTextContent("Fetched again");
    expect(estimate).not.toHaveTextContent(/unchanged across/);
  });

  /**
   * UX review M. Opening a second candidate used to close the first, so comparing what two
   * countries are scored on meant holding one of them in your head.
   */
  it("keeps a candidate's figures open when another candidate is opened", async () => {
    renderShell("/rank");

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );
    await screen.findByRole("heading", { name: /Portugal: every value/i });

    await userEvent.click(
      within(await rankingRow("Netherlands")).getByRole("button", { name: "Netherlands" }),
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
        within(await rankingRow(name)).getByRole("button", { name }),
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
        within(await rankingRow(name)).getByRole("button", { name }),
      );
    }
    await screen.findByRole("heading", { name: /Netherlands: every value/i });

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
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
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
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
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    const figures = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(figures).getByRole("row", {
      name: /total effective tax rate/i,
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
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    const figures = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(figures).getByRole("row", {
      name: /total effective tax rate/i,
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
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
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
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
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
      within(row).getByRole("button", { name: "Portugal" }),
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
      within(row).getByRole("button", { name: "Portugal" }),
    );
    await userEvent.click(
      within(row).getByRole("button", { name: "Portugal" }),
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
      within(row).getByRole("button", { name: "Portugal" }),
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
      within(row).getByRole("button", { name: "Portugal" }),
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
      within(row).getByRole("button", { name: "Estonia" }),
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
    [
      // **A ratio is a share of something** (P78), and the contract makes `basis` required.
      // This row expected the bare "26.4" -- the same mistake as the Index below, for the
      // same reason, and it sat four lines above the comment explaining it.
      "Ratio",
      { value: 26.4, basis: "households" },
      "26.4% of Households",
    ],
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
    // `true` is what JSON carries; it is not what anybody calls the state of an agreement.
    ["Boolean", { value: true }, "Yes"],
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
      within(row).getByRole("button", { name: "Portugal" }),
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
      within(row).getByRole("button", { name: "Portugal" }),
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
      within(row).getByRole("button", { name: "Portugal" }),
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
      within(row).getByRole("button", { name: "Portugal" }),
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

describe("what the pass made of each figure", () => {
  /**
   * `reqs.md` 5.4, through `GET /rankings/candidates/{id}`. **The weight a set configures and
   * the weight a pass used are different numbers.** An attribute with no figure drops out and
   * its share spreads over the ones that have one, so a table showing only the configured
   * weight leaves a reader unable to see where a missing figure went -- which is the question
   * "why is this score what it is" mostly comes down to.
   *
   * These numbers were reachable before only by saving the ranking first, because the drill-down
   * that had them took an evaluation id.
   */
  async function theValues() {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));
    return within(
      await screen.findByRole("table", { name: /every stored value/i }),
    );
  }

  it("prints the score, the weight used and the points added, all the server's", async () => {
    const table = await theValues();

    // The active figure, not the one it superseded: both rows carry the attribute's name, and
    // the pass scored the one it is using.
    const row = table
      .getAllByRole("row", { name: /cost of living index/i })
      .find((each) => each.textContent?.includes("Scored"));
    expect(row).toHaveTextContent("73");
    expect(row).toHaveTextContent("12.5%");
    expect(row).toHaveTextContent("+9.1");
  });

  it("keeps the configured weight beside the one the pass used", async () => {
    // Both, because they answer different questions: what this set says the attribute is
    // worth, and what it was actually worth once the missing figures had been redistributed.
    const table = await theValues();

    expect(table.getByRole("columnheader", { name: "Weight" })).toBeInTheDocument();
    expect(
      table.getByRole("columnheader", { name: "Weight used" }),
    ).toBeInTheDocument();
  });

  it("says nothing where the ranking scored nothing", async () => {
    // `european_air_connectivity` is counted and never scored (`reqs.md` 3.0, Q228): a figure
    // with no criterion attached. Its three columns are blank rather than nought, because
    // "not judged" and "judged to be worth nothing" are different claims.
    const table = await theValues();

    const row = table.getByRole("row", { name: /european air connectivity/i });
    expect(row).toHaveTextContent("31");
    expect(row).not.toHaveTextContent(/[+-]?\d+\.\d/);
  });
});
