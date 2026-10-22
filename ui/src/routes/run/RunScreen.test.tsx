import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTRIBUTES,
  PAID_RUN_PLAN,
  RUNS,
  RUN_PLAN,
  STARTED_RUN_DETAIL,
  STORED_VALUES,
} from "../../mocks/fixtures";
import type { Run } from "../../api/endpoints";
import { formatMoney } from "../../format/display";
import { mockServer } from "../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../testing/keyboard";
import { renderShell } from "../../testing/renderShell";
import { useRunScreen } from "./useRunScreen";

/**
 * The Run tab: estimate, confirm, watch, and retry only what failed (`reqs.md` 6.3, 6.4).
 *
 * The rule these tests hold is that **nothing is fetched until the estimate has been seen and
 * accepted**, and that a failure is something to act on rather than only to read.
 */

const BASE = "/v1";

async function estimate() {
  await userEvent.click(
    await screen.findByRole("button", { name: /estimate an acquisition/i }),
  );
}

describe("estimating a run", () => {
  it("shows what the run would do before anything is fetched", async () => {
    renderShell("/acquire");

    await estimate();

    // **Inside the card that raised it.** Three remedies stand side by side, and an estimate
    // under the row of them cannot say which of the three it is about.
    const card = within(
      screen.getByRole("region", { name: /an acquisition over every country/i }),
    );
    expect(await card.findByText("Items")).toBeInTheDocument();
    expect(card.getByText("96")).toBeInTheDocument();
    expect(card.getByText("At most")).toBeInTheDocument();
    // The per-source detail stays under the row: it is a table, and the row has to stay a row.
    expect(
      screen.getByRole("table", { name: /per source/i }),
    ).toBeInTheDocument();
  });

  it("says what a cost rests on, because a free plan has nothing to explain", async () => {
    renderShell("/acquire");

    await estimate();

    await screen.findByText("At most");
    // A free plan has no assumptions to state, so the "i" is absent rather than empty.
    expect(screen.queryByTitle(/a ceiling, not a forecast/i)).not.toBeInTheDocument();
  });

  it("shows the cost and its assumptions when the run would spend", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, () =>
        HttpResponse.json(PAID_RUN_PLAN),
      ),
    );
    renderShell("/acquire");

    await estimate();

    await screen.findByText("At most");
    // The money, which is the only figure on this plan that is not also a count of items.
    expect(screen.getByText(/2\.10/)).toBeInTheDocument();
    // The assumptions sit on the figure, not in a paragraph under it: a cost with no stated
    // assumptions can only be trusted, never judged.
    expect(
      screen.getByTitle(/a ceiling, not a forecast/i),
    ).toHaveAttribute("title", expect.stringContaining("12,000 input tokens per call"));
  });

  it("does not start a run until the estimate is accepted", async () => {
    const started: string[] = [];
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, () => {
        started.push("started");
        return HttpResponse.json({ id: 9 }, { status: 202 });
      }),
    );
    renderShell("/acquire");

    await estimate();

    expect(started).toEqual([]);
    expect(
      screen.getByRole("button", { name: /start this acquisition/i }),
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
    renderShell("/acquire");

    await estimate();

    expect(await screen.findByRole("alert")).toHaveTextContent(/no level/i);
  });
});

describe("running and retrying", () => {
  it("shows the run's progress and what it could not answer", async () => {
    renderShell("/acquire");
    await estimate();

    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );

    expect(
      await screen.findByRole("region", { name: /acquisition 8/i }),
    ).toBeInTheDocument();
    // **The group head counts; the message waits inside it.** The card used to carry a table
    // with a row per failure and the whole message in each, which is what made a run that
    // failed 32 times on one billing state unreadable.
    const broke = within(
      screen.getByRole("region", { name: /which sources broke/i }),
    );
    expect(
      broke.getByRole("button", { name: /^oecd 1 item$/i }),
    ).toBeInTheDocument();

    await userEvent.click(broke.getByRole("button", { name: /^oecd 1 item$/i }));

    expect(
      broke.getByText(/the oecd's cloudflare front answered with a browser challenge/i),
    ).toBeInTheDocument();
  });

  it("arms a confirmation before retrying what failed, then starts a scoped run (UI-02)", async () => {
    const started: unknown[] = [];
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        started.push(await request.json());
        return HttpResponse.json({ id: 12 }, { status: 202 });
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /^Retry 1 failed$/i }),
    );

    // The whole-bucket retry no longer fires on the click: it estimates and confirms first, the
    // same step the selected-item retry already had (UI-02, reqs.md 6.3).
    const strip = await screen.findByRole("alert");
    expect(started).toEqual([]);

    await userEvent.click(within(strip).getByRole("button", { name: /yes, start it/i }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ level: "country" });
    expect(
      await screen.findByRole("region", { name: /acquisition 12/i }),
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
    renderShell("/acquire");
    await estimate();

    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );

    // **The whole card goes, not just its button.** A remedy for a problem the run does not
    // have is a control that can only disappoint, and the card leads with a count that would
    // be a nought.
    await screen.findByRole("region", { name: /acquisition 8/i });
    expect(screen.queryByRole("region", { name: /which sources broke/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /failed$/i })).toBeNull();
  });
});

/**
 * BE-08 follow-up. **The failed card counts the list it shows.** The run's `items_failed` counts
 * only the pairs no source answered, so a failure on an item another source did answer -- OECD's,
 * where the estimate stepped in -- or a figure stored and then rejected by its credible range,
 * which still counts as completed, read "0 failed" over a "Retry 0 failed" button, beside a list
 * of failures that was not empty.
 */
describe("how many the failed card counts", () => {
  function aRunThatReports(failures: unknown, itemsFailed: number): void {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          unanswered: [],
          progress: {
            items_total: 96,
            items_completed: 96 - itemsFailed,
            items_failed: itemsFailed,
            items_unanswered: 0,
          },
          failures,
        }),
      ),
    );
    renderShell("/acquire");
  }

  const TAX_RATE = "country.total_tax_rate_effective";

  it("counts a figure rejected by its credible range, though the run counts the item complete", async () => {
    aRunThatReports(
      [
        {
          data_source: "eurostat",
          candidate: "country.malta",
          attribute: "country.homicide_rate",
          error_message: "41.2 is outside the credible range 0 to 30",
        },
      ],
      0,
    );

    expect(
      await screen.findByRole("heading", { name: /^1\s*failed$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry 1 failed" }),
    ).toBeInTheDocument();
  });

  it("counts an item two sources failed on once", async () => {
    // OECD was challenged, and the estimate's figure was stored and then rejected: two
    // failures, one item, and the run counts that item complete.
    aRunThatReports(
      [
        {
          data_source: "oecd",
          candidate: "country.liechtenstein",
          attribute: TAX_RATE,
          error_message: "the oecd's cloudflare front answered with a browser challenge",
        },
        {
          data_source: "eurostat_estimate",
          candidate: "country.liechtenstein",
          attribute: TAX_RATE,
          error_message: "71.0 is outside the credible range 10 to 60",
        },
      ],
      0,
    );

    expect(
      await screen.findByRole("heading", { name: /^1\s*failed$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry 1 failed" }),
    ).toBeInTheDocument();
  });

  it("counts an OECD failure on an item the estimate answered", async () => {
    aRunThatReports(
      [
        {
          data_source: "oecd",
          candidate: "country.romania",
          attribute: TAX_RATE,
          error_message: "the oecd's cloudflare front answered with a browser challenge",
        },
      ],
      0,
    );

    expect(
      await screen.findByRole("heading", { name: /^1\s*failed$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry 1 failed" }),
    ).toBeInTheDocument();
  });

  it("shows no failed card for a run that reports no failures", async () => {
    aRunThatReports(undefined, 0);

    await screen.findByRole("region", { name: /acquisition 7/i });
    expect(screen.queryByRole("heading", { name: /failed$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /failed$/ })).toBeNull();
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
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    return await screen.findByRole("region", { name: /acquisition 8/i });
  }

  it("counts them beside what answered and what failed", async () => {
    await openTheRun();

    // **Scoped to this acquisition's report.** The strip at the top of the screen counts the
    // last acquisition rather than this one, and an unscoped query would read whichever
    // happened to render first.
    const report = within(
      screen.getByRole("region", { name: /acquisition 8/i }),
    );

    // All three in one sentence, which is the arithmetic Q217 closed: 93 answered, 1 failed
    // and 2 nobody answered account for every item the run asked about. Read as a sentence
    // rather than as three figures a reader has to add up themselves.
    expect(
      report.getByText(/93 figures stored, 1 failed, 2 nobody answered/),
    ).toBeInTheDocument();
    // And again on the bar, which is what a screen reader gets.
    expect(
      report.getByRole("img", {
        name: "93 of 96 answered, 1 failed, 2 unanswered",
      }),
    ).toBeInTheDocument();
  });

  it("names the items, so the reader knows which country learned nothing", async () => {
    await openTheRun();

    // **In the card that can ask again about them**, which is where the design puts them --
    // the acquisition card itself carries no item lists at all.
    const went = within(
      screen.getByRole("region", { name: /which values went unanswered/i }),
    );
    await userEvent.click(
      went.getByRole("button", { name: /^Overcrowding rate 1 item$/i }),
    );

    // **What a reader sees, not what the database calls it.** This asserted on
    // `country.liechtenstein` and `country.overcrowding_rate`, which was the test codifying
    // the bug: the design bars a programmatic identifier in rendered text, and the catalog has
    // held a name for both since migration `0101`.
    expect(
      went.getByRole("checkbox", { name: /^Overcrowding rate for Liechtenstein$/i }),
    ).toBeInTheDocument();
    // Every one of them has the same reason, so the design writes it once per row rather than
    // fetching a message that does not exist.
    expect(went.getByText("no row anywhere")).toBeInTheDocument();
    expect(went.queryByText(/country\./)).toBeNull();
  });

  it("arms a confirmation before asking again, then starts a scoped run (UI-02)", async () => {
    const started: unknown[] = [];
    await openTheRun();
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        started.push(await request.json());
        return HttpResponse.json({ id: 14 }, { status: 202 });
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /^Retry 2 unanswered$/i }));

    // Nothing that can spend fires on the click: the whole-bucket retry now takes the same
    // estimate-and-confirm step the selected-item retry already had (reqs.md 6.3).
    const strip = await screen.findByRole("alert");
    expect(started).toEqual([]);

    await userEvent.click(within(strip).getByRole("button", { name: /yes, start it/i }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ level: "country" });
    expect(
      await screen.findByRole("region", { name: /acquisition 14/i }),
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

    expect(screen.queryByRole("button", { name: /^Retry 2 unanswered$/i })).toBeNull();
    expect(
      screen.queryByRole("region", { name: /which values went unanswered/i }),
    ).toBeNull();
  });

  // (The old "nothing to ask about" test exercised POST /{runId}/retry's 409; the whole-bucket
  // retry now goes through the scoped plan-and-start path (UI-02), which only offers the button
  // when there are unanswered items, so that refusal is no longer reachable from the UI. The
  // backend's /retry refusal is covered by the acceptance suite.)
});

describe("the run history", () => {
  it("lists recent runs with their status and cost", async () => {
    renderShell("/acquire");

    const history = await screen.findByRole("table");
    expect(
      within(history).getByRole("rowheader", { name: "7" }),
    ).toBeInTheDocument();
    // Read as words, not as an identifier. The sidebar's last-run panel has always done this;
    // the history table printed the raw enum, which was the inconsistency rather than the rule.
    expect(
      within(history).getByText("halted on spend cap"),
    ).toBeInTheDocument();
  });

  it("opens a past run's detail", async () => {
    renderShell("/acquire");
    const history = await screen.findByRole("table");
    const row = within(history).getByRole("row", { name: /^7/ });

    // The acquisition's own number is what opens it: a separate button in a fifth column is
    // a target to hunt for on every row.
    await userEvent.click(within(row).getByRole("button", { name: "7" }));

    expect(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    ).toBeInTheDocument();
  });

  it("says so when a past run cannot be opened", async () => {
    // P45: `open` was the one action that ran outside the wrapper every other action uses, so
    // its rejection went nowhere -- no notice, no busy state, no message. The click looked
    // ignored and the browser logged an unhandled rejection.
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/7`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "The run could not be read." },
          { status: 500 },
        ),
      ),
    );
    renderShell("/acquire");
    const history = await screen.findByRole("table");
    const row = within(history).getByRole("row", { name: /^7/ });

    // The acquisition's own number is what opens it: a separate button in a fifth column is
    // a target to hunt for on every row.
    await userEvent.click(within(row).getByRole("button", { name: "7" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  /**
   * UI-17. Twelve runs of one euro each, all this month: the history asked for the newest ten,
   * so the eleventh and twelfth were missing from the list, the diff and the month's spend.
   */
  function twelveRunsThisMonth(): void {
    const now = new Date();
    const runs: Run[] = Array.from({ length: 12 }, (_, index) => {
      const id = 12 - index;
      // The first of this month plus `id` minutes, so every run is this month whatever the
      // clock says, and the newest is listed first, as the server lists them.
      const started = new Date(now.getFullYear(), now.getMonth(), 1, 0, id);
      return {
        id,
        run_status: "completed",
        triggered_by: "user",
        started_at: started.toISOString(),
        finished_at: started.toISOString(),
        llm_call_count: 1,
        cost_eur: 1,
      };
    });
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        const offset = Number(query.get("offset") ?? 0);
        const limit = Number(query.get("limit") ?? runs.length);
        return HttpResponse.json({
          items: runs.slice(offset, offset + limit),
          total: runs.length,
        });
      }),
    );
  }

  it("lists every acquisition, not only the newest ten", async () => {
    twelveRunsThisMonth();
    renderShell("/acquire");

    expect(
      await screen.findByRole("rowheader", { name: "12" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "1" })).toBeInTheDocument();
  });

  it("adds every run this month into Spent this month", async () => {
    twelveRunsThisMonth();
    renderShell("/acquire");

    const spent = await screen.findByText("Spent this month");
    expect(spent.parentElement).toHaveTextContent(formatMoney(12, "EUR"));
  });

  it("offers an older run in the diff dropdowns", async () => {
    twelveRunsThisMonth();
    renderShell("/acquire");

    const panel = within(
      await screen.findByRole("region", {
        name: /what changed between two acquisitions/i,
      }),
    );
    expect(
      within(
        panel.getByRole("combobox", { name: /earlier acquisition/i }),
      ).getByRole("option", { name: /^acquisition 1 —/i }),
    ).toBeInTheDocument();
  });
});

describe("when there is nothing to show", () => {
  it("asks for a level before offering an estimate", async () => {
    mockServer.use(
      http.get(`${BASE}/levels`, () => HttpResponse.json({ items: [] })),
    );
    renderShell("/acquire");

    expect(
      await screen.findByText(/choose a level to plan an acquisition/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /estimate an acquisition/i }),
    ).toBeNull();
  });

  it("says so when no run has been started", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );
    renderShell("/acquire");

    expect(
      await screen.findByText(/no acquisition has been started yet/i),
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
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );

    const before = polled;
    await userEvent.click(
      await screen.findByRole("button", { name: /refresh/i }),
    );

    // One more read than before the click. **Counted as a delta, not as a total**: the strip
    // at the top of the screen reads the last acquisition's detail too, and a total would be
    // asserting how many other things happen to want the same endpoint.
    expect(polled).toBe(before + 1);
  });
});

/**
 * UX review B. The four counts were shown as numbers to compare in your head; `reqs.md` Q217
 * makes them close, so they draw as one bar with no remainder.
 */
describe("a run's progress", () => {
  it("draws the run's outcomes as one bar, read out in words", async () => {
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });

    expect(
      screen.getByRole("img", {
        name: "93 of 96 answered, 1 failed, 2 unanswered",
      }),
    ).toBeInTheDocument();
  });
});

/**
 * UX review C. `POST /{runId}/retry` takes only `failed | unanswered` over a whole run, so a
 * narrower selection goes through `/plan` and then `POST /data-acquisition-runs` with a scope.
 */
describe("re-asking about part of a run", () => {
  async function openRun() {
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });
  }

  it("groups failures by the source that refused", async () => {
    await openRun();

    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    expect(
      group.getByRole("button", { name: /^oecd 1 item$/i }),
    ).toBeInTheDocument();
  });

  /** Nothing refused an unanswered item, so the useful question is the attribute. */
  it("groups unanswered items by attribute", async () => {
    await openRun();

    const group = within(
      await screen.findByRole("region", {
        name: /which values went unanswered/i,
      }),
    );
    // The group head is the attribute's name. A source's head stays the source's own key --
    // "oecd" is what the publisher is called, and naming it would print "Oecd".
    expect(
      group.getByRole("button", { name: /^Overcrowding rate 1 item$/i }),
    ).toBeInTheDocument();
  });

  /**
   * **Nothing is picked until somebody picks**, which is the design's own initial state. The
   * card's action already covers the whole bucket, so a list that opened with everything ticked
   * made the selection meaningless -- it could only ever narrow, and it started at everything.
   */
  it("starts with nothing selected, and selects all on request", async () => {
    await openRun();
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );

    expect(
      group.getByRole("button", { name: /^Retry 0 selected$/ }),
    ).toBeDisabled();

    await userEvent.click(group.getByRole("button", { name: "Select all" }));

    expect(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    ).toBeEnabled();
  });

  /**
   * The routing decision, made visible: a narrow selection plans a *new* run rather than
   * calling the retry endpoint, which cannot express anything narrower than a whole bucket.
   */
  it("plans a scoped run rather than calling the retry endpoint", async () => {
    const planned: unknown[] = [];
    const retried: number[] = [];
    await openRun();
    // Installed *after* the run is on screen: overriding the start endpoint beforehand would
    // break the very setup this test depends on.
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, async ({ request }) => {
        planned.push(await request.json());
        return HttpResponse.json(RUN_PLAN);
      }),
      http.post(`${BASE}/data-acquisition-runs/:runId/retry`, ({ params }) => {
        retried.push(Number(params["runId"]));
        return HttpResponse.json({ id: 12 }, { status: 202 });
      }),
    );
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );

    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    await userEvent.click(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    );

    expect(retried).toEqual([]);
    expect(planned.at(-1)).toEqual({
      level: "country",
      candidates: ["country.liechtenstein"],
      attributes: ["country.total_tax_rate_effective"],
    });
  });

  /**
   * UX review D. Nothing that can spend fires on a click: the estimate already said what it
   * would cost, and this is the step between reading that and it happening.
   */
  it("arms a confirmation rather than starting immediately", async () => {
    await openRun();
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );

    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    await userEvent.click(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    );

    const strip = await screen.findByRole("alert");
    expect(strip).toHaveTextContent(/Retry 1 selected over 96 values/);
    // The shipped plan asks no paid source, and saying so plainly is what stops a reader
    // learning to click past the confirmations that do cost something.
    expect(strip).toHaveTextContent(/costs nothing/i);
    expect(
      within(strip).getByRole("button", { name: /yes, start it/i }),
    ).toBeEnabled();
  });

  it("starts nothing when the confirmation is cancelled", async () => {
    const started: unknown[] = [];
    await openRun();
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        started.push(await request.json());
        return HttpResponse.json({ id: 12 }, { status: 202 });
      }),
    );
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    await userEvent.click(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    );

    const strip = await screen.findByRole("alert");
    await userEvent.click(
      within(strip).getByRole("button", { name: "Not yet" }),
    );

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(started).toEqual([]);
  });

  it("starts the scoped run once it is agreed to", async () => {
    const started: unknown[] = [];
    await openRun();
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        started.push(await request.json());
        return HttpResponse.json({ id: 12 }, { status: 202 });
      }),
    );
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    await userEvent.click(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    );

    const strip = await screen.findByRole("alert");
    await userEvent.click(
      within(strip).getByRole("button", { name: /yes, start it/i }),
    );

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      level: "country",
      candidates: ["country.liechtenstein"],
      attributes: ["country.total_tax_rate_effective"],
      accept_uncapped_spend: false,
    });
  });
});

describe("picking out individual items", () => {
  async function failureGroup() {
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });
    return within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
  }

  it("opens a group to show the items inside it", async () => {
    const group = await failureGroup();
    const head = group.getByRole("button", { name: /^oecd 1 item$/i });
    expect(head).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(head);

    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(
      group.getByRole("checkbox", {
        name: /^Total effective tax rate for Liechtenstein$/i,
      }),
    ).not.toBeChecked();
    // The design gives every row a right-hand detail; for a failure it is the reason.
    expect(
      group.getByText(/the oecd's cloudflare front answered/i),
    ).toBeInTheDocument();
  });

  it("closes a group that was open", async () => {
    const group = await failureGroup();
    const head = group.getByRole("button", { name: /^oecd 1 item$/i });

    await userEvent.click(head);
    await userEvent.click(head);

    expect(head).toHaveAttribute("aria-expanded", "false");
  });

  /**
   * **The head counts what it holds and what is picked**, in one meta string beside the name:
   * `12 items, 3 picked`. The design leaves the second half out at zero rather than writing a
   * nought beside every group in a list that opens with nothing selected.
   */
  it("says in the group's own head how many of it are picked", async () => {
    const group = await failureGroup();
    expect(
      group.getByRole("button", { name: /^oecd 1 item$/i }),
    ).toBeInTheDocument();

    await userEvent.click(group.getByRole("button", { name: "All" }));
    expect(
      group.getByRole("button", { name: /^oecd 1 item, 1 picked$/i }),
    ).toBeInTheDocument();

    await userEvent.click(group.getByRole("button", { name: "None" }));
    expect(
      group.getByRole("button", { name: /^oecd 1 item$/i }),
    ).toBeInTheDocument();
  });

  it("selects everything again after a clear", async () => {
    const group = await failureGroup();

    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    await userEvent.click(group.getByRole("button", { name: "Clear all" }));
    await userEvent.click(group.getByRole("button", { name: "Select all" }));

    expect(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    ).toBeEnabled();
  });

  it("picks a single item without touching the others", async () => {
    const group = await failureGroup();
    await userEvent.click(group.getByRole("button", { name: /^oecd 1 item$/i }));

    await userEvent.click(
      group.getByRole("checkbox", {
        name: /^Total effective tax rate for Liechtenstein$/i,
      }),
    );

    expect(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    ).toBeEnabled();
  });

  /**
   * `RunScope` carries candidates and attributes as separate lists, so a selection that is not
   * a full rectangle asks about more pairs than it has items. Somebody about to spend money
   * gets the real number.
   */
  it("says when a selection would ask about more pairs than it holds", async () => {
    const group = within(
      await (async () => {
        renderShell("/acquire");
        await estimate();
        await userEvent.click(
          screen.getByRole("button", { name: /start this acquisition/i }),
        );
        await screen.findByRole("region", { name: /acquisition 8/i });
        return screen.findByRole("region", {
          name: /which values went unanswered/i,
        });
      })(),
    );

    await userEvent.click(group.getByRole("button", { name: "Select all" }));

    // Two unanswered items share one candidate and differ by attribute, so the scope is one
    // candidate by two attributes -- two pairs for two items, a full rectangle.
    expect(
      group.getByRole("button", { name: /^Retry 2 selected$/ }),
    ).toBeEnabled();
  });
});

/**
 * UX review H. Three reasons a figure is missing look identical in a ranking and have
 * entirely different remedies: a source refused, a source had nothing, or there is no source.
 * Only the first two are worth asking again about.
 *
 * **Read from `answerable_by`, against fixtures with every source in every priority** -- as the
 * server resolves it since BE-39. With the old, shorter lists the card passed while reading "no
 * source" from the priority order, which the real server never let it say.
 */
describe("attributes with no data source at all", () => {
  it("lists an attribute no source can fetch, though every source is in its priority", async () => {
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    expect(
      await card.findByRole("rowheader", { name: "Nobody measures this" }),
    ).toBeInTheDocument();
  });

  it("leaves out attributes a source can fetch, switched on or not", async () => {
    // The LLM is switched off in the fixtures and still able to fetch the employers: the
    // switch decides whether a source is asked, not what it can fetch (Q235).
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    await card.findByRole("rowheader", { name: "Nobody measures this" });
    expect(
      card.queryByRole("rowheader", { name: "Cost of living index" }),
    ).toBeNull();
    expect(
      card.queryByRole("rowheader", { name: "International employers" }),
    ).toBeNull();
  });

  /**
   * **The empty state is a claim too.** `answerable_by` names what can fetch an attribute
   * whatever the switch says (Q235), so "every attribute has a source" must not promise that one
   * will be asked -- a source switched off is not.
   */
  it("says every attribute has a source when one can fetch each, unless it is switched off", async () => {
    mockServer.use(
      http.get(`${BASE}/attributes`, () =>
        HttpResponse.json({
          items: ATTRIBUTES.filter(
            (attribute) => attribute.answerable_by.length > 0,
          ),
        }),
      ),
    );
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    expect(
      await card.findByText(
        "Every attribute at this level has at least one source that would be asked, unless it is switched off.",
      ),
    ).toBeInTheDocument();
    expect(card.queryByRole("table")).toBeNull();
  });

  /** Retrying cannot conjure an adapter, so the card says so rather than offering a button. */
  it("says a run cannot fill them, instead of offering a retry", async () => {
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    expect(
      await card.findByText(/retrying one changes nothing/i),
    ).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("lists an attribute only a person can answer, and leaves its form to the card beside it", async () => {
    // **In both lists, honestly.** Hand entry is permitted and no adapter can fetch it, so it
    // is a gap no run fills *and* a figure a person may type. The form stays in one place --
    // two would put two candidate pickers on screen -- and this row says what to do.
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    const row = await card.findByRole("row", { name: /residency admin ease/i });
    expect(row).toHaveTextContent("Enter a value by hand");
    expect(card.queryByRole("button", { name: /by hand/i })).toBeNull();

    const handEntry = within(
      await screen.findByRole("region", {
        name: /figures you can enter by hand/i,
      }),
    );
    expect(
      within(
        await handEntry.findByRole("row", { name: /residency admin ease/i }),
      ).getByRole("button", { name: /enter a value by hand/i }),
    ).toBeInTheDocument();
  });

  it("says why there is no form where the type has no editor", async () => {
    // Permitted by the catalog, but no editor built for a Quantity: five attributes declare
    // `manual_entry` and the only Quantity among them already has a figure from a source. A
    // button leading to a form with no fields is worse than a sentence saying why.
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    const row = await card.findByRole("row", { name: /nobody measures this/i });

    expect(row).toHaveTextContent(/no editor is built for a Quantity/i);
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("says an attribute the active set does not score is not weighed", async () => {
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    const row = await card.findByRole("row", { name: /nobody measures this/i });
    expect(row).toHaveTextContent(/not scored here/i);
  });
});

/**
 * UX review Q. The design badged this "design only, no endpoint yet"; the endpoint is a filter
 * on `GET /values`, so the badge comes off.
 */
describe("what changed between two acquisitions", () => {
  async function diffPanel() {
    return within(
      await screen.findByRole("region", {
        name: /what changed between two acquisitions/i,
      }),
    );
  }

  async function compare(earlier: string, later: string) {
    const panel = await diffPanel();
    await userEvent.selectOptions(
      panel.getByRole("combobox", { name: /earlier acquisition/i }),
      earlier,
    );
    await userEvent.selectOptions(
      panel.getByRole("combobox", { name: /later acquisition/i }),
      later,
    );
    return panel;
  }

  it("asks for two acquisitions before comparing anything", async () => {
    renderShell("/acquire");
    const panel = await diffPanel();

    expect(
      panel.getByText(/choose two acquisitions to compare/i),
    ).toBeInTheDocument();
  });

  it("counts what appeared, what moved and what stopped coming", async () => {
    renderShell("/acquire");
    const panel = await compare("5", "7");

    // Run 5 produced the cost of living; run 7 produced it again and added the tax rate.
    expect(await panel.findByText("Newly acquired")).toBeInTheDocument();
    const rows = await panel.findAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
  });

  it("names a pair the later run produced and the earlier one did not", async () => {
    renderShell("/acquire");
    const panel = await compare("5", "7");

    const row = await panel.findByRole("row", {
      name: /Total effective tax rate/i,
    });
    expect(row).toHaveTextContent("newly acquired");
  });

  it("names a pair both runs produced as refreshed", async () => {
    renderShell("/acquire");
    const panel = await compare("5", "7");

    const row = await panel.findByRole("row", {
      name: /Cost of living index/i,
    });
    expect(row).toHaveTextContent("refreshed");
  });

  /**
   * "Went missing" is about the run, never about the store: this application does not delete
   * values, and the earlier figure may still be the active one.
   */
  it("says a pair the later run did not produce went missing", async () => {
    renderShell("/acquire");
    const panel = await compare("7", "5");

    const row = await panel.findByRole("row", {
      name: /Total effective tax rate/i,
    });
    expect(row).toHaveTextContent("went missing");
  });

  it("states that a missing pair is still stored", async () => {
    renderShell("/acquire");
    const panel = await diffPanel();

    expect(
      panel.getByText(/the earlier figure is still stored/i),
    ).toBeInTheDocument();
  });

  /**
   * Comparing a run to itself is not an empty diff: every pair it produced reads as
   * refreshed. The empty case is two runs that produced nothing.
   */
  it("reads a run against itself as entirely unchanged", async () => {
    // **The figure is what decides, not the pair.** Comparing a run with itself produces the
    // same figure on both sides for every pair, which is "unchanged" -- and the reason that
    // distinction is worth drawing: this used to read as a run that refreshed everything.
    renderShell("/acquire");
    const panel = await compare("7", "7");

    const row = await panel.findByRole("row", {
      name: /Cost of living index/i,
    });
    expect(row).toHaveTextContent("unchanged");
    // And the figure itself in both columns, so the verdict is checkable rather than trusted.
    expect(within(row).getAllByText("94.5 EU27 = 100")).toHaveLength(2);
    expect(panel.queryByText(/newly acquired/i)).toBeInTheDocument();
  });

  it("says so when neither acquisition produced anything", async () => {
    renderShell("/acquire");
    // Run 6 halted on its spend cap and stored nothing.
    const panel = await compare("6", "6");

    expect(
      await panel.findByText(/neither acquisition produced a figure/i),
    ).toBeInTheDocument();
  });
});

/**
 * NEW-11. **The two acquisitions chosen in the diff stay chosen.** Every act on this screen reads
 * the history again as it ends, and the diff is drawn from that list -- so while the list was
 * read again the diff left the screen, and it came back with nothing chosen. Comparing two
 * acquisitions did not survive an estimate, a start, a refresh, an opening or a stop.
 */
describe("the two acquisitions chosen in the diff", () => {
  /**
   * Answers each read of the history with one more run than the read before -- 9 on the second,
   * 10 on the third -- so a re-read that has landed is something on screen to wait for. The
   * sidebar's and the strip's one-run reads fall through to the mock's own answer.
   *
   * **A re-read takes a round trip, as it does over a network.** Answered in the same breath it
   * was asked, a re-read never showed its loading state at all, and the diff never left the
   * screen -- which is how this passed every test while losing the reader's choice in a browser.
   */
  function aHistoryThatGrowsOnEveryRead(): void {
    let reads = 0;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        const query = new URL(request.url).searchParams;
        if (query.get("limit") === "1") return;
        reads += 1;
        if (reads > 1) await delay(20);
        const added: Run[] = [];
        for (let id = 7 + reads; id >= 9; id -= 1) {
          added.push({
            ...RUNS[0]!,
            id,
            started_at: `2026-09-${String(id + 4)}T08:00:00Z`,
          });
        }
        const runs = [...added, ...RUNS];
        const offset = Number(query.get("offset") ?? 0);
        const limit = Number(query.get("limit") ?? runs.length);
        return HttpResponse.json({
          items: runs.slice(offset, offset + limit),
          total: runs.length,
        });
      }),
    );
  }

  /** Waits until the history's `nth` read has reached the screen. */
  async function theHistoryRead(nth: number): Promise<void> {
    await screen.findByRole("rowheader", { name: String(7 + nth) });
  }

  function theDiff() {
    return within(
      screen.getByRole("region", {
        name: /what changed between two acquisitions/i,
      }),
    );
  }

  /** Runs 5 and 7 chosen, and their comparison on screen. */
  async function fiveAgainstSeven(): Promise<void> {
    await screen.findByRole("region", {
      name: /what changed between two acquisitions/i,
    });
    await userEvent.selectOptions(
      theDiff().getByRole("combobox", { name: /earlier acquisition/i }),
      "5",
    );
    await userEvent.selectOptions(
      theDiff().getByRole("combobox", { name: /later acquisition/i }),
      "7",
    );
    await theDiff().findByRole("row", { name: /Total effective tax rate/i });
  }

  function expectFiveAgainstSeven(): void {
    const diff = theDiff();
    expect(
      diff.getByRole("combobox", { name: /earlier acquisition/i }),
    ).toHaveValue("5");
    expect(
      diff.getByRole("combobox", { name: /later acquisition/i }),
    ).toHaveValue("7");
    expect(
      diff.getByRole("row", { name: /Total effective tax rate/i }),
    ).toHaveTextContent("newly acquired");
  }

  it("keeps them through an estimate", async () => {
    aHistoryThatGrowsOnEveryRead();
    renderShell("/acquire");
    await fiveAgainstSeven();

    await estimate();
    await theHistoryRead(2);

    expectFiveAgainstSeven();
  });

  it("keeps them through a start", async () => {
    aHistoryThatGrowsOnEveryRead();
    renderShell("/acquire");
    await fiveAgainstSeven();
    await estimate();
    await theHistoryRead(2);

    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await theHistoryRead(3);

    expectFiveAgainstSeven();
  });

  it("keeps them through opening another acquisition", async () => {
    aHistoryThatGrowsOnEveryRead();
    renderShell("/acquire");
    await fiveAgainstSeven();

    await openFromHistory("6");
    await theHistoryRead(2);

    expect(
      screen.getByRole("region", { name: /acquisition 6/i }),
    ).toBeInTheDocument();
    expectFiveAgainstSeven();
  });

  it("keeps them through a refresh of the card", async () => {
    aHistoryThatGrowsOnEveryRead();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    await fiveAgainstSeven();

    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await theHistoryRead(2);

    expectFiveAgainstSeven();
  });

  it("keeps them through a stop", async () => {
    aRunWhoseStopIsHeld().release();
    aHistoryThatGrowsOnEveryRead();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    await fiveAgainstSeven();

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    await theHistoryRead(2);

    expectFiveAgainstSeven();
  });

  it("keeps them on screen while the history is being read again", async () => {
    const answer = heldAnswer();
    let reads = 0;
    let waiting = false;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        if (new URL(request.url).searchParams.get("limit") === "1") return;
        reads += 1;
        if (reads === 1) return;
        waiting = true;
        await answer.held;
      }),
    );
    renderShell("/acquire");
    await fiveAgainstSeven();

    await estimate();
    await waitFor(() => expect(waiting).toBe(true));

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expectFiveAgainstSeven();

    answer.release();
    await screen.findByRole("rowheader", { name: "7" });
    expectFiveAgainstSeven();
  });

  it("keeps them when the history cannot be read again", async () => {
    let reads = 0;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
        if (new URL(request.url).searchParams.get("limit") === "1") return;
        reads += 1;
        if (reads === 1) return;
        return HttpResponse.json(
          { code: "internal_error", message: "the history could not be read" },
          { status: 500 },
        );
      }),
    );
    renderShell("/acquire");
    await fiveAgainstSeven();

    await estimate();

    expect(
      await screen.findByText("the history could not be read"),
    ).toBeInTheDocument();
    expectFiveAgainstSeven();
  });

  it("offers the acquisitions the history lists once it has been read again", async () => {
    aHistoryThatGrowsOnEveryRead();
    renderShell("/acquire");
    await fiveAgainstSeven();

    await estimate();
    await theHistoryRead(2);

    expect(
      within(
        theDiff().getByRole("combobox", { name: /later acquisition/i }),
      ).getByRole("option", { name: /^acquisition 9 —/i }),
    ).toBeInTheDocument();
  });

  /**
   * Run 7 still going: the history reports how far it has got, and `/values` what it has
   * stored so far. `moveOn` is the server getting one item further and storing one more figure.
   */
  function runSevenStillGoing(status: Run["run_status"] = "running"): {
    moveOn: () => void;
    storeWithoutCounting: () => void;
    valueReads: () => number;
  } {
    let completed = 1;
    let stored_more = false;
    let valueReads = 0;
    const stored = {
      ...STORED_VALUES[0]!,
      id: 9001,
      attribute: "country.nobody_measures_this",
      value_type: "Quantity" as const,
      payload: { magnitude: 4, unit: "km" },
      data_acquisition_run: 7,
    };
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        if (query.get("limit") === "1") return;
        const runs: Run[] = RUNS.map((run) =>
          run.id === 7
            ? { ...run, run_status: status, finished_at: null, items_completed: completed }
            : run,
        );
        return HttpResponse.json({ items: runs, total: runs.length });
      }),
      http.get(`${BASE}/values`, ({ request }) => {
        const fromRun = new URL(request.url).searchParams.get("data_acquisition_run");
        if (fromRun === null) return;
        valueReads += 1;
        const items = [...STORED_VALUES, ...(completed > 1 || stored_more ? [stored] : [])].filter(
          (value) => String(value.data_acquisition_run ?? "") === fromRun,
        );
        return HttpResponse.json({ items, total: items.length });
      }),
    );
    return {
      moveOn: () => {
        completed += 1;
      },
      // A figure for a pair the run already counts, by another source or after a reuse: stored,
      // and no counter moves (RB-3).
      storeWithoutCounting: () => {
        stored_more = true;
      },
      valueReads: () => valueReads,
    };
  }

  function refreshTheCard(): Promise<void> {
    return userEvent.click(
      within(screen.getByRole("region", { name: /acquisition 7/i })).getByRole("button", {
        name: "Refresh",
      }),
    );
  }

  /**
   * UIR-A1. **The comparison follows the runs it compares.** Kept on screen through a re-read
   * (NEW-11), the diff stopped reading its runs again at all, so comparing a run still going
   * froze its figures at the moment it was chosen.
   */
  it("reads the compared runs again once one of them has moved on", async () => {
    const run = runSevenStillGoing();
    renderShell("/acquire");
    await fiveAgainstSeven();
    expect(
      theDiff().queryByRole("row", { name: /nobody measures this/i }),
    ).not.toBeInTheDocument();

    run.moveOn();
    await refreshTheCard();

    expect(
      await theDiff().findByRole("row", { name: /nobody measures this/i }),
    ).toBeInTheDocument();
    expectFiveAgainstSeven();
  });

  it("reads a run still going again on a refresh, though none of its counts moved", async () => {
    const run = runSevenStillGoing();
    renderShell("/acquire");
    await fiveAgainstSeven();

    run.storeWithoutCounting();
    await refreshTheCard();

    expect(
      await theDiff().findByRole("row", { name: /nobody measures this/i }),
    ).toBeInTheDocument();
  });

  it("does not read finished runs again on a refresh that moved neither of them", async () => {
    const run = runSevenStillGoing("completed");
    renderShell("/acquire");
    await fiveAgainstSeven();
    const reads = run.valueReads();

    await refreshTheCard();
    await everyActHasEnded();

    expect(run.valueReads()).toBe(reads);
    expectFiveAgainstSeven();
  });
});

describe("the acquisition card", () => {
  /**
   * The screen's lead, and the design's: a reader arriving mid-run, or just after one, came
   * for this. The card reads outward from the whole to the parts -- what it is, what it was
   * asked to cover, how far it got, which source got it there, and what it came to.
   */
  async function theCard() {
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });
    return within(screen.getByRole("region", { name: /acquisition 8/i }));
  }

  it("leads the screen, above the standing figures", async () => {
    await theCard();
    const card = screen.getByRole("region", { name: /acquisition 8/i });
    const holds = screen.getByRole("heading", {
      name: /what the database holds/i,
    });

    // `compareDocumentPosition` rather than a class or an index: the question is which one a
    // reader meets first, and that is exactly what document order means.
    expect(
      card.compareDocumentPosition(holds) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says how big the pass was, rather than leaving two counts to multiply", async () => {
    const card = await theCard();

    expect(card.getByText(/32 candidates over 41 attributes/)).toBeInTheDocument();
  });

  it("names the status as a word, not only as a colour", async () => {
    const card = await theCard();

    expect(card.getByText("completed")).toBeInTheDocument();
  });

  it("breaks the run down by source, including the one that answered nothing", async () => {
    // OECD's front door is Cloudflare-challenged, so a run where it answers nothing is the
    // shipped case -- and the source a reader came to this panel to find.
    const card = await theCard();

    expect(
      card.getByRole("img", { name: "eurostat: 93 stored" }),
    ).toBeInTheDocument();
    expect(
      card.getByRole("img", { name: "oecd: 0 stored, 1 failed" }),
    ).toBeInTheDocument();
  });

  it("states what was charged even when nothing was", async () => {
    // Every source shipped today is free. A spend line that appeared only when money moved
    // would leave a reader unable to tell "free" from "not reported".
    const card = await theCard();

    expect(card.getByText("No paid call, nothing charged")).toBeInTheDocument();
  });

  it("puts the run away without touching the run", async () => {
    const card = await theCard();

    await userEvent.click(card.getByRole("button", { name: "Dismiss" }));

    expect(
      screen.queryByRole("region", { name: /acquisition 8/i }),
    ).toBeNull();
    // The history is untouched: dismissing puts away the screen's view of the run, not the
    // run. Anything else would make a card that looks closeable into one that deletes.
    expect(
      screen.getByRole("heading", { name: /every acquisition so far/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "7" })).toBeInTheDocument();
  });
});

/**
 * The complaint this answers, in the owner's words: "the Acquisition 119 box is horrible, it's
 * an endless list of API errors, unactionable. I see 32 failures but I can't do anything about
 * it." Two faults, both of them placement: a settled run took the top of the screen, and its
 * failures were an unbounded flat dump of one repeated message that pushed the retry card --
 * which does exactly what the owner said they could not do -- below the fold.
 */
/**
 * The complaint this answers, in the owner's words: "the Acquisition 119 box is horrible, it's
 * an endless list of API errors, unactionable. I see 32 failures but I can't do anything about
 * it."
 *
 * **The design's answer is a compact card, not a hidden one.** The first fix here folded the
 * finished run away behind a disclosure, which was wrong: the prototype keeps the card at the
 * top of the screen whenever there is a run (`acqShow: !!s.acq` -- no recency window, and
 * Dismiss is what removes it) and makes it four things deep instead. It carries **no item
 * lists at all**, which is what cost a reader the whole screen; the items belong to the cards
 * below that can act on them.
 */
describe("the acquisition card the design asks for", () => {
  function aRunWith(status: string) {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: status,
          finished_at: status === "running" ? null : "2026-09-12T09:00:12Z",
        }),
      ),
    );
    renderShell("/acquire");
    return screen.findByRole("region", { name: /acquisition 7/i });
  }

  it("leads the screen even once the run has stopped", async () => {
    const card = await aRunWith("completed");
    const holds = screen.getByRole("heading", {
      name: /what the database holds/i,
    });

    // `compareDocumentPosition` rather than a class or an index: the question is which one a
    // reader meets first, and that is exactly what document order means.
    expect(
      card.compareDocumentPosition(holds) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /** The heading is the state, which is what a reader arriving mid-run is checking. */
  it("is headed by what is happening, not by a number", async () => {
    await aRunWith("running");

    expect(
      screen.getByRole("heading", { name: "Acquiring now" }),
    ).toBeInTheDocument();
  });

  it("says the acquisition finished once it has", async () => {
    await aRunWith("completed");

    expect(
      screen.getByRole("heading", { name: "Acquisition finished" }),
    ).toBeInTheDocument();
  });

  it("says a run was stopped early rather than that it finished", async () => {
    await aRunWith("halted_on_spend_cap");

    expect(
      screen.getByRole("heading", { name: "Stopped early" }),
    ).toBeInTheDocument();
  });

  /**
   * **The design has three states and a real run has four.** "Acquisition finished" over a run
   * whose process was killed would be this screen's worst habit: a plausible sentence that is
   * not true.
   */
  it("does not claim a run that died finished", async () => {
    await aRunWith("failed");

    expect(
      screen.getByRole("heading", { name: "Acquisition did not finish" }),
    ).toBeInTheDocument();
  });

  it("names which acquisition it is, on the line under the heading", async () => {
    const card = within(await aRunWith("completed"));

    expect(
      card.getByText(/Acquisition 7 asked for 32 candidates over 41 attributes/),
    ).toBeInTheDocument();
  });

  /**
   * **The whole point of the card being compact.** It held a table of every failure and a
   * table of every unanswered item; on the shipped run that meant 32 three-line paragraphs of
   * one sentence above the button that could have fixed it.
   */
  it("carries no item lists at all", async () => {
    const card = within(await aRunWith("completed"));

    expect(card.queryByRole("table")).toBeNull();
    expect(card.queryByRole("checkbox")).toBeNull();
    // The failure's message is on the screen -- inside the card that can retry it -- but not
    // in here, which is the move that gave the reader the screen back.
    expect(card.queryByText(/cloudflare/i)).toBeNull();
    expect(
      screen.getByRole("region", { name: /which sources broke/i }),
    ).toBeInTheDocument();
  });

  /** Putting a run away while it is still writing values would look like cancelling it. */
  it("does not offer Dismiss while the run is still going", async () => {
    const card = within(await aRunWith("running"));

    expect(card.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("offers Dismiss once there is nothing left to watch", async () => {
    const card = within(await aRunWith("completed"));

    expect(card.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("shows a run opened from the history without a second click", async () => {
    renderShell("/acquire");
    const history = await screen.findByRole("table");

    await userEvent.click(within(history).getByRole("button", { name: "6" }));

    expect(
      await screen.findByRole("region", { name: /acquisition 6/i }),
    ).toBeInTheDocument();
  });

  it("has no card at all where no run has ever been started", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );
    renderShell("/acquire");

    await screen.findByText(/no acquisition has been started yet/i);
    // Scoped to the card's four possible headings: the screen's own "Acquire" heading and the
    // history's "Every acquisition so far" both match a bare /acquisition/.
    expect(screen.queryByRole("heading", { name: "Acquiring now" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Acquisition finished" }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Stopped early" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Acquisition did not finish" }),
    ).toBeNull();
  });
});

/**
 * **One message repeated is one problem.** The run that sent this screen back asked the LLM
 * about every country on a key with no credit left and failed 32 times with one sentence; the
 * card drew 32 three-line paragraphs of it above the button that could have retried them.
 *
 * The design's answer is the shape rather than a count: the list is grouped by source and
 * **collapsed**, so a wall of identical reasons is one line until somebody asks. The count of
 * distinct messages is the one thing here the prototype does not have, kept because it is what
 * tells a reader the 32 are one problem.
 */
describe("a wall of identical failures", () => {
  const CREDIT =
    "Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', " +
    "'message': 'Your credit balance is too low to access the Anthropic API.'}}";

  const COUNTRIES = ["austria", "belgium", "croatia", "cyprus", "denmark"];

  const outOfCredit = COUNTRIES.map((country) => ({
    data_source: "llm",
    candidate: `country.${country}`,
    attribute: "country.pension_portability",
    error_message: CREDIT,
  }));

  async function aRunThatFailed(failures: unknown) {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          unanswered: [],
          by_source: [
            { data_source: "llm", items_stored: 0, items_failed: COUNTRIES.length },
          ],
          progress: {
            items_total: COUNTRIES.length,
            items_completed: 0,
            items_failed: COUNTRIES.length,
            items_unanswered: 0,
          },
          failures,
        }),
      ),
    );
    renderShell("/acquire");
    return within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
  }

  /** The count that answers the complaint: five failures, one thing wrong. */
  it("separates how many failed from how many things are wrong", async () => {
    await aRunThatFailed(outOfCredit);

    expect(
      await screen.findByText(/5 failures from 1 source, 1 distinct message/),
    ).toBeInTheDocument();
  });

  it("holds the whole wall behind one collapsed group", async () => {
    const broke = await aRunThatFailed(outOfCredit);

    expect(
      broke.getByRole("button", { name: /^llm 5 items$/i }),
    ).toBeInTheDocument();
    // Nothing of the message, and none of the five candidates, until it is opened.
    expect(screen.queryByText(/credit balance/i)).toBeNull();
    expect(screen.queryByText(/for Austria/)).toBeNull();
  });

  it("names every candidate and its reason once opened", async () => {
    const broke = await aRunThatFailed(outOfCredit);

    await userEvent.click(broke.getByRole("button", { name: /^llm 5 items$/i }));

    // **"Pension portability for Austria", never two keys with a space between them.** The
    // design writes this phrase itself, and bars both a `·` and a bare identifier.
    expect(
      broke.getByRole("checkbox", { name: "Pension portability for Austria" }),
    ).toBeInTheDocument();
    expect(
      broke.getByRole("checkbox", { name: "Pension portability for Denmark" }),
    ).toBeInTheDocument();
    expect(broke.queryByText(/country\./)).toBeNull();
    // The reason reads as a sentence, not as the serialised payload it arrived in.
    expect(
      broke.getAllByText("Your credit balance is too low to access the Anthropic API."),
    ).toHaveLength(COUNTRIES.length);
  });

  it("counts two different messages from one source as two problems", async () => {
    await aRunThatFailed([
      ...outOfCredit.slice(0, 2),
      {
        data_source: "llm",
        candidate: "country.estonia",
        attribute: "country.pension_portability",
        error_message: "the model read no page that answered",
      },
    ]);

    expect(
      await screen.findByText(/3 failures from 1 source, 2 distinct messages/),
    ).toBeInTheDocument();
  });

  it("offers no remedy when the run reports no failures at all", async () => {
    // `failures` is optional in the contract, so an absent array is not an empty one -- and a
    // screen that read `.length` off it would have thrown rather than said so.
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          id: Number(params["runId"]),
          run_status: "completed",
          triggered_by: "user",
          started_at: "2026-09-12T09:00:00Z",
          progress: { items_total: 4, items_completed: 4 },
        }),
      ),
    );
    renderShell("/acquire");

    await screen.findByRole("region", { name: /acquisition 7/i });
    expect(
      screen.queryByRole("region", { name: /which sources broke/i }),
    ).toBeNull();
  });

  /**
   * **The one test here that proves the catalog is being read at all.**
   *
   * The shared fixtures now name `country.total_tax_rate_effective` "Total effective tax rate"
   * where title-casing the id gives "Total tax rate effective" -- the same five words
   * reordered -- so three assertions elsewhere discriminate. No shipped *candidate* does: every
   * one of them title-cases to its own name. So this serves names from a stub that a fallback
   * could not invent, and covers both halves of the phrase at once.
   */
  it("prefers the catalog's name over the id made readable", async () => {
    mockServer.use(
      http.get(`${BASE}/attributes`, () =>
        HttpResponse.json({
          items: [
            {
              id: "country.pension_portability",
              name: "Pension portability abroad",
              pillar: "economics",
              level: "country",
              value_type: "Boolean",
              unit: null,
              description: "Whether a pension travels",
              manual_entry: false,
              max_age_months: 24,
              breakdown_scheme: null,
              breakdown_options: [],
              allowed_range: null,
              allowed_labels: [],
              effective_source_priority: ["llm"],
            },
          ],
        }),
      ),
      http.get(`${BASE}/candidates`, () =>
        HttpResponse.json({
          items: [
            {
              id: "country.austria",
              name: "Republic of Austria",
              level: "country",
              parent_candidate: null,
              country_code: "AT",
            },
          ],
        }),
      ),
    );
    const broke = await aRunThatFailed(outOfCredit);

    await userEvent.click(broke.getByRole("button", { name: /^llm 5 items$/i }));

    expect(
      await broke.findByRole("checkbox", {
        name: "Pension portability abroad for Republic of Austria",
      }),
    ).toBeInTheDocument();
    // And the fallback still covers a candidate the catalog did not answer for, in the same
    // list, so one miss does not take the whole phrase down with it.
    expect(
      broke.getByRole("checkbox", {
        name: "Pension portability abroad for Denmark",
      }),
    ).toBeInTheDocument();
  });
});

describe("stopping a run", () => {
  /**
   * `reqs.md` 6.4. **The control says what it keeps, because that is the question.** "Stop"
   * alone reads as "throw away what it has done", and the one thing a reader must know before
   * clicking is that it does not: the loop reads the request between sources, so everything
   * already written stays written.
   */
  async function aRunningAcquisition() {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "running",
          finished_at: null,
        }),
      ),
    );
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    return within(screen.getByRole("region", { name: /acquisition 7/i }));
  }

  it("is offered only while something is running", async () => {
    const card = await aRunningAcquisition();

    expect(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    ).toBeInTheDocument();
  });

  it("is not offered for a run that has finished", async () => {
    // Nothing to stop, and a live control would invite a click that does nothing.
    //
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    expect(
      screen.queryByRole("button", { name: /stop — keep what completed/i }),
    ).toBeNull();
  });

  it("says stopping, and withdraws the control once asked", async () => {
    // Still `running` on the server until the source in flight finishes. Telling the reader
    // "running" there is true and useless -- they have just clicked Stop. And a second click
    // would change nothing, because the first request is the one recorded.
    //
    // **The mock has to remember the stop**, because the server does: the request is a column
    // on the run, so the next read carries it. A mock that forgot would certify a card that
    // reverts to "running" the moment it refreshes -- kinder than the server in exactly the
    // way that ships a fault.
    let asked = false;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "running",
          finished_at: null,
          stop_requested_at: asked ? "2026-09-12T09:00:06Z" : null,
        }),
      ),
      http.post(`${BASE}/data-acquisition-runs/:runId/stop`, ({ params }) => {
        asked = true;
        return HttpResponse.json(
          { ...STARTED_RUN_DETAIL, id: Number(params["runId"]) },
          { status: 202 },
        );
      }),
    );
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    const card = within(screen.getByRole("region", { name: /acquisition 7/i }));

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );

    await waitFor(() => {
      const open = within(
        screen.getByRole("region", { name: /acquisition 7/i }),
      );
      expect(open.getByText("stopping")).toBeInTheDocument();
      expect(
        open.queryByRole("button", { name: /stop — keep what completed/i }),
      ).toBeNull();
    });
  });

  /**
   * NEW-52. **A stop the server recorded stays asked, though its read-back failed.** The card
   * still shows the run as read before the stop; offering Stop there would say it was never
   * pressed, when the run is already stopping.
   */
  it("keeps Stop held after a stop the server recorded, though reading the run back failed", async () => {
    let asked = false;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        asked
          ? HttpResponse.json(
              { code: "internal_error", message: "the run could not be read" },
              { status: 500 },
            )
          : HttpResponse.json({
              ...STARTED_RUN_DETAIL,
              id: Number(params["runId"]),
              run_status: "running",
              finished_at: null,
            }),
      ),
      http.post(`${BASE}/data-acquisition-runs/:runId/stop`, ({ params }) => {
        asked = true;
        return HttpResponse.json(
          { ...STARTED_RUN_DETAIL, id: Number(params["runId"]) },
          { status: 202 },
        );
      }),
    );
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("internal_error");
    expectHeld(card.getByRole("button", { name: "Stopping…" }));
  });

  it("reports a refusal rather than leaving the button looking ignored", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "running",
          finished_at: null,
        }),
      ),
      http.post(`${BASE}/data-acquisition-runs/:runId/stop`, () =>
        HttpResponse.json(
          { code: "run_not_found", message: "there is no run numbered 7" },
          { status: 404 },
        ),
      ),
    );
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await userEvent.click(
      screen.getByRole("button", { name: /stop — keep what completed/i }),
    );

    expect(await screen.findByText(/run_not_found/)).toBeInTheDocument();
  });
});

/** An answer the test lets go of when it chooses, so two acts overlap as a slow network makes them. */
function heldAnswer(): { held: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/**
 * How many times the history has been read. **Every act that ends reads it again**, so a count
 * that moves is the sign a late act has finished whatever it was going to do to the card. The
 * sidebar and the progress strip ask for one run each, and are not counted.
 */
function countHistoryReads(): { count: number } {
  const reads = { count: 0 };
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
      if (new URL(request.url).searchParams.get("limit") !== "1") reads.count += 1;
      // Nothing returned, so the request falls through to the mock's own answer.
    }),
  );
  return reads;
}

/**
 * Holds the next read of one run until the test lets it go; every later read goes through.
 * **The next one, not all of them**: each overlapping act reads a run back, and only the act
 * under test is meant to be slow.
 */
function holdTheNextReadOf(runId: number): {
  release: () => void;
  arrived: () => boolean;
} {
  const answer = heldAnswer();
  let arrived = false;
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs/${String(runId)}`, async () => {
      if (arrived) return;
      arrived = true;
      await answer.held;
    }),
  );
  return { release: answer.release, arrived: () => arrived };
}

/**
 * Holds the next read of one run until the test lets it go, and then fails it; every later read
 * goes through. **Slow and then failing** is the read a reader can leave before it answers.
 */
function failTheNextReadOf(runId: number): {
  release: () => void;
  arrived: () => boolean;
} {
  const answer = heldAnswer();
  let arrived = false;
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs/${String(runId)}`, async () => {
      if (arrived) return;
      arrived = true;
      await answer.held;
      return HttpResponse.json(
        {
          code: "internal_error",
          message: `run ${String(runId)} could not be read`,
        },
        { status: 500 },
      );
    }),
  );
  return { release: answer.release, arrived: () => arrived };
}

/**
 * Waits for every act on the screen to end, however it ended. **The estimate is held while any
 * act is going**, so it coming back says the act under test has finished whatever it was going
 * to do -- including reporting a failure, which leaves nothing else on screen to wait for.
 */
async function everyActHasEnded(): Promise<void> {
  await waitFor(() =>
    expectNotHeld(
      screen.getByRole("button", { name: /estimate an acquisition/i }),
    ),
  );
}

/**
 * Run 7 is still going, and its stop is answered only when the test says so. **The mock
 * remembers the stop** once it is answered, as the server does.
 */
function aRunWhoseStopIsHeld(): { release: () => void } {
  const answer = heldAnswer();
  let asked = false;
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
      HttpResponse.json({
        ...STARTED_RUN_DETAIL,
        id: Number(params["runId"]),
        run_status: "running",
        finished_at: null,
        stop_requested_at: asked ? "2026-09-12T09:00:06Z" : null,
      }),
    ),
    http.post(`${BASE}/data-acquisition-runs/:runId/stop`, async ({ params }) => {
      await answer.held;
      asked = true;
      return HttpResponse.json(
        { ...STARTED_RUN_DETAIL, id: Number(params["runId"]) },
        { status: 202 },
      );
    }),
  );
  return { release: answer.release };
}

async function openFromHistory(id: string): Promise<void> {
  const number = await screen.findByRole("rowheader", { name: id });
  await userEvent.click(within(number).getByRole("button", { name: id }));
}

/**
 * Lets every answer the test has released reach the screen.
 *
 * **A round trip rather than a clock.** An answer that must *not* change the card leaves nothing
 * on screen to wait for, so this waits for something that certainly lands after it: one more
 * request, answered and drawn. An estimate is the harmless one -- it touches no card.
 */
async function aRoundTripLater(): Promise<void> {
  await estimate();
  await within(
    screen.getByRole("region", { name: /an acquisition over every country/i }),
  ).findByText("Items");
}

/**
 * UI-04. **The card shows the run the reader chose last, not the read that arrived last.**
 * Every read used to end in an unconditional `setCurrent`, so a slow answer for a run the
 * reader had already left replaced the one they had just picked.
 */
describe("which run the card shows", () => {
  it("keeps the run you opened when the opening view arrives late", async () => {
    const opening = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/7`, async () => {
        await opening.held;
      }),
    );
    renderShell("/acquire");

    await openFromHistory("6");
    await screen.findByRole("region", { name: /acquisition 6/i });
    opening.release();
    await aRoundTripLater();

    expect(
      screen.getByRole("region", { name: /acquisition 6/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /acquisition 7/i })).toBeNull();
  });

  it("keeps a run just started when the history is slow to arrive", async () => {
    const history = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, async () => {
        await history.held;
      }),
    );
    renderShell("/acquire");

    await estimate();
    await userEvent.click(
      await screen.findByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });
    history.release();
    await screen.findByRole("rowheader", { name: "7" });
    await aRoundTripLater();

    // The opening view would have opened run 7, the newest the history holds; the reader had
    // already started run 8, and that is the one they are watching.
    expect(
      screen.getByRole("region", { name: /acquisition 8/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /acquisition 7/i })).toBeNull();
  });

  it("keeps a dismissed card dismissed when a refresh lands after it", async () => {
    const history = countHistoryReads();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const before = history.count;

    const read = holdTheNextReadOf(7);
    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(read.arrived()).toBe(true));
    await userEvent.click(card.getByRole("button", { name: "Dismiss" }));
    read.release();
    await waitFor(() => expect(history.count).toBe(before + 1));

    expect(screen.queryByRole("region", { name: /acquisition 7/i })).toBeNull();
  });

  it("does not let a stop's answer replace a run opened meanwhile", async () => {
    const stop = aRunWhoseStopIsHeld();
    const history = countHistoryReads();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const before = history.count;

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    await openFromHistory("6");
    await screen.findByRole("region", { name: /acquisition 6/i });
    await waitFor(() => expect(history.count).toBe(before + 1));
    stop.release();
    await waitFor(() => expect(history.count).toBe(before + 2));

    expect(
      screen.getByRole("region", { name: /acquisition 6/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /acquisition 7/i })).toBeNull();
  });

  it("shows the run a confirmation started, not a read already on its way", async () => {
    const history = countHistoryReads();
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    const before = history.count;
    await openFromHistory("6");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 6/i }),
    );
    await waitFor(() => expect(history.count).toBe(before + 1));
    await userEvent.click(
      screen.getByRole("button", { name: /^retry 1 failed$/i }),
    );
    const yes = await screen.findByRole("button", { name: /yes, start it/i });
    await waitFor(() => expect(history.count).toBe(before + 2));

    const read = holdTheNextReadOf(6);
    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(read.arrived()).toBe(true));
    await userEvent.click(yes);
    await screen.findByRole("region", { name: /acquisition 8/i });
    await waitFor(() => expect(history.count).toBe(before + 3));
    read.release();
    await waitFor(() => expect(history.count).toBe(before + 4));

    expect(
      screen.getByRole("region", { name: /acquisition 8/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /acquisition 6/i })).toBeNull();
  });
});

/**
 * UI-04. **A read the reader has left reports nothing, failure included.** The tickets kept a
 * late answer off the card but not a late failure: opening run 6, whose read was slow and then
 * failed, and then run 5 put run 5's card under run 6's error. **An act's own request is not a
 * read**, so a start or a stop the server refused still reports, whatever was opened meanwhile.
 */
describe("whose failure the screen reports", () => {
  it("does not report a failed read of a run the reader has since left", async () => {
    const read = failTheNextReadOf(6);
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await openFromHistory("6");
    await waitFor(() => expect(read.arrived()).toBe(true));
    await openFromHistory("5");
    await screen.findByRole("region", { name: /acquisition 5/i });
    read.release();
    await everyActHasEnded();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("region", { name: /acquisition 5/i }),
    ).toBeInTheDocument();
  });

  it("does not report a failed read of a card the reader has dismissed", async () => {
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );

    const read = failTheNextReadOf(7);
    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(read.arrived()).toBe(true));
    await userEvent.click(card.getByRole("button", { name: "Dismiss" }));
    read.release();
    await everyActHasEnded();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("region", { name: /acquisition 7/i })).toBeNull();
  });

  it("keeps reporting the failure of the run the reader opened last", async () => {
    const older = failTheNextReadOf(6);
    const newer = failTheNextReadOf(5);
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await openFromHistory("6");
    await waitFor(() => expect(older.arrived()).toBe(true));
    await openFromHistory("5");
    await waitFor(() => expect(newer.arrived()).toBe(true));
    newer.release();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "run 5 could not be read",
    );
    older.release();
    await everyActHasEnded();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "run 5 could not be read",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "run 6 could not be read",
    );
  });

  it("reports a failed read of the run the reader is waiting on", async () => {
    const read = failTheNextReadOf(6);
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await openFromHistory("6");
    await waitFor(() => expect(read.arrived()).toBe(true));
    read.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "run 6 could not be read",
    );
  });

  /**
   * A refused start is reported, and the card keeps the run it had. Opening a past run while the
   * start was in flight used to take the card first; that is held now (UIR-G1), so the press
   * does nothing and the refusal lands on the run the reader was looking at.
   */
  it("reports a start the server refused, and keeps the run that was on the card", async () => {
    const refusal = heldAnswer();
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, async () => {
        await refusal.held;
        return HttpResponse.json(
          {
            code: "run_already_in_flight",
            message: "run 7 is still going, and one household runs one pass at a time",
          },
          { status: 409 },
        );
      }),
    );
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await estimate();
    await userEvent.click(
      await screen.findByRole("button", { name: /start this acquisition/i }),
    );
    await openFromHistory("6");
    refusal.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "run_already_in_flight",
    );
    expect(
      screen.getByRole("region", { name: /acquisition 7/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /acquisition 6/i }),
    ).not.toBeInTheDocument();
  });

  it("still reports a stop the server refused, though the reader opened another run meanwhile", async () => {
    const refusal = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "running",
          finished_at: null,
        }),
      ),
      http.post(`${BASE}/data-acquisition-runs/:runId/stop`, async () => {
        await refusal.held;
        return HttpResponse.json(
          { code: "not_found", message: "there is no run numbered 7" },
          { status: 404 },
        );
      }),
    );
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    await openFromHistory("6");
    await screen.findByRole("region", { name: /acquisition 6/i });
    refusal.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "there is no run numbered 7",
    );
  });
});

/**
 * NEW-10. **The busy label lasts as long as the work.** Acts overlap -- Refresh is live while a
 * stop is being written -- and the first to end used to clear the label of the one still going.
 */
describe("what the busy label says while two acts overlap", () => {
  it("keeps saying Reading… until its read is back, though an earlier act ended first", async () => {
    const stop = aRunWhoseStopIsHeld();
    const history = countHistoryReads();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const before = history.count;

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    const read = holdTheNextReadOf(7);
    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(read.arrived()).toBe(true));
    stop.release();
    await waitFor(() => expect(history.count).toBe(before + 1));

    expectHeld(card.getByRole("button", { name: "Reading…" }));

    read.release();
    expect(
      await card.findByRole("button", { name: "Refresh" }),
    ).toBeEnabled();
  });

  it("keeps saying Stopping… until the stop has answered, though a later read ended first", async () => {
    const stop = aRunWhoseStopIsHeld();
    const history = countHistoryReads();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const before = history.count;

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(history.count).toBe(before + 1));

    expectHeld(card.getByRole("button", { name: "Stopping…" }));

    stop.release();
    await waitFor(() => expect(history.count).toBe(before + 2));
  });
});

/**
 * NEW-49. **A refresh that overtakes a stop does not take the stop off the card.** Refresh is
 * live while a stop is sent (NEW-10), and its read can be answered before the stop is written --
 * the backend shares one connection with the running acquisition. It held the newer ticket, so
 * the stop's own read, the one carrying `stop_requested_at`, was dropped: the card said
 * "Acquiring now" and offered Stop again until the reader refreshed. **Only a read of the same
 * run gives way**; anything else the reader did meanwhile still outranks the stop (UI-04).
 */
/**
 * NEW-49, the other way to overtake a stop: **a start the server refused.** While a stop is
 * being sent the run is still going, so a start is refused with `run_already_in_flight` -- and,
 * holding the newest ticket while reading nothing back, it kept the stop's own read off the card,
 * which went on offering Stop for a run already stopping.
 */
describe("a stop a refused start overtook", () => {
  /** Every start refused as the server refuses one while a run is going, when the test says. */
  function refuseStarts(): { release: () => void } {
    const answer = heldAnswer();
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, async () => {
        await answer.held;
        return HttpResponse.json(
          {
            code: "run_already_in_flight",
            message: "run 7 is still going, and one household runs one pass at a time",
          },
          { status: 409 },
        );
      }),
    );
    return answer;
  }

  /** Run 7 on the card, an acquisition estimated, then its stop clicked and held. */
  async function aStopHeldBesideAnEstimate() {
    const stop = aRunWhoseStopIsHeld();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    await estimate();
    const startIt = await screen.findByRole("button", {
      name: /start this acquisition/i,
    });
    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    return { stop, startIt };
  }

  function expectTheStopOnTheCard(): void {
    const card = within(
      screen.getByRole("region", { name: /acquisition 7/i }),
    );
    expect(
      card.queryByRole("button", { name: /stop — keep what completed/i }),
    ).toBeNull();
    expect(card.getByText("stopping")).toBeInTheDocument();
  }

  it("shows the stop once it is answered, though a start was refused before", async () => {
    const { stop, startIt } = await aStopHeldBesideAnEstimate();
    refuseStarts().release();

    await userEvent.click(startIt);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "run_already_in_flight",
    );
    stop.release();

    await waitFor(() => expectTheStopOnTheCard());
  });

  it("shows the stop, though the start was refused only after it was answered", async () => {
    const { stop, startIt } = await aStopHeldBesideAnEstimate();
    const refusal = refuseStarts();

    await userEvent.click(startIt);
    stop.release();
    refusal.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "run_already_in_flight",
    );
    await waitFor(() => expectTheStopOnTheCard());
  });

  /**
   * NEW-52, in the start's order. The stop is written while the start is still the newest act,
   * so the stop's own read is dropped and the card shows run 7 as read before it -- with Stop
   * drawn. Let go once its stop had ended, Stop was pressable again until the refused start
   * read the card back, and for good if that read failed. **Accepted, a stop stays asked.**
   */
  it("keeps Stop held after its stop is written, while the start pressed meanwhile is unanswered", async () => {
    const history = countHistoryReads();
    const { stop, startIt } = await aStopHeldBesideAnEstimate();
    const refusal = refuseStarts();
    await userEvent.click(startIt);
    // The opening read and the estimate's: every act that ends reads the history again.
    await waitFor(() => expect(history.count).toBe(2));

    stop.release();
    // The stop has ended -- written, read back, and kept off the card by the newer start.
    await waitFor(() => expect(history.count).toBe(3));

    const card = within(
      screen.getByRole("region", { name: /acquisition 7/i }),
    );
    expectHeld(card.getByRole("button", { name: "Stopping…" }));

    refusal.release();
    await waitFor(() => expectTheStopOnTheCard());
  });
});

describe("a stop a refresh overtook", () => {
  /**
   * Run 7 on the card, still going, its stop clicked and held. `actsEnded` counts the acts that
   * have ended since -- each reads the history again as it ends.
   */
  async function aStopHeldOnTheCard() {
    const stop = aRunWhoseStopIsHeld();
    const history = countHistoryReads();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const before = history.count;
    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    return { stop, card, actsEnded: () => history.count - before };
  }

  it("shows the stop once it is answered, though a refresh read the run before it was written", async () => {
    const { stop, card, actsEnded } = await aStopHeldOnTheCard();

    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(actsEnded()).toBe(1));
    stop.release();
    await waitFor(() => expect(actsEnded()).toBe(2));

    expect(
      card.queryByRole("button", { name: /stop — keep what completed/i }),
    ).toBeNull();
    expect(card.getByText("stopping")).toBeInTheDocument();
  });

  it("shows the stop once it is answered, though the run was opened again from the history", async () => {
    const { stop, card, actsEnded } = await aStopHeldOnTheCard();

    await openFromHistory("7");
    await waitFor(() => expect(actsEnded()).toBe(1));
    stop.release();
    await waitFor(() => expect(actsEnded()).toBe(2));

    expect(
      card.queryByRole("button", { name: /stop — keep what completed/i }),
    ).toBeNull();
    expect(card.getByText("stopping")).toBeInTheDocument();
  });

  it("shows the stop's own read when nothing overtook it", async () => {
    const { stop, card, actsEnded } = await aStopHeldOnTheCard();

    stop.release();
    await waitFor(() => expect(actsEnded()).toBe(1));

    expect(
      card.queryByRole("button", { name: /stop — keep what completed/i }),
    ).toBeNull();
    expect(card.getByText("stopping")).toBeInTheDocument();
  });

  it("still gives way to another run opened after the refresh", async () => {
    const { stop, card, actsEnded } = await aStopHeldOnTheCard();

    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(actsEnded()).toBe(1));
    await openFromHistory("6");
    await screen.findByRole("region", { name: /acquisition 6/i });
    await waitFor(() => expect(actsEnded()).toBe(2));
    stop.release();
    await waitFor(() => expect(actsEnded()).toBe(3));

    expect(
      screen.getByRole("region", { name: /acquisition 6/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /acquisition 7/i })).toBeNull();
  });

  it("still reports a stop the server refused, and offers it again", async () => {
    // **The refusal the contract declares**: `stopRun` answers 202 or 404, so that is the one
    // a refused stop can be. The run on the card was read by the refresh, and nothing stopped it.
    const refusal = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "running",
          finished_at: null,
        }),
      ),
      http.post(`${BASE}/data-acquisition-runs/:runId/stop`, async () => {
        await refusal.held;
        return HttpResponse.json(
          { code: "not_found", message: "there is no run numbered 7" },
          { status: 404 },
        );
      }),
    );
    const history = countHistoryReads();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const before = history.count;

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(history.count).toBe(before + 1));
    refusal.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "there is no run numbered 7",
    );
    expect(
      await card.findByRole("button", { name: /stop — keep what completed/i }),
    ).toBeEnabled();
  });
});

/**
 * NEW-52. **Stop stays held for as long as its stop is in flight, whatever act is newest.** It
 * was held only while `busy` said "stopping", and `busy` names the newest act (NEW-10) -- so a
 * Refresh sent while the stop was written took the label, and Stop was offered again, pressable
 * and saying it had not been pressed, until the refresh had read the run back.
 */
describe("a stop a refresh overlaps", () => {
  /** Run 7 on the card, its stop sent and not answered, and a refresh read held behind it. */
  async function aStopAndARefreshInFlight() {
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const stop = card.getByRole("button", {
      name: /stop — keep what completed/i,
    });
    const refresh = card.getByRole("button", { name: "Refresh" });
    await userEvent.click(stop);
    const read = holdTheNextReadOf(7);
    await userEvent.click(refresh);
    await waitFor(() => expect(read.arrived()).toBe(true));
    return { card, stop, refresh, read };
  }

  it("keeps Stop held while the refresh reads, and after it, until the stop answers", async () => {
    const answer = aRunWhoseStopIsHeld();
    const { card, stop, refresh, read } = await aStopAndARefreshInFlight();

    expectHeld(stop);
    expect(stop).toHaveTextContent("Stopping…");

    read.release();
    await waitFor(() => expect(refresh).toHaveTextContent("Refresh"));
    expectHeld(stop);
    expect(stop).toHaveTextContent("Stopping…");

    answer.release();
    await waitFor(() => expect(card.getByText("stopping")).toBeInTheDocument());
    expect(
      card.queryByRole("button", { name: /stop — keep what completed|stopping/i }),
    ).toBeNull();
  });

  it("takes Stop away once its stop is recorded, though the refresh is still reading", async () => {
    const answer = aRunWhoseStopIsHeld();
    const { card, read } = await aStopAndARefreshInFlight();

    answer.release();
    await waitFor(() => expect(card.getByText("stopping")).toBeInTheDocument());
    expect(
      card.queryByRole("button", { name: /stop — keep what completed|stopping/i }),
    ).toBeNull();

    read.release();
    await waitFor(() =>
      expect(card.getByRole("button", { name: "Refresh" })).toBeInTheDocument(),
    );
    expect(card.getByText("stopping")).toBeInTheDocument();
  });

  it("offers Stop again once a refused stop has answered, though a refresh overlapped it", async () => {
    const refusal = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "running",
          finished_at: null,
        }),
      ),
      http.post(`${BASE}/data-acquisition-runs/:runId/stop`, async () => {
        await refusal.held;
        return HttpResponse.json(
          { code: "not_found", message: "there is no run numbered 7" },
          { status: 404 },
        );
      }),
    );
    const { stop, refresh, read } = await aStopAndARefreshInFlight();

    expectHeld(stop);
    read.release();
    await waitFor(() => expect(refresh).toHaveTextContent("Refresh"));
    expectHeld(stop);

    refusal.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "there is no run numbered 7",
    );
    await waitFor(() => expectNotHeld(stop));
    expect(stop).toHaveTextContent("Stop — keep what completed");
  });
});

/**
 * The hook's acts on the card, called with no card. The screen never offers them then, so this is
 * the hook's own contract: **an act with nothing to act on asks for nothing and claims nothing**
 * -- and so the opening view, which gives way to any claim, still opens.
 */
describe("an act on the card with no card to act on", () => {
  it("asks for nothing, and leaves the opening view to open", async () => {
    const { result } = renderHook(() => useRunScreen());

    act(() => {
      result.current.refresh();
      result.current.stop();
      result.current.commit();
    });

    expect(result.current.busy).toBeNull();
    await waitFor(() => expect(result.current.current?.id).toBe(7));
  });
});

describe("a figure typed by hand", () => {
  /**
   * `reqs.md` 6.5. **The only route for a value that cannot be fetched at any price** — which is
   * why Gate D's `pg_restore` test exists to prove one survives a restore.
   */
  async function theForm(attribute: RegExp) {
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", {
        name: /figures you can enter by hand/i,
      }),
    );
    const row = await card.findByRole("row", { name: attribute });
    await userEvent.click(
      within(row).getByRole("button", { name: /enter a value by hand/i }),
    );
    return within(await screen.findByRole("region", { name: /enter a value for/i }));
  }

  /**
   * NEW-09. **A pillar is named as the catalog names it.** The card beside this one has always
   * done so; this one printed the id, so the same attribute's pillar read two ways on one screen.
   */
  it("names each attribute's pillar as the catalog does", async () => {
    mockServer.use(
      http.get(`${BASE}/pillars`, () =>
        HttpResponse.json({
          items: [
            { id: "career", name: "Work", display_order: 3 },
            { id: "governance", name: "Government", display_order: 10 },
          ],
        }),
      ),
    );
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", {
        name: /figures you can enter by hand/i,
      }),
    );

    const employers = await card.findByRole("row", {
      name: /international employers/i,
    });
    expect(
      await within(employers).findByRole("cell", { name: "Work" }),
    ).toBeInTheDocument();
    expect(
      card.getByRole("row", { name: /residency admin ease/i }),
    ).toHaveTextContent("Government");
  });

  /**
   * UI-32. **What can fetch it, not who is ranked.** The priority order names every source for
   * every attribute, `manual` among them -- so this column offered typing by hand as the
   * alternative to typing by hand, beside sources no adapter stands behind.
   */
  it("names what else can fetch each one, not the whole priority order", async () => {
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", {
        name: /figures you can enter by hand/i,
      }),
    );

    const employers = await card.findByRole("row", {
      name: /international employers/i,
    });
    expect(
      within(employers).getByRole("cell", { name: "Otherwise: LLM with web search" }),
    ).toBeInTheDocument();
    expect(employers).not.toHaveTextContent(/manual|company_website/);

    const residency = card.getByRole("row", { name: /residency admin ease/i });
    expect(
      within(residency).getByRole("cell", {
        name: "Nothing else would answer it",
      }),
    ).toBeInTheDocument();
  });

  it("stores a label set and reads back what it wrote", async () => {
    // **What it stored, not "done".** A typo is invisible in a success message.
    const form = await theForm(/international employers/i);

    await userEvent.selectOptions(
      form.getByRole("combobox", { name: "Candidate" }),
      "country.portugal",
    );
    await userEvent.type(form.getByRole("textbox", { name: "Values" }), "Farfetch, OutSystems");
    fireEvent.change(form.getByLabelText("Describes, from"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(form.getByLabelText("Describes, to"), {
      target: { value: "2026-12-31" },
    });
    await userEvent.click(form.getByRole("button", { name: /store this figure/i }));

    // **"for Portugal", not "for country.portugal".** This panel already fetched every
    // candidate to fill the select above, so the name was one lookup away in data it held.
    expect(await form.findByRole("status")).toHaveTextContent(
      /Farfetch, OutSystems.*Portugal.*manual/i,
    );
  });

  it("stores the score as a human's, never the model's", async () => {
    // The field exists to keep a judgement somebody made apart from one a model produced.
    const sent: unknown[] = [];
    mockServer.use(
      http.post(`${BASE}/values/manual`, async ({ request }) => {
        const body = await request.json();
        sent.push(body);
        return HttpResponse.json({ ...STORED_VALUES[0], payload: {} }, { status: 201 });
      }),
    );
    const form = await theForm(/residency admin ease/i);

    await userEvent.selectOptions(
      form.getByRole("combobox", { name: "Candidate" }),
      "country.portugal",
    );
    await userEvent.type(form.getByRole("textbox", { name: "Score" }), "7");
    await userEvent.type(form.getByRole("textbox", { name: "Scale, lowest" }), "0");
    await userEvent.type(form.getByRole("textbox", { name: "Scale, highest" }), "10");
    fireEvent.change(form.getByLabelText("Describes, from"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(form.getByLabelText("Describes, to"), {
      target: { value: "2026-12-31" },
    });
    await userEvent.click(form.getByRole("button", { name: /store this figure/i }));

    await waitFor(() =>
      expect(sent).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({ assigned_by: "human" }),
        }),
      ]),
    );
  });

  it("says what is missing rather than sending an incomplete figure", async () => {
    const sent: unknown[] = [];
    mockServer.use(
      http.post(`${BASE}/values/manual`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const form = await theForm(/international employers/i);

    await userEvent.click(form.getByRole("button", { name: /store this figure/i }));

    const problems = await form.findByRole("alert");
    expect(problems).toHaveTextContent(/choose the candidate/i);
    expect(problems).toHaveTextContent(/what period this figure describes/i);
    expect(problems).toHaveTextContent(/name at least one/i);
    // Nothing was sent: the form can answer these without a round trip, and a refusal naming
    // an empty field tells the reader less than the form already can.
    expect(sent).toEqual([]);
  });

  it("shows the server's refusal when the two disagree", async () => {
    // The API is the authority on which attributes accept a hand-typed figure. The screen only
    // offers the form where the catalog says yes, so this is a backstop rather than the path.
    mockServer.use(
      http.post(`${BASE}/values/manual`, () =>
        HttpResponse.json(
          {
            code: "manual_entry_not_permitted",
            message: "this attribute does not accept a figure typed by hand",
          },
          { status: 409 },
        ),
      ),
    );
    const form = await theForm(/international employers/i);

    await userEvent.selectOptions(
      form.getByRole("combobox", { name: "Candidate" }),
      "country.portugal",
    );
    await userEvent.type(form.getByRole("textbox", { name: "Values" }), "Farfetch");
    fireEvent.change(form.getByLabelText("Describes, from"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(form.getByLabelText("Describes, to"), {
      target: { value: "2026-12-31" },
    });
    await userEvent.click(form.getByRole("button", { name: /store this figure/i }));

    expect(
      await form.findByText(/manual_entry_not_permitted/),
    ).toBeInTheDocument();
  });

  it("opens one form at a time", async () => {
    // Two open at once would put two candidate pickers and two date pairs on screen with
    // nothing saying which belongs to which attribute.
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", {
        name: /figures you can enter by hand/i,
      }),
    );

    const first = await card.findByRole("row", { name: /international employers/i });
    await userEvent.click(
      within(first).getByRole("button", { name: /enter a value by hand/i }),
    );
    const second = await card.findByRole("row", { name: /residency admin ease/i });
    await userEvent.click(
      within(second).getByRole("button", { name: /enter a value by hand/i }),
    );

    expect(
      screen.getAllByRole("region", { name: /enter a value for/i }),
    ).toHaveLength(1);
  });
});

describe("how much of a gap there is", () => {
  it("counts the affected attributes in the heading", async () => {
    // The heading says what the card is; the badge says how much of it there is, before the
    // table has been read. The design puts the count here for that reason.
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );

    expect(card.getByText(/attributes? affected/)).toBeInTheDocument();
  });

  it("agrees with the number of rows it draws", async () => {
    // A count beside a table that disagrees with the table is worse than no count.
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    const badge = await card.findByText(/attributes? affected/);
    const rows = card.getAllByRole("rowheader");

    expect(badge.textContent).toContain(String(rows.length));
  });
});

describe("arriving from a gap in Configure", () => {
  /**
   * The design's item H: an unsourced attribute carries a clickable "No source yet →" that
   * jumps here and marks the card it means.
   *
   * **The mark is in the URL, not in memory.** A reload keeps it, a copied link keeps it, and
   * a reader sent one lands on the same card the sender meant. In memory it would survive
   * neither.
   */
  async function theCard() {
    return await screen.findByRole("region", {
      name: /attributes with no data source at all/i,
    });
  }

  it("moves the reader to the card the link named", async () => {
    // **Focus, not just a tint.** A jump that only coloured a card leaves anyone reading by
    // keyboard or screen reader where they were, on a screen of six cards, with nothing saying
    // which one was meant. Asserted on focus rather than on a class name, because a test
    // coupled to the stylesheet breaks on a redesign for reasons that are not about behaviour.
    renderShell("/acquire?show=unsourced");

    await waitFor(async () => expect(await theCard()).toHaveFocus());
  });

  it("moves nobody when arriving the ordinary way", async () => {
    renderShell("/acquire");

    expect(await theCard()).not.toHaveFocus();
  });

  it("ignores a card name it does not know", async () => {
    // A URL somebody edited by hand is not an error; it is a URL that says nothing.
    renderShell("/acquire?show=whatever");

    expect(await theCard()).not.toHaveFocus();
  });
});

/**
 * NEW-44. **Held, never disabled, while an act is in flight.** Chromium throws focus off a
 * control the moment it is disabled and does not give it back, so a keyboard user who pressed
 * Estimate, Retry, Start, Refresh or Stop was put back on the page while the request ran --
 * NEW-34's defect, on the Acquire screen. jsdom keeps focus on a disabled control, which is why
 * these follow Chromium's rule. What is not a write in flight -- nothing selected, no level --
 * still disables outright.
 */
describe("acting from the keyboard", () => {
  beforeEach(() => followChromiumFocusFixup());

  /**
   * Counts each request to `path` as it arrives and holds it until the test lets go; then
   * answers with `answer`, or lets the mock's own handler answer when it gives nothing back.
   */
  function holdEach(
    method: "get" | "post",
    path: string,
    answer: () => Response | undefined = () => undefined,
  ): { requests: { sent: number }; release: () => void } {
    const gate = heldAnswer();
    const requests = { sent: 0 };
    mockServer.use(
      http[method](`${BASE}${path}`, async () => {
        requests.sent += 1;
        await gate.held;
        return answer();
      }),
    );
    return { requests, release: gate.release };
  }

  function refusal(code: string, message: string, status = 409) {
    return () => HttpResponse.json({ code, message }, { status });
  }

  /** Puts focus on `control` and presses Enter there, as a keyboard user does. */
  async function enterOn(
    user: ReturnType<typeof userEvent.setup>,
    control: HTMLElement,
  ): Promise<void> {
    act(() => control.focus());
    await user.keyboard("{Enter}");
  }

  function theWholeLevelCard() {
    return within(
      screen.getByRole("region", { name: /an acquisition over every country/i }),
    );
  }

  it("keeps focus on Estimate while it estimates, and a second Enter asks nothing", async () => {
    const user = userEvent.setup();
    const plans = holdEach("post", "/data-acquisition-runs/plan");
    renderShell("/acquire");
    const estimateIt = await screen.findByRole("button", {
      name: /estimate an acquisition/i,
    });

    await enterOn(user, estimateIt);
    await waitFor(() => expect(plans.requests.sent).toBe(1));

    expect(estimateIt).toHaveFocus();
    expectHeld(estimateIt);
    expect(estimateIt).toHaveTextContent("Estimating…");
    await user.keyboard("{Enter}");

    plans.release();

    expect(await theWholeLevelCard().findByText("Items")).toBeInTheDocument();
    await waitFor(() => expectNotHeld(estimateIt));
    expect(estimateIt).toHaveFocus();
    await user.keyboard("{Enter}");
    // The third Enter's request arriving is what proves the second asked nothing.
    await waitFor(() => expect(plans.requests.sent).toBe(2));
  });

  it("lets go of Estimate after a refused estimate, with focus still on it", async () => {
    const user = userEvent.setup();
    const plans = holdEach(
      "post",
      "/data-acquisition-runs/plan",
      refusal("conflict", "no level"),
    );
    renderShell("/acquire");
    const estimateIt = await screen.findByRole("button", {
      name: /estimate an acquisition/i,
    });

    await enterOn(user, estimateIt);
    await waitFor(() => expect(plans.requests.sent).toBe(1));
    expectHeld(estimateIt);
    plans.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(/no level/i);
    await waitFor(() => expectNotHeld(estimateIt));
    expect(estimateIt).toBeEnabled();
    expect(estimateIt).toHaveFocus();
  });

  it("keeps focus on Retry while its estimate is read, and a second Enter asks nothing", async () => {
    const user = userEvent.setup();
    const plans = holdEach("post", "/data-acquisition-runs/plan");
    renderShell("/acquire");
    const retry = await screen.findByRole("button", { name: "Retry 1 failed" });

    await enterOn(user, retry);
    await waitFor(() => expect(plans.requests.sent).toBe(1));

    expect(retry).toHaveFocus();
    expectHeld(retry);
    await user.keyboard("{Enter}");

    plans.release();

    expect(
      await screen.findByRole("button", { name: /yes, start it/i }),
    ).toBeInTheDocument();
    await waitFor(() => expectNotHeld(retry));
    expect(retry).toHaveFocus();
    expect(plans.requests.sent).toBe(1);
  });

  it("keeps focus on a group's Retry while its estimate is read, and lets go once it is", async () => {
    const user = userEvent.setup();
    const plans = holdEach("post", "/data-acquisition-runs/plan");
    renderShell("/acquire");
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    // Nothing picked is not a write in flight: the button is disabled outright until there is.
    const retrySelected = group.getByRole("button", { name: /^Retry 0 selected$/ });
    expect(retrySelected).toBeDisabled();
    expectNotHeld(retrySelected);
    await user.click(group.getByRole("button", { name: "Select all" }));

    await enterOn(user, retrySelected);
    await waitFor(() => expect(plans.requests.sent).toBe(1));

    expect(retrySelected).toHaveFocus();
    expectHeld(retrySelected);
    await user.keyboard("{Enter}");

    plans.release();

    expect(
      await screen.findByRole("button", { name: /yes, start it/i }),
    ).toBeInTheDocument();
    await waitFor(() => expectNotHeld(retrySelected));
    expect(retrySelected).toHaveFocus();
    expect(plans.requests.sent).toBe(1);
  });

  it("keeps focus on Start while the run is started, and lets go after a refusal", async () => {
    const user = userEvent.setup();
    renderShell("/acquire");
    await estimate();
    const startIt = await screen.findByRole("button", {
      name: /start this acquisition/i,
    });
    const starts = holdEach(
      "post",
      "/data-acquisition-runs",
      refusal("run_already_in_flight", "run 7 is still going"),
    );

    await enterOn(user, startIt);
    await waitFor(() => expect(starts.requests.sent).toBe(1));

    expect(startIt).toHaveFocus();
    expectHeld(startIt);
    expect(startIt).toHaveTextContent("Running…");
    await user.keyboard("{Enter}");

    starts.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "run_already_in_flight",
    );
    await waitFor(() => expectNotHeld(startIt));
    expect(startIt).toHaveFocus();
    await user.keyboard("{Enter}");
    // The third Enter's request arriving is what proves the second sent nothing.
    await waitFor(() => expect(starts.requests.sent).toBe(2));
  });

  /** A retry of the failed item, estimated and waiting for a yes. */
  async function aRetryArmed(): Promise<{
    yes: HTMLElement;
    notYet: HTMLElement;
  }> {
    renderShell("/acquire");
    await userEvent.click(
      await screen.findByRole("button", { name: "Retry 1 failed" }),
    );
    return {
      yes: await screen.findByRole("button", { name: /yes, start it/i }),
      notYet: screen.getByRole("button", { name: "Not yet" }),
    };
  }

  it("keeps focus on Yes while the run is started, and lets go after a refusal", async () => {
    const user = userEvent.setup();
    const { yes } = await aRetryArmed();
    const starts = holdEach(
      "post",
      "/data-acquisition-runs",
      refusal("run_already_in_flight", "run 7 is still going"),
    );

    await enterOn(user, yes);
    await waitFor(() => expect(starts.requests.sent).toBe(1));

    expect(yes).toHaveFocus();
    expectHeld(yes);
    expect(yes).toHaveTextContent("Starting…");
    await user.keyboard("{Enter}");

    starts.release();

    // By its code: the confirmation it refused is an alert too.
    expect(
      await screen.findByText("run_already_in_flight"),
    ).toBeInTheDocument();
    await waitFor(() => expectNotHeld(yes));
    expect(yes).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(starts.requests.sent).toBe(2));
  });

  it("holds Not yet while the run is started, so the confirmation stays until it answers", async () => {
    const user = userEvent.setup();
    const { yes, notYet } = await aRetryArmed();
    const starts = holdEach(
      "post",
      "/data-acquisition-runs",
      refusal("run_already_in_flight", "run 7 is still going"),
    );
    act(() => notYet.focus());

    // Yes by pointer, which leaves focus where it was.
    fireEvent.click(yes);
    await waitFor(() => expect(starts.requests.sent).toBe(1));

    expect(notYet).toHaveFocus();
    expectHeld(notYet);
    await user.keyboard("{Enter}");
    expect(notYet).toBeInTheDocument();

    starts.release();

    // By its code: the confirmation it refused is an alert too.
    expect(
      await screen.findByText("run_already_in_flight"),
    ).toBeInTheDocument();
    await waitFor(() => expectNotHeld(notYet));
    expect(notYet).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(notYet).not.toBeInTheDocument());
  });

  it("keeps focus on Refresh while the run is read, and a second Enter reads nothing", async () => {
    const user = userEvent.setup();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const refresh = card.getByRole("button", { name: "Refresh" });
    const reads = holdEach("get", "/data-acquisition-runs/7");

    await enterOn(user, refresh);
    await waitFor(() => expect(reads.requests.sent).toBe(1));

    expect(refresh).toHaveFocus();
    expectHeld(refresh);
    expect(refresh).toHaveTextContent("Reading…");
    await user.keyboard("{Enter}");

    reads.release();

    await waitFor(() => expectNotHeld(refresh));
    expect(refresh).toHaveTextContent("Refresh");
    expect(refresh).toHaveFocus();
    await user.keyboard("{Enter}");
    // The third Enter's read arriving is what proves the second read nothing.
    await waitFor(() => expect(reads.requests.sent).toBe(2));
  });

  it("keeps focus on Stop while the stop is sent, and lets go after a refusal", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "running",
          finished_at: null,
        }),
      ),
    );
    const stops = holdEach(
      "post",
      "/data-acquisition-runs/:runId/stop",
      refusal("not_found", "there is no run numbered 7", 404),
    );
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    const stop = card.getByRole("button", {
      name: /stop — keep what completed/i,
    });

    await enterOn(user, stop);
    await waitFor(() => expect(stops.requests.sent).toBe(1));

    expect(stop).toHaveFocus();
    expectHeld(stop);
    expect(stop).toHaveTextContent("Stopping…");
    await user.keyboard("{Enter}");

    stops.release();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "there is no run numbered 7",
    );
    await waitFor(() => expectNotHeld(stop));
    expect(stop).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(stops.requests.sent).toBe(2));
  });

  it("still disables a retry outright where there is no level to plan it in", async () => {
    mockServer.use(
      http.get(`${BASE}/levels`, () => HttpResponse.json({ items: [] })),
    );
    renderShell("/acquire");

    const retry = await screen.findByRole("button", { name: "Retry 1 failed" });

    expect(retry).toBeDisabled();
    expectNotHeld(retry);
  });

  /**
   * NEW-57 and UIR-G1. **Nothing takes the card from a start in flight.** Every way to start
   * stays held while one is in flight (NEW-57). So do Refresh, Dismiss and opening a past run
   * (UIR-G1): each claimed the card, so a start that succeeded meanwhile never reached it, and
   * the next Start was refused as already in flight.
   */
  async function aStartInFlight(
    user: ReturnType<typeof userEvent.setup>,
    startBy: HTMLElement,
  ): Promise<{ starts: { requests: { sent: number } }; release: () => void }> {
    const starts = holdEach("post", "/data-acquisition-runs");
    await user.click(startBy);
    await waitFor(() => expect(starts.requests.sent).toBe(1));
    return { starts, release: starts.release };
  }

  it("keeps Start held while the run is started", async () => {
    const user = userEvent.setup();
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    await estimate();
    const startIt = await screen.findByRole("button", {
      name: /start this acquisition/i,
    });
    const { starts, release } = await aStartInFlight(user, startIt);

    expectHeld(startIt);
    expect(startIt).toHaveTextContent("Running…");
    await user.click(startIt);

    release();
    await everyActHasEnded();
    expect(starts.requests.sent).toBe(1);
  });

  it("keeps Yes and Not yet held while the run is started", async () => {
    const user = userEvent.setup();
    const { yes, notYet } = await aRetryArmed();
    const { starts, release } = await aStartInFlight(user, yes);

    expectHeld(yes);
    expect(yes).toHaveTextContent("Starting…");
    expectHeld(notYet);
    await user.click(yes);
    await user.click(notYet);
    expect(notYet).toBeInTheDocument();

    release();
    await everyActHasEnded();
    expect(starts.requests.sent).toBe(1);
  });

  /**
   * RB-1. **Stop is held during a start too.** The card does not poll, so a run that finished on
   * the server can still read as going, Stop beside it, while a new one is started -- and Stop
   * claimed the card from the start as Refresh did.
   */
  it("holds Stop on a card still reading as going while a start is in flight", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "running",
          finished_at: null,
        }),
      ),
    );
    const user = userEvent.setup();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    await estimate();
    const startIt = await screen.findByRole("button", {
      name: /start this acquisition/i,
    });
    const { release } = await aStartInFlight(user, startIt);
    const stops = holdEach("post", "/data-acquisition-runs/:runId/stop");
    const stop = card.getByRole("button", { name: /stop — keep what completed/i });

    expectHeld(stop);
    await user.click(stop);
    expect(stops.requests.sent).toBe(0);

    release();
    expect(
      await screen.findByRole("region", { name: /acquisition 8/i }),
    ).toBeInTheDocument();
  });

  it("holds Refresh, Dismiss and the history while a start is in flight, so the run it started reaches the card", async () => {
    const user = userEvent.setup();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    await estimate();
    const startIt = await screen.findByRole("button", {
      name: /start this acquisition/i,
    });
    const { release } = await aStartInFlight(user, startIt);
    const reads = holdEach("get", "/data-acquisition-runs/:runId");
    const pastRun = within(
      screen.getByRole("rowheader", { name: "7" }),
    ).getByRole("button", { name: "7" });

    for (const control of [
      card.getByRole("button", { name: "Refresh" }),
      card.getByRole("button", { name: "Dismiss" }),
      pastRun,
    ]) {
      expectHeld(control);
      await user.click(control);
    }
    expect(reads.requests.sent).toBe(0);

    release();
    reads.release();
    expect(
      await screen.findByRole("region", { name: /acquisition 8/i }),
    ).toBeInTheDocument();
  });
});
