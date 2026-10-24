import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteCriteriaSet } from "../../../api/endpoints";
import { mockServer } from "../../../mocks/server";
import {
  expectHeld,
  followChromiumFocusFixup,
} from "../../../testing/keyboard";
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

/**
 * Holds every request of one kind until the test lets go, counting them; returning nothing then
 * hands each on to the mock's own handler, so what lands is what the server would have said.
 */
function holdRequests(
  method: "post" | "patch" | "delete",
  path: string,
): { sent: string[]; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: string[] = [];
  mockServer.use(
    http[method](path, async ({ request }) => {
      sent.push(request.url);
      await held;
    }),
  );
  return { sent, release: () => release() };
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

    // "Default!" is a name no set has, and derives `default`, which the shipped set holds.
    await create("Default!");

    const sets = await panel();
    expect(await sets.findByText("criteria_set_exists")).toBeInTheDocument();
    expect(sidebarSets()).toHaveValue("default");
  });

  it("refuses a name another set has before sending anything", async () => {
    renderShell("/configure");
    const requests = holdRequests("post", "/v1/criteria-sets");

    await create("remote ONLY ");

    expect(
      await (await panel()).findByText("A set called Remote only already exists."),
    ).toBeInTheDocument();
    expect(requests.sent).toHaveLength(0);
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
    expectHeld(await screen.findByRole("button", { name: "In use" }));
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

    expectHeld(sets.getByRole("button", { name: "Create set" }));
    // Punctuation alone derives no identifier, so it is still not a name.
    await user.type(sets.getByRole("textbox", { name: /name a new set/i }), "!!");
    expectHeld(sets.getByRole("button", { name: "Create set" }));
  });
});

/**
 * PL-037 (NEW-56). **Each press sends at most one request, and focus stays in the stage.**
 * Native `disabled` threw focus to the page from a control whose own press made it unavailable,
 * and nothing stopped a second press while the first was in flight.
 */
describe("a set action pressed from the keyboard", () => {
  beforeEach(() => followChromiumFocusFixup());

  /** Each action that sends a request, the request it sends, and how it is pressed twice. */
  const requesting: {
    action: string;
    method: "post" | "patch" | "delete";
    path: string;
    pressTwice: (user: UserEvent) => Promise<void>;
  }[] = [
    {
      action: "Create set",
      method: "post",
      path: "/v1/criteria-sets",
      pressTwice: async (user) => {
        const field = (await panel()).getByRole("textbox", { name: /name a new set/i });
        await user.type(field, "Partner{Enter}{Enter}");
      },
    },
    {
      action: "Save",
      method: "patch",
      path: "/v1/criteria-sets/:criteriaSetId",
      pressTwice: async (user) => {
        await user.click((await row("Default")).getByRole("button", { name: "Rename" }));
        await user.type(
          (await row("Default")).getByRole("textbox", { name: /new name/i }),
          " two",
        );
        const save = (await row("Default")).getByRole("button", { name: "Save" });
        await user.click(save);
        await user.click(save);
      },
    },
    {
      action: "Duplicate",
      method: "post",
      path: "/v1/criteria-sets/:criteriaSetId/duplicate",
      pressTwice: async (user) => {
        const duplicate = (await row("Default")).getByRole("button", { name: "Duplicate" });
        await user.click(duplicate);
        await user.click(duplicate);
      },
    },
    {
      action: "Delete",
      method: "delete",
      path: "/v1/criteria-sets/:criteriaSetId",
      pressTwice: async (user) => {
        const remove = (await row("Remote only")).getByRole("button", { name: "Delete" });
        await user.click(remove);
        await user.click(remove);
      },
    },
  ];

  it.each(requesting)(
    "$action pressed twice while its request is in flight sends it once",
    async ({ method, path, pressTwice }) => {
      const user = userEvent.setup();
      renderShell("/configure");
      await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
      const requests = holdRequests(method, path);

      await pressTwice(user);
      // Long enough for a second request to have been sent, had the press reached one.
      await waitFor(() => expect(requests.sent).toHaveLength(1));
      requests.release();

      await waitFor(() =>
        expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
      );
      expect(requests.sent).toHaveLength(1);
    },
  );

  /** Each action, and the control focus is on once its answer is in. */
  const settling: {
    action: string;
    press: (user: UserEvent) => Promise<void>;
    focusedOn: () => Promise<HTMLElement>;
  }[] = [
    {
      action: "Use",
      press: async (user) =>
        user.click((await row("Remote only")).getByRole("button", { name: "Use" })),
      focusedOn: async () =>
        (await row("Remote only")).getByRole("button", { name: "In use" }),
    },
    {
      action: "Create set",
      press: async (user) => {
        await user.type(
          (await panel()).getByRole("textbox", { name: /name a new set/i }),
          "Partner",
        );
        await user.click((await panel()).getByRole("button", { name: "Create set" }));
      },
      focusedOn: async () => (await panel()).getByRole("button", { name: "Create set" }),
    },
    {
      action: "Save",
      press: async (user) => {
        await user.click((await row("Default")).getByRole("button", { name: "Rename" }));
        await user.type(
          (await row("Default")).getByRole("textbox", { name: /new name/i }),
          " two",
        );
        await user.click((await row("Default")).getByRole("button", { name: "Save" }));
      },
      focusedOn: async () =>
        (await row("Default two")).getByRole("button", { name: "Rename" }),
    },
    {
      action: "Duplicate",
      press: async (user) =>
        user.click((await row("Default")).getByRole("button", { name: "Duplicate" })),
      focusedOn: async () =>
        (await row("Default")).getByRole("button", { name: "Duplicate" }),
    },
    {
      // The row that takes the deleted one's place, in the same slot.
      action: "Delete",
      press: async (user) =>
        user.click((await row("Default")).getByRole("button", { name: "Delete" })),
      focusedOn: async () =>
        (await row("Remote only")).getByRole("button", { name: "Delete" }),
    },
  ];

  it.each(settling)(
    "$action leaves focus on a control that is still in the stage",
    async ({ press, focusedOn }) => {
      const user = userEvent.setup();
      renderShell("/configure");
      await waitFor(() => expect(sidebarSets()).toHaveValue("default"));

      await press(user);

      await waitFor(async () => expect(document.activeElement).toBe(await focusedOn()));
    },
  );

  it("sends nothing for Enter in an empty name field, and says why", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = await panel();
    const requests = holdRequests("post", "/v1/criteria-sets");

    await user.click(sets.getByRole("textbox", { name: /name a new set/i }));
    await user.keyboard("{Enter}");

    expect(await sets.findByText("Give the new set a name first.")).toBeInTheDocument();
    expect(requests.sent).toHaveLength(0);
  });
});

/** PL-038. Rename is complete from the keyboard: it opens on the name, Enter saves, Escape cancels. */
describe("renaming a set from the keyboard", () => {
  beforeEach(() => followChromiumFocusFixup());

  it("puts focus in the field with the name selected", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    await user.click((await row("Default")).getByRole("button", { name: "Rename" }));

    const field = (await row("Default")).getByRole<HTMLInputElement>("textbox", {
      name: /new name for Default/i,
    });
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, "Default".length]);
  });

  it("saves on Enter and returns focus to Rename", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    await user.click((await row("Default")).getByRole("button", { name: "Rename" }));
    await user.keyboard("Alex{Enter}");

    const renamed = await row("Alex");
    await waitFor(() =>
      expect(document.activeElement).toBe(renamed.getByRole("button", { name: "Rename" })),
    );
  });

  it("cancels on Escape, sends nothing, and returns focus to Rename", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const requests = holdRequests("patch", "/v1/criteria-sets/:criteriaSetId");

    await user.click((await row("Default")).getByRole("button", { name: "Rename" }));
    await user.keyboard("Alex{Escape}");

    const kept = await row("Default");
    await waitFor(() =>
      expect(document.activeElement).toBe(kept.getByRole("button", { name: "Rename" })),
    );
    expect(requests.sent).toHaveLength(0);
  });
});

/**
 * UI-28. **An empty list that has arrived is not a list still on its way.** The selection treated
 * the two alike, so discarding the last set left it selected: every screen went on showing and
 * asking for a set the server no longer had.
 */
describe("when every set has been discarded", () => {
  /**
   * The last set goes from this screen, the other having gone elsewhere -- another tab, say. The
   * panel will not delete the only set it lists, so the list it holds must still show two.
   */
  async function discardTheLastSet(): Promise<void> {
    const user = userEvent.setup();
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await row("Remote only");
    await deleteCriteriaSet("remote-only");

    await user.click((await row("Default")).getByRole("button", { name: "Delete" }));
  }

  it("leaves nothing selected when the last sets are gone", async () => {
    renderShell("/configure");

    await discardTheLastSet();

    expect(
      await screen.findByText("Choose a criteria set to see its criteria."),
    ).toBeInTheDocument();
    // The stage stays drawn (PL-013); it holds no pillar of a set that is gone.
    expect(
      within(screen.getByRole("region", { name: "Pillar weights" })).queryAllByRole("slider"),
    ).toEqual([]);
  });

  it("selects a set created once the last one has gone", async () => {
    renderShell("/configure");
    await discardTheLastSet();
    await screen.findByText("Choose a criteria set to see its criteria.");

    await create("Partner");

    await waitFor(() => expect(sidebarSets()).toHaveValue("partner"));
    expect(
      await screen.findByText("This set weighs no pillar yet."),
    ).toBeInTheDocument();
  });
});
