import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { renderShell } from "../testing/renderShell";

/**
 * The strip under the tabs while an acquisition is running.
 *
 * **It exists because the thing it reports is happening somewhere else.** An acquisition
 * takes minutes and the reason to start one is usually to go and look at something; a
 * progress bar that only exists on the tab you left is a progress bar nobody sees.
 */

const BASE = "/v1";

function acquisitionIsRunning(completed: number, total: number) {
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs`, () =>
      HttpResponse.json({
        items: [
          {
            id: 42,
            run_status: "running",
            triggered_by: "user",
            started_at: "2026-09-21T09:00:00Z",
            cost_eur: 0,
          },
        ],
        total: 1,
      }),
    ),
    http.get(`${BASE}/data-acquisition-runs/:runId`, () =>
      HttpResponse.json({
        id: 42,
        run_status: "running",
        triggered_by: "user",
        started_at: "2026-09-21T09:00:00Z",
        progress: { items_total: total, items_completed: completed },
        failures: [],
      }),
    ),
  );
}

afterEach(() => {
  // The bar polls; leaving a timer running past a test leaks it into the next one.
  mockServer.resetHandlers();
});

describe("the acquiring bar", () => {
  it("says what is running, and how far through it is", async () => {
    acquisitionIsRunning(24, 96);
    renderShell("/rank");

    const bar = await screen.findByRole("status");
    expect(bar).toHaveTextContent(/acquiring/i);
    expect(bar).toHaveTextContent("24 of 96");
  });

  it("offers the way to the acquisition it is reporting", async () => {
    acquisitionIsRunning(1, 2);
    renderShell("/rank");

    const bar = await screen.findByRole("status");
    expect(bar.querySelector("a")).toHaveAttribute("href", "/acquire");
  });

  /** On Acquire the run's own report says more than a strip could. */
  it("stays out of the way on the screen the acquisition belongs to", async () => {
    acquisitionIsRunning(24, 96);
    renderShell("/acquire");

    await screen.findByRole("heading", { name: "Acquire" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says nothing at all when nothing is running", async () => {
    renderShell("/rank");

    await screen.findByRole("heading", { name: "Rank" });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  /**
   * **Silent on failure.** A banner that cannot be read is not worth an error message on
   * every screen; the Acquire tab is where a failure to read a run belongs, and it reports
   * one there.
   */
  it("shows nothing rather than an error when it cannot read the runs", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () => HttpResponse.error()),
    );
    renderShell("/rank");

    await screen.findByRole("heading", { name: "Rank" });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  /** A run that has not said how much there is to do has not failed to do any of it. */
  it("says it is starting before the run knows how much there is to do", async () => {
    acquisitionIsRunning(0, 0);
    renderShell("/rank");

    expect(await screen.findByRole("status")).toHaveTextContent("starting");
  });
});
