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

function acquisitionIsRunning(
  completed: number,
  total: number,
  { failed = 0, stopRequestedAt = null }: { failed?: number; stopRequestedAt?: string | null } = {},
) {
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
        stop_requested_at: stopRequestedAt,
        progress: { items_total: total, items_completed: completed, items_failed: failed },
        failures: [],
      }),
    ),
  );
}

/** The strip itself, which is not a live region: what it announces is said apart (PL-131). */
function strip(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: /acquisition in progress/i });
}

function queryStrip(): HTMLElement | null {
  return screen.queryByRole("region", { name: /acquisition in progress/i });
}

afterEach(() => {
  // The bar polls; leaving a timer running past a test leaks it into the next one.
  mockServer.resetHandlers();
});

describe("the acquiring bar", () => {
  it("says what is running, and how far through it is", async () => {
    acquisitionIsRunning(24, 96);
    renderShell("/rank");

    const bar = await strip();
    expect(bar).toHaveTextContent(/acquiring/i);
    expect(bar).toHaveTextContent("24 of 96");
  });

  it("offers the way to the acquisition it is reporting", async () => {
    acquisitionIsRunning(1, 2);
    renderShell("/rank");

    const bar = await strip();
    expect(bar.querySelector("a")).toHaveAttribute("href", "/acquire");
  });

  /** On Acquire the run's own report says more than a strip could. */
  it("stays out of the way on the screen the acquisition belongs to", async () => {
    acquisitionIsRunning(24, 96);
    renderShell("/acquire");

    await screen.findByRole("heading", { name: "Acquire" });
    expect(queryStrip()).toBeNull();
  });

  it("says nothing at all when nothing is running", async () => {
    renderShell("/rank");

    await screen.findByRole("heading", { name: "Rank" });
    await waitFor(() => expect(queryStrip()).toBeNull());
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
    // The sidebar's last-run card says it could not read the runs; the strip says nothing.
    await waitFor(() => expect(screen.queryByText(/acquiring/i)).toBeNull());
  });

  /** A run that has not said how much there is to do has not failed to do any of it. */
  it("says it is starting before the run knows how much there is to do", async () => {
    acquisitionIsRunning(0, 0);
    renderShell("/rank");

    expect(await strip()).toHaveTextContent("starting");
  });
});

describe("PL-131: what the strip says, and what it announces", () => {
  it("counts the items that failed as done as well as those completed", async () => {
    acquisitionIsRunning(20, 96, { failed: 4 });
    renderShell("/rank");

    expect(await strip()).toHaveTextContent("24 of 96");
  });

  it("says Stopping… once somebody has asked the run to stop", async () => {
    acquisitionIsRunning(24, 96, { stopRequestedAt: "2026-09-21T09:05:00Z" });
    renderShell("/rank");

    const bar = await strip();
    expect(bar).toHaveTextContent("Stopping…");
    expect(bar).not.toHaveTextContent("Acquiring…");
  });

  it("says Acquiring… while nobody has asked it to stop", async () => {
    acquisitionIsRunning(24, 96);
    renderShell("/rank");

    expect(await strip()).toHaveTextContent("Acquiring…");
  });

  it("is not itself a live region, so a poll's new count is not read out", async () => {
    acquisitionIsRunning(24, 96);
    renderShell("/rank");

    const bar = await strip();
    expect(bar).not.toHaveAttribute("role", "status");
    expect(bar).not.toHaveAttribute("aria-live");
    expect(bar.closest("[aria-live], [role='status']")).toBeNull();
  });

  it("announces the start, and then the end, and nothing between", async () => {
    acquisitionIsRunning(24, 96);
    renderShell("/rank");
    await strip();
    const announcer = screen.getByTestId("acquisition-announcer");
    expect(announcer).toHaveAttribute("role", "status");
    expect(announcer).toHaveTextContent("An acquisition is running.");
    expect(announcer).not.toHaveTextContent("24");

    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({
          items: [
            {
              id: 42,
              run_status: "completed",
              triggered_by: "user",
              started_at: "2026-09-21T09:00:00Z",
              cost_eur: 0,
            },
          ],
          total: 1,
        }),
      ),
    );
    await waitFor(() => expect(announcer).toHaveTextContent("The acquisition has ended."), {
      timeout: 5000,
    });
    expect(queryStrip()).toBeNull();
  });

  it("announces nothing when nothing has run", async () => {
    renderShell("/rank");
    await screen.findByRole("heading", { name: "Rank" });

    expect(screen.getByTestId("acquisition-announcer")).toBeEmptyDOMElement();
  });
});
