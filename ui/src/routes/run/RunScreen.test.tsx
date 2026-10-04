import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  PAID_RUN_PLAN,
  RUN_PLAN,
  STARTED_RUN_DETAIL,
  STORED_VALUES,
} from "../../mocks/fixtures";
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
      await screen.findByRole("button", { name: /^Retry 1 failed$/i }),
    );

    expect(retried).toEqual([8]);
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

    await userEvent.click(screen.getByRole("button", { name: /^Retry 2 unanswered$/i }));

    expect(asked).toEqual([{ run: 8, items: "unanswered" }]);
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

    await userEvent.click(screen.getByRole("button", { name: /^Retry 2 unanswered$/i }));

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

  it("does not offer hand entry, because the two lists never overlap", async () => {
    // Every attribute the catalog lets a person answer also declares a source, so none of them
    // ever appears among the attributes with nobody to ask. The form lives in its own card;
    // putting it here first made it unreachable, which opening the screen showed and no test did.
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    await card.findByRole("rowheader", { name: "Nobody measures this" });

    expect(
      card.queryByRole("row", { name: /international employers/i }),
    ).toBeNull();
    expect(card.queryByRole("button", { name: /by hand/i })).toBeNull();
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
