import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { HOLDINGS_GAPS, HOLDINGS_PAIRS_TOTAL } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * UF-082 (PL-121): **the refresh-everything card confirms like the others.** No button spends on
 * click: its estimate arms the same strip, and nothing is started until "Yes, start it". The
 * card says how much it would re-ask, worded from the refetch setting.
 */

const BASE = "/v1";

function countStarts(): { count: number } {
  const starts = { count: 0 };
  mockServer.use(
    http.post(`${BASE}/data-acquisition-runs`, () => {
      starts.count += 1;
    }),
  );
  return starts;
}

async function theRefreshCard() {
  const heading = await screen.findByRole("heading", {
    name: /an acquisition over every country candidate/i,
  });
  return within(heading.closest("section")!);
}

describe("refreshing everything", () => {
  it("arms the confirmation strip, and starts nothing until it is agreed to", async () => {
    const starts = countStarts();
    renderShell("/acquire");
    const card = await theRefreshCard();

    await userEvent.click(card.getByRole("button", { name: /estimate an acquisition/i }));

    const strip = within(await card.findByRole("alert"));
    expect(strip.getByText(/^This starts a new acquisition/)).toBeInTheDocument();
    expect(strip.getByRole("button", { name: "Not yet" })).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /start this acquisition/i })).toBeNull();
    expect(starts.count).toBe(0);

    await userEvent.click(strip.getByRole("button", { name: "Yes, start it" }));

    await waitFor(() => expect(starts.count).toBe(1));
  });

  it("starts nothing on Not yet, and puts the strip away", async () => {
    const starts = countStarts();
    renderShell("/acquire");
    const card = await theRefreshCard();
    await userEvent.click(card.getByRole("button", { name: /estimate an acquisition/i }));

    await userEvent.click(await card.findByRole("button", { name: "Not yet" }));

    expect(card.queryByRole("alert")).toBeNull();
    expect(starts.count).toBe(0);
  });

  it("says it re-asks every value while no refetch age is set", async () => {
    renderShell("/acquire");
    const card = await theRefreshCard();

    expect(
      await card.findByText(
        new RegExp(`^Re-asks all ${HOLDINGS_PAIRS_TOTAL.toLocaleString("en-GB")} values at country level, fresh ones included`),
      ),
    ).toBeInTheDocument();
  });

  it("says it re-asks only what the refetch age leaves, once one is set", async () => {
    mockServer.use(
      http.get(`${BASE}/holdings`, () =>
        HttpResponse.json({
          level: "country",
          pairs_total: 1152,
          values_stored: 1152 - HOLDINGS_GAPS.failed.length - HOLDINGS_GAPS.unanswered.length,
          values_past_allowed_age: 0,
          values_older_than_refetch_age: 544,
          spent: { since: "2026-10-01T00:00:00+02:00", runs_eur: 0, research_eur: 0, total_eur: 0 },
          gaps: HOLDINGS_GAPS,
        }),
      ),
    );
    renderShell("/acquire");
    const card = await theRefreshCard();

    expect(
      await card.findByText(/^Re-asks the 544 values fetched longer ago than the refetch setting allows/),
    ).toBeInTheDocument();
    expect(card.queryByText(/fresh ones included/)).toBeNull();
  });
});
