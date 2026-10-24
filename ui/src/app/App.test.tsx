import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { formatDateTime, formatMoneyPerMonth } from "../format/display";
import {
  CITY_CANDIDATES,
  COUNTRY_CANDIDATES,
  HOUSEHOLD,
  rankingFor,
} from "../mocks/fixtures";
import { mockServer } from "../mocks/server";
import { TEST_CONFIG, renderShell } from "../testing/renderShell";
import { ROUTES } from "../navigation/routes";

/**
 * How many candidates the roster holds, per level, taken from the fixture rather than written
 * down beside the assertion.
 *
 * **A literal here has drifted twice in one session** -- 4, then 5 when Romania joined the
 * roster, then 6 when the United Kingdom did -- and the third break would have landed on
 * somebody who had not added a country and had no reason to connect the two. A count asserted
 * against a number that moves for reasons outside the test is scaffolding pretending to be a
 * subject.
 *
 * **This is not the test agreeing with itself.** The figure on screen travels from the fixture
 * through the msw handler, `GET /candidates`, `useResource` and the sidebar's render, and
 * asserting it equals the roster's length checks every step of that. What it gives up is
 * catching "the fixture changed", which is this test's input and never was its subject.
 */
const EVERY_COUNTRY = String(COUNTRY_CANDIDATES.length);
const EVERY_CITY = String(CITY_CANDIDATES.length);

/**
 * Waits until the sidebar has adopted its defaults. The catalog arrives in one render and the
 * default selection is adopted in the next, so a test that asserted straight after the first
 * would pass or fail on timing rather than on behaviour.
 */
async function sidebarIsLoaded(): Promise<HTMLSelectElement> {
  const selector = await screen.findByRole("combobox", { name: /active criteria set/i });
  await waitFor(() => expect(selector).toHaveValue("default"));
  return selector as HTMLSelectElement;
}

describe("the shell", () => {
  it("shows the display name from configuration, never a compiled-in name", async () => {
    renderShell("/rank");

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      TEST_CONFIG.displayName,
    );
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent("Starnest");
  });

  it("puts the route and the display name in the browser tab title", async () => {
    renderShell("/compare");

    // An em dash: the middle-dot separator is barred outright and the design removed every
    // one from the application, the title bar included.
    await waitFor(() =>
      expect(document.title).toBe(`Compare — ${TEST_CONFIG.displayName}`),
    );
  });

  it("redirects the root path to Configure, which a fresh installation needs first", async () => {
    renderShell("/");

    expect(await screen.findByRole("heading", { level: 2, name: "Configure" })).toBeInTheDocument();
  });

  it("renders an explanation rather than a blank page for an unknown path", async () => {
    renderShell("/nowhere");

    expect(await screen.findByRole("heading", { name: /no such screen/i })).toBeInTheDocument();
  });
});

describe("the four routes", () => {
  it.each(ROUTES.map((route) => [route.path, route.label] as const))(
    "renders %s",
    async (path, label) => {
      renderShell(path);

      expect(await screen.findByRole("heading", { level: 2, name: label })).toBeInTheDocument();
    },
  );

  it("navigates between tabs from the sidebar", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await sidebarIsLoaded();

    await user.click(screen.getByRole("link", { name: "Rank" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Rank" })).toBeInTheDocument();
  });
});

describe("the sidebar selectors", () => {
  it("offers every criteria set the API returns and opens on the first", async () => {
    renderShell("/rank");

    const selector = await sidebarIsLoaded();

    expect(within(selector).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Default",
      "Remote only",
    ]);
  });

  it("offers a level per level record, without assuming there are two", async () => {
    renderShell("/rank");

    // Segmented buttons, as the design draws them: a choice between two named things, not
    // the first of a longer list. `aria-pressed` is what says which one is current.
    const group = await screen.findByRole("group", { name: "Level" });
    // The group can render a beat before its levels arrive, so wait for the buttons rather than
    // reading them the moment the group appears -- under load that read found none.
    await waitFor(() =>
      expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Country",
        "City",
      ]),
    );
    // The default is adopted a render after the levels arrive, so wait for it rather than
    // assuming the two happen together.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Country" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("passes the chosen level to the screen and refetches the counts", async () => {
    const user = userEvent.setup();
    renderShell("/rank");
    await sidebarIsLoaded();
    const counts = within(await screen.findByRole("region", { name: /candidates/i }));
    // **Total counts candidates; the other three count ranked results**, so the four need not
    // agree — the design keeps Total when the score range is unset precisely because it needs
    // no score. That is why the roster is larger than the ranking, and why only Total is read
    // off the roster.
    await waitFor(() =>
      expect(counts.getByText("Total").nextSibling).toHaveTextContent(EVERY_COUNTRY),
    );

    await user.click(screen.getByRole("button", { name: "City" }));

    const rank = within(screen.getByRole("region", { name: "Rank" }));
    // Capitalised: the catalog ships ids, and a reader is shown a name.
    await waitFor(() => expect(rank.getByText("Level").nextSibling).toHaveTextContent("City"));
    // The deeper level's roster, read the same way. The count beneath it is the ranking's and
    // stays a literal: it is what this test is about.
    await waitFor(() =>
      expect(counts.getByText("Total").nextSibling).toHaveTextContent(EVERY_CITY),
    );
    expect(counts.getByText("Insufficient data").nextSibling).toHaveTextContent("1");
  });

  it("changes the criteria set, and the screen follows", async () => {
    const user = userEvent.setup();
    renderShell("/rank");
    const selector = await sidebarIsLoaded();

    await user.selectOptions(selector, "remote-only");

    expect(selector).toHaveValue("remote-only");
    // The ranking screen names the criteria set the ranking it is showing was computed under,
    // taken from the response rather than from the selector -- so this asserts the fetch
    // followed the selection, not merely that the dropdown changed.
    const rank = within(screen.getByRole("region", { name: "Rank" }));
    await waitFor(() =>
      expect(rank.getByText("Criteria set").nextSibling).toHaveTextContent("remote-only"),
    );
  });
});

describe("the sidebar counts and last run", () => {
  it("shows the four candidate counts, all of them computed by the backend", async () => {
    renderShell("/rank");

    const counts = within(
      await screen.findByRole("region", { name: /candidates/i }),
    );
    // **Total counts candidates; the other three count ranked results**, so the four need not
    // agree — the design keeps Total when the score range is unset precisely because it needs
    // no score. That is why the roster is larger than the ranking, and why only Total is read
    // off the roster.
    await waitFor(() =>
      expect(counts.getByText("Total").nextSibling).toHaveTextContent(EVERY_COUNTRY),
    );
    expect(counts.getByText("Matching").nextSibling).toHaveTextContent("2");
    expect(counts.getByText("Not matching").nextSibling).toHaveTextContent("1");
    expect(counts.getByText("Insufficient data").nextSibling).toHaveTextContent("1");
  });

  it("names the home country and citizenships, never their candidate ids", async () => {
    renderShell("/rank");

    const household = within(
      await screen.findByRole("region", { name: /household summary/i }),
    );
    // The mock household lives in country.romania and holds a Romanian passport. The card used
    // to print "country.romania" -- the programmatic id the rest of the app was taught not to
    // show -- rather than "Romania", read from the shared candidate roster.
    await waitFor(() =>
      expect(
        household.getByText("Moving from").nextSibling,
      ).toHaveTextContent("Romania"),
    );
    expect(
      household.getByText("Moving from").nextSibling,
    ).not.toHaveTextContent("country.romania");
    expect(household.getByText("Passports held").nextSibling).toHaveTextContent(
      "Romania",
    );
  });

  // PL-163. The income is a monthly figure, and the card says so beside it.
  it("shows the net income per month", async () => {
    renderShell("/rank");

    const household = within(
      await screen.findByRole("region", { name: /household summary/i }),
    );

    await waitFor(() =>
      expect(household.getByText("Net income").nextSibling).toHaveTextContent(
        "€7,400 / month",
      ),
    );
  });

  // PL-165. **The design's words and values**: counts in words, money whole and with its period.
  it("words the household as the design does", async () => {
    renderShell("/rank");

    const household = within(
      await screen.findByRole("region", { name: /household summary/i }),
    );

    await waitFor(() =>
      expect(household.getByText("Adults").nextSibling).toHaveTextContent("Two"),
    );
    expect(household.getByText("Children").nextSibling).toHaveTextContent("One");
    expect(
      household.getByText("Comfortable monthly spend").nextSibling,
    ).toHaveTextContent("€2,800 / month");
    expect(household.getByText("Rent ceiling").nextSibling).toHaveTextContent(
      "€1,500 / month",
    );
  });

  it("summarises the most recent run and links to the history", async () => {
    renderShell("/rank");

    const lastRun = within(await screen.findByRole("region", { name: /last acquisition/i }));
    await waitFor(() => expect(lastRun.getByText("Status").nextSibling).toHaveTextContent("completed"));
    expect(lastRun.getByText("Started").nextSibling).toHaveTextContent("29 Aug 2026, 21:02");
    expect(lastRun.getByRole("link", { name: /acquisition history/i })).toHaveAttribute("href", "/acquire");
  });

  it("says so plainly when no run has happened yet", async () => {
    mockServer.use(
      http.get("/v1/data-acquisition-runs", () => HttpResponse.json({ items: [], total: 0 })),
    );
    renderShell("/rank");

    expect(await screen.findByText(/no acquisition yet/i)).toBeInTheDocument();
  });
});

/**
 * UI-11. **The sidebar kept what it read first.** It read the household once, and the counts and
 * the last run only when the selection changed -- so a household just saved, a ranking a gate
 * had just moved and a run that had just ended all stayed as they were when the page opened.
 *
 * **It reads them again when the screen changes and when a run it saw running stops**, the
 * household's choice of the smaller fix: between those moments it can still be stale, and a
 * save on the screen in front of you is not one of them.
 */
describe("what the sidebar reads again", () => {
  /** Counts the GETs of one path, and lets each through to the mock that answers it. */
  function countReads(path: string): { count: number } {
    const reads = { count: 0 };
    mockServer.use(
      http.get(`/v1${path}`, () => {
        reads.count += 1;
        return undefined;
      }),
    );
    return reads;
  }

  /** The figure a sidebar card shows beside one label, read afresh each time it is asked. */
  function figure(card: string, label: string): ChildNode | null {
    return within(screen.getByRole("region", { name: card })).getByText(label).nextSibling;
  }

  async function sidebarHasRead(): Promise<void> {
    await sidebarIsLoaded();
    await waitFor(() =>
      expect(figure("Household summary", "Comfortable monthly spend")).toHaveTextContent(
        formatMoneyPerMonth(HOUSEHOLD.target_monthly_spend, "EUR"),
      ),
    );
    await waitFor(() => expect(figure("Candidates", "Matching")).toHaveTextContent("2"));
    await waitFor(() =>
      expect(figure("Last acquisition", "Status")).toHaveTextContent("completed"),
    );
  }

  /** The server's ranking moves on -- a gate enforced, a figure fetched -- and nothing matches. */
  function nothingMatchesAnyMore(): void {
    mockServer.use(
      http.get("/v1/rankings", ({ request }) => {
        const query = new URL(request.url).searchParams;
        const ranking = rankingFor(
          query.get("criteria_set") ?? "",
          query.get("level") ?? "",
        );
        return HttpResponse.json({
          ...ranking,
          candidates: ranking.candidates.map((each) => ({
            ...each,
            match_status: "not_matching",
          })),
        });
      }),
    );
  }

  it("shows the household a save has just stored once the screen changes", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await sidebarHasRead();
    const household = within(await screen.findByRole("region", { name: "Household" }));
    const spend = household.getByRole("textbox", { name: "Comfortable monthly spend" });

    await user.clear(spend);
    await user.type(spend, "3100");
    await user.click(household.getByRole("button", { name: "Save household" }));
    expect(await household.findByText("Saved.")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Rank" }));

    await waitFor(() =>
      expect(figure("Household summary", "Comfortable monthly spend")).toHaveTextContent(
        formatMoneyPerMonth(3100, "EUR"),
      ),
    );
  });

  it("counts the candidates again once the screen changes", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await sidebarHasRead();

    nothingMatchesAnyMore();
    await user.click(screen.getByRole("link", { name: "Rank" }));

    await waitFor(() => expect(figure("Candidates", "Matching")).toHaveTextContent("0"));
    expect(figure("Candidates", "Not matching")).toHaveTextContent(
      String(rankingFor("default", "country").candidates.length),
    );
  });

  it("names the newest acquisition once the screen changes", async () => {
    const newer = {
      id: 8,
      run_status: "halted_by_user",
      triggered_by: "user",
      started_at: "2026-09-21T09:00:00Z",
      finished_at: "2026-09-21T09:20:00Z",
      llm_call_count: 0,
      cost_eur: 0,
    };
    const user = userEvent.setup();
    renderShell("/configure");
    await sidebarHasRead();

    // Started and stopped between two looks of the strip under the tabs, so it never saw it run.
    mockServer.use(
      http.get("/v1/data-acquisition-runs", () =>
        HttpResponse.json({ items: [newer], total: 4 }),
      ),
    );
    await user.click(screen.getByRole("link", { name: "Compare" }));

    await waitFor(() =>
      expect(figure("Last acquisition", "Status")).toHaveTextContent("halted by user"),
    );
    expect(figure("Last acquisition", "Started")).toHaveTextContent(
      formatDateTime(newer.started_at),
    );
  });

  /**
   * **The strip under the tabs already watches a running run**, every two seconds and on every
   * screen, so its end is something the shell knows without anybody moving -- this waits one look.
   */
  it("reports a run's end, and what it changed, without anybody moving", async () => {
    let status = "running";
    const watched = {
      id: 8,
      triggered_by: "user",
      started_at: "2026-09-21T09:00:00Z",
      cost_eur: 0,
    };
    mockServer.use(
      http.get("/v1/data-acquisition-runs", () =>
        HttpResponse.json({ items: [{ ...watched, run_status: status }], total: 1 }),
      ),
      http.get("/v1/data-acquisition-runs/:runId", () =>
        HttpResponse.json({
          ...watched,
          run_status: status,
          progress: { items_total: 96, items_completed: 24 },
          failures: [],
        }),
      ),
    );
    renderShell("/rank");
    await sidebarIsLoaded();
    await waitFor(() =>
      expect(figure("Last acquisition", "Status")).toHaveTextContent("running"),
    );
    await waitFor(() => expect(figure("Candidates", "Matching")).toHaveTextContent("2"));
    // Seen running, which is what makes its end news.
    expect(
      await screen.findByRole("region", { name: /acquisition in progress/i }),
    ).toHaveTextContent("24 of 96");

    status = "completed";
    nothingMatchesAnyMore();

    await waitFor(() =>
      expect(figure("Last acquisition", "Status")).toHaveTextContent("completed"),
    );
    await waitFor(() => expect(figure("Candidates", "Matching")).toHaveTextContent("0"));
  });

  it("reads nothing again when a save is refused", async () => {
    mockServer.use(
      http.put("/v1/household", () =>
        HttpResponse.json(
          { code: "invalid_field", message: "net_income must be positive." },
          { status: 400 },
        ),
      ),
    );
    const households = countReads("/household");
    const rankings = countReads("/rankings");
    const user = userEvent.setup();
    renderShell("/configure");
    await sidebarHasRead();
    const household = within(await screen.findByRole("region", { name: "Household" }));
    const before = { households: households.count, rankings: rankings.count };

    await user.click(household.getByRole("button", { name: "Save household" }));

    expect(await household.findByText(/net_income must be positive/)).toBeInTheDocument();
    expect(households.count).toBe(before.households);
    expect(rankings.count).toBe(before.rankings);
  });

  it("reads nothing again while the screen stays the same", async () => {
    mockServer.use(
      http.get("/v1/evaluations", () =>
        HttpResponse.json({
          items: [
            {
              id: 1,
              criteria_set: "default",
              level: "country",
              computed_at: "2026-09-21T09:00:00Z",
              score_scale_max: 100,
              note: "Before the gates",
            },
          ],
        }),
      ),
      http.get("/v1/evaluations/:evaluationId", () =>
        HttpResponse.json(rankingFor("default", "country")),
      ),
    );
    const households = countReads("/household");
    const rankings = countReads("/rankings");
    const user = userEvent.setup();
    renderShell("/rank");
    await sidebarHasRead();
    const rank = within(screen.getByRole("region", { name: "Rank" }));
    await waitFor(() =>
      expect(rank.getByText("Criteria set").nextSibling).toHaveTextContent("default"),
    );
    const kept = await screen.findByRole("link", { name: /before the gates/i });
    const before = { households: households.count, rankings: rankings.count };

    // The tab of the screen already shown, then a saved ranking opened on it: two moves, one screen.
    await user.click(screen.getByRole("link", { name: "Rank" }));
    await user.click(kept);

    expect(await screen.findByText(/as it was when it was saved/i)).toBeInTheDocument();
    expect(households.count).toBe(before.households);
    expect(rankings.count).toBe(before.rankings);
  });

  /** The root only redirects, so nothing has been written there that the sidebar could miss. */
  it("reads the household once when the address is the root, which only redirects", async () => {
    const households = countReads("/household");
    renderShell("/");
    await sidebarHasRead();
    await screen.findByRole("region", { name: "Household" });

    // One for the sidebar and one for the panel on Configure.
    expect(households.count).toBe(2);
  });
});

describe("when the API fails", () => {
  it("shows the error code beside the message, and offers a retry it can honour", async () => {
    mockServer.use(http.get("/v1/rankings", () => HttpResponse.error()));
    renderShell("/rank");

    const alerts = await screen.findAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("client.unreachable");
    expect(alerts[0]).toHaveTextContent(/backend did not answer/i);

    // The sidebar says it once, quietly and without the code, and its own Try again re-reads.
    const counts = within(await screen.findByRole("region", { name: /candidates/i }));
    expect(await counts.findByText(/match counts could not be loaded/i)).toBeInTheDocument();
    expect(counts.queryByText("client.unreachable")).toBeNull();

    mockServer.resetHandlers();
    const user = userEvent.setup();
    await user.click(counts.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(counts.getByText("Matching").nextSibling).toHaveTextContent("2"));
  });

  it("keeps the navigation usable when the criteria sets cannot be loaded", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets", () =>
        HttpResponse.json(
          { code: "catalog_unavailable", message: "The catalog is not seeded." },
          { status: 503 },
        ),
      ),
    );
    renderShell("/rank");

    // PL-009: said in words, never as the code and never as "no criteria sets".
    expect(
      await screen.findByText(/criteria sets and levels could not be loaded/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("catalog_unavailable")).toBeNull();
    expect(screen.queryByText("No criteria sets")).toBeNull();
    expect(screen.getByRole("link", { name: "Compare" })).toBeInTheDocument();
  });

  it("shows the screen with no selection when the catalog is empty", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets", () => HttpResponse.json({ items: [] })),
      http.get("/v1/levels", () => HttpResponse.json({ items: [] })),
    );
    renderShell("/rank");

    expect(await screen.findByText("No criteria sets")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /active criteria set/i })).toBeDisabled();
    // With nothing selected there is nothing to fetch, and the sidebar says so rather than
    // showing a spinner for a request it never made.
    const counts = within(await screen.findByRole("region", { name: /candidates/i }));
    expect(counts.getByText(/nothing to count until there is a criteria set/i)).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});
