import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { replaceSettings } from "../../api/endpoints";
import type { components } from "../../api/schema";
import { ATTRIBUTES, SETTINGS, candidatesForLevel } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { watchNextComparison } from "../../testing/comparisons";
import { renderShell } from "../../testing/renderShell";

/**
 * The Compare tab (`reqs.md` 8.5).
 *
 * What these tests hold is that **the screen prints the server's judgement**: the deltas, what
 * each is worth, and the sentences of the synthesis all arrive from the API. A comparison
 * assembled here would be a second opinion nobody asked for (`arch.md` 8.1).
 *
 * **The attributes live inside the matrix now**, not in a flat table below it: a pillar row
 * opens in place to show the figures that made its score, which is why the attribute tests
 * open a pillar first.
 */

const BASE = "/v1";

async function chooseFocus(name: string) {
  // The option, not just the label: the select exists before the candidates arrive, and
  // selecting then would pass for the wrong reason.
  const option = await screen.findByRole("option", { name });
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Focus" }), option);
}

/** Choose a focus and one comparator, and wait for the comparison the screen asks for. */
async function compare(focus: string, comparator: string) {
  await chooseFocus(focus);
  const drawn = watchNextComparison();
  await userEvent.click(
    await screen.findByRole("checkbox", { name: comparator }),
  );
  await drawn();
}

/** Compare with no comparator limit set, as a fresh installation has, and return the refusal. */
/** A comparison refused for an unset limit: cleared elsewhere after this screen read it. */
async function compareWithNoLimit(): Promise<HTMLElement> {
  mockServer.use(
    http.get(`${BASE}/comparisons`, () =>
      HttpResponse.json(
        { code: "comparator_limit_not_set", message: "SENTINEL_MESSAGE" },
        { status: 409 },
      ),
    ),
  );
  renderShell("/compare");
  await compare("Portugal", "Netherlands");
  return screen.findByRole("region", { name: "Nothing to compare" });
}

/** The synthesis card headed by this comparator's name. */
async function cardOf(comparator: string): Promise<HTMLElement> {
  return (await screen.findByRole("heading", { name: comparator })).closest("section")!;
}

/** The lines of one list on a card, each as its text. */
function linesUnder(card: HTMLElement, label: string): string[] {
  const list = within(card).getByText(label).parentElement!;
  return within(list)
    .getAllByRole("listitem")
    .map((line) => line.textContent ?? "");
}

/**
 * Open a pillar row to reveal the attributes beneath it. The pillar name is the button, and the
 * first pillar opens with the first drawing (PL-102), so an open one is left as it is.
 */
async function openPillar(name: string) {
  const pillar = await screen.findByRole("button", { name });
  if (pillar.getAttribute("aria-expanded") !== "true") await userEvent.click(pillar);
}

describe("choosing what to compare", () => {
  it("shows the comparator limit the settings configured", async () => {
    renderShell("/compare");

    expect(await screen.findByText(/up to 5 comparators/i)).toBeInTheDocument();
  });

  it("will not compare a candidate with itself", async () => {
    renderShell("/compare");

    await chooseFocus("Portugal");

    expect(screen.queryByRole("checkbox", { name: "Portugal" })).toBeNull();
  });

  it("drops a comparator that is then chosen as the focus", async () => {
    renderShell("/compare");

    // **The order that used to break it** (P81). Ticking first and choosing second left
    // Portugal in `comparators` while its chip disappeared, so it could not be unticked and
    // every Compare sent `focus=portugal&comparators=...,portugal` -- which the server
    // refuses with 409 "cannot be compared with itself". The test above only ever exercised
    // the order that works.
    await userEvent.click(await screen.findByRole("checkbox", { name: "Portugal" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));
    await chooseFocus("Portugal");

    // Spain survives, so this is a prune rather than a reset.
    expect(screen.getByRole("checkbox", { name: "Spain" })).toBeChecked();

    // The real assertion: the request the screen builds is one the server accepts.
    expect(
      await screen.findByRole("heading", { name: "Portugal against Spain" }),
    ).toBeInTheDocument();
  });

  it("asks for nothing until a comparator is chosen, and says what to choose", async () => {
    let asked = 0;
    mockServer.use(
      http.get(`${BASE}/comparisons`, () => {
        asked += 1;
        return undefined;
      }),
    );
    renderShell("/compare");

    expect(await screen.findByText(/^Choose up to 5 to compare with /)).toBeInTheDocument();
    expect(asked).toBe(0);
  });

  /**
   * UI-25. The placeholder's value is the empty string, which is no candidate: a cleared focus
   * asks for nothing and draws nothing.
   */
  it("draws nothing once the focus is cleared, and says what to choose", async () => {
    renderShell("/compare");
    await compare("Portugal", "Spain");
    await screen.findByRole("heading", { name: "Portugal against Spain" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Focus" }), "");

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /against/ })).toBeNull(),
    );
    expect(
      screen.getByText("Choose a candidate to focus on, then who to compare it with."),
    ).toBeInTheDocument();
  });

  it("compares again once a focus is chosen again, keeping the ticked comparators", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Focus" }), "");

    await chooseFocus("Netherlands");

    expect(screen.getByRole("checkbox", { name: "Spain" })).toBeChecked();
    expect(
      await screen.findByRole("heading", { name: /netherlands against spain/i }),
    ).toBeInTheDocument();
  });
});

describe("when the level changes underneath", () => {
  it("clears the comparators and the comparison, and focuses the new level's default", async () => {
    // P54: `focus`, `comparators` and `asked` survived a level change while the fetcher
    // depended on `levelId`, so the screen immediately re-asked with candidate ids from the
    // old level -- `level=city&focus=country.portugal`, which the contract answers 409
    // "Levels mixed" -- and the picker showed the new roster with a stale focus selected.
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    expect(
      await screen.findByRole("table", { name: /every pillar/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "City" }));

    // No home at this level, so the top of its ranking (PL-102).
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("city.lisbon"),
    );
    expect(screen.getByRole("checkbox", { name: "Porto" })).not.toBeChecked();
    expect(
      screen.queryByRole("table", { name: /every pillar/i }),
    ).toBeNull();
  });
});

/** Moves to another tab the way a reader does, by the tab bar. */
async function openTab(name: string) {
  const tabs = screen.getByRole("navigation", { name: "Sections" });
  await userEvent.click(within(tabs).getByRole("link", { name }));
}

/**
 * PL-016. The choices live above the routes, so leaving the tab, reloading or switching set
 * keeps them; a level change resets them (above).
 */
describe("what Compare remembers", () => {
  async function compareWithRawFigures() {
    await compare("Portugal", "Netherlands");
    await userEvent.click(await screen.findByRole("radio", { name: /raw figures/i }));
    expect(await screen.findByRole("table", { name: /every pillar/i })).toBeInTheDocument();
  }

  async function expectRemembered() {
    expect(await screen.findByRole("table", { name: /every pillar/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("country.portugal");
    expect(screen.getByRole("checkbox", { name: "Netherlands" })).toBeChecked();
    expect(screen.getByRole("radio", { name: /raw figures/i })).toBeChecked();
  }

  it("keeps its selection, Raw figures and the matrix across a visit to Configure", async () => {
    renderShell("/compare");
    await compareWithRawFigures();

    await openTab("Configure");
    await screen.findByRole("heading", { level: 1, name: "Configure" });
    await openTab("Compare");

    await expectRemembered();
  });

  it("keeps the open pillar across a tab change", async () => {
    renderShell("/compare");
    await compareWithRawFigures();
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await openTab("Configure");
    await screen.findByRole("heading", { level: 1, name: "Configure" });
    await openTab("Compare");

    await screen.findByRole("table", { name: /every pillar/i });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Economy" })).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    expect(screen.getByRole("row", { name: /cost of living index/i })).toBeInTheDocument();
  });

  it("keeps them across a reload", async () => {
    const page = renderShell("/compare");
    await compareWithRawFigures();

    page.unmount();
    renderShell("/compare");

    await expectRemembered();
  });

  it("keeps them across a set switch, drawn again for the new set", async () => {
    const asked: string[] = [];
    mockServer.use(
      http.get(`${BASE}/comparisons`, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("criteria_set") ?? "");
        return undefined;
      }),
    );
    renderShell("/compare");
    await compareWithRawFigures();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /active criteria set/i }),
      "remote_only",
    );

    await waitFor(() => expect(asked).toContain("remote_only"));
    await expectRemembered();
  });

  it("drops a remembered candidate the roster no longer holds, and asks for nothing", async () => {
    const page = renderShell("/compare");
    await compareWithRawFigures();
    page.unmount();

    let comparisonsAsked = 0;
    mockServer.use(
      http.get(`${BASE}/candidates`, ({ request }) => {
        const level = new URL(request.url).searchParams.get("level");
        const items = candidatesForLevel(level).filter(
          (candidate) => candidate.id !== "country.netherlands",
        );
        return HttpResponse.json({ items });
      }),
      http.get(`${BASE}/comparisons`, () => {
        comparisonsAsked += 1;
        return undefined;
      }),
    );
    renderShell("/compare");

    expect(await screen.findByRole("option", { name: "Portugal" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("country.portugal");
    expect(screen.queryByRole("checkbox", { name: "Netherlands" })).toBeNull();
    expect(screen.getByRole("radio", { name: /raw figures/i })).toBeChecked();
    expect(screen.queryByRole("table", { name: /every pillar/i })).toBeNull();
    expect(comparisonsAsked).toBe(0);
  });
});

/** Counts the comparisons asked for, and lets each through to the mock. */
function countComparisons(): { asked: URLSearchParams[] } {
  const seen = { asked: [] as URLSearchParams[] };
  mockServer.use(
    http.get(`${BASE}/comparisons`, ({ request }) => {
      seen.asked.push(new URL(request.url).searchParams);
      return undefined;
    }),
  );
  return seen;
}

/** PL-094. The drawing is always the comparison of the selection on screen. */
describe("the comparison follows the selection", () => {
  it("draws the comparison once a focus and a comparator are chosen, with no button", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));

    expect(
      await screen.findByRole("heading", { name: "Portugal against Netherlands" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^compare$/i })).toBeNull();
  });

  it("follows the selection: unticking redraws without that comparator", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Spain" }));
    await screen.findByRole("heading", { name: "Portugal against Netherlands, Spain" });

    await userEvent.click(screen.getByRole("checkbox", { name: "Spain" }));

    expect(
      await screen.findByRole("heading", { name: "Portugal against Netherlands" }),
    ).toBeInTheDocument();
  });

  it("sends one request for a burst of ticks", async () => {
    const seen = countComparisons();
    renderShell("/compare");
    await chooseFocus("Portugal");
    await screen.findByRole("checkbox", { name: "Netherlands" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Netherlands" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Spain" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Estonia" }));

    await screen.findByRole("heading", { name: /^Portugal against/ });
    expect(seen.asked).toHaveLength(1);
    expect(seen.asked[0]!.getAll("comparators")).toEqual([
      "country.netherlands",
      "country.spain",
      "country.estonia",
    ]);
  });

  it("marks a drawing that belongs to the previous selection while the new one loads", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
    await screen.findByRole("heading", { name: "Portugal against Netherlands" });
    const held: (() => void)[] = [];
    const release = () => held.splice(0).forEach((resolve) => resolve());
    mockServer.use(
      http.get(`${BASE}/comparisons`, async () => {
        await new Promise<void>((resolve) => held.push(resolve));
        return undefined;
      }),
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "Spain" }));

    expect(await screen.findByText("Updating…")).toHaveAttribute("role", "status");
    const stale = screen.getByRole("heading", { name: "Portugal against Netherlands" });
    expect(stale.closest('[aria-busy="true"]')).not.toBeNull();
    // Still marked once the new comparison has been asked for and not yet answered.
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    expect(screen.getByText("Updating…")).toBeInTheDocument();

    release();

    expect(
      await screen.findByRole("heading", { name: "Portugal against Netherlands, Spain" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Updating…")).toBeNull();
  });

  it("keeps the drawing when the new one fails, marked could not be refreshed, and Try again reads it", async () => {
    // PL-010 over C07-C: a failure never takes away what was on screen.
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
    await screen.findByRole("heading", { name: "Portugal against Netherlands" });
    mockServer.use(http.get(`${BASE}/comparisons`, () => serverFault()));

    await userEvent.click(screen.getByRole("checkbox", { name: "Spain" }));

    const region = within(compareRegion());
    expect(await region.findByText(/comparison could not be refreshed/i)).toBeInTheDocument();
    expect(region.getByRole("heading", { name: "Portugal against Netherlands" })).toBeInTheDocument();
    expect(region.queryByText("Updating…")).toBeNull();

    mockServer.resetHandlers();
    await userEvent.click(region.getByRole("button", { name: "Try again" }));

    expect(
      await region.findByRole("heading", { name: "Portugal against Netherlands, Spain" }),
    ).toBeInTheDocument();
    expect(region.queryByText(/could not be refreshed/i)).toBeNull();
  });

  it("redraws when an acquisition ends", async () => {
    let status = "running";
    const watched = { id: 8, triggered_by: "user", started_at: "2026-09-21T09:00:00Z", cost_eur: 0 };
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({ items: [{ ...watched, run_status: status }], total: 1 }),
      ),
      http.get(`${BASE}/data-acquisition-runs/:runId`, () =>
        HttpResponse.json({
          ...watched,
          run_status: status,
          progress: { items_total: 96, items_completed: 24 },
          failures: [],
        }),
      ),
    );
    const seen = countComparisons();
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
    await screen.findByRole("heading", { name: "Portugal against Netherlands" });
    await screen.findByRole("region", { name: /acquisition in progress/i });
    const before = seen.asked.length;

    status = "completed";

    await waitFor(() => expect(seen.asked.length).toBeGreaterThan(before), { timeout: 8_000 });
  });
});

/** PL-103. */
describe("the order of the comparators", () => {
  it("orders columns and cards by score, No score last", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    for (const name of ["Estonia", "Spain", "Netherlands"]) {
      await userEvent.click(await screen.findByRole("checkbox", { name }));
    }

    const matrix = await screen.findByRole("table", { name: /every pillar/i });
    await waitFor(() =>
      expect(
        within(matrix)
          .getAllByRole("columnheader")
          .map((header) => header.textContent ?? "")
          .filter((text) => /Netherlands|Spain|Estonia/.test(text))
          .map((text) => /Netherlands|Spain|Estonia/.exec(text)![0]),
      ).toEqual(["Netherlands", "Spain", "Estonia"]),
    );
    const cards = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(cards.filter((name) => /^(Netherlands|Spain|Estonia)$/.test(name ?? ""))).toEqual([
      "Netherlands",
      "Spain",
      "Estonia",
    ]);
  });
});

/** PL-102. */
describe("what Compare opens with", () => {
  it("opens on the home candidate with nothing to compare it with yet", async () => {
    renderShell("/compare");

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("country.romania"),
    );
    expect(
      screen.getByText("Choose up to 5 to compare with Romania."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /every pillar/i })).toBeNull();
  });

  it("opens on the top of the ranking where home is not at this level", async () => {
    mockServer.use(
      http.get(`${BASE}/household`, () =>
        HttpResponse.json({ code: "household_not_configured", message: "No household." }, {
          status: 409,
        }),
      ),
    );
    renderShell("/compare");

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("country.portugal"),
    );
  });

  it("does not put a default back over a focus the reader cleared", async () => {
    renderShell("/compare");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("country.romania"),
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Focus" }), "");

    await openTab("Configure");
    await screen.findByRole("heading", { level: 1, name: "Configure" });
    await openTab("Compare");

    await screen.findByRole("option", { name: "Portugal" });
    expect(screen.getByRole("combobox", { name: "Focus" })).toHaveValue("");
  });

  it("opens the first pillar with the first drawing", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));

    expect(await screen.findByRole("button", { name: "Economy" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("the comparison", () => {
  it("heads each pair with the score difference", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    // The card names the comparator; the difference sits beside the name rather than inside
    // it, so the heading reads as a place and the number reads as a number. The Netherlands'
    // 71 against Portugal's 78 is seven behind, as its column in the matrix reads (PL-091).
    const card = (await screen.findByRole("heading", { name: "Netherlands" }))
      .closest("section")!;
    expect(within(card).getByText("\u22127 points")).toBeInTheDocument();
  });

  /**
   * PL-100. **A card's lines are pillars**, each worth the comparator's pillar contribution
   * minus the focus's, as the server sends them: the Netherlands puts 8.4 into its total from
   * safety against Portugal's 7.68, and 18.5 from economics against 20.25.
   */
  it("lists the pillars the comparator leads and trails on, with what each is worth", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const card = await cardOf("Netherlands");
    expect(linesUnder(card, "Ahead on")).toEqual(["Safety+0.7#3 priority"]);
    expect(linesUnder(card, "Behind on")).toEqual(["Economy\u22121.8#1 priority"]);
  });

  /** PL-107. Spain trails Portugal on every pillar both scored. */
  it("says Nothing under an empty list", async () => {
    renderShell("/compare");

    await compare("Portugal", "Spain");

    const card = await cardOf("Spain");
    expect(linesUnder(card, "Ahead on")).toEqual(["Nothing"]);
    expect(linesUnder(card, "Behind on")).toHaveLength(2);
  });

  /** PL-099. Portugal has no family score, so no comparator can be compared with it there. */
  it("names the pillars it could not compare, and lists none of them", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const card = await cardOf("Netherlands");
    expect(card).toHaveTextContent("Not comparable, no data: Family");
    expect(within(card).queryByText(/^Family/)).toBeNull();
  });

  /** PL-099, C07-F. Estonia has no total, so there is no total for any line to add up to. */
  it("lists nothing against a missing total, and says why", async () => {
    renderShell("/compare");

    await compare("Portugal", "Estonia");

    const card = await cardOf("Estonia");
    expect(within(card).getByText("No comparable score")).toBeInTheDocument();
    expect(card).toHaveTextContent(
      "Estonia: only 41% of the scored weight was answered, against a floor of 60%",
    );
    expect(within(card).queryByText("Ahead on")).toBeNull();
    expect(within(card).queryByText("Behind on")).toBeNull();
    expect(card).toHaveTextContent("Not comparable, no data: Economy, Safety, Family");
  });

  /**
   * PL-001, from review. **The set's weights are a read like any other**: they were silence
   * when they failed, so every Weight read "—" and no line carried "#N priority", with nothing
   * to say why and no way to read them again.
   */
  it("says the set's weights could not be loaded, and draws them once read again", async () => {
    mockServer.use(
      http.get(`${BASE}/criteria-sets/:id`, () => new HttpResponse(null, { status: 503 })),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const comparison = within(screen.getByRole("region", { name: "Compare" }));
    expect(await comparison.findByText(/weights could not be loaded/i)).toBeInTheDocument();
    expect(comparison.queryByRole("table")).toBeNull();
    expect(comparison.queryByText("\u2014")).toBeNull();

    mockServer.resetHandlers();
    await userEvent.click(comparison.getByRole("button", { name: "Try again" }));

    const economy = (await screen.findByRole("button", { name: "Economy" })).closest("tr")!;
    expect(economy).toHaveTextContent("40.0%");
    expect(economy).toHaveTextContent("#1 priority");
  });

  it("reports a refusal from the server rather than showing an empty table", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(
          {
            code: "comparator_limit_exceeded",
            message: "SENTINEL_MESSAGE",
            details: { limit: 2, asked: 3 },
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "3 comparators were asked for, and the limit is 2.",
    );
  });

  /**
   * NEW-05. **The mock refuses as the server refuses.** An unset limit is a refusal of its own,
   * `comparator_limit_not_set`, raised before the comparators are counted at all; the mock
   * answered `invalid_comparison`, a code the server keeps for a request built wrong.
   */
  /** PL-007: only a setting to blame earns the way to Configure, and candidates are named. */
  it("names the candidates of a comparison that cannot be made, with no way to Configure", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(
          {
            code: "invalid_comparison",
            message: "SENTINEL_MESSAGE",
            details: { candidates: ["country.portugal"] },
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("These candidates cannot be compared as chosen: Portugal.");
    expect(within(alert).queryByRole("link", { name: /configure/i })).toBeNull();
    expect(alert).not.toHaveTextContent("country.portugal");
  });

  it("offers the way to Configure for a comparison over the limit", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(
          { code: "comparator_limit_exceeded", message: "x", details: { limit: 1, asked: 2 } },
          { status: 409 },
        ),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: /change it in configure/i })).toBeInTheDocument();
  });

  it("names an unset comparator limit as the reason a comparison is refused", async () => {
    expect(await compareWithNoLimit()).toHaveTextContent(
      /until the most candidates a comparison may hold is set/i,
    );
  });
});

describe("the pillar matrix", () => {
  it("names the heaviest pillars as priorities, by the set's weights", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    // Economics carries the most weight in the set (40%), so its row is marked first.
    const economy = (await screen.findByRole("button", { name: "Economy" })).closest("tr")!;
    expect(economy).toHaveTextContent("#1 priority");
  });

  /**
   * PL-104. **The set's configured weights, not the focus's.** Portugal's own pillar weights,
   * redistributed for its missing data, are 25 and 12; the set says 40 and 25.
   */
  it("shows the set's pillar weights to one decimal, whatever the focus", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const table = await screen.findByRole("table", { name: /every pillar/i });
    const weightOf = (pillar: string) =>
      within(table).getByRole("row", { name: new RegExp(pillar) }).querySelector(".matrix__weight");
    await waitFor(() => expect(weightOf("Economy")).toHaveTextContent("40.0%"));
    expect(weightOf("Safety")).toHaveTextContent("25.0%");
    expect(weightOf("Total score")).toHaveTextContent("100.0%");
  });

  it("draws a bar for a real gap between the totals", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    // Portugal 78 against the Netherlands' 71 is a seven-point gap, so the total row carries a
    // signed delta beside the score rather than only a bar that jsdom cannot measure.
    const table = await screen.findByRole("table", { name: /every pillar/i });
    const total = within(table).getByRole("row", { name: /total score/i });
    expect(total).toHaveTextContent("71");
    expect(total).toHaveTextContent("−7");
  });
});

describe("opening a pillar to its attributes", () => {
  it("shows a pillar's attributes only while it is open", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await userEvent.click(await screen.findByRole("button", { name: "Economy" }));

    expect(screen.queryByRole("row", { name: /cost of living index/i })).toBeNull();

    await openPillar("Economy");

    expect(
      await screen.findByRole("row", { name: /cost of living index/i }),
    ).toBeInTheDocument();
  });

  it("closes the pillar again when it is clicked once more", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");

    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("button", { name: "Economy" }));

    expect(screen.queryByRole("row", { name: /cost of living index/i })).toBeNull();
  });

  it("shows both sides of an attribute inside the opened pillar", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");

    const row = await screen.findByRole("row", {
      name: /cost of living index/i,
    });
    // The focus's score and the comparator's, both as normalised points by default.
    expect(within(row).getByText("73")).toBeInTheDocument();
    expect(within(row).getByText("41")).toBeInTheDocument();
  });

  it("leaves a pillar with no attributes as plain text, not a control", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");

    // Safety is a pillar the focus was scored on, but the fixture gives it no attributes, so
    // there is nothing to open and no button -- the name is there as a label only.
    const table = await screen.findByRole("table", { name: /every pillar/i });
    expect(within(table).getByText("Safety")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Safety" })).toBeNull();
  });

  it("keeps only one pillar open at a time", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(twoPillarComparison()),
      ),
    );
    renderShell("/compare");
    await compare("Portugal", "Netherlands");

    await openPillar("Economy");
    expect(
      await screen.findByRole("row", { name: /cost of living index/i }),
    ).toBeInTheDocument();

    await openPillar("Housing");

    // Opening Housing closes Economy: the drill-down is about one pillar at a time.
    expect(
      await screen.findByRole("row", { name: /rent to income/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /cost of living index/i })).toBeNull();
  });
});

/** PL-098, PL-097. What an attribute counted for, and what its gap is worth to the total. */
describe("an attribute row's weight and worth", () => {
  it("shows its weight and its place in the pillar", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");

    // Portugal's tax rate counted for 27.5% of its total and its cost of living for 12.5%.
    const tax = await screen.findByRole("row", { name: /total effective tax rate/i });
    const cost = screen.getByRole("row", { name: /cost of living index/i });
    expect(tax.querySelector(".matrix__weight")).toHaveTextContent("27.5%");
    expect(tax).toHaveTextContent("#1 in pillar");
    expect(cost.querySelector(".matrix__weight")).toHaveTextContent("12.5%");
    expect(cost).toHaveTextContent("#2 in pillar");
  });

  it("shows no weight and no place where the focus has no figure", async () => {
    mockServer.use(
      http.get(`${BASE}/attributes`, () =>
        HttpResponse.json({ items: [...ATTRIBUTES, MEDIAN_RENT] }),
      ),
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(rentComparison({ normalised_score: null })),
      ),
    );
    renderShell("/compare");
    await compare("Romania", "Spain");
    await openPillar("Economy");

    const rent = await screen.findByRole("row", { name: /median rent/i });
    expect(rent.querySelector(".matrix__weight")).toHaveTextContent("—");
    expect(rent).not.toHaveTextContent("in pillar");
  });

  /** The Netherlands' cost of living scores 41 against 73, at 12.5%: worth −4.0 to the total. */
  it("shows what each gap is worth under weighted impact", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");
    await userEvent.click(screen.getByRole("radio", { name: /weighted impact/i }));

    const cost = await screen.findByRole("row", { name: /cost of living index/i });
    expect(within(cost).getByText("\u22124.0")).toHaveClass("matrix__delta--behind");
    const tax = screen.getByRole("row", { name: /total effective tax rate/i });
    expect(within(tax).getByText("+2.2")).toHaveClass("matrix__delta--ahead");
  });

  it("shows the score gap again in score points", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");

    const cost = await screen.findByRole("row", { name: /cost of living index/i });
    expect(within(cost).getByText("\u221232")).toBeInTheDocument();
  });

  it("shows no worth where the comparator was not scored", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () => HttpResponse.json(missingFigureComparison())),
    );
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");
    await userEvent.click(screen.getByRole("radio", { name: /weighted impact/i }));

    const cost = await screen.findByRole("row", { name: /cost of living index/i });
    expect(cost.querySelector(".matrix__cell:not(.matrix__cell--focus) .matrix__delta")).toHaveTextContent(
      /^—$/,
    );
  });
});

/** PL-095. A candidate that does not match, or cannot be scored, says so where it is named. */
describe("a candidate's status", () => {
  /** The candidate's column header, found by the name it starts with. */
  async function headerOf(name: string): Promise<HTMLElement> {
    const table = await screen.findByRole("table", { name: /every pillar/i });
    return within(table)
      .getAllByRole("columnheader")
      .find((header) => (header.textContent ?? "").startsWith(name))!;
  }

  it("marks a comparator that does not match, with its reason", async () => {
    renderShell("/compare");
    await compare("Portugal", "Spain");

    for (const place of [await headerOf("Spain"), await cardOf("Spain")]) {
      const tag = within(place).getByText("Not matching");
      expect(tag).toHaveAttribute("title", "No visa route this household qualifies for.");
      expect(tag).toHaveTextContent("No visa route this household qualifies for.");
      expect(tag).toHaveAttribute("tabindex", "0");
    }
  });

  it("marks a candidate that cannot be scored, and why", async () => {
    renderShell("/compare");
    await compare("Portugal", "Estonia");

    for (const place of [await headerOf("Estonia"), await cardOf("Estonia")]) {
      expect(within(place).getByText("Insufficient data")).toHaveAttribute(
        "title",
        "only 41% of the scored weight was answered, against a floor of 60%",
      );
    }
  });

  it("marks the focus too", async () => {
    renderShell("/compare");
    await compare("Spain", "Portugal");

    expect(within(await headerOf("Spain")).getByText("Not matching")).toBeInTheDocument();
  });

  it("marks nothing on a matching candidate", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");

    expect(await headerOf("Netherlands")).toHaveTextContent(/^Netherlands$/);
    expect((await cardOf("Netherlands")).querySelector(".chip--matching")).toBeNull();
  });
});

/** PL-096. Every figure Compare shows says where it came from. */
describe("a figure's provenance on Compare", () => {
  function figure(
    magnitude: number,
    source: string,
    confidence: string,
    quote: string | null = null,
  ) {
    return {
      data_source: source,
      payload: { magnitude, unit: "index_eu27_100" },
      reference_period: { start: "2025-01-01", end: "2025-12-31" },
      retrieval_date: "2026-09-11T08:00:00Z",
      confidence_level: confidence,
      quote,
    };
  }

  function serveProvenance() {
    const drawn = missingFigureComparison();
    const spain = { ...drawn.comparators[0]!, candidate: "country.spain", name: "Spain" };
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json({
          ...drawn,
          comparators: [drawn.comparators[0], spain],
          attributes: drawn.attributes.map((row) => ({
            ...row,
            focus: {
              normalised_score: 82,
              value: figure(
                92.1,
                "stand_in",
                "low",
                "Switzerland's figure, standing in for Portugal.",
              ),
            },
            comparators: [
              {
                candidate: "country.netherlands",
                normalised_score: 41,
                delta: 13.4,
                value: figure(105.5, "eurostat_estimate", "low"),
              },
              {
                candidate: "country.spain",
                normalised_score: 70,
                delta: 4,
                value: figure(96.1, "eurostat", "high"),
              },
            ],
          })),
        }),
      ),
    );
  }

  async function openTheFigures() {
    serveProvenance();
    renderShell("/compare");
    await chooseFocus("Portugal");
    const drawn = watchNextComparison();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Spain" }));
    await drawn();
    await screen.findByRole("heading", { name: "Portugal against Netherlands, Spain" });
    await openPillar("Economy");
    return screen.findByRole("row", { name: /cost of living index/i });
  }

  /** Every figure cell in the row, the focus's and each comparator's: all but the weight. */
  function figureCells(row: HTMLElement): HTMLElement[] {
    return within(row).getAllByRole("cell").slice(1);
  }

  it.each(["score", "raw"] as const)(
    "gives every figure its source, both dates and its confidence, read as a %s",
    async (shownAs) => {
      const row = await openTheFigures();
      if (shownAs === "raw") {
        await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));
      }

      const cells = figureCells(row);
      expect(cells).toHaveLength(3);
      for (const cell of cells) {
        const said = cell.getAttribute("title") ?? "";
        expect(said).toMatch(/^Source: .+\. Describes .+ to .+\. Fetched .+\. \w+ confidence\./);
        expect(within(cell).getByText(said)).toHaveClass("visually-hidden");
      }
    },
  );

  it("marks a borrowed figure and says whose it is", async () => {
    const [focus] = figureCells(await openTheFigures());

    expect(within(focus!).getByText("Borrowed")).toBeInTheDocument();
    expect(focus).toHaveAttribute(
      "title",
      expect.stringContaining("Switzerland's figure, standing in for Portugal."),
    );
  });

  it("marks a low-confidence figure, and nothing on a measured one", async () => {
    const [, netherlands, spain] = figureCells(await openTheFigures());

    expect(within(netherlands!).getByText("Low confidence")).toBeInTheDocument();
    expect(spain!.querySelector(".matrix__mark")).toBeNull();
  });

  it("claims no provenance for a cell with no figure", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () => HttpResponse.json(missingFigureComparison())),
    );
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");

    const row = await screen.findByRole("row", { name: /cost of living index/i });
    const [, netherlands] = figureCells(row);
    expect(netherlands).not.toHaveAttribute("title");
  });
});

describe("the attribute figures inside a pillar", () => {
  /** PL-105. A score's note names the scale the comparison is on. */
  it("says what a score is measured on", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");

    const row = await screen.findByRole("row", { name: /cost of living index/i });
    expect(row.querySelector(".matrix__attr-note")).toHaveTextContent(/^normalised 0–100$/);
  });

  /** PL-105. Raw mode leaves the pillar rows in points, and says so. */
  it("says the pillars stay in points when figures are shown raw", async () => {
    renderShell("/compare");
    await userEvent.click(await screen.findByRole("radio", { name: /raw figures/i }));

    expect(
      screen.getByText(/pillar rows stay in points, because a pillar has no unit of its own/i),
    ).toBeInTheDocument();
  });

  it("shows scores until asked for figures", async () => {
    serveFigures("country.spain", "Spain");
    renderShell("/compare");
    await compare("Portugal", "Spain");
    await openPillar("Economy");

    const row = await screen.findByRole("row", {
      name: /cost of living index/i,
    });
    expect(row).toHaveTextContent("82");
    expect(row).not.toHaveTextContent("92.1");
  });

  it("switches the attribute rows to the figure in its own unit", async () => {
    serveFigures("country.spain", "Spain");
    renderShell("/compare");
    await compare("Portugal", "Spain");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    const row = screen.getByRole("row", { name: /cost of living index/i });
    expect(row).toHaveTextContent("92.1 EU27 = 100");
    expect(row).toHaveTextContent("105.5 EU27 = 100");
  });

  /** `delta` is documented as being in the attribute's own unit, so it belongs here. */
  it("shows the gap in the attribute's unit rather than in points", async () => {
    serveFigures("country.spain", "Spain");
    renderShell("/compare");
    await compare("Portugal", "Spain");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    // Spain's 105.5 against Portugal's 92.1: the server's gap, comparator minus focus.
    const row = screen.getByRole("row", { name: /cost of living index/i });
    expect(row).toHaveTextContent("+13.4");
    expect(row).not.toHaveTextContent("points");
  });

  it("goes back to scores when asked", async () => {
    serveFigures("country.spain", "Spain");
    renderShell("/compare");
    await compare("Portugal", "Spain");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));
    await userEvent.click(screen.getByRole("radio", { name: /^scores$/i }));

    const row = screen.getByRole("row", { name: /cost of living index/i });
    expect(row).toHaveTextContent("82");
    expect(row).not.toHaveTextContent("92.1");
  });

  /**
   * UIR-A2. The server's monetary gap is euros minus euros, so the row sizes it against the
   * focus's euro amount and says EUR. Sized against 2,500 RON, a 100-euro gap on a 500-euro
   * rent read as 4% and was drawn as noise.
   */
  it("judges and labels a monetary gap in euros, the unit the server subtracted it in", async () => {
    mockServer.use(
      http.get(`${BASE}/attributes`, () =>
        HttpResponse.json({ items: [...ATTRIBUTES, MEDIAN_RENT] }),
      ),
      http.get(`${BASE}/comparisons`, () => HttpResponse.json(rentComparison())),
    );
    renderShell("/compare");
    await compare("Romania", "Spain");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /median rent/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    const row = screen.getByRole("row", { name: /median rent/i });
    expect(row).toHaveTextContent("gaps in EUR");
    expect(within(row).getByText("+100 EUR")).not.toHaveClass("matrix__delta--faint");
    // Both operands are on screen in euros, so the gap can be checked (RC-1, `reqs.md` 5.5).
    expect(row).toHaveTextContent("2500 RON (500 EUR)");
    expect(row).toHaveTextContent("600 EUR");
  });

  /** PL-105. The note names the focus, and says nothing of gaps a row with no focus cannot have. */
  it("says no value for the focus, and nothing about gaps the row cannot have", async () => {
    mockServer.use(
      http.get(`${BASE}/attributes`, () =>
        HttpResponse.json({ items: [...ATTRIBUTES, MEDIAN_RENT] }),
      ),
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(rentComparison({ normalised_score: null })),
      ),
    );
    renderShell("/compare");
    await compare("Romania", "Spain");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /median rent/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    const note = screen.getByRole("row", { name: /median rent/i }).querySelector(".matrix__attr-note");
    expect(note).toHaveTextContent(/^no value for Romania$/);

    await userEvent.click(screen.getByRole("radio", { name: /^scores$/i }));

    expect(note).toHaveTextContent(/^no value for Romania$/);
  });

  /** PL-101. Words where nothing can be shown; a dash only where a gap would be. */
  it("reads No value where a figure is missing, and no gap beside it", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(missingFigureComparison()),
      ),
    );
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    const row = screen.getByRole("row", { name: /cost of living index/i });
    // The focus has its figure; the comparator, which the server gave no value, reads absent.
    expect(row).toHaveTextContent("92.1 EU27 = 100");
    const [, , netherlands] = within(row).getAllByRole("cell");
    expect(netherlands?.querySelector(".matrix__score")).toHaveTextContent(/^No value$/);
    expect(netherlands?.querySelector(".matrix__delta")).toHaveTextContent(/^—$/);
    // No comparator has a raw gap, so the note promises none.
    expect(row.querySelector(".matrix__attr-note")).toHaveTextContent(
      /^in EU27 = 100, as published$/,
    );
  });

  /**
   * UI-19. The server's raw delta is comparator minus focus, and it is printed as the server
   * sent it -- so the row has to say which way round it reads.
   */
  it("says which way a raw gap is measured", async () => {
    serveFigures("country.spain", "Spain");
    renderShell("/compare");
    await compare("Portugal", "Spain");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    expect(
      screen.getByRole("row", { name: /cost of living index/i }).querySelector(".matrix__attr-note"),
    ).toHaveTextContent(/^in EU27 = 100, as published; gaps read comparator minus focus$/);
  });

  /**
   * UI-19. **A higher figure is not a better one.** The Netherlands' cost of living is 13.4
   * above Portugal's, so the server's raw gap, comparator minus focus, is positive -- and the
   * Netherlands scores lower for it, so it is behind. Coloured by the figure's sign, it would be
   * drawn ahead.
   */
  it("colours a raw gap by which side scored better, not by which figure is higher", async () => {
    serveFigures("country.netherlands", "Netherlands");
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    const row = screen.getByRole("row", { name: /cost of living index/i });
    // The server's number, unchanged, and coloured as the comparator trailing the focus.
    expect(within(row).getByText("+13.4")).toHaveClass("matrix__delta--behind");
  });
});

describe("when a comparison cannot be drawn", () => {
  /**
   * PL-005. **A comparison is a difference between two scores**, so with no top of the score
   * range there is nothing to compare -- said at once, from the settings, rather than after a
   * reader has picked a focus and comparators the server was always going to refuse.
   */
  it("says Nothing to compare before anything is picked while the score range is unset", async () => {
    await replaceSettings({ ...SETTINGS, score_scale_max: null });
    renderShell("/compare");

    const compareScreen = within(screen.getByRole("region", { name: "Compare" }));
    expect(
      await compareScreen.findByRole("heading", { name: "Nothing to compare" }),
    ).toBeInTheDocument();
    expect(compareScreen.queryByRole("combobox", { name: /focus/i })).toBeNull();
    expect(compareScreen.queryByRole("button", { name: /^compare$/i })).toBeNull();
    expect(compareScreen.queryByRole("alert")).toBeNull();
  });

  it("says what to choose before anything is selected in the sidebar", async () => {
    mockServer.use(
      http.get(`${BASE}/criteria-sets`, () => HttpResponse.json({ items: [] })),
    );
    renderShell("/compare");

    expect(
      await screen.findByText(/choose a criteria set and a level to compare/i),
    ).toBeInTheDocument();
  });

  /** PL-019: the shipped state, said before anything is picked -- never a code or a key. */
  it("shows the unset limit as a calm card before a pick, with the way to it", async () => {
    mockServer.use(
      http.get(`${BASE}/settings`, () =>
        HttpResponse.json({
          min_coverage: 60,
          score_scale_max: 100,
          comparator_limit: null,
        }),
      ),
    );
    renderShell("/compare");

    const unset = within(await screen.findByRole("region", { name: "Nothing to compare" }));
    expect(unset.getByText(/most candidates a comparison may hold/i)).toBeInTheDocument();
    expect(unset.getByRole("link", { name: /set it in configure/i })).toHaveAttribute(
      "href",
      "/configure",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body).not.toHaveTextContent(/comparator_limit/);
  });

  /**
   * NEW-26. **The refusal names the way out.** The server refuses an unset limit with
   * `comparator_limit_not_set`, and only `invalid_comparison` -- the code the mock used to
   * answer in its place -- led to the setting that lifts it.
   */
  it("offers to set an unset comparator limit in Configure", async () => {
    const refusal = await compareWithNoLimit();

    expect(
      within(refusal).getByRole("link", { name: "Set it in Configure" }),
    ).toHaveAttribute("href", "/configure");
  });

  it("opens Configure when that way out is followed", async () => {
    const refusal = await compareWithNoLimit();

    await userEvent.click(
      within(refusal).getByRole("link", { name: "Set it in Configure" }),
    );

    expect(
      await screen.findByRole("region", { name: "Configure" }),
    ).toBeInTheDocument();
  });

  it("offers no way to Configure for a failure no setting lifts", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "the comparison broke" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const failure = await screen.findByRole("alert");
    expect(within(failure).queryByRole("link")).toBeNull();
    expect(
      within(failure).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("lets a comparator be taken off again", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    const netherlands = await screen.findByRole("checkbox", {
      name: "Netherlands",
    });

    await userEvent.click(netherlands);
    await userEvent.click(netherlands);

    expect(netherlands).not.toBeChecked();
    expect(screen.getByText("Choose up to 5 to compare with Portugal.")).toBeInTheDocument();
  });

  /** PL-101. Words where nothing can be shown; a dash only in a gap's place. */
  it("reads No score and No comparable score where a comparator has no score at all", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json({
          criteria_set: "default",
          level: "country",
          score_scale_max: 100,
          focus: {
            candidate: "country.portugal",
            name: "Portugal",
            score: 78,
            coverage: 92,
            match_status: "matching",
            pillar_scores: [
              { pillar: "economics", score: 81, weight: 25, contribution: 20.25 },
            ],
          },
          comparators: [
            {
              candidate: "country.netherlands",
              name: "Netherlands",
              score: null,
              coverage: 0,
              match_status: "insufficient_data",
            },
          ],
          attributes: [],
          synthesis: [
            {
              comparator: "country.netherlands",
              score_delta: null,
              advantages: [],
              disadvantages: [],
              // No total, so no line; economics, which only Portugal scored, cannot be compared.
              ahead: [],
              behind: [],
              not_comparable: ["economics"],
            },
          ],
        }),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const table = await screen.findByRole("table", { name: /every pillar/i });
    const total = within(table).getByRole("row", { name: /total score/i });
    const netherlands = within(total).getAllByRole("cell")[2];
    expect(netherlands?.querySelector(".matrix__score")).toHaveTextContent(/^No score$/);
    expect(netherlands?.querySelector(".matrix__delta")).toHaveTextContent(/^—$/);
    const card = await cardOf("Netherlands");
    expect(within(card).getByText("No comparable score")).toBeInTheDocument();
    expect(card).toHaveTextContent("Not comparable, no data: Economy");
  });
});

/**
 * UX review L. The limit was enforced only when adding, so lowering it left a selection above
 * it in place -- and `/comparisons` answers 409 above the limit, so that was a request this
 * application could never make.
 */
/** The settings the mock serves, with this comparator limit. */
function serveLimit(limit: number) {
  mockServer.use(
    http.get(`${BASE}/settings`, () => HttpResponse.json({ ...SETTINGS, comparator_limit: limit })),
  );
}

describe("the comparator ceiling", () => {
  it("holds the other chips at the limit, says why, and ignores a click (PL-092)", async () => {
    serveLimit(1);
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));

    const netherlands = screen.getByRole("checkbox", { name: "Netherlands" });
    expect(netherlands).toHaveAttribute("aria-disabled", "true");
    expect(netherlands).toHaveAccessibleDescription(
      "Limit reached — remove one of the 1 first, or raise the limit in Configure",
    );
    expect(netherlands.closest("label")).toHaveAttribute(
      "title",
      "Limit reached — remove one of the 1 first, or raise the limit in Configure",
    );
    expect(screen.getByRole("checkbox", { name: "Spain" })).not.toHaveAttribute("aria-disabled");

    await userEvent.click(netherlands);

    expect(netherlands).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Spain" })).toBeChecked();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names who was taken out when the limit was lowered, and never brings them back", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Netherlands" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Estonia" }));

    await openTab("Configure");
    await screen.findByRole("heading", { level: 1, name: "Configure" });
    await replaceSettings({ ...SETTINGS, comparator_limit: 1 });
    await openTab("Compare");

    expect(
      await screen.findByText("The limit is now 1, so Spain and Netherlands were taken out."),
    ).toHaveAttribute("role", "status");
    expect(screen.getByRole("checkbox", { name: "Estonia" })).toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: "Estonia" }));

    expect(screen.getByRole("checkbox", { name: "Spain" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Netherlands" })).not.toBeChecked();
    expect(screen.queryByText(/were taken out/)).toBeNull();
  });

  it("counts what is chosen (PL-106)", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));

    expect(
      screen.getByText("Up to 5 comparators, the limit set in Configure. 1 chosen."),
    ).toBeInTheDocument();
  });

  it("says nothing while the selection is inside the limit", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/** A focus with two pillars that both carry an attribute, for the one-open-at-a-time rule. */
function twoPillarComparison() {
  return {
    criteria_set: "default",
    level: "country",
    score_scale_max: 100,
    focus: {
      candidate: "country.portugal",
      name: "Portugal",
      score: 78,
      coverage: 92,
      match_status: "matching",
      pillar_scores: [
        { pillar: "economics", score: 81, weight: 25, contribution: 20.25 },
        { pillar: "housing", score: 60, weight: 20, contribution: 12 },
      ],
    },
    comparators: [
      {
        candidate: "country.netherlands",
        name: "Netherlands",
        score: 71,
        coverage: 88,
        match_status: "matching",
        pillar_scores: [
          { pillar: "economics", score: 74, weight: 25, contribution: 18.5 },
          { pillar: "housing", score: 70, weight: 20, contribution: 14 },
        ],
      },
    ],
    attributes: [
      {
        attribute: "country.cost_of_living_index",
        pillar: "economics",
        effective_weight: 12.5,
        focus: { normalised_score: 82 },
        comparators: [
          { candidate: "country.netherlands", normalised_score: 41, delta: -13.4 },
        ],
      },
      {
        attribute: "country.rent_to_income",
        pillar: "housing",
        effective_weight: 10,
        focus: { normalised_score: 55 },
        comparators: [
          { candidate: "country.netherlands", normalised_score: 62, delta: 3.1 },
        ],
      },
    ],
    synthesis: [],
  };
}

/**
 * A comparison whose one attribute has a figure on both sides, for the raw view: the mock's own
 * comparators hold no stored figure, as `STORED_VALUES` says, so the raw gap is drawn here.
 */
function serveFigures(candidate: string, name: string) {
  const figure = (magnitude: number) => ({
    data_source: "eurostat",
    payload: { magnitude, unit: "index_eu27_100" },
    retrieval_date: "2026-09-11T08:00:00Z",
  });
  const drawn = missingFigureComparison();
  const comparison = {
    ...drawn,
    comparators: drawn.comparators.map((each) => ({ ...each, candidate, name })),
    attributes: drawn.attributes.map((row) => ({
      ...row,
      comparators: [{ candidate, normalised_score: 41, delta: 13.4, value: figure(105.5) }],
    })),
  };
  mockServer.use(http.get(`${BASE}/comparisons`, () => HttpResponse.json(comparison)));
}

/** A focus whose economics attribute has a figure the comparator does not. */
function missingFigureComparison() {
  return {
    criteria_set: "default",
    level: "country",
    score_scale_max: 100,
    focus: {
      candidate: "country.portugal",
      name: "Portugal",
      score: 78,
      coverage: 92,
      match_status: "matching",
      pillar_scores: [
        { pillar: "economics", score: 81, weight: 25, contribution: 20.25 },
      ],
    },
    comparators: [
      {
        candidate: "country.netherlands",
        name: "Netherlands",
        score: 71,
        coverage: 88,
        match_status: "matching",
        pillar_scores: [
          { pillar: "economics", score: 74, weight: 25, contribution: 18.5 },
        ],
      },
    ],
    attributes: [
      {
        attribute: "country.cost_of_living_index",
        pillar: "economics",
        effective_weight: 12.5,
        focus: {
          normalised_score: 82,
          value: {
            data_source: "numbeo",
            payload: { magnitude: 92.1, unit: "index_eu27_100" },
            retrieval_date: "2026-01-01",
          },
        },
        comparators: [
          {
            candidate: "country.netherlands",
            normalised_score: null,
            delta: null,
            // No `value`: a comparator with no figure must read as absent, not as a zero.
          },
        ],
      },
    ],
    synthesis: [],
  };
}

const MEDIAN_RENT: components["schemas"]["Attribute"] = {
  id: "country.median_rent",
  name: "Median rent",
  pillar: "economics",
  level: "country",
  value_type: "Monetary",
  unit: "currency_per_month",
  description: "A month's rent, in the country's own currency",
  manual_entry: false,
  max_age_months: 24,
  breakdown_scheme: null,
  breakdown_options: [],
  allowed_range: null,
  allowed_labels: [],
  effective_source_priority: ["eurostat"],
  answerable_by: ["eurostat"],
};

/** Romania's rent in lei: 2,500 RON, worth 500 EUR. */
const ROMANIAN_RENT = {
  normalised_score: 75,
  value: {
    data_source: "eurostat",
    payload: { amount: 2500, currency: "RON", amount_eur: 500 },
    retrieval_date: "2026-01-01",
  },
};

/**
 * Romania's rent in lei, Spain's in euros: the gap the server sends is in euros, Spain's 600
 * less Romania's 500.
 */
function rentComparison(focus: { normalised_score: number | null } = ROMANIAN_RENT) {
  return {
    criteria_set: "default",
    level: "country",
    score_scale_max: 100,
    focus: {
      candidate: "country.romania",
      name: "Romania",
      score: 74,
      coverage: 90,
      match_status: "matching",
      pillar_scores: [{ pillar: "economics", score: 80, weight: 25, contribution: 20 }],
    },
    comparators: [
      {
        candidate: "country.spain",
        name: "Spain",
        score: 70,
        coverage: 90,
        match_status: "matching",
        pillar_scores: [{ pillar: "economics", score: 60, weight: 25, contribution: 15 }],
      },
    ],
    attributes: [
      {
        attribute: "country.median_rent",
        pillar: "economics",
        // Zero where the focus was not scored on it, as the server sends it.
        effective_weight: focus.normalised_score === null ? 0 : 12.5,
        focus,
        comparators: [
          {
            candidate: "country.spain",
            normalised_score: 40,
            delta: 100,
            value: {
              data_source: "eurostat",
              payload: { amount: 600, currency: "EUR", amount_eur: 600 },
              retrieval_date: "2026-01-01",
            },
          },
        ],
      },
    ],
    synthesis: [],
  };
}

/**
 * PL-093 (UF-126). **A gap is printed as precisely as the figures it is between.** An impact is
 * a pillar's share of the total, often under a point, and rounding it whole printed a real gap
 * as "+0" beside a coloured bar; a raw gap rounded to one decimal did the same to figures read
 * to two.
 */
describe("a small gap", () => {
  function smallGapComparison() {
    const index = (magnitude: number) => ({
      data_source: "eurostat",
      payload: { magnitude, unit: "index_eu27_100" },
      retrieval_date: "2026-01-01",
    });
    return {
      criteria_set: "default",
      level: "country",
      score_scale_max: 100,
      focus: {
        candidate: "country.romania",
        name: "Romania",
        score: 74,
        coverage: 90,
        match_status: "matching",
        pillar_scores: [{ pillar: "economics", score: 81, weight: 25, contribution: 20.25 }],
      },
      comparators: [
        {
          candidate: "country.spain",
          name: "Spain",
          score: 74,
          coverage: 90,
          match_status: "matching",
          pillar_scores: [{ pillar: "economics", score: 80, weight: 25, contribution: 20 }],
        },
      ],
      attributes: [
        {
          attribute: "country.cost_of_living_index",
          pillar: "economics",
          effective_weight: 12.5,
          focus: { normalised_score: 82, value: index(92.12) },
          comparators: [
            {
              candidate: "country.spain",
              normalised_score: 81,
              delta: 0.03,
              value: index(92.15),
            },
          ],
        },
      ],
      synthesis: [],
    };
  }

  async function compareTheSmallGap() {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () => HttpResponse.json(smallGapComparison())),
    );
    renderShell("/compare");
    await compare("Romania", "Spain");
  }

  it("reads an impact and its gap to one decimal", async () => {
    await compareTheSmallGap();
    await userEvent.click(await screen.findByRole("radio", { name: /weighted impact/i }));

    const row = await screen.findByRole("row", { name: /economy/i });
    expect(row).toHaveTextContent("20.3");
    expect(row).toHaveTextContent("20.0");
    expect(within(row).getByText("\u22120.3")).toBeInTheDocument();
  });

  it("keeps scores and their gaps whole in points", async () => {
    await compareTheSmallGap();

    const row = await screen.findByRole("row", { name: /economy/i });
    expect(within(row).getByText("\u22121")).toBeInTheDocument();
  });

  it("reads a raw gap to the figures' own precision", async () => {
    await compareTheSmallGap();
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living/i });
    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    const row = screen.getByRole("row", { name: /cost of living/i });
    expect(within(row).getByText("+0.03")).toBeInTheDocument();
  });
});

/** The Compare screen's own region. */
function compareRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Compare" });
}

describe("PL-010: a comparison asked for again", () => {
  /** Answers the first comparison at once and holds every later one until `release`. */
  function holdLaterComparisons(): { release: (answer?: Response) => void } {
    let answered = 0;
    let release: (answer?: Response) => void = () => {};
    const held = new Promise<Response | undefined>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get(`${BASE}/comparisons`, async () => {
        answered += 1;
        return answered > 1 ? held : undefined;
      }),
    );
    return { release };
  }

  /** A run the shell sees running, which `end()` completes; its end reads Compare again. */
  function aRunThatEnds(): { end: () => void } {
    let status = "running";
    const watched = { id: 8, triggered_by: "user", started_at: "2026-09-21T09:00:00Z", cost_eur: 0 };
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({ items: [{ ...watched, run_status: status }], total: 1 }),
      ),
      http.get(`${BASE}/data-acquisition-runs/:runId`, () =>
        HttpResponse.json({
          ...watched,
          run_status: status,
          progress: { items_total: 96, items_completed: 24 },
          failures: [],
        }),
      ),
    );
    return { end: () => (status = "completed") };
  }

  /**
   * No button any more (PL-094): the same comparison is read again when an acquisition ends.
   * Its table stays, marked busy; a read that fails keeps it, marked could not be refreshed,
   * and Try again reads it again.
   */
  it("keeps the table while the same comparison is read again, and through a failed read", async () => {
    const run = aRunThatEnds();
    const later = holdLaterComparisons();
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    const table = await screen.findByRole("table", { name: /every pillar/i });
    await screen.findByRole("region", { name: /acquisition in progress/i });

    run.end();

    await waitFor(
      () => expect(table.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true"),
      { timeout: 8_000 },
    );
    expect(table).toBeInTheDocument();
    later.release(serverFault());

    const region = within(compareRegion());
    expect(await region.findByText(/comparison could not be refreshed/i)).toBeInTheDocument();
    expect(region.getByRole("table", { name: /every pillar/i })).toBeInTheDocument();

    mockServer.resetHandlers();
    await userEvent.click(region.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(region.queryByText(/could not be refreshed/i)).toBeNull());
    expect(region.getByRole("table", { name: /every pillar/i })).toBeInTheDocument();
  });
});

/**
 * A server that answered and failed. **Not a network error**: a server that did not answer is
 * said once by the shell's card and read again by itself (PL-002), which is another test.
 */
function serverFault(): Response {
  return HttpResponse.json({ code: "internal_error", message: "The server failed." }, { status: 500 });
}

describe("Try again reads what failed", () => {
  it("reads the comparison again after it failed", async () => {
    mockServer.use(http.get(`${BASE}/comparisons`, () => serverFault()));
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    const failure = await within(compareRegion()).findByRole("alert");

    mockServer.resetHandlers();
    await userEvent.click(within(failure).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: /every pillar/i })).toBeInTheDocument();
  });

  it.each([
    ["the roster", `${BASE}/candidates`],
    ["the settings", `${BASE}/settings`],
  ])("reads %s again after it failed, and draws the picker", async (_what, path) => {
    mockServer.use(http.get(path, () => serverFault()));
    renderShell("/compare");
    const region = within(compareRegion());
    await region.findByText(/could not be loaded/i);

    mockServer.resetHandlers();
    await userEvent.click(region.getByRole("button", { name: "Try again" }));

    expect(await region.findByRole("option", { name: "Portugal" })).toBeInTheDocument();
    expect(region.getByText(/up to 5 comparators/i)).toBeInTheDocument();
  });
});

describe("focus when a refusal takes the pressed control away", () => {
  it("moves to Nothing to compare when the comparison a tick asked for is refused for an unset range", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await screen.findByRole("checkbox", { name: "Netherlands" });
    await replaceSettings({ ...SETTINGS, score_scale_max: null });

    // No button (PL-094): the tick asks, and the refusal replaces the chip it was made on.
    await userEvent.click(screen.getByRole("checkbox", { name: "Netherlands" }));

    const card = await screen.findByRole("region", { name: "Nothing to compare" });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toContainElement(card);
  });

  it("takes no focus when the range was unset before anything was pressed", async () => {
    await replaceSettings({ ...SETTINGS, score_scale_max: null });
    renderShell("/compare");

    await screen.findByRole("region", { name: "Nothing to compare" });
    await act(() => delay(50));
    expect(document.activeElement).toBe(document.body);
  });
});
