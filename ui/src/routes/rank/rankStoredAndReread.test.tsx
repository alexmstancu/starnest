import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

const BASE = "/v1";

function rank(): HTMLElement {
  return screen.getByRole("region", { name: "Rank" });
}

function storedValues(total: number): void {
  mockServer.use(http.get(`${BASE}/values`, () => HttpResponse.json({ items: [], total })));
}

/**
 * PL-011 on Rank. **With nothing stored there is nothing to rank**, said with the way to fill
 * the database -- decided from the stored-value count, never from every candidate reading No
 * score, and never from a count still on its way or one that failed.
 */
describe("Rank with nothing stored", () => {
  it("says there is nothing to rank yet, leads to Acquire, and offers no Save", async () => {
    storedValues(0);
    renderShell("/rank");

    const card = await within(rank()).findByRole("region", { name: "Nothing to rank yet" });
    expect(within(card).getByRole("link", { name: "Go to Acquire" })).toHaveAttribute(
      "href",
      "/acquire",
    );
    expect(within(rank()).queryByRole("table")).toBeNull();
    expect(within(rank()).queryByRole("button", { name: /save this ranking/i })).toBeNull();
  });

  it("draws the ranking once any value is stored, however little it scores", async () => {
    storedValues(1);
    renderShell("/rank");

    expect(await within(rank()).findByRole("table")).toBeInTheDocument();
    expect(within(rank()).queryByRole("region", { name: "Nothing to rank yet" })).toBeNull();
  });

  it("when the count could not be read, says so with Try again and still ranks", async () => {
    mockServer.use(
      http.get(`${BASE}/values`, () =>
        HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 }),
      ),
    );
    renderShell("/rank");

    expect(
      await within(rank()).findByText(/whether any values are stored could not be loaded/i),
    ).toBeInTheDocument();
    expect(await within(rank()).findByRole("table")).toBeInTheDocument();
    expect(within(rank()).queryByRole("region", { name: "Nothing to rank yet" })).toBeNull();
  });
});

/**
 * PL-015 on Rank. **A ranking read again because a run ended says so, politely**: rows may have
 * moved under the reader. Not for a re-read that failed.
 */
describe("Rank when an acquisition ends", () => {
  function aRunThatEnds(): { end: () => void } {
    let status = "running";
    const run = { id: 8, triggered_by: "user", started_at: "2026-09-21T09:00:00Z", cost_eur: 0 };
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({ items: [{ ...run, run_status: status }], total: 1 }),
      ),
      http.get(`${BASE}/data-acquisition-runs/:runId`, () =>
        HttpResponse.json({ ...run, run_status: status, progress: {}, failures: [] }),
      ),
    );
    return { end: () => (status = "completed") };
  }

  it("says the ranking was read again after acquisition 8 ended", async () => {
    const run = aRunThatEnds();
    renderShell("/rank");
    await within(rank()).findByRole("table");
    await screen.findByRole("region", { name: /acquisition in progress/i });
    expect(rank()).not.toHaveTextContent(/read again/);

    run.end();

    await waitFor(
      () =>
        expect(rank()).toHaveTextContent(
          "The ranking was read again after acquisition 8 ended.",
        ),
      { timeout: 6_000 },
    );
    // In a polite live region, so it is heard without moving anyone.
    expect(
      within(rank()).getByText("The ranking was read again after acquisition 8 ended."),
    ).toHaveAttribute("role", "status");
  });

  it("says nothing of the kind when the ranking could not be read again", async () => {
    const run = aRunThatEnds();
    renderShell("/rank");
    await within(rank()).findByRole("table");
    await screen.findByRole("region", { name: /acquisition in progress/i });

    mockServer.use(
      http.get(`${BASE}/rankings`, () =>
        HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 }),
      ),
    );
    run.end();

    expect(
      await within(rank()).findByText(/could not be refreshed/i, undefined, { timeout: 6_000 }),
    ).toBeInTheDocument();
    expect(rank()).not.toHaveTextContent(/read again after/);
  });
});
