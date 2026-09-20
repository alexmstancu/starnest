import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import { renderShell } from "../../testing/renderShell";
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

describe("the attribute drill-down", () => {
  it("asks for an attribute before fetching anything", async () => {
    renderShell("/rank");
    const panel = await theDrillDown();

    expect(
      within(panel).getByText(/choose an attribute to see which candidates/i),
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
    expect(within(table).getByRole("rowheader", { name: "country.portugal" })).toBeInTheDocument();
    expect(within(table).getByText("eurostat")).toBeInTheDocument();
  });

  it("says an attribute nobody measures is a hole in the score, not an empty table", async () => {
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
    // this says what the absence costs -- the weight goes to the rest of the pillar.
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
