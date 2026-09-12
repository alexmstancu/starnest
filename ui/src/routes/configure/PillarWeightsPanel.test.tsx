import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderShell } from "../../testing/renderShell";

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

function weightBox(pillar: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: `${pillar} weight`,
  });
}

async function setWeight(pillar: string, weight: string) {
  const user = userEvent.setup();
  const input = weightBox(pillar);
  const row = input.closest("tr")!;
  await user.clear(input);
  await user.type(input, weight);
  await user.click(within(row).getByRole("button", { name: "Set" }));
}

describe("the pillar weights panel", () => {
  it("shows each pillar's weight and what they sum to", async () => {
    renderShell("/configure");
    const pillars = await panel();

    expect(
      await screen.findByRole("textbox", { name: "economics weight" }),
    ).toHaveValue("40");
    expect(weightBox("housing")).toHaveValue("35");
    expect(weightBox("safety")).toHaveValue("25");
    expect(pillars.getByText(/sum to 100%/)).toBeInTheDocument();
  });

  it("shows the weights the server rebalanced to", async () => {
    renderShell("/configure");
    await screen.findByRole("textbox", { name: "economics weight" });

    await setWeight("economics", "50");

    // Housing and safety absorbed the ten points between them, in proportion. The figures are
    // the response's.
    await waitFor(() => expect(weightBox("housing")).toHaveValue("29.17"));
    expect(weightBox("safety")).toHaveValue("20.83");
    expect(weightBox("economics")).toHaveValue("50");
  });

  it("refuses the change when every other pillar is locked, and says which", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("textbox", { name: "economics weight" });

    await user.click(screen.getByRole("checkbox", { name: "Lock housing" }));
    await user.click(screen.getByRole("checkbox", { name: "Lock safety" }));
    await setWeight("economics", "10");

    const pillars = await panel();
    expect(await pillars.findByText(/weights_all_locked/)).toBeInTheDocument();
    // The refused weight is not shown as though it had been stored.
    expect(weightBox("housing")).toHaveValue("35");
  });

  it("sends nothing when the weight is not a number", async () => {
    renderShell("/configure");
    await screen.findByRole("textbox", { name: "economics weight" });

    await setWeight("economics", "ten");

    const pillars = await panel();
    expect(pillars.queryByRole("alert")).not.toBeInTheDocument();
    expect(weightBox("housing")).toHaveValue("35");
  });

  it("says so when the set weighs no pillar yet", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = within(
      await screen.findByRole("region", { name: "Criteria sets" }),
    );

    await user.type(sets.getByRole("textbox", { name: "Identifier" }), "empty");
    await user.type(sets.getByRole("textbox", { name: "Name" }), "Empty");
    await user.click(sets.getByRole("button", { name: "Create set" }));

    expect(
      await screen.findByText("This set weighs no pillar yet."),
    ).toBeInTheDocument();
  });
});
