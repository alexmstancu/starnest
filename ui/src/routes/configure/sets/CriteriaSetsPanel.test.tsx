import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderShell } from "../../../testing/renderShell";

/**
 * Making, renaming and discarding a set of priorities.
 *
 * **A new set is empty, and the screen says so.** Copying another set's weights would be
 * deciding for the user; asking for a copy is a separate operation (`reqs.md` Q168).
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Criteria sets" }));
}

function sidebarSets(): HTMLSelectElement {
  return screen.getByRole<HTMLSelectElement>("combobox", {
    name: /active criteria set/i,
  });
}

async function create(id: string, name: string) {
  const user = userEvent.setup();
  const sets = await panel();
  await user.type(sets.getByRole("textbox", { name: "Identifier" }), id);
  await user.type(sets.getByRole("textbox", { name: "Name" }), name);
  await user.click(sets.getByRole("button", { name: "Create set" }));
}

describe("the criteria sets panel", () => {
  it("creates a set, selects it, and shows that it holds nothing yet", async () => {
    renderShell("/configure");

    await create("partner", "Partner");

    await waitFor(() => expect(sidebarSets()).toHaveValue("partner"));
    expect(
      await screen.findByText("This criteria set has no criteria."),
    ).toBeInTheDocument();
  });

  it("refuses an identifier that is already taken, rather than overwriting the set", async () => {
    renderShell("/configure");

    await create("default", "Another default");

    const sets = await panel();
    expect(await sets.findByText(/already exists/)).toBeInTheDocument();
    expect(sidebarSets()).toHaveValue("default");
  });

  it("renames the selected set, and the sidebar follows", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();

    await user.type(
      await sets.findByRole("textbox", { name: /Rename Default/ }),
      "Alex",
    );
    await user.click(sets.getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(
        within(sidebarSets()).getByRole("option", { name: "Alex" }),
      ).toBeInTheDocument(),
    );
  });

  it("moves the selection to a surviving set when the selected one is discarded", async () => {
    // P44: `discard` deleted the set and left the selection pointing at it, and the default is
    // adopted only while nothing is chosen -- so every screen went on requesting an id that no
    // longer existed, Configure showed "No such criteria set.", and a 404 is not retryable, so
    // there was no Try again to press either.
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();
    expect(sidebarSets()).toHaveValue("default");

    await user.click(
      await sets.findByRole("button", { name: "Discard Default" }),
    );

    // **Asserted through the panel, not the `<select>`.** A select whose value matches no
    // option falls back to the first one in jsdom, so `toHaveValue` passes whatever the
    // application believes -- the first version of this test passed against the bug. The
    // discard button is labelled with the *selected* set, so this fails unless the selection
    // itself moved.
    expect(
      await sets.findByRole("button", { name: "Discard Remote only" }),
    ).toBeInTheDocument();
    // The screen settles on the surviving set rather than on an error. A request for the
    // deleted id may already be in flight when it goes, so what matters is where this ends up.
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("discards a set, and it leaves the sidebar", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();

    await user.click(
      await sets.findByRole("button", { name: "Discard Default" }),
    );

    await waitFor(() =>
      expect(
        within(sidebarSets()).queryByRole("option", { name: "Default" }),
      ).not.toBeInTheDocument(),
    );
  });

  /**
   * UX review J. `POST /criteria-sets/{id}/duplicate` was served and never called, so the
   * only way to try an idea out was to edit the set in place and lose what was there.
   */
  it("duplicates a set as a full copy, not an empty one", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();

    await user.type(
      await sets.findByRole("textbox", {
        name: /identifier for a copy of Default/i,
      }),
      "experiment",
    );
    await user.type(
      sets.getByRole("textbox", { name: /name for the copy/i }),
      "Experiment",
    );
    await user.click(sets.getByRole("button", { name: /duplicate default/i }));

    await waitFor(() =>
      expect(
        within(sidebarSets()).getByRole("option", { name: "Experiment" }),
      ).toBeInTheDocument(),
    );
  });

  /** Duplicating is how an experiment starts, so the next edit belongs to the copy. */
  it("selects the copy, not the set it was copied from", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();

    await user.type(
      await sets.findByRole("textbox", {
        name: /identifier for a copy of Default/i,
      }),
      "experiment",
    );
    await user.type(
      sets.getByRole("textbox", { name: /name for the copy/i }),
      "Experiment",
    );
    await user.click(sets.getByRole("button", { name: /duplicate default/i }));

    await waitFor(() => expect(sidebarSets()).toHaveValue("experiment"));
  });

  it("asks for both an identifier and a name before it will duplicate anything", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();

    expect(
      await sets.findByRole("button", { name: /duplicate default/i }),
    ).toBeDisabled();
    await user.type(
      await sets.findByRole("textbox", {
        name: /identifier for a copy of Default/i,
      }),
      "experiment",
    );
    expect(
      sets.getByRole("button", { name: /duplicate default/i }),
    ).toBeDisabled();
  });

  it("refuses a copy whose identifier is already taken, and says so", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();

    await user.type(
      await sets.findByRole("textbox", {
        name: /identifier for a copy of Default/i,
      }),
      "remote-only",
    );
    await user.type(
      sets.getByRole("textbox", { name: /name for the copy/i }),
      "Clash",
    );
    await user.click(sets.getByRole("button", { name: /duplicate default/i }));

    expect(await sets.findByRole("alert")).toHaveTextContent(
      "criteria_set_exists",
    );
  });

  it("asks for both an identifier and a name before it will create anything", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();

    expect(sets.getByRole("button", { name: "Create set" })).toBeDisabled();
    await user.type(
      sets.getByRole("textbox", { name: "Identifier" }),
      "partner",
    );
    expect(sets.getByRole("button", { name: "Create set" })).toBeDisabled();
  });
});
