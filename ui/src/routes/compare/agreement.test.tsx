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
  const text = (element.textContent ?? "").replace("\u2212", "-").replace(/,/g, "");
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

/** The total gap in this comparator's column of the matrix. */
function inTheColumn(table: HTMLElement, comparator: string): PrintedGap {
  const headers = within(table)
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
  const total = within(table).getByRole("row", { name: /total score/i });
  const cell = total.querySelectorAll("th, td")[headers.indexOf(comparator)];
  return printed(cell?.querySelector(".matrix__delta"), `in ${comparator}'s column`);
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
