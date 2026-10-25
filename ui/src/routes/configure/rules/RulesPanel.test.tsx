import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  putMatchRuleResult,
  replaceHousehold,
  setMatchRuleEnforcement,
} from "../../../api/endpoints";
import { HOUSEHOLD, makeCriteriaSetDetails, rankingFor } from "../../../mocks/fixtures";
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
      "Applies when Summer daytime high is at most 30 and Broadband coverage is at least 90.",
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

    // Spain is the ranking's refusal; Portugal's answer is only proposed.
    const gate = await rowOf("A visa route exists");
    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "Removes Spain. 1 proposed answer awaits confirmation and rules nobody out until then.",
      ),
    );
    expect(gate).not.toHaveTextContent(/Removes.*Portugal/);
  });

  it("names the candidate a confirmed answer removes, never its id", async () => {
    // Recorded, so the ranking reads it as the server's does.
    await putMatchRuleResult("country.visa_route_exists", "country.portugal", {
      match_result: "not_matching",
      data_source: "manual",
    });
    renderShell("/configure");
    await panel();

    const gate = await rowOf("A visa route exists");
    await waitFor(() =>
      expect(gate).toHaveTextContent("Removes 2 countries: Portugal and Spain."),
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

    const quota = await rowOf("A residence quota is open");
    expect(quota).toHaveTextContent("Reading the answers…");
    expect(quota).not.toHaveTextContent(/never fires/);

    release();

    await waitFor(() =>
      expect(quota).toHaveTextContent(
        "No answer has been recorded for this rule, so it never fires — not while this is off.",
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

    const gate = await rowOf("A residence quota is open");
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

  it("says an applied rule that fires for nobody applies to no country, and not in red", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    await user.click(await screen.findByRole("switch", { name: "Apply Mild and connected" }));

    const effect = await effectOf("Mild and connected", "Applies to no country right now.");
    expect(effect).not.toHaveClass("rule-row__effect--removes");
  });

  /**
   * The mock's ranking honours the set, as the server's does: the line follows the rule from
   * a flag, to a removal once it is held as a gate, to nobody once it is switched off.
   */
  it("follows the ranking as the rule is applied, held as a gate, and switched off", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    await applyRent(user);
    expect(
      await effectOf("Rent fits the target spend", "Flags Netherlands."),
    ).toHaveClass("rule-row__effect--flags");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "What Rent fits the target spend does when it fires" }),
      "not_matching",
    );
    expect(
      await effectOf("Rent fits the target spend", "Removes Netherlands."),
    ).toHaveClass("rule-row__effect--removes");

    await user.click(screen.getByRole("switch", { name: "Apply Rent fits the target spend" }));
    expect(
      await effectOf("Rent fits the target spend", "Not applied, so it flags nobody."),
    ).toHaveClass("rule-row__effect--off");
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
      rules.getByText("Whom the rules remove or flag could not be loaded"),
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
              match_rule: "country.residence_quota_open",
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
      "A residence quota is open",
      "Removes United Kingdom — not while this is off.",
    );
    expect(gate).toHaveClass("rule-row__effect--off");
    expect(gate).not.toHaveClass("rule-row__effect--removes");
    expect(
      await effectOf("Rent fits the target spend", "Not applied, so it flags nobody."),
    ).toHaveClass("rule-row__effect--off");
  });

  it("removes in red, and flags in amber once the gate is held as a warning", async () => {
    // Recorded, so the ranking reads it as the server's does.
    await putMatchRuleResult("country.visa_route_exists", "country.portugal", {
      match_result: "not_matching",
      data_source: "manual",
    });
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    expect(
      await effectOf("A visa route exists", "Removes 2 countries: Portugal and Spain."),
    ).toHaveClass("rule-row__effect--removes");

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "What A visa route exists does when it fires" }),
      "warning",
    );

    expect(
      await effectOf("A visa route exists", "Flags 2 countries: Portugal and Spain."),
    ).toHaveClass("rule-row__effect--flags");
  });
});

/**
 * PL-151. **A gate's sentence counts only the answers about its level's candidates**, placed by
 * the roster: answers are read for every level, and a city must not be counted at country level.
 */
describe("a gate's answers at the panel's level", () => {
  const answer = (candidate: string) => ({
    match_rule: "country.residence_quota_open",
    candidate,
    match_result: "not_matching",
    data_source: "manual",
    retrieval_date: "2026-09-12T09:00:00Z",
    is_proposal: false,
  });

  function answersAtTwoLevels() {
    return http.get("/v1/match-rule-results", () =>
      HttpResponse.json({ items: [answer("country.united_kingdom"), answer("city.lisbon")] }),
    );
  }

  it("counts only the answers about candidates at the level", async () => {
    mockServer.use(answersAtTwoLevels());
    renderShell("/configure");
    await panel();

    const gate = await screen.findByRole("listitem", { name: "A residence quota is open" });
    await waitFor(() => expect(gate).toHaveTextContent("Removes United Kingdom"));
    expect(gate).not.toHaveTextContent(/Lisbon/);
  });

  it("hides nothing when the roster cannot be read, says so, and offers to read it again", async () => {
    let rosterDown = true;
    mockServer.use(
      answersAtTwoLevels(),
      http.get("/v1/candidates", () =>
        rosterDown
          ? HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 })
          : undefined,
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const rules = await panel();

    const gate = await screen.findByRole("listitem", { name: "A residence quota is open" });
    await waitFor(() => expect(gate).toHaveTextContent(/Removes 2 countries/));
    const note = await rules.findByText(
      /The list of places could not be read, so each gate counts its answers at every level\./,
    );

    rosterDown = false;
    await user.click(within(note).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(gate).toHaveTextContent("Removes United Kingdom"));
    expect(
      rules.queryByText(/The list of places could not be read/),
    ).toBeNull();
  });
});

/**
 * PL-164 (Q239). **A gate says which citizenships clear it, and whether the household holds
 * one**; its cost line agrees with the server's evaluation, which a held citizenship clears
 * even where a refusal was recorded, and which free movement decides from the citizenships.
 */
describe("a gate and the household's citizenships", () => {
  const UK_GATE = "country.uk_skilled_worker";
  const refusal = (gate: string, candidate: string) => ({
    match_rule: gate,
    candidate,
    match_result: "not_matching",
    data_source: "manual",
    retrieval_date: "2026-09-12T09:00:00Z",
    is_proposal: false,
  });

  function rowOf(name: string): Promise<HTMLElement> {
    return screen.findByRole("listitem", { name });
  }

  /** The household as the mock stores it, with these citizenships; read by the ranking too. */
  async function holding(...citizenships: string[]) {
    await replaceHousehold({ ...HOUSEHOLD, citizenships });
  }

  it("names the citizenships that clear a gate", async () => {
    renderShell("/configure");
    await panel();

    const gate = await rowOf("UK Skilled Worker route");
    await waitFor(() =>
      expect(gate).toHaveTextContent("Cleared by citizenship of Ireland or United Kingdom."),
    );
    expect(gate).not.toHaveTextContent(/Cleared: you hold/);
    expect(gate).not.toHaveTextContent("country.");
  });

  it("says the household holds one, and that a refusal recorded for it removes nobody", async () => {
    await holding("country.romania", "country.ireland");
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({ items: [refusal(UK_GATE, "country.portugal")] }),
      ),
    );
    renderShell("/configure");
    await panel();

    const gate = await rowOf("UK Skilled Worker route");
    await waitFor(() =>
      expect(gate).toHaveTextContent("Cleared: you hold citizenship of Ireland."),
    );
    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "Removes nobody: your citizenship clears it — not while this is off.",
      ),
    );
  });

  it("takes an enforced gate's cost from the ranking, which the citizenship clears", async () => {
    await holding("country.romania", "country.ireland");
    await setMatchRuleEnforcement("default", UK_GATE, true);
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({ items: [refusal(UK_GATE, "country.portugal")] }),
      ),
    );
    renderShell("/configure");
    await panel();

    expect(
      await within(await rowOf("UK Skilled Worker route")).findByText(
        "Applies to no country right now.",
      ),
    ).not.toHaveClass("rule-row__effect--removes");
  });

  it("says free movement is decided by citizenship, and cleared by the one held", async () => {
    renderShell("/configure");
    await panel();

    const gate = await rowOf("Free movement applies");
    await waitFor(() =>
      expect(gate).toHaveTextContent("Decided by citizenship. Cleared: you hold citizenship of Romania."),
    );
    expect(gate).toHaveTextContent(
      "Decided by your citizenships, not by a recorded answer — not while this is off.",
    );
  });

  it("says no household decides nothing, and hides no refusal for it", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json(
          { code: "household_not_configured", message: "no household" },
          { status: 404 },
        ),
      ),
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({ items: [refusal(UK_GATE, "country.united_kingdom")] }),
      ),
    );
    renderShell("/configure");
    await panel();

    await waitFor(async () =>
      expect(await rowOf("Free movement applies")).toHaveTextContent(
        "Decided by citizenship, and no household is recorded, so it decides nothing yet.",
      ),
    );
    await waitFor(async () =>
      expect(await rowOf("UK Skilled Worker route")).toHaveTextContent(
        "Removes United Kingdom — not while this is off.",
      ),
    );
  });

  it("says what an enforced gate costs is unknown when the ranking cannot be read", async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json({ code: "internal_error", message: "no ranking" }, { status: 500 }),
      ),
    );
    renderShell("/configure");
    const rules = await panel();

    expect(
      await within(await rowOf("A visa route exists")).findByText(
        /^The ranking could not be read, so whom this rule acts on is not known\./,
      ),
    ).toHaveClass("rule-row__effect--unknown");
    expect(rules.getByText("Whom the rules remove or flag could not be loaded")).toBeInTheDocument();
  });

  /** Batch review (Medium): a citizenship edit moves the lines at once, through the household form. */
  it("moves free movement's line the moment a citizenship change is saved", async () => {
    await setMatchRuleEnforcement("default", "country.eu_free_movement", true);
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    const gate = await rowOf("Free movement applies");
    await waitFor(() => expect(gate).toHaveTextContent("Applies to no country right now."));

    const passports = screen.getByRole("combobox", { name: "Passports held" });
    await user.click(passports);
    await user.type(passports, "United");
    await user.tab();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Remove Romania" }));
    await user.click(screen.getByRole("button", { name: "Save household" }));

    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "Decided by citizenship, and none of yours clears it: you hold citizenship of United Kingdom.",
      ),
    );
    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "Removes 4 countries: Estonia, Netherlands, Portugal and 1 more.",
      ),
    );
  });

  /** Batch review (Medium): a source switched reads the ranking again for the rules' lines. */
  it("reads the ranking again when a source is switched", async () => {
    let switched = false;
    mockServer.use(
      http.patch("/v1/data-sources/:dataSourceId", () => {
        switched = true;
      }),
      http.get("/v1/rankings", () =>
        HttpResponse.json(
          switched
            ? { ...rankingFor("default", "country"), candidates: [] }
            : rankingFor("default", "country"),
        ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    const gate = await rowOf("A visa route exists");
    await waitFor(() => expect(gate).toHaveTextContent("Removes Spain."));

    await user.click((await screen.findAllByRole("switch", { name: /^Consult / }))[0]!);

    await waitFor(() => expect(gate).toHaveTextContent("Applies to no country right now."));
  });

  /** Batch review (Low): a roster still on its way places no answer, so nothing is removed yet. */
  it("reads rather than removes while the roster is still on its way", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get("/v1/candidates", async () => {
        await held;
      }),
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({
          items: [
            refusal("country.residence_quota_open", "country.united_kingdom"),
            refusal("country.residence_quota_open", "city.lisbon"),
          ],
        }),
      ),
    );
    renderShell("/configure");
    await panel();

    const quota = await rowOf("A residence quota is open");
    await waitFor(() => expect(quota).toHaveTextContent("Reading the answers…"));
    expect(quota).not.toHaveTextContent(/Removes/);

    release();

    await waitFor(() =>
      expect(quota).toHaveTextContent("Removes United Kingdom — not while this is off."),
    );
  });
});
