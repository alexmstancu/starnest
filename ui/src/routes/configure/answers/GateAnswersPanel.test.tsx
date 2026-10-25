import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  putMatchRuleResult,
  replaceSettings,
  type MatchRuleResult,
} from "../../../api/endpoints";
import { SETTINGS } from "../../../mocks/fixtures";
import { mockServer } from "../../../mocks/server";
import { expectHeld } from "../../../testing/keyboard";
import { renderShell } from "../../../testing/renderShell";
import { describeAge } from "../gateAnswerReading";

/**
 * Gate answers a person gives, and every one recorded (UI-29, BE-36 stage 1).
 *
 * The rules under test: what this screen sends is always `manual`; a correction drops nothing
 * the person did not drop; a refusal is worded from its code, never the server's sentence; and
 * an answer whose period has ended is marked as **still applied**, never hidden or expired.
 */

const BASE = "/v1";

/** A recorded answer with everything a correction must keep. */
const RECORDED: MatchRuleResult = {
  match_rule: "country.uk_skilled_worker",
  candidate: "country.united_kingdom",
  match_result: "not_matching",
  data_source: "manual",
  retrieval_date: "2026-09-12T09:00:00Z",
  recorded_at: "2026-09-12T09:00:00Z",
  reason: "No sponsor in the local market.",
  reference_period: { start: "2026-01-01", end: "2099-12-31" },
  citations: ["https://www.gov.uk/skilled-worker-visa"],
  override_reason: "Checked with an employer.",
  override_date: "2026-09-12T09:00:00Z",
  is_proposal: false,
  pending_proposal: null,
};

function theAnswers() {
  return within(screen.getByRole("region", { name: "Gate answers" }));
}

function theForm() {
  return within(theAnswers().getByRole("form", { name: "Record a gate answer" }));
}

async function settled(): Promise<void> {
  await screen.findByRole("region", { name: "Gate answers" });
  await theAnswers().findByRole("form", { name: "Record a gate answer" });
  await waitFor(() => expect(theAnswers().queryByText("Loading…")).not.toBeInTheDocument());
  // The candidates arrive on their own read.
  await waitFor(() =>
    expect(theForm().getByRole("option", { name: "United Kingdom" })).toBeInTheDocument(),
  );
}

/** Serves these answers, and every write the screen sends lands among them. */
function serveAnswers(items: MatchRuleResult[]): void {
  mockServer.use(http.get(`${BASE}/match-rule-results`, () => HttpResponse.json({ items })));
}

/** Every PUT the screen sends, its path and body, still answered by the mock. */
function watchWrites(): { path: string; body: unknown }[] {
  const writes: { path: string; body: unknown }[] = [];
  const listen = ({ request }: { request: Request }) => {
    if (request.method === "PUT" && new URL(request.url).pathname.startsWith("/v1/match-rule-results/")) {
      void request
        .clone()
        .json()
        .then((body: unknown) => writes.push({ path: new URL(request.url).pathname, body }));
    }
  };
  mockServer.events.on("request:start", listen);
  onTestFinished(() => mockServer.events.removeListener("request:start", listen));
  return writes;
}

/** Refuses every PUT with this status and body. */
function refuseWrites(status: number, body: object): void {
  mockServer.use(
    http.put(`${BASE}/match-rule-results/:matchRuleId/:candidateId`, () =>
      HttpResponse.json(body, { status }),
    ),
  );
}

async function fillAnAnswer(): Promise<void> {
  await userEvent.selectOptions(theForm().getByLabelText("Gate"), "UK Skilled Worker route");
  await userEvent.selectOptions(theForm().getByLabelText("Candidate"), "United Kingdom");
  await userEvent.selectOptions(theForm().getByLabelText("Answer"), "Not matching");
}

function save(): Promise<void> {
  return userEvent.click(theForm().getByRole("button", { name: "Save the answer" }));
}

describe("recording a gate answer", () => {
  it("records an answer nobody proposed, as manual, and lists it once it is read again", async () => {
    const writes = watchWrites();
    renderShell("/configure");
    await settled();

    await fillAnAnswer();
    await userEvent.type(theForm().getByLabelText("Reason"), "No sponsor here.");
    await userEvent.type(theForm().getByLabelText("From"), "2026-01-01");
    await userEvent.type(theForm().getByLabelText("Until"), "2026-12-31");
    await userEvent.type(theForm().getByLabelText("Pages"), "https://www.gov.uk/skilled-worker-visa");
    await save();

    const row = await theAnswers().findByRole("row", { name: /UK Skilled Worker route/ });
    expect(row).toHaveTextContent("United Kingdom");
    expect(row).toHaveTextContent("Not matching");
    expect(row).toHaveTextContent("1 Jan 2026 to 31 Dec 2026");
    expect(writes).toEqual([
      {
        path: "/v1/match-rule-results/country.uk_skilled_worker/country.united_kingdom",
        body: {
          match_result: "not_matching",
          reason: "No sponsor here.",
          data_source: "manual",
          reference_period: { start: "2026-01-01", end: "2026-12-31" },
          override_reason: null,
          citations: ["https://www.gov.uk/skilled-worker-visa"],
        },
      },
    ]);
    expect(theAnswers().getByRole("status")).toHaveTextContent(
      "Recorded Not matching for UK Skilled Worker route and United Kingdom.",
    );
  });

  it("offers only the gates and the candidates at the screen's level, by name", async () => {
    renderShell("/configure");
    await settled();

    const candidates = within(theForm().getByLabelText("Candidate")).getAllByRole("option");
    expect(candidates.map((option) => option.textContent)).not.toContain("Lisbon");
    const gates = within(theForm().getByLabelText("Gate")).getAllByRole("option");
    expect(gates.map((option) => option.textContent)).toContain("Not excluded by hand");
    expect(theAnswers().queryByText(/country\./)).not.toBeInTheDocument();
  });

  it("says a not-matching answer rules the candidate out before it is saved", async () => {
    renderShell("/configure");
    await settled();

    await fillAnAnswer();

    expect(theForm().getByText(/this rules United Kingdom out of every ranking/i)).toBeInTheDocument();
  });

  it("sends one write for two quick presses, holding Save with its focus while it writes", async () => {
    let release: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    let puts = 0;
    mockServer.use(
      http.put(`${BASE}/match-rule-results/:matchRuleId/:candidateId`, async () => {
        puts += 1;
        await answered;
        return HttpResponse.json(RECORDED);
      }),
    );
    renderShell("/configure");
    await settled();
    await fillAnAnswer();

    const button = theForm().getByRole("button", { name: "Save the answer" });
    await userEvent.click(button);
    await userEvent.click(theForm().getByRole("button", { name: "Saving…" }));

    const saving = theForm().getByRole("button", { name: "Saving…" });
    expectHeld(saving);
    expect(saving).toHaveFocus();
    release();
    await theForm().findByRole("button", { name: "Save the answer" });
    expect(puts).toBe(1);
  });
});

describe("where the form lives", () => {
  /** D4. Answers belong to no set, so the form sits outside the set's rules. */
  it("keeps a half-typed answer when the criteria set is switched", async () => {
    renderShell("/configure");
    await settled();
    await fillAnAnswer();
    await userEvent.type(theForm().getByLabelText("Reason"), "Half typed");

    const sets = screen.getByRole("combobox", { name: /active criteria set/i });
    await userEvent.selectOptions(sets, "remote_only");
    await waitFor(() => expect(sets).toHaveValue("remote_only"));
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await screen.findByRole("heading", { name: "Gates" });

    expect(theForm().getByLabelText("Reason")).toHaveValue("Half typed");
  });
});

describe("what the form refuses before sending", () => {
  it("refuses a page that is not a full web address, and sends nothing", async () => {
    const writes = watchWrites();
    renderShell("/configure");
    await settled();
    await fillAnAnswer();

    await userEvent.type(theForm().getByLabelText("Pages"), "javascript:alert(1)");
    await save();

    expect(theForm().getByLabelText("Pages")).toHaveAttribute("aria-invalid", "true");
    expect(
      theForm().getByText("Line 1 is not a full web address: each page starts with http:// or https://."),
    ).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("refuses an override with no reason, and sends nothing", async () => {
    const writes = watchWrites();
    renderShell("/configure");
    await settled();
    await fillAnAnswer();

    await userEvent.click(theForm().getByRole("checkbox", { name: "This overrides what the sources say" }));
    await save();

    expect(theForm().getByLabelText("Override reason")).toHaveAttribute("aria-invalid", "true");
    expect(theForm().getByText(/Say why this overrides/)).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("refuses a period with only one of its days, and sends nothing", async () => {
    const writes = watchWrites();
    renderShell("/configure");
    await settled();
    await fillAnAnswer();

    await userEvent.type(theForm().getByLabelText("From"), "2026-01-01");
    await save();

    expect(theForm().getByText(/needs both its first and its last day/)).toBeInTheDocument();
    expect(writes).toEqual([]);
  });
});

describe("what the server refuses", () => {
  it("words a period that ends before it begins from its code, and keeps the answer typed", async () => {
    renderShell("/configure");
    await settled();
    await fillAnAnswer();

    await userEvent.type(theForm().getByLabelText("From"), "2026-12-31");
    await userEvent.type(theForm().getByLabelText("Until"), "2026-01-01");
    await save();

    const alert = await theAnswers().findByRole("alert");
    expect(alert).toHaveTextContent("The gate answer did not go through");
    expect(alert).toHaveTextContent("The period is not valid: it must not end before it starts.");
    expect(within(alert).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(theForm().getByLabelText("From")).toHaveValue("2026-12-31");
  });

  it.each([
    [404, "not_found", undefined, "It is not there any more"],
    [
      422,
      "invalid_match_rule_result",
      { match_rule: "country.uk_skilled_worker", candidate: "country.united_kingdom" },
      "That answer is not one this gate accepts.",
    ],
    [422, "unknown_data_source", undefined, "That source is not in the catalog."],
    [
      422,
      "invalid_request",
      { errors: [{ location: ["body", "override_reason"], problem: "too short", kind: "string_too_short" }] },
      "A value in this request is not valid, so nothing was done.",
    ],
    [
      409,
      "answer_recorded_by_a_person",
      { match_rule: "country.uk_skilled_worker", candidate: "country.united_kingdom" },
      "A person has already recorded this answer, so it is not replaced.",
    ],
  ])("words a %i %s from its code, never the server's sentence, and offers Dismiss only", async (status, code, details, words) => {
    refuseWrites(status, { code, message: "THE SERVER'S OWN SENTENCE", ...(details ? { details } : {}) });
    renderShell("/configure");
    await settled();
    await fillAnAnswer();

    await save();

    const alert = await theAnswers().findByRole("alert");
    expect(alert).toHaveTextContent(words);
    expect(alert).not.toHaveTextContent("THE SERVER'S OWN SENTENCE");
    expect(within(alert).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("the recorded answers", () => {
  it("lists each answer a person recorded with its period and when, and no proposal", async () => {
    renderShell("/configure");
    await settled();

    const row = await theAnswers().findByRole("row", { name: /Free movement applies/ });
    expect(row).toHaveTextContent("Spain");
    expect(row).toHaveTextContent("Matching");
    expect(row).toHaveTextContent("No period recorded");
    expect(row).toHaveTextContent(`10 Sept 2026, ${describeAge("2026-09-10T09:00:00Z", new Date())}`);
    // Portugal's answer is a model's proposal, which the proposals panel lists.
    expect(theAnswers().queryByRole("row", { name: /A visa route exists/ })).not.toBeInTheDocument();
  });

  it("marks an answer whose period has ended, and says it still applies", async () => {
    serveAnswers([{ ...RECORDED, reference_period: { start: "2020-01-01", end: "2020-12-31" } }]);
    renderShell("/configure");
    await settled();

    const row = await theAnswers().findByRole("row", { name: /UK Skilled Worker route/ });
    expect(row).toHaveTextContent(
      "Ended, still applied: its period ended on 31 Dec 2020, and it applies until you change it.",
    );
  });

  it("says when no answer has been recorded at this level", async () => {
    serveAnswers([]);
    renderShell("/configure");
    await settled();

    expect(
      await theAnswers().findByText("No gate answer has been recorded by hand at this level yet."),
    ).toBeInTheDocument();
  });

  it("offers Try again when the answers cannot be read while the server is up", async () => {
    let fail = true;
    mockServer.use(
      http.get(`${BASE}/match-rule-results`, () =>
        fail
          ? HttpResponse.json({ code: "internal_error", message: "the read failed" }, { status: 500 })
          : HttpResponse.json({ items: [RECORDED] }),
      ),
    );
    renderShell("/configure");
    await screen.findByRole("region", { name: "Gate answers" });

    const retry = await theAnswers().findByRole("button", { name: "Try again" });
    fail = false;
    await userEvent.click(retry);

    expect(await theAnswers().findByRole("row", { name: /UK Skilled Worker route/ })).toBeInTheDocument();
  });

  it("prints a stored page that is not a web address as text, never as a link", async () => {
    serveAnswers([
      { ...RECORDED, citations: ["javascript:alert(1)", "https://www.gov.uk/skilled-worker-visa"] },
    ]);
    renderShell("/configure");
    await settled();

    const row = await theAnswers().findByRole("row", { name: /UK Skilled Worker route/ });
    expect(within(row).getByText("javascript:alert(1)")).toBeInTheDocument();
    expect(within(row).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://www.gov.uk/skilled-worker-visa",
    ]);
  });

  it("corrects an answer keeping its pages, period and override unless they are changed", async () => {
    serveAnswers([RECORDED]);
    const writes = watchWrites();
    renderShell("/configure");
    await settled();

    await userEvent.click(
      await theAnswers().findByRole("button", { name: "Change UK Skilled Worker route for United Kingdom" }),
    );
    expect(theForm().getByLabelText("Gate")).toHaveFocus();
    await userEvent.clear(theForm().getByLabelText("Reason"));
    await userEvent.type(theForm().getByLabelText("Reason"), "Still no sponsor.");
    await save();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      path: "/v1/match-rule-results/country.uk_skilled_worker/country.united_kingdom",
      body: {
        match_result: "not_matching",
        reason: "Still no sponsor.",
        data_source: "manual",
        reference_period: { start: "2026-01-01", end: "2099-12-31" },
        override_reason: "Checked with an employer.",
        citations: ["https://www.gov.uk/skilled-worker-visa"],
      },
    });
  });

  it("shows a re-check's proposal read-only, and takes it through the form as manual", async () => {
    serveAnswers([
      {
        ...RECORDED,
        pending_proposal: {
          match_result: "matching",
          reason: "The sponsor list now includes local employers.",
          data_source: "llm",
          reference_period: null,
          retrieval_date: "2026-10-20T09:00:00Z",
          recorded_at: "2026-10-20T09:05:00Z",
          citations: ["https://www.gov.uk/sponsors"],
        },
      },
    ]);
    const writes = watchWrites();
    renderShell("/configure");
    await settled();

    const proposal = await theAnswers().findByRole("row", { name: /Take the proposal/ });
    expect(proposal).toHaveTextContent(
      "A re-check proposes Matching, with no period recorded. Read on 20 Oct 2026.",
    );
    expect(within(proposal).getByRole("link")).toHaveAttribute("href", "https://www.gov.uk/sponsors");
    await userEvent.click(
      within(proposal).getByRole("button", {
        name: "Take the proposal for UK Skilled Worker route and United Kingdom",
      }),
    );
    expect(theForm().getByLabelText("Answer")).toHaveValue("matching");
    await save();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({
      match_result: "matching",
      reason: "The sponsor list now includes local employers.",
      data_source: "manual",
      reference_period: null,
      override_reason: null,
      citations: ["https://www.gov.uk/sponsors"],
    });
  });
});

/**
 * PL-164 (Q239). **An answer names the citizenships it assumed**, and says when the household's
 * have changed since -- or were never kept -- so it should be checked again. It still applies.
 */
describe("the citizenships an answer assumed", () => {
  it("names the citizenships it assumed, by country name", async () => {
    serveAnswers([{ ...RECORDED, assumed_citizenships: ["country.romania"], needs_recheck: false }]);
    renderShell("/configure");
    await settled();

    const row = await theAnswers().findByRole("row", { name: /UK Skilled Worker route/ });
    expect(row).toHaveTextContent("Assumed citizenship of Romania.");
    expect(row).not.toHaveTextContent(/check it again/);
    expect(row).not.toHaveTextContent("country.");
  });

  it("asks for a re-check of one recorded for a different citizenship", async () => {
    serveAnswers([
      { ...RECORDED, assumed_citizenships: ["country.united_kingdom"], needs_recheck: true },
    ]);
    renderShell("/configure");
    await settled();

    const row = await theAnswers().findByRole("row", { name: /UK Skilled Worker route/ });
    expect(row).toHaveTextContent("Assumed citizenship of United Kingdom.");
    expect(row).toHaveTextContent("Recorded for a different citizenship: check it again.");
  });

  it("asks for a re-check of one recorded before citizenships were kept", async () => {
    serveAnswers([{ ...RECORDED, assumed_citizenships: null, needs_recheck: true }]);
    renderShell("/configure");
    await settled();

    const row = await theAnswers().findByRole("row", { name: /UK Skilled Worker route/ });
    expect(row).toHaveTextContent("Recorded before citizenships were kept: check it again.");
    expect(row).not.toHaveTextContent(/Assumed citizenship/);
  });

  it("flags an answer once the household's citizenships change, without remounting", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    // The mock's own answer, recorded with the household as it stands.
    const row = await theAnswers().findByRole("row", { name: /Free movement applies/ });
    expect(row).toHaveTextContent("Assumed citizenship of Romania.");
    expect(row).not.toHaveTextContent(/check it again/);

    const passports = screen.getByRole("combobox", { name: "Passports held" });
    await user.click(passports);
    await user.type(passports, "Port");
    await user.tab();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save household" }));

    await waitFor(() =>
      expect(row).toHaveTextContent("Recorded for a different citizenship: check it again."),
    );
  });
});

/**
 * PL-153 stage 2. **A person asks again about an answer they recorded**: estimated first, armed
 * like any pass, run through the screen's one research pass -- one at a time, the same Stop, the
 * same kept outcome -- and what it finds sits beside the answer, which goes on applying.
 */
describe("re-checking a recorded answer", () => {
  const ENDED = { start: "2025-01-01", end: "2025-12-31" };
  const VISA = "A visa route exists for Portugal";
  const UK = "UK Skilled Worker route for United Kingdom";

  /** Two answers a person recorded whose periods have ended: what a re-check is for. */
  async function twoEndedAnswers(): Promise<void> {
    for (const [gate, candidate] of [
      ["country.visa_route_exists", "country.portugal"],
      ["country.uk_skilled_worker", "country.united_kingdom"],
    ] as const) {
      await putMatchRuleResult(gate, candidate, {
        match_result: "matching",
        data_source: "manual",
        reference_period: ENDED,
      });
    }
  }

  function theStrip() {
    return within(theAnswers().getByRole("group", { name: "Re-check" }));
  }

  function passLine(): HTMLElement {
    return within(screen.getByRole("region", { name: "Gate proposals" })).getByRole("status");
  }

  /** Every body sent to an endpoint, still answered by the mock. */
  function watchBodies(path: string): unknown[] {
    const bodies: unknown[] = [];
    const listen = ({ request }: { request: Request }) => {
      if (request.method === "POST" && new URL(request.url).pathname === path) {
        void request.clone().json().then((body: unknown) => bodies.push(body));
      }
    };
    mockServer.events.on("request:start", listen);
    onTestFinished(() => mockServer.events.removeListener("request:start", listen));
    return bodies;
  }

  async function recheck(name: string): Promise<void> {
    await userEvent.click(await theAnswers().findByRole("button", { name: `Re-check ${name}` }));
    await theAnswers().findByRole("group", { name: "Re-check" });
  }

  it("offers a re-check on an answer whose period ended or that needs one, and on no other", async () => {
    serveAnswers([
      { ...RECORDED, reference_period: ENDED },
      {
        ...RECORDED,
        match_rule: "country.eu_free_movement",
        candidate: "country.spain",
        reference_period: null,
        needs_recheck: true,
      },
      { ...RECORDED, match_rule: "country.visa_route_exists", candidate: "country.portugal" },
    ]);
    renderShell("/configure");
    await settled();

    await theAnswers().findByRole("button", { name: "Re-check UK Skilled Worker route for United Kingdom" });
    expect(
      theAnswers().getByRole("button", { name: "Re-check Free movement applies for Spain" }),
    ).toBeInTheDocument();
    expect(theAnswers().getByText(/check it again/i)).toBeInTheDocument();
    expect(theAnswers().queryByRole("button", { name: `Re-check ${VISA}` })).toBeNull();
  });

  it("estimates a re-check of one answer, re-checks only it, and keeps what it finds beside it", async () => {
    await twoEndedAnswers();
    const plans = watchBodies("/v1/match-rule-research/plan");
    const asked = watchBodies("/v1/match-rule-research");
    renderShell("/configure");
    await settled();

    await recheck(VISA);
    expect(theStrip().getByText(`To re-check ${VISA}: 1 question, 1 call, at most €0.04.`)).toBeInTheDocument();
    expect(theStrip().getByText("Halts at the €10.00 spend cap.")).toBeInTheDocument();
    await userEvent.click(theStrip().getByRole("button", { name: "Start the re-check" }));

    await waitFor(() =>
      expect(passLine()).toHaveTextContent(
        "The last re-check at the Country level re-checked every answer: it asked 1 of 1 question and spent €0.04 of at most €0.04.",
      ),
    );
    const pair = { match_rule: "country.visa_route_exists", candidate: "country.portugal" };
    expect(plans).toEqual([{ level: "country", recheck: [pair] }]);
    expect(asked).toEqual([{ level: "country", recheck: [pair], accept_uncapped_spend: false }]);
    const pending = await theAnswers().findByRole("row", { name: /Take the proposal for A visa route exists and Portugal/ });
    expect(pending).toHaveTextContent("A re-check proposes Not matching");
    expect(theAnswers().getByRole("row", { name: /^A visa route exists Portugal Matching/ })).toBeInTheDocument();
    expect(theAnswers().queryByRole("group", { name: "Re-check" })).toBeNull();
  });

  it("puts focus back on the answer's Re-check once the re-check starts", async () => {
    await twoEndedAnswers();
    renderShell("/configure");
    await settled();
    await recheck(VISA);

    theStrip().getByRole("button", { name: "Start the re-check" }).focus();
    await userEvent.keyboard("{Enter}");

    expect(theAnswers().getByRole("button", { name: `Re-check ${VISA}` })).toHaveFocus();
  });

  it("refuses a re-check of an answer nobody recorded, worded from its code, with Try again", async () => {
    serveAnswers([
      { ...RECORDED, match_rule: "country.visa_route_exists", candidate: "country.portugal", reference_period: ENDED },
    ]);
    renderShell("/configure");
    await settled();

    await userEvent.click(await theAnswers().findByRole("button", { name: `Re-check ${VISA}` }));

    expect(
      await theAnswers().findByText(
        "A re-check asks again only about an answer a person recorded, and an answer it named has none.",
      ),
    ).toBeInTheDocument();
    expect(theAnswers().getByText("The re-check's estimate did not go through")).toBeInTheDocument();
    expect(theAnswers().getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(theAnswers().queryByText(/country\./)).toBeNull();
    expect(theAnswers().queryByRole("group", { name: "Re-check" })).toBeNull();
  });

  it("offers Try again for a failed estimate, and the second arms the re-check", async () => {
    await twoEndedAnswers();
    let failing = true;
    mockServer.use(
      http.post(`${BASE}/match-rule-research/plan`, () =>
        failing
          ? HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 })
          : undefined,
      ),
    );
    renderShell("/configure");
    await settled();

    await userEvent.click(await theAnswers().findByRole("button", { name: `Re-check ${VISA}` }));
    expect(await theAnswers().findByText("The server failed while answering.")).toBeInTheDocument();
    failing = false;
    await userEvent.click(theAnswers().getByRole("button", { name: "Try again" }));

    expect(await theAnswers().findByRole("group", { name: "Re-check" })).toBeInTheDocument();
  });

  it("asks for an uncapped re-check with no cap set, and keeps the estimate when it was refused", async () => {
    await twoEndedAnswers();
    await replaceSettings({ ...SETTINGS, run_spend_cap_eur: null });
    renderShell("/configure");
    await settled();
    await recheck(VISA);

    await userEvent.click(theStrip().getByRole("button", { name: "Start the re-check" }));

    await waitFor(() =>
      expect(passLine()).toHaveTextContent(
        `The last re-check at the Country level was refused at ${VISA}, which spent nothing`,
      ),
    );
    // The pass's refusal, worded from its code, where the pass is said.
    expect(
      within(screen.getByRole("region", { name: "Gate proposals" })).getByText(/no spend cap is set/i),
    ).toBeInTheDocument();
    await userEvent.click(
      await theStrip().findByRole("checkbox", { name: /accept an uncapped spend for this re-check/i }),
    );
    await userEvent.click(theStrip().getByRole("button", { name: "Start the re-check" }));
    await waitFor(() => expect(passLine()).toHaveTextContent(/re-checked every answer/));
  });

  it("re-checks every answer to look at again, and stops mid-way saying what it spent", async () => {
    await twoEndedAnswers();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    const asked: unknown[] = [];
    mockServer.use(
      http.post(`${BASE}/match-rule-research`, async ({ request }) => {
        asked.push(await request.clone().json());
        if (asked.length === 1) await held;
        return undefined;
      }),
    );
    renderShell("/configure");
    await settled();
    await recheck("the 2 answers to look at again");
    expect(theStrip().getByText(`To re-check 2 answers: 2 questions, 2 calls, at most €0.08.`)).toBeInTheDocument();
    await userEvent.click(theStrip().getByRole("button", { name: "Start the re-check" }));
    await waitFor(() => expect(passLine()).toHaveTextContent(`Re-checking ${VISA} at the Country level`));
    expectHeld(theAnswers().getByRole("button", { name: `Re-check ${UK}` }));

    await userEvent.click(screen.getByRole("button", { name: "Stop after this question" }));
    release();

    await waitFor(() =>
      expect(passLine()).toHaveTextContent(
        "You stopped the last re-check at the Country level: it asked 1 of 2 questions and spent €0.04 of at most €0.08.",
      ),
    );
    expect(asked).toHaveLength(1);
  });
});

describe("a save while the form is still in use (review #3)", () => {
  /** Holds every PUT until `release`, then lets the mock answer it. */
  function holdWrites(): { release: () => void } {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.put(`${BASE}/match-rule-results/:matchRuleId/:candidateId`, async () => {
        await released;
        return undefined;
      }),
    );
    return { release };
  }

  it("keeps focus on Save when the field it was sent from goes with the emptied form", async () => {
    renderShell("/configure");
    await settled();
    await fillAnAnswer();
    await userEvent.click(theForm().getByRole("checkbox", { name: "This overrides what the sources say" }));

    await userEvent.type(theForm().getByLabelText("Override reason"), "Checked myself{Enter}");

    await waitFor(() => expect(theForm().queryByLabelText("Override reason")).toBeNull());
    expect(theForm().getByRole("button", { name: "Save the answer" })).toHaveFocus();
  });

  it("keeps what was typed while the save was in flight, and still says it was recorded", async () => {
    const writes = holdWrites();
    renderShell("/configure");
    await settled();
    await fillAnAnswer();
    await save();

    await userEvent.type(theForm().getByLabelText("Reason"), "Typed while the save was in flight");
    writes.release();

    await waitFor(() =>
      expect(theAnswers().getByRole("status")).toHaveTextContent(
        "Recorded Not matching for UK Skilled Worker route and United Kingdom.",
      ),
    );
    expect(theForm().getByLabelText("Reason")).toHaveValue("Typed while the save was in flight");
  });

  it("keeps an answer loaded by Answer differently while the save was in flight", async () => {
    const writes = holdWrites();
    renderShell("/configure");
    await settled();
    await fillAnAnswer();
    await save();

    await userEvent.click(
      await screen.findByRole("button", { name: "Answer A visa route exists for Portugal differently" }),
    );
    writes.release();

    await waitFor(() => expect(theAnswers().getByRole("status")).toHaveTextContent(/^Recorded/));
    expect(theForm().getByLabelText("Candidate")).toHaveValue("country.portugal");
  });
});

describe("before the candidates say which level an answer is about (review #8)", () => {
  it("lists no answer, and offers no Change, until the candidates are read", async () => {
    serveAnswers([
      RECORDED,
      { ...RECORDED, match_rule: "not_manually_excluded", candidate: "city.lisbon" },
    ]);
    let release: () => void = () => undefined;
    const roster = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get(`${BASE}/candidates`, async () => {
        await roster;
        return undefined;
      }),
    );
    renderShell("/configure");
    await screen.findByRole("region", { name: "Gate answers" });
    await theAnswers().findByRole("form", { name: "Record a gate answer" });

    expect(theAnswers().queryByRole("button", { name: /^Change/ })).toBeNull();
    expect(theAnswers().queryByText(/No gate answer has been recorded/)).toBeNull();
    release();

    expect(
      await theAnswers().findByRole("button", { name: "Change UK Skilled Worker route for United Kingdom" }),
    ).toBeInTheDocument();
    expect(theAnswers().queryByRole("row", { name: /Lisbon/ })).toBeNull();
  });
});

describe("the candidates' Try again (review #4)", () => {
  it("keeps focus off the page when it takes itself away", async () => {
    const candidates = { down: true };
    mockServer.use(
      http.get(`${BASE}/candidates`, () =>
        candidates.down
          ? HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 })
          : undefined,
      ),
    );
    renderShell("/configure");
    await screen.findByRole("region", { name: "Gate answers" });
    const retry = await theAnswers().findByRole("button", { name: "Try again" });
    candidates.down = false;

    await userEvent.click(retry);

    await waitFor(() => expect(theAnswers().queryByRole("button", { name: "Try again" })).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("region", { name: "Gate answers" })).toContainElement(
      document.activeElement as HTMLElement,
    );
  });
});

describe("an answer to check again (review #11)", () => {
  it("says so once", async () => {
    serveAnswers([{ ...RECORDED, assumed_citizenships: ["country.united_kingdom"], needs_recheck: true }]);
    renderShell("/configure");
    await settled();

    const row = await theAnswers().findByRole("row", { name: /UK Skilled Worker route/ });
    expect(within(row).getAllByText(/check(ing)? it again|checking again/)).toHaveLength(1);
  });
});
