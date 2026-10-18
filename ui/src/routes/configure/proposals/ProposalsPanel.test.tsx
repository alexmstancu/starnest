import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import { renderShell } from "../../../testing/renderShell";

/**
 * Gate proposals, and the act that makes one count (`reqs.md` 6.10 use 3).
 *
 * **The rule under test is that a proposal rules nothing out.** A model read the official
 * pages, reported what they say, and until a person writes the same answer the ranking ignores
 * it -- so this panel's job is to make a proposal checkable rather than to present it as
 * decided. The assertions are about what is on screen and what was sent, never about a
 * judgement this code made: there are none.
 *
 * **And it is the only screen that can spend money**, so the estimate is a separate act with
 * its own button.
 */

const BASE = "/v1";
const PROPOSED_GATE = "country.visa_route_exists";
const PROPOSED_FOR = "country.portugal";

/**
 * This panel, and nothing else on the screen. The household and settings panels beside it each
 * keep a status line of their own (NEW-42), so a status asked for screen-wide would be three.
 */
function theProposals() {
  return within(screen.getByRole("region", { name: "Gate proposals" }));
}

async function settled(): Promise<void> {
  await screen.findByRole("region", { name: "Gate proposals" });
  await waitFor(() =>
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument(),
  );
}

describe("what the panel shows", () => {
  it("lists a proposal with its pages, which are the point of asking", async () => {
    renderShell("/configure");
    await settled();

    // Scoped to this panel. A gate now states which candidates it rules out, so a candidate
    // id appears in the Rules table too and a global row lookup matches both.
    const row = await within(
      await screen.findByRole("region", { name: "Gate proposals" }),
    ).findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    expect(row).toHaveTextContent(PROPOSED_GATE);
    expect(row).toHaveTextContent("not_matching");
    expect(
      screen.getByRole("link", { name: "https://example.gov/skilled-worker" }),
    ).toBeInTheDocument();
  });

  it("says a proposal rules nothing out, rather than leaving it implied", async () => {
    renderShell("/configure");
    await settled();

    expect(
      screen.getByText(/a proposal rules nothing out/i),
    ).toBeInTheDocument();
  });

  it("leaves confirmed answers out of the list and counts them instead", async () => {
    /** A confirmed answer is not something to act on here; it is context for one that is. */
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, () =>
        HttpResponse.json({
          items: [
            {
              match_rule: "country.eu_free_movement",
              candidate: "country.spain",
              match_result: "matching",
              data_source: "manual",
              retrieval_date: "2026-09-10T09:00:00Z",
              is_proposal: false,
            },
          ],
        }),
      ),
    );
    renderShell("/configure");
    await settled();

    expect(
      await screen.findByText(/1 gate answers have been recorded by hand/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /proposals/i })).not.toBeInTheDocument();
  });
});

describe("spending money on research", () => {
  it("offers no research until the cost has been seen", async () => {
    renderShell("/configure");
    await settled();

    expect(
      screen.queryByRole("button", { name: "Research the gates" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Estimate the research" }),
    ).toBeInTheDocument();
  });

  it("shows what a pass would ask and cost, and what the figure rests on", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();

    await user.click(screen.getByRole("button", { name: "Estimate the research" }));

    expect(await screen.findByText(/64 gate answers to research/i)).toBeInTheDocument();
    expect(screen.getByText(/about €4\.20/)).toBeInTheDocument();
    expect(screen.getByText(/a ceiling, not a forecast/i)).toHaveTextContent(
      /12,000 input tokens per call/,
    );
  });

  it("estimating spends nothing, because it is asked instead of the pass", async () => {
    const asked: string[] = [];
    const user = userEvent.setup();
    mockServer.use(
      http.post(`${BASE}/match-rule-research`, () => {
        asked.push("researched");
        return HttpResponse.json({
          proposals: [],
          cost_eur: 0,
          calls: 0,
          halted_on_spend_cap: false,
        });
      }),
    );
    renderShell("/configure");
    await settled();

    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/64 gate answers to research/i);

    expect(asked).toEqual([]);
  });

  it("sends the uncapped acceptance only when it is given", async () => {
    /**
     * The bypass of `reqs.md` 6.3, Q220: refused by default, allowed when somebody says so,
     * per request and never remembered. Offered only after an estimate, because agreeing to an
     * uncapped spend before seeing the figure is the decision this panel exists to prevent.
     */
    const sent: unknown[] = [];
    const user = userEvent.setup();
    mockServer.use(
      http.post(`${BASE}/match-rule-research`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          proposals: [],
          cost_eur: 0,
          calls: 0,
          halted_on_spend_cap: false,
        });
      }),
    );
    renderShell("/configure");
    await settled();

    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/64 gate answers to research/i);
    await user.click(screen.getByRole("button", { name: "Research the gates" }));
    await waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toMatchObject({ accept_uncapped_spend: false });

    await user.click(
      screen.getByRole("checkbox", { name: /accept an uncapped spend/i }),
    );
    await user.click(screen.getByRole("button", { name: "Research the gates" }));
    await waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[1]).toMatchObject({ accept_uncapped_spend: true });
  });

  it("does not remember the acceptance into the next pass", async () => {
    // **Per request, never remembered** -- which the panel's own comment claimed while the
    // checkbox stayed ticked, so one agreement authorised every later pass in silence.
    const sent: unknown[] = [];
    const user = userEvent.setup();
    mockServer.use(
      http.post(`${BASE}/match-rule-research`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          proposals: [],
          cost_eur: 0,
          calls: 0,
          halted_on_spend_cap: false,
        });
      }),
    );
    renderShell("/configure");
    await settled();
    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/64 gate answers to research/i);

    await user.click(
      screen.getByRole("checkbox", { name: /accept an uncapped spend/i }),
    );
    await user.click(screen.getByRole("button", { name: "Research the gates" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Research the gates" }));
    await waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[0]).toMatchObject({ accept_uncapped_spend: true });
    expect(sent[1]).toMatchObject({ accept_uncapped_spend: false });
  });

  it("shows the refusal when no spend cap is set", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.post(`${BASE}/match-rule-research`, () =>
        HttpResponse.json(
          {
            code: "spend_cap_not_set",
            message:
              "this would spend money and no spend cap is set; set run_spend_cap_eur or accept an uncapped run",
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/configure");
    await settled();

    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/64 gate answers to research/i);
    await user.click(screen.getByRole("button", { name: "Research the gates" }));

    expect(await screen.findByText(/no spend cap is set/i)).toBeInTheDocument();
  });

  it("names a gate the model answered without citing anything", async () => {
    /** An answer with no pages is an opinion, and nothing is stored for it -- so the screen
     * says which gate is still open rather than letting it vanish. */
    const user = userEvent.setup();
    mockServer.use(
      http.post(`${BASE}/match-rule-research`, () =>
        HttpResponse.json({
          proposals: [],
          refusals: ["country.eu_free_movement for country.malta: the model cited nothing"],
          cost_eur: 0.02,
          calls: 1,
          halted_on_spend_cap: false,
        }),
      ),
    );
    renderShell("/configure");
    await settled();

    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/64 gate answers to research/i);
    await user.click(screen.getByRole("button", { name: "Research the gates" }));

    expect(await screen.findByText(/the model cited nothing/i)).toBeInTheDocument();
  });
});

describe("confirming a proposal", () => {
  it("writes the same answer as the person's own, keeping the pages", async () => {
    /**
     * **What confirming means.** The answer becomes `manual` -- somebody read those pages and
     * agrees -- and the citations travel with it, so a reader of the confirmed answer can still
     * check them.
     */
    const sent: unknown[] = [];
    const user = userEvent.setup();
    mockServer.use(
      http.put(
        `${BASE}/match-rule-results/:matchRuleId/:candidateId`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          sent.push(body);
          return HttpResponse.json({
            ...body,
            match_rule: PROPOSED_GATE,
            candidate: PROPOSED_FOR,
            retrieval_date: "2026-09-12T10:00:00Z",
            is_proposal: false,
          });
        },
      ),
    );
    renderShell("/configure");
    await settled();

    await user.click(
      await screen.findByRole("button", {
        name: `Confirm ${PROPOSED_GATE} for ${PROPOSED_FOR}`,
      }),
    );

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      match_result: "not_matching",
      data_source: "manual",
      citations: ["https://example.gov/skilled-worker"],
    });
  });

  it("stops being a proposal once confirmed, because confirming replaces it", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();

    await user.click(
      await screen.findByRole("button", {
        name: `Confirm ${PROPOSED_GATE} for ${PROPOSED_FOR}`,
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: `Confirm ${PROPOSED_GATE} for ${PROPOSED_FOR}`,
        }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(/no proposal is waiting/i),
    ).toBeInTheDocument();
  });

  it("shows a refused confirmation rather than looking as though it worked", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.put(`${BASE}/match-rule-results/:matchRuleId/:candidateId`, () =>
        HttpResponse.json(
          { code: "not_found", message: "there is no candidate country.portugal" },
          { status: 404 },
        ),
      ),
    );
    renderShell("/configure");
    await settled();

    await user.click(
      await screen.findByRole("button", {
        name: `Confirm ${PROPOSED_GATE} for ${PROPOSED_FOR}`,
      }),
    );

    expect(
      await screen.findByText(/there is no candidate country\.portugal/i),
    ).toBeInTheDocument();
  });
});

/**
 * UI-14. **What a pass actually spent, and whether it was cut short.** The response carries the
 * cost, the calls and whether the cap stopped it; the panel kept only the refusals, so a pass
 * halted half way looked finished and the estimate was the only figure on screen.
 */
describe("what a research pass did", () => {
  async function researchOnce(): Promise<void> {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/64 gate answers to research/i);
    await user.click(screen.getByRole("button", { name: "Research the gates" }));
  }

  function answeringResearch(outcome: {
    cost_eur: number;
    calls: number;
    halted_on_spend_cap: boolean;
  }) {
    mockServer.use(
      http.post(`${BASE}/match-rule-research`, () =>
        HttpResponse.json({ proposals: [], refusals: [], ...outcome }),
      ),
    );
  }

  it("says what the pass actually spent, beside what it was estimated to", async () => {
    renderShell("/configure");
    await settled();

    await researchOnce();

    expect(await theProposals().findByRole("status")).toHaveTextContent(
      "The last pass made 2 calls and spent €0.04.",
    );
    expect(screen.getByText(/about €4\.20/)).toBeInTheDocument();
  });

  it("says the pass stopped at the spend cap, rather than looking finished", async () => {
    answeringResearch({ cost_eur: 9.98, calls: 240, halted_on_spend_cap: true });
    renderShell("/configure");
    await settled();

    await researchOnce();

    expect(await theProposals().findByRole("status")).toHaveTextContent(
      /stopped at the spend cap.*were not asked/,
    );
  });

  it("says a pass that asked nothing charged nothing", async () => {
    answeringResearch({ cost_eur: 0, calls: 0, halted_on_spend_cap: false });
    renderShell("/configure");
    await settled();

    await researchOnce();

    expect(await theProposals().findByRole("status")).toHaveTextContent(
      "The last pass made no calls and spent nothing.",
    );
  });
});

/**
 * UI-13. **Confirming a proposal used to drop the period it holds for**, and the row never showed
 * one. The confirmed answer is dated from the confirmation: that is when a person checked it.
 */
describe("the period a proposal holds for", () => {
  function servingProposal(reference_period?: { start: string; end: string }) {
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, () =>
        HttpResponse.json({
          items: [
            {
              match_rule: PROPOSED_GATE,
              candidate: PROPOSED_FOR,
              match_result: "not_matching",
              data_source: "llm",
              retrieval_date: "2026-09-12T09:00:00Z",
              reason: "The official page lists no route for these citizenships.",
              citations: ["https://example.gov/skilled-worker"],
              is_proposal: true,
              ...(reference_period === undefined ? {} : { reference_period }),
            },
          ],
        }),
      ),
    );
  }

  function recordConfirmations(): Record<string, unknown>[] {
    const sent: Record<string, unknown>[] = [];
    mockServer.use(
      http.put(
        `${BASE}/match-rule-results/:matchRuleId/:candidateId`,
        async ({ request }) => {
          sent.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json({});
        },
      ),
    );
    return sent;
  }

  async function confirm(): Promise<void> {
    await userEvent.click(
      await screen.findByRole("button", {
        name: `Confirm ${PROPOSED_GATE} for ${PROPOSED_FOR}`,
      }),
    );
  }

  it("keeps the period a proposal holds for when it is confirmed", async () => {
    servingProposal({ start: "2026-01-01", end: "2026-12-31" });
    const sent = recordConfirmations();
    renderShell("/configure");
    await settled();

    await confirm();

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      reference_period: { start: "2026-01-01", end: "2026-12-31" },
    });
    // Dated by the server at the moment of confirmation, never by the model's reading.
    expect(sent[0]).not.toHaveProperty("retrieval_date");
  });

  it("sends no period, and says so, for a proposal that has none", async () => {
    servingProposal();
    const sent = recordConfirmations();
    renderShell("/configure");
    await settled();

    await confirm();

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toHaveProperty("reference_period", null);
  });

  it("shows the period beside the proposal", async () => {
    servingProposal({ start: "2026-01-01", end: "2026-12-31" });
    renderShell("/configure");
    await settled();

    const row = await within(
      await screen.findByRole("region", { name: "Gate proposals" }),
    ).findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    expect(row).toHaveTextContent("1 Jan 2026 to 31 Dec 2026");
  });

  it("says when a proposal records no period", async () => {
    servingProposal();
    renderShell("/configure");
    await settled();

    const row = await within(
      await screen.findByRole("region", { name: "Gate proposals" }),
    ).findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    expect(row).toHaveTextContent("No period recorded");
  });
});

/**
 * UI-14. **A pass's spend belongs to that pass.** The last outcome was set only on success and
 * never cleared, so a pass that then failed sat under the previous pass's spend -- on the one
 * screen that spends money.
 */
describe("a research pass after an earlier one", () => {
  const EARLIER = "The last pass made 2 calls and spent €0.04.";
  const NOT_KNOWN = /failed before it said what it spent/i;

  async function researchOnceThenAgain(failure: () => Response): Promise<void> {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/64 gate answers to research/i);
    await user.click(screen.getByRole("button", { name: "Research the gates" }));
    await screen.findByText(EARLIER);

    mockServer.use(http.post(`${BASE}/match-rule-research`, failure));
    await user.click(screen.getByRole("button", { name: "Research the gates" }));
  }

  it("shows no earlier pass's spend once a later pass fails on the server", async () => {
    await researchOnceThenAgain(() =>
      HttpResponse.json(
        { code: "internal_error", message: "the model provider failed" },
        { status: 500 },
      ),
    );

    expect(
      await screen.findByText("the model provider failed"),
    ).toBeInTheDocument();
    expect(screen.queryByText(EARLIER)).toBeNull();
    // A server failure may come after calls that were billed.
    expect(theProposals().getByRole("status")).toHaveTextContent(NOT_KNOWN);
  });

  it("shows no earlier pass's spend once a later pass is refused", async () => {
    await researchOnceThenAgain(() =>
      HttpResponse.json(
        {
          code: "spend_cap_not_set",
          message: "this would spend money and no spend cap is set",
        },
        { status: 409 },
      ),
    );

    expect(
      await screen.findByText(/no spend cap is set/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(EARLIER)).toBeNull();
    // Refused before the model was asked anything, so nothing about its spend is in doubt.
    expect(screen.queryByText(NOT_KNOWN)).toBeNull();
  });

  /**
   * NEW-31. **The `llm` source can be switched off in Data sources on this same screen**, after
   * the estimate and before the pass. The server then refuses with a 501 before it asks
   * anything, which read as a pass whose spend is not known.
   */
  it("knows a pass refused because no model may be asked spent nothing", async () => {
    await researchOnceThenAgain(() =>
      HttpResponse.json(
        {
          code: "llm_not_configured",
          message:
            "the llm source is switched off, so no gate can be researched",
        },
        { status: 501 },
      ),
    );

    expect(
      await screen.findByText(/the llm source is switched off/i),
    ).toBeInTheDocument();
    expect(screen.getByText("llm_not_configured")).toBeInTheDocument();
    expect(screen.queryByText(EARLIER)).toBeNull();
    expect(screen.queryByText(NOT_KNOWN)).toBeNull();
  });

  it("says the spend is not known when the backend could not be reached", async () => {
    await researchOnceThenAgain(() => HttpResponse.error());

    expect(
      await screen.findByText(/backend did not answer/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(EARLIER)).toBeNull();
    expect(theProposals().getByRole("status")).toHaveTextContent(NOT_KNOWN);
  });

  it("says the spend is not known when the proxy timed the pass out", async () => {
    await researchOnceThenAgain(
      () =>
        new HttpResponse("<html>504 Gateway Time-out</html>", {
          status: 504,
          headers: { "Content-Type": "text/html" },
        }),
    );

    expect(
      await screen.findByText(/in a shape this interface does not recognise/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(EARLIER)).toBeNull();
    expect(theProposals().getByRole("status")).toHaveTextContent(NOT_KNOWN);
  });

  it("drops an earlier pass's refusals when a later pass fails", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.post(`${BASE}/match-rule-research`, () =>
        HttpResponse.json({
          proposals: [],
          refusals: ["country.eu_free_movement for country.malta: the model cited nothing"],
          cost_eur: 0.02,
          calls: 1,
          halted_on_spend_cap: false,
        }),
      ),
    );
    renderShell("/configure");
    await settled();
    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/64 gate answers to research/i);
    await user.click(screen.getByRole("button", { name: "Research the gates" }));
    await screen.findByText(/the model cited nothing/i);

    mockServer.use(
      http.post(`${BASE}/match-rule-research`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "the model provider failed" },
          { status: 500 },
        ),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Research the gates" }));

    expect(
      await screen.findByText("the model provider failed"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/the model cited nothing/i)).toBeNull();
  });

  it("replaces the first pass's spend with the second's", async () => {
    await researchOnceThenAgain(() =>
      HttpResponse.json({
        proposals: [],
        refusals: [],
        cost_eur: 0.02,
        calls: 1,
        halted_on_spend_cap: false,
      }),
    );

    expect(
      await screen.findByText("The last pass made 1 call and spent €0.02."),
    ).toBeInTheDocument();
    expect(screen.queryByText(EARLIER)).toBeNull();
  });
});
