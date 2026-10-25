import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * PL-011 on Acquire. **A database holding no value leads with the way to fill it**: "Nothing
 * acquired yet", and See the estimate -- which estimates and arms, and starts nothing.
 */

const BASE = "/v1";

function storedValues(total: number): void {
  mockServer.use(http.get(`${BASE}/values`, () => HttpResponse.json({ items: [], total })));
}

describe("Acquire with nothing stored", () => {
  it("says nothing has been acquired, in place of the figures and the remedies", async () => {
    storedValues(0);
    renderShell("/acquire");

    const card = await screen.findByRole("region", { name: "Nothing acquired yet" });
    expect(within(card).getByRole("button", { name: "See the estimate" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /what the database holds/i })).toBeNull();
    // The history stays: a database with nothing stored may still have runs that stored nothing.
    expect(screen.getByRole("heading", { name: "Every acquisition so far" })).toBeInTheDocument();
  });

  it("See the estimate asks for the level's estimate and arms it in the card, starting nothing", async () => {
    storedValues(0);
    const sent: string[] = [];
    mockServer.events.on("request:start", ({ request }) => {
      if (request.method === "POST") sent.push(new URL(request.url).pathname);
    });
    renderShell("/acquire");

    const card = await screen.findByRole("region", { name: "Nothing acquired yet" });
    await userEvent.click(within(card).getByRole("button", { name: "See the estimate" }));

    expect(await within(card).findByRole("button", { name: "Yes, start it" })).toBeInTheDocument();
    expect(sent).toEqual([`${BASE}/data-acquisition-runs/plan`]);
    mockServer.events.removeAllListeners();
  });

  it("draws the figures, and no card, once any value is stored", async () => {
    storedValues(3);
    renderShell("/acquire");

    expect(
      await screen.findByRole("region", { name: /what the database holds/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Nothing acquired yet" })).toBeNull();
  });
});
