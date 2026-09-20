import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
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
  const table = await screen.findByRole("table");
  return within(table).getByRole("row", { name: new RegExp(name) });
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
    expect(rank.getByText("Level").nextSibling).toHaveTextContent("country");
    expect(rank.getByText("Computed").nextSibling).toHaveTextContent(
      "30 Aug 2026, 09:15",
    );
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

    expect(await cell("Spain", "Reason")).toHaveTextContent(
      "No visa route this household qualifies for.",
    );
  });

  it("has no rank, and says so rather than leaving the cell blank", async () => {
    renderShell("/rank");

    // The dash this screen prints wherever a number is genuinely absent. An empty cell reads
    // as a table that failed to render -- and the previous assertion here was
    // `toHaveTextContent("")`, which matches any content at all and so checked nothing.
    expect((await cell("Spain", "Rank")).textContent).toBe("—");
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
      within(row).getByRole("button", { name: /show figures/i }),
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
      within(row).getByRole("button", { name: /show figures/i }),
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

  it("keeps outside opinions in their own table, not among the figures", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      within(row).getByRole("button", { name: /show figures/i }),
    );

    const outside = await screen.findByRole("table", {
      name: /not part of any score/i,
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
      within(row).getByRole("button", { name: /show figures/i }),
    );
    await userEvent.click(
      within(row).getByRole("button", { name: /hide figures/i }),
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
      within(row).getByRole("button", { name: /show figures/i }),
    );
    expect(
      await screen.findByRole("table", { name: /every stored value/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "city" }));

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
      within(row).getByRole("button", { name: /show figures/i }),
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
      within(row).getByRole("button", { name: /show figures/i }),
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
      within(row).getByRole("button", { name: /show figures/i }),
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
      within(row).getByRole("button", { name: /show figures/i }),
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
      within(row).getByRole("button", { name: /show figures/i }),
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
      within(row).getByRole("button", { name: /show figures/i }),
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
