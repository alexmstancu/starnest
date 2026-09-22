import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderShell } from "../../../testing/renderShell";

/**
 * Making, using, renaming, copying and discarding a set of priorities.
 *
 * **A new set is empty, and the screen says so.** Copying another set's weights would be
 * deciding for the user; asking for a copy is a separate operation (`reqs.md` Q168).
 *
 * **The stage is a list with four verbs, not four forms.** These tests reach a set by its
 * name and then press the verb, which is how it is used -- and which is why they no longer
 * care where on the row the button sits.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: /^criteria set/i }));
}

/** One set's row, found by what the set is called. */
async function row(name: string) {
  return within(await screen.findByRole("listitem", { name }));
}

function sidebarSets(): HTMLSelectElement {
  return screen.getByRole<HTMLSelectElement>("combobox", {
    name: /active criteria set/i,
  });
}

/** The design asks for a name; the identifier is derived from it (`setIdentifier.ts`). */
async function create(name: string) {
  const user = userEvent.setup();
  const sets = await panel();
  await user.type(sets.getByRole("textbox", { name: /name a new set/i }), name);
  await user.click(sets.getByRole("button", { name: "Create set" }));
}

describe("the criteria sets panel", () => {
  it("creates a set, selects it, and shows that it holds nothing yet", async () => {
    renderShell("/configure");

    await create("Partner");

    await waitFor(() => expect(sidebarSets()).toHaveValue("partner"));
    // A new set weighs no pillar, so there is no pillar to open and nothing inside one.
    expect(
      await screen.findByText("This set weighs no pillar yet."),
    ).toBeInTheDocument();
  });

  it("refuses an identifier that is already taken, rather than overwriting the set", async () => {
    renderShell("/configure");

    // "Default" derives `default`, which the shipped set already holds.
    await create("Default");

    const sets = await panel();
    expect(await sets.findByText(/already exists/)).toBeInTheDocument();
    expect(sidebarSets()).toHaveValue("default");
  });

  it("renames a set in place, and the sidebar follows", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    await user.click((await row("Default")).getByRole("button", { name: "Rename" }));
    const draft = (await row("Default")).getByRole("textbox", {
      name: /new name for Default/i,
    });
    await user.clear(draft);
    await user.type(draft, "Alex");
    await user.click((await row("Default")).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        within(sidebarSets()).getByRole("option", { name: "Alex" }),
      ).toBeInTheDocument(),
    );
  });

  it("leaves the name alone when a rename is cancelled", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    await user.click((await row("Default")).getByRole("button", { name: "Rename" }));
    await user.click((await row("Default")).getByRole("button", { name: "Cancel" }));

    expect(
      (await row("Default")).getByRole("button", { name: "Rename" }),
    ).toBeInTheDocument();
  });

  it("switches which set is in use", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    // The selection is adopted a render after the sets arrive, so wait rather than assuming
    // the two happen together.
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));

    await user.click((await row("Remote only")).getByRole("button", { name: "Use" }));

    await waitFor(() => expect(sidebarSets()).toHaveValue("remote-only"));
  });

  /**
   * **The four slots never move.** Unavailable is drawn as unavailable rather than as absent:
   * a hole would shift every other button one place left, and a button that moves is one you
   * have to find again.
   */
  it("keeps the verb in the same place on every row, available or not", async () => {
    renderShell("/configure");

    // "In use" appears once the shell has adopted a selection, a render after the sets land,
    // so it is waited for rather than read the moment the list arrives.
    expect(
      await screen.findByRole("button", { name: "In use" }),
    ).toBeDisabled();
    const inUse = await row("Default");
    const other = await row("Remote only");
    expect(other.getByRole("button", { name: "Use" })).toBeEnabled();

    for (const verb of ["Rename", "Duplicate", "Delete"]) {
      expect(inUse.getByRole("button", { name: verb })).toBeInTheDocument();
      expect(other.getByRole("button", { name: verb })).toBeInTheDocument();
    }
  });

  it("moves the selection to a surviving set when the selected one is discarded", async () => {
    // P44: `discard` deleted the set and left the selection pointing at it, and the default is
    // adopted only while nothing is chosen -- so every screen went on requesting an id that no
    // longer existed, Configure showed "No such criteria set.", and a 404 is not retryable, so
    // there was no Try again to press either.
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));

    await user.click((await row("Default")).getByRole("button", { name: "Delete" }));

    // **Asserted through the panel, not the `<select>`.** A select whose value matches no
    // option falls back to the first one in jsdom, so `toHaveValue` passes whatever the
    // application believes -- the first version of this test passed against the bug. The
    // surviving set becoming the one in use is what fails unless the selection itself moved.
    await waitFor(async () =>
      expect(
        (await row("Remote only")).getByRole("button", { name: "In use" }),
      ).toBeInTheDocument(),
    );
    // The screen settles on the surviving set rather than on an error. A request for the
    // deleted id may already be in flight when it goes, so what matters is where this ends up.
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("discards a set, and it leaves the sidebar", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    await user.click((await row("Default")).getByRole("button", { name: "Delete" }));

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
  it("duplicates a set as a full copy, in one press", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    await user.click(
      (await row("Default")).getByRole("button", { name: "Duplicate" }),
    );

    await waitFor(() =>
      expect(
        within(sidebarSets()).getByRole("option", { name: "Default copy" }),
      ).toBeInTheDocument(),
    );
  });

  /** Duplicating is how an experiment starts, so the next edit belongs to the copy. */
  it("selects the copy, not the set it was copied from", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    await user.click(
      (await row("Default")).getByRole("button", { name: "Duplicate" }),
    );

    await waitFor(() => expect(sidebarSets()).toHaveValue("default_copy"));
  });

  it("asks for a name before it will create anything", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();

    expect(sets.getByRole("button", { name: "Create set" })).toBeDisabled();
    // Punctuation alone derives no identifier, so it is still not a name.
    await user.type(sets.getByRole("textbox", { name: /name a new set/i }), "!!");
    expect(sets.getByRole("button", { name: "Create set" })).toBeDisabled();
  });
});
