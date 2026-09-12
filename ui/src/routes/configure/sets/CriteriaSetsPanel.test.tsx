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
