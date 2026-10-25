import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { COUNTRY_CANDIDATES } from "../mocks/fixtures";
import { mockServer } from "../mocks/server";
import { renderShell } from "../testing/renderShell";

/**
 * The sidebar's cards on the one read state (C01 U5): what each says while it reads, when it
 * could not read, and when the server answered with a refusal that is a state rather than a
 * fault.
 */

const BASE = "/v1";

function card(name: string | RegExp): HTMLElement {
  return screen.getByRole("region", { name });
}

function figure(cardName: string | RegExp, label: string): ChildNode | null {
  return within(card(cardName)).getByText(label).nextSibling;
}

function refuse(path: string, code: string, status: number) {
  mockServer.use(
    http.get(`${BASE}${path}`, () =>
      HttpResponse.json({ code, message: `${code} in the server's words.` }, { status }),
    ),
  );
}

/** Answers the first GET of a path at once and holds every later one until `release`. */
function holdRereads(path: string): { release: () => void } {
  let answered = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockServer.use(
    http.get(`${BASE}${path}`, async () => {
      answered += 1;
      if (answered > 1) await held;
      return undefined;
    }),
  );
  return { release };
}

describe("PL-005: the candidates card while the score range is unset", () => {
  it("keeps Total and says in words why the other three are missing", async () => {
    refuse("/rankings", "score_scale_not_set", 409);
    renderShell("/acquire");

    await waitFor(() =>
      expect(figure(/^candidates$/i, "Total")).toHaveTextContent(
        String(COUNTRY_CANDIDATES.length),
      ),
    );
    const counts = within(card(/^candidates$/i));
    expect(await counts.findByText(/depend on a score/i)).toBeInTheDocument();
    expect(counts.queryByText("Matching")).toBeNull();
    expect(counts.queryByRole("alert")).toBeNull();
    expect(card(/^candidates$/i)).not.toHaveTextContent("score_scale_not_set");
  });

  it("says the set cannot be ranked, in words, when the server says so", async () => {
    refuse("/rankings", "cannot_be_ranked", 409);
    renderShell("/acquire");

    const counts = within(await screen.findByRole("region", { name: /^candidates$/i }));
    expect(await counts.findByText(/cannot be ranked/i)).toBeInTheDocument();
    expect(counts.getByText("Total")).toBeInTheDocument();
    expect(card(/^candidates$/i)).not.toHaveTextContent("cannot_be_ranked");
  });

  it("reports any other failure of the ranking as a failure, and keeps Total", async () => {
    mockServer.use(http.get(`${BASE}/rankings`, () => new HttpResponse(null, { status: 500 })));
    renderShell("/acquire");

    const counts = within(await screen.findByRole("region", { name: /^candidates$/i }));
    expect(await counts.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(counts.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(counts.getByText("Total")).toBeInTheDocument();
    expect(counts.queryByText(/depend on a score/i)).toBeNull();
  });
});

describe("PL-008: the household card tells not recorded from not read", () => {
  it("says nothing has been recorded only for household_not_configured", async () => {
    refuse("/household", "household_not_configured", 404);
    renderShell("/acquire");

    const household = within(
      await screen.findByRole("region", { name: /household summary/i }),
    );
    expect(await household.findByText(/nothing has been recorded/i)).toBeInTheDocument();
    expect(household.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("reports a failure it cannot read as a failure, with Try again", async () => {
    mockServer.use(
      http.get(`${BASE}/household`, () => new HttpResponse("Internal Server Error", { status: 500 })),
    );
    renderShell("/acquire");

    const household = within(
      await screen.findByRole("region", { name: /household summary/i }),
    );
    expect(await household.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(household.queryByText(/nothing has been recorded/i)).toBeNull();

    mockServer.resetHandlers();
    await userEvent.setup().click(household.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(household.getByText("Adults").nextSibling).toHaveTextContent("Two"));
  });
});

describe("PL-009: a selection that is loading or failed never reads as none", () => {
  it("while the sets load, nothing says there are none, and the controls are busy", async () => {
    mockServer.use(
      http.get(`${BASE}/criteria-sets`, async () => {
        await delay("infinite");
        return undefined;
      }),
    );
    renderShell("/acquire");

    await screen.findByRole("heading", { name: "Acquire" });
    expect(screen.queryByText("No criteria sets")).toBeNull();
    expect(screen.queryByText(/0 sets/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /active criteria set/i })).toBeNull();
    expect(document.querySelector(".sidebar [aria-busy='true']")).not.toBeNull();
  });

  it("when the sets fail, says so without the code, and offers Try again", async () => {
    refuse("/criteria-sets", "catalog_unavailable", 503);
    renderShell("/acquire");

    const sidebar = within(await screen.findByRole("complementary"));
    expect(await sidebar.findByText(/criteria sets and levels could not be loaded/i)).toBeInTheDocument();
    expect(sidebar.queryByText("catalog_unavailable")).toBeNull();
    expect(sidebar.queryByText("No criteria sets")).toBeNull();
    expect(sidebar.queryByText(/choose a criteria set/i)).toBeNull();
    expect(sidebar.getAllByRole("button", { name: /try again/i }).length).toBeGreaterThan(0);
  });

  it("never offers a deeper level when the roster could not be read", async () => {
    mockServer.use(http.get(`${BASE}/candidates`, () => new HttpResponse(null, { status: 500 })));
    renderShell("/acquire");

    const city = await screen.findByRole("button", { name: "City" });
    await waitFor(() => expect(city).toHaveAttribute("aria-disabled", "true"));
    expect(
      await screen.findByText(/could not check which levels hold candidates/i),
    ).toBeInTheDocument();
    await userEvent.setup().click(city);
    expect(city).toHaveAttribute("aria-pressed", "false");
  });

  it("holds every level until the roster says which hold candidates", async () => {
    mockServer.use(
      http.get(`${BASE}/candidates`, async () => {
        await delay("infinite");
        return undefined;
      }),
    );
    renderShell("/acquire");

    const city = await screen.findByRole("button", { name: "City" });
    expect(city).toHaveAttribute("aria-disabled", "true");
    expect(city).not.toBeDisabled();
  });
});

describe("PL-010: the sidebar keeps what it shows while it reads it again", () => {
  it("keeps the household on screen, marked busy, while it is read again", async () => {
    const household = holdRereads("/household");
    renderShell("/acquire");
    await waitFor(() =>
      expect(figure("Household summary", "Adults")).toHaveTextContent("Two"),
    );

    await userEvent.setup().click(screen.getByRole("link", { name: "Rank" }));

    await waitFor(() =>
      expect(
        within(card("Household summary")).getByText("Adults").closest("[aria-busy]"),
      ).toHaveAttribute("aria-busy", "true"),
    );
    expect(figure("Household summary", "Adults")).toHaveTextContent("Two");
    household.release();
    await waitFor(() =>
      expect(
        within(card("Household summary")).getByText("Adults").closest("[aria-busy]"),
      ).toHaveAttribute("aria-busy", "false"),
    );
  });
});
