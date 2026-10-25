import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderShell } from "../testing/renderShell";

/**
 * PL-018. **A route to a section lands on it**: focused, marked until the reader acts, and
 * again when the link is followed from the screen it leads to.
 */

function historyLink(): HTMLElement {
  return within(screen.getByRole("complementary")).getByRole("link", {
    name: /acquisition history/i,
  });
}

function history(): HTMLElement {
  return screen.getByRole("region", { name: "Every acquisition so far" });
}

describe("the sidebar's Acquisition history", () => {
  it("lands on the history, and keeps it marked until the reader acts", async () => {
    renderShell("/rank");
    await userEvent.click(await screen.findByRole("link", { name: /acquisition history/i }));

    await waitFor(() => expect(history()).toHaveFocus());
    expect(history()).toHaveClass("is-landed");

    await userEvent.keyboard("{Shift}");
    expect(history()).not.toHaveClass("is-landed");
  });

  it("lands again when followed from Acquire itself", async () => {
    renderShell("/acquire");
    await screen.findByRole("region", { name: "Every acquisition so far" });
    await userEvent.click(historyLink());
    await waitFor(() => expect(history()).toHaveFocus());
    await userEvent.keyboard("{Shift}");
    historyLink().focus();

    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(history()).toHaveFocus());
    expect(history()).toHaveClass("is-landed");
  });
});

describe("the sidebar's household Edit", () => {
  it("leads to the household's card on Configure, not the top", async () => {
    renderShell("/rank");
    const household = within(
      await screen.findByRole("region", { name: "Household summary" }),
    );
    expect(household.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/configure?show=household",
    );
  });
});

describe("Configure's route to the attributes with no source", () => {
  it("lands on the card, marked until a pointer press", async () => {
    renderShell("/acquire?show=unsourced");
    const card = await screen.findByRole("region", { name: /attributes with no data source/i });

    await waitFor(() => expect(card).toHaveFocus());
    expect(card).toHaveClass("is-landed");
    await userEvent.click(screen.getByRole("heading", { level: 1, name: "Acquire" }));
    expect(card).not.toHaveClass("is-landed");
  });
});
