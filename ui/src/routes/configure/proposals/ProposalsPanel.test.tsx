import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { replaceSettings } from "../../../api/endpoints";
import { MATCH_RULE_RESULTS, SETTINGS } from "../../../mocks/fixtures";
import { mockServer } from "../../../mocks/server";
import { SLICES_KEY } from "../../../shell/sessionState";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../../testing/keyboard";
import {
  COUNTRY_GATES,
  gatesAsked,
  watchResearch,
} from "../../../testing/research";
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
 * its own button, and a research pass goes one gate at a time, held to the spend cap (UI-01).
 */

const BASE = "/v1";
/** The mock's proposal, as the panel names it: the gate's and the candidate's catalog names. */
const PROPOSED_GATE = "A visa route exists";
const PROPOSED_FOR = "Portugal";
const CONFIRM_PROPOSED = `Confirm ${PROPOSED_GATE} for ${PROPOSED_FOR}`;
const PROPOSED_GATE_ID = "country.visa_route_exists";
const PROPOSED_FOR_ID = "country.portugal";
/** A proposal about a city, which the country level's panel never lists as its own. */
const A_CITY_PROPOSAL = {
  match_rule: "not_manually_excluded",
  candidate: "city.lisbon",
  match_result: "matching",
  data_source: "llm",
  retrieval_date: "2026-09-12T09:00:00Z",
  citations: ["https://example.gov/lisbon"],
  is_proposal: true,
};
const LEVELS_BEING_READ = "Reading which level each proposal is about…";

/**
 * How a pass over the mock's five gates ends when nothing interrupts it: three of them are gates
 * research can answer, at one call and four cents each, against an estimate of twelve cents.
 */
const ALL_ASKED =
  "The last pass at the Country level asked every gate: it asked 3 of 3 questions and spent €0.12 of at most €0.12.";

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

/** What a pass costs and asks, which every pass needs first. */
async function estimated(): Promise<void> {
  await userEvent.click(
    theProposals().getByRole("button", { name: "Estimate the research" }),
  );
  await theProposals().findByText(/3 questions to research/i);
}

/** An estimate, and then the pass it allows. */
async function researched(): Promise<void> {
  await estimated();
  await userEvent.click(
    theProposals().getByRole("button", { name: "Research the gates" }),
  );
}

/** The panel's own live region: a pass's progress while it runs, and how it ended after. */
function statusLine(): HTMLElement {
  return theProposals().getByRole("status");
}

async function passSays(text: string | RegExp): Promise<void> {
  await waitFor(() => expect(statusLine()).toHaveTextContent(text));
}

/**
 * The spend cap, stored as the settings panel would store it: the pass and the estimate read it,
 * and the mock's research refuses a pass with none, as the server does.
 */
async function capAt(eur: number | null): Promise<void> {
  await replaceSettings({ ...SETTINGS, run_spend_cap_eur: eur });
}

/** One request's answer, as the server sends it. */
function answered(outcome: {
  cost_eur: number;
  calls: number;
  halted_on_spend_cap?: boolean;
  refusals?: string[];
  proposals?: unknown[];
}): Response {
  return HttpResponse.json({
    proposals: [],
    refusals: [],
    halted_on_spend_cap: false,
    ...outcome,
  });
}

describe("what the panel shows", () => {
  it("lists a proposal with its pages, which are the point of asking", async () => {
    renderShell("/configure");
    await settled();

    // Scoped to this panel. A gate now states which candidates it rules out, so a candidate
    // appears in the Rules table too and a global row lookup matches both.
    const row = await theProposals().findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    expect(
      within(row).getByRole("link", { name: "https://example.gov/skilled-worker" }),
    ).toBeInTheDocument();
  });

  it("names the gate and the candidate in the row and in Confirm, never their ids", async () => {
    renderShell("/configure");
    await settled();

    const row = await theProposals().findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    expect(within(row).getByRole("rowheader")).toHaveTextContent(PROPOSED_GATE);
    expect(row).not.toHaveTextContent("country.");
    expect(
      await within(row).findByRole("button", { name: CONFIRM_PROPOSED }),
    ).toBeInTheDocument();
  });

  it("says Not matching rather than not_matching", async () => {
    renderShell("/configure");
    await settled();

    const row = await theProposals().findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    expect(row).toHaveTextContent("Not matching");
    expect(row).not.toHaveTextContent("not_matching");
  });

  it("falls back to the gate read as words when the gates cannot be read, and still lists it", async () => {
    mockServer.use(
      http.get(`${BASE}/match-rules`, ({ request }) =>
        new URL(request.url).searchParams.get("level") === null
          ? HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 })
          : undefined,
      ),
    );
    renderShell("/configure");
    await settled();

    const row = await theProposals().findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    expect(within(row).getByRole("rowheader")).toHaveTextContent("Visa route exists");
    expect(row).not.toHaveTextContent("country.");
  });

  /** PL-151. The level filter needs the roster; without it a proposal is kept, never hidden. */
  it("still lists a proposal when the roster that says its level cannot be read", async () => {
    mockServer.use(
      http.get(`${BASE}/candidates`, () =>
        HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 }),
      ),
    );
    renderShell("/configure");
    await screen.findByRole("region", { name: "Gate proposals" });

    expect(
      await theProposals().findByRole("row", { name: new RegExp(PROPOSED_FOR) }),
    ).toBeInTheDocument();
  });

  /**
   * The roster and the answers are read in parallel, and until the roster arrives no candidate
   * is placed at a level: a proposal about another level's candidate must not be listed, with a
   * live Confirm, as this level's in the meantime.
   */
  it("lists no proposal as this level's while the candidates that place it are still read", async () => {
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, () =>
        HttpResponse.json({ items: [...MATCH_RULE_RESULTS, A_CITY_PROPOSAL] }),
      ),
    );
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get(`${BASE}/candidates`, async () => {
        await held;
        return undefined;
      }),
    );
    renderShell("/configure");
    await screen.findByRole("region", { name: "Gate proposals" });

    expect(
      await theProposals().findByText(LEVELS_BEING_READ),
    ).toBeInTheDocument();
    expect(theProposals().queryByRole("button", { name: /^Confirm/ })).toBeNull();
    expect(theProposals().queryByRole("row", { name: /lisbon/i })).toBeNull();
    expect(theProposals().queryByText(/recorded by hand/i)).toBeNull();

    release();

    expect(
      await theProposals().findByRole("button", { name: CONFIRM_PROPOSED }),
    ).toBeInTheDocument();
    expect(theProposals().queryByText(LEVELS_BEING_READ)).toBeNull();
    expect(theProposals().queryByRole("row", { name: /lisbon/i })).toBeNull();
  });

  it("lists every level's proposals when the candidates cannot be read, says so, and reads them again", async () => {
    const candidates = { down: true };
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, () =>
        HttpResponse.json({ items: [...MATCH_RULE_RESULTS, A_CITY_PROPOSAL] }),
      ),
      http.get(`${BASE}/candidates`, () =>
        candidates.down
          ? HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 })
          : undefined,
      ),
    );
    renderShell("/configure");
    await screen.findByRole("region", { name: "Gate proposals" });

    expect(
      await theProposals().findByText(
        "The candidates could not be read, so which level each proposal is about is not known: every level's proposals are listed.",
      ),
    ).toBeInTheDocument();
    expect(theProposals().getByRole("row", { name: /lisbon/i })).toBeInTheDocument();
    candidates.down = false;

    await userEvent.click(
      theProposals().getByRole("button", { name: "Read the candidates again" }),
    );

    await waitFor(() =>
      expect(theProposals().queryByRole("row", { name: /lisbon/i })).toBeNull(),
    );
    expect(theProposals().getByRole("row", { name: new RegExp(PROPOSED_FOR) })).toBeInTheDocument();
  });

  it("prints a page that is not a web address as text, never as a link", async () => {
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, () =>
        HttpResponse.json({
          items: [
            {
              match_rule: "country.visa_route_exists",
              candidate: "country.portugal",
              match_result: "not_matching",
              data_source: "llm",
              retrieval_date: "2026-09-12T09:00:00Z",
              citations: ["javascript:alert(1)", "https://example.gov/skilled-worker"],
              is_proposal: true,
            },
          ],
        }),
      ),
    );
    renderShell("/configure");
    await settled();

    const row = await theProposals().findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    expect(within(row).getByText("javascript:alert(1)")).toBeInTheDocument();
    expect(within(row).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://example.gov/skilled-worker",
    ]);
  });

  it("says a proposal rules nothing out, rather than leaving it implied", async () => {
    renderShell("/configure");
    await settled();

    expect(
      screen.getByText(/a proposal rules nothing out/i),
    ).toBeInTheDocument();
  });

  it("leaves confirmed answers out of the list, and does not count them", async () => {
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

    // The recorded answers are listed under Gate answers, so this panel no longer counts them.
    expect(await theProposals().findByText("No proposal is waiting.")).toBeInTheDocument();
    expect(theProposals().queryByText(/recorded by hand/i)).not.toBeInTheDocument();
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

    expect(await screen.findByText(/3 questions to research/i)).toBeInTheDocument();
    expect(screen.getByText(/at most €0\.12/)).toBeInTheDocument();
    expect(screen.getByText(/a ceiling, not a forecast/i)).toHaveTextContent(
      /12,000 input tokens per call/,
    );
  });

  it("estimating spends nothing, because it is asked instead of the pass", async () => {
    const research = watchResearch();
    renderShell("/configure");
    await settled();

    await estimated();

    expect(research.sent).toEqual([]);
  });

  it("sends the uncapped acceptance with every request of a pass, only when it is given", async () => {
    /**
     * The bypass of `reqs.md` 6.3, Q220: refused by default, allowed when somebody says so, per
     * pass and never remembered. Offered only after an estimate, because agreeing to an uncapped
     * spend before seeing the figure is the decision this panel exists to prevent.
     */
    const research = watchResearch();
    renderShell("/configure");
    await settled();
    await researched();
    await passSays(ALL_ASKED);

    await capAt(null);
    await estimated();
    await userEvent.click(
      theProposals().getByRole("checkbox", { name: /accept an uncapped spend/i }),
    );
    await userEvent.click(
      theProposals().getByRole("button", { name: "Research the gates" }),
    );
    await waitFor(() => expect(research.sent).toHaveLength(10));
    await waitFor(() => expect(research.answered).toBe(10));

    expect(research.sent.map((body) => body.accept_uncapped_spend)).toEqual([
      ...Array<boolean>(5).fill(false),
      ...Array<boolean>(5).fill(true),
    ]);
  });

  it("does not carry the acceptance into the next pass", async () => {
    // **Per pass, never remembered** -- which the panel's own comment claimed while the
    // checkbox stayed ticked, so one agreement authorised every later pass in silence.
    const research = watchResearch();
    await capAt(null);
    renderShell("/configure");
    await settled();
    await estimated();
    await userEvent.click(
      theProposals().getByRole("checkbox", { name: /accept an uncapped spend/i }),
    );
    await userEvent.click(
      theProposals().getByRole("button", { name: "Research the gates" }),
    );
    await passSays(ALL_ASKED);

    await estimated();
    expect(
      theProposals().getByRole("checkbox", { name: /accept an uncapped spend/i }),
    ).not.toBeChecked();
    await userEvent.click(
      theProposals().getByRole("button", { name: "Research the gates" }),
    );
    // Refused at the first gate research can answer, as the server refuses a pass with no cap
    // and no acceptance: nothing after it is asked.
    await passSays(/was refused at A visa route exists, which spent nothing/);

    expect(research.sent.map((body) => body.accept_uncapped_spend)).toEqual([
      ...Array<boolean>(5).fill(true),
      false,
    ]);
  });

  /** PL-160. The cap a pass halts at is said with the estimate, and an uncapped pass is not offered. */
  it("states the cap with the estimate, and offers no uncapped pass when a cap is set", async () => {
    await capAt(2.5);
    renderShell("/configure");
    await settled();
    await estimated();

    expect(theProposals().getByText("Halts at the €2.50 spend cap.")).toBeInTheDocument();
    expect(
      theProposals().queryByRole("checkbox", { name: /accept an uncapped spend/i }),
    ).toBeNull();
  });

  it("offers an uncapped pass, saying no cap is set, only when none is", async () => {
    await capAt(null);
    renderShell("/configure");
    await settled();
    await estimated();

    expect(
      theProposals().getByRole("checkbox", { name: /no spend cap is set/i }),
    ).not.toBeChecked();
    expect(theProposals().queryByText(/spend cap\.$/)).toBeNull();
  });

  /**
   * PL-160. **A refusal that spent nothing keeps the estimate**: refused for want of a cap, the
   * answer is to tick the box and press Research again, which a lost estimate made two steps.
   */
  it("keeps the estimate after a pass refused for want of a cap, and the next press accepts", async () => {
    const research = watchResearch();
    await capAt(null);
    renderShell("/configure");
    await settled();
    await researched();
    await passSays(/was refused at A visa route exists, which spent nothing/);

    expect(theProposals().getByText(/3 questions to research/i)).toBeInTheDocument();
    await userEvent.click(
      theProposals().getByRole("checkbox", { name: /accept an uncapped spend/i }),
    );
    await userEvent.click(
      theProposals().getByRole("button", { name: "Research the gates" }),
    );
    await passSays(ALL_ASKED);
    expect(research.sent.at(-1)?.accept_uncapped_spend).toBe(true);
  });

  it("asks for a fresh estimate after a refusal that came once the pass had spent", async () => {
    watchResearch({
      answer: (_body, index) =>
        index === 1
          ? answered({ cost_eur: 0.04, calls: 1 })
          : HttpResponse.json(
              { code: "spend_cap_not_set", message: "no spend cap is set" },
              { status: 409 },
            ),
    });
    renderShell("/configure");
    await settled();
    await researched();
    await passSays(/was refused at Free movement applies, which spent nothing/);

    expect(theProposals().queryByText(/questions to research/i)).toBeNull();
    expect(
      theProposals().queryByRole("button", { name: "Research the gates" }),
    ).toBeNull();
  });

  it("shows the refusal when no spend cap is set", async () => {
    watchResearch({
      answer: () =>
        HttpResponse.json(
          {
            code: "spend_cap_not_set",
            message:
              "this would spend money and no spend cap is set; set run_spend_cap_eur or accept an uncapped run",
          },
          { status: 409 },
        ),
    });
    renderShell("/configure");
    await settled();

    await researched();

    expect(await screen.findByText(/no spend cap is set/i)).toBeInTheDocument();
  });

  it("names a gate the model answered without citing anything", async () => {
    /** An answer with no pages is an opinion, and nothing is stored for it -- so the screen
     * says which gate is still open rather than letting it vanish. */
    watchResearch({
      answer: ({ match_rules }) =>
        match_rules?.[0] === "country.residence_quota_open"
          ? answered({
              cost_eur: 0.04,
              calls: 1,
              refusals: [
                "country.residence_quota_open for country.estonia: the model cited nothing",
              ],
            })
          : undefined,
    });
    renderShell("/configure");
    await settled();

    await researched();

    expect(await screen.findByText(/the model cited nothing/i)).toBeInTheDocument();
  });

  it("lists what the model cited nothing for, from every request of the pass", async () => {
    watchResearch({
      answer: ({ match_rules }) => {
        const gate = match_rules?.[0];
        return gate === "country.visa_route_exists" ||
          gate === "country.uk_skilled_worker"
          ? answered({
              cost_eur: 0.04,
              calls: 1,
              refusals: [`${gate}: the model cited nothing`],
            })
          : undefined;
      },
    });
    renderShell("/configure");
    await settled();

    await researched();
    await passSays(/asked every gate/);

    const uncited = theProposals().getByRole("list", {
      name: /asked, but nothing was stored/i,
    });
    expect(
      within(uncited)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "country.visa_route_exists: the model cited nothing",
      "country.uk_skilled_worker: the model cited nothing",
    ]);
  });

  /**
   * NEW-63. **A proposal a person's answer displaced is listed too, and it cited its pages.**
   * The server reports it among the refusals because the call was billed and nothing was
   * stored -- so the heading over them must not say the model cited nothing, which is true of
   * only one of the two causes. Each line carries its own reason.
   */
  it("lists a proposal a person's answer displaced without saying it cited nothing", async () => {
    const displaced =
      "country.uk_skilled_worker for country.united_kingdom: a person answered this gate " +
      "while the pass ran, so the proposal was not stored";
    watchResearch({
      answer: ({ match_rules }) =>
        match_rules?.[0] === "country.uk_skilled_worker"
          ? answered({ cost_eur: 0.04, calls: 1, refusals: [displaced] })
          : undefined,
    });
    renderShell("/configure");
    await settled();

    await researched();
    await passSays(/asked every gate/);

    const notStored = theProposals().getByRole("list", {
      name: /asked, but nothing was stored/i,
    });
    expect(within(notStored).getByRole("listitem")).toHaveTextContent(displaced);
    expect(
      theProposals().queryByText(/without citing anything/i),
    ).not.toBeInTheDocument();
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
            match_rule: PROPOSED_GATE_ID,
            candidate: PROPOSED_FOR_ID,
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
      await screen.findByText(/not there any more/i),
    ).toBeInTheDocument();
  });
});

/**
 * UI-01. **A research pass went as one request for the whole level** -- every gate about every
 * candidate inside it -- and a request that long has no proxy ceiling that is safe. It goes one
 * gate at a time now: each request is one gate's question, the server asks only the gates
 * research can answer, and the page holds the whole pass to the spend cap, because the server's
 * meter starts again with every request.
 */
describe("a research pass, one gate at a time", () => {
  it("asks about every gate at the level, one per request, and names no candidate", async () => {
    const research = watchResearch();
    renderShell("/configure");
    await settled();

    await researched();
    await passSays(ALL_ASKED);

    expect(gatesAsked(research)).toEqual(COUNTRY_GATES.map((gate) => [gate]));
    expect(research.sent.map((body) => body.level)).toEqual(
      COUNTRY_GATES.map(() => "country"),
    );
    expect(research.sent.filter((body) => "candidates" in body)).toEqual([]);
  });

  it("asks the gates in the order the catalog lists them", async () => {
    mockServer.use(
      http.get(`${BASE}/match-rules`, () =>
        HttpResponse.json({
          items: [
            { id: "country.uk_skilled_worker", name: "UK Skilled Worker route", level: "country" },
            { id: "not_manually_excluded", name: "Not excluded by hand", level: null },
            { id: "country.visa_route_exists", name: "A visa route exists", level: "country" },
          ],
        }),
      ),
    );
    const research = watchResearch();
    renderShell("/configure");
    await settled();

    await researched();
    await passSays(/asked every gate: it asked 2 of 3 questions/);

    expect(gatesAsked(research)).toEqual([
      ["country.uk_skilled_worker"],
      ["not_manually_excluded"],
      ["country.visa_route_exists"],
    ]);
  });

  it("stops before the next gate once the pass has spent the cap", async () => {
    await capAt(0.08);
    const research = watchResearch();
    renderShell("/configure");
    await settled();

    await researched();

    await passSays(
      "The last pass at the Country level stopped at the spend cap of €0.08: it asked 2 of 3 questions and spent €0.08 of at most €0.12.",
    );
    // Two gates research can answer, at four cents each, and the free ones between them.
    expect(gatesAsked(research)).toEqual(
      COUNTRY_GATES.slice(0, 4).map((gate) => [gate]),
    );
    expect(statusLine()).toHaveClass("notice--warning");
  });

  it("asks every gate with no cap set, once the reader has accepted an uncapped pass", async () => {
    await capAt(null);
    const research = watchResearch();
    renderShell("/configure");
    await settled();
    await estimated();
    await userEvent.click(
      theProposals().getByRole("checkbox", { name: /accept an uncapped spend/i }),
    );

    await userEvent.click(
      theProposals().getByRole("button", { name: "Research the gates" }),
    );

    await passSays(ALL_ASKED);
    expect(gatesAsked(research)).toEqual(COUNTRY_GATES.map((gate) => [gate]));
  });

  it("ends when the server says it stopped at the spend cap", async () => {
    const research = watchResearch({
      answer: (_body, index) =>
        index === 2
          ? answered({ cost_eur: 0, calls: 0, halted_on_spend_cap: true })
          : undefined,
    });
    renderShell("/configure");
    await settled();

    await researched();

    await passSays(
      "The last pass at the Country level stopped at the spend cap of €10.00: it asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    );
    expect(research.sent).toHaveLength(2);
  });

  it("ends after one request when the first is refused", async () => {
    const research = watchResearch({
      answer: () =>
        HttpResponse.json(
          {
            code: "spend_cap_not_set",
            message: "this would spend money and no spend cap is set",
          },
          { status: 409 },
        ),
    });
    renderShell("/configure");
    await settled();

    await researched();

    expect(
      await theProposals().findByText(/no spend cap is set/i),
    ).toBeInTheDocument();
    await passSays(
      "The last pass at the Country level was refused at A visa route exists, which spent nothing: it asked 0 of 3 questions and spent nothing.",
    );
    expect(research.sent).toHaveLength(1);
  });

  it("ends on a failure, and says what that request spent is not known", async () => {
    const research = watchResearch({
      answer: (_body, index) => (index === 2 ? HttpResponse.error() : undefined),
    });
    renderShell("/configure");
    await settled();

    await researched();

    expect(
      await theProposals().findByText(/backend did not answer/i),
    ).toBeInTheDocument();
    await passSays(
      "The last pass at the Country level failed at Free movement applies, and what that request spent is not known: before it, the pass asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    );
    expect(research.sent).toHaveLength(2);
  });

  it("asks nothing when the spend cap cannot be read, and says the pass did not start", async () => {
    const research = watchResearch();
    renderShell("/configure");
    await settled();
    await estimated();
    mockServer.use(
      http.get(`${BASE}/settings`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "the settings could not be read" },
          { status: 500 },
        ),
      ),
    );

    await userEvent.click(
      theProposals().getByRole("button", { name: "Research the gates" }),
    );

    expect(
      await theProposals().findByText("The server failed while answering."),
    ).toBeInTheDocument();
    await passSays(
      "The last pass at the Country level did not start, because the spend cap and the gates could not be read: it asked nothing and spent nothing.",
    );
    expect(research.sent).toEqual([]);
    expect(statusLine()).toHaveClass("notice--warning");
  });

  it("says how far it has got while it runs", async () => {
    const research = watchResearch({ holdAt: 2 });
    renderShell("/configure");
    await settled();

    await researched();

    await passSays(
      "Asking Free movement applies at the Country level. So far 1 of 3 questions, €0.04 spent of at most €0.12.",
    );
    research.release();
    await passSays(ALL_ASKED);
  });

  it("asks nothing more once Stop is pressed, and says you stopped it", async () => {
    const research = watchResearch({ holdAt: 2 });
    renderShell("/configure");
    await settled();
    await researched();
    await waitFor(() => expect(research.sent).toHaveLength(2));

    await userEvent.click(
      theProposals().getByRole("button", { name: "Stop after this question" }),
    );

    expect(statusLine()).toHaveTextContent(
      "Stopping once Free movement applies is answered at the Country level.",
    );
    research.release();
    await passSays(
      "You stopped the last pass at the Country level: it asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    );
    expect(research.sent).toHaveLength(2);
    expect(statusLine()).not.toHaveClass("notice--warning");
  });

  /**
   * UIC-A2. **A pass that stored nothing still reads the answers again.** A person who answered
   * a gate while the pass ran displaces the model's proposal, so the answers moved under a pass
   * that proposed nothing -- and an outdated proposal on screen was confirmable once it ended.
   */
  it("reads the answers again after a pass that only met a person's answer", async () => {
    const order: string[] = [];
    const log = ({ request }: { request: Request }) => {
      const path = new URL(request.url).pathname;
      if (path === `${BASE}/match-rule-research` || path === `${BASE}/match-rule-results`) {
        order.push(`${request.method} ${path}`);
      }
    };
    mockServer.events.on("request:start", log);
    onTestFinished(() => mockServer.events.removeListener("request:start", log));
    watchResearch({
      answer: ({ match_rules }) =>
        answered({
          cost_eur: 0.04,
          calls: 1,
          refusals:
            match_rules?.[0] === "country.uk_skilled_worker"
              ? ["a person answered this gate while the pass ran, so the proposal was not stored"]
              : [],
        }),
    });
    renderShell("/configure");
    await settled();

    await researched();
    await passSays(/asked every gate/);

    await waitFor(() =>
      expect(order.slice(order.lastIndexOf(`POST ${BASE}/match-rule-research`) + 1)).toContain(
        `GET ${BASE}/match-rule-results`,
      ),
    );
  });

  /**
   * RD-1. **The cap can stop an answer after it has stored a proposal.** The gate is not counted
   * as asked, so a pass ended by its very first answer read nothing again, and the proposal it
   * paid for was missing from the list -- or an older one stayed confirmable in its place.
   */
  it("reads the answers again when the first answer proposed and then met the cap", async () => {
    const order: string[] = [];
    const log = ({ request }: { request: Request }) => {
      const path = new URL(request.url).pathname;
      if (path === `${BASE}/match-rule-research` || path === `${BASE}/match-rule-results`) {
        order.push(`${request.method} ${path}`);
      }
    };
    mockServer.events.on("request:start", log);
    onTestFinished(() => mockServer.events.removeListener("request:start", log));
    const research = watchResearch({
      answer: (_body, index) =>
        index === 1
          ? answered({ cost_eur: 0.04, calls: 1, halted_on_spend_cap: true, proposals: [{}] })
          : undefined,
    });
    renderShell("/configure");
    await settled();

    await researched();
    await passSays(/stopped at the spend cap/);

    expect(research.sent).toHaveLength(1);
    await waitFor(() =>
      expect(order.slice(order.lastIndexOf(`POST ${BASE}/match-rule-research`) + 1)).toContain(
        `GET ${BASE}/match-rule-results`,
      ),
    );
  });

  it("reads the answers again once, at the end of the pass, not after every question", async () => {
    const order: string[] = [];
    const log = ({ request }: { request: Request }) => {
      const path = new URL(request.url).pathname;
      if (path === `${BASE}/match-rule-research` || path === `${BASE}/match-rule-results`) {
        order.push(`${request.method} ${path}`);
      }
    };
    mockServer.events.on("request:start", log);
    onTestFinished(() => mockServer.events.removeListener("request:start", log));
    // Held half way, so the screen draws the pass mid-flight: unheld, every answer lands in one
    // turn of the event loop, and a read after each question would be batched into one.
    const research = watchResearch({ holdAt: 3 });
    renderShell("/configure");
    await settled();

    await researched();
    await passSays("Asking Not excluded by hand at the Country level");
    research.release();

    // What the pass stored, in this list and in the gate's own sentence above it.
    expect(
      await theProposals().findByRole("button", {
        name: "Confirm UK Skilled Worker route for United Kingdom",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("region", { name: "Match rules & gates" }),
        ).getByRole("listitem", { name: "UK Skilled Worker route" }),
      ).toHaveTextContent(/1 proposed answer awaits confirmation/),
    );
    expect(order.slice(order.indexOf(`POST ${BASE}/match-rule-research`))).toEqual([
      ...COUNTRY_GATES.map(() => `POST ${BASE}/match-rule-research`),
      // One each for the proposals, the rules and the gate answers.
      `GET ${BASE}/match-rule-results`,
      `GET ${BASE}/match-rule-results`,
      `GET ${BASE}/match-rule-results`,
    ]);
  });
});

/**
 * UI-14. **What a pass actually spent, and whether it was cut short.** Each answer carries the
 * cost, the calls and whether the cap stopped it; the panel kept only the refusals, so a pass
 * halted half way looked finished and the estimate was the only figure on screen.
 */
describe("what a research pass did", () => {
  it("keeps an empty status line in place before any pass", async () => {
    renderShell("/configure");
    await settled();

    expect(statusLine()).toBeEmptyDOMElement();
  });

  it("says what the pass actually spent, beside what it was estimated to", async () => {
    renderShell("/configure");
    await settled();

    await researched();

    await passSays(ALL_ASKED);
    expect(statusLine()).not.toHaveClass("notice--warning");
  });

  it("says a pass that asked nothing charged nothing", async () => {
    watchResearch({ answer: () => answered({ cost_eur: 0, calls: 0 }) });
    renderShell("/configure");
    await settled();

    await researched();

    await passSays(
      "The last pass at the Country level asked every gate: it asked 0 of 3 questions and spent nothing.",
    );
  });

  it("needs a fresh estimate before another pass, since the last one spent it", async () => {
    renderShell("/configure");
    await settled();
    await researched();
    await passSays(ALL_ASKED);

    expect(
      theProposals().queryByRole("button", { name: "Research the gates" }),
    ).toBeNull();
    expect(theProposals().queryByText(/3 questions to research/i)).toBeNull();

    await estimated();
    expect(
      theProposals().getByRole("button", { name: "Research the gates" }),
    ).toBeInTheDocument();
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
              match_rule: PROPOSED_GATE_ID,
              candidate: PROPOSED_FOR_ID,
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

  /** PL-161. When the model read the pages, beside the period the answer holds for. */
  it("says when the pages were read, beside the period", async () => {
    servingProposal({ start: "2026-01-01", end: "2026-12-31" });
    renderShell("/configure");
    await settled();

    const row = await theProposals().findByRole("row", { name: new RegExp(PROPOSED_FOR) });
    const readOn = theProposals().getByRole("columnheader", { name: "Read on" });
    const holdsFor = theProposals().getByRole("columnheader", { name: "Holds for" });
    expect(holdsFor.nextElementSibling).toBe(readOn);
    expect(within(row).getAllByRole("cell")[3]).toHaveTextContent("12 Sept 2026");
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
  const NOT_KNOWN = /not known/i;

  async function researchOnceThenAgain(failure: () => Response): Promise<void> {
    renderShell("/configure");
    await settled();
    await researched();
    await passSays(ALL_ASKED);

    mockServer.use(http.post(`${BASE}/match-rule-research`, failure));
    await researched();
  }

  it("shows no earlier pass's spend once a later pass fails on the server", async () => {
    await researchOnceThenAgain(() =>
      HttpResponse.json(
        { code: "internal_error", message: "the model provider failed" },
        { status: 500 },
      ),
    );

    expect(
      await screen.findByText("The server failed while answering."),
    ).toBeInTheDocument();
    await passSays(/failed at A visa route exists/);
    expect(screen.queryByText(ALL_ASKED)).toBeNull();
    // A server failure may come after calls that were billed.
    expect(statusLine()).toHaveTextContent(NOT_KNOWN);
  });

  /** The earlier pass's outcome, said beside a later start that asked nothing (PL-052). */
  const KEPT_ALL_ASKED =
    "The pass before it at the Country level asked every gate: it asked 3 of 3 questions and spent €0.12 of at most €0.12.";

  it("keeps the earlier pass's spend beside a later pass refused before it asked anything", async () => {
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
    await passSays(/refused at A visa route exists, which spent nothing/);
    expect(theProposals().getByText(KEPT_ALL_ASKED)).toBeInTheDocument();
    // Refused before the model was asked anything, so nothing about its spend is in doubt.
    expect(statusLine()).not.toHaveTextContent(NOT_KNOWN);

    await userEvent.click(screen.getByRole("link", { name: "Acquire" }));
    await userEvent.click(await screen.findByRole("link", { name: "Configure" }));
    await settled();
    await passSays(ALL_ASKED);
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
    expect(screen.queryByText("llm_not_configured")).toBeNull();
    await passSays(/refused at A visa route exists, which spent nothing/);
    expect(theProposals().getByText(KEPT_ALL_ASKED)).toBeInTheDocument();
    expect(statusLine()).not.toHaveTextContent(NOT_KNOWN);
  });

  it("says the spend is not known when the backend could not be reached", async () => {
    await researchOnceThenAgain(() => HttpResponse.error());

    expect(
      await screen.findByText(/backend did not answer/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(ALL_ASKED)).toBeNull();
    await passSays(NOT_KNOWN);
  });

  it("says the spend is not known when the proxy timed the request out", async () => {
    await researchOnceThenAgain(
      () =>
        new HttpResponse("<html>504 Gateway Time-out</html>", {
          status: 504,
          headers: { "Content-Type": "text/html" },
        }),
    );

    expect(await screen.findByText(/backend did not answer/i)).toBeInTheDocument();
    expect(screen.queryByText(ALL_ASKED)).toBeNull();
    await passSays(NOT_KNOWN);
  });

  it("drops an earlier pass's refusals when a later pass fails", async () => {
    watchResearch({
      answer: () =>
        answered({
          cost_eur: 0.02,
          calls: 1,
          refusals: ["country.eu_free_movement for country.malta: the model cited nothing"],
        }),
    });
    renderShell("/configure");
    await settled();
    await researched();
    await passSays(/asked every gate/);
    expect(theProposals().getAllByText(/the model cited nothing/i)).toHaveLength(5);

    mockServer.use(
      http.post(`${BASE}/match-rule-research`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "the model provider failed" },
          { status: 500 },
        ),
      ),
    );
    await researched();

    expect(
      await screen.findByText("The server failed while answering."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/the model cited nothing/i)).toBeNull();
  });

  it("replaces the first pass's spend with the second's", async () => {
    await researchOnceThenAgain(() => answered({ cost_eur: 0.01, calls: 1 }));

    await passSays(
      "The last pass at the Country level asked every gate: it asked 5 of 3 questions and spent €0.05 of at most €0.12.",
    );
    expect(screen.queryByText(ALL_ASKED)).toBeNull();
  });
});

/**
 * NEW-44. **Held, never disabled** -- NEW-34's rule, which this panel was written before. Its
 * buttons took the native `disabled` while an estimate, a pass or a confirmation was in flight,
 * and Chromium throws focus off a control the moment it is disabled and does not give it back:
 * a keyboard user who estimated, researched or confirmed was put back on the page every time.
 * jsdom keeps focus on a disabled control, which is why these follow Chromium's rule.
 *
 * **A pass is held for as long as it runs** (UI-01): one request per gate, so the buttons stay
 * held across every question, and Estimate, Research and every Confirm turn a press away.
 */
describe("the gate proposals while a write is in flight", () => {
  beforeEach(() => followChromiumFocusFixup());

  /**
   * Every request to one endpoint, counted and held until the test lets go -- then answered as
   * given, or by the mock behind it when nothing is given.
   */
  function hold(
    method: "post" | "put",
    path: string,
    answer?: () => Response,
  ): { sent: number; release: () => void } {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes = { sent: 0, release: () => release() };
    mockServer.use(
      http[method](`${BASE}${path}`, async () => {
        writes.sent += 1;
        await held;
        return answer?.();
      }),
    );
    return writes;
  }

  const CONFIRM = `Confirm ${PROPOSED_GATE} for ${PROPOSED_FOR}`;
  const CONFIRMATIONS = "/match-rule-results/:matchRuleId/:candidateId";

  function refused(message: string): () => Response {
    return () =>
      HttpResponse.json({ code: "internal_error", message }, { status: 500 });
  }

  function estimateButton(): HTMLElement {
    return theProposals().getByRole("button", { name: "Estimate the research" });
  }

  it("keeps focus on Estimate while it estimates, and a second Enter sends nothing", async () => {
    const user = userEvent.setup();
    const estimates = hold("post", "/match-rule-research/plan");
    renderShell("/configure");
    await settled();
    const estimate = estimateButton();
    act(() => estimate.focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(estimates.sent).toBe(1));

    expect(estimate).toHaveFocus();
    expectHeld(estimate);
    expect(estimate).toHaveTextContent("Estimating…");
    expectHeld(theProposals().getByRole("button", { name: CONFIRM }));
    await user.keyboard("{Enter}");

    estimates.release();

    expect(
      await theProposals().findByText(/3 questions to research/i),
    ).toBeInTheDocument();
    await waitFor(() => expectNotHeld(estimate));
    expect(estimate).toHaveFocus();
    expectNotHeld(theProposals().getByRole("button", { name: CONFIRM }));
    await user.keyboard("{Enter}");
    // The third Enter's request arriving is what proves the second sent nothing.
    await waitFor(() => expect(estimates.sent).toBe(2));
  });

  /** PL-004, P1-14: an estimate spends nothing, so its refusal offers to send it again. */
  it.each([
    ["answers", 1, "Gate proposals"],
    ["is refused again", 2, "The estimate did not go through"],
  ])("sends a refused estimate again on Try again, which %s", async (_case, refusals, expected) => {
    let sent = 0;
    mockServer.use(
      http.post(`${BASE}/match-rule-research/plan`, () => {
        sent += 1;
        return sent <= refusals ? refused("SENTINEL_MESSAGE")() : undefined;
      }),
    );
    renderShell("/configure");
    await settled();
    await userEvent.click(estimateButton());
    const refusal = within(await theProposals().findByRole("alert"));
    expect(refusal.getByText("The estimate did not go through")).toBeInTheDocument();

    await userEvent.click(refusal.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(sent).toBe(2));
    if (refusals === 1) {
      expect(await theProposals().findByText(/questions to research/i)).toBeInTheDocument();
      expect(theProposals().queryByRole("alert")).toBeNull();
    } else {
      expect(await theProposals().findByText(expected)).toBeInTheDocument();
    }
  });

  it("offers Dismiss and no Try again when a confirmation was refused", async () => {
    hold("put", CONFIRMATIONS, refused("SENTINEL_MESSAGE")).release();
    renderShell("/configure");
    await settled();
    await userEvent.click(await theProposals().findByRole("button", { name: CONFIRM }));

    const refusal = within(await theProposals().findByRole("alert"));
    expect(refusal.getByText("The confirmation did not go through")).toBeInTheDocument();
    expect(refusal.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("lets go of Estimate after a refused estimate, with focus still on it", async () => {
    const user = userEvent.setup();
    const estimates = hold(
      "post",
      "/match-rule-research/plan",
      refused("the planner failed"),
    );
    renderShell("/configure");
    await settled();
    const estimate = estimateButton();
    act(() => estimate.focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(estimates.sent).toBe(1));
    expectHeld(estimate);
    estimates.release();

    expect(
      await theProposals().findByText("The server failed while answering."),
    ).toBeInTheDocument();
    await waitFor(() => expectNotHeld(estimate));
    expect(estimate).toBeEnabled();
    expect(estimate).toHaveFocus();
  });

  it("keeps focus on Research the gates while the pass runs, and a second Enter starts nothing", async () => {
    const user = userEvent.setup();
    const research = watchResearch({ holdAt: 1 });
    renderShell("/configure");
    await settled();
    await estimated();
    const start = theProposals().getByRole("button", {
      name: "Research the gates",
    });
    act(() => start.focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(research.sent).toHaveLength(1));

    expect(start).toHaveFocus();
    expectHeld(start);
    expect(start).toHaveTextContent("Researching…");
    expectHeld(estimateButton());
    expectHeld(theProposals().getByRole("button", { name: CONFIRM }));
    await user.keyboard("{Enter}");

    research.release();

    await passSays(ALL_ASKED);
    // One request per gate, once: the second Enter started no pass of its own.
    expect(research.sent).toHaveLength(5);
  });

  /**
   * **The estimate is spent by the pass it allowed**, so Research the gates leaves the page when
   * the pass ends -- and a keyboard user standing on it would be put back on the page. Estimate is
   * the act the next pass needs, so that is where focus goes.
   */
  it("puts focus on Estimate when the pass ends and takes Research the gates with it", async () => {
    const user = userEvent.setup();
    watchResearch();
    renderShell("/configure");
    await settled();
    await estimated();
    const start = theProposals().getByRole("button", {
      name: "Research the gates",
    });
    act(() => start.focus());

    await user.keyboard("{Enter}");

    await passSays(ALL_ASKED);
    expect(
      theProposals().queryByRole("button", { name: "Research the gates" }),
    ).toBeNull();
    await waitFor(() => expect(estimateButton()).toHaveFocus());
  });

  it("puts focus on Estimate after a failed pass, with Research the gates gone", async () => {
    const user = userEvent.setup();
    const research = watchResearch({
      holdAt: 1,
      answer: refused("the model provider failed"),
    });
    renderShell("/configure");
    await settled();
    await estimated();
    const start = theProposals().getByRole("button", {
      name: "Research the gates",
    });
    act(() => start.focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(research.sent).toHaveLength(1));
    expectHeld(start);
    research.release();

    expect(
      await theProposals().findByText("The server failed while answering."),
    ).toBeInTheDocument();
    await waitFor(() => expect(estimateButton()).toHaveFocus());
    expectNotHeld(estimateButton());
  });

  it("leaves focus where the reader put it when a pass ends", async () => {
    const research = watchResearch({ holdAt: 2 });
    renderShell("/configure");
    await settled();
    await researched();
    await waitFor(() => expect(research.sent).toHaveLength(2));
    const picker = screen.getByRole("combobox", { name: /active criteria set/i });
    act(() => picker.focus());

    research.release();

    await passSays(ALL_ASKED);
    expect(picker).toHaveFocus();
  });

  it("keeps Stop held once pressed, with focus on it, and asks nothing more", async () => {
    const user = userEvent.setup();
    const research = watchResearch({ holdAt: 1 });
    renderShell("/configure");
    await settled();
    await researched();
    await waitFor(() => expect(research.sent).toHaveLength(1));
    const stop = theProposals().getByRole("button", {
      name: "Stop after this question",
    });
    act(() => stop.focus());

    await user.keyboard("{Enter}");

    expect(stop).toHaveFocus();
    expectHeld(stop);
    expect(stop).toHaveTextContent("Stopping after this question…");
    await user.keyboard("{Enter}");
    research.release();

    await passSays("You stopped the last pass at the Country level: it asked 1 of 3 questions");
    expect(research.sent).toHaveLength(1);
    await waitFor(() => expect(estimateButton()).toHaveFocus());
  });

  it("keeps focus on Confirm while it is written, and lets go of it when refused", async () => {
    const user = userEvent.setup();
    const confirmations = hold(
      "put",
      CONFIRMATIONS,
      refused("there is no candidate country.portugal"),
    );
    renderShell("/configure");
    await settled();
    const confirm = await theProposals().findByRole("button", {
      name: CONFIRM,
    });
    act(() => confirm.focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(confirmations.sent).toBe(1));

    expect(confirm).toHaveFocus();
    expectHeld(confirm);
    expectHeld(
      theProposals().getByRole("button", { name: "Estimate the research" }),
    );
    await user.keyboard("{Enter}");

    confirmations.release();

    expect(
      await theProposals().findByText("The server failed while answering."),
    ).toBeInTheDocument();
    await waitFor(() => expectNotHeld(confirm));
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(confirmations.sent).toBe(2));
  });

  /**
   * Two proposals for one gate, held as the server holds them: confirming one turns it into a
   * person's answer, so the next read lists it no longer.
   */
  function twoProposals(): void {
    const answers: Record<string, unknown>[] = [PROPOSED_FOR_ID, "country.spain"].map(
      (candidate) => ({
        match_rule: PROPOSED_GATE_ID,
        candidate,
        match_result: "matching",
        data_source: "llm",
        retrieval_date: "2026-09-12T09:00:00Z",
        citations: ["https://example.gov/skilled-worker"],
        is_proposal: true,
      }),
    );
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, () =>
        HttpResponse.json({ items: answers }),
      ),
      http.put(`${BASE}${CONFIRMATIONS}`, async ({ params, request }) => {
        const at = answers.findIndex(
          (answer) =>
            answer["match_rule"] === params["matchRuleId"] &&
            answer["candidate"] === params["candidateId"],
        );
        answers[at] = {
          ...answers[at],
          ...((await request.json()) as Record<string, unknown>),
          is_proposal: false,
        };
        return HttpResponse.json(answers[at]);
      }),
    );
  }

  /**
   * NEW-45. **A confirmed proposal leaves the table, and its button with it** -- which put a
   * keyboard user back on the page. Focus goes to the next proposal's Confirm, so a review goes
   * on where it was; to Estimate, the panel's next act, once none is left.
   */
  it("moves focus to the next proposal's Confirm once one is confirmed", async () => {
    twoProposals();
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    const confirm = await theProposals().findByRole("button", {
      name: CONFIRM,
    });
    act(() => confirm.focus());

    await user.keyboard("{Enter}");

    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        theProposals().getByRole("button", {
          name: `Confirm ${PROPOSED_GATE} for Spain`,
        }),
      ).toHaveFocus(),
    );
  });

  it("moves focus to Estimate once the last proposal is confirmed", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    const confirm = await theProposals().findByRole("button", {
      name: CONFIRM,
    });
    act(() => confirm.focus());

    await user.keyboard("{Enter}");

    await theProposals().findByText(/no proposal is waiting/i);
    await waitFor(() => expect(estimateButton()).toHaveFocus());
  });

  /**
   * Every read of the answers made once `start()` is called, held until the test lets go, then
   * answered by the mock behind it. **From `start()`**, so the panel's first read goes through.
   */
  function holdAnswerReads(): {
    start: () => void;
    asked: () => boolean;
    release: () => void;
  } {
    let holding = false;
    let asked = false;
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, async () => {
        if (!holding) return;
        asked = true;
        await held;
      }),
    );
    return {
      start: () => {
        holding = true;
      },
      asked: () => asked,
      release: () => release(),
    };
  }

  /**
   * NEW-45. **The table stays while a pass's answers are read again, and is held until they
   * land.** The read used to blank it into "Loading…", taking the Confirm a keyboard user was
   * waiting on off the page with it. Kept, the list is the one from before the pass -- whose
   * proposals the pass may have replaced -- so its Confirm takes no press until the new list has
   * landed: confirming an outdated row would write it as the person's answer over the proposal
   * the pass just paid for.
   */
  it("keeps the proposals held, with focus on them, while a pass's answers are read again", async () => {
    const reads = holdAnswerReads();
    watchResearch();
    renderShell("/configure");
    await settled();
    const confirm = await theProposals().findByRole("button", {
      name: CONFIRM,
    });
    reads.start();
    await researched();
    act(() => confirm.focus());

    await waitFor(() => expect(reads.asked()).toBe(true));
    expect(confirm).toBeInTheDocument();
    expect(confirm).toHaveFocus();
    expectHeld(confirm);

    reads.release();

    await passSays(ALL_ASKED);
    await waitFor(() => expectNotHeld(confirm));
    expect(confirm).toHaveFocus();
  });

  /**
   * The same window after a confirmation: written, and read again. **Until the read lands the
   * confirmed row is still listed**, so every Confirm stays held -- a second Enter on it would
   * write the person's answer twice, and a live button would look as though the first had not
   * taken.
   */
  it("holds every Confirm while the answers a confirmation wrote are read again", async () => {
    twoProposals();
    const confirmations = { sent: 0 };
    mockServer.use(
      http.put(`${BASE}${CONFIRMATIONS}`, () => {
        confirmations.sent += 1;
      }),
    );
    const reads = holdAnswerReads();
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    const confirm = await theProposals().findByRole("button", {
      name: CONFIRM,
    });
    const other = theProposals().getByRole("button", {
      name: `Confirm ${PROPOSED_GATE} for Spain`,
    });
    reads.start();
    act(() => confirm.focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(reads.asked()).toBe(true));

    expect(confirm).toBeInTheDocument();
    expectHeld(confirm);
    expectHeld(other);
    await user.keyboard("{Enter}");

    reads.release();

    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    await waitFor(() => expectNotHeld(other));
    expect(other).toHaveFocus();
    expect(confirmations.sent).toBe(1);
  });

  it("holds every other proposal's Confirm while one is written", async () => {
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, () =>
        HttpResponse.json({
          items: [
            {
              match_rule: PROPOSED_GATE_ID,
              candidate: PROPOSED_FOR_ID,
              match_result: "not_matching",
              data_source: "llm",
              retrieval_date: "2026-09-12T09:00:00Z",
              citations: ["https://example.gov/skilled-worker"],
              is_proposal: true,
            },
            {
              match_rule: PROPOSED_GATE_ID,
              candidate: "country.spain",
              match_result: "matching",
              data_source: "llm",
              retrieval_date: "2026-09-12T09:00:00Z",
              citations: ["https://example.gov/skilled-worker"],
              is_proposal: true,
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    const confirmations = hold("put", CONFIRMATIONS, refused("refused"));
    renderShell("/configure");
    await settled();
    const other = await theProposals().findByRole("button", {
      name: `Confirm ${PROPOSED_GATE} for Spain`,
    });

    await user.click(theProposals().getByRole("button", { name: CONFIRM }));
    await waitFor(() => expect(confirmations.sent).toBe(1));

    expectHeld(other);
    await user.click(other);
    confirmations.release();

    await waitFor(() => expectNotHeld(other));
    expect(confirmations.sent).toBe(1);
  });

  it("holds Estimate, Research and every Confirm while a pass runs, and a press sends nothing", async () => {
    const asked = { plans: 0 };
    mockServer.use(
      http.post(`${BASE}/match-rule-research/plan`, () => {
        asked.plans += 1;
        return undefined;
      }),
    );
    const user = userEvent.setup();
    const research = watchResearch({ holdAt: 1 });
    const confirmations = hold("put", CONFIRMATIONS);
    renderShell("/configure");
    await settled();
    await researched();
    await waitFor(() => expect(research.sent).toHaveLength(1));
    const start = theProposals().getByRole("button", { name: "Researching…" });
    const confirm = theProposals().getByRole("button", { name: CONFIRM });

    expectHeld(estimateButton());
    expectHeld(start);
    expectHeld(confirm);
    await user.click(estimateButton());
    await user.click(start);
    await user.click(confirm);
    research.release();

    await passSays(ALL_ASKED);
    expect(research.sent).toHaveLength(5);
    expect(asked.plans).toBe(1);
    expect(confirmations.sent).toBe(0);
  });

  /** A press on a held button is turned away whole, the box it would have cleared included. */
  it("sends nothing, and clears nothing, from Research pressed while a confirmation is written", async () => {
    const user = userEvent.setup();
    const research = watchResearch();
    const confirmations = hold("put", CONFIRMATIONS);
    await capAt(null);
    renderShell("/configure");
    await settled();
    await estimated();
    const uncapped = theProposals().getByRole("checkbox", {
      name: /accept an uncapped spend/i,
    });
    await user.click(uncapped);
    await user.click(theProposals().getByRole("button", { name: CONFIRM }));
    await waitFor(() => expect(confirmations.sent).toBe(1));
    const start = theProposals().getByRole("button", {
      name: "Research the gates",
    });

    expectHeld(start);
    await user.click(start);
    confirmations.release();

    await waitFor(() => expectNotHeld(start));
    expect(research.sent).toEqual([]);
    expect(uncapped).toBeChecked();
  });
});

/**
 * PL-052. **Money spent on gate research never leaves the page unsaid.** How the last pass
 * ended, with what it spent, stays on Configure -- through a visit to another tab and a reload
 * -- until the reader dismisses it; a pass the page stopped running is recorded as abandoned.
 */
describe("the last pass's outcome, kept until it is dismissed", () => {
  async function researchedOnScreen(): Promise<void> {
    renderShell("/configure");
    await settled();
    await researched();
  }

  async function leaveAndComeBack(): Promise<void> {
    await userEvent.click(screen.getByRole("link", { name: "Acquire" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Gate proposals" })).toBeNull(),
    );
    await userEvent.click(screen.getByRole("link", { name: "Configure" }));
    await settled();
  }

  function dismissButton(): HTMLElement {
    return theProposals().getByRole("button", { name: "Dismiss the last pass" });
  }

  const ENDINGS: readonly { ending: string; run: () => Promise<void>; says: string }[] = [
    {
      ending: "asked every gate",
      run: async () => {
        watchResearch();
        await researchedOnScreen();
      },
      says: ALL_ASKED,
    },
    {
      ending: "stopped at the spend cap",
      run: async () => {
        await capAt(0.08);
        watchResearch();
        await researchedOnScreen();
      },
      says:
        "The last pass at the Country level stopped at the spend cap of €0.08: it asked 2 of 3 questions and spent €0.08 of at most €0.12.",
    },
    {
      ending: "stopped by the reader",
      run: async () => {
        const research = watchResearch({ holdAt: 2 });
        await researchedOnScreen();
        await waitFor(() => expect(research.sent).toHaveLength(2));
        await userEvent.click(
          theProposals().getByRole("button", { name: "Stop after this question" }),
        );
        research.release();
      },
      says:
        "You stopped the last pass at the Country level: it asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    },
    {
      ending: "refused",
      run: async () => {
        watchResearch({
          answer: () =>
            HttpResponse.json(
              { code: "spend_cap_not_set", message: "no spend cap is set" },
              { status: 409 },
            ),
        });
        await researchedOnScreen();
      },
      says:
        "The last pass at the Country level was refused at A visa route exists, which spent nothing: it asked 0 of 3 questions and spent nothing.",
    },
    {
      ending: "failed on an answering server",
      run: async () => {
        watchResearch({
          answer: (_body, index) =>
            index === 2
              ? HttpResponse.json(
                  { code: "internal_error", message: "the model provider failed" },
                  { status: 500 },
                )
              : undefined,
        });
        await researchedOnScreen();
      },
      says:
        "The last pass at the Country level failed at Free movement applies, and what that request spent is not known: before it, the pass asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    },
  ];

  it.each(ENDINGS)("keeps a pass that $ending, with what it spent, through a visit to another tab", async ({ run, says }) => {
    await run();
    await passSays(says);

    await leaveAndComeBack();

    await passSays(says);
    expect(dismissButton()).toBeInTheDocument();
  });

  it("keeps the outcome across a reload", async () => {
    watchResearch();
    const page = renderShell("/configure");
    await settled();
    await researched();
    await passSays(ALL_ASKED);

    page.unmount();
    renderShell("/configure");
    await settled();

    await passSays(ALL_ASKED);
  });

  it("records a pass left mid-question as abandoned, with what it had spent", async () => {
    const research = watchResearch({ holdAt: 2 });
    await researchedOnScreen();
    await waitFor(() => expect(research.sent).toHaveLength(2));

    await userEvent.click(screen.getByRole("link", { name: "Acquire" }));
    research.release();
    await userEvent.click(screen.getByRole("link", { name: "Configure" }));
    await settled();

    await passSays(
      "The last pass at the Country level ended when you left Configure while Free movement applies was being asked, and what that question spent is not known: before it, the pass asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    );
    expect(statusLine()).toHaveClass("notice--warning");
    expect(research.sent).toHaveLength(2);
  });

  it("removes the outcome once dismissed, for good, and puts focus on Estimate", async () => {
    watchResearch();
    const page = renderShell("/configure");
    await settled();
    await researched();
    await passSays(ALL_ASKED);

    await userEvent.click(dismissButton());

    expect(statusLine()).toBeEmptyDOMElement();
    expect(
      theProposals().queryByRole("button", { name: "Dismiss the last pass" }),
    ).toBeNull();
    expect(
      theProposals().getByRole("button", { name: "Estimate the research" }),
    ).toHaveFocus();
    await leaveAndComeBack();
    expect(statusLine()).toBeEmptyDOMElement();
    page.unmount();
    renderShell("/configure");
    await settled();
    expect(statusLine()).toBeEmptyDOMElement();
  });

  it("offers no Dismiss before any pass, nor while one runs", async () => {
    const research = watchResearch({ holdAt: 2 });
    renderShell("/configure");
    await settled();
    expect(
      theProposals().queryByRole("button", { name: "Dismiss the last pass" }),
    ).toBeNull();

    await researched();
    await waitFor(() => expect(research.sent).toHaveLength(2));

    expect(
      theProposals().queryByRole("button", { name: "Dismiss the last pass" }),
    ).toBeNull();
    research.release();
    await passSays(ALL_ASKED);
  });

  /**
   * A read that failed with the server up answers a 500 with the contract's body (PL-002): the
   * pass did not start, and that, with its notice worded from the code, outlives a reload.
   */
  it("keeps a pass whose spend cap could not be read, and its notice, through a reload", async () => {
    const research = watchResearch();
    const page = renderShell("/configure");
    await settled();
    await estimated();
    mockServer.use(
      http.get(`${BASE}/settings`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "the settings could not be read" },
          { status: 500 },
        ),
      ),
    );
    await userEvent.click(
      theProposals().getByRole("button", { name: "Research the gates" }),
    );
    const DID_NOT_START =
      "The last pass at the Country level did not start, because the spend cap and the gates could not be read: it asked nothing and spent nothing.";
    await passSays(DID_NOT_START);

    page.unmount();
    mockServer.resetHandlers();
    renderShell("/configure");
    await settled();

    await passSays(DID_NOT_START);
    expect(
      theProposals().getByText("The server failed while answering."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/the settings could not be read/)).toBeNull();
    await userEvent.click(dismissButton());
    expect(statusLine()).toBeEmptyDOMElement();
    expect(theProposals().queryByText("The server failed while answering.")).toBeNull();
    expect(research.sent).toEqual([]);
  });
});

/**
 * PL-052. **Dismiss takes the panel with it when only the outcome drew it.** With the criteria
 * set unread, the proposals are drawn in the rules stage for the pass alone, so putting its
 * outcome away removes the panel and Estimate with it: focus goes to what stays instead -- the
 * set's failure card, or the stage's heading -- never to the page.
 */
describe("dismissing the outcome while the set is unread", () => {
  async function aPassThenTheSetUnread(setRead: Parameters<typeof http.get>[1]): Promise<void> {
    watchResearch();
    renderShell("/configure");
    await settled();
    await researched();
    await passSays(ALL_ASKED);
    mockServer.use(http.get(`${BASE}/criteria-sets/:id`, setRead));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /active criteria set/i }),
      "remote_only",
    );
    await waitFor(() =>
      expect(within(rulesStage()).queryByRole("region", { name: /^Gates/ })).toBeNull(),
    );
  }

  function rulesStage(): HTMLElement {
    return screen.getByRole("region", { name: /^Match rules/ });
  }

  async function dismissByKeyboard(): Promise<void> {
    theProposals().getByRole("button", { name: "Dismiss the last pass" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Gate proposals" })).toBeNull(),
    );
  }

  it("shows an outcome that could not be read, and Dismiss hands focus to the set's failure card", async () => {
    window.sessionStorage.setItem(
      SLICES_KEY,
      JSON.stringify({
        "configure/research-pass": { value: { kind: "finished", pass: { level: "country" } }, level: null },
      }),
    );
    mockServer.use(
      http.get(`${BASE}/criteria-sets/:id`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "the criteria set could not be read" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");
    const card = await within(rulesStage()).findByText(/criteria set could not be loaded/i);

    expect(
      await theProposals().findByText(/^An earlier pass's outcome could not be read\./),
    ).toBeInTheDocument();
    expect(statusLine()).not.toHaveTextContent("€");
    await dismissByKeyboard();

    expect(document.activeElement).toContainElement(card);
  });

  it("puts focus on the set's failure card, not the page", async () => {
    await aPassThenTheSetUnread(() =>
      HttpResponse.json(
        { code: "internal_error", message: "the criteria set could not be read" },
        { status: 500 },
      ),
    );
    const card = await within(rulesStage()).findByText(/criteria set could not be loaded/i);

    await dismissByKeyboard();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(card);
    expect(rulesStage()).toContainElement(document.activeElement as HTMLElement);
  });

  it("puts focus on the rules stage's heading while the set is still read", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    await aPassThenTheSetUnread(async () => {
      await held;
      return undefined;
    });

    await dismissByKeyboard();

    expect(document.activeElement).toBe(
      within(rulesStage()).getByRole("heading", { level: 2 }),
    );
  });
});

/**
 * PL-052. **A refusal card read back after a reload hands focus on when it is dismissed.** It
 * was drawn on the first render, with nothing pressed to give focus back to, so Dismiss took its
 * own button away and left focus on the page.
 */
it("puts focus on Estimate when a reloaded pass's refusal is dismissed", async () => {
  watchResearch({
    answer: (_body, index) =>
      index === 2
        ? HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 })
        : undefined,
  });
  const page = renderShell("/configure");
  await settled();
  await researched();
  await passSays(/failed at Free movement applies/);
  page.unmount();
  renderShell("/configure");
  await settled();
  const card = await theProposals().findByText("The server failed while answering.");

  const failureCard = card.closest<HTMLElement>(".failure-card");
  if (failureCard === null) throw new Error("the refusal is not drawn as a card");
  within(failureCard)
    .getByRole("button", { name: "Dismiss" })
    .focus();
  await userEvent.keyboard("{Enter}");

  await waitFor(() =>
    expect(theProposals().queryByText("The server failed while answering.")).toBeNull(),
  );
  expect(
    theProposals().getByRole("button", { name: "Estimate the research" }),
  ).toHaveFocus();
});
