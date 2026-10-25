import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { replaceSettings } from "../api/endpoints";
import { COUNTRY_CANDIDATES, SETTINGS } from "../mocks/fixtures";
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

  /**
   * From review. The reason was looked for only on a first read that failed: once counts had
   * been shown, a re-read refused for an unset range kept them on screen as "could not be
   * refreshed", with a Try again the server will refuse for as long as the range stays unset.
   */
  it("takes shown counts away, with the reason, when the range is cleared meanwhile", async () => {
    renderShell("/acquire");
    const counts = within(await screen.findByRole("region", { name: /^candidates$/i }));
    await counts.findByText("Matching");

    await replaceSettings({ ...SETTINGS, score_scale_max: null });
    await userEvent.setup().click(screen.getByRole("link", { name: "Compare" }));

    expect(await counts.findByText(/depend on a score/i)).toBeInTheDocument();
    expect(counts.queryByText("Matching")).toBeNull();
    expect(counts.queryByText(/could not be refreshed/i)).toBeNull();
    expect(counts.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(figure(/^candidates$/i, "Total")).toHaveTextContent(String(COUNTRY_CANDIDATES.length));
  });

  /**
   * A server that answered and failed. **Not a 503 with no body**, which is a server that did not
   * answer: the shell's card says that once and reads it again by itself (PL-002).
   */
  function serverFault(): Response {
    return HttpResponse.json({ code: "internal_error", message: "The server failed." }, { status: 500 });
  }

  /**
   * From review. Try again on counts that could not be refreshed held focus in their region,
   * and the reason that replaced the region took it away: focus fell to the page.
   */
  it("keeps focus on the reason when a retry is refused for an unset range", async () => {
    renderShell("/acquire");
    const counts = within(await screen.findByRole("region", { name: /^candidates$/i }));
    await counts.findByText("Matching");
    mockServer.use(http.get(`${BASE}/rankings`, () => serverFault()));
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Compare" }));
    const retry = await counts.findByRole("button", { name: /try again/i });

    mockServer.resetHandlers();
    await replaceSettings({ ...SETTINGS, score_scale_max: null });
    await user.click(retry);

    const reason = await counts.findByText(/depend on a score/i);
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toBe(reason);
  });

  /** From review: a first read that failed, then a retry refused for an unset range. */
  it("puts focus on the reason when a retry of counts that never loaded is refused", async () => {
    mockServer.use(http.get(`${BASE}/rankings`, () => serverFault()));
    renderShell("/acquire");
    const counts = within(await screen.findByRole("region", { name: /^candidates$/i }));
    const retry = await counts.findByRole("button", { name: /try again/i });

    mockServer.resetHandlers();
    await replaceSettings({ ...SETTINGS, score_scale_max: null });
    await userEvent.setup().click(retry);

    const reason = await counts.findByText(/depend on a score/i);
    await waitFor(() => expect(reason).toHaveFocus());
  });

  /**
   * From review. Two refusals landing together: the sidebar's re-read and the comparison the
   * reader asked for with a tick. Only the notice that replaced the chip may take its focus.
   */
  it("leaves the focus a refused Compare had to Compare's own notice", async () => {
    const released: (() => void)[] = [];
    const heldPaths = new Set<string>();
    const refusal = () =>
      HttpResponse.json(
        { code: "score_scale_not_set", message: "score_scale_max is not set." },
        { status: 409 },
      );
    const holdLater = (path: string) => {
      let asked = 0;
      mockServer.use(
        http.get(`${BASE}${path}`, async () => {
          asked += 1;
          if (path === "/rankings" && asked === 1) return undefined;
          heldPaths.add(path);
          await new Promise<void>((resolve) => released.push(resolve));
          return refusal();
        }),
      );
    };
    holdLater("/rankings");
    holdLater("/comparisons");
    renderShell("/acquire");
    const counts = within(await screen.findByRole("region", { name: /^candidates$/i }));
    await counts.findByText("Matching");
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Compare" }));
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /focus/i }),
      await screen.findByRole("option", { name: "Portugal" }),
    );
    // No button (PL-094): the tick asks, after a short pause.
    await user.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
    // Both held, whichever order and however often the sidebar re-reads meanwhile.
    await waitFor(() => expect([...heldPaths].sort()).toEqual(["/comparisons", "/rankings"]));

    act(() => released.forEach((release) => release()));

    const nothing = await screen.findByRole("region", { name: "Nothing to compare" });
    await counts.findByText(/depend on a score/i);
    await waitFor(() => expect(document.activeElement).toContainElement(nothing));
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
    expect(screen.queryByText(/No criteria set/)).toBeNull();
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
    expect(sidebar.queryByText(/No criteria set/)).toBeNull();
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

/** RULES "Focus": a Try again in the sidebar takes itself away; focus stays in its card. */
describe("focus when the sidebar reads again from the keyboard", () => {
  it("keeps focus in the levels when the roster is read again and answers", async () => {
    let failing = true;
    mockServer.use(
      http.get(`${BASE}/candidates`, ({ request }) =>
        failing && !new URL(request.url).searchParams.has("level")
          ? HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 })
          : undefined,
      ),
    );
    renderShell("/acquire");
    const sidebar = screen.getByRole("complementary");
    const note = await within(sidebar).findByText(/could not check which levels hold candidates/i);

    failing = false;
    act(() => within(note).getByRole("button", { name: "Try again" }).focus());
    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(within(sidebar).queryByText(/could not check which levels/i)).toBeNull(),
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(sidebar).toContainElement(document.activeElement as HTMLElement);
  });

  it("hands focus to 'not recorded' when the household read again says so", async () => {
    let failing = true;
    mockServer.use(
      http.get(`${BASE}/household`, () =>
        failing
          ? HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 })
          : HttpResponse.json(
              { code: "household_not_configured", message: "x" },
              { status: 404 },
            ),
      ),
    );
    renderShell("/acquire");
    const card = await screen.findByRole("region", { name: "Household summary" });
    const retry = await within(card).findByRole("button", { name: "Try again" });

    failing = false;
    act(() => retry.focus());
    await userEvent.keyboard("{Enter}");

    const said = await within(card).findByText(/nothing has been recorded about the household/i);
    await waitFor(() => expect(document.activeElement).toBe(said));
  });
});
