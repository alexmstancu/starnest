import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { RUNS } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * UF-099 (PL-127): **the history says what each run was for**, from the purpose it recorded,
 * words a pair-scoped run by its items, and opens a run by "Open acquisition N". The sidebar's
 * link leads to the table itself.
 */

const BASE = "/v1";

function rowOf(region: HTMLElement, id: string) {
  return within(within(region).getByRole("rowheader", { name: id }).closest("tr")!);
}

async function theRegion() {
  return screen.findByRole("region", { name: "Every acquisition so far" });
}

async function theHistory() {
  return within(await theRegion());
}

describe("the acquisition history's rows", () => {
  it("says what each run was for, and words a pair-scoped run by its items", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({
          items: [
            {
              ...RUNS[0]!,
              id: 9,
              purpose: "retry",
              scope_candidates: 2,
              scope_attributes: 1,
              items_total: 2,
            },
            { ...RUNS[0]!, purpose: "sweep", scope_candidates: 32, scope_attributes: 3, items_total: 96 },
            { ...RUNS[2]!, purpose: null, scope_candidates: 32, scope_attributes: 3, items_total: 96 },
          ],
          total: 3,
        }),
      ),
    );
    renderShell("/acquire");
    const history = await theRegion();

    const retry = rowOf(history, "9");
    expect(retry.getByText("A retry of failures")).toBeInTheDocument();
    expect(retry.getByText(/2 items over 2 candidates/)).toBeInTheDocument();
    const sweep = rowOf(history, "7");
    expect(sweep.getByText("The whole level")).toBeInTheDocument();
    expect(sweep.getByText(/32 candidates over 3 attributes/)).toBeInTheDocument();
    // Not recorded, so not said: never guessed from its counts.
    const older = rowOf(history, "5");
    expect(older.queryByText(/whole level|retry|asked again|chosen items/i)).toBeNull();
  });

  it("opens a run with Open acquisition N", async () => {
    renderShell("/acquire");
    const history = await theHistory();

    await userEvent.click(history.getByRole("button", { name: "Open acquisition 6" }));

    expect(await screen.findByRole("region", { name: /acquisition 6/i })).toBeInTheDocument();
  });
});

describe("the sidebar's way to the history", () => {
  it("leads to the table itself, not the top of Acquire", async () => {
    renderShell("/configure");
    const link = await screen.findByRole("link", { name: "Acquisition history" });

    await userEvent.click(link);

    // The section, which the heading names (PL-018): focus lands on what is marked.
    const history = await screen.findByRole("region", { name: "Every acquisition so far" });
    await waitFor(() => expect(history).toHaveFocus());
  });
});
