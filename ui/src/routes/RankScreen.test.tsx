import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { renderShell } from "../testing/renderShell";

/**
 * The ranking table, tested against the three cases `reqs.md` makes rules about: a matching
 * candidate with a score, a **non-matching** candidate that keeps its score, and one with
 * **insufficient data** that must not show a number at all.
 *
 * Every assertion here is about a figure the mock served. There is no arithmetic in the
 * screen, so there is nothing else worth asserting.
 */

/** Cells in document order: rank, score, coverage, match status, reason. The name is a rowheader. */
async function rankingRow(name: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table");
  return within(table).getByRole("row", { name: new RegExp(name) });
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

    const cells = within(await rankingRow("Portugal")).getAllByRole("cell");

    expect(cells[0]).toHaveTextContent("1");
    expect(cells[1]).toHaveTextContent("78");
    expect(cells[2]).toHaveTextContent("92.4%");
    expect(cells[3]).toHaveTextContent("Matching");
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

    const cells = within(await rankingRow("Spain")).getAllByRole("cell");

    expect(cells[1]).toHaveTextContent("64");
    expect(cells[3]).toHaveTextContent("Not matching");
  });

  it("shows why it does not match", async () => {
    renderShell("/rank");

    const cells = within(await rankingRow("Spain")).getAllByRole("cell");

    expect(cells[4]).toHaveTextContent(
      "No visa route this household qualifies for.",
    );
  });

  it("has no rank, and nothing is invented to fill the column", async () => {
    renderShell("/rank");

    const cells = within(await rankingRow("Spain")).getAllByRole("cell");

    expect(cells[0]).toHaveTextContent("");
  });
});

describe("a candidate with insufficient data", () => {
  it("shows no number where a score would be", async () => {
    renderShell("/rank");

    const cells = within(await rankingRow("Estonia")).getAllByRole("cell");

    expect(cells[1]).toHaveTextContent("No score");
    expect(cells[1]?.textContent).not.toMatch(/\d/);
  });

  it("still shows its coverage, which is what explains the status", async () => {
    renderShell("/rank");

    const cells = within(await rankingRow("Estonia")).getAllByRole("cell");

    expect(cells[2]).toHaveTextContent("41%");
    expect(cells[3]).toHaveTextContent("Insufficient data");
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
