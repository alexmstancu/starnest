import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { replaceSettings } from "../../api/endpoints";
import type { Ranking } from "../../api/endpoints";
import { SETTINGS, comparisonFor, rankingFor } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * PL-062, the render sweep of `map-C05.md` M1. **The top of the score range is a setting**, so
 * every screen that draws a score is rendered here on a scale that is not 100 -- the live one at
 * 150, a saved one frozen at 50 -- and read back for anything that still assumes 0-100.
 *
 * It lives beside Rank because the layering keeps `app/` out of reach of this change; it renders
 * the whole shell, so Compare is swept through the same door a reader uses.
 */

const BASE = "/v1";
const LIVE_SCALE = 150;
const FROZEN_SCALE = 50;
const ASSUMES_A_HUNDRED = /\b0\s*[–-]\s*100\b/;

/** Portugal, with one pillar above 100 and one at 96 -- the two a clamp to 100 drew alike. */
function rankedOnOneFifty(criteriaSet: string, level: string): Ranking {
  const live = rankingFor(criteriaSet, level);
  return {
    ...live,
    score_scale_max: LIVE_SCALE,
    candidates: live.candidates.map((candidate) =>
      candidate.name === "Portugal"
        ? {
            ...candidate,
            pillar_scores: [
              { pillar: "economics", score: 128, weight: 20, contribution: 25.6 },
              { pillar: "safety", score: 96, weight: 10, contribution: 9.6 },
            ],
          }
        : candidate,
    ),
  };
}

/** Every piece of text a reader or a screen reader meets, tooltips included. */
function everythingSaid(container: HTMLElement): string[] {
  const said: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    said.push(node.textContent ?? "");
  }
  for (const element of container.querySelectorAll("[title],[aria-label]")) {
    said.push(element.getAttribute("title") ?? "", element.getAttribute("aria-label") ?? "");
  }
  return said;
}

function expectNoHundredAssumed(container: HTMLElement) {
  expect(everythingSaid(container).filter((text) => ASSUMES_A_HUNDRED.test(text))).toEqual([]);
}

/** The bar in a pillar chart whose tooltip carries this reading, such as ": 128,". */
function barSaying(chart: HTMLElement, reading: string): SVGRectElement {
  const bar = [...chart.querySelectorAll<SVGRectElement>("rect.pillar-chart__bar")].find(
    (rect) => rect.querySelector("title")?.textContent?.includes(reading),
  );
  expect(bar, `no bar saying "${reading}"`).toBeDefined();
  return bar!;
}

function heightOf(bar: SVGRectElement): number {
  return Number(bar.getAttribute("height"));
}

beforeEach(async () => {
  await replaceSettings({ ...SETTINGS, score_scale_max: LIVE_SCALE });
  // A publisher's own range ("0-100, higher is safer") is its figure's, not ours, and is
  // printed as it was published; it is left out so the sweep reads only what we draw.
  mockServer.use(
    http.get(`${BASE}/external-scores`, () => HttpResponse.json({ items: [] })),
  );
});

describe("the live ranking, on a scale of 150", () => {
  async function portugalOpened(): Promise<HTMLElement> {
    mockServer.use(
      http.get(`${BASE}/rankings`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        return HttpResponse.json(
          rankedOnOneFifty(query.get("criteria_set") ?? "", query.get("level") ?? ""),
        );
      }),
    );
    const { container } = renderShell("/rank");
    const table = await screen.findByRole("table", { name: /ranked candidates/i });
    const portugal = within(table)
      .getAllByRole("rowheader")
      .find((cell) => cell.textContent?.trim() === "Portugal")!
      .closest("tr")!;
    await userEvent.click(within(portugal).getByRole("button", { name: "Portugal" }));
    await screen.findByRole("columnheader", { name: "Score 0–150" });
    return container;
  }

  it("labels nothing 0–100", async () => {
    expectNoHundredAssumed(await portugalOpened());
  });

  it("keeps the ranking's own column headed exactly Score", async () => {
    await portugalOpened();
    const table = screen.getByRole("table", { name: /ranked candidates/i });
    expect(within(table).getByRole("columnheader", { name: "Score" })).toBeInTheDocument();
  });

  it("prints 128 as 128, and draws it taller than 96", async () => {
    const container = await portugalOpened();
    const chart = container.querySelector<HTMLElement>("svg.pillar-chart")!;
    const above = barSaying(chart, ": 128,");
    const below = barSaying(chart, ": 96,");

    expect(within(chart).getByText("128")).toBeInTheDocument();
    expect(heightOf(above)).toBeGreaterThan(heightOf(below));
  });

  it("draws every pillar card's track within its length, against the scale", async () => {
    const container = await portugalOpened();
    const widths = [
      ...container.querySelectorAll("rect.pillar-card__fill"),
    ].map((track) => track.getAttribute("width") ?? "");

    expect(widths).toEqual(["85.3%", "64%"]);
  });
});

describe("a ranking that carried no scale", () => {
  it("prints its scores and draws no bar against a guessed top", async () => {
    mockServer.use(
      http.get(`${BASE}/rankings`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        const { score_scale_max: _dropped, ...unscaled } = rankedOnOneFifty(
          query.get("criteria_set") ?? "",
          query.get("level") ?? "",
        );
        return HttpResponse.json(unscaled);
      }),
      http.get(`${BASE}/rankings/candidates/:candidateId`, () =>
        HttpResponse.json({ code: "not_found", message: "No such resource." }, { status: 404 }),
      ),
    );
    const { container } = renderShell("/rank");
    const table = await screen.findByRole("table", { name: /ranked candidates/i });
    const portugal = within(table)
      .getAllByRole("rowheader")
      .find((cell) => cell.textContent?.trim() === "Portugal")!
      .closest("tr")!;
    await userEvent.click(within(portugal).getByRole("button", { name: "Portugal" }));
    const cards = await screen.findByRole("heading", { name: /pillar contributions/i });

    expect(within(cards.parentElement!).getByText("128")).toBeInTheDocument();
    expect(container.querySelector("rect.pillar-card__fill")).toBeNull();
    expect(portugal.querySelector("svg.pillar-chart")).toBeNull();
  });
});

describe("a saved ranking, frozen at a scale of 50", () => {
  const SAVED = {
    id: 41,
    criteria_set: "default",
    level: "country",
    computed_at: "2026-09-21T09:00:00Z",
    score_scale_max: FROZEN_SCALE,
  };

  async function savedOpened(): Promise<HTMLElement> {
    const live = rankingFor(SAVED.criteria_set, SAVED.level);
    mockServer.use(
      http.get(`${BASE}/evaluations`, () => HttpResponse.json({ items: [SAVED] })),
      http.get(`${BASE}/evaluations/${SAVED.id}`, () =>
        HttpResponse.json({
          ...live,
          evaluation: SAVED.id,
          score_scale_max: FROZEN_SCALE,
          candidates: live.candidates.map((candidate) => ({
            ...candidate,
            score: candidate.score === null ? null : 40,
            pillar_scores:
              candidate.name === "Portugal"
                ? [{ pillar: "economics", score: 48, weight: 25, contribution: 12 }]
                : [],
          })),
        } satisfies Ranking),
      ),
    );
    renderShell("/rank");
    const list = await screen.findByRole("region", { name: /saved rankings/i });
    await userEvent.click((await within(list).findAllByRole("link"))[0]!);
    return screen.findByRole("region", { name: /a saved ranking/i });
  }

  it("says the scale it was scored out of", async () => {
    const opened = await savedOpened();

    expect(await within(opened).findByText(/scored out of 50\b/i)).toBeInTheDocument();
    expectNoHundredAssumed(opened);
  });

  it("draws against its frozen scale, not today's", async () => {
    const opened = await savedOpened();
    await within(opened).findByRole("table", { name: /ranked candidates/i });
    const chart = opened.querySelector<HTMLElement>("svg.pillar-chart")!;

    // 48 of 50 fills the band; read against today's 150 it would sit near the floor.
    expect(heightOf(barSaying(chart, ": 48,"))).toBe(36);
  });
});

describe("a comparison, on a scale of 150", () => {
  it("labels its scores on the comparison's own scale, and draws its gauges against it", async () => {
    const { container } = renderShell("/compare");
    const option = await screen.findByRole("option", { name: "Portugal" });
    await userEvent.selectOptions(await screen.findByLabelText(/focus/i), option);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
    await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Economy" }));

    await waitFor(() =>
      expect(screen.getByRole("row", { name: /cost of living index/i })).toHaveTextContent(
        "normalised 0–150",
      ),
    );
    expectNoHundredAssumed(container);
    // The control for the no-scale case below: with a scale, every comparator cell has a gauge.
    expect(container.querySelectorAll("div.matrix__track").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("svg.matrix__bar").length).toBeGreaterThan(0);
  });
});

describe("a comparison that carried no scale", () => {
  it("prints its scores and draws no bar, track or tint against a guessed top", async () => {
    mockServer.use(
      http.get(`${BASE}/comparisons`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        const ranked = rankingFor("default", "country").candidates;
        const result = (id: string | null) => ranked.find((each) => each.candidate === id)!;
        const { score_scale_max: _dropped, ...unscaled } = comparisonFor(
          "default",
          "country",
          result(query.get("focus")),
          query.getAll("comparators").map(result),
        );
        return HttpResponse.json(unscaled);
      }),
    );
    const { container } = renderShell("/compare");
    const option = await screen.findByRole("option", { name: "Portugal" });
    await userEvent.selectOptions(await screen.findByLabelText(/focus/i), option);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
    await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Economy" }));
    const row = await screen.findByRole("row", { name: /cost of living index/i });

    expect(row).toHaveTextContent("73");
    expect(row).toHaveTextContent("normalised score");
    expect(container.querySelectorAll("svg.matrix__bar")).toHaveLength(0);
    expect(container.querySelectorAll("svg.matrix__tint")).toHaveLength(0);
    // An empty track with its centre tick is still a gauge drawn against a top nobody set.
    expect(container.querySelectorAll("div.matrix__track")).toHaveLength(0);
    expect(container.querySelectorAll("span.matrix__tick")).toHaveLength(0);
  });
});
