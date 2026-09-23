import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { PAID_RUN_PLAN, RUN_PLAN } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

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
      await screen.findByRole("heading", { name: /acquisition 8/i }),
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
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /retry everything that failed/i }),
    );

    expect(retried).toEqual([8]);
    expect(
      await screen.findByRole("heading", { name: /acquisition 12/i }),
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

    expect(
      await screen.findByText(/nothing failed in this acquisition/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry everything that failed/i }),
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
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    return await screen.findByRole("heading", { name: /acquisition 8/i });
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

    await userEvent.click(screen.getByRole("button", { name: /ask again about all of them/i }));

    expect(asked).toEqual([{ run: 8, items: "unanswered" }]);
    expect(
      await screen.findByRole("heading", { name: /acquisition 14/i }),
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

    expect(screen.queryByRole("button", { name: /ask again about all of them/i })).toBeNull();
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

    await userEvent.click(screen.getByRole("button", { name: /ask again about all of them/i }));

    expect(await screen.findByText(/no unanswered items/i)).toBeInTheDocument();
  });
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
      await screen.findByRole("heading", { name: /acquisition 7/i }),
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
    await screen.findByRole("heading", { name: /acquisition 8/i });

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
    await screen.findByRole("heading", { name: /acquisition 8/i });
  }

  it("groups failures by the source that refused", async () => {
    await openRun();

    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    expect(
      group.getByRole("button", { name: /^oecd \(1\)$/i }),
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
    expect(
      group.getByRole("button", {
        name: /country\.overcrowding_rate \(1\)/i,
      }),
    ).toBeInTheDocument();
  });

  it("starts with everything selected, and clears on request", async () => {
    await openRun();
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );

    expect(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    ).toBeEnabled();

    await userEvent.click(group.getByRole("button", { name: "Clear all" }));

    expect(
      group.getByRole("button", { name: /^Retry 0 selected$/ }),
    ).toBeDisabled();
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
    await screen.findByRole("heading", { name: /acquisition 8/i });
    return within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
  }

  it("opens a group to show the items inside it", async () => {
    const group = await failureGroup();
    const head = group.getByRole("button", { name: /^oecd \(1\)$/i });
    expect(head).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(head);

    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(
      group.getByRole("checkbox", {
        name: /country\.liechtenstein country\.total_tax_rate_effective/i,
      }),
    ).toBeChecked();
  });

  it("closes a group that was open", async () => {
    const group = await failureGroup();
    const head = group.getByRole("button", { name: /^oecd \(1\)$/i });

    await userEvent.click(head);
    await userEvent.click(head);

    expect(head).toHaveAttribute("aria-expanded", "false");
  });

  it("clears and restores one group with All and None", async () => {
    const group = await failureGroup();

    await userEvent.click(group.getByRole("button", { name: "None" }));
    expect(group.getByText("0 selected")).toBeInTheDocument();

    await userEvent.click(group.getByRole("button", { name: "All" }));
    expect(group.getByText("1 selected")).toBeInTheDocument();
  });

  it("selects everything again after a clear", async () => {
    const group = await failureGroup();

    await userEvent.click(group.getByRole("button", { name: "Clear all" }));
    await userEvent.click(group.getByRole("button", { name: "Select all" }));

    expect(
      group.getByRole("button", { name: /^Retry 1 selected$/ }),
    ).toBeEnabled();
  });

  it("unpicks a single item without touching the others", async () => {
    const group = await failureGroup();
    await userEvent.click(group.getByRole("button", { name: /^oecd \(1\)$/i }));

    await userEvent.click(
      group.getByRole("checkbox", {
        name: /country\.liechtenstein country\.total_tax_rate_effective/i,
      }),
    );

    expect(
      group.getByRole("button", { name: /^Retry 0 selected$/ }),
    ).toBeDisabled();
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
        await screen.findByRole("heading", { name: /acquisition 8/i });
        return screen.findByRole("region", {
          name: /which values went unanswered/i,
        });
      })(),
    );

    // Two unanswered items share one candidate and differ by attribute, so the scope is one
    // candidate by two attributes -- two pairs for two items, a full rectangle.
    expect(
      group.getByRole("button", { name: /^Ask again about 2 selected$/ }),
    ).toBeEnabled();
  });
});

/**
 * UX review H. Three reasons a figure is missing look identical in a ranking and have
 * entirely different remedies: a source refused, a source had nothing, or there is no source.
 * Only the first two are worth asking again about.
 */
describe("attributes with no data source at all", () => {
  it("lists an attribute nobody would even be asked about", async () => {
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

  it("leaves out attributes that do have a source", async () => {
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

  it("names hand entry as the remedy where the catalog permits it", async () => {
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    const row = await card.findByRole("row", { name: /nobody measures this/i });
    expect(row).toHaveTextContent(/enter a value by hand/i);
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
      name: /total_tax_rate_effective/i,
    });
    expect(row).toHaveTextContent("newly acquired");
  });

  it("names a pair both runs produced as refreshed", async () => {
    renderShell("/acquire");
    const panel = await compare("5", "7");

    const row = await panel.findByRole("row", {
      name: /cost_of_living_index/i,
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
      name: /total_tax_rate_effective/i,
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
      name: /cost_of_living_index/i,
    });
    expect(row).toHaveTextContent("unchanged");
    // And the figure itself in both columns, so the verdict is checkable rather than trusted.
    expect(within(row).getAllByText("94.5 index_eu27_100")).toHaveLength(2);
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
    await screen.findByRole("heading", { name: /acquisition 8/i });
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
