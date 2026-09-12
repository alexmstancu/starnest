import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { renderShell } from "../testing/renderShell";

/**
 * The Run tab: estimate, confirm, watch, and retry only what failed (`reqs.md` 6.3, 6.4).
 *
 * The rule these tests hold is that **nothing is fetched until the estimate has been seen and
 * accepted**, and that a failure is something to act on rather than only to read.
 */

const BASE = "/v1";

async function estimate() {
  await userEvent.click(
    await screen.findByRole("button", { name: /estimate a run/i }),
  );
}

describe("estimating a run", () => {
  it("shows what the run would do before anything is fetched", async () => {
    renderShell("/run");

    await estimate();

    expect(
      await screen.findByText(/what this run would do/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: /per source/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
  });

  it("does not start a run until the estimate is accepted", async () => {
    const started: string[] = [];
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, () => {
        started.push("started");
        return HttpResponse.json({ id: 9 }, { status: 202 });
      }),
    );
    renderShell("/run");

    await estimate();

    expect(started).toEqual([]);
    expect(
      screen.getByRole("button", { name: /start this run/i }),
    ).toBeInTheDocument();
  });

  it("reports a refusal rather than leaving the screen looking idle", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, () =>
        HttpResponse.json(
          { code: "conflict", message: "no level" },
          { status: 409 },
        ),
      ),
    );
    renderShell("/run");

    await estimate();

    expect(await screen.findByRole("alert")).toHaveTextContent(/no level/i);
  });
});

describe("running and retrying", () => {
  it("shows the run's progress and what it could not answer", async () => {
    renderShell("/run");
    await estimate();

    await userEvent.click(
      screen.getByRole("button", { name: /start this run/i }),
    );

    expect(
      await screen.findByRole("heading", { name: /run 8/i }),
    ).toBeInTheDocument();
    const failures = screen.getByRole("table", { name: /what went wrong/i });
    expect(
      within(failures).getByRole("rowheader", { name: "oecd" }),
    ).toBeInTheDocument();
    expect(
      within(failures).getByText(/browser challenge/i),
    ).toBeInTheDocument();
  });

  it("retries only what failed, as a new run", async () => {
    const retried: number[] = [];
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry`, ({ params }) => {
        retried.push(Number(params["runId"]));
        return HttpResponse.json({ id: 12 }, { status: 202 });
      }),
    );
    renderShell("/run");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this run/i }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /retry only what failed/i }),
    );

    expect(retried).toEqual([8]);
    expect(
      await screen.findByRole("heading", { name: /run 12/i }),
    ).toBeInTheDocument();
  });

  it("offers no retry when nothing failed", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, () =>
        HttpResponse.json({
          id: 8,
          run_status: "completed",
          triggered_by: "user",
          started_at: "2026-09-12T09:00:00Z",
          progress: { items_total: 96, items_completed: 96, items_failed: 0 },
          failures: [],
        }),
      ),
    );
    renderShell("/run");
    await estimate();

    await userEvent.click(
      screen.getByRole("button", { name: /start this run/i }),
    );

    expect(
      await screen.findByText(/nothing failed in this run/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry only what failed/i }),
    ).toBeNull();
  });
});

describe("what nobody answered", () => {
  /**
   * `reqs.md` Q217. An item every source answered without having a figure for that candidate.
   *
   * **Not a failure, and not a score.** The screen used to say "nothing failed in this run"
   * about a run with items like this in it, which was true and useless: the run had learned
   * nothing about that country and said so nowhere.
   */
  async function openTheRun() {
    renderShell("/run");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this run/i }),
    );
    return await screen.findByRole("heading", { name: /run 8/i });
  }

  it("counts them beside what answered and what failed", async () => {
    await openTheRun();

    // A `dd` takes no accessible name from its `dt`, so the label is found and its value read
    // beside it -- which is also what a reader does.
    expect(screen.getByText("Unanswered").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Failed").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Answered").nextSibling).toHaveTextContent("93");
  });

  it("names the items, so the reader knows which country learned nothing", async () => {
    await openTheRun();

    const table = screen.getByRole("table", { name: /answered by nobody/i });

    expect(
      within(table).getAllByRole("rowheader", {
        name: "country.liechtenstein",
      }),
    ).toHaveLength(2);
    expect(
      within(table).getByText("country.overcrowding_rate"),
    ).toBeInTheDocument();
  });

  it("asks again about only those items, as a new run", async () => {
    const asked: { run: number; items: unknown }[] = [];
    mockServer.use(
      http.post(
        `${BASE}/data-acquisition-runs/:runId/retry`,
        async ({ params, request }) => {
          const body = (await request.json()) as { items?: string };
          asked.push({ run: Number(params["runId"]), items: body.items });
          return HttpResponse.json({ id: 14 }, { status: 202 });
        },
      ),
    );
    await openTheRun();

    await userEvent.click(screen.getByRole("button", { name: /ask again/i }));

    expect(asked).toEqual([{ run: 8, items: "unanswered" }]);
    expect(
      await screen.findByRole("heading", { name: /run 14/i }),
    ).toBeInTheDocument();
  });

  it("offers nothing to ask again when every item was answered or failed", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, () =>
        HttpResponse.json({
          id: 8,
          run_status: "completed",
          triggered_by: "user",
          started_at: "2026-09-12T09:00:00Z",
          progress: {
            items_total: 96,
            items_completed: 96,
            items_failed: 0,
            items_unanswered: 0,
          },
          failures: [],
          unanswered: [],
        }),
      ),
    );
    await openTheRun();

    expect(screen.queryByRole("button", { name: /ask again/i })).toBeNull();
    expect(
      screen.queryByRole("table", { name: /answered by nobody/i }),
    ).toBeNull();
  });

  it("shows the refusal when the server says there is nothing to ask about", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry`, () =>
        HttpResponse.json(
          {
            code: "nothing_to_ask_again",
            message: "this run has no unanswered items",
          },
          { status: 409 },
        ),
      ),
    );
    await openTheRun();

    await userEvent.click(screen.getByRole("button", { name: /ask again/i }));

    expect(await screen.findByText(/no unanswered items/i)).toBeInTheDocument();
  });
});

describe("the run history", () => {
  it("lists recent runs with their status and cost", async () => {
    renderShell("/run");

    const history = await screen.findByRole("table");
    expect(
      within(history).getByRole("rowheader", { name: "7" }),
    ).toBeInTheDocument();
    expect(
      within(history).getByText("halted_on_spend_cap"),
    ).toBeInTheDocument();
  });

  it("opens a past run's detail", async () => {
    renderShell("/run");
    const history = await screen.findByRole("table");
    const row = within(history).getByRole("row", { name: /^7/ });

    await userEvent.click(within(row).getByRole("button", { name: /open/i }));

    expect(
      await screen.findByRole("heading", { name: /run 7/i }),
    ).toBeInTheDocument();
  });
});

describe("when there is nothing to show", () => {
  it("asks for a level before offering an estimate", async () => {
    mockServer.use(
      http.get(`${BASE}/levels`, () => HttpResponse.json({ items: [] })),
    );
    renderShell("/run");

    expect(
      await screen.findByText(/choose a level to plan a run/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /estimate a run/i }),
    ).toBeNull();
  });

  it("says so when no run has been started", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );
    renderShell("/run");

    expect(
      await screen.findByText(/no run has been started yet/i),
    ).toBeInTheDocument();
  });

  it("refreshes a run's progress on demand", async () => {
    let polled = 0;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, () => {
        polled += 1;
        return HttpResponse.json({
          id: 8,
          run_status: "completed",
          triggered_by: "user",
          started_at: "2026-09-12T09:00:00Z",
          progress: { items_total: 96, items_completed: 96, items_failed: 0 },
          failures: [],
        });
      }),
    );
    renderShell("/run");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this run/i }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /refresh/i }),
    );

    expect(polled).toBe(2);
  });
});
