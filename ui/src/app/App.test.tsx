import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { CITY_CANDIDATES, COUNTRY_CANDIDATES } from "../mocks/fixtures";
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
    const levels = within(group).getAllByRole("button");
    expect(levels.map((button) => button.textContent)).toEqual(["Country", "City"]);
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

  it("summarises the most recent run and links to the history", async () => {
    renderShell("/rank");

    const lastRun = within(await screen.findByRole("region", { name: /last acquisition/i }));
    await waitFor(() => expect(lastRun.getByText("Status").nextSibling).toHaveTextContent("completed"));
    expect(lastRun.getByText("Started").nextSibling).toHaveTextContent("29 Aug 2026, 18:02");
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

describe("when the API fails", () => {
  it("shows the error code beside the message, and offers a retry it can honour", async () => {
    mockServer.use(http.get("/v1/rankings", () => HttpResponse.error()));
    renderShell("/rank");

    const alerts = await screen.findAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("client.unreachable");
    expect(alerts[0]).toHaveTextContent(/backend did not answer/i);

    mockServer.resetHandlers();
    const user = userEvent.setup();
    await user.click(within(alerts[0]!).getByRole("button", { name: /try again/i }));

    const counts = within(await screen.findByRole("region", { name: /candidates/i }));
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

    expect(await screen.findByText("catalog_unavailable")).toBeInTheDocument();
    expect(await screen.findByText(/catalog is not seeded/i)).toBeInTheDocument();
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
    expect(counts.getByText(/choose a criteria set and a level/i)).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});
