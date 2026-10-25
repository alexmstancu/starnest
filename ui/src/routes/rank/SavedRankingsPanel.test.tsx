import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEvaluation, replaceHousehold } from "../../api/endpoints";
import { HOUSEHOLD } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * UX review A. `GET /rankings` computes and stores nothing -- which is what makes re-weighting
 * instant, and why keeping a ranking has to be a deliberate act rather than a side effect of
 * looking at one.
 *
 * **Three parts, three places, as the design has them.** Saving is an act about the ranking in
 * front of you, so it sits in that ranking's header; the list of what has been kept is about
 * the whole session, so it sits in the sidebar, in reach from Configure while a weight is
 * being moved; and the one you opened is a thing to look at, so it appears under the live
 * table it is being compared against. These tests exercise all three, because the interesting
 * behaviour is that they stay in step.
 */

/** Where saved rankings are listed: the sidebar card, present on every screen. */
async function savedList(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: /saved rankings/i });
}

/**
 * The header's save button, once saving is actually possible.
 *
 * A ranking is saved for a criteria set at a level, so it stays disabled until the shell has
 * resolved both. Clicking before then does nothing, which reads in a failure as "saving is
 * broken" rather than "the test was early".
 */
async function armedSave(): Promise<HTMLElement> {
  // **Re-queried after the wait, never captured before it.** `RankScreen` keys the ranking on
  // the selection, so resolving it remounts that subtree -- and a button found beforehand is
  // a detached node that still answers `toBeEnabled` with the state it had when it was torn
  // out, which is disabled, forever.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /save this ranking/i }),
    ).toBeEnabled(),
  );
  return screen.getByRole("button", { name: /save this ranking/i });
}

/**
 * **Two steps, as the design draws it.** One button until it is pressed, then the field and
 * the confirmation -- so the common case is one click and the field never sits there empty
 * inviting somebody to wonder what it is for.
 */
async function saveOne(note?: string) {
  await userEvent.click(await armedSave());
  if (note !== undefined) {
    await userEvent.type(
      screen.getByLabelText(/worth keeping/i),
      note,
    );
  }
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
}

/** Portugal's row in one ranking table, found by its rowheader. */
function portugalIn(table: HTMLElement): HTMLElement {
  const heading = within(table)
    .getAllByRole("rowheader")
    .find((cell) => cell.textContent?.trim() === "Portugal");
  expect(heading, "no row for Portugal").toBeDefined();
  return heading!.closest("tr")!;
}

describe("saved rankings", () => {
  it("says nothing is saved yet, and why", async () => {
    renderShell("/rank");

    expect(
      await within(await savedList()).findByText(/none yet/i),
    ).toBeInTheDocument();
    await armedSave();
    expect(
      screen.getByText(/nothing is kept until you save it/i),
    ).toBeInTheDocument();
  });

  it("saves the ranking with the note it was given", async () => {
    renderShell("/rank");
    await saveOne("before I raised housing");

    // It appears in the sidebar, which is the list the shell keeps.
    const list = within(await savedList());
    expect(
      await list.findByText("before I raised housing"),
    ).toBeInTheDocument();
  });

  /** A saved ranking names its criteria set and level, whether or not it has a note. */
  it("falls back to the criteria set and level when no note was given", async () => {
    renderShell("/rank");
    await saveOne();

    const list = within(await savedList());
    expect(await list.findByText("Default, Country")).toBeInTheDocument();
  });

  /** The field goes away again, so the next save starts from one button as the first did. */
  it("puts the control back once it has saved", async () => {
    renderShell("/rank");
    await saveOne("a reason");

    await within(await savedList()).findByText("a reason");
    await waitFor(() =>
      expect(screen.queryByLabelText(/worth keeping/i)).toBeNull(),
    );
    expect(
      await screen.findByText(/nothing is kept until you save it/i),
    ).toBeInTheDocument();
  });

  it("asks for nothing when the save is cancelled", async () => {
    renderShell("/rank");
    await userEvent.click(await armedSave());
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByLabelText(/worth keeping/i)).toBeNull();
    expect(await savedList()).toBeInTheDocument();
  });

  /**
   * The divergence from the design's prototype, and the reason for it: restoring a saved
   * weight vector would overwrite whatever criteria set is being worked on.
   */
  it("shows a saved ranking rather than restoring it over the live one", async () => {
    renderShell("/rank");
    await saveOne();
    const list = within(await savedList());
    await list.findByText(/default, country/i);

    await userEvent.click(list.getAllByRole("link")[0]!);

    const opened = within(
      await screen.findByRole("region", { name: /a saved ranking/i }),
    );
    expect(
      await opened.findByText(/as it was when it was saved/i),
    ).toBeInTheDocument();
    // Shown beside the live one, which is still there: nothing was restored over it.
    expect(
      screen.getAllByRole("table", { name: /ranked candidates/i }),
    ).toHaveLength(2);
  });

  /**
   * PL-076 (UF-120), revised by PL-144: a saved row now opens its saved evidence, so it is marked
   * as one that opens -- and its pillar chart stays a picture, because that panel has no filter.
   */
  it("marks a saved row as one that opens, with an inert pillar chart", async () => {
    renderShell("/rank");
    await saveOne();
    const list = within(await savedList());
    await list.findByText(/default, country/i);
    await userEvent.click(list.getAllByRole("link")[0]!);

    const opened = await screen.findByRole("region", { name: /a saved ranking/i });
    const frozen = await within(opened).findByRole("table", {
      name: /ranked candidates/i,
    });
    const live = screen
      .getAllByRole("table", { name: /ranked candidates/i })
      .find((table) => !opened.contains(table))!;

    expect(portugalIn(live)).toHaveClass("table__row--toggle");
    expect(portugalIn(frozen)).toHaveClass("table__row--toggle");
    expect(within(frozen).queryByRole("toolbar")).toBeNull();
  });

  it("closes a saved ranking that was open", async () => {
    renderShell("/rank");
    await saveOne();
    const list = within(await savedList());
    await list.findByText(/default, country/i);
    await userEvent.click(list.getAllByRole("link")[0]!);

    const opened = await screen.findByRole("region", {
      name: /a saved ranking/i,
    });
    await within(opened).findByText(/as it was when it was saved/i);
    await userEvent.click(
      within(opened).getByRole("button", { name: /close/i }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /a saved ranking/i }),
      ).toBeNull(),
    );
  });

  it("reports a refusal to save, and keeps the note so nothing is retyped", async () => {
    renderShell("/rank");
    await userEvent.click(await armedSave());

    mockServer.use(
      http.post("/v1/evaluations", () =>
        HttpResponse.json(
          { code: "score_scale_not_set", message: "not set" },
          { status: 409 },
        ),
      ),
    );

    const note = screen.getByLabelText(/worth keeping/i);
    await userEvent.type(note, "worth keeping");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /top of the score range is set/i,
    );
    expect(note).toHaveValue("worth keeping");
  });

  it("reports a failure to list what has been saved", async () => {
    mockServer.use(http.get("/v1/evaluations", () => HttpResponse.error()));
    renderShell("/rank");

    // The sidebar's card says it in words, quietly (N4), and never prints the code.
    // Read again as the rest of the page is answered (PL-002), so asked of the settled page.
    const list = within(await savedList());
    await waitFor(() => {
      expect(list.getByText(/saved rankings could not be loaded/i)).toBeInTheDocument();
      expect(list.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
    expect(list.queryByText("client.unreachable")).toBeNull();
  });
});

/** Saves one, opens it from the sidebar, and answers the region it opened in. */
async function openSaved(note?: string): Promise<HTMLElement> {
  await saveOne(note);
  const list = within(await savedList());
  await list.findByText(note ?? /default, country/i);
  await userEvent.click(list.getAllByRole("link")[0]!);
  const opened = await screen.findByRole("region", { name: /a saved ranking/i });
  await within(opened).findByRole("table", { name: /ranked candidates/i });
  return opened;
}

/** A candidate's row in the saved table, opened, and the evidence region it opened. */
async function openSavedCandidate(opened: HTMLElement, name: string): Promise<HTMLElement> {
  const frozen = within(opened).getByRole("table", { name: /ranked candidates/i });
  await userEvent.click(within(frozen).getByRole("button", { name }));
  return within(opened).findByRole("region", {
    name: new RegExp(`${name}: every figure behind the saved score`, "i"),
  });
}

/** The row of the saved figures table whose header names `attribute`. */
async function savedFigureRow(evidence: HTMLElement, attribute: RegExp): Promise<HTMLElement> {
  const table = await within(evidence).findByRole("table", { name: /saved figures/i });
  const header = within(table)
    .getAllByRole("rowheader")
    .find((cell) => attribute.test(cell.textContent ?? ""));
  expect(header, `no saved row for ${attribute}`).toBeDefined();
  return header!.closest("tr")!;
}

describe("an opened saved ranking (PL-144)", () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  afterEach(() => {
    if (scrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoView);
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("is brought into sight with the keyboard on its heading", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    renderShell("/rank");

    await openSaved();

    expect(
      screen.getByRole("heading", { name: /a saved ranking/i }),
    ).toHaveFocus();
    expect(scrolled).toHaveBeenCalled();
  });

  it("says what it is: its note, set, level, date and scale", async () => {
    renderShell("/rank");
    const opened = within(await openSaved("before I raised housing"));

    expect(await opened.findByText("“before I raised housing”")).toBeInTheDocument();
    const facts = new Map(
      opened
        .getAllByRole("term")
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(facts.get("Criteria set")).toBe("Default");
    expect(facts.get("Level")).toBe("Country");
    expect(facts.get("Saved")).toMatch(/2026/);
    expect(facts.get("Scored out of")).toBe("100");
  });

  it("says so when it was kept without a note", async () => {
    renderShell("/rank");
    const opened = within(await openSaved());
    expect(await opened.findByText(/kept without a note/i)).toBeInTheDocument();
  });

  it("shows each candidate's pillars and its difference from where the household lives now", async () => {
    await replaceHousehold({ ...HOUSEHOLD, home_country_candidate: "country.netherlands" });
    renderShell("/rank");
    const opened = await openSaved();
    const frozen = within(opened).getByRole("table", { name: /ranked candidates/i });

    const portugal = portugalIn(frozen);
    expect(portugal).toHaveTextContent("+7");
    // Economics, drawn inside its bar: the pillars came back with the saved ranking.
    expect(within(portugal).getByText("81")).toBeInTheDocument();
    const netherlands = within(frozen)
      .getAllByRole("rowheader")
      .find((cell) => cell.textContent?.startsWith("Netherlands"))!
      .closest("tr")!;
    expect(netherlands).toHaveTextContent(/baseline/i);
  });

  it("opens each saved figure with its source and both dates", async () => {
    renderShell("/rank");
    const evidence = await openSavedCandidate(await openSaved(), "Portugal");

    const cost = within(await savedFigureRow(evidence, /cost of living/i));
    expect(cost.getByText(/94\.5/)).toBeInTheDocument();
    expect(cost.getByText("Eurostat")).toBeInTheDocument();
    expect(cost.getByText(/2025 to .*2025/)).toBeInTheDocument();
    expect(cost.getByText(/Sep.*2026|2026.*Sep|11.*2026/)).toBeInTheDocument();
    // Nothing answered broadband, which is not the same claim as a figure nobody kept.
    expect(within(await savedFigureRow(evidence, /broadband/i)).getByText("No figure")).toBeInTheDocument();
  });

  it("opens a refusal with the gate answer it read", async () => {
    renderShell("/rank");
    const evidence = within(await openSavedCandidate(await openSaved(), "Spain"));

    const read = within(evidence.getByRole("list", { name: /what the rules read/i }));
    expect(read.getByText(/no visa route/i)).toBeInTheDocument();
    expect(read.getByText("Does not match")).toBeInTheDocument();
    expect(read.getByText(/ministry's page/i)).toBeInTheDocument();
    expect(read.getByText("Manual entry")).toBeInTheDocument();
  });

  it("opens a warning with the figures it read", async () => {
    mockServer.use(
      http.get("/v1/evaluations/:evaluationId/candidates/:candidateId", () =>
        HttpResponse.json({
          candidate: "country.portugal",
          name: "Portugal",
          score: 78,
          coverage: 92.4,
          match_status: "matching",
          score_scale_max: 100,
          warnings: [
            {
              compound_rule: "country.rent_within_budget",
              detail: "Average rent is 52% of the target monthly spend.",
              inputs: [SAVED_RENT],
            },
          ],
          attribute_scores: [],
        }),
      ),
    );
    renderShell("/rank");
    const evidence = within(await openSavedCandidate(await openSaved(), "Portugal"));

    const read = within(evidence.getByRole("list", { name: /what the rules read/i }));
    expect(read.getByText(/52% of the target/i)).toBeInTheDocument();
    expect(read.getByText(/1,?460/)).toBeInTheDocument();
    expect(read.getByText("Eurostat")).toBeInTheDocument();
  });

  /**
   * A ranking saved before the evidence was kept (before 0512): every scored figure reads
   * "not recorded", never a zero and never today's figure, and so does every rule's evidence.
   */
  it("opens an older ranking with 'not recorded' where it kept no evidence", async () => {
    mockServer.use(
      http.get("/v1/evaluations/:evaluationId/candidates/:candidateId", ({ params }) =>
        HttpResponse.json(OLD_DETAILS[String(params["candidateId"])] ?? {}),
      ),
    );
    renderShell("/rank");
    const opened = await openSaved();

    const portugal = await openSavedCandidate(opened, "Portugal");
    const cost = within(await savedFigureRow(portugal, /cost of living/i));
    expect(cost.getByText("not recorded")).toBeInTheDocument();
    expect(cost.queryByText("Eurostat")).toBeNull();
    // The score it was given is still its own, and nothing was written as nought.
    expect(cost.getByText("73")).toBeInTheDocument();
    expect(cost.queryByText("0")).toBeNull();

    const spain = within(await openSavedCandidate(opened, "Spain"));
    expect(spain.getByText(/gate answer not recorded/i)).toBeInTheDocument();
    expect(spain.getByText(/figures read not recorded/i)).toBeInTheDocument();
  });

  it("says when a saved ranking is no longer there", async () => {
    renderShell("/rank?saved=42");

    const opened = within(await screen.findByRole("region", { name: /a saved ranking/i }));
    expect(await opened.findByRole("alert")).toBeInTheDocument();
    expect(opened.queryByRole("table")).toBeNull();
  });

  it("reports a saved candidate's evidence it could not read, and offers to try again", async () => {
    mockServer.use(
      http.get("/v1/evaluations/:evaluationId/candidates/:candidateId", () =>
        HttpResponse.error(),
      ),
    );
    renderShell("/rank");
    const evidence = within(await openSavedCandidate(await openSaved(), "Portugal"));

    expect(await evidence.findByRole("alert")).toBeInTheDocument();
    expect(evidence.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

/** A figure a warning read, with its source and both dates. */
const SAVED_RENT = {
  id: 610,
  candidate: "country.portugal",
  attribute: "country.average_rent",
  value_type: "Monetary",
  payload: { amount: 1460, currency: "EUR", amount_eur: 1460 },
  data_source: "eurostat",
  reference_period: { start: "2025-01-01", end: "2025-12-31" },
  retrieval_date: "2026-09-11T08:00:00Z",
  confidence_level: "high",
  is_active: true,
  is_fresh: true,
  source_is_enabled: true,
};

/** What the server answers for a ranking saved before 0512: scores, and no evidence at all. */
const OLD_DETAILS: Record<string, Record<string, unknown>> = {
  "country.portugal": {
    candidate: "country.portugal",
    name: "Portugal",
    score: 78,
    coverage: 92.4,
    match_status: "matching",
    score_scale_max: 100,
    attribute_scores: [
      {
        attribute: "country.cost_of_living_index",
        pillar: "economics",
        normalised_score: 73,
        weight: 11.25,
        effective_weight: 12.5,
        contribution: 9.125,
        value: null,
      },
    ],
  },
  "country.spain": {
    candidate: "country.spain",
    name: "Spain",
    score: 64,
    coverage: 81.5,
    match_status: "not_matching",
    score_scale_max: 100,
    non_match_reasons: [
      {
        match_rule: "country.visa_route_exists",
        reason_detail: "No visa route this household qualifies for.",
        gate_answer: null,
        inputs: [],
      },
      {
        criterion: "country.total_tax_rate_effective",
        reason_detail: "Total tax rate is above 50%.",
        gate_answer: null,
        inputs: [],
      },
    ],
    attribute_scores: [],
  },
};

/** A saved ranking's row in the sidebar, found by the name it is listed under. */
async function savedRow(name: string): Promise<HTMLElement> {
  const link = await within(await savedList()).findByRole("link", { name: new RegExp(name) });
  return link.closest("li")!;
}

describe("the saved rankings card (PL-145)", () => {
  it("lists each by its name over who led it and when", async () => {
    renderShell("/rank");
    await saveOne("before I raised housing");

    const row = within(await savedRow("before I raised housing"));
    expect(row.getByText("before I raised housing")).toBeInTheDocument();
    expect(row.getByText(/^Portugal led, .*2026$/)).toBeInTheDocument();
  });

  it("says nobody was ranked rather than naming a leader", async () => {
    mockServer.use(
      http.get("/v1/evaluations", () =>
        HttpResponse.json({
          items: [
            {
              id: 3,
              criteria_set: "default",
              level: "country",
              computed_at: "2026-09-21T09:00:00Z",
              score_scale_max: 100,
              note: "an empty roster",
              leader: null,
            },
          ],
        }),
      ),
    );
    renderShell("/rank");

    const row = within(await savedRow("an empty roster"));
    expect(row.getByText(/^Nobody was ranked, /)).toBeInTheDocument();
  });

  it("deletes one only once it is confirmed, then shows the empty state", async () => {
    renderShell("/rank");
    await saveOne("short-lived");
    const row = within(await savedRow("short-lived"));

    await userEvent.click(row.getByRole("button", { name: /delete short-lived/i }));
    // Asked, not done: it is still listed until the deletion is confirmed.
    expect(row.getByRole("link", { name: /short-lived/ })).toBeInTheDocument();
    expect(row.getByRole("button", { name: /keep it/i })).toHaveFocus();
    await userEvent.click(row.getByRole("button", { name: /^delete$/i }));

    const list = within(await savedList());
    expect(await list.findByText(/none yet/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^saved rankings$/i })).toHaveFocus();
  });

  it("keeps it when the deletion is called off, and gives the keyboard back to the ×", async () => {
    renderShell("/rank");
    await saveOne("kept after all");
    const row = within(await savedRow("kept after all"));

    await userEvent.click(row.getByRole("button", { name: /delete kept after all/i }));
    await userEvent.click(row.getByRole("button", { name: /keep it/i }));

    expect(row.queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(row.getByRole("button", { name: /delete kept after all/i })).toHaveFocus();
    expect(row.getByRole("link", { name: /kept after all/ })).toBeInTheDocument();
  });

  it("closes the saved ranking it deletes if that one was open", async () => {
    renderShell("/rank");
    await openSaved("open while deleted");

    const row = within(await savedRow("open while deleted"));
    await userEvent.click(row.getByRole("button", { name: /delete open while deleted/i }));
    await userEvent.click(row.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /a saved ranking/i })).toBeNull(),
    );
  });

  it("reports a failed deletion, keeps the ranking, and tries again", async () => {
    renderShell("/rank");
    await saveOne("stubborn");
    const row = within(await savedRow("stubborn"));
    mockServer.use(http.delete("/v1/evaluations/:evaluationId", () => HttpResponse.error()));

    await userEvent.click(row.getByRole("button", { name: /delete stubborn/i }));
    await userEvent.click(row.getByRole("button", { name: /^delete$/i }));

    expect(await row.findByRole("alert")).toBeInTheDocument();
    expect(row.getByRole("link", { name: /stubborn/ })).toBeInTheDocument();

    mockServer.resetHandlers();
    await userEvent.click(row.getByRole("button", { name: /try again/i }));
    const list = within(await savedList());
    expect(await list.findByText(/none yet/i)).toBeInTheDocument();
  });

  /** Gone already -- deleted from elsewhere since the list was read: said, and the list caught up. */
  it("treats a ranking somebody already deleted as gone, and says so", async () => {
    renderShell("/rank");
    await saveOne("deleted elsewhere");
    const row = within(await savedRow("deleted elsewhere"));
    await deleteEvaluation(1);

    await userEvent.click(row.getByRole("button", { name: /delete deleted elsewhere/i }));
    await userEvent.click(row.getByRole("button", { name: /^delete$/i }));

    const list = within(await savedList());
    expect(await list.findByText(/had already been deleted/i)).toBeInTheDocument();
    expect(list.queryByRole("link", { name: /deleted elsewhere/ })).toBeNull();
    expect(list.queryByRole("alert")).toBeNull();
  });
});
