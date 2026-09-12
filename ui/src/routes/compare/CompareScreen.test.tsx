import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * The Compare tab (`reqs.md` 8.5).
 *
 * What these tests hold is that **the screen prints the server's judgement**: the deltas, what
 * each is worth, and the sentences of the synthesis all arrive from the API. A comparison
 * assembled here would be a second opinion nobody asked for (`arch.md` 8.1).
 */

const BASE = "/v1";

async function chooseFocus(name: string) {
  // The option, not just the label: the select exists before the candidates arrive, and
  // selecting then would pass for the wrong reason.
  const option = await screen.findByRole("option", { name });
  await userEvent.selectOptions(await screen.findByLabelText(/focus/i), option);
}

async function compare(focus: string, comparator: string) {
  await chooseFocus(focus);
  await userEvent.click(
    await screen.findByRole("checkbox", { name: comparator }),
  );
  await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));
}

describe("choosing what to compare", () => {
  it("shows the comparator limit the settings configured", async () => {
    renderShell("/compare");

    expect(await screen.findByText(/up to 5 comparators/i)).toBeInTheDocument();
  });

  it("will not compare a candidate with itself", async () => {
    renderShell("/compare");

    await chooseFocus("Portugal");

    expect(screen.queryByRole("checkbox", { name: "Portugal" })).toBeNull();
  });

  it("asks for nothing until a focus and a comparator are chosen", async () => {
    renderShell("/compare");

    expect(
      await screen.findByRole("button", { name: /^compare$/i }),
    ).toBeDisabled();
  });
});

describe("the comparison", () => {
  it("shows each attribute with both sides and what the gap is worth", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const table = await screen.findByRole("table", {
      name: /every attribute/i,
    });
    const row = within(table).getByRole("row", {
      name: /cost_of_living_index/i,
    });
    expect(within(row).getByText("82")).toBeInTheDocument();
    expect(row).toHaveTextContent("+4.9 points");
  });

  it("prints the synthesis the server templated, in its order", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const advantages = await screen.findByText(/ahead on/i);
    const lines = within(advantages.parentElement!).getAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual([
      "Cost of living: 82 against 41, worth +4.9 points",
      "Coastline access: 70 against 64, worth +0.2 points",
    ]);
  });

  it("heads each pair with the score difference", async () => {
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    expect(
      await screen.findByRole("heading", {
        name: /netherlands: \+7\.0 points/i,
      }),
    ).toBeInTheDocument();
  });

  it("reports a refusal from the server rather than showing an empty table", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json(
          {
            code: "invalid_comparison",
            message: "3 comparators is more than the limit of 2",
          },
          { status: 409 },
        ),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /more than the limit/i,
    );
  });
});

describe("when a comparison cannot be drawn", () => {
  it("says what to choose before anything is selected in the sidebar", async () => {
    mockServer.use(
      http.get(`${BASE}/criteria-sets`, () => HttpResponse.json({ items: [] })),
    );
    renderShell("/compare");

    expect(
      await screen.findByText(/choose a criteria set and a level to compare/i),
    ).toBeInTheDocument();
  });

  it("says so when no comparator limit is configured", async () => {
    mockServer.use(
      http.get(`${BASE}/settings`, () =>
        HttpResponse.json({
          min_coverage: 60,
          score_scale_max: 100,
          comparator_limit: null,
        }),
      ),
    );
    renderShell("/compare");

    expect(
      await screen.findByText(/no comparator limit is configured/i),
    ).toBeInTheDocument();
  });

  it("lets a comparator be taken off again", async () => {
    renderShell("/compare");
    await chooseFocus("Portugal");
    const netherlands = await screen.findByRole("checkbox", {
      name: "Netherlands",
    });

    await userEvent.click(netherlands);
    await userEvent.click(netherlands);

    expect(netherlands).not.toBeChecked();
    expect(screen.getByRole("button", { name: /^compare$/i })).toBeDisabled();
  });

  it("shows a dash where a side has no figure", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, () =>
        HttpResponse.json({
          criteria_set: "default",
          level: "country",
          focus: {
            candidate: "country.portugal",
            name: "Portugal",
            score: 78,
            coverage: 92,
            match_status: "matching",
          },
          comparators: [
            {
              candidate: "country.netherlands",
              name: "Netherlands",
              score: null,
              coverage: 0,
              match_status: "insufficient_data",
            },
          ],
          attributes: [
            {
              attribute: "country.broadband_coverage",
              pillar: "connectivity",
              focus: { normalised_score: null },
              comparators: [
                {
                  candidate: "country.netherlands",
                  normalised_score: null,
                  delta: null,
                },
              ],
            },
          ],
          synthesis: [
            {
              comparator: "country.netherlands",
              score_delta: null,
              advantages: [],
              disadvantages: [],
            },
          ],
        }),
      ),
    );
    renderShell("/compare");

    await compare("Portugal", "Netherlands");

    const table = await screen.findByRole("table", {
      name: /every attribute/i,
    });
    const row = within(table).getByRole("row", { name: /broadband/i });
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: /netherlands: — points/i }),
    ).toBeInTheDocument();
  });
});
