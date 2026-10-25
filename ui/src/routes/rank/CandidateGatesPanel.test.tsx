import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { MATCH_RULE_RESULTS, rankingFor } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * PL-154 (UF-109). **The candidate detail shows the gate answers** (`reqs.md` 8.4): a candidate
 * a gate ruled out can be traced to who answered, from which pages and for what period, and one
 * a gate let through leaves a trace too. The reason cell marks an answer a person overrode.
 */

/** Spain's refusal as the ranking reads it: the manual visa-route answer. */
const SPAIN_VISA = {
  match_rule: "country.visa_route_exists",
  candidate: "country.spain",
  match_result: "not_matching",
  data_source: "manual",
  retrieval_date: "2026-09-10T10:00:00Z",
  recorded_at: "2026-09-10T10:00:00Z",
  reason: "No route for these citizenships on the ministry's page.",
  is_proposal: false,
  reference_period: { start: "2025-01-01", end: "2025-12-31" },
  citations: ["https://example.gov/visa", "javascript:alert(1)"],
};

function answers(...items: Record<string, unknown>[]): void {
  mockServer.use(http.get("/v1/match-rule-results", () => HttpResponse.json({ items })));
}

async function openGates(name: string): Promise<HTMLElement> {
  renderShell("/rank");
  const table = await screen.findByRole("table", { name: /ranked candidates/i });
  await userEvent.click(await within(table).findByRole("button", { name }));
  return screen.findByRole("table", { name: `Gates answered about ${name}` });
}

describe("the candidate detail's gates", () => {
  it("shows each answer with its period, age, source and pages", async () => {
    answers(SPAIN_VISA, ...MATCH_RULE_RESULTS);

    const gates = await openGates("Spain");

    const visa = within(gates).getByRole("row", { name: /a visa route exists/i });
    expect(visa).toHaveTextContent("Not matching");
    expect(visa).toHaveTextContent("1 Jan 2025 to 31 Dec 2025");
    expect(visa).toHaveTextContent(/10 Sept 2026, (.+ ago|last \w+|yesterday|today)/);
    expect(visa).toHaveTextContent("Manual entry");
    expect(within(visa).getByRole("link", { name: "https://example.gov/visa" })).toHaveAttribute(
      "href",
      "https://example.gov/visa",
    );
    // An answer that let Spain through leaves its trace beside the one that ruled it out.
    expect(within(gates).getByRole("row", { name: /free movement applies/i })).toHaveTextContent(
      "Matching",
    );
  });

  it("never links a page that is not a web address", async () => {
    answers(SPAIN_VISA);

    const gates = await openGates("Spain");

    expect(within(gates).getByText("javascript:alert(1)").closest("a")).toBeNull();
  });

  it("says an answer whose period ended is still applied, and one still holding is not", async () => {
    answers(SPAIN_VISA, {
      ...MATCH_RULE_RESULTS[1]!,
      reference_period: { start: "2026-01-01", end: "2099-12-31" },
    });

    const gates = await openGates("Spain");

    expect(within(gates).getByRole("row", { name: /a visa route exists/i })).toHaveTextContent(
      "Ended, still applied: its period ended on 31 Dec 2025",
    );
    expect(
      within(gates).getByRole("row", { name: /free movement applies/i }),
    ).not.toHaveTextContent(/ended/i);
    // Ended first: the one to look at again leads.
    expect(within(gates).getAllByRole("row")[1]).toHaveTextContent(/a visa route exists/i);
  });

  it("says a proposal rules nothing out", async () => {
    const gates = await openGates("Portugal");

    expect(within(gates).getByRole("row", { name: /a visa route exists/i })).toHaveTextContent(
      "Not matching, proposed by research: it rules nothing out until a person confirms it",
    );
  });

  it("says so when no gate has been answered about the candidate", async () => {
    answers(...MATCH_RULE_RESULTS);
    renderShell("/rank");
    const table = await screen.findByRole("table", { name: /ranked candidates/i });
    await userEvent.click(within(table).getByRole("button", { name: "Netherlands" }));

    expect(
      await screen.findByText("No gate has been answered about Netherlands."),
    ).toBeInTheDocument();
  });

  it("reports a failure to read the answers on its own, with Try again", async () => {
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({ code: "conflict", message: "nope" }, { status: 409 }),
      ),
    );
    renderShell("/rank");
    const table = await screen.findByRole("table", { name: /ranked candidates/i });
    await userEvent.click(within(table).getByRole("button", { name: "Spain" }));

    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent(/gate answers/i);
    answers(SPAIN_VISA);
    await userEvent.click(within(failure).getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("table", { name: "Gates answered about Spain" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /every stored value/i })).toBeInTheDocument();
  });

  it("shows who overrode an answer, and why", async () => {
    answers({ ...SPAIN_VISA, override_reason: "The ministry confirmed by email.", override_date: "2026-09-11T09:00:00Z" });

    const gates = await openGates("Spain");

    expect(within(gates).getByRole("row", { name: /a visa route exists/i })).toHaveTextContent(
      "Overridden on 11 Sept 2026: The ministry confirmed by email.",
    );
  });
});

describe("the reason cell's override mark", () => {
  function rankedWithOverride(override: string | null): void {
    const ranking = rankingFor("default", "country");
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json({
          ...ranking,
          candidates: ranking.candidates.map((result) => ({
            ...result,
            non_match_reasons: (result.non_match_reasons ?? []).map((reason) => ({
              ...reason,
              gate_answer:
                reason.gate_answer == null
                  ? reason.gate_answer
                  : { ...reason.gate_answer, override_reason: override },
            })),
          })),
        }),
      ),
    );
  }

  async function spainsReason(): Promise<HTMLElement> {
    renderShell("/rank");
    const table = await screen.findByRole("table", { name: /ranked candidates/i });
    const heading = within(table)
      .getAllByRole("rowheader")
      .find((cell) => cell.textContent?.trim() === "Spain")!;
    return heading.closest("tr")!.querySelector<HTMLElement>(".reason-cell")!;
  }

  it("marks a refusal whose answer a person overrode", async () => {
    rankedWithOverride("The ministry confirmed by email.");

    const reason = await spainsReason();

    const mark = within(reason).getByText("overridden by hand");
    expect(mark).toHaveAttribute("title", "Overridden: The ministry confirmed by email.");
  });

  it("marks nothing where the answer was not overridden", async () => {
    rankedWithOverride(null);

    expect(await spainsReason()).not.toHaveTextContent(/overridden/i);
  });
});
