import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { replaceSettings } from "../../api/endpoints";
import type { components } from "../../api/schema";
import { ATTRIBUTES, SETTINGS } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
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
  await userEvent.selectOptions(await screen.findByLabelText(/focus/i), option);
}

async function compare(focus: string, comparator: string) {
  await chooseFocus(focus);
  await userEvent.click(
    await screen.findByRole("checkbox", { name: comparator }),
  );
  await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));
}

/** Compare with no comparator limit set, as a fresh installation has, and return the refusal. */
async function compareWithNoLimit(): Promise<HTMLElement> {
  await replaceSettings({ ...SETTINGS, comparator_limit: null });
  renderShell("/compare");
  await compare("Portugal", "Netherlands");
  return screen.findByRole("alert");
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

/** Open a pillar row to reveal the attributes beneath it. The pillar name is the button. */
async function openPillar(name: string) {
  await userEvent.click(await screen.findByRole("button", { name }));
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
    expect(await screen.findByRole("button", { name: /^compare$/i })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));

    // The real assertion: the request the screen builds is one the server accepts.
    expect(
      await screen.findByRole("table", { name: /pillar/i }),
    ).toBeInTheDocument();
  });

  it("asks for nothing until a focus and a comparator are chosen", async () => {
    renderShell("/compare");

    expect(
      await screen.findByRole("button", { name: /^compare$/i }),
    ).toBeDisabled();
  });

  /**
   * UI-25. The placeholder's value is the empty string, which was kept as the focus: the button
   * was disabled only for `null` and the click submitted only for a truthy focus, so Compare
   * stood enabled and clicking it did nothing.
   */
  it("disables Compare again when the focus is cleared", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));
    expect(screen.getByRole("button", { name: /^compare$/i })).toBeEnabled();

    await userEvent.selectOptions(screen.getByLabelText(/focus/i), "");

    expect(screen.getByRole("button", { name: /^compare$/i })).toBeDisabled();
  });

  it("compares again once a focus is chosen again, keeping the ticked comparators", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));
    await userEvent.selectOptions(screen.getByLabelText(/focus/i), "");

    await chooseFocus("Netherlands");

    expect(screen.getByRole("checkbox", { name: "Spain" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));
    expect(
      await screen.findByRole("heading", { name: /netherlands against spain/i }),
    ).toBeInTheDocument();
  });
});

describe("when the level changes underneath", () => {
  it("clears the focus, the comparators and the comparison", async () => {
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

    expect(await screen.findByLabelText(/focus/i)).toHaveValue("");
    expect(
      screen.queryByRole("table", { name: /every pillar/i }),
    ).toBeNull();
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

  it("tags no line when the criteria set cannot be read", async () => {
    mockServer.use(
      http.get(`${BASE}/criteria-sets/:id`, () =>
        HttpResponse.json({ code: "internal_error", message: "broke" }, { status: 500 }),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const card = await cardOf("Netherlands");
    expect(linesUnder(card, "Behind on")).toEqual(["Economy\u22121.8"]);
    expect(screen.queryByText(/priority/)).toBeNull();
  });

  it("reports a refusal from the server rather than showing an empty table", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(
          {
            code: "invalid_comparison",
            message: "3 comparators is more than the limit of 2",
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /more than the limit/i,
    );
  });

  /**
   * NEW-05. **The mock refuses as the server refuses.** An unset limit is a refusal of its own,
   * `comparator_limit_not_set`, raised before the comparators are counted at all; the mock
   * answered `invalid_comparison`, a code the server keeps for a request built wrong.
   */
  it("names an unset comparator limit as the reason a comparison is refused", async () => {
    expect(await compareWithNoLimit()).toHaveTextContent(
      "comparator_limit_not_set",
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
  it("shows the pillar's attributes only once it is opened", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");
    await screen.findByRole("button", { name: "Economy" });

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

    await openPillar("Economy");

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

describe("the attribute figures inside a pillar", () => {
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

  it("says there is no figure where the focus has neither a figure nor a score", async () => {
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

    expect(screen.getByRole("row", { name: /median rent/i })).toHaveTextContent("no figure");
  });

  it("says nothing rather than zero where a figure is missing", async () => {
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
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
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
      screen.getByRole("row", { name: /cost of living index/i }),
    ).toHaveTextContent("its own unit; gaps read comparator minus focus");
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
  it("says what to choose before anything is selected in the sidebar", async () => {
    mockServer.use(
      http.get(`${BASE}/criteria-sets`, () => HttpResponse.json({ items: [] })),
    );
    renderShell("/compare");

    expect(
      await screen.findByText(/choose a criteria set and a level to compare/i),
    ).toBeInTheDocument();
  });

  it("says so when no comparator limit is configured", async () => {
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

    expect(
      await screen.findByText(/no comparator limit is configured/i),
    ).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /^compare$/i })).toBeDisabled();
  });

  it("shows a dash where a comparator has no score at all", async () => {
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
    expect(within(total).getAllByText("—").length).toBeGreaterThan(0);
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
describe("the comparator ceiling", () => {
  it("trims the selection to the newest when the limit is below it", async () => {
    mockServer.use(
      http.get(`${BASE}/settings`, () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: 60,
          comparator_limit: 1,
          run_spend_cap_eur: 5,
        }),
      ),
    );
    renderShell("/compare");
    await chooseFocus("Portugal");

    await userEvent.click(await screen.findByRole("checkbox", { name: "Spain" }));
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Netherlands" }),
    );

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/comparator limit is lower/i);
    // The newest is kept: the last click is the one being thought about.
    expect(screen.getByRole("checkbox", { name: "Netherlands" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Spain" })).not.toBeChecked();
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
