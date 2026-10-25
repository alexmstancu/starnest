import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { STARTED_RUN_DETAIL } from "../../mocks/fixtures";
import type { RunDetail } from "../../api/endpoints";
import { mockServer } from "../../mocks/server";
import { expectNotHeld } from "../../testing/keyboard";
import { renderShell } from "../../testing/renderShell";
import { followEvery } from "./useFollowedRun";

/**
 * UI-24 (PL-117): **Acquire follows the run it shows**, without a click, and stops at its end.
 * The looks are no act: they never claim the card from the reader, never clear a refusal, never
 * hold a control, and the history is read again once, at the end.
 */

const BASE = "/v1";
const LOOK = 40;

/** Long enough for three looks to have gone out and been answered. */
async function threeLooks(): Promise<void> {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, LOOK * 3 + 60)));
}

function heldAnswer(): { held: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

function detailOf(runId: number, over: Partial<RunDetail> = {}): RunDetail {
  return {
    ...STARTED_RUN_DETAIL,
    id: runId,
    run_status: "running",
    finished_at: null,
    stop_requested_at: null,
    ...over,
  };
}

/**
 * Run 7 read as `status()` says at each read, counting the reads. The history's list says what
 * the mock's fixture says; only the card reads the detail.
 */
function serveRun7(status: () => Partial<RunDetail>): { reads: number } {
  const counted = { reads: 0 };
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs/7`, () => {
      counted.reads += 1;
      return HttpResponse.json(detailOf(7, status()));
    }),
  );
  return counted;
}

/** Reads of the history (the sidebar's and the strip's one-run looks are not counted). */
function countHistoryReads(): { count: number } {
  const reads = { count: 0 };
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
      if (new URL(request.url).searchParams.get("limit") !== "1") reads.count += 1;
    }),
  );
  return reads;
}

function countHoldingsReads(): { count: number } {
  const reads = { count: 0 };
  mockServer.use(
    http.get(`${BASE}/holdings`, () => {
      reads.count += 1;
    }),
  );
  return reads;
}

async function theCard() {
  return within(await screen.findByRole("region", { name: /acquisition 7/i }));
}

beforeEach(() => {
  followEvery(LOOK);
});

describe("following a live acquisition", () => {
  it("follows the run to its end without a click", async () => {
    let finished = false;
    serveRun7(() => (finished ? { run_status: "completed", finished_at: "2026-09-12T09:00:12Z" } : {}));
    renderShell("/acquire");
    const card = await theCard();
    expect(card.getByRole("heading", { name: "Acquiring now" })).toBeInTheDocument();

    finished = true;

    expect(await card.findByRole("heading", { name: "Acquisition finished" })).toBeInTheDocument();
  });

  it("says the run stopped once a stop takes effect", async () => {
    let halted = false;
    serveRun7(() =>
      halted
        ? { run_status: "halted_by_user", stop_requested_at: "2026-09-12T09:00:05Z", finished_at: "2026-09-12T09:00:09Z" }
        : { stop_requested_at: "2026-09-12T09:00:05Z" },
    );
    renderShell("/acquire");
    const card = await theCard();
    expect(card.getByRole("heading", { name: "Stopping after the source in flight" })).toBeInTheDocument();

    halted = true;

    expect(await card.findByRole("heading", { name: "Stopped by you" })).toBeInTheDocument();
  });

  it("stops asking once the run has ended", async () => {
    let finished = false;
    const run = serveRun7(() => (finished ? { run_status: "completed" } : {}));
    renderShell("/acquire");
    const card = await theCard();
    finished = true;
    await card.findByRole("heading", { name: "Acquisition finished" });
    const atTheEnd = run.reads;

    await threeLooks();

    expect(run.reads).toBe(atTheEnd);
  });

  it("never looks at a run that has already ended", async () => {
    const run = serveRun7(() => ({ run_status: "completed" }));
    renderShell("/acquire");
    await theCard();

    await threeLooks();

    expect(run.reads).toBe(1);
  });

  /** An answering 500, so the server is up (PL-002): a failed look is silent, and the next goes. */
  it("keeps looking after a failed read, and says nothing about it", async () => {
    let reads = 0;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/7`, () => {
        reads += 1;
        if (reads === 2) {
          return HttpResponse.json(
            { code: "internal_error", message: "the run could not be read" },
            { status: 500 },
          );
        }
        return HttpResponse.json(detailOf(7, reads > 2 ? { run_status: "completed" } : {}));
      }),
    );
    renderShell("/acquire");
    const card = await theCard();

    expect(await card.findByRole("heading", { name: "Acquisition finished" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** The guard against a look through `act`, which clears the refusal on screen. */
  it("leaves a refused start's banner standing through three looks", async () => {
    const run = serveRun7(() => ({}));
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json(
          {
            code: "run_already_in_flight",
            message: "run 7 is still going, and one household runs one pass at a time",
            details: { run: 7 },
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/acquire");
    await theCard();
    await userEvent.click(await screen.findByRole("button", { name: /estimate an acquisition/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /start this acquisition|yes, start it/i }),
    );
    expect(await screen.findByText(/the start did not go through/i)).toBeInTheDocument();
    const before = run.reads;

    await threeLooks();

    expect(run.reads).toBeGreaterThan(before);
    expect(screen.getByText(/the start did not go through/i)).toBeInTheDocument();
  });

  /** A look through `act` would hold every control while it read. */
  it("holds no control while a look is out", async () => {
    let reads = 0;
    const look = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/7`, async () => {
        reads += 1;
        if (reads > 1) await look.held;
        return HttpResponse.json(detailOf(7));
      }),
    );
    renderShell("/acquire");
    const card = await theCard();

    await waitFor(() => expect(reads).toBeGreaterThan(1));

    expectNotHeld(card.getByRole("button", { name: "Refresh" }));
    expectNotHeld(screen.getByRole("button", { name: /estimate an acquisition/i }));
    look.release();
  });

  /** The guard against a look that claims: run 8, which the reader started, stays on the card. */
  it("never brings back the old run over one the reader started", async () => {
    let reads = 0;
    const look = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/7`, async () => {
        reads += 1;
        if (reads > 1) await look.held;
        return HttpResponse.json(detailOf(7));
      }),
      http.get(`${BASE}/data-acquisition-runs/8`, () =>
        HttpResponse.json(detailOf(8, { run_status: "completed" })),
      ),
    );
    renderShell("/acquire");
    await theCard();
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    await userEvent.click(await screen.findByRole("button", { name: /estimate an acquisition/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /start this acquisition|yes, start it/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });

    look.release();
    await threeLooks();

    expect(screen.getByRole("region", { name: /acquisition 8/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /acquisition 7/i })).toBeNull();
  });

  /** A look sent before a Refresh, answered after it, does not stand over the Refresh. */
  it("never overwrites a Refresh with a look sent before it", async () => {
    let reads = 0;
    const look = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/7`, async () => {
        reads += 1;
        if (reads === 2) {
          await look.held;
          return HttpResponse.json(
            detailOf(7, { progress: { ...STARTED_RUN_DETAIL.progress, items_completed: 1 } }),
          );
        }
        return HttpResponse.json(
          detailOf(7, { progress: { ...STARTED_RUN_DETAIL.progress, items_completed: 90 } }),
        );
      }),
    );
    followEvery(LOOK);
    renderShell("/acquire");
    const card = await theCard();
    await waitFor(() => expect(reads).toBe(2));
    // Nothing more goes out while the held look waits.
    followEvery(3_600_000);

    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(reads).toBe(3));
    const refreshed = card.getAllByRole("img")[0]!.getAttribute("aria-label");
    look.release();
    await threeLooks();

    expect(card.getAllByRole("img")[0]!.getAttribute("aria-label")).toBe(refreshed);
  });

  it("stops looking at a run once another is opened", async () => {
    const run = serveRun7(() => ({}));
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/6`, () =>
        HttpResponse.json(detailOf(6, { run_status: "completed" })),
      ),
    );
    renderShell("/acquire");
    await theCard();
    await userEvent.click(within(await screen.findByRole("table")).getByRole("button", { name: /6/ }));
    await screen.findByRole("region", { name: /acquisition 6/i });
    const opened = run.reads;

    await threeLooks();

    expect(run.reads).toBe(opened);
  });

  it("stops looking once Acquire is left", async () => {
    const run = serveRun7(() => ({}));
    renderShell("/acquire");
    await theCard();
    await userEvent.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { level: 1, name: /rank/i });
    const left = run.reads;

    await threeLooks();

    expect(run.reads).toBe(left);
  });

  /** The end moves the history and what the database holds: each is read again, once. */
  it("reads the history and the holdings again exactly once, at the end", async () => {
    let finished = false;
    serveRun7(() => (finished ? { run_status: "completed" } : {}));
    renderShell("/acquire");
    const card = await theCard();
    await screen.findByRole("table");
    await threeLooks();
    const history = countHistoryReads();
    const holdings = countHoldingsReads();

    finished = true;
    await card.findByRole("heading", { name: "Acquisition finished" });
    await threeLooks();

    expect(history.count).toBe(1);
    expect(holdings.count).toBe(1);
  });
});
