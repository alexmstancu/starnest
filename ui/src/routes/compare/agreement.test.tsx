import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderShell } from "../../testing/renderShell";

/**
 * PL-091 (UF-124). **A card and its column read the same gap.** Every number on Compare reads
 * comparator minus focus: the matrix subtracts the focus's total from each comparator's, and the
 * card prints the server's `score_delta` under the comparator's name. Read the other way round,
 * a card says "ahead" in green above a column saying "behind" in red -- and until this, nothing
 * compared the two.
 *
 * Asserted for every comparator, each way round, and with a total missing on either side.
 */

/** A gap as one element prints it: the number it shows, and the way its colour reads. */
interface PrintedGap {
  value: number | null;
  tone: string | null;
}

async function compareAgainst(focus: string, comparators: readonly string[]) {
  const option = await screen.findByRole("option", { name: focus });
  await userEvent.selectOptions(await screen.findByLabelText(/focus/i), option);
  for (const name of comparators) {
    await userEvent.click(await screen.findByRole("checkbox", { name }));
  }
  await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));
}

/** The number an element prints and the way its colour reads. Missing is a failure, not a gap. */
function printed(element: Element | null | undefined, where: string): PrintedGap {
  if (!element) throw new Error(`No gap is printed ${where}.`);
  const text = (element.textContent ?? "")
    .replace("\u2212", "-")
    .replace(/,/g, "")
    .replace(/ points$/, "");
  const value = Number(text);
  return {
    value: text === "" || Number.isNaN(value) ? null : value,
    tone: /__delta--(ahead|behind|level)\b/.exec(element.className)?.[1] ?? null,
  };
}

/** The total gap on the card headed by this comparator's name. */
function onTheCard(comparator: string): PrintedGap {
  const card = screen.getByRole("heading", { name: comparator }).closest("section");
  return printed(card?.querySelector(".synthesis__delta"), `on ${comparator}'s card`);
}

/** Where a candidate's column sits, by the name its header starts with. */
function columnOf(table: HTMLElement, candidate: string): number {
  const at = within(table)
    .getAllByRole("columnheader")
    .findIndex((header) => (header.textContent ?? "").startsWith(candidate));
  if (at < 0) throw new Error(`No column for ${candidate}.`);
  return at;
}

/** One row's cell in a candidate's column. */
function cellIn(row: HTMLElement, column: number): Element | undefined {
  return row.querySelectorAll("th, td")[column];
}

/** The total gap in this comparator's column of the matrix. */
function inTheColumn(table: HTMLElement, comparator: string): PrintedGap {
  const total = within(table).getByRole("row", { name: /total score/i });
  const cell = cellIn(total, columnOf(table, comparator));
  return printed(cell?.querySelector(".matrix__delta"), `in ${comparator}'s column`);
}

/** A card's lines under one label, each as its pillar's name, its worth and its tag. */
function linesOn(comparator: string, label: string) {
  const card = screen.getByRole("heading", { name: comparator }).closest("section")!;
  const list = within(card).queryByText(label)?.parentElement;
  return (list ? within(list).queryAllByRole("listitem") : [])
    .filter((line) => line.textContent !== "Nothing")
    .map((line) => ({
      pillar: line.querySelector(".line-list__line")?.textContent ?? "",
      worth: printed(line.querySelector(".synthesis__worth"), `on ${comparator}'s line`),
      tag: line.querySelector(".chip")?.textContent ?? null,
    }));
}

/** The pillar names the card says it could not compare. */
function notComparableOn(comparator: string): string[] {
  const card = screen.getByRole("heading", { name: comparator }).closest("section")!;
  const note = card.querySelector(".synthesis__footnote")?.textContent ?? "";
  return note === "" ? [] : note.replace(/^Not comparable, no data: /, "").split(", ");
}

/** A pillar's row in the matrix, by the name it is labelled with. */
function pillarRow(table: HTMLElement, pillar: string): HTMLElement {
  const row = pillarRows(table).find((each) => labelOf(each) === pillar);
  if (!row) throw new Error(`No row for ${pillar} among ${pillarRows(table).map(labelOf).join(", ")}.`);
  return row;
}

/** Every pillar row of the matrix, the total and the header left out. */
function pillarRows(table: HTMLElement): HTMLElement[] {
  return within(table)
    .getAllByRole("row")
    .filter((row) => row.classList.contains("matrix__row") && !row.classList.contains("matrix__row--total"));
}

/** A pillar row's name, without the priority it may carry. */
function labelOf(row: HTMLElement): string {
  return row.querySelector(".matrix__toggle > span:last-child")?.textContent ?? "";
}

describe("a comparator's card and its column", () => {
  it.each([
    // Portugal 78 leads every comparator; Estonia has no total, so there is no gap to read.
    ["Portugal", { Netherlands: -7, Spain: -14, Estonia: null }],
    ["Netherlands", { Portugal: 7, Spain: -7 }],
    // A focus with no total leaves every gap unread, however its comparators scored.
    ["Estonia", { Portugal: null, Netherlands: null }],
  ])("read the same gap, comparator minus focus, with %s as the focus", async (focus, gaps) => {
    renderShell("/compare");
    await compareAgainst(focus, Object.keys(gaps));

    const table = await screen.findByRole("table", { name: /every pillar/i });
    for (const [comparator, gap] of Object.entries(gaps)) {
      const card = onTheCard(comparator);

      expect(card, comparator).toEqual(inTheColumn(table, comparator));
      expect(card.value, comparator).toBe(gap);
    }
  });
});

/**
 * G1 (b, c) and G8. **A card's lines are the matrix's pillar cells, read under "Weighted
 * impact"**, and its "#N" is the matrix's "#N priority": one meaning of each on the screen.
 */
describe("a card's pillar lines and the matrix", () => {
  async function compareByImpact(focus: string, comparators: readonly string[]) {
    renderShell("/compare");
    await compareAgainst(focus, comparators);
    await userEvent.click(await screen.findByRole("radio", { name: /weighted impact/i }));
    // The tags wait for the set, which is read beside the comparison.
    await screen.findAllByText(/#1 priority/);
    return screen.getByRole("table", { name: /every pillar/i });
  }

  it.each([
    ["Portugal", ["Netherlands", "Spain"]],
    ["Netherlands", ["Portugal", "Spain"]],
  ])("agree in direction, worth and priority with %s as the focus", async (focus, comparators) => {
    const table = await compareByImpact(focus, comparators);

    for (const comparator of comparators) {
      const column = columnOf(table, comparator);
      for (const [label, tone] of [
        ["Ahead on", "ahead"],
        ["Behind on", "behind"],
      ] as const) {
        for (const line of linesOn(comparator, label)) {
          const row = pillarRow(table, line.pillar);
          const cell = printed(cellIn(row, column)?.querySelector(".matrix__delta"), line.pillar);
          expect(cell.tone, `${comparator} ${line.pillar}`).toBe(tone);
          expect(Math.abs(cell.value! - line.worth.value!)).toBeLessThanOrEqual(0.1);
          const place = row.querySelector(".matrix__priority")?.textContent ?? null;
          expect(line.tag, `${comparator} ${line.pillar}`).toBe(place);
        }
      }
    }
  });

  it("names exactly the pillars that read no score on either side as not comparable", async () => {
    const table = await compareByImpact("Portugal", ["Netherlands", "Spain"]);
    const focusColumn = columnOf(table, "Portugal");
    const pillars = pillarRows(table).map(labelOf);

    for (const comparator of ["Netherlands", "Spain"]) {
      const column = columnOf(table, comparator);
      const unscored = pillars.filter((pillar) => {
        const row = pillarRow(table, pillar);
        return [focusColumn, column].some(
          (at) => cellIn(row, at)?.querySelector(".matrix__score")?.textContent === "No score",
        );
      });
      expect(notComparableOn(comparator), comparator).toEqual(unscored);
    }
  });
});
