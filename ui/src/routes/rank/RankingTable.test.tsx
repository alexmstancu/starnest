import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { rankingFor } from "../../mocks/fixtures";
import type { Ranking } from "../../api/endpoints";
import { RankingTable } from "./RankingTable";

/** A candidate's row in the ranking, found by its rowheader. */
function rowOf(name: string): HTMLElement {
  const table = screen.getByRole("table", { name: /ranked candidates/i });
  const heading = within(table)
    .getAllByRole("rowheader")
    .find((cell) => cell.textContent?.trim() === name);
  expect(heading, `no row for ${name}`).toBeDefined();
  return heading!.closest("tr")!;
}

/** PL-075 (UF-119). The classes the stylesheet draws a row's state from. */
describe("a ranking row's state classes", () => {
  it("marks a candidate that does not match", () => {
    render(<RankingTable ranking={rankingFor("default", "country")} />);

    expect(rowOf("Spain")).toHaveClass("table__row--not-matching");
    expect(rowOf("Portugal")).not.toHaveClass("table__row--not-matching");
  });

  it("marks an open row, and only that one", () => {
    render(
      <RankingTable
        ranking={rankingFor("default", "country")}
        open={[{ candidate: "country.portugal" }]}
        onToggle={() => {}}
        detail={() => null}
      />,
    );

    expect(rowOf("Portugal")).toHaveClass("table__row--open");
    expect(rowOf("Netherlands")).not.toHaveClass("table__row--open");
  });
});

/**
 * A refetched ranking can draw a row's chart without the pillar the keyboard was on. The bar
 * goes, and a browser answers by putting focus on the page, from where a keyboard user starts
 * again at the top -- so the chart hands it to its new stop instead.
 */
describe("a row's pillar chart, when the bar the keyboard is on goes", () => {
  function withoutSafety(ranking: Ranking): Ranking {
    return {
      ...ranking,
      candidates: ranking.candidates.map((result) => ({
        ...result,
        pillar_scores: result.pillar_scores?.filter(
          (pillar) => pillar.pillar !== "safety",
        ),
      })),
    };
  }

  function table(ranking: Ranking) {
    return (
      <RankingTable
        ranking={ranking}
        onToggle={() => {}}
        onChoosePillar={() => {}}
      />
    );
  }

  it("moves the keyboard to the chart's new stop", () => {
    const ranking = rankingFor("default", "country");
    const { rerender } = render(table(ranking));
    const safety = within(rowOf("Portugal")).getByRole("button", {
      name: /^safety:/i,
    });
    act(() => safety.focus());

    rerender(table(withoutSafety(ranking)));

    const economy = within(rowOf("Portugal")).getByRole("button", {
      name: /^economics:/i,
    });
    expect(economy).toHaveFocus();
  });

  it("leaves focus the reader put somewhere else", () => {
    const ranking = rankingFor("default", "country");
    const { rerender } = render(table(ranking));
    act(() =>
      within(rowOf("Portugal"))
        .getByRole("button", { name: /^safety:/i })
        .focus(),
    );
    const name = within(rowOf("Netherlands")).getByRole("button", {
      name: "Netherlands",
    });
    act(() => name.focus());

    rerender(table(withoutSafety(ranking)));

    expect(name).toHaveFocus();
  });
});

/**
 * PL-082. **A column the narrow desktop hides is hidden by its class**, on its header and on
 * every cell under it -- home's baseline cell included -- or a hidden header leaves its cells
 * standing and every cell after them reads under the wrong heading.
 */
describe("the columns the narrow desktop drops", () => {
  it("marks the Δ home and Pillars header and every cell under them", () => {
    render(
      <RankingTable
        ranking={rankingFor("default", "country")}
        household={{ state: "ready", household: { home_country_candidate: "country.portugal" } }}
      />,
    );
    const table = within(screen.getByRole("table", { name: /ranked candidates/i }));
    const headings = table.getAllByRole("columnheader");
    const delta = headings.findIndex((heading) => heading.textContent?.trim() === "Δ home");
    const pillars = headings.findIndex((heading) =>
      heading.textContent?.trim().startsWith("Pillars"),
    );

    expect(headings[delta]).toHaveClass("col--delta");
    expect(headings[pillars]).toHaveClass("col--pillars");
    const rows = table.getAllByRole("rowheader").map((heading) => heading.closest("tr")!);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const cells = [...row.querySelectorAll("th,td")];
      expect(cells[delta], `${row.textContent}'s Δ home`).toHaveClass("col--delta");
      expect(cells[pillars], `${row.textContent}'s pillars`).toHaveClass("col--pillars");
    }
  });
});
