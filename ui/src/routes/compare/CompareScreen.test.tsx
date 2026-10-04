import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
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
    // it, so the heading reads as a place and the number reads as a number.
    const card = (await screen.findByRole("heading", { name: "Netherlands" }))
      .closest("section")!;
    expect(within(card).getByText("+7.0")).toBeInTheDocument();
  });

  it("prints the synthesis the server templated, in its order", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const advantages = await screen.findByText(/ahead on/i);
    const lines = within(advantages.parentElement!).getAllByRole("listitem");
    // The sentence is its own element inside the line, because a line may also carry the
    // place its gap takes across both lists. Matched whole and in place, so a screen that
    // reworded a sentence or reordered the list still fails.
    const sentences = [
      "Cost of living: 82 against 41, worth +4.9 points",
      "Coastline access: 70 against 64, worth +0.2 points",
    ];
    expect(lines).toHaveLength(sentences.length);
    sentences.forEach((sentence, at) => {
      expect(within(lines[at]!).getByText(sentence)).toBeInTheDocument();
    });
  });

  /**
   * The two lists arrive ordered separately, so neither says whether the largest disadvantage
   * outweighs the second advantage. These tags are the only thing the screen adds to the
   * synthesis, and they add no number: the fixture's own figures put the disadvantage worth
   * -1.8 above the advantage worth +0.2.
   */
  it("marks the three gaps that move the total most, across both lists", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const advantages = await screen.findByText(/ahead on/i);
    const ahead = within(advantages.parentElement!).getAllByRole("listitem");
    expect(ahead[0]).toHaveTextContent("#1");
    expect(ahead[1]).toHaveTextContent("#3");

    const disadvantages = screen.getByText(/behind on/i);
    const behind = within(disadvantages.parentElement!).getAllByRole("listitem");
    expect(behind[0]).toHaveTextContent("#2");
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
});

describe("the pillar matrix", () => {
  it("names the heaviest pillars as priorities, by weight", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    // Economics carries the most weight in the fixture (25%), so its row is marked first.
    const economy = (await screen.findByRole("button", { name: "Economy" })).closest("tr")!;
    expect(economy).toHaveTextContent("#1 priority");
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
    expect(within(row).getByText("82")).toBeInTheDocument();
    expect(within(row).getByText("41")).toBeInTheDocument();
  });

  it("leaves a pillar with no attributes as plain text, not a control", async () => {
    renderShell("/compare");
    await compare("Portugal", "Netherlands");

    // Safety is a pillar the focus was scored on, but the fixture gives it no attributes, so
    // there is nothing to open and no button -- the name is there as a label only.
    expect(await screen.findByText("Safety")).toBeInTheDocument();
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

describe("the attribute figures inside a pillar", () => {
  it("shows scores until asked for figures", async () => {
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
    renderShell("/compare");
    await compare("Portugal", "Spain");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));

    const row = screen.getByRole("row", { name: /cost of living index/i });
    expect(row).toHaveTextContent("-13.4");
    expect(row).not.toHaveTextContent("points");
  });

  it("goes back to scores when asked", async () => {
    renderShell("/compare");
    await compare("Portugal", "Spain");
    await openPillar("Economy");
    await screen.findByRole("row", { name: /cost of living index/i });

    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));
    await userEvent.click(screen.getByRole("radio", { name: /score 0.*100/i }));

    const row = screen.getByRole("row", { name: /cost of living index/i });
    expect(row).toHaveTextContent("82");
    expect(row).not.toHaveTextContent("92.1");
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
    const card = screen
      .getByRole("heading", { name: "Netherlands" })
      .closest("section")!;
    expect(within(card).getAllByText("—").length).toBeGreaterThan(0);
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
        focus: { normalised_score: 82 },
        comparators: [
          { candidate: "country.netherlands", normalised_score: 41, delta: -13.4 },
        ],
      },
      {
        attribute: "country.rent_to_income",
        pillar: "housing",
        focus: { normalised_score: 55 },
        comparators: [
          { candidate: "country.netherlands", normalised_score: 62, delta: 3.1 },
        ],
      },
    ],
    synthesis: [],
  };
}

/** A focus whose economics attribute has a figure the comparator does not. */
function missingFigureComparison() {
  return {
    criteria_set: "default",
    level: "country",
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
