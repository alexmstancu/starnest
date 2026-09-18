import { screen, waitFor } from "@testing-library/react";
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

    const row = await screen.findByRole("row", {
      name: new RegExp(PROPOSED_FOR),
    });
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
    expect(screen.getByText(/4\.2 EUR/)).toBeInTheDocument();
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
