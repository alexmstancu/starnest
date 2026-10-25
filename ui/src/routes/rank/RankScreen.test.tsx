import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_SCORES,
  HOUSEHOLD,
  STORED_VALUES,
  makeCriteriaSetDetails,
  rankingFor,
} from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";
import { serveSourceNames } from "../../testing/sourceNames";

/**
 * The ranking table, tested against the three cases `reqs.md` makes rules about: a matching
 * candidate with a score, a **non-matching** candidate that keeps its score, and one with
 * **insufficient data** that must not show a number at all.
 *
 * Every assertion here is about a figure the mock served. There is no arithmetic in the
 * screen, so there is nothing else worth asserting.
 */

/**
 * Cells in document order: rank, score, coverage, low-confidence share, match status, reason,
 * and the button that opens the figures. The candidate's name is a rowheader, not a cell.
 */
async function rankingRow(name: string): Promise<HTMLElement> {
  // By name: an open drill-down puts more tables on the screen, and several can be open.
  const table = await screen.findByRole("table", { name: /ranked candidates/i });
  // **By its rowheader, not by the row's own name.** An open row is followed by a row
  // holding that candidate's evidence, whose heading names the candidate too -- so a query
  // by row name matches both, and which one it returns depends on whether the row happens
  // to be open.
  const heading = within(table)
    .getAllByRole("rowheader")
    .find((cell) => cell.textContent?.trim() === name);
  expect(heading, `no row for ${name}`).toBeDefined();
  return heading!.closest("tr")!;
}

/**
 * One cell of a candidate's row, found by its column heading.
 *
 * **Not by index.** These assertions counted cells until a column was inserted in the middle
 * and five tests failed for a reason none of them was about. A heading is what the column
 * means; its position is an accident of layout.
 */
async function cell(candidate: string, column: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table");
  const headings = within(table)
    .getAllByRole("columnheader")
    .map((heading) => heading.textContent?.trim() ?? "");
  const at = headings.indexOf(column);
  expect(
    at,
    `no column headed "${column}" in [${headings.join(", ")}]`,
  ).toBeGreaterThan(-1);

  const row = await rankingRow(candidate);
  // The candidate's own cell is a rowheader rather than a cell, so it is put back in place to
  // line the row up with its headings.
  const inOrder = [...row.querySelectorAll("th,td")] as HTMLElement[];
  const found = inOrder[at];
  expect(
    found,
    `row for ${candidate} has no cell under "${column}"`,
  ).toBeDefined();
  return found!;
}

/** Every candidate's ranked detail, scored as the test says (the rest as the mock serves it). */
function scoreAs(scores: readonly Record<string, unknown>[]): void {
  mockServer.use(
    http.get("/v1/rankings/candidates/:candidateId", ({ params, request }) => {
      const query = new URL(request.url).searchParams;
      const ranked = rankingFor(
        query.get("criteria_set") ?? "",
        query.get("level") ?? "",
      ).candidates.find((each) => each.candidate === params["candidateId"]);
      return HttpResponse.json({
        ...ranked,
        score_scale_max: 100,
        attribute_scores: scores,
      });
    }),
  );
}

/** A scored attribute the pass found no figure for, as the server reports one. */
function missingScore(row: { attribute: string; pillar: string; weight?: number }) {
  return {
    attribute: row.attribute,
    pillar: row.pillar,
    normalised_score: null,
    weight: row.weight ?? 10,
    effective_weight: 0,
    contribution: 0,
  };
}

const OUTLOOK = { attribute: "country.economic_outlook", pillar: "economics", weight: 5 };

/** The names the drill-down's rows can carry, as the catalog or the id made readable says. */
const ROW_NAMES = [
  "European air connectivity",
  "Cost of living index",
  "Economic outlook",
  "Total effective tax rate",
  "Average rent",
  "Homicide rate",
  "Broadband coverage",
];

/**
 * The attributes of a drill-down's rows, in order, each run of rows said once. A row header
 * runs its name and its provenance together, so the name is the known one it starts with.
 */
function attributesInOrder(table: HTMLElement): string[] {
  const names = within(table)
    .getAllByRole("rowheader")
    .map((header) => {
      const text = header.textContent ?? "";
      return ROW_NAMES.find((name) => text.startsWith(name)) ?? text;
    });
  return names.filter((name, at) => name !== names[at - 1]);
}

/** A candidate's name, which is the toggle a keyboard reaches for its row. */
async function toggleOf(name: string): Promise<HTMLElement> {
  return within(await rankingRow(name)).getByRole("button", { name });
}

/**
 * Portugal's bars, left to right as the fixture draws them: Economy and Safety scored, Family
 * hatched for want of a score. Found by what each says, because the name is a button too.
 */
async function portugalBars(): Promise<{
  economy: HTMLElement;
  safety: HTMLElement;
  family: HTMLElement;
}> {
  const row = await rankingRow("Portugal");
  const bar = (name: RegExp) => within(row).findByRole("button", { name });
  return {
    economy: await bar(/^Economy:/),
    safety: await bar(/^Safety:/),
    family: await bar(/^Family:/),
  };
}

/** Puts the keyboard on Portugal's name, the stop just before its chart. */
async function focusPortugal(): Promise<HTMLElement> {
  const toggle = await toggleOf("Portugal");
  act(() => toggle.focus());
  return toggle;
}

describe("the ranking table", () => {
  it("shows a row per candidate the API returned, in the order it returned them", async () => {
    renderShell("/rank");

    const table = await screen.findByRole("table");
    const names = within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);

    expect(names).toEqual(["Portugal", "Netherlands", "Spain", "Estonia"]);
  });

  it("shows the score, coverage and match status the API computed", async () => {
    renderShell("/rank");

    expect(await cell("Portugal", "Rank")).toHaveTextContent("1");
    expect(await cell("Portugal", "Score")).toHaveTextContent("78");
    expect(await cell("Portugal", "Coverage")).toHaveTextContent("92.4%");
    expect(await cell("Portugal", "Match status")).toHaveTextContent(
      "Matching",
    );
  });

  it("names the criteria set and level the ranking was computed under", async () => {
    renderShell("/rank");

    const rank = within(await screen.findByRole("region", { name: "Rank" }));
    expect(
      (await rank.findByText("Criteria set")).nextSibling,
    ).toHaveTextContent(/^Default$/);
    // Capitalised: the catalog ships ids, and a reader is shown a name.
    expect(rank.getByText("Level").nextSibling).toHaveTextContent("Country");
    expect(rank.getByText("Computed").nextSibling).toHaveTextContent(
      "30 Aug 2026, 12:15",
    );
  });
});

/**
 * PL-070. **The set by the name the list gives it, never its id**, and a rename made on
 * Configure is what Rank says next.
 */
describe("the criteria set in the header", () => {
  it("names the set as the list does, and follows a rename", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    const row = async () =>
      within(await screen.findByRole("listitem", { name: "Default" }));
    await user.click((await row()).getByRole("button", { name: "Rename" }));
    const draft = (await row()).getByRole("textbox", { name: /new name for Default/i });
    await user.clear(draft);
    await user.type(draft, "Everyday life");
    await user.click((await row()).getByRole("button", { name: "Save" }));
    await screen.findByRole("listitem", { name: "Everyday life" });

    await user.click(screen.getByRole("link", { name: /^Rank/ }));

    const rank = within(await screen.findByRole("region", { name: "Rank" }));
    await waitFor(() =>
      expect(rank.getByText("Criteria set").nextSibling).toHaveTextContent(
        /^Everyday life$/,
      ),
    );
  });

  /** A set the list does not hold reads as its id in words, never the raw id. */
  it("reads a set the list does not hold as its id in words", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json(rankingFor("local_employment", "country")),
      ),
    );
    renderShell("/rank");

    const rank = within(await screen.findByRole("region", { name: "Rank" }));
    expect(
      (await rank.findByText("Criteria set")).nextSibling,
    ).toHaveTextContent(/^Local employment$/);
  });
});

describe("the row the household lives in", () => {
  /**
   * Home is the row every delta on the screen is measured against, and nothing said which row
   * it was -- the dash in its own delta cell only makes sense once you already know.
   */
  it("marks the home country beside its name", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json({ ...HOUSEHOLD, home_country_candidate: "country.portugal" }),
      ),
    );
    renderShell("/rank");

    const pill = await screen.findByText("home");

    expect(pill.closest("tr")).toHaveTextContent("Portugal");
  });

  /** PL-081. Home is the row every difference is measured from, and says so. */
  it("reads baseline in home's own Δ home cell", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json({ ...HOUSEHOLD, home_country_candidate: "country.portugal" }),
      ),
    );
    renderShell("/rank");

    const homeRow = (await screen.findByText("home")).closest("tr")!;
    const at = within(screen.getByRole("table", { name: /ranked candidates/i }))
      .getAllByRole("columnheader")
      .findIndex((heading) => heading.textContent?.trim() === "Δ home");
    expect(homeRow.querySelectorAll("th,td")[at]).toHaveTextContent(/^baseline$/);
    expect(await cell("Spain", "Δ home")).not.toHaveTextContent("baseline");
  });

  /** PL-081. A column of nothing but dashes says why, once. */
  it("says why no row has a difference when home is not ranked here", async () => {
    renderShell("/rank");

    expect(
      await screen.findByText(/your home is not among the candidates ranked here/i),
    ).toBeInTheDocument();
  });

  it("says no home is recorded only on the server's not-configured answer", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json(
          { code: "household_not_configured", message: "No household has been recorded." },
          { status: 404 },
        ),
      ),
    );
    renderShell("/rank");

    expect(await screen.findByText(/no home country is recorded/i)).toBeInTheDocument();
  });

  /** A failed read says nothing about whether a home was recorded, so the note says nothing. */
  it("says nothing about the column when the household could not be read", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json(
          { code: "internal_error", message: "the household could not be read" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/rank");

    await screen.findByRole("table", { name: /ranked candidates/i });
    expect(screen.queryByText(/nothing to measure/i)).toBeNull();
  });

  /** The shipped household lives outside the roster, and an unmarked table is the right answer. */
  it("marks nothing when no ranked candidate is home", async () => {
    renderShell("/rank");

    await screen.findByRole("table", { name: /ranked candidates/i });
    expect(screen.queryByText("home")).toBeNull();
  });
});

/**
 * PL-079. **The two letters stand in for a flag, and the title says so in the design's own
 * words.** It used to repeat the name and the code the reader was already looking at, which
 * says nothing about why there is a code where a flag belongs.
 */
describe("the country chip", () => {
  it("names the country and says a flag will replace the code", async () => {
    renderShell("/rank");

    const chip = await screen.findByTitle(
      "Portugal. A flag replaces this code once the catalog carries flag images",
    );

    expect(chip).toHaveTextContent(/^PT$/);
  });
});

describe("what the table cannot say inside itself", () => {
  it("explains the rows with no rank and the ones with no score", async () => {
    renderShell("/rank");

    await screen.findByRole("table", { name: /ranked candidates/i });

    expect(
      screen.getByText(/a candidate that does not match has no rank and keeps its score/i),
    ).toHaveTextContent("never a zero");
  });
});

describe("a candidate that does not match", () => {
  it("stays in the table, keeping the score it computed", async () => {
    renderShell("/rank");

    expect(await cell("Spain", "Score")).toHaveTextContent("64");
    expect(await cell("Spain", "Match status")).toHaveTextContent(
      "Not matching",
    );
  });

  it("shows why it does not match", async () => {
    renderShell("/rank");

    expect(await cell("Spain", "Why this status")).toHaveTextContent(
      "No visa route this household qualifies for.",
    );
  });

  it("has no rank, and says so rather than leaving the cell blank", async () => {
    renderShell("/rank");

    // The dash this screen prints wherever a number is genuinely absent. An empty cell reads
    // as a table that failed to render -- and the previous assertion here was
    // `toHaveTextContent("")`, which matches any content at all and so checked nothing.
    // The caret that says the row opens shares the cell and is not part of the reading.
    const rank = await cell("Spain", "Rank");
    expect(rank.textContent?.replace(/[\u25B8\u25BE]/g, "")).toBe("—");
  });
});

describe("a candidate with insufficient data", () => {
  it("shows no number where a score would be", async () => {
    renderShell("/rank");

    const score = await cell("Estonia", "Score");

    expect(score).toHaveTextContent("No score");
    expect(score.textContent).not.toMatch(/\d/);
  });

  it("still shows its coverage, which is what explains the status", async () => {
    renderShell("/rank");

    expect(await cell("Estonia", "Coverage")).toHaveTextContent("41.0%");
    expect(await cell("Estonia", "Match status")).toHaveTextContent(
      "Insufficient data",
    );
  });
});

describe("when the ranking cannot be shown", () => {
  it("reports the failure with its code, and retries when asked", async () => {
    mockServer.use(http.get("/v1/rankings", () => HttpResponse.error()));
    renderShell("/rank");

    const rank = within(await screen.findByRole("region", { name: "Rank" }));
    const alert = await rank.findByRole("alert");
    expect(alert).toHaveTextContent("client.unreachable");

    mockServer.resetHandlers();
    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  /**
   * UX review R3, and the design's own treatment of it. `score_scale_max` is provisional by
   * design and has no default, so the shipped state refuses to rank -- and a fresh
   * installation meeting that as a red alert learns the product is broken on the day it was
   * installed. It is a state with a name, an explanation and the one button that lifts it:
   * not a fault, so **not an alert**, and not a "Try again" that would fail identically.
   */
  it("names the missing score range and offers the way to it", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json(
          {
            code: "score_scale_not_set",
            message: "score_scale_max is not set, so there is no scale to score onto.",
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/rank");

    const unset = within(
      await screen.findByRole("region", { name: "No ranking" }),
    );

    expect(
      unset.getByText(/a score has no meaning without a top of the range/i),
    ).toBeInTheDocument();
    expect(
      unset.getByRole("link", { name: /set it in configure/i }),
    ).toHaveAttribute("href", "/configure");
    expect(unset.queryByRole("button", { name: /try again/i })).toBeNull();

    // **Not an alert, and no code.** An expected state announced urgently, with a machine
    // identifier beside it, tells the reader something went wrong. Something did not.
    const rank = within(screen.getByRole("region", { name: "Rank" }));
    expect(rank.queryByRole("alert")).toBeNull();
    expect(rank.queryByText("score_scale_not_set")).toBeNull();
  });

  it("shows no ranking table at all while the score range is unset", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json(
          { code: "score_scale_not_set", message: "not set" },
          { status: 409 },
        ),
      ),
    );
    renderShell("/rank");

    await screen.findByRole("region", { name: "No ranking" });
    expect(
      screen.queryByRole("table", { name: /ranked candidates/i }),
    ).toBeNull();
  });

  it("says the ranking is empty rather than showing an empty table", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json({
          evaluation: null,
          criteria_set: "default",
          level: "country",
          computed_at: "2026-08-30T09:15:00Z",
          candidates: [],
        }),
      ),
    );
    renderShell("/rank");

    expect(
      await screen.findByText(/no candidate has been evaluated/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("asks for a selection rather than fetching a ranking of nothing", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets", () => HttpResponse.json({ items: [] })),
      http.get("/v1/levels", () => HttpResponse.json({ items: [] })),
    );
    renderShell("/rank");

    const rank = within(await screen.findByRole("region", { name: "Rank" }));
    await waitFor(() =>
      expect(
        rank.getByText(/choose a criteria set and a level/i),
      ).toBeInTheDocument(),
    );
    expect(rank.queryByText("Loading…")).not.toBeInTheDocument();
  });
});

describe("choosing a pillar, from either half", () => {
  /**
   * **The chart and the cards are one selection shown twice.** The chart lives in the ranking
   * row and the cards in the panel underneath, and a reader who clicks one expects the other
   * to agree -- so the chosen pillar is held on the open row, above both.
   *
   * **A browser found what these tests could not.** The chart marked itself chosen while the
   * panel carried on showing every value, because `CandidateRow` built the row object it hands
   * to `detail()` without the chosen pillar on it. Both halves rendered, both were "correct",
   * and they disagreed. Asserting one and not the other is what let that through.
   */
  it("filters the panel when a bar in the row is clicked", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    await userEvent.click(
      await within(row).findByRole("button", { name: /^Economy:/ }),
    );

    // The panel's own heading is the proof: it names the pillar it is filtered to.
    expect(
      await screen.findByRole("heading", { name: /economy — stored values/i }),
    ).toBeInTheDocument();
  });

  it("marks the bar in the row when a card in the panel is clicked", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    // Scoped to the panel: "Economy" names the bar in the row *and* the card below it, which
    // is exactly what this feature is about, so an unscoped query is ambiguous by design.
    const panel = await screen.findByRole("region", {
      name: /Portugal: every value/i,
    });
    await userEvent.click(
      within(panel).getByRole("button", { name: /^Economy\b/ }),
    );

    await waitFor(() =>
      expect(
        within(row).getByRole("button", { name: /^Economy:/ }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("clears both halves when the chosen pillar is chosen again", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));
    const bar = await within(row).findByRole("button", { name: /^Economy:/ });

    await userEvent.click(bar);
    await waitFor(() => expect(bar).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(bar);

    await waitFor(() => expect(bar).toHaveAttribute("aria-pressed", "false"));
    expect(
      await screen.findByRole("heading", { name: /every stored value/i }),
    ).toBeInTheDocument();
  });

  /**
   * Clicking a bar must not toggle the row shut: the row itself is the open/close target, so
   * the bar stops the click from reaching it.
   *
   * **This test is kept for its failure message, not for its coverage.** It detects exactly
   * one mutation -- the lost `stopPropagation` in `RankingTable`'s pillar bar -- and the two
   * tests above it detect that one too. What it adds is how it fails: a direct `expect` that
   * goes red in under half a second and names the row closing, where the others fail by a
   * five-second `waitFor` timeout on a heading that never arrives. In CI that is the
   * difference between reading the cause and going looking for it. Were the bar's handler
   * ever moved onto the row, this would be the test to delete rather than the one to fix.
   */
  it("leaves the row open when a bar inside it is clicked", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));
    await screen.findByRole("heading", { name: /every value behind the score/i });

    await userEvent.click(
      await within(row).findByRole("button", { name: /^Safety:/ }),
    );

    expect(
      screen.getByRole("heading", { name: /every value behind the score/i }),
    ).toBeInTheDocument();
  });
});

/**
 * PL-076 (UF-120). Every bar was its own tab stop, so crossing 32 rows took about 350 presses of
 * Tab. A chart is one stop now, as a toolbar is: Tab reaches it once and the arrow keys move
 * along it.
 */
describe("a row's pillar chart, from the keyboard", () => {
  it("is one tab stop, not one per bar", async () => {
    renderShell("/rank");
    const { economy } = await portugalBars();
    await focusPortugal();

    await userEvent.tab();
    expect(economy).toHaveFocus();

    await userEvent.tab();
    expect(await toggleOf("Netherlands")).toHaveFocus();
  });

  it("moves between its bars with the arrow keys", async () => {
    renderShell("/rank");
    const { economy, safety, family } = await portugalBars();
    await focusPortugal();
    await userEvent.tab();

    await userEvent.keyboard("{ArrowRight}");
    expect(safety).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(family).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(safety).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(economy).toHaveFocus();
  });

  /**
   * **The bar the keyboard is on is the chart's stop.** Leave the first bar as the stop while
   * the keyboard stands on the second, and Shift+Tab walks back into the chart rather than out
   * of it -- the browser looks for the stop before the focused bar, and finds the first one.
   */
  it("is left in one step from whichever bar the keyboard is on", async () => {
    renderShell("/rank");
    const { safety } = await portugalBars();
    const toggle = await focusPortugal();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(safety).toHaveFocus();

    await userEvent.tab({ shift: true });

    expect(toggle).toHaveFocus();
  });

  /** The chosen bar is the one marked, so it is the one Tab comes back to, as in a radio group. */
  it("is entered at the chosen pillar", async () => {
    renderShell("/rank");
    const { economy, safety } = await portugalBars();
    await focusPortugal();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    await waitFor(() => expect(safety).toHaveAttribute("aria-pressed", "true"));
    await userEvent.keyboard("{ArrowLeft}");
    expect(economy).toHaveFocus();

    await userEvent.tab({ shift: true });
    await userEvent.tab();

    expect(safety).toHaveFocus();
  });

  /**
   * The ranking card scrolls sideways, and an arrow that moves along the chart must not also
   * move the card. A key the chart does not use is left alone, so Down still scrolls.
   */
  it("claims the arrow keys it uses from the scrolling card, and no others", async () => {
    renderShell("/rank");
    const { economy } = await portugalBars();

    // `fireEvent` answers false when a handler prevented the browser's own action.
    expect(fireEvent.keyDown(economy, { key: "ArrowRight" })).toBe(false);
    expect(fireEvent.keyDown(economy, { key: "ArrowDown" })).toBe(true);
  });

  it("is announced as that candidate's pillars", async () => {
    renderShell("/rank");

    const chart = await screen.findByRole("toolbar", {
      name: "Pillar scores for Portugal",
    });

    expect(within(chart).getAllByRole("button")).toHaveLength(3);
  });
});

describe("the drill-down", () => {
  it("shows every stored value for a candidate, the superseded ones included", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const rows = within(table).getAllByRole("row").slice(1);
    // Four figures: two for the cost of living index, of which one is superseded, the tax
    // estimate, and the air connectivity count that no criterion scores -- and two rows naming
    // the scored attributes with no figure at all, rent and broadband (PL-068).
    expect(rows).toHaveLength(6);
    expect(within(table).getAllByText("No value")).toHaveLength(2);
    expect(within(table).getAllByText("Superseded")).toHaveLength(1);
    // **Scored twice, not three times** (UI-15): the air connectivity count is the figure in
    // use for its attribute, and no criterion scores it, so it is active and nothing more.
    await waitFor(() =>
      expect(within(table).getAllByText("Scored")).toHaveLength(2),
    );
    expect(within(table).getAllByText("Active")).toHaveLength(1);
  });

  it("shows each figure with its source, both dates and its confidence", async () => {
    serveSourceNames({
      eurostat_estimate: "Estimated from Eurostat tax-benefit figures",
    });
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(table).getByRole("row", {
      name: /total effective tax rate/i,
    });
    expect(estimate).toHaveTextContent("41.5");
    // RB-4: the source as the catalog names it -- a name its id could never be read into.
    await waitFor(() =>
      expect(estimate).toHaveTextContent(
        "Estimated from Eurostat tax-benefit figures",
      ),
    );
    expect(estimate).not.toHaveTextContent("eurostat_estimate");
    expect(estimate).toHaveTextContent("low");
  });

  /**
   * **The folding, as a reader meets it.** `repeatedValues.ts` is tested thoroughly and none
   * of it was rendered: deleting the whole "Fetched again" block from `CandidateDetail` left
   * every test in this folder green, so the feature could stop appearing and the only thing
   * that would notice is a person looking at the screen.
   *
   * An acquisition appends what it fetched without asking whether it changed, so one Eurostat
   * figure can sit in the store twenty-six times. The panel says that once, with a count, in
   * place of twenty-six identical rows -- and says what did not change rather than printing a
   * bare number beside a date.
   */
  it("says once that a figure was stored again, instead of repeating the row", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const connectivity = within(table).getByRole("row", {
      name: /european air connectivity/i,
    });
    expect(connectivity).toHaveTextContent("Fetched again");
    expect(connectivity).toHaveTextContent(
      "unchanged across 2 acquisitions, first on 11 Sept 2025",
    );
  });

  /**
   * **The other half of the same claim.** "Fetched again" on a figure stored once would be a
   * line about an event that did not happen, which is worse than no line -- and a test that
   * only asserts the sentence appears would pass with the `copies > 1` guard deleted.
   */
  it("says nothing about repeats for a figure stored only once", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(table).getByRole("row", {
      name: /total effective tax rate/i,
    });
    expect(estimate).not.toHaveTextContent("Fetched again");
    expect(estimate).not.toHaveTextContent(/unchanged across/);
  });

  /**
   * UX review M. Opening a second candidate used to close the first, so comparing what two
   * countries are scored on meant holding one of them in your head.
   */
  it("keeps a candidate's figures open when another candidate is opened", async () => {
    renderShell("/rank");

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );
    await screen.findByRole("heading", { name: /Portugal: every value/i });

    await userEvent.click(
      within(await rankingRow("Netherlands")).getByRole("button", { name: "Netherlands" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: /Netherlands: every value/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Portugal: every value/i }),
    ).toBeInTheDocument();
  });

  /** Each open panel must be announced as its own candidate, not as the first one opened. */
  it("labels each open panel with its own candidate", async () => {
    renderShell("/rank");

    for (const name of ["Portugal", "Netherlands"]) {
      await userEvent.click(
        within(await rankingRow(name)).getByRole("button", { name }),
      );
    }

    await screen.findByRole("region", { name: /Netherlands: every value/i });
    expect(
      screen.getByRole("region", { name: /Portugal: every value/i }),
    ).toBeInTheDocument();
  });

  it("closes one open candidate without closing the others", async () => {
    renderShell("/rank");

    for (const name of ["Portugal", "Netherlands"]) {
      await userEvent.click(
        within(await rankingRow(name)).getByRole("button", { name }),
      );
    }
    await screen.findByRole("heading", { name: /Netherlands: every value/i });

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /Portugal: every value/i }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("heading", { name: /Netherlands: every value/i }),
    ).toBeInTheDocument();
  });

  /**
   * PL-076 (UF-120). The name opens and closes the row, and a screen reader heard only "button"
   * -- nothing said which rows were open, and several can be.
   */
  it("says on each name whether its row is open", async () => {
    renderShell("/rank");
    expect(await toggleOf("Portugal")).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(await toggleOf("Portugal"));
    await userEvent.click(await toggleOf("Netherlands"));
    expect(await toggleOf("Portugal")).toHaveAttribute("aria-expanded", "true");
    expect(await toggleOf("Netherlands")).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(await toggleOf("Portugal"));
    expect(await toggleOf("Portugal")).toHaveAttribute("aria-expanded", "false");
    expect(await toggleOf("Netherlands")).toHaveAttribute("aria-expanded", "true");
  });

  /**
   * UX review N. `methodology_url` and `citations` were stored and never rendered, so "full
   * provenance on every displayed number" was true of the database and not of the screen.
   */
  it("links a publisher to how it says it reached its number", async () => {
    renderShell("/rank");
    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    // Named by the section it belongs to. The caption that used to name it said "Not part of
    // any score", which the heading above the table already says.
    const outside = await screen.findByRole("table", {
      name: /outside opinions/i,
    });
    expect(
      await within(outside).findByRole("link", { name: "Numbeo" }),
    ).toHaveAttribute(
      "href",
      "https://www.numbeo.com/crime/indices_explained.jsp",
    );
  });

  it("links a figure to the pages it was read from", async () => {
    renderShell("/rank");
    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    const figures = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(figures).getByRole("row", {
      name: /total effective tax rate/i,
    });
    expect(within(estimate).getByRole("link", { name: /source 1/i })).toHaveAttribute(
      "href",
      "https://ec.europa.eu/eurostat/tax-benefit",
    );
  });

  /** The reason the URL is parsed rather than passed straight into `href`. */
  it("refuses to link a citation whose scheme would run something", async () => {
    renderShell("/rank");
    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    const figures = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    const estimate = within(figures).getByRole("row", {
      name: /total effective tax rate/i,
    });
    expect(within(estimate).getAllByRole("link")).toHaveLength(1);
    expect(within(estimate).queryByRole("link", { name: /source 2/i })).toBeNull();
  });

  /**
   * The drill-down showed the figures a candidate has and said nothing about the ones it does
   * not, so a pillar scored from three attributes out of eight looked complete.
   */
  it("says how many of the set's attributes have no stored value", async () => {
    renderShell("/rank");

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    // The pass scores four attributes; the mock stores figures for two of them.
    expect(
      await screen.findByText(
        "2 of the 4 attributes this set scores have no value in use.",
      ),
    ).toBeInTheDocument();
  });

  it("says so plainly when nothing is missing, rather than tinting that too", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({
          items: ATTRIBUTE_SCORES.map(({ attribute }, at) => ({
            id: 700 + at,
            candidate: "country.portugal",
            attribute,
            value_type: "Count",
            payload: { count: at },
            data_source: "eurostat",
            reference_period: { start: "2025-01-01", end: "2025-12-31" },
            retrieval_date: "2026-09-11T08:00:00Z",
            confidence_level: "high",
            is_active: true,
            is_fresh: true,
            source_is_enabled: true,
          })),
          total: ATTRIBUTE_SCORES.length,
        }),
      ),
    );
    renderShell("/rank");

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    expect(
      await screen.findByText(
        "Every attribute this set scores has a value in use.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps outside opinions in their own table, not among the figures", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    // Named by the section it belongs to. The caption that used to name it said "Not part of
    // any score", which the heading above the table already says.
    const outside = await screen.findByRole("table", {
      name: /outside opinions/i,
    });
    // The header names the publisher first; its two dates stack under the name (UI-20).
    expect(
      await within(outside).findByRole("rowheader", { name: /^Numbeo/ }),
    ).toBeInTheDocument();
    const figures = screen.getByRole("table", { name: /every stored value/i });
    expect(within(figures).queryByText("Numbeo")).toBeNull();
  });

  it("closes again", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );
    await userEvent.click(
      within(row).getByRole("button", { name: "Portugal" }),
    );

    expect(
      screen.queryByRole("table", { name: /every stored value/i }),
    ).toBeNull();
  });

  it("closes when the level changes under it", async () => {
    // P53: `chosen` was component state nothing cleared, so the open provenance panel survived
    // a switch to `city` while the table beneath it reloaded with cities. With no row matching
    // it, no button read "Hide figures" -- a stale panel with no visible way to close it.
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );
    expect(
      await screen.findByRole("table", { name: /every stored value/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "City" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("table", { name: /every stored value/i }),
      ).toBeNull(),
    );
  });

  it("closes when the criteria set changes under it", async () => {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );
    expect(
      await screen.findByRole("table", { name: /every stored value/i }),
    ).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /active criteria set/i }),
      "remote-only",
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("table", { name: /every stored value/i }),
      ).toBeNull(),
    );
  });

  it("names every scored attribute when a candidate has no stored figures", async () => {
    scoreAs(ATTRIBUTE_SCORES.map(missingScore));
    renderShell("/rank");
    const row = await rankingRow("Estonia");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Estonia" }),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    expect(within(table).getAllByText("no value stored")).toHaveLength(
      ATTRIBUTE_SCORES.length,
    );
    expect(
      screen.getByText("Nothing this set scores has a value in use."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no outside index has been stored/i),
    ).toBeInTheDocument();
  });

  /**
   * UI-16. The panel asked for one page of 500 and kept it. Five hundred copies of one figure
   * fold into a single row, so the figure stored 501st was simply not there.
   */
  it("shows a figure stored after the first five hundred", async () => {
    const copies = Array.from({ length: 500 }, (_, at) => ({
      id: 5000 + at,
      candidate: "country.portugal",
      attribute: "country.cost_of_living_index",
      value_type: "Quantity",
      payload: { magnitude: 92.1, unit: "index_eu27_100" },
      data_source: "eurostat",
      reference_period: { start: "2025-01-01", end: "2025-12-31" },
      retrieval_date: "2026-09-11T08:00:00Z",
      confidence_level: "high",
      is_active: at === 499,
      citations: [],
    }));
    const theFiveHundredAndFirst = {
      ...copies[0]!,
      id: 6000,
      attribute: "country.total_tax_rate_effective",
      value_type: "Ratio",
      payload: { value: 41.5, basis: "labour_cost" },
      is_active: true,
    };
    const stored = [...copies, theFiveHundredAndFirst];
    mockServer.use(
      http.get("/v1/values", ({ request }) => {
        const query = new URL(request.url).searchParams;
        const offset = Number(query.get("offset") ?? 0);
        const limit = Number(query.get("limit") ?? stored.length);
        return HttpResponse.json({
          items: stored.slice(offset, offset + limit),
          total: stored.length,
        });
      }),
    );
    renderShell("/rank");

    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    expect(
      within(table).getByRole("row", { name: /total effective tax rate/i }),
    ).toHaveTextContent("41.5% of Labour cost");
    expect(
      within(table).getByRole("row", { name: /cost of living index/i }),
    ).toHaveTextContent("unchanged across 500 acquisitions");
  });
});

/** Opens Portugal's evidence and returns its outside-opinions table. */
async function portugalsOutsideOpinions(): Promise<HTMLElement> {
  renderShell("/rank");
  await userEvent.click(
    within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
  );
  return screen.findByRole("table", { name: /outside opinions/i });
}

/** Portugal's outside opinions, as the test chooses them. */
function outsideOpinions(...scores: Record<string, unknown>[]): void {
  mockServer.use(
    http.get("/v1/external-scores", () => HttpResponse.json({ items: scores })),
  );
}

const NUMBEO = {
  candidate: "country.portugal",
  data_source: "numbeo",
  published_value: 72.4,
  published_scale: "0-100, higher is safer",
  reference_period: { start: "2026-01-01", end: "2026-06-30" },
  retrieval_date: "2026-09-01T08:00:00Z",
};

/**
 * UI-20. **Full provenance on every displayed number**, and an outside opinion is a number. Its
 * two dates were served and went only into the row's key, so a reader could not tell a 2019
 * index from this year's.
 */
describe("an outside opinion's provenance", () => {
  /**
   * RB-4. **A publisher is a data source, named as the catalog names it.** The column printed
   * the source's id; `rsf` is one whose catalog name the id could never be read into.
   */
  it("names the publisher as the catalog does, never by its id", async () => {
    serveSourceNames({ rsf: "Reporters Without Borders" });
    outsideOpinions({
      ...NUMBEO,
      data_source: "rsf",
      published_scale: "0-100, higher is freer",
    });

    const outside = await portugalsOutsideOpinions();

    expect(
      await within(outside).findByRole("rowheader", {
        name: /^Reporters Without Borders/,
      }),
    ).toBeInTheDocument();
    expect(outside).not.toHaveTextContent(/\brsf\b/i);
  });

  it("dates each outside opinion: the period it describes and when it was fetched", async () => {
    const outside = await portugalsOutsideOpinions();

    const numbeo = within(outside).getByRole("row", { name: /numbeo/i });
    expect(numbeo).toHaveTextContent("Describes1 Jan 2026 to 30 Jun 2026");
    expect(numbeo).toHaveTextContent("Fetched1 Sept 2026, 11:00");
  });

  it("gives a publisher's rank out of how many it ranked", async () => {
    outsideOpinions({ ...NUMBEO, published_rank: 12, published_rank_of: 140 });

    const outside = await portugalsOutsideOpinions();

    expect(
      within(outside).getByRole("row", { name: /numbeo/i }),
    ).toHaveTextContent("72.4 (rank 12 of 140)");
  });

  it("gives a rank alone where the publisher did not say out of how many", async () => {
    outsideOpinions({ ...NUMBEO, published_rank: 12 });

    const outside = await portugalsOutsideOpinions();

    expect(
      within(outside).getByRole("row", { name: /numbeo/i }),
    ).toHaveTextContent("72.4 (rank 12)");
  });

  it("prints a dash for a date the publisher did not give", async () => {
    const undated: Record<string, unknown> = { ...NUMBEO };
    delete undated["reference_period"];
    delete undated["retrieval_date"];
    outsideOpinions(undated);

    const outside = await portugalsOutsideOpinions();

    const numbeo = within(outside).getByRole("row", { name: /numbeo/i });
    expect(numbeo).toHaveTextContent("Describes—");
    expect(numbeo).toHaveTextContent("Fetched—");
  });

  /**
   * UI-30. The natural key of an outside score includes the end of its period (`0113`), and the
   * row key did not: two editions differing only there collided, which React reports -- and
   * the suite fails on -- as a duplicate key.
   */
  it("keeps two editions apart when only the end of their period differs", async () => {
    outsideOpinions(NUMBEO, {
      ...NUMBEO,
      published_value: 70.1,
      reference_period: { start: "2026-01-01", end: "2026-12-31" },
    });

    const outside = await portugalsOutsideOpinions();

    expect(within(outside).getAllByRole("row", { name: /numbeo/i })).toHaveLength(2);
    expect(outside).toHaveTextContent("72.4");
    expect(outside).toHaveTextContent("70.1");
  });
});

/**
 * UI-21. **Two re-reads that cite different pages are different evidence.** They folded into
 * one row, which showed only the newest copy's pages.
 */
describe("a figure re-read from different pages", () => {
  it("shows each re-read's own pages when they differ", async () => {
    const read = (id: number, page: string) => ({
      id,
      candidate: "country.portugal",
      attribute: "country.cost_of_living_index",
      value_type: "Quantity",
      payload: { magnitude: 92.1, unit: "index_eu27_100" },
      data_source: "eurostat",
      reference_period: { start: "2025-01-01", end: "2025-12-31" },
      retrieval_date: `2026-09-1${String(id)}T08:00:00Z`,
      confidence_level: "high",
      is_active: id === 2,
      quote: null,
      citations: [page],
    });
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({
          items: [
            read(1, "https://ec.europa.eu/eurostat/first"),
            read(2, "https://ec.europa.eu/eurostat/second"),
          ],
          total: 2,
        }),
      ),
    );
    renderShell("/rank");
    await userEvent.click(
      within(await rankingRow("Portugal")).getByRole("button", { name: "Portugal" }),
    );

    const table = await screen.findByRole("table", { name: /every stored value/i });
    const links = within(table)
      .getAllByRole("link", { name: /source 1/i })
      .map((link) => link.getAttribute("href"));
    expect(links).toEqual([
      "https://ec.europa.eu/eurostat/first",
      "https://ec.europa.eu/eurostat/second",
    ]);
  });
});

/**
 * NEW-08. **A pillar is named as the catalog names it**, in the sentences as on the charts and
 * cards beside them. Both sentences printed the id -- "in economics" under a card saying
 * "Economy".
 */
describe("the chosen pillar, named in a sentence", () => {
  it("names it as the catalog does when counting what is missing", async () => {
    scoreAs([...ATTRIBUTE_SCORES, missingScore(OUTLOOK)]);
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    await userEvent.click(
      await within(row).findByRole("button", { name: /^Economy:/ }),
    );

    expect(
      await screen.findByText("1 of the 3 attributes in Economy has no value in use."),
    ).toBeInTheDocument();
  });

  /** PL-068. The filter reads the pass's pillars, so a chosen pillar keeps its gaps. */
  it("keeps the chosen pillar's missing rows, and nothing from another pillar", async () => {
    scoreAs([...ATTRIBUTE_SCORES, missingScore(OUTLOOK)]);
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));
    await userEvent.click(
      await within(row).findByRole("button", { name: /^Economy:/ }),
    );

    const table = await screen.findByRole("table", { name: /every stored value/i });
    await waitFor(() =>
      expect(attributesInOrder(table)).toEqual([
        "Cost of living index",
        "Economic outlook",
        "Total effective tax rate",
      ]),
    );
    expect(
      within(table).getByRole("row", { name: /economic outlook/i }),
    ).toHaveTextContent("no value stored");
  });

  it("names it as the catalog does when nothing in it is stored", async () => {
    mockServer.use(
      http.get("/v1/pillars", () =>
        HttpResponse.json({
          items: [
            { id: "economics", name: "Economy", display_order: 1 },
            { id: "safety", name: "Personal safety", display_order: 4 },
            { id: "family", name: "Family", display_order: 11 },
          ],
        }),
      ),
    );
    scoreAs([
      ...ATTRIBUTE_SCORES,
      missingScore({ attribute: "country.homicide_rate", pillar: "safety", weight: 8 }),
    ]);
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    await userEvent.click(
      await within(row).findByRole("button", { name: /^Personal safety:/ }),
    );

    expect(
      await screen.findByText("Nothing in Personal safety has a value in use."),
    ).toBeInTheDocument();
    // Named, rather than an empty table claiming nothing was ever stored (RK-12).
    expect(
      screen.getByRole("row", { name: /homicide rate/i }),
    ).toHaveTextContent("no value stored");
    expect(screen.queryByText(/no figure has been stored/i)).toBeNull();
  });
});

describe("what a stored figure looks like, whatever its type", () => {
  /** One value of each payload shape the contract defines (`reqs.md` 3.3a). */
  const everyShape = [
    ["Quantity", { magnitude: 12.6, unit: "celsius" }, "12.6 °C"],
    [
      "Monetary",
      { amount: 1410, currency: "EUR", amount_eur: 1410 },
      "1410 EUR",
    ],
    [
      // **A ratio is a share of something** (P78), and the contract makes `basis` required.
      // This row expected the bare "26.4" -- the same mistake as the Index below, for the
      // same reason, and it sat four lines above the comment explaining it.
      "Ratio",
      { value: 26.4, basis: "households" },
      "26.4% of Households",
    ],
    ["Count", { count: 42 }, "42"],
    [
      // **An index means nothing without its bounds** (P57). This row used to expect the bare
      // "1.07", which locked in a render indistinguishable from a percentage -- and `reqs.md`
      // reserves `Index` for exactly the figures whose bounds do the work.
      "Index",
      { value: 1.07, provider: "World Bank", scale_min: -2.5, scale_max: 2.5 },
      "1.07 on -2.5–2.5 (World Bank)",
    ],
    [
      "AssignedScore",
      { value: 7, range_min: 0, range_max: 10, assigned_by: "human" },
      "7 on 0–10 (assigned by human)",
    ],
    ["LabelSet", { labels: ["Csb", "Csa"] }, "Csb, Csa"],
    ["Text", { body: "a note" }, "a note"],
    // `true` is what JSON carries; it is not what anybody calls the state of an agreement.
    ["Boolean", { value: true }, "Yes"],
    [
      "ShareComposition",
      { shares: [{ label: "rail", share: 40 }] },
      "rail 40%",
    ],
  ] as const;

  it("prints each one in its own terms, converting nothing", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({
          items: everyShape.map(([valueType, payload], index) => ({
            id: 900 + index,
            candidate: "country.portugal",
            attribute: `country.example_${index}`,
            value_type: valueType,
            payload,
            data_source: "eurostat",
            reference_period: { start: "2025-01-01", end: "2025-12-31" },
            retrieval_date: "2026-09-11T08:00:00Z",
            confidence_level: "high",
            is_active: true,
          })),
          total: everyShape.length,
        }),
      ),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    for (const [, , shown] of everyShape) {
      expect(within(table).getByText(shown)).toBeInTheDocument();
    }
  });

  it("reports a failure to read the figures rather than showing an empty table", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json(
          { code: "not_found", message: "no such candidate" },
          { status: 404 },
        ),
      ),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no such candidate/i,
    );
  });

  it("reports a failure to read the outside opinions on its own", async () => {
    mockServer.use(
      http.get("/v1/external-scores", () =>
        HttpResponse.json(
          { code: "conflict", message: "cannot read outside scores" },
          { status: 409 },
        ),
      ),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cannot read outside scores/i,
    );
    expect(
      screen.getByRole("table", { name: /every stored value/i }),
    ).toBeInTheDocument();
  });

  it("shows a rejected figure as rejected, not as merely superseded", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({
          items: [
            {
              id: 950,
              candidate: "country.portugal",
              attribute: "country.cost_of_living_index",
              value_type: "Quantity",
              payload: { magnitude: 999, unit: "index_eu27_100" },
              data_source: "eurostat",
              reference_period: { start: "2025-01-01", end: "2025-12-31" },
              retrieval_date: "2026-09-11T08:00:00Z",
              confidence_level: "high",
              is_active: false,
              rejection_reason: "outside the attribute's allowed range",
            },
          ],
          total: 1,
        }),
      ),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");

    await userEvent.click(
      // The candidate's name is the toggle: the whole row opens, and this is what a
      // keyboard reaches.
      within(row).getByRole("button", { name: "Portugal" }),
    );

    const table = await screen.findByRole("table", {
      name: /every stored value/i,
    });
    expect(within(table).getByText("Rejected")).toBeInTheDocument();
  });

  it("shows a warning beside the candidate it was raised for", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json({
          criteria_set: "default",
          level: "country",
          computed_at: "2026-09-12T09:00:00Z",
          candidates: [
            {
              candidate: "country.portugal",
              name: "Portugal",
              rank: 1,
              score: 78,
              coverage: 92,
              match_status: "matching",
              warnings: [
                {
                  compound_rule: "cheap_but_taxed",
                  detail: "cheap and heavily taxed",
                },
              ],
            },
          ],
        }),
      ),
    );
    renderShell("/rank");

    const row = await rankingRow("Portugal");

    expect(
      within(row).getByText(/cheap and heavily taxed/i),
    ).toBeInTheDocument();
  });
});

describe("what the pass made of each figure", () => {
  /**
   * `reqs.md` 5.4, through `GET /rankings/candidates/{id}`. **The weight a set configures and
   * the weight a pass used are different numbers.** An attribute with no figure drops out and
   * its share spreads over the ones that have one, so a table showing only the configured
   * weight leaves a reader unable to see where a missing figure went -- which is the question
   * "why is this score what it is" mostly comes down to.
   *
   * These numbers were reachable before only by saving the ranking first, because the drill-down
   * that had them took an evaluation id.
   */
  async function theValues() {
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));
    return within(
      await screen.findByRole("table", { name: /every stored value/i }),
    );
  }

  type TheValues = Awaited<ReturnType<typeof theValues>>;

  /** The one row of an attribute whose text includes `saying`: its quote, or its chip. */
  function rowOf(
    table: TheValues,
    attribute: RegExp,
    saying: string,
  ): HTMLElement {
    const row = table
      .getAllByRole("row", { name: attribute })
      .find((each) => each.textContent?.includes(saying));
    expect(row, `no ${String(attribute)} row saying "${saying}"`).toBeDefined();
    return row!;
  }

  /**
   * One cell of a stored value's row, by its column heading -- for the same reason the ranking
   * table's cells are found that way: a column's position is an accident of layout.
   */
  function cellOf(
    table: TheValues,
    row: HTMLElement,
    column: string,
  ): HTMLElement {
    const headings = table
      .getAllByRole("columnheader")
      .map((heading) => heading.textContent?.trim() ?? "");
    const at = headings.indexOf(column);
    expect(at, `no column headed "${column}"`).toBeGreaterThan(-1);
    return row.children[at] as HTMLElement;
  }

  /** Score, weight used and points added: the three readings the pass made of a figure. */
  const THE_PASS = ["Score 0–100", "Weight used", "Contribution"];

  /** Waits until the pass's reading has reached the figure it was computed from. */
  async function theActiveCostOfLiving(
    table: TheValues,
  ): Promise<HTMLElement> {
    const active = rowOf(table, /cost of living index/i, "Eurostat 2025: 94.5");
    await waitFor(() =>
      expect(cellOf(table, active, "Contribution")).toHaveTextContent("+9.1"),
    );
    return active;
  }

  it("prints the score, the weight used and the points added, all the server's", async () => {
    const table = await theValues();

    // The active figure, not the one it superseded: both rows carry the attribute's name, and
    // the pass scored the one it is using.
    const row = await theActiveCostOfLiving(table);
    expect(row).toHaveTextContent("Scored");
    expect(cellOf(table, row, "Score 0–100")).toHaveTextContent("73");
    expect(cellOf(table, row, "Weight used")).toHaveTextContent("12.5%");
    expect(cellOf(table, row, "Contribution")).toHaveTextContent("+9.1");
  });

  /**
   * UI-15. **The pass's reading belongs to the figure it read.** Looked up by attribute, the
   * 2024 figure the 2025 one superseded printed the 73, the 12.5% and the +9.1 that the 2025
   * figure earned -- evidence appearing to justify arithmetic done on another measurement.
   */
  it("prints nothing against a figure the pass superseded", async () => {
    const table = await theValues();
    await theActiveCostOfLiving(table);

    const superseded = rowOf(table, /cost of living index/i, "Eurostat 2024: 92.1");
    for (const column of THE_PASS) {
      expect(cellOf(table, superseded, column)).toHaveTextContent(/^—$/);
    }
  });

  it("prints nothing against a figure the catalog rejected", async () => {
    const active = STORED_VALUES.find((each) => each.id === 501)!;
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({
          items: [
            active,
            {
              ...active,
              id: 951,
              payload: { magnitude: 999, unit: "index_eu27_100" },
              quote: "Eurostat 2025: 999",
              is_active: false,
              rejection_reason: "outside the attribute's allowed range",
            },
          ],
          total: 2,
        }),
      ),
    );
    const table = await theValues();
    await theActiveCostOfLiving(table);

    const rejected = rowOf(table, /cost of living index/i, "Rejected");
    for (const column of THE_PASS) {
      expect(cellOf(table, rejected, column)).toHaveTextContent(/^—$/);
    }
  });

  /**
   * UI-15. **Active is not scored.** `european_air_connectivity` is the figure in use for its
   * attribute and no criterion judges it (`reqs.md` 3.0, Q228), so calling it "Scored" claimed
   * a part in the total it never had.
   */
  it("calls a figure no criterion scores active, not scored", async () => {
    const table = await theValues();
    // The set has arrived once a figure it scores carries its reading; before then, "not
    // scored" would be true of every row for the wrong reason.
    expect(await theActiveCostOfLiving(table)).toHaveTextContent("Scored");

    const connectivity = table.getByRole("row", {
      name: /european air connectivity/i,
    });
    expect(cellOf(table, connectivity, "In use")).toHaveTextContent(/^Active$/);
  });

  /**
   * **An excluded criterion judges and does not count** (`reqs.md` 5.3, `0122`): its attribute
   * takes no weight and leaves no gap, so its figure is no more scored than a descriptive one
   * -- and the weight the set would give it, were it counted, is not a weight it has.
   */
  it("calls a figure its criterion excludes active, and gives it no weight", async () => {
    const sets = makeCriteriaSetDetails();
    const theSet = sets["default"]!;
    theSet.criteria = [
      ...(theSet.criteria ?? []),
      {
        attribute: "country.european_air_connectivity",
        pillar: "connectivity",
        weight: 10,
        weight_locked: false,
        is_scored: false,
        goal: "maximise",
        normalisation_method: "percentile",
        blocks_if_missing: false,
      },
    ];
    mockServer.use(
      http.get("/v1/criteria-sets/default", () => HttpResponse.json(theSet)),
    );
    const table = await theValues();
    expect(await theActiveCostOfLiving(table)).toHaveTextContent("Scored");

    const connectivity = table.getByRole("row", {
      name: /european air connectivity/i,
    });
    expect(cellOf(table, connectivity, "In use")).toHaveTextContent(/^Active$/);
    expect(cellOf(table, connectivity, "Weight")).toHaveTextContent(/^—$/);
  });

  /**
   * **The set is a separate read, and its failure is silent here**, so it may not take the
   * pass's numbers with it. The ranking answers which attributes count -- it reads every
   * criterion that does and nothing else -- so the figure it scored keeps its reading, and the
   * one nothing counts stays active.
   */
  it("keeps the pass's reading on the figure it scored when the set cannot be read", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/default", () =>
        HttpResponse.json(
          { code: "internal_error", message: "the set could not be read" },
          { status: 500 },
        ),
      ),
    );
    const table = await theValues();

    const active = await theActiveCostOfLiving(table);
    expect(cellOf(table, active, "In use")).toHaveTextContent(/^Scored$/);
    expect(cellOf(table, active, "Score 0–100")).toHaveTextContent("73");
    expect(cellOf(table, active, "Weight used")).toHaveTextContent("12.5%");
    const connectivity = table.getByRole("row", {
      name: /european air connectivity/i,
    });
    expect(cellOf(table, connectivity, "In use")).toHaveTextContent(/^Active$/);
  });

  /**
   * PL-063. **Weight and Weight used are one kind of number**: both shares of the whole score,
   * the first as declared and the second after redistribution. The set's 50% is cost of
   * living's share of its pillar, a different basis, and printing it beside 12.5% read as a
   * weight that had lost three quarters of itself.
   */
  it("reads Weight and Weight used on one basis, the server's", async () => {
    const table = await theValues();
    const active = await theActiveCostOfLiving(table);

    expect(cellOf(table, active, "Weight")).toHaveTextContent(/^11\.3%$/);
    expect(cellOf(table, active, "Weight used")).toHaveTextContent(/^12\.5%$/);
    expect(
      table.getByRole("columnheader", { name: "Weight" }),
    ).toHaveAttribute("title", expect.stringMatching(/share of the whole score, as configured/i));
    expect(
      table.getByRole("columnheader", { name: "Weight used" }),
    ).toHaveAttribute("title", expect.stringMatching(/after redistribution/i));
    expect(
      table.getByText("Weights are shares of the whole score."),
    ).toBeInTheDocument();
  });

  /** PL-073. 12.5 against 11.25 is more than 0.6 points: the share grew by redistribution. */
  it("tints a weight used that redistribution moved", async () => {
    const table = await theValues();
    const active = await theActiveCostOfLiving(table);

    expect(cellOf(table, active, "Weight used")).toHaveClass("value-weight--moved");
  });

  /** PL-073. The tooltip is built from the set's criterion, the catalog and the row's source. */
  it("says how an attribute was scored, on its name", async () => {
    const table = await theValues();
    await theActiveCostOfLiving(table);

    const [how] = await table.findAllByRole("img", {
      name: /how cost of living index was scored/i,
    });
    const said = how!.getAttribute("title") ?? "";
    expect(said).toMatch(/Measured in EU27 = 100\./);
    expect(said).toMatch(/Goal: lower is better\./);
    expect(said).toMatch(/Scored by percentile\./);
    expect(said).toMatch(/Source: Eurostat\./);
    expect(said).toMatch(/^Not required/m);
  });

  /** While the set cannot be read, there is no tooltip rather than a wrong one. */
  it("offers no tooltip when the set cannot be read", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/default", () =>
        HttpResponse.json(
          { code: "internal_error", message: "the set could not be read" },
          { status: 500 },
        ),
      ),
    );
    const table = await theValues();
    await theActiveCostOfLiving(table);

    expect(table.queryByRole("img", { name: /was scored/i })).toBeNull();
  });

  /** Portugal's values, as the test chooses them. */
  function storeOnly(...values: Record<string, unknown>[]): void {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({ items: values, total: values.length }),
      ),
    );
  }

  const COST = STORED_VALUES.find((each) => each.id === 501)!;

  /** PL-068. Named, never only counted: the amber nought and "No value" in its place. */
  it("names each scored attribute with no value in use", async () => {
    const table = await theValues();

    const broadband = table.getByRole("row", { name: /broadband coverage/i });
    expect(cellOf(table, broadband, "Stored value")).toHaveTextContent(/^no value stored$/);
    expect(cellOf(table, broadband, "Weight")).toHaveTextContent(/^10\.0%$/);
    expect(cellOf(table, broadband, "Weight used")).toHaveTextContent(/^0\.0%$/);
    expect(cellOf(table, broadband, "Weight used")).toHaveClass("value-weight--missing");
    expect(cellOf(table, broadband, "In use")).toHaveTextContent(/^No value$/);
    expect(broadband).toHaveTextContent(/Nothing has been stored for it\./);
  });

  /** M6's guard: each scored attribute is one run of rows, however many figures it has. */
  it("draws every scored attribute exactly once, as one group of rows", async () => {
    const table = await theValues();
    await theActiveCostOfLiving(table);

    const order = attributesInOrder(screen.getByRole("table", { name: /every stored value/i }));
    const called: Record<string, string> = {
      "country.cost_of_living_index": "Cost of living index",
      "country.average_rent": "Average rent",
      "country.total_tax_rate_effective": "Total effective tax rate",
      "country.broadband_coverage": "Broadband coverage",
    };
    for (const { attribute } of ATTRIBUTE_SCORES) {
      expect(
        order.filter((name) => name === called[attribute]),
        attribute,
      ).toHaveLength(1);
    }
  });

  /** PL-074 (N8): descriptive first, then by the catalog's pillar order, then by name. */
  it("lists unscored attributes first, then by pillar order and name, each attribute's figures together", async () => {
    const table = await theValues();
    await theActiveCostOfLiving(table);

    expect(attributesInOrder(screen.getByRole("table", { name: /every stored value/i }))).toEqual([
      "European air connectivity",
      // Economy (1), by name.
      "Cost of living index",
      "Total effective tax rate",
      // Housing (2), then Transport (7).
      "Average rent",
      "Broadband coverage",
    ]);
  });

  it("a scored attribute whose only figure was rejected reads no value in use, above the rejected figure", async () => {
    storeOnly({
      ...COST,
      id: 960,
      is_active: false,
      rejection_reason: "Cost of living index is outside its allowed range",
    });
    const table = await theValues();

    const rows = await table.findAllByRole("row", { name: /cost of living index/i });
    expect(rows).toHaveLength(2);
    expect(cellOf(table, rows[0]!, "Stored value")).toHaveTextContent(/^no value in use$/);
    expect(rows[0]).toHaveTextContent(/Every figure stored for it was rejected\./);
    expect(cellOf(table, rows[1]!, "In use")).toHaveTextContent("Rejected");
  });

  /** PL-072. Why, in words, beneath the chip. */
  it("shows a rejected figure's reason", async () => {
    storeOnly(COST, {
      ...COST,
      id: 961,
      quote: "Eurostat 2025: 999",
      is_active: false,
      rejection_reason: "Cost of living index is outside its allowed range",
    });
    const table = await theValues();

    const rejected = rowOf(table, /cost of living index/i, "Eurostat 2025: 999");
    expect(cellOf(table, rejected, "In use")).toHaveTextContent(
      "RejectedCost of living index is outside its allowed range",
    );
    // The figure in use has no reason to give.
    const active = await theActiveCostOfLiving(table);
    expect(cellOf(table, active, "In use")).toHaveTextContent(/^Scored$/);
  });

  /** PL-071. Nothing superseded it: its source is off, and the active sibling is beside it. */
  it("a figure from a switched-off source says so, even with an active sibling", async () => {
    storeOnly(COST, {
      ...COST,
      id: 962,
      data_source: "numbeo",
      quote: "Numbeo: 88",
      is_active: false,
      source_is_enabled: false,
    });
    const table = await theValues();
    await theActiveCostOfLiving(table);

    const off = rowOf(table, /cost of living index/i, "Numbeo: 88");
    expect(cellOf(table, off, "In use")).toHaveTextContent(/^Source switched off$/);
    expect(table.queryByText("Superseded")).toBeNull();
  });

  it("an attribute whose only figure is switched off reads no value in use", async () => {
    storeOnly({ ...COST, id: 963, is_active: false, source_is_enabled: false });
    const table = await theValues();

    const [gap, off] = await table.findAllByRole("row", { name: /cost of living index/i });
    expect(cellOf(table, gap!, "Stored value")).toHaveTextContent(/^no value in use$/);
    expect(cellOf(table, gap!, "In use")).toHaveTextContent(/^No value$/);
    expect(gap).toHaveTextContent(/source that is switched off/);
    expect(cellOf(table, off!, "In use")).toHaveTextContent(/^Source switched off$/);
  });

  /** PL-069. The stored grade stays; the mark says it counts one grade lower. */
  it("marks an aged figure's confidence, and leaves a fresh one unmarked", async () => {
    const tax = STORED_VALUES.find((each) => each.id === 503)!;
    storeOnly(COST, { ...tax, is_fresh: false });
    const table = await theValues();
    const fresh = await theActiveCostOfLiving(table);

    const aged = table.getByRole("row", { name: /total effective tax rate/i });
    const mark = within(cellOf(table, aged, "Confidence")).getByText(
      "older than its allowed age",
    );
    expect(mark).toHaveAttribute(
      "title",
      "Counted one grade lower in the confidence split",
    );
    expect(cellOf(table, aged, "Confidence")).toHaveTextContent(/^low/);
    expect(cellOf(table, fresh, "Confidence")).toHaveTextContent(/^high$/);
  });

  it("while the scoring is pending, no missing row is guessed", async () => {
    mockServer.use(
      http.get("/v1/rankings/candidates/:candidateId", () => new Promise<never>(() => {})),
    );
    renderShell("/rank");
    const row = await rankingRow("Portugal");
    await userEvent.click(within(row).getByRole("button", { name: "Portugal" }));

    expect(
      await screen.findByRole("heading", { name: /Portugal: every value/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    expect(screen.queryByRole("table", { name: /every stored value/i })).toBeNull();
    expect(screen.queryByText("No value")).toBeNull();
  });

  it("shows the figures alone, and says what is missing from them, when the scoring fails", async () => {
    mockServer.use(
      http.get("/v1/rankings/candidates/:candidateId", () =>
        HttpResponse.json(
          { code: "internal_error", message: "the ranking could not be read" },
          { status: 500 },
        ),
      ),
    );
    const table = await theValues();

    expect(
      screen.getByText(
        "The scoring could not be read; missing attributes and weights are not shown.",
      ),
    ).toBeInTheDocument();
    expect(table.queryByText("No value")).toBeNull();
    expect(table.getAllByRole("row", { name: /cost of living index/i })).toHaveLength(2);
  });

  it("says nothing where the ranking scored nothing", async () => {
    // `european_air_connectivity` is counted and never scored (`reqs.md` 3.0, Q228): a figure
    // with no criterion attached. Its three columns are blank rather than nought, because
    // "not judged" and "judged to be worth nothing" are different claims.
    const table = await theValues();

    const row = table.getByRole("row", { name: /european air connectivity/i });
    expect(row).toHaveTextContent("31");
    expect(row).not.toHaveTextContent(/[+-]?\d+\.\d/);
  });
});
