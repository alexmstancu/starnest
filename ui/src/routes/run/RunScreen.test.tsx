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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTES,
  DATA_SOURCES,
  HOLDINGS_GAPS,
  HOLDINGS_PAIRS_TOTAL,
  PAID_RUN_PLAN,
  RUNS,
  RUN_PLAN,
  SETTINGS,
  STARTED_RUN_DETAIL,
  STORED_VALUES,
} from "../../mocks/fixtures";
import { type Holdings, type Run, type RunDetail, updateDataSource } from "../../api/endpoints";
import { presentError } from "../../api/errorPresentation";
import { formatMoney } from "../../format/display";
import { mockServer } from "../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../testing/keyboard";
import { renderShell } from "../../testing/renderShell";
import { serveSourceNames } from "../../testing/sourceNames";
import { useRunScreen } from "./useRunScreen";

/**
 * The Run tab: estimate, confirm, watch, and retry only what failed (`reqs.md` 6.3, 6.4).
 *
 * The rule these tests hold is that **nothing is fetched until the estimate has been seen and
 * accepted**, and that a failure is something to act on rather than only to read.
 */

const BASE = "/v1";

/**
 * What `GET /holdings` serves at country level, with `over` laid on top. **Values stored are
 * worked out from the gaps**, as the server's one read closes them, so a test that changes the
 * gaps cannot serve a total that does not add up.
 */
function holdingsServed(over: Partial<Holdings> = {}): Holdings {
  const gaps = over.gaps ?? HOLDINGS_GAPS;
  const pairsTotal = over.pairs_total ?? HOLDINGS_PAIRS_TOTAL;
  return {
    level: "country",
    pairs_total: pairsTotal,
    values_stored:
      pairsTotal - gaps.failed.length - gaps.unanswered.length - gaps.not_reached.length,
    values_past_allowed_age: 37,
    values_older_than_refetch_age: null,
    spent: { since: "2026-10-01T00:00:00+02:00", runs_eur: 0, research_eur: 0, total_eur: 0 },
    ...over,
    gaps,
  };
}

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

  /**
   * RB-4. **No programmatic identifiers in rendered text**, and a source id is one: the plan
   * listed `world_bank` where the catalog says "World Bank".
   */
  it("names each source in the plan as the catalog does, never by its id", async () => {
    serveSourceNames({ world_bank: "World Bank" });
    renderShell("/acquire");

    await estimate();

    const plan = await screen.findByRole("table", { name: /per source/i });
    expect(
      await within(plan).findByRole("rowheader", { name: "World Bank" }),
    ).toBeInTheDocument();
    expect(
      within(plan).getByRole("rowheader", { name: "Eurostat" }),
    ).toBeInTheDocument();
    expect(plan).not.toHaveTextContent(/\b(world_bank|eurostat)\b/);
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

    expect(await screen.findByRole("alert")).toHaveTextContent("The server refused this.");
  });
});

/**
 * PL-120, UF-081. **An estimate with nothing to ask is refused at once**, with its reason in
 * words and, where a setting lifts it, the way there -- never "Items 0" beside a live Start.
 */
describe("an estimate with nothing to ask", () => {
  async function everySourceOff(): Promise<void> {
    for (const source of ["eurostat", "llm"]) await updateDataSource(source, { is_enabled: false });
  }

  it("is refused with every source switched off, pointing at Source priority", async () => {
    await everySourceOff();
    renderShell("/acquire");

    await estimate();

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent("The estimate did not go through");
    expect(refusal).toHaveTextContent(
      "Every data source it may ask is switched off, so there is nothing to ask.",
    );
    expect(
      within(refusal).getByRole("link", { name: "Open Source priority in Configure" }),
    ).toHaveAttribute("href", "/configure");
    expect(screen.queryByRole("button", { name: /start this acquisition/i })).toBeNull();
    expect(screen.queryByText("Items")).toBeNull();
  });

  it("offers no confirmation for a remedy card with every source switched off", async () => {
    await everySourceOff();
    serveGaps({
      not_reached: [
        { candidate: "country.spain", attribute: "country.total_tax_rate_effective", data_acquisition_run: null },
      ],
    });
    renderShell("/acquire");

    await userEvent.click(await screen.findByRole("button", { name: "Ask 1 not reached" }));

    expect(await screen.findByText(/every data source it may ask is switched off/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /yes, start it/i })).toBeNull();
  });

  it("says the scope is still fresh, and points at the refetch setting", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, () =>
        HttpResponse.json(
          {
            code: "nothing_to_fetch",
            message: "SENTINEL_MESSAGE",
            details: { reason: "still_fresh", refetch_older_than_days: 30 },
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/acquire");

    await estimate();

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(/fetched within the last 30 days/);
    expect(refusal).not.toHaveTextContent("SENTINEL_MESSAGE");
    expect(within(refusal).getByRole("link", { name: "Change it in Configure" })).toBeInTheDocument();
  });

  it("offers no way out where no setting lifts it", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, () =>
        HttpResponse.json(
          { code: "nothing_to_fetch", message: "SENTINEL_MESSAGE", details: { reason: "nothing_answerable", candidates: 32 } },
          { status: 409 },
        ),
      ),
    );
    renderShell("/acquire");

    await estimate();

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(/no switched-on source can answer anything in it/i);
    expect(within(refusal).queryByRole("link")).toBeNull();
  });

  it("never arms a confirmation over nought items", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, () =>
        HttpResponse.json({ ...RUN_PLAN, items_total: 0, by_source: [] }),
      ),
    );
    const { result } = renderHook(() => useRunScreen("country"));
    await waitFor(() => expect(result.current.current?.id).toBe(7));

    act(() => result.current.propose({ via: "scoped", scope: { level: "country" } }, "not_reached"));
    await waitFor(() => expect(result.current.plan?.items_total).toBe(0));

    expect(result.current.armed).toBeNull();
  });

  it("offers no Start for a plan of nought items", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, () =>
        HttpResponse.json({ ...RUN_PLAN, items_total: 0, by_source: [] }),
      ),
    );
    renderShell("/acquire");

    await estimate();

    const card = within(screen.getByRole("region", { name: /an acquisition over every country/i }));
    expect(await card.findByText("Items")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /start this acquisition/i })).toBeNull();
  });
});

/**
 * PL-004, P1-14: **every refusal can be dismissed, and Try again sends the same request again**
 * -- offered for an estimate, which costs nothing, and never for a start, which could begin a
 * second paid run.
 */
describe("a refused act", () => {
  function plansRefused(times: number): { asked: number } {
    const plans = { asked: 0 };
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, () => {
        plans.asked += 1;
        if (plans.asked > times) return undefined;
        return new HttpResponse("Internal Server Error", { status: 500 });
      }),
    );
    return plans;
  }

  async function theRefusal() {
    return within(await screen.findByRole("alert"));
  }

  it("can be dismissed, and is gone", async () => {
    plansRefused(1);
    renderShell("/acquire");
    await estimate();

    await userEvent.click((await theRefusal()).getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends a failed estimate again on Try again, and shows it", async () => {
    const plans = plansRefused(1);
    renderShell("/acquire");
    await estimate();
    const refusal = await theRefusal();
    expect(refusal.getByText(/the estimate did not go through/i)).toBeInTheDocument();

    await userEvent.click(refusal.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("At most")).toBeInTheDocument();
    expect(plans.asked).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so again when the estimate sent again fails too", async () => {
    const plans = plansRefused(2);
    renderShell("/acquire");
    await estimate();

    await userEvent.click((await theRefusal()).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(plans.asked).toBe(2));
    expect(await theRefusal()).toBeTruthy();
    expect(screen.getByText(/the estimate did not go through/i)).toBeInTheDocument();
    expect(screen.queryByText("At most")).toBeNull();
  });

  it("offers Dismiss and no Try again when a start was refused", async () => {
    let starts = 0;
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, () => {
        starts += 1;
        return HttpResponse.json(
          { code: "run_already_in_flight", message: "Another run is in flight." },
          { status: 409 },
        );
      }),
    );
    renderShell("/acquire");
    await estimate();
    await userEvent.click(screen.getByRole("button", { name: /start this acquisition/i }));

    const refusal = await theRefusal();
    expect(refusal.getByText(/the start did not go through/i)).toBeInTheDocument();
    expect(refusal.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(refusal.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(starts).toBe(1);
  });

  it("reads a run again on Try again when reading it back failed", async () => {
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    failTheNextReadOf(6).release();
    await openFromHistory("6");
    const refusal = within(await screen.findByRole("alert"));
    expect(refusal.getByText("Reading acquisition 6 did not go through")).toBeInTheDocument();

    await userEvent.click(refusal.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("region", { name: /acquisition 6/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers Dismiss and no Try again when a stop was refused", async () => {
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
        HttpResponse.json({ code: "not_found", message: "x" }, { status: 404 }),
      ),
    );
    renderShell("/acquire");
    const card = within(await screen.findByRole("region", { name: /acquisition 7/i }));
    await userEvent.click(card.getByRole("button", { name: /stop — keep what completed/i }));

    const refusal = within(await screen.findByRole("alert"));
    expect(refusal.getByText("Stopping acquisition 7 did not go through")).toBeInTheDocument();
    expect(refusal.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says it is not known whether a start that got no answer began", async () => {
    mockServer.use(http.post(`${BASE}/data-acquisition-runs`, () => HttpResponse.error()));
    renderShell("/acquire");
    await estimate();
    await userEvent.click(screen.getByRole("button", { name: /start this acquisition/i }));

    const refusal = await theRefusal();
    expect(
      refusal.getByText(/not known whether the run began; the history will show it/i),
    ).toBeInTheDocument();
    expect(refusal.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("running and retrying", () => {
  it("shows the run's progress and what it could not answer", async () => {
    serveSourceNames({ oecd: "OECD" });
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
    const head = await broke.findByRole("button", { name: "OECD 1 item" });

    await userEvent.click(head);

    expect(
      broke.getByText(/the oecd's cloudflare front answered with a browser challenge/i),
    ).toBeInTheDocument();
  });

  it("arms a confirmation before retrying what failed, then retries its run (UI-02, PL-124)", async () => {
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });
    const started = recordRetries(12);

    await userEvent.click(
      await screen.findByRole("button", { name: /^Retry 1 failed$/i }),
    );

    // The whole-bucket retry no longer fires on the click: it estimates and confirms first, the
    // same step the selected-item retry already had (UI-02, reqs.md 6.3).
    const strip = await screen.findByRole("alert");
    expect(started).toEqual([]);

    await userEvent.click(within(strip).getByRole("button", { name: /yes, start it/i }));

    await waitFor(() => expect(started).toHaveLength(1));
    // The gap's own run, over exactly its pair: the retry asks only the source that failed.
    expect(started[0]).toEqual({
      runId: 7,
      body: { items: "failed", pairs: [TAX_PAIR], accept_uncapped_spend: false },
    });
    expect(
      await screen.findByRole("region", { name: /acquisition 12/i }),
    ).toBeInTheDocument();
  });
});

const TAX_PAIR = { candidate: "country.liechtenstein", attribute: "country.total_tax_rate_effective" };

/** Records every retry sent, with the run it named, and answers with run `id`. */
function recordRetries(id: number): { runId: number; body: unknown }[] {
  const sent: { runId: number; body: unknown }[] = [];
  mockServer.use(
    http.post(`${BASE}/data-acquisition-runs/:runId/retry`, async ({ params, request }) => {
      sent.push({ runId: Number(params["runId"]), body: await request.json() });
      return HttpResponse.json({ ...RUNS[0], id }, { status: 202 });
    }),
  );
  return sent;
}

/** Serves `gaps` as what the database holds at country level, values stored made to close. */
function serveGaps(gaps: Partial<Holdings["gaps"]>): void {
  mockServer.use(
    http.get(`${BASE}/holdings`, () =>
      HttpResponse.json(
        holdingsServed({ gaps: { failed: [], unanswered: [], not_reached: [], ...gaps } }),
      ),
    ),
  );
}

/** The failures a run reports, as the gaps they leave: one per pair, each source's message on it. */
function failedGapsOf(
  failures: readonly { data_source: string; candidate: string; attribute: string; error_message: string }[],
): Holdings["gaps"]["failed"] {
  const gaps = new Map<string, Holdings["gaps"]["failed"][number]>();
  for (const { data_source, candidate, attribute, error_message } of failures) {
    const key = `${candidate}|${attribute}`;
    const gap = gaps.get(key) ?? { candidate, attribute, data_acquisition_run: 7, failures: [] };
    gap.failures.push({ data_source, error_message });
    gaps.set(key, gap);
  }
  return [...gaps.values()];
}

/**
 * PL-053, PL-054 (C04-N2). **The cards are the database's gaps, by their latest outcome**: a pair
 * with no value in use, failed where a source broke on it last. So a figure rejected by its
 * credible range leaves a gap and is offered again (BE-08's intent kept), while an OECD failure on
 * an item the estimate answered is no gap and is not offered -- whatever the run on the card says.
 */
describe("the remedy cards", () => {
  const TAX_RATE = "country.total_tax_rate_effective";
  const CHALLENGE = "the oecd's cloudflare front answered with a browser challenge";

  async function theGaps(): Promise<HTMLElement> {
    renderShell("/acquire");
    const gaps = await screen.findByRole("region", { name: /what you can do about the gaps/i });
    await within(gaps).findByRole("heading", { name: /^\d[\d,]*\s*unanswered$/ });
    return gaps;
  }

  it("count a figure rejected by its credible range, which leaves a gap", async () => {
    serveGaps({
      failed: failedGapsOf([
        {
          data_source: "eurostat",
          candidate: "country.malta",
          attribute: "country.homicide_rate",
          error_message: "41.2 is outside the credible range 0 to 30",
        },
      ]),
    });
    const gaps = within(await theGaps());

    expect(gaps.getByRole("heading", { name: /^1\s*failed$/ })).toBeInTheDocument();
    expect(gaps.getByRole("button", { name: "Retry 1 failed" })).toBeInTheDocument();
  });

  it("do not offer a failure on an item another source answered", async () => {
    // The run on the card still reports OECD's failure; the database has the estimate's figure.
    serveGaps({});
    const gaps = within(await theGaps());

    expect(gaps.getByRole("heading", { name: /^0\s*failed$/ })).toBeInTheDocument();
    expect(gaps.queryByRole("region", { name: /which sources broke/i })).toBeNull();
    expect(gaps.queryByRole("button", { name: /^Retry \d+ failed$/ })).toBeNull();
  });

  it("count an item two sources failed on once", async () => {
    serveGaps({
      failed: failedGapsOf([
        { data_source: "oecd", candidate: "country.liechtenstein", attribute: TAX_RATE, error_message: CHALLENGE },
        {
          data_source: "eurostat_estimate",
          candidate: "country.liechtenstein",
          attribute: TAX_RATE,
          error_message: "71.0 is outside the credible range 10 to 60",
        },
      ]),
    });
    const gaps = within(await theGaps());

    expect(gaps.getByRole("heading", { name: /^1\s*failed$/ })).toBeInTheDocument();
    expect(gaps.getByRole("button", { name: "Retry 1 failed" })).toBeInTheDocument();
  });

  /** PL-059. The design's inert state: the card stays, reads nought, and its action does nothing. */
  it("read Nothing is failing, and do nothing, when nothing failed", async () => {
    let planned = 0;
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, () => {
        planned += 1;
        return HttpResponse.json(RUN_PLAN);
      }),
    );
    serveGaps({ unanswered: HOLDINGS_GAPS.unanswered });
    const gaps = within(await theGaps());
    const inert = gaps.getByRole("button", { name: "Nothing is failing" });

    expect(inert).toBeDisabled();
    await userEvent.click(inert);
    expect(planned).toBe(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("read Nothing went unanswered when every pair was answered or failed", async () => {
    serveGaps({ failed: HOLDINGS_GAPS.failed });
    const gaps = within(await theGaps());

    expect(gaps.getByRole("heading", { name: /^0\s*unanswered$/ })).toBeInTheDocument();
    expect(gaps.getByRole("button", { name: "Nothing went unanswered" })).toBeDisabled();
    expect(gaps.queryByRole("region", { name: /which values went unanswered/i })).toBeNull();
  });

  it("say what their counts are of: every value at the level, by its latest outcome", async () => {
    const gaps = within(await theGaps());

    expect(
      gaps.getByText(/^All 1,312 values at country level, by their latest outcome\./),
    ).toBeInTheDocument();
  });

  it("stay when the acquisition card is dismissed", async () => {
    renderShell("/acquire");
    const card = await screen.findByRole("region", { name: /^acquisition 7$/i });
    await userEvent.click(within(card).getByRole("button", { name: "Dismiss" }));

    expect(await screen.findByRole("button", { name: "Retry 1 failed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 2 unanswered" })).toBeInTheDocument();
  });

  it("do not change when an older acquisition is opened", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/6`, () =>
        HttpResponse.json({ ...STARTED_RUN_DETAIL, id: 6, failures: [], unanswered: [] }),
      ),
    );
    renderShell("/acquire");
    await screen.findByRole("button", { name: "Retry 1 failed" });
    const six = await screen.findByRole("rowheader", { name: "6" });

    await userEvent.click(within(six).getByRole("button", { name: "6" }));
    await screen.findByRole("region", { name: /^acquisition 6$/i });

    expect(screen.getByRole("button", { name: "Retry 1 failed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 2 unanswered" })).toBeInTheDocument();
  });

  /** The 2.3 guard on screen: values stored and the three gap counts close on the pairs total. */
  it("add up with the values stored to every value at the level", async () => {
    serveGaps({
      ...HOLDINGS_GAPS,
      not_reached: [
        { candidate: "country.spain", attribute: TAX_RATE, data_acquisition_run: 7 },
        { candidate: "country.estonia", attribute: TAX_RATE, data_acquisition_run: null },
      ],
    });
    const gaps = within(await theGaps());
    const panel = within(screen.getByRole("region", { name: /what the database holds/i }));
    const count = (text: string) => Number(text.replace(/[^\d]/g, ""));
    const stored = count((await panel.findByText("Values stored")).nextElementSibling!.textContent);
    const heads = [/^\d+\s*failed$/, /^\d+\s*unanswered$/, /^\d+\s*not reached$/].map((name) =>
      count(gaps.getByRole("heading", { name }).querySelector(".gap-card__count")!.textContent),
    );

    expect(stored + heads.reduce((total, each) => total + each, 0)).toBe(HOLDINGS_PAIRS_TOTAL);
  });
});

/**
 * C04-N7. **A pair no source was asked about yet is neither failed nor unanswered**: a stopped
 * run's never-reached items, and pairs no run has included, get a card of their own, drawn only
 * when there are any, whose remedy goes through the same estimate and confirmation.
 */
describe("what no source was asked about yet", () => {
  const TAX_RATE = "country.total_tax_rate_effective";

  it("is not drawn when every pair was asked", async () => {
    renderShell("/acquire");
    await screen.findByRole("button", { name: "Retry 1 failed" });

    expect(screen.queryByRole("region", { name: /not reached$/ })).toBeNull();
  });

  it("is asked about through an estimate and a confirmation, over exactly its pairs", async () => {
    const planned: unknown[] = [];
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, async ({ request }) => {
        planned.push(await request.json());
        return HttpResponse.json(RUN_PLAN);
      }),
    );
    serveGaps({
      not_reached: [
        { candidate: "country.spain", attribute: TAX_RATE, data_acquisition_run: 7 },
        { candidate: "country.estonia", attribute: TAX_RATE, data_acquisition_run: null },
      ],
    });
    renderShell("/acquire");
    const card = within(await screen.findByRole("region", { name: /^2\s*not reached$/ }));
    expect(card.getByText(/no source was asked yet/i)).toBeInTheDocument();

    await userEvent.click(card.getByRole("button", { name: "Ask 2 not reached" }));

    expect(await card.findByRole("alert")).toBeInTheDocument();
    // Exact pairs, as a scoped run: what was never asked has no run to retry (PL-124).
    expect(planned).toEqual([
      {
        level: "country",
        pairs: [
          { candidate: "country.spain", attribute: TAX_RATE },
          { candidate: "country.estonia", attribute: TAX_RATE },
        ],
      },
    ]);
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

  it("arms a confirmation before asking again, then retries its run's unanswered items (UI-02, PL-124)", async () => {
    await openTheRun();
    const started = recordRetries(14);

    await userEvent.click(screen.getByRole("button", { name: /^Retry 2 unanswered$/i }));

    // Nothing that can spend fires on the click: the whole-bucket retry now takes the same
    // estimate-and-confirm step the selected-item retry already had (reqs.md 6.3).
    const strip = await screen.findByRole("alert");
    expect(started).toEqual([]);

    await userEvent.click(within(strip).getByRole("button", { name: /yes, start it/i }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ runId: 7, body: { items: "unanswered" } });
    expect(
      await screen.findByRole("region", { name: /acquisition 14/i }),
    ).toBeInTheDocument();
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

/**
 * PL-051, PL-052. **The panel is the database, not the last acquisition**: every figure comes
 * from the holdings read, so opening, dismissing or retrying a run moves none of them, and the
 * month's spend is the server's sum over runs and gate research, which the run list cannot see.
 */
describe("what the database holds", () => {
  async function thePanel(): Promise<HTMLElement> {
    const panel = await screen.findByRole("region", { name: /what the database holds/i });
    await within(panel).findByText("Values stored");
    return panel;
  }

  function figure(panel: HTMLElement, label: string): HTMLElement {
    return within(panel).getByText(label).parentElement!;
  }

  it("counts the values stored out of the pairs the level has, from the holdings read", async () => {
    renderShell("/acquire");
    const panel = await thePanel();

    expect(figure(panel, "Values stored")).toHaveTextContent(/1,309\s*of 1,312 at country level/);
    expect(figure(panel, "Past their allowed age")).toHaveTextContent("37");
  });

  it("does not change when a smaller acquisition is opened", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/6`, () =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: 6,
          progress: {
            items_total: 2,
            items_completed: 2,
            items_failed: 0,
            items_unanswered: 0,
            items_not_reached: 0,
          },
          failures: [],
          unanswered: [],
        }),
      ),
    );
    renderShell("/acquire");
    const panel = await thePanel();
    const six = await screen.findByRole("rowheader", { name: "6" });

    await userEvent.click(within(six).getByRole("button", { name: "6" }));
    await screen.findByRole("region", { name: /^acquisition 6$/i });

    expect(figure(panel, "Values stored")).toHaveTextContent(/1,309\s*of 1,312/);
  });

  it("names the newest acquisition that stored anything as the last to fill it", async () => {
    renderShell("/acquire");
    const panel = await thePanel();

    await within(panel).findByText("Acquisition 7");
  });

  it("says this month's spend is the server's figure, research included", async () => {
    let since: string | null = null;
    mockServer.use(
      http.get(`${BASE}/holdings`, ({ request }) => {
        since = new URL(request.url).searchParams.get("since");
        return HttpResponse.json(
          holdingsServed({ spent: { since: since!, runs_eur: 0.04, research_eur: 0.42, total_eur: 0.46 } }),
        );
      }),
    );
    renderShell("/acquire");
    const panel = await thePanel();

    expect(figure(panel, "Spent this month")).toHaveTextContent(formatMoney(0.46, "EUR"));
    // The reader's month start, with the reader's zone (C04-N10).
    const now = new Date();
    expect(new Date(since!).getTime()).toBe(
      new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    );
    expect(since).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("captions the cap as per acquisition and per research pass", async () => {
    renderShell("/acquire");
    const panel = await thePanel();

    expect(figure(panel, "Spent this month")).toHaveTextContent(
      `the cap is ${formatMoney(10, "EUR")} per acquisition and per research pass`,
    );
  });

  it("never says an uncapped acquisition refuses, since the strip offers to accept it", async () => {
    mockServer.use(
      http.get(`${BASE}/settings`, () =>
        HttpResponse.json({ ...SETTINGS, run_spend_cap_eur: null }),
      ),
    );
    renderShell("/acquire");
    const panel = await thePanel();

    expect(figure(panel, "Spent this month")).toHaveTextContent(
      /no cap is set: an acquisition that would spend asks you to accept going uncapped/,
    );
    expect(panel).not.toHaveTextContent(/refuses/);
  });

  it("counts the candidates scored as the sidebar does", async () => {
    renderShell("/acquire");
    const panel = await thePanel();
    const sidebar = await screen.findByRole("region", { name: "Candidates" });
    const count = async (label: string) =>
      Number((await within(sidebar).findByText(label)).nextElementSibling!.textContent);
    const scored = (await count("Matching")) + (await count("Not matching"));

    expect(
      await within(panel).findByText("Candidates scored"),
    ).toBeInTheDocument();
    expect(figure(panel, "Candidates scored")).toHaveTextContent(String(scored));
  });

  it("says why nothing is scored when the score range is not set", async () => {
    mockServer.use(
      http.get(`${BASE}/rankings`, () =>
        HttpResponse.json(
          {
            code: "score_scale_not_set",
            message: "the top of the score range is not set",
            details: {},
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/acquire");
    const panel = await thePanel();

    expect(
      await within(panel).findByText(/the top of the score range is not set yet/i),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/could not be loaded/i)).toBeNull();
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
 * PL-124, D32. **A selection is asked about as its exact pairs**: through the retry of the run
 * its gaps belong to, estimated by `planRetry`, so a failure is asked only of the source that
 * failed; a selection spanning runs is a run scoped to those pairs. The card has one action,
 * and its label follows the selection.
 */
describe("re-asking about part of a run", () => {
  async function openRun() {
    serveSourceNames({ oecd: "OECD" });
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });
  }

  function failedCard() {
    return within(screen.getByRole("region", { name: /^1\s*failed$/ }));
  }

  async function selectEveryFailure(): Promise<void> {
    const group = within(await screen.findByRole("region", { name: /which sources broke/i }));
    await userEvent.click(group.getByRole("button", { name: "Select all" }));
  }

  function recordPlans(): { retries: { runId: number; body: unknown }[]; scoped: unknown[] } {
    const sent = { retries: [] as { runId: number; body: unknown }[], scoped: [] as unknown[] };
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry/plan`, async ({ params, request }) => {
        sent.retries.push({ runId: Number(params["runId"]), body: await request.json() });
        return undefined;
      }),
      http.post(`${BASE}/data-acquisition-runs/plan`, async ({ request }) => {
        sent.scoped.push(await request.clone().json());
        return undefined;
      }),
    );
    return sent;
  }

  /**
   * RB-4. **Named as the catalog names the source.** The head printed the failure's `oecd`,
   * on the reasoning that the id is what the publisher is called; the catalog calls it "OECD".
   */
  it("groups failures by the source that refused", async () => {
    await openRun();

    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    const head = await group.findByRole("button", { name: "OECD 1 item" });
    expect(head).not.toHaveTextContent(/\boecd\b/);
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
      group.getByRole("button", { name: /^Overcrowding rate 1 item$/i }),
    ).toBeInTheDocument();
  });

  it("has one action, whose label follows the selection", async () => {
    await openRun();
    expect(failedCard().getByRole("button", { name: "Retry 1 failed" })).toBeInTheDocument();

    await selectEveryFailure();

    expect(failedCard().getByRole("button", { name: "Retry 1 selected" })).toBeInTheDocument();
    expect(failedCard().queryByRole("button", { name: /^Retry \d+ failed$/ })).toBeNull();

    await userEvent.click(failedCard().getByRole("button", { name: "Clear all" }));
    expect(failedCard().getByRole("button", { name: "Retry 1 failed" })).toBeInTheDocument();
  });

  it("estimates a selection through its run's retry, over exactly its pairs", async () => {
    await openRun();
    const sent = recordPlans();
    await selectEveryFailure();

    await userEvent.click(screen.getByRole("button", { name: "Retry 1 selected" }));

    await screen.findByRole("button", { name: /yes, start it/i });
    expect(sent.retries).toEqual([{ runId: 7, body: { items: "failed", pairs: [TAX_PAIR] } }]);
    expect(sent.scoped).toEqual([]);
  });

  /**
   * UX review D. Nothing that can spend fires on a click, and the strip names the sources the
   * retry would ask -- only the one that failed.
   */
  it("arms a confirmation naming the sources it would ask", async () => {
    await openRun();
    await selectEveryFailure();

    await userEvent.click(screen.getByRole("button", { name: "Retry 1 selected" }));

    const strip = await screen.findByRole("alert");
    expect(strip).toHaveTextContent(/This starts a new acquisition over 1 values/);
    expect(strip).toHaveTextContent("It asks OECD about 1 item.");
    expect(strip).toHaveTextContent(/costs nothing/i);
  });

  it("starts nothing when the confirmation is cancelled", async () => {
    await openRun();
    const started = recordRetries(12);
    await selectEveryFailure();
    await userEvent.click(screen.getByRole("button", { name: "Retry 1 selected" }));

    const strip = await screen.findByRole("alert");
    await userEvent.click(within(strip).getByRole("button", { name: "Not yet" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(started).toEqual([]);
  });

  it("retries exactly the selection once it is agreed to", async () => {
    await openRun();
    const started = recordRetries(12);
    await selectEveryFailure();
    await userEvent.click(screen.getByRole("button", { name: "Retry 1 selected" }));

    const strip = await screen.findByRole("alert");
    await userEvent.click(within(strip).getByRole("button", { name: /yes, start it/i }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toEqual({
      runId: 7,
      body: { items: "failed", pairs: [TAX_PAIR], accept_uncapped_spend: false },
    });
  });

  it("scopes a selection spanning two runs to its pairs, naming every source asked", async () => {
    const malta = { candidate: "country.malta", attribute: "country.homicide_rate" };
    serveGaps({
      failed: [
        { ...TAX_PAIR, data_acquisition_run: 7, failures: [{ data_source: "eurostat", error_message: "late" }] },
        { ...malta, data_acquisition_run: 6, failures: [{ data_source: "eurostat", error_message: "late" }] },
      ],
    });
    renderShell("/acquire");
    const sent = recordPlans();

    await userEvent.click(await screen.findByRole("button", { name: "Retry 2 failed" }));

    const strip = await screen.findByRole("alert");
    expect(sent.scoped).toEqual([{ level: "country", pairs: [TAX_PAIR, malta] }]);
    expect(sent.retries).toEqual([]);
    expect(strip).toHaveTextContent("It asks Eurostat about 2 items.");
  });

  it("says a selection the run does not hold was not retried, and offers only Dismiss", async () => {
    await openRun();
    await selectEveryFailure();
    await userEvent.click(screen.getByRole("button", { name: "Retry 1 selected" }));
    await screen.findByRole("button", { name: /yes, start it/i });
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry`, () =>
        HttpResponse.json(
          {
            code: "selection_not_in_run",
            message: "SENTINEL_MESSAGE",
            details: { items: "failed", pairs: [TAX_PAIR] },
          },
          { status: 409 },
        ),
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: /yes, start it/i }));

    const refusal = (await screen.findByText("The start did not go through")).parentElement!;
    expect(refusal).toHaveTextContent(
      "One selected item is not among what this acquisition can retry, so nothing was retried.",
    );
    expect(refusal).not.toHaveTextContent("SENTINEL_MESSAGE");
    expect(within(refusal).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("refuses the estimate of a retry while a run is in flight, naming it", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry/plan`, () =>
        HttpResponse.json(
          { code: "run_already_in_flight", message: "SENTINEL_MESSAGE", details: { run: 9 } },
          { status: 409 },
        ),
      ),
    );
    renderShell("/acquire");

    await userEvent.click(await screen.findByRole("button", { name: "Retry 1 failed" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent("The estimate did not go through");
    expect(refusal).toHaveTextContent("Acquisition 9 is still going, and one runs at a time.");
    expect(screen.queryByRole("button", { name: /yes, start it/i })).toBeNull();
  });

  it("says a retry whose sources are all switched off would ask nobody, pointing at Source priority", async () => {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry/plan`, () =>
        HttpResponse.json(
          { code: "nothing_to_fetch", message: "SENTINEL_MESSAGE", details: { reason: "sources_switched_off" } },
          { status: 409 },
        ),
      ),
    );
    renderShell("/acquire");

    await userEvent.click(await screen.findByRole("button", { name: "Retry 1 failed" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(/a retry would ask nobody/);
    expect(within(refusal).getByRole("link", { name: "Open Source priority in Configure" })).toBeInTheDocument();
  });

  it("offers Try again for a failed estimate, which asks the same retry again", async () => {
    let asked = 0;
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry/plan`, () => {
        asked += 1;
        return asked === 1
          ? HttpResponse.json({ code: "internal_error", message: "SENTINEL_MESSAGE" }, { status: 500 })
          : undefined;
      }),
    );
    renderShell("/acquire");
    await userEvent.click(await screen.findByRole("button", { name: "Retry 1 failed" }));
    const refusal = await screen.findByRole("alert");

    await userEvent.click(within(refusal).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: /yes, start it/i })).toBeInTheDocument();
    expect(asked).toBe(2);
  });

  it("refuses an empty selection as nothing selected", async () => {
    const { result } = renderHook(() => useRunScreen("country"));
    await waitFor(() => expect(result.current.current?.id).toBe(7));

    act(() =>
      result.current.propose({ via: "retry", level: "country", runId: 7, items: "failed", pairs: [] }, "failed"),
    );

    await waitFor(() => expect(result.current.refusal).not.toBeNull());
    expect(result.current.armed).toBeNull();
    expect(presentError(result.current.refusal?.error).message).toBe(
      "Nothing is selected, so there is nothing to ask.",
    );
  });
});

describe("picking out individual items", () => {
  async function failureGroup() {
    serveSourceNames({ oecd: "OECD" });
    renderShell("/acquire");
    await estimate();
    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );
    await screen.findByRole("region", { name: /acquisition 8/i });
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    // The names arrive after the group does, and every test here reads the head by its name.
    await group.findByRole("button", { name: "OECD 1 item" });
    return group;
  }

  it("opens a group to show the items inside it", async () => {
    const group = await failureGroup();
    const head = group.getByRole("button", { name: "OECD 1 item" });
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
    const head = group.getByRole("button", { name: "OECD 1 item" });

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
      group.getByRole("button", { name: "OECD 1 item" }),
    ).toBeInTheDocument();

    await userEvent.click(group.getByRole("button", { name: "All" }));
    expect(
      group.getByRole("button", { name: "OECD 1 item, 1 picked" }),
    ).toBeInTheDocument();

    await userEvent.click(group.getByRole("button", { name: "None" }));
    expect(
      group.getByRole("button", { name: "OECD 1 item" }),
    ).toBeInTheDocument();
  });

  it("selects everything again after a clear", async () => {
    const group = await failureGroup();

    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    await userEvent.click(group.getByRole("button", { name: "Clear all" }));
    await userEvent.click(group.getByRole("button", { name: "Select all" }));

    expect(screen.getByRole("button", { name: "Retry 1 selected" })).toBeInTheDocument();
  });

  it("picks a single item without touching the others", async () => {
    const group = await failureGroup();
    await userEvent.click(group.getByRole("button", { name: "OECD 1 item" }));

    await userEvent.click(
      group.getByRole("checkbox", {
        name: /^Total effective tax rate for Liechtenstein$/i,
      }),
    );

    expect(screen.getByRole("button", { name: "Retry 1 selected" })).toBeInTheDocument();
  });

  /** PL-124. A group's own box is tri-state: clear, mixed, then ticked as its items are picked. */
  it("draws a group's box ticked, mixed or clear by how much of it is picked", async () => {
    serveSourceNames({ eurostat: "Eurostat" });
    serveGaps({
      failed: failedGapsOf([
        { data_source: "eurostat", candidate: "country.malta", attribute: "country.homicide_rate", error_message: "late" },
        { data_source: "eurostat", candidate: "country.spain", attribute: "country.homicide_rate", error_message: "late" },
      ]),
    });
    renderShell("/acquire");
    const group = within(await screen.findByRole("region", { name: /which sources broke/i }));
    const box = await group.findByRole("checkbox", { name: "Every item in Eurostat" });
    expect(box).not.toBeChecked();
    expect(box).not.toBePartiallyChecked();

    await userEvent.click(group.getByRole("button", { name: "Eurostat 2 items" }));
    await userEvent.click(group.getByRole("checkbox", { name: /for Malta$/ }));
    expect(box).toBePartiallyChecked();

    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(screen.getByRole("button", { name: "Retry 2 selected" })).toBeInTheDocument();

    await userEvent.click(box);
    expect(box).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Retry 2 failed" })).toBeInTheDocument();
  });

  /** PL-124. Select all, Clear all, All and None are held where they would do nothing. */
  it("holds a selection control that would do nothing, never disabling it", async () => {
    const group = await failureGroup();
    expectHeld(group.getByRole("button", { name: "Clear all" }));
    expectHeld(group.getByRole("button", { name: "None" }));
    expectNotHeld(group.getByRole("button", { name: "Select all" }));

    await userEvent.click(group.getByRole("button", { name: "Select all" }));

    const selectAll = group.getByRole("button", { name: "Select all" });
    expectHeld(selectAll);
    expect(selectAll).toBeEnabled();
    expect(selectAll).toHaveFocus();
    expectHeld(group.getByRole("button", { name: "All" }));
    expectNotHeld(group.getByRole("button", { name: "Clear all" }));
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
    expect(card.queryByRole("button", { name: /by hand/i })).toBeNull();
    expect(
      within(row).getByRole("link", { name: "Enter a value by hand" }),
    ).toHaveAttribute(
      "href",
      "/acquire?show=hand-entry&attribute=country.residency_admin_ease",
    );

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

  /** PL-088 (UF-092). The remedy was plain text, a step short of the form it named. */
  it("the remedy opens that attribute's form", async () => {
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    const row = await card.findByRole("row", { name: /residency admin ease/i });
    await userEvent.click(within(row).getByRole("link", { name: "Enter a value by hand" }));

    expect(
      await screen.findByRole("region", {
        name: "Enter a value for Residency admin ease by hand",
      }),
    ).toBeInTheDocument();
    const handEntry = within(
      screen.getByRole("region", { name: /figures you can enter by hand/i }),
    );
    expect(
      within(handEntry.getByRole("rowheader", { name: /residency admin ease/i }).closest("tr")!)
        .getByRole("button", { name: "Close" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("opens nothing for an attribute the link names that has no form", async () => {
    renderShell("/acquire?show=hand-entry&attribute=country.nobody_measures_this");

    const handEntry = within(
      await screen.findByRole("region", { name: /figures you can enter by hand/i }),
    );
    await handEntry.findByRole("row", { name: /nobody measures this/i });
    expect(screen.queryByRole("region", { name: /enter a value for/i })).toBeNull();
  });

  it("states each attribute's type in words", async () => {
    renderShell("/acquire");

    const card = within(
      await screen.findByRole("region", {
        name: /attributes with no data source at all/i,
      }),
    );
    expect(await card.findByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    const row = await card.findByRole("row", { name: /nobody measures this/i });
    expect(within(row).getByRole("cell", { name: "Measured in weeks" })).toBeInTheDocument();
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

    expect(row).toHaveTextContent(
      "Permitted, but there is no form for a measured quantity yet",
    );
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(row).queryByRole("link")).toBeNull();
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

  /** The count a tile states, by the label over it. */
  function tile(panel: Awaited<ReturnType<typeof diffPanel>>, label: string): HTMLElement {
    return panel.getByText(label, { selector: "dt" }).closest<HTMLElement>(".tile")!;
  }

  const PORTUGAL = "country.portugal";
  const COST_OF_LIVING = "country.cost_of_living_index";

  /**
   * Run 6 as it would read had it asked about Portugal's cost of living: `failures` for a source
   * that broke on it, `values` for what it stored.
   */
  function runSixAskedAboutTheCostOfLiving({
    failures = [],
    values = [],
  }: {
    failures?: NonNullable<typeof STARTED_RUN_DETAIL.failures>;
    values?: typeof STORED_VALUES;
  }): void {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) => {
        if (params["runId"] !== "6") return;
        return HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: 6,
          failures,
          unanswered: [],
          reconfirmed: [],
        });
      }),
      http.get(`${BASE}/values`, ({ request }) => {
        if (new URL(request.url).searchParams.get("data_acquisition_run") !== "6") return;
        return HttpResponse.json({ items: values, total: values.length });
      }),
    );
  }

  it("counts what appeared, what moved, what stayed and what stopped coming", async () => {
    renderShell("/acquire");
    // Run 5 produced the air connectivity and the cost of living; run 7 produced the first
    // again as it was, moved the second, and added the tax rate.
    const panel = await compare("5", "7");

    await panel.findByRole("table", { name: "What changed" });
    expect(tile(panel, "Newly acquired")).toHaveTextContent("1");
    expect(tile(panel, "Refreshed")).toHaveTextContent("1");
    expect(tile(panel, "Unchanged")).toHaveTextContent("1");
    expect(tile(panel, "Went missing")).toHaveTextContent("0");
  });

  it("names a pair the later run produced and the earlier one did not", async () => {
    renderShell("/acquire");
    const panel = await compare("5", "7");

    const row = await panel.findByRole("row", {
      name: /Total effective tax rate/i,
    });
    expect(row).toHaveTextContent("newly acquired");
  });

  /**
   * RB-4. **The source column names the source as the catalog does.** It printed
   * `eurostat_estimate` -- a database key, where the catalog says "Estimated from Eurostat
   * tax-benefit figures".
   */
  it("names each pair's source as the catalog does, never by its id", async () => {
    serveSourceNames({
      eurostat_estimate: "Estimated from Eurostat tax-benefit figures",
    });
    renderShell("/acquire");
    const panel = await compare("5", "7");

    const estimated = await panel.findByRole("row", {
      name: /Total effective tax rate/i,
    });
    expect(
      await within(estimated).findByRole("cell", {
        name: "Estimated from Eurostat tax-benefit figures",
      }),
    ).toBeInTheDocument();
    expect(
      within(panel.getByRole("row", { name: /Cost of living index/i })).getByRole(
        "cell",
        { name: "Eurostat" },
      ),
    ).toBeInTheDocument();
    expect(
      panel.getByRole("table", { name: "What changed" }),
    ).not.toHaveTextContent(/\beurostat(_estimate)?\b/);
  });

  /** The design's table, with the source kept beside the attribute (C04-N8). */
  it("heads the table with the level, the attribute, the source and the two figures", async () => {
    renderShell("/acquire");
    const panel = await compare("5", "7");

    const table = await panel.findByRole("table", { name: "What changed" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Country", "Attribute", "Source", "Earlier", "Later", "What happened"]);
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
   * PL-049, AQ-01. **A re-read that restates a stored figure writes no value**, so the diff
   * called it "went missing" and left it out of "Unchanged". Run 6 re-read Portugal's air
   * connectivity and found the figure run 5 stored.
   */
  it("reads a figure the later acquisition re-confirmed as unchanged, with it on both sides", async () => {
    renderShell("/acquire");
    const panel = await compare("5", "6");

    const row = await panel.findByRole("row", { name: /Portugal.*air connectivity/i });
    expect(row).toHaveTextContent("unchanged");
    expect(within(row).getAllByRole("cell", { name: "31" })).toHaveLength(2);
  });

  /**
   * "Went missing" is about the run, never about the store: this application does not delete
   * values, and the earlier figure may still be the active one.
   */
  it("says a pair the later acquisition asked about and produced nothing for went missing", async () => {
    runSixAskedAboutTheCostOfLiving({
      failures: [
        {
          data_source: "eurostat",
          candidate: PORTUGAL,
          attribute: COST_OF_LIVING,
          error_message: "the source did not answer",
        },
      ],
    });
    renderShell("/acquire");
    const panel = await compare("5", "6");

    const row = await panel.findByRole("row", { name: /Cost of living index/i });
    expect(row).toHaveTextContent("went missing");
    expect(within(row).getByRole("cell", { name: "92.1 EU27 = 100" })).toBeInTheDocument();
  });

  /** C04-N8. A rejected figure is no usable figure, and its cell says it was rejected. */
  it("says a figure the later acquisition rejected went missing, and reads its cell as rejected", async () => {
    runSixAskedAboutTheCostOfLiving({
      values: [
        {
          ...STORED_VALUES.find((value) => value.id === 502)!,
          id: 9100,
          payload: { magnitude: 920, unit: "index_eu27_100" },
          rejection_reason: "Cost of living index is outside its credible range",
          is_active: false,
          data_acquisition_run: 6,
        },
      ],
    });
    renderShell("/acquire");
    const panel = await compare("5", "6");

    const row = await panel.findByRole("row", { name: /Cost of living index/i });
    expect(row).toHaveTextContent("went missing");
    expect(within(row).getByRole("cell", { name: "rejected" })).toBeInTheDocument();
  });

  it("states that a missing pair is still stored", async () => {
    renderShell("/acquire");
    const panel = await diffPanel();

    expect(
      panel.getByText(/the earlier figure is still stored/i),
    ).toBeInTheDocument();
  });

  /** PL-060. Run 6 never asked about the cost of living, so run 5's figure for it is not compared. */
  it("leaves out what the later acquisition never asked about, and says how much", async () => {
    renderShell("/acquire");
    const panel = await compare("5", "6");

    await panel.findByRole("row", { name: /Portugal.*air connectivity/i });
    expect(panel.queryByRole("row", { name: /Cost of living index/i })).toBeNull();
    expect(
      panel.getByText(
        "1 figure from the earlier acquisition is from a source the later one is not recorded as asking for that value, so it is not compared.",
      ),
    ).toBeInTheDocument();
  });

  /**
   * Review of PL-060. Run 6 halted before it reached the cost of living: that value is not asked,
   * the panel says so, and a record that accounts for every item is not called incomplete.
   */
  function runSixHaltedBeforeTheCostOfLiving(planRecorded: boolean): void {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) => {
        if (params["runId"] !== "6") return;
        return HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: 6,
          run_status: "halted_by_user",
          progress: {
            items_total: 2,
            items_completed: 1,
            items_failed: 0,
            items_unanswered: 0,
            items_not_reached: 1,
          },
          failures: [],
          unanswered: [],
          not_reached: [{ candidate: PORTUGAL, attribute: COST_OF_LIVING }],
          plan_recorded: planRecorded,
          reconfirmed: [
            {
              data_source: "eurostat",
              candidate: PORTUGAL,
              attribute: "country.european_air_connectivity",
              value: 499,
            },
          ],
        });
      }),
    );
  }

  it("says what the later acquisition never reached, and does not call its record incomplete", async () => {
    runSixHaltedBeforeTheCostOfLiving(true);
    renderShell("/acquire");
    const panel = await compare("5", "6");

    expect(
      await panel.findByText(
        "1 value acquisition 6 planned was never reached, so it is not compared.",
      ),
    ).toBeInTheDocument();
    expect(panel.queryByText(/may be incomplete/)).toBeNull();
    expect(panel.queryByRole("row", { name: /Cost of living index/i })).toBeNull();
  });

  it("does not claim a plan for a later acquisition that recorded none", async () => {
    runSixHaltedBeforeTheCostOfLiving(false);
    renderShell("/acquire");
    const panel = await compare("5", "6");

    expect(
      await panel.findByText(/started before acquisitions recorded their plan/),
    ).toBeInTheDocument();
    expect(panel.queryByText(/planned was never reached/)).toBeNull();
  });

  /** Any of a run's three reads failing is a failed comparison, never an empty list. */
  it.each([
    ["what it stored", `${BASE}/values`, "data_acquisition_run"],
    ["what it re-confirmed", `${BASE}/values`, "reconfirmed_by_run"],
    ["its detail", `${BASE}/data-acquisition-runs/:runId`, null],
  ])("says the comparison could not be read when %s cannot be", async (_what, path, filter) => {
    mockServer.use(
      http.get(path, ({ request, params }) => {
        const query = new URL(request.url).searchParams;
        const run = filter === null ? params["runId"] : query.get(filter);
        if (run !== "6") return;
        return HttpResponse.json(
          { code: "internal_error", message: "the run could not be read" },
          { status: 500 },
        );
      }),
    );
    renderShell("/acquire");
    const panel = await compare("5", "6");

    expect(await panel.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(panel.queryByRole("table", { name: "What changed" })).toBeNull();
  });

  /** PL-060. The same acquisition twice is not a comparison, and nothing is read for it. */
  it("asks for two different acquisitions when the same one is picked twice", async () => {
    renderShell("/acquire");
    const panel = await compare("7", "7");

    expect(panel.getByText("Pick two different acquisitions.")).toBeInTheDocument();
    expect(panel.queryByRole("table", { name: "What changed" })).toBeNull();
    expect(panel.queryByText("Unchanged", { selector: "dt" })).toBeNull();
  });

  it("reads nothing for the same acquisition picked twice", async () => {
    const valueReads: string[] = [];
    mockServer.use(
      http.get(`${BASE}/values`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        const run = query.get("data_acquisition_run") ?? query.get("reconfirmed_by_run");
        if (run !== null) valueReads.push(run);
      }),
    );
    renderShell("/acquire");
    const panel = await compare("7", "7");

    // Then a real pair, whose two runs are the only ones read: two lists for each.
    await userEvent.selectOptions(
      panel.getByRole("combobox", { name: /earlier acquisition/i }),
      "5",
    );
    await panel.findByRole("table", { name: "What changed" });
    expect(valueReads.sort()).toEqual(["5", "5", "7", "7"]);
  });

  it("warns when the earlier pick started after the later one, and still compares them", async () => {
    renderShell("/acquire");
    const panel = await compare("7", "5");

    expect(
      await panel.findByText(
        "Acquisition 7 started after acquisition 5, so this reads backwards in time.",
      ),
    ).toBeInTheDocument();
    expect(await panel.findByRole("table", { name: "What changed" })).toBeInTheDocument();
  });

  /** C04-N14. A picker names how big each acquisition was, in values for exact pairs. */
  it("names each acquisition's scope in the pickers", async () => {
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
        if (new URL(request.url).searchParams.get("limit") === "1") return;
        const runs: Run[] = RUNS.map((run) =>
          run.id === 6
            ? { ...run, scope_candidates: 2, scope_attributes: 2, items_total: 2 }
            : run,
        );
        return HttpResponse.json({ items: runs, total: runs.length });
      }),
    );
    renderShell("/acquire");
    const panel = await diffPanel();

    expect(
      within(
        await panel.findByRole("combobox", { name: /later acquisition/i }),
      ).getByRole("option", { name: /^Acquisition 6 — .* \(2 values over 2 candidates\)$/ }),
    ).toBeInTheDocument();
  });

  it("says so when neither acquisition produced anything", async () => {
    mockServer.use(
      http.get(`${BASE}/values`, () => HttpResponse.json({ items: [], total: 0 })),
    );
    renderShell("/acquire");
    const panel = await compare("5", "7");

    expect(
      await panel.findByText(/neither acquisition produced a usable figure/i),
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

    // The history says it is reading by being busy, over the list it read last (PL-010).
    expect(
      screen.getByRole("region", { name: /every acquisition so far/i }).querySelector(
        '[aria-busy="true"]',
      ),
    ).not.toBeNull();
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

    // Said over the list it kept, which is dated rather than dropped (N3).
    expect(
      await within(
        screen.getByRole("region", { name: /every acquisition so far/i }),
      ).findByText(/could not be refreshed/i),
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
    storeAnotherSourceForACountedPair: () => void;
    valueReads: () => number;
  } {
    let completed = 1;
    let stored_more = false;
    let another_source = false;
    let valueReads = 0;
    const stored = {
      ...STORED_VALUES[0]!,
      id: 9001,
      attribute: "country.nobody_measures_this",
      value_type: "Quantity" as const,
      payload: { magnitude: 4, unit: "km" },
      data_acquisition_run: 7,
    };
    // Portugal's air connectivity, which run 7 has already counted, from a second source.
    const secondOpinion = {
      ...STORED_VALUES[0]!,
      id: 9002,
      data_source: "manual",
      payload: { count: 35 },
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
        const items = [
          ...STORED_VALUES,
          ...(completed > 1 || stored_more ? [stored] : []),
          ...(another_source ? [secondOpinion] : []),
        ].filter((value) => String(value.data_acquisition_run ?? "") === fromRun);
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
      storeAnotherSourceForACountedPair: () => {
        another_source = true;
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

  /**
   * RB-3, in the shape the finding named: **another source's figure for a pair the run has
   * already counted**. A run's counts are of distinct pairs, so the second figure moves none of
   * them, and only a read of the run itself can show the pair changed.
   */
  it("reads a run still going again when another source answered a pair it had counted", async () => {
    const run = runSevenStillGoing();
    renderShell("/acquire");
    await fiveAgainstSeven();
    expect(
      theDiff().getByRole("row", { name: /Portugal.*air connectivity/i }),
    ).not.toHaveTextContent("35");

    run.storeAnotherSourceForACountedPair();
    await refreshTheCard();

    // Compared source by source (C04-N8), so the second source's figure is a row of its own.
    await waitFor(() =>
      expect(
        theDiff().getByRole("row", { name: /Portugal.*air connectivity.*Manual entry/i }),
      ).toHaveTextContent("35"),
    );
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

    expect(card.getByText(/32 candidates over 3 attributes/)).toBeInTheDocument();
  });

  it("names the status as a word, not only as a colour", async () => {
    const card = await theCard();

    expect(card.getByText("completed")).toBeInTheDocument();
  });

  it("breaks the run down by source, including the one that answered nothing", async () => {
    // OECD's front door is Cloudflare-challenged, so a run where it answers nothing is the
    // shipped case -- and the source a reader came to this panel to find. Each bar is what the
    // source was asked out of what was planned for it (PL-055), never a success rate.
    serveSourceNames({ oecd: "OECD" });
    const card = await theCard();

    expect(
      await card.findByRole("img", {
        name: "OECD: asked about 1 of 1, 0 stored, 1 failed",
      }),
    ).toBeInTheDocument();
    expect(
      card.getByRole("img", { name: "Eurostat: asked about 95 of 95, 93 stored" }),
    ).toBeInTheDocument();
    expect(card.getByText("95 of 95")).toBeInTheDocument();
  });

  /**
   * RB-4. **No programmatic identifiers in rendered text -- nor in what a hover or a screen
   * reader says.** Each bar printed its source's id three times: as its label, as its
   * accessible name and in its tooltip.
   */
  it("names each source as the catalog does, never by its id", async () => {
    serveSourceNames({ oecd: "OECD" });
    const card = await theCard();

    const breakdown = card.getByRole("list");
    expect(await within(breakdown).findByText("OECD")).toBeInTheDocument();
    expect(within(breakdown).getByText("Eurostat")).toBeInTheDocument();
    expect(
      within(breakdown)
        .getAllByRole("img")
        .map((bar) => bar.getAttribute("aria-label")),
    ).toEqual([
      "Eurostat: asked about 95 of 95, 93 stored",
      "OECD: asked about 1 of 1, 0 stored, 1 failed",
    ]);
    // The tooltip is an SVG `<title>`, so it is text: the hover reads the same sentence.
    expect(breakdown).toHaveTextContent("OECD: asked about 1 of 1, 0 stored, 1 failed");
    expect(breakdown).not.toHaveTextContent(/\b(oecd|eurostat)\b/);
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
 * PL-050, PL-055, PL-056. **A run that stopped before it asked about everything** says so: the
 * items no source was asked about are "not reached", on the bar, in the outcome and per source,
 * and never "unanswered"; its spend line names the ceiling and the cap it started with.
 */
describe("a run that did not reach everything", () => {
  /**
   * Run 7, stopped by its owner after Eurostat and before the LLM fallback was asked: two
   * figures stored, one item not reached, nothing charged of a €0.42 ceiling, no cap set (so
   * the start accepted going uncapped). The history agrees with the detail, as the server's would.
   */
  const HALTED: RunDetail = {
    ...STARTED_RUN_DETAIL,
    id: 7,
    run_status: "halted_by_user",
    stop_requested_at: "2026-09-12T09:00:05Z",
    finished_at: "2026-09-12T09:00:12Z",
    llm_call_count: 0,
    cost_eur: 0,
    scope_candidates: 1,
    scope_attributes: 3,
    items_total: 3,
    items_completed: 2,
    items_failed: 0,
    scope: {
      level: "country",
      candidates: ["country.portugal"],
      attributes: [
        "country.housing_cost_overburden_rate",
        "country.overcrowding_rate",
        "country.total_tax_rate_effective",
      ],
    },
    progress: {
      items_total: 3,
      items_completed: 2,
      items_failed: 0,
      items_unanswered: 0,
      items_not_reached: 1,
    },
    unanswered: [],
    not_reached: [
      { candidate: "country.portugal", attribute: "country.total_tax_rate_effective" },
    ],
    failures: [],
    reconfirmed: [],
    plan_recorded: true,
    estimate_ceiling_eur: 0.42,
    spend_cap_eur: null,
    accepted_uncapped: true,
    by_source: [
      { data_source: "eurostat", items_stored: 2, items_failed: 0, items_planned: 2, items_asked: 2 },
      { data_source: "llm", items_stored: 0, items_failed: 0, items_planned: 1, items_asked: 0 },
    ],
  };

  function serveRun(detail: RunDetail) {
    // The history row says what the detail says about the same run.
    const row: Partial<Run> = {
      run_status: detail.run_status,
      stop_requested_at: detail.stop_requested_at,
      finished_at: detail.finished_at,
      items_total: detail.items_total,
      items_completed: detail.items_completed,
      items_failed: detail.items_failed,
      scope_candidates: detail.scope_candidates,
      scope_attributes: detail.scope_attributes,
      llm_call_count: detail.llm_call_count,
      cost_eur: detail.cost_eur,
    };
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({
          items: RUNS.map((run) => (run.id === detail.id ? { ...run, ...row } : run)),
          total: RUNS.length,
        }),
      ),
      http.get(`${BASE}/data-acquisition-runs/${String(detail.id)}`, () =>
        HttpResponse.json(detail),
      ),
    );
  }

  async function theCard(detail: RunDetail) {
    serveRun(detail);
    serveSourceNames({ llm: "Language model" });
    renderShell("/acquire");
    return within(await screen.findByRole("region", { name: /acquisition 7/i }));
  }

  it("leaves what it never reached as the empty part of the bar, and names it", async () => {
    const card = await theCard(HALTED);

    expect(
      card.getByRole("img", { name: "2 of 3 answered, 0 failed, 0 unanswered, 1 not reached" }),
    ).toBeInTheDocument();
    expect(
      card.getByText(
        "Stopped when you asked, keeping everything it had written. 2 figures stored, 1 not reached.",
      ),
    ).toBeInTheDocument();
    expect(card.queryByText(/nobody answered/)).toBeNull();
  });

  it("lists the source it was planned to ask and never asked as not reached", async () => {
    const card = await theCard(HALTED);

    expect(
      await card.findByRole("img", { name: "Language model: not reached, 1 planned" }),
    ).toBeInTheDocument();
    expect(card.getByText("not reached")).toBeInTheDocument();
    expect(card.getByText("2 of 2")).toBeInTheDocument();
  });

  it("states the ceiling it started with and that no cap held it", async () => {
    const card = await theCard(HALTED);

    expect(card.getByText("Charged €0.00 of the €0.42 ceiling, with no cap.")).toBeInTheDocument();
  });

  it("names the cap it was held to, as recorded when it started", async () => {
    const card = await theCard({ ...HALTED, spend_cap_eur: 5, accepted_uncapped: false });

    expect(
      card.getByText("Charged €0.00 of the €0.42 ceiling, held to the €5.00 cap."),
    ).toBeInTheDocument();
  });

  /** Before plans were recorded the breakdown has nothing to measure against: it says so. */
  it("says a run started before plans were recorded has no plan, ceiling or cap", async () => {
    const card = await theCard({
      ...HALTED,
      run_status: "completed",
      stop_requested_at: null,
      progress: { ...HALTED.progress, items_unanswered: 1, items_not_reached: 0 },
      unanswered: HALTED.not_reached,
      not_reached: [],
      plan_recorded: false,
      estimate_ceiling_eur: null,
      spend_cap_eur: null,
      accepted_uncapped: null,
      by_source: [
        { data_source: "eurostat", items_stored: 2, items_failed: 0, items_planned: null, items_asked: null },
      ],
    });

    expect(card.getByText(/^Plan not recorded for this acquisition/)).toBeInTheDocument();
    expect(card.getByRole("img", { name: "Eurostat: 2 stored" })).toBeInTheDocument();
    expect(
      card.getByText("No paid call, nothing charged. Its ceiling and cap were not recorded."),
    ).toBeInTheDocument();
  });

  /**
   * PL-050. While a run is going, an item it has not answered yet may still be answered, so the
   * verdict "retrying changes nothing" is not yet true and its Retry waits for the run to end.
   */
  it("holds the unanswered verdict and its retry while an acquisition is running", async () => {
    serveRun({
      ...HALTED,
      run_status: "running",
      stop_requested_at: null,
      finished_at: null,
      progress: { ...HALTED.progress, items_completed: 1, items_not_reached: 2 },
    });
    renderShell("/acquire");
    const gaps = within(
      (await screen.findByRole("heading", { name: /^\d+\s*unanswered$/ })).closest("section")!,
    );

    expect(
      await gaps.findByText(/^Acquisition 7 is still running, so these may yet be answered/),
    ).toBeInTheDocument();
    expect(gaps.queryByText(/changes nothing/)).toBeNull();
    expectHeld(gaps.getByRole("button", { name: "Retry 2 unanswered" }));
  });

  /** A failed read of the card is not the end of the run: the history still says it is going. */
  it("keeps the retry held by the history when the run's own read fails", async () => {
    serveRun({ ...HALTED, run_status: "running", stop_requested_at: null, finished_at: null });
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/7`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "run 7 could not be read" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/acquire");

    expect(
      await screen.findByText(/the last acquisition could not be loaded/i),
    ).toBeInTheDocument();
    const gaps = within(
      (await screen.findByRole("heading", { name: /^\d+\s*unanswered$/ })).closest("section")!,
    );
    expect(
      await gaps.findByText(/^Acquisition 7 is still running/),
    ).toBeInTheDocument();
    expectHeld(gaps.getByRole("button", { name: "Retry 2 unanswered" }));
  });

  it("gives the verdict and a live retry once nothing is running", async () => {
    serveRun(HALTED);
    renderShell("/acquire");
    const gaps = within(
      (await screen.findByRole("heading", { name: /^\d+\s*unanswered$/ })).closest("section")!,
    );

    expect(await gaps.findByText(/changes nothing/)).toBeInTheDocument();
    expectNotHeld(gaps.getByRole("button", { name: "Retry 2 unanswered" }));
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
      card.getByText(/Acquisition 7 asked for 32 candidates over 3 attributes/),
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
      await screen.findByRole("region", { name: /which sources broke/i }),
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

  async function aRunThatFailed(failures: typeof outOfCredit) {
    // The database's failed gaps are what the card lists (PL-054); the run says the same.
    serveGaps({ failed: failedGapsOf(failures) });
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

    // The catalog's name for `llm`, which its id made readable ("Llm") could never be (RB-4).
    expect(
      await broke.findByRole("button", { name: "LLM with web search 5 items" }),
    ).toBeInTheDocument();
    // Nothing of the message, and none of the five candidates, until it is opened.
    expect(screen.queryByText(/credit balance/i)).toBeNull();
    expect(screen.queryByText(/for Austria/)).toBeNull();
  });

  it("names every candidate once opened", async () => {
    const broke = await aRunThatFailed(outOfCredit);

    await userEvent.click(
      await broke.findByRole("button", { name: "LLM with web search 5 items" }),
    );

    // **"Pension portability for Austria", never two keys with a space between them.** The
    // design writes this phrase itself, and bars both a `·` and a bare identifier.
    expect(
      broke.getByRole("checkbox", { name: "Pension portability for Austria" }),
    ).toBeInTheDocument();
    expect(
      broke.getByRole("checkbox", { name: "Pension portability for Denmark" }),
    ).toBeInTheDocument();
    expect(broke.queryByText(/country\./)).toBeNull();
  });

  /**
   * PL-058. **The card says each message is listed once, so it is**: a message shared by five
   * items reads once, as a sentence rather than the serialised payload it arrived in, with the
   * five under it -- not five times, once per row.
   */
  it("lists a message shared by five items once, with its items under it", async () => {
    const broke = await aRunThatFailed(outOfCredit);

    await userEvent.click(
      await broke.findByRole("button", { name: "LLM with web search 5 items" }),
    );

    const message = broke.getAllByText(
      "Your credit balance is too low to access the Anthropic API.",
    );
    expect(message).toHaveLength(1);
    const under = within(message[0]!.closest("li")!);
    expect(under.getAllByRole("checkbox")).toHaveLength(COUNTRIES.length);
  });

  it("keeps a message only one item had beside that item", async () => {
    const broke = await aRunThatFailed([
      ...outOfCredit.slice(0, 2),
      {
        data_source: "llm",
        candidate: "country.estonia",
        attribute: "country.pension_portability",
        error_message: "the model read no page that answered",
      },
    ]);

    await userEvent.click(
      await broke.findByRole("button", { name: "LLM with web search 3 items" }),
    );

    const alone = broke.getByRole("checkbox", { name: "Pension portability for Estonia" });
    expect(alone.closest("label")).toHaveTextContent("the model read no page that answered");
    expect(broke.getAllByText(/credit balance is too low/)).toHaveLength(1);
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

    await userEvent.click(
      await broke.findByRole("button", { name: "LLM with web search 5 items" }),
    );

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

    expect(await screen.findByRole("alert")).toHaveTextContent("The server failed while answering.");
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
          { code: "run_not_found", message: "Stopping acquisition 7 did not go through" },
          { status: 404 },
        ),
      ),
    );
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await userEvent.click(
      screen.getByRole("button", { name: /stop — keep what completed/i }),
    );

    expect(await screen.findByText(/stopping acquisition 7 did not go through/i)).toBeInTheDocument();
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

  // PL-116 changed this one: it pressed Yes while a Refresh was reading, and the start won. A
  // Refresh now puts the confirmation away, since it may redraw the items the scope came from,
  // so there is no Yes left to press and the read it overtook simply lands.
  it("puts a confirmation away when a refresh overtakes it, and starts nothing", async () => {
    const started: unknown[] = [];
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        started.push(await request.json());
        return HttpResponse.json({ id: 8 }, { status: 202 });
      }),
    );
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    await openFromHistory("6");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 6/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^retry 1 failed$/i }),
    );
    await screen.findByRole("button", { name: /yes, start it/i });

    const read = holdTheNextReadOf(6);
    await userEvent.click(card.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(read.arrived()).toBe(true));
    expect(screen.queryByRole("button", { name: /yes, start it/i })).toBeNull();
    read.release();
    await everyActHasEnded();

    expect(
      screen.getByRole("region", { name: /acquisition 6/i }),
    ).toBeInTheDocument();
    expect(started).toEqual([]);
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
      "Reading acquisition 5 did not go through",
    );
    older.release();
    await everyActHasEnded();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reading acquisition 5 did not go through",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "Reading acquisition 6 did not go through",
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
      "Reading acquisition 6 did not go through",
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
      "The start did not go through",
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
          { code: "not_found", message: "Stopping acquisition 7 did not go through" },
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
      "Stopping acquisition 7 did not go through",
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
      "The start did not go through",
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
      "The start did not go through",
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
          { code: "not_found", message: "Stopping acquisition 7 did not go through" },
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
      "Stopping acquisition 7 did not go through",
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
          { code: "not_found", message: "Stopping acquisition 7 did not go through" },
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
      "Stopping acquisition 7 did not go through",
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
    const { result } = renderHook(() => useRunScreen(null));

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

  /** PL-085, PL-087. The count as a badge, and each attribute's type under its name. */
  it("the hand-entry card counts and types its attributes", async () => {
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", {
        name: /figures you can enter by hand/i,
      }),
    );

    const permitted = ATTRIBUTES.filter((attribute) => attribute.manual_entry).length;
    expect(
      await card.findByText(`${String(permitted)} attributes permit it`),
    ).toBeInTheDocument();
    expect(card.getAllByRole("rowheader")).toHaveLength(permitted);
    expect(
      card.getByRole("rowheader", { name: /residency admin ease/i }),
    ).toHaveTextContent("An assigned score");
    expect(
      card.getByRole("rowheader", { name: /international employers/i }),
    ).toHaveTextContent("A set of labels");
  });

  /**
   * PL-087 (UF-091). **A measured quantity a source answers, and hand entry permits, was in
   * neither card**: the permission was invisible.
   */
  it("says there is no form for a measured quantity rather than offering one", async () => {
    // As in the real catalog: a measured quantity a source answers, hand entry permitted.
    const naturalisation = {
      ...ATTRIBUTES.find((attribute) => attribute.id === "country.cost_of_living_index")!,
      id: "country.naturalisation_pathway",
      name: "Naturalisation pathway",
      pillar: "governance",
      unit: "years",
      manual_entry: true,
    };
    mockServer.use(
      http.get(`${BASE}/attributes`, () =>
        HttpResponse.json({ items: [...ATTRIBUTES, naturalisation] }),
      ),
    );
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", {
        name: /figures you can enter by hand/i,
      }),
    );

    const row = await card.findByRole("row", { name: /naturalisation pathway/i });
    expect(row).toHaveTextContent(
      "Permitted, but there is no form for a measured quantity yet",
    );
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("stores a label set and reads back what it wrote", async () => {
    // **What it stored, not "done".** A typo is invisible in a success message.
    const sent: unknown[] = [];
    mockServer.use(
      http.post(`${BASE}/values/manual`, async ({ request }) => {
        // Recorded, then left to the mock's own handler to store.
        sent.push(await request.clone().json());
      }),
    );
    const form = await theForm(/international employers/i);

    await userEvent.selectOptions(
      form.getByRole("combobox", { name: "Candidate" }),
      "country.portugal",
    );
    // One per line (D22): a comma stays part of the name.
    await userEvent.type(
      form.getByRole("textbox", { name: "Values" }),
      "Farfetch{Enter}OutSystems, S.A.",
    );
    expect(
      within(form.getByRole("group", { name: "Will store" }))
        .getAllByRole("listitem")
        .map((chip) => chip.textContent),
    ).toEqual(["Farfetch", "OutSystems, S.A."]);
    fireEvent.change(form.getByLabelText("Describes, from"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(form.getByLabelText("Describes, to"), {
      target: { value: "2026-12-31" },
    });
    await userEvent.click(form.getByRole("button", { name: /store this figure/i }));

    // **"for Portugal", not "for country.portugal".** This panel already fetched every
    // candidate to fill the select above, so the name was one lookup away in data it held.
    // And "under Manual entry", the catalog's name for the source, never its id (RB-4).
    const stored = form.getByRole("status");
    await waitFor(() =>
      expect(stored).toHaveTextContent(
        /Farfetch OutSystems, S\.A\. for Portugal, under Manual entry\./,
      ),
    );
    expect(
      within(stored).getAllByRole("listitem").map((chip) => chip.textContent),
    ).toEqual(["Farfetch", "OutSystems, S.A."]);
    expect(stored).not.toHaveTextContent(/\bmanual\b/);
    expect(sent).toEqual([
      expect.objectContaining({ payload: { labels: ["Farfetch", "OutSystems, S.A."] } }),
    ]);
  });

  /** PL-085, N8. Close sits beside Store, and gives focus back to the row that opened it. */
  it("closing returns focus to the row that opened it", async () => {
    const form = await theForm(/residency admin ease/i);
    expect(await form.findByRole("combobox", { name: "Candidate" })).toHaveFocus();

    await userEvent.click(form.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("region", { name: /enter a value for/i })).toBeNull();
    const row = within(
      screen.getByRole("region", { name: /figures you can enter by hand/i }),
    )
      .getAllByRole("row")
      .find((each) => within(each).queryByRole("rowheader", { name: /residency admin ease/i }))!;
    expect(within(row).getByRole("button", { name: /enter a value by hand/i })).toHaveFocus();
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
      await form.findByText(/does not accept a manually entered value/i),
    ).toBeInTheDocument();
  });

  /** PL-089 (UF-062, D23). Said before anything is typed, with the way to switch it on. */
  it("says manual entry is switched off, and where to switch it on", async () => {
    mockServer.use(
      http.get(`${BASE}/data-sources`, () =>
        HttpResponse.json({
          items: DATA_SOURCES.map((source) =>
            source.id === "manual" ? { ...source, is_enabled: false } : source,
          ),
        }),
      ),
    );
    renderShell("/acquire?show=hand-entry&attribute=country.residency_admin_ease");
    const card = within(
      await screen.findByRole("region", { name: /figures you can enter by hand/i }),
    );

    expect(
      await card.findByText(
        "Manual entry is switched off in Configure, so a figure typed here would not count. Figures already typed stay stored and count again when it is switched back on.",
      ),
    ).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Switch it on in Configure" })).toHaveAttribute(
      "href",
      "/configure",
    );
    await card.findByRole("row", { name: /residency admin ease/i });
    expect(card.queryByRole("button", { name: /enter a value by hand/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /enter a value for/i })).toBeNull();
  });

  it("says nothing about the switch while it is on", async () => {
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /figures you can enter by hand/i }),
    );

    await card.findByRole("row", { name: /residency admin ease/i });
    expect(card.queryByText(/is switched off/)).toBeNull();
  });

  /** P1-14. A failed read offers Try again, and the switch is part of what was read. */
  it("says the card could not be loaded when the sources could not be read, and reads again", async () => {
    let failing = true;
    mockServer.use(
      http.get(`${BASE}/data-sources`, () =>
        failing
          ? HttpResponse.json(
              { code: "internal_error", message: "the catalog is down" },
              { status: 500 },
            )
          : undefined,
      ),
    );
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /figures you can enter by hand/i }),
    );

    expect(await card.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /enter a value by hand/i })).toBeNull();

    failing = false;
    await userEvent.click(card.getByRole("button", { name: "Try again" }));

    expect(
      await card.findAllByRole("button", { name: /enter a value by hand/i }),
    ).not.toHaveLength(0);
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

    expect(await card.findByText(/attributes? affected/)).toBeInTheDocument();
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

    expect(await screen.findByRole("alert")).toHaveTextContent("The server refused this.");
    await waitFor(() => expectNotHeld(estimateIt));
    expect(estimateIt).toBeEnabled();
    expect(estimateIt).toHaveFocus();
  });

  it("keeps focus on Retry while its estimate is read, and a second Enter asks nothing", async () => {
    const user = userEvent.setup();
    const plans = holdEach("post", "/data-acquisition-runs/:runId/retry/plan");
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

  it("keeps focus on a selection's Retry while its estimate is read, and lets go once it is", async () => {
    const user = userEvent.setup();
    const plans = holdEach("post", "/data-acquisition-runs/:runId/retry/plan");
    renderShell("/acquire");
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    await user.click(group.getByRole("button", { name: "Select all" }));
    const retrySelected = screen.getByRole("button", { name: "Retry 1 selected" });

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
      "The start did not go through",
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
      "/data-acquisition-runs/:runId/retry",
      refusal("run_already_in_flight", "run 7 is still going"),
    );

    await enterOn(user, yes);
    await waitFor(() => expect(starts.requests.sent).toBe(1));

    expect(yes).toHaveFocus();
    expectHeld(yes);
    expect(yes).toHaveTextContent("Starting…");
    await user.keyboard("{Enter}");

    starts.release();

    // By its title: the confirmation it refused is an alert too.
    expect(
      await screen.findByText("The start did not go through"),
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
      "/data-acquisition-runs/:runId/retry",
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

    // By its title: the confirmation it refused is an alert too.
    expect(
      await screen.findByText("The start did not go through"),
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
      refusal("not_found", "Stopping acquisition 7 did not go through", 404),
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
      "Stopping acquisition 7 did not go through",
    );
    await waitFor(() => expectNotHeld(stop));
    expect(stop).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(stops.requests.sent).toBe(2));
  });

  /** The gaps are a level's, so with no level there is nothing to retry and no card offers to. */
  it("offers no retry where there is no level to plan it in", async () => {
    mockServer.use(
      http.get(`${BASE}/levels`, () => HttpResponse.json({ items: [] })),
    );
    renderShell("/acquire");

    expect(
      await screen.findByText(/choose a level to see what the database holds/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Retry \d+ failed$/ })).toBeNull();
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
    path = "/data-acquisition-runs",
  ): Promise<{ starts: { requests: { sent: number } }; release: () => void }> {
    const starts = holdEach("post", path);
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
    const { starts, release } = await aStartInFlight(user, yes, "/data-acquisition-runs/:runId/retry");

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

/**
 * PL-116, UF-076. **An armed "Yes, start it" starts only the scope still on screen.** Armed on
 * one run, the strip survived opening another, Refresh, Stop, Dismiss and a change to the
 * selection -- so "Yes" started a scope the reader could no longer see, which may include paid
 * calls. Every input that defines the scope disarms it, and the strip names what it starts.
 */
describe("an armed start whose scope changes", () => {
  function recordStarts(): unknown[] {
    const started: unknown[] = [];
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        started.push(await request.json());
        return HttpResponse.json({ id: 14 }, { status: 202 });
      }),
    );
    return started;
  }

  async function theFailureGroup() {
    serveSourceNames({ oecd: "OECD" });
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    await group.findByRole("button", { name: "OECD 1 item" });
    return group;
  }

  async function armTheSelection() {
    const group = await theFailureGroup();
    await userEvent.click(group.getByRole("button", { name: /^OECD 1 item$/ }));
    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry 1 selected" }));
    await screen.findByRole("alert");
    return group;
  }

  /** The whole bucket, armed with nothing picked. */
  async function armTheBucket() {
    const group = await theFailureGroup();
    await userEvent.click(group.getByRole("button", { name: /^OECD 1 item$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Retry 1 failed" }));
    await screen.findByRole("alert");
    return group;
  }

  it.each<[string, (group: Awaited<ReturnType<typeof armTheSelection>>) => Promise<void>]>([
    ["Clear all", (group) => userEvent.click(group.getByRole("button", { name: "Clear all" }))],
    ["None on the group", (group) => userEvent.click(group.getByRole("button", { name: "None" }))],
    [
      "an item unticked",
      (group) => userEvent.click(group.getByRole("checkbox", { name: /for Liechtenstein$/ })),
    ],
    ["the group's box cleared", (group) => userEvent.click(group.getByRole("checkbox", { name: "Every item in OECD" }))],
  ])("is disarmed when the selection changes: %s", async (_, change) => {
    const started = recordStarts();
    const group = await armTheSelection();

    await change(group);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /yes, start it/i })).toBeNull();
    expect(started).toEqual([]);
  });

  it.each<[string, (group: Awaited<ReturnType<typeof armTheBucket>>) => Promise<void>]>([
    ["Select all", (group) => userEvent.click(group.getByRole("button", { name: "Select all" }))],
    ["All on the group", (group) => userEvent.click(group.getByRole("button", { name: "All" }))],
    ["the group's box ticked", (group) => userEvent.click(group.getByRole("checkbox", { name: "Every item in OECD" }))],
    ["an item ticked", (group) => userEvent.click(group.getByRole("checkbox", { name: /for Liechtenstein$/ }))],
  ])("is disarmed when a pick narrows the whole bucket: %s", async (_, change) => {
    const started = recordStarts();
    const group = await armTheBucket();

    await change(group);

    expect(screen.queryByRole("button", { name: /yes, start it/i })).toBeNull();
    expect(started).toEqual([]);
  });

  it("does not arm when the selection changes while the estimate is read", async () => {
    const plan = heldAnswer();
    const group = await theFailureGroup();
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry/plan`, async () => {
        await plan.held;
        return HttpResponse.json(RUN_PLAN);
      }),
    );
    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry 1 selected" }));

    await userEvent.click(group.getByRole("button", { name: "Clear all" }));
    plan.release();
    await everyActHasEnded();

    expect(screen.queryByRole("button", { name: /yes, start it/i })).toBeNull();
  });

  it.each<[string, () => Promise<void>]>([
    [
      "Refresh",
      async () => {
        const card = screen.getByRole("region", { name: /acquisition 7/i });
        await userEvent.click(within(card).getByRole("button", { name: "Refresh" }));
        await everyActHasEnded();
      },
    ],
    [
      "Dismiss",
      async () => {
        const card = screen.getByRole("region", { name: /acquisition 7/i });
        await userEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
      },
    ],
    [
      "another run opened from the history",
      async () => {
        await openFromHistory("6");
        await screen.findByRole("region", { name: /acquisition 6/i });
        await everyActHasEnded();
      },
    ],
  ])("is disarmed when the card's run changes: %s", async (_, change) => {
    const started = recordStarts();
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    await userEvent.click(
      await screen.findByRole("button", { name: /^Retry 1 failed$/ }),
    );
    await screen.findByRole("alert");

    await change();

    expect(screen.queryByRole("button", { name: /yes, start it/i })).toBeNull();
    expect(started).toEqual([]);
  });

  it("is disarmed when the run on the card is stopped", async () => {
    aRunWhoseStopIsHeld().release();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /^Retry 1 failed$/ }),
    );
    await screen.findByRole("alert");

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );
    await everyActHasEnded();

    expect(screen.queryByRole("button", { name: /yes, start it/i })).toBeNull();
  });

  it("names the run it was armed on and how many it starts", async () => {
    await armTheSelection();

    expect(screen.getByRole("alert")).toHaveTextContent(
      /^This starts a new acquisition over 1 values from acquisition 7\./,
    );
  });

  it("sends exactly the pairs it named", async () => {
    const planned: unknown[] = [];
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry/plan`, async ({ request }) => {
        planned.push(await request.json());
        return undefined;
      }),
    );
    const started = recordRetries(14);
    await armTheSelection();

    await userEvent.click(
      within(screen.getByRole("alert")).getByRole("button", { name: /yes, start it/i }),
    );

    await waitFor(() => expect(started).toHaveLength(1));
    const named = { items: "failed", pairs: [TAX_PAIR] };
    expect(planned).toEqual([named]);
    expect(started).toEqual([{ runId: 7, body: { ...named, accept_uncapped_spend: false } }]);
  });

  it("is disarmed when the level changes", async () => {
    const { result, rerender } = renderHook(
      ({ level }: { level: string | null }) => useRunScreen(level),
      { initialProps: { level: "country" } },
    );
    await waitFor(() => expect(result.current.current?.id).toBe(7));

    act(() => result.current.propose({ via: "scoped", scope: { level: "country" } }, "failed"));
    await waitFor(() => expect(result.current.armed).not.toBeNull());

    rerender({ level: "city" });

    expect(result.current.armed).toBeNull();
  });
});

/**
 * PL-126, UF-098. **Opening an acquisition from the history moves the reader to it.** The card
 * changed 2,000 px above while the reader stayed at the bottom, so nothing seemed to happen.
 */
describe("opening an acquisition from the history", () => {
  const scrolled: Element[] = [];
  beforeEach(() => {
    scrolled.length = 0;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
  });
  afterEach(() => {
    // jsdom has none, and the screen treats it as optional.
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("scrolls to the card and focuses its heading", async () => {
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await openFromHistory("6");

    const card = await screen.findByRole("region", { name: /acquisition 6/i });
    const heading = within(card).getByRole("heading", { level: 2 });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(scrolled).toContain(card);
  });

  it("leaves focus on the history when the run cannot be read", async () => {
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    failTheNextReadOf(6).release();

    await openFromHistory("6");

    expect(await screen.findByText("Reading acquisition 6 did not go through")).toBeInTheDocument();
    const number = screen.getByRole("rowheader", { name: "6" });
    expect(within(number).getByRole("button", { name: "6" })).toHaveFocus();
    expect(scrolled).toEqual([]);
  });

  it("does not move the reader for the card the screen opens by itself", async () => {
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    await everyActHasEnded();

    expect(document.body).toHaveFocus();
    expect(scrolled).toEqual([]);
  });
});

/**
 * PL-128, UF-100. **When the pressed control goes, focus goes somewhere meant.** Yes, Not yet,
 * Start, Stop and Dismiss each unmount the button that was pressed, and focus fell to the page.
 */
describe("where focus goes when the pressed control goes", () => {
  async function armTheFailedRetry(): Promise<HTMLElement> {
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    const retry = await screen.findByRole("button", { name: /^Retry 1 failed$/ });
    await userEvent.click(retry);
    await screen.findByRole("button", { name: /yes, start it/i });
    return retry;
  }

  function headingOf(card: HTMLElement): HTMLElement {
    return within(card).getByRole("heading", { level: 2 });
  }

  it("takes Yes to the new acquisition's heading", async () => {
    recordRetries(14);
    await armTheFailedRetry();

    await userEvent.click(screen.getByRole("button", { name: /yes, start it/i }));

    const card = await screen.findByRole("region", { name: /acquisition 14/i });
    await waitFor(() => expect(headingOf(card)).toHaveFocus());
  });

  it("takes Start to the new acquisition's heading", async () => {
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    await estimate();

    await userEvent.click(
      await screen.findByRole("button", { name: /start this acquisition/i }),
    );

    const card = await screen.findByRole("region", { name: /acquisition 8/i });
    await waitFor(() => expect(headingOf(card)).toHaveFocus());
  });

  it("takes Not yet back to the control that opened the strip", async () => {
    const retry = await armTheFailedRetry();

    await userEvent.click(screen.getByRole("button", { name: "Not yet" }));

    expect(screen.queryByRole("button", { name: "Not yet" })).toBeNull();
    expect(retry).toHaveFocus();
  });

  it("takes Not yet back to a selection's own Retry", async () => {
    serveSourceNames({ oecd: "OECD" });
    renderShell("/acquire");
    const group = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    await userEvent.click(group.getByRole("button", { name: "Select all" }));
    const retry = screen.getByRole("button", { name: "Retry 1 selected" });
    await userEvent.click(retry);

    await userEvent.click(await screen.findByRole("button", { name: "Not yet" }));

    expect(retry).toHaveFocus();
  });

  it("takes Stop to Refresh once Stop is withdrawn", async () => {
    aRunWhoseStopIsHeld().release();
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );

    await userEvent.click(
      card.getByRole("button", { name: /stop — keep what completed/i }),
    );

    await waitFor(() =>
      expect(card.queryByRole("button", { name: /stop/i })).toBeNull(),
    );
    await waitFor(() =>
      expect(card.getByRole("button", { name: "Refresh" })).toHaveFocus(),
    );
  });

  it("takes Dismiss to the gaps' heading", async () => {
    renderShell("/acquire");
    const card = within(
      await screen.findByRole("region", { name: /acquisition 7/i }),
    );

    await userEvent.click(card.getByRole("button", { name: "Dismiss" }));

    expect(
      screen.getByRole("heading", { name: "What you can do about the gaps" }),
    ).toHaveFocus();
  });
});

/** PL-130, UF-102. "Estimating…" belongs to the card whose estimate is being read. */
describe("which card says it is estimating", () => {
  it("leaves the refresh card's label alone while a retry is estimated", async () => {
    const plan = heldAnswer();
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/:runId/retry/plan`, async () => {
        await plan.held;
        return HttpResponse.json(RUN_PLAN);
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /^Retry 1 failed$/ }),
    );

    const estimateIt = screen.getByRole("button", { name: "Estimate an acquisition" });
    expectHeld(estimateIt);
    expect(screen.queryByText("Estimating…")).toBeNull();
    plan.release();
    await screen.findByRole("button", { name: /yes, start it/i });
  });
});

/**
 * **What the reader picked belongs to the run they picked it from.** The failed and unanswered
 * lists kept their picks when another acquisition took the card, so "Retry 1 selected" offered
 * items the new run never failed on.
 */
/**
 * PL-054. **The lists are the database's gaps, not the card's run**, so opening another
 * acquisition leaves what was picked from them as it was.
 */
describe("picks across a switch to another acquisition", () => {
  it("keeps the picks in both lists when another acquisition is opened", async () => {
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    const failed = within(
      await screen.findByRole("region", { name: /which sources broke/i }),
    );
    const unanswered = within(
      screen.getByRole("region", { name: /which values went unanswered/i }),
    );
    await userEvent.click(failed.getByRole("button", { name: "Select all" }));
    await userEvent.click(unanswered.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Retry 1 selected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 2 selected" })).toBeInTheDocument();

    await openFromHistory("6");
    await screen.findByRole("region", { name: /acquisition 6/i });

    expect(screen.getByRole("button", { name: "Retry 1 selected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 2 selected" })).toBeInTheDocument();
  });
});

/**
 * PL-116, from the review of 47d0ed5. **A change of level clears what was estimated and armed
 * for the level left**, rather than hiding it until the reader returns -- and an estimate still
 * being read when the level changes arms and shows nothing, then or later.
 */
describe("a change of level", () => {
  function renderAtLevel() {
    return renderHook(({ level }: { level: string | null }) => useRunScreen(level), {
      initialProps: { level: "country" },
    });
  }

  function holdThePlan(
    answerWith: () => Response = () => HttpResponse.json(RUN_PLAN),
  ): { release: () => void } {
    const answer = heldAnswer();
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs/plan`, async () => {
        await answer.held;
        return answerWith();
      }),
    );
    return answer;
  }

  /** What the server answers an estimate for a level it no longer has. */
  function refused(): Response {
    return HttpResponse.json(
      { code: "not_found", message: "No such level.", details: { level: "country" } },
      { status: 404 },
    );
  }

  it("puts away the estimate behind Start, and it does not come back", async () => {
    const { result, rerender } = renderAtLevel();
    act(() => result.current.estimate("country"));
    await waitFor(() => expect(result.current.plan).not.toBeNull());

    rerender({ level: "city" });
    expect(result.current.plan).toBeNull();
    rerender({ level: "country" });

    expect(result.current.plan).toBeNull();
  });

  it("shows no estimate that was still being read when the level changed", async () => {
    const plan = holdThePlan();
    const { result, rerender } = renderAtLevel();
    act(() => result.current.estimate("country"));
    await waitFor(() => expect(result.current.busy).toBe("planning"));

    rerender({ level: "city" });
    plan.release();
    await waitFor(() => expect(result.current.busy).toBeNull());
    // Asserted before going back, which clears whatever was estimated for the level left.
    expect(result.current.plan).toBeNull();
    rerender({ level: "country" });

    expect(result.current.plan).toBeNull();
  });

  it("reports no refusal of an estimate still being read when the level changed", async () => {
    const plan = holdThePlan(refused);
    const { result, rerender } = renderAtLevel();
    act(() => result.current.estimate("country"));
    await waitFor(() => expect(result.current.busy).toBe("planning"));

    rerender({ level: "city" });
    plan.release();
    await waitFor(() => expect(result.current.busy).toBeNull());

    expect(result.current.refusal).toBeNull();
  });

  it("reports no refusal of a proposal still being read when the level changed", async () => {
    const plan = holdThePlan(refused);
    const { result, rerender } = renderAtLevel();
    await waitFor(() => expect(result.current.current?.id).toBe(7));
    act(() => result.current.propose({ via: "scoped", scope: { level: "country" } }, "failed"));
    await waitFor(() => expect(result.current.busy).toBe("planning"));

    rerender({ level: "city" });
    plan.release();
    await waitFor(() => expect(result.current.busy).toBeNull());

    expect(result.current.refusal).toBeNull();
  });

  it("still reports the refusal of an estimate for the level on screen", async () => {
    const plan = holdThePlan(refused);
    const { result } = renderAtLevel();
    act(() => result.current.estimate("country"));
    await waitFor(() => expect(result.current.busy).toBe("planning"));

    plan.release();
    await waitFor(() => expect(result.current.busy).toBeNull());

    expect(result.current.refusal).not.toBeNull();
  });

  it("clears an armed start rather than hiding it until the level comes back", async () => {
    const { result, rerender } = renderAtLevel();
    await waitFor(() => expect(result.current.current?.id).toBe(7));
    act(() => result.current.propose({ via: "scoped", scope: { level: "country" } }, "failed"));
    await waitFor(() => expect(result.current.armed).not.toBeNull());

    rerender({ level: "city" });
    rerender({ level: "country" });

    expect(result.current.armed).toBeNull();
  });

  it("arms nothing from an estimate still being read when the level changed", async () => {
    const plan = holdThePlan();
    const { result, rerender } = renderAtLevel();
    await waitFor(() => expect(result.current.current?.id).toBe(7));
    act(() => result.current.propose({ via: "scoped", scope: { level: "country" } }, "failed"));
    await waitFor(() => expect(result.current.busy).toBe("planning"));

    rerender({ level: "city" });
    plan.release();
    await waitFor(() => expect(result.current.busy).toBeNull());
    rerender({ level: "country" });

    expect(result.current.armed).toBeNull();
  });
});

/**
 * PL-132. **A run started here is the shell's to watch at once**: its watch looks every thirty
 * seconds while idle, so the progress strip met a run up to half a minute after it began.
 */
describe("a run started on Acquire", () => {
  /** How many times the shell has looked for the newest run. */
  function countShellLooks(): { count: number } {
    const looks = { count: 0 };
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, ({ request }) => {
        if (new URL(request.url).searchParams.get("limit") === "1") looks.count += 1;
      }),
    );
    return looks;
  }

  it("has the shell look for it at once", async () => {
    const looks = countShellLooks();
    renderShell("/acquire");
    await estimate();
    const before = looks.count;

    await userEvent.click(
      screen.getByRole("button", { name: /start this acquisition/i }),
    );

    await waitFor(() => expect(looks.count).toBeGreaterThan(before));
  });

  it("has the shell look for one started from a confirmation too", async () => {
    const looks = countShellLooks();
    renderShell("/acquire");
    await userEvent.click(
      await screen.findByRole("button", { name: /^retry 1 failed$/i }),
    );
    const yes = await screen.findByRole("button", { name: /yes, start it/i });
    const before = looks.count;

    await userEvent.click(yes);

    await waitFor(() => expect(looks.count).toBeGreaterThan(before));
  });
});
