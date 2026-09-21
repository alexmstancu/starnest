import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderShell } from "../../../testing/renderShell";

/**
 * The outer half of the weighting.
 *
 * **Every number asserted here came back from the server.** The panel sends one weight and
 * prints the rebalanced list, so a test that computed an expected rebalance would be testing
 * arithmetic the interface deliberately does not have (`arch.md` 8.3).
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Pillar weights" }));
}

/**
 * The weight control is a slider, as the design draws it: a weight is a proportion, and the
 * question asked of it is "more or less than the one above".
 */
function weightBox(pillar: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("slider", {
    name: `${pillar} weight`,
  });
}

/**
 * **Dragging shows; letting go sends.** A range input fires `change` on every pixel of a
 * drag, so the panel commits on blur -- and so does this, which is the gesture rather than a
 * shortcut around it.
 */
async function setWeight(pillar: string, weight: string) {
  const slider = weightBox(pillar);
  fireEvent.change(slider, { target: { value: weight } });
  fireEvent.pointerUp(slider);
}

/**
 * A pillar's whole row, which is where its reading and its lock live.
 *
 * **Found by role, never by class.** `architecture.test.ts` fails a test that selects on a
 * class name, and rightly: a test coupled to the stylesheet breaks on every redesign for
 * reasons that have nothing to do with what it was checking.
 */
function rowOf(pillar: string): HTMLElement {
  return screen.getByRole("group", { name: pillar });
}

describe("the pillar weights panel", () => {
  it("shows each pillar's weight and what they sum to", async () => {
    renderShell("/configure");
    const pillars = await panel();

    expect(
      await screen.findByRole<HTMLInputElement>("slider", {
        name: "economics weight",
      }),
    ).toHaveValue("40");
    expect(weightBox("housing")).toHaveValue("35");
    expect(weightBox("safety")).toHaveValue("25");
    expect(pillars.getByText(/sum to 100%/)).toBeInTheDocument();
  });

  it("shows the weights the server rebalanced to", async () => {
    renderShell("/configure");
    await screen.findByRole("slider", { name: "economics weight" });

    await setWeight("economics", "50");

    // Housing and safety absorbed the ten points between them, in proportion. The figures are
    // the response's.
    // The slider snaps to its half-point step; the reading beside it is the server's own
    // figure, which is the number that decides anything.
    await waitFor(() =>
      expect(within(rowOf("housing")).getByText("29.2%")).toBeInTheDocument(),
    );
    expect(within(rowOf("safety")).getByText("20.8%")).toBeInTheDocument();
    expect(within(rowOf("economics")).getByText("50.0%")).toBeInTheDocument();
  });

  it("refuses the change when every other pillar is locked, and says which", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "economics weight" });

    await user.click(screen.getByRole("button", { name: "Lock housing" }));
    await user.click(screen.getByRole("button", { name: "Lock safety" }));
    await setWeight("economics", "10");

    const pillars = await panel();
    expect(await pillars.findByText(/weights_all_locked/)).toBeInTheDocument();
    // The refused weight is not shown as though it had been stored.
    expect(weightBox("housing")).toHaveValue("35");
  });

  /**
   * **The control cannot express a wrong answer.** A text field could hold "ten", which is
   * why the panel used to have to report it (P56); a slider holds a number or nothing, so a
   * nonsense value is not rejected here -- it cannot be produced. The criterion rows, which
   * are still typed, keep that test of their own.
   */
  it("never sends a weight that is not a number", async () => {
    renderShell("/configure");
    await screen.findByRole("slider", { name: "economics weight" });

    await setWeight("economics", "ten");

    // Nothing moved, and nothing was sent: the browser refused the value before React saw it.
    expect(weightBox("housing")).toHaveValue("35");
    expect(within(rowOf("economics")).getByText("40.0%")).toBeInTheDocument();
  });

  it("says so when the set weighs no pillar yet", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = within(
      await screen.findByRole("region", { name: /^criteria set/i }),
    );

    await user.type(
      sets.getByRole("textbox", { name: /name a new set/i }),
      "Empty",
    );
    await user.click(sets.getByRole("button", { name: "Create set" }));

    expect(
      await screen.findByText("This set weighs no pillar yet."),
    ).toBeInTheDocument();
  });
});
