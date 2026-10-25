import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, onTestFinished } from "vitest";
import type { MatchRuleResult } from "../../../api/endpoints";
import { mockServer } from "../../../mocks/server";
import { expectHeld } from "../../../testing/keyboard";
import { renderShell } from "../../../testing/renderShell";

/**
 * Gate answers a person gives (UI-29).
 *
 * The rules under test: what this screen sends is always `manual`, and a refusal is worded from
 * its code, never the server's sentence.
 */

const BASE = "/v1";

/** What the server answers a save with. */
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
  it("records an answer nobody proposed, as manual", async () => {
    const writes = watchWrites();
    renderShell("/configure");
    await settled();

    await fillAnAnswer();
    await userEvent.type(theForm().getByLabelText("Reason"), "No sponsor here.");
    await userEvent.type(theForm().getByLabelText("From"), "2026-01-01");
    await userEvent.type(theForm().getByLabelText("Until"), "2026-12-31");
    await userEvent.type(theForm().getByLabelText("Pages"), "https://www.gov.uk/skilled-worker-visa");
    await save();

    await waitFor(() => expect(writes).toHaveLength(1));
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
    await userEvent.selectOptions(sets, "remote-only");
    await waitFor(() => expect(sets).toHaveValue("remote-only"));
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
