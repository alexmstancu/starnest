import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeCriteriaSetDetails, rankingFor } from "../../../mocks/fixtures";
import { mockServer } from "../../../mocks/server";
import { renderShell } from "../../../testing/renderShell";

/**
 * The rules, and which of them the set lets act.
 *
 * **The switch must never be ahead of the server.** A checkbox that ticked itself and then
 * failed would have the screen claiming a gate is enforced when it is not -- and a gate is what
 * decides whether a candidate can be ranked at all (`reqs.md` 5.5), so the test for the sad path
 * is the important one here.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Match rules & gates" }));
}

describe("the rules panel", () => {
  it("lists the gates at the level, and the one asked at every level", async () => {
    renderShell("/configure");
    const rules = await panel();

    expect(
      await rules.findByRole("listitem", { name: "A visa route exists" }),
    ).toBeInTheDocument();
    // The row itself carries what the rule is and what it is doing, so there is no cell to
    // step out to: the listitem is the row.
    expect(
      rules.getByRole("listitem", { name: "Not excluded by hand" }),
    ).toBeInTheDocument();
  });

  /** PL-155. What a gate tests is the catalog's sentence, never only the level it is asked at. */
  it("says what each gate tests, in the catalog's words", async () => {
    renderShell("/configure");
    const rules = await panel();

    const visa = await rules.findByRole("listitem", { name: "A visa route exists" });
    expect(visa).toHaveTextContent("A realistic visa route exists for this household.");
    expect(visa).not.toHaveTextContent(/Asked at/);
  });

  /** PL-162. The switch says what pressing it does before it is pressed. */
  it("gives each switch a tooltip that says what pressing it does", async () => {
    renderShell("/configure");
    await panel();

    expect(
      await screen.findByRole("switch", { name: "Enforce A visa route exists" }),
    ).toHaveAttribute("title", "On in this set. Switch it off and it stops being applied.");
    expect(
      screen.getByRole("switch", { name: "Apply Rent fits the target spend" }),
    ).toHaveAttribute("title", "Off in this set. Switch it on to apply it.");
  });

  /** PL-162. The difference between a gate and a warning is said once, in the note. */
  it("says what a gate and a warning are once, not twice", async () => {
    renderShell("/configure");
    const rules = await panel();
    await rules.findByRole("listitem", { name: "A visa route exists" });

    expect(rules.getAllByText(/never fires either way/)).toHaveLength(1);
  });

  it("shows which gates this set enforces", async () => {
    renderShell("/configure");
    await panel();

    expect(
      await screen.findByRole("switch", {
        name: "Enforce A visa route exists",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Enforce Free movement applies" }),
    ).not.toBeChecked();
  });

  it("enforces a gate once the server has accepted it", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    const toggle = await screen.findByRole("switch", {
      name: "Enforce Free movement applies",
    });
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
  });

  /**
   * **The other direction, which nothing tested.** Every switch test here clicked from off to
   * on, so the branch that takes a rule *out* of the enforced list was never run: replacing
   * `current.filter(...)` with `current` — making "switch it off" a silent no-op — left all 49
   * tests in this panel green.
   *
   * `CLAUDE.md` records the identical asymmetry one screen over: `updateCriterionLock` sent a
   * lock and never its twin, so "a locked pillar could never be unlocked — 409 for ever". The
   * cost is higher here, because an enforced gate decides whether a candidate is ranked at all,
   * and a reader who cannot turn one off cannot get a country back.
   */
  it("stops enforcing a gate once the server has accepted that too", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    const toggle = await screen.findByRole("switch", {
      name: "Enforce A visa route exists",
    });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  /** And back on again, so the two directions are not one lucky pass each. */
  it("enforces it again after it has been switched off", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    const toggle = await screen.findByRole("switch", {
      name: "Enforce A visa route exists",
    });

    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("leaves the gate as it was when the write fails, and says why", async () => {
    mockServer.use(
      http.put(
        "/v1/criteria-sets/:criteriaSetId/match-rules/:matchRuleId",
        () =>
          HttpResponse.json(
            { code: "internal_error", message: "the gate could not be stored" },
            { status: 500 },
          ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const rules = await panel();

    const toggle = await screen.findByRole("switch", {
      name: "Enforce Free movement applies",
    });
    await user.click(toggle);

    expect(
      await rules.findByText("The server failed while answering."),
    ).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it("lists compound rules with what each does when it fires", async () => {
    renderShell("/configure");
    const rules = await panel();

    const row = await rules.findByRole("listitem", {
      name: "Mild and connected",
    });
    // PL-155: written from its conditions, naming attributes and bands -- never the shape or
    // the outcome as the vocabulary spells them.
    expect(row).toHaveTextContent(
      "Rules a candidate out when Summer daytime high is at most 30 and Broadband coverage is at least 90.",
    );
    expect(row).not.toHaveTextContent("AllConditionsHold");
    expect(row).not.toHaveTextContent("not_matching");
  });

  it("applies a compound rule once the server has accepted it", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    const toggle = await screen.findByRole("switch", {
      name: "Apply Rent fits the target spend",
    });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("reports gates that could not be listed", async () => {
    mockServer.use(
      http.get("/v1/match-rules", () =>
        HttpResponse.json(
          { code: "internal_error", message: "no rules" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");
    const rules = await panel();

    expect(await rules.findByText("The gates could not be loaded")).toBeInTheDocument();
    expect(rules.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("says so when a level defines no compound rule", async () => {
    mockServer.use(
      http.get("/v1/compound-rules", () => HttpResponse.json({ items: [] })),
    );
    renderShell("/configure");
    const rules = await panel();

    expect(
      await rules.findByText("No compound rule is defined at this level."),
    ).toBeInTheDocument();
  });
});

/**
 * UI-12 and NEW-06. **The sentence beside a rule must not claim what the ranking does not do.**
 * A proposal was counted as a removal, every compound rule read "applies to no candidate", a
 * gate said "never fires" while its answers were still loading, and candidates were named by id.
 */
describe("what each rule says it is doing", () => {
  function rowOf(name: string): Promise<HTMLElement> {
    return screen.findByRole("listitem", { name });
  }

  it("does not say a proposed answer removes a candidate", async () => {
    renderShell("/configure");
    await panel();

    const gate = await rowOf("A visa route exists");
    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "1 proposed answer awaits confirmation, so this rules nobody out yet.",
      ),
    );
    expect(gate).not.toHaveTextContent(/Removes/);
  });

  it("names the candidate a confirmed answer removes, never its id", async () => {
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({
          items: [
            {
              match_rule: "country.visa_route_exists",
              candidate: "country.united_kingdom",
              match_result: "not_matching",
              data_source: "manual",
              retrieval_date: "2026-09-12T09:00:00Z",
              is_proposal: false,
            },
          ],
        }),
      ),
    );
    renderShell("/configure");
    await panel();

    const gate = await rowOf("A visa route exists");
    await waitFor(() =>
      expect(gate).toHaveTextContent("Removes United Kingdom."),
    );
    expect(gate).not.toHaveTextContent("country.");
  });

  it("says it is still reading the answers, rather than that a gate never fires", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get("/v1/match-rule-results", async () => {
        await held;
      }),
    );
    renderShell("/configure");
    await panel();

    const freeMovement = await rowOf("Free movement applies");
    expect(freeMovement).toHaveTextContent("Reading the answers…");
    expect(freeMovement).not.toHaveTextContent(/never fires/);

    release();

    await waitFor(() =>
      expect(freeMovement).toHaveTextContent(
        "Answered for one candidate, and rules nobody out — not while this is off.",
      ),
    );
  });

  it("says it cannot tell what a gate does when the answers could not be read", async () => {
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json(
          { code: "internal_error", message: "no answers" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");
    await panel();

    const gate = await rowOf("A visa route exists");
    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "The answers could not be read, so what this rule does is not known.",
      ),
    );
  });
});

/**
 * PL-157 and PL-158 (D56). **Each set holds a rule as a gate or as a warning**, and the select
 * says which -- from the rule's outcome in this set, never from the list it sits in.
 */
describe("a rule as a gate or a warning", () => {
  function outcomeOf(name: string): Promise<HTMLSelectElement> {
    return screen.findByRole("combobox", { name: `What ${name} does when it fires` });
  }

  /** Every body the set's rule writes sent, in order. */
  function recordRuleWrites(): unknown[] {
    const sent: unknown[] = [];
    const record = async ({ request }: { request: Request }) => {
      if (request.method === "PUT" && /\/(match|compound)-rules\//.test(request.url)) {
        sent.push(await request.clone().json());
      }
    };
    mockServer.events.on("request:start", record);
    onTestFinished(() => mockServer.events.removeListener("request:start", record));
    return sent;
  }

  it("shows each rule's outcome in this set, a compound rule's from its own outcome", async () => {
    renderShell("/configure");
    await panel();

    expect(await outcomeOf("A visa route exists")).toHaveValue("not_matching");
    // The catalog holds "Mild and connected" as a gate and the rent rule as a warning: the
    // label follows each, never the heading above them.
    expect(await outcomeOf("Mild and connected")).toHaveValue("not_matching");
    expect(await outcomeOf("Rent fits the target spend")).toHaveValue("warning");
  });

  it("takes a set's own outcome over the catalog's", async () => {
    const shipped = makeCriteriaSetDetails()["default"]!;
    mockServer.use(
      http.get("/v1/criteria-sets/default", () =>
        HttpResponse.json({
          ...shipped,
          applied_compound_rules: ["country.rent_within_budget"],
          compound_rule_outcomes: { "country.rent_within_budget": "not_matching" },
        }),
      ),
    );
    renderShell("/configure");
    await panel();

    expect(await outcomeOf("Rent fits the target spend")).toHaveValue("not_matching");
  });

  it("softens a gate to a warning once the server has accepted it", async () => {
    const sent = recordRuleWrites();
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    const select = await outcomeOf("A visa route exists");

    await user.selectOptions(select, "warning");

    await waitFor(() => expect(select).toHaveValue("warning"));
    expect(sent).toEqual([{ is_enforced: true, outcome: "warning" }]);
  });

  it("leaves the outcome as it was when the server refuses it, and says why", async () => {
    mockServer.use(
      http.put("/v1/criteria-sets/:criteriaSetId/match-rules/:matchRuleId", () =>
        HttpResponse.json(
          { code: "invalid_criteria_set", message: "a rule that is off holds no outcome" },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const rules = await panel();
    const select = await outcomeOf("A visa route exists");

    await user.selectOptions(select, "warning");

    expect(
      await rules.findByText("The criteria set is not valid as written."),
    ).toBeInTheDocument();
    expect(rules.queryByText(/a rule that is off holds no outcome/)).toBeNull();
    expect(select).toHaveValue("not_matching");
  });

  it("holds the choice while the rule is off, and sends nothing", async () => {
    const sent = recordRuleWrites();
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    const select = await outcomeOf("Free movement applies");
    expect(select).toHaveAttribute("aria-disabled", "true");

    await user.selectOptions(select, "warning");

    expect(select).toHaveValue("not_matching");
    expect(sent).toEqual([]);
  });

  /** Switched off, a rule drops its outcome on the server; switched on, it is a gate again. */
  it("is a gate again once switched off and on", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    const select = await outcomeOf("A visa route exists");
    await user.selectOptions(select, "warning");
    await waitFor(() => expect(select).toHaveValue("warning"));
    const toggle = screen.getByRole("switch", { name: "Enforce A visa route exists" });

    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());

    expect(select).toHaveValue("not_matching");
  });
});

/**
 * PL-156. **A rule's cost line names whom it removes or flags, coloured by that effect**: red
 * only for a removal, never for a rule that costs nothing or is switched off. A compound rule's
 * is read from the live ranking's warnings and reasons for not matching.
 */
describe("what a rule costs, and its colour", () => {
  const RENT = "country.rent_within_budget";

  /** The live ranking, with the rent rule flagging the named countries. */
  function rankingFlagging(...names: string[]) {
    return http.get("/v1/rankings", () => {
      const ranking = rankingFor("default", "country");
      return HttpResponse.json({
        ...ranking,
        candidates: ranking.candidates.map((each) =>
          names.includes(each.name)
            ? {
                ...each,
                warnings: [{ compound_rule: RENT, match_rule: null, detail: "Rent is high." }],
              }
            : each,
        ),
      });
    });
  }

  async function effectOf(name: string, sentence: string): Promise<HTMLElement> {
    const row = await screen.findByRole("listitem", { name });
    return within(row).findByText(sentence);
  }

  async function applyRent(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      await screen.findByRole("switch", { name: "Apply Rent fits the target spend" }),
    );
  }

  it("names whom an applied compound rule flags, in amber", async () => {
    mockServer.use(rankingFlagging("Spain", "Portugal"));
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    await applyRent(user);

    const effect = await effectOf(
      "Rent fits the target spend",
      "Flags 2 countries: Portugal and Spain.",
    );
    expect(effect).toHaveClass("rule-row__effect--flags");
  });

  it("says an applied rule that flags nobody applies to no country, and not in red", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    await applyRent(user);

    const effect = await effectOf("Rent fits the target spend", "Applies to no country right now.");
    expect(effect).not.toHaveClass("rule-row__effect--removes");
  });

  it("applies to no country in an empty ranking", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json({ ...rankingFor("default", "country"), candidates: [] }),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    await applyRent(user);

    expect(
      await effectOf("Rent fits the target spend", "Applies to no country right now."),
    ).toBeInTheDocument();
  });

  it("says it cannot tell when the ranking could not be read, and offers to read it again", async () => {
    let failing = true;
    mockServer.use(
      http.get("/v1/rankings", () =>
        failing
          ? HttpResponse.json(
              { code: "internal_error", message: "no ranking" },
              { status: 500 },
            )
          : HttpResponse.json(rankingFor("default", "country")),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const rules = await panel();

    await applyRent(user);

    expect(
      await effectOf(
        "Rent fits the target spend",
        "The ranking could not be read, so whom this rule acts on is not known.",
      ),
    ).toHaveClass("rule-row__effect--unknown");
    expect(
      rules.getByText("Whom the compound rules flag could not be loaded"),
    ).toBeInTheDocument();

    failing = false;
    await user.click(rules.getByRole("button", { name: "Try again" }));

    expect(
      await effectOf("Rent fits the target spend", "Applies to no country right now."),
    ).toBeInTheDocument();
  });

  it("draws a rule that is off as off, never in red", async () => {
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({
          items: [
            {
              match_rule: "country.eu_free_movement",
              candidate: "country.united_kingdom",
              match_result: "not_matching",
              data_source: "manual",
              retrieval_date: "2026-09-12T09:00:00Z",
              is_proposal: false,
            },
          ],
        }),
      ),
    );
    renderShell("/configure");
    await panel();

    const gate = await effectOf(
      "Free movement applies",
      "Removes United Kingdom — not while this is off.",
    );
    expect(gate).toHaveClass("rule-row__effect--off");
    expect(gate).not.toHaveClass("rule-row__effect--removes");
    expect(
      await effectOf("Rent fits the target spend", "Not applied, so it flags nobody."),
    ).toHaveClass("rule-row__effect--off");
  });

  it("removes in red, and flags in amber once the gate is held as a warning", async () => {
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({
          items: [
            {
              match_rule: "country.visa_route_exists",
              candidate: "country.united_kingdom",
              match_result: "not_matching",
              data_source: "manual",
              retrieval_date: "2026-09-12T09:00:00Z",
              is_proposal: false,
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    expect(
      await effectOf("A visa route exists", "Removes United Kingdom."),
    ).toHaveClass("rule-row__effect--removes");

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "What A visa route exists does when it fires" }),
      "warning",
    );

    expect(
      await effectOf("A visa route exists", "Flags United Kingdom."),
    ).toHaveClass("rule-row__effect--flags");
  });
});
