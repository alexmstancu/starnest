import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { HttpResponse, getResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  createCriteriaSet,
  deleteCriteriaSet,
  fetchCriteriaSet,
  restoreCriteriaSet,
} from "../../../api/endpoints";
import { handlers } from "../../../mocks/handlers";
import { mockServer } from "../../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../../testing/keyboard";
import { renderShell } from "../../../testing/renderShell";
import { READ_PATIENCE_MS } from "../unknownOutcome";

/**
 * Making, using, renaming, copying and discarding a set of priorities.
 *
 * **A new set is a copy of the default** (PL-034), as the server makes it: an empty one could
 * never be ranked. Copying a chosen set is Duplicate (`reqs.md` Q168).
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

/** Recent changes, where a set verb is listed and undone. */
async function historyPanel() {
  return within(await screen.findByRole("region", { name: /^recent changes/i }));
}

/** Delete, at once: the design asks nothing first, because Recent changes can undo it. */
async function deleteSet(user: UserEvent, name: string) {
  await user.click((await row(name)).getByRole("button", { name: "Delete" }));
}

/** Every write the screen sends from now on, as "METHOD path". Reads are not writes. */
function recordWrites(): string[] {
  const writes: string[] = [];
  mockServer.events.on("request:start", ({ request }) => {
    if (request.method !== "GET") {
      writes.push(`${request.method} ${new URL(request.url).pathname}`);
    }
  });
  return writes;
}

/**
 * Holds every request of one kind until the test lets go, counting them; returning nothing then
 * hands each on to the mock's own handler, so what lands is what the server would have said.
 */
function holdRequests(
  method: "get" | "post" | "put" | "patch" | "delete",
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

/**
 * Lets the mock's own handler make the change at once and holds only its answer: a write the
 * server has committed while the screen is still waiting to hear so.
 */
function holdAnswers(
  method: "put" | "patch",
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
      const answer = await getResponse(handlers, request);
      await held;
      return answer;
    }),
  );
  return { sent, release: () => release() };
}

describe("the criteria sets panel", () => {
  it("creates a set as a copy of the default, and selects it", async () => {
    renderShell("/configure");

    await create("Partner");

    await waitFor(() => expect(sidebarSets().value).toMatch(/^partner_/));
    // A copy of the default weighs its pillars, so it can be ranked at once (PL-034).
    expect(
      await screen.findByRole("region", { name: "Pillar weights" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("This set weighs no pillar yet.")).toBeNull();
  });

  // PL-033: the identifier is this tab's own, so one derived like the shipped set's never
  // collides with it, and nothing is overwritten.
  it("gives a new set an identifier of its own, never one another set holds", async () => {
    renderShell("/configure");

    // "Default!" is a name no set has, and derives `default`, which the shipped set holds.
    await create("Default!");

    await waitFor(() => expect(sidebarSets().value).toMatch(/^default_\w+$/));
    expect(await fetchCriteriaSet("default")).toMatchObject({ id: "default", name: "Default" });
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

    await waitFor(() => expect(sidebarSets()).toHaveValue("remote_only"));
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

    await deleteSet(user, "Default");

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

    await deleteSet(user, "Default");

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

    await waitFor(() => expect(sidebarSets().value).toMatch(/^default_copy_/));
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
      press: async (user) => deleteSet(user, "Default"),
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

  it("closes a rename whose set an undo removes, and puts focus on the next row's Rename", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await create("Partner");
    const history = await historyPanel();
    await history.findByText("Created Partner");
    const partnerId = sidebarSets().value;
    await user.click((await row("Partner")).getByRole("button", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "New name for Partner" });
    expect(document.activeElement).toBe(field);

    // A click that leaves focus where it is, in the field, as a set deleted elsewhere would.
    fireEvent.click(history.getByRole("button", { name: "Undo this" }));

    await waitFor(() => expect(field.isConnected).toBe(false));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(screen.getByRole("listitem", { name: "Remote only" })).getByRole("button", {
          name: "Rename",
        }),
      ),
    );
    // Closed for good: the set coming back does not reopen a field nobody is using.
    await restoreCriteriaSet(partnerId);
    await user.click((await row("Default")).getByRole("button", { name: "Duplicate" }));
    await row("Partner");
    expect(screen.queryByRole("textbox", { name: "New name for Partner" })).toBeNull();
  });
});

/**
 * PL-033 (UF-025, Critical), PL-035. **A deleted set is one undo away, exactly.** Delete used to
 * destroy the set on one click with no record; the server now keeps it restorable, and the
 * screen still deletes at once, as the design does (P1-27), lists the deletion in Recent
 * changes, and undoes it with the one request that brings it back.
 */
describe("deleting a set", () => {
  let writes: string[] = [];
  afterEach(() => {
    mockServer.events.removeAllListeners("request:start");
    writes = [];
  });

  it("deletes the set in use at once, with one request, and falls back to another set", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const remove = (await row("Default")).getByRole("button", { name: "Delete" });
    // As the design titles it (`.dc.html` l.2886); another set's Delete only deletes.
    expect(remove).toHaveAttribute("title", "Delete and fall back to another set");
    expect(
      (await row("Remote only")).getByRole("button", { name: "Delete" }),
    ).toHaveAttribute("title", "Delete this set");
    writes = recordWrites();

    await user.click(remove);

    await waitFor(() => expect(sidebarSets()).toHaveValue("remote_only"));
    expect(writes).toEqual(["DELETE /v1/criteria-sets/default"]);
  });

  /** T33-U1. */
  it("takes the set out at once and lists 'Deleted <name>' under Criteria set", async () => {
    const user = userEvent.setup();
    renderShell("/configure");

    await deleteSet(user, "Remote only");

    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Remote only" })).toBeNull(),
    );
    const entry = (await historyPanel()).getByText("Deleted Remote only").closest("li")!;
    expect(entry).toHaveTextContent("Criteria set");
  });

  /** T33-U2. */
  it("undoes the deletion with one POST …/restore and nothing else, and the row returns from the server", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await deleteSet(user, "Remote only");
    const history = await historyPanel();
    await history.findByText("Deleted Remote only");
    writes = recordWrites();

    await user.click(history.getByRole("button", { name: "Undo this" }));

    expect(await row("Remote only")).toBeTruthy();
    expect(writes).toEqual(["POST /v1/criteria-sets/remote_only/restore"]);
    await waitFor(() => expect(history.queryByText("Deleted Remote only")).toBeNull());
  });

  /** T33-U3. */
  it("puts the set back in use when the one in use is undeleted", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await deleteSet(user, "Default");
    await waitFor(async () =>
      expect((await row("Remote only")).getByRole("button", { name: "In use" })).toBeTruthy(),
    );

    await user.click((await historyPanel()).getByRole("button", { name: "Undo this" }));

    await waitFor(async () =>
      expect((await row("Default")).getByRole("button", { name: "In use" })).toBeTruthy(),
    );
  });

  /** T33-U4. */
  it("leaves the selection alone when another set was chosen since", async () => {
    const user = userEvent.setup();
    // Three sets, so one can be chosen after the deletion moved the selection to another.
    await createCriteriaSet("partner", "Partner");
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await deleteSet(user, "Default");
    await waitFor(() => expect(sidebarSets()).toHaveValue("partner"));
    await user.click((await row("Remote only")).getByRole("button", { name: "Use" }));

    await user.click((await historyPanel()).getByRole("button", { name: "Undo this" }));

    expect(await row("Default")).toBeTruthy();
    await waitFor(async () =>
      expect((await row("Remote only")).getByRole("button", { name: "In use" })).toBeTruthy(),
    );
    expect((await row("Default")).getByRole("button", { name: "Use" })).toBeTruthy();
  });

  /** T33-U5, S8: no later-answered write may sit above the deletion entry. */
  it("holds Delete on the set in use while a weight change to it is being saved", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const weights = holdRequests(
      "put",
      "/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId",
    );

    await user.click(await screen.findByRole("button", { name: "Lock Economy" }));
    await waitFor(() => expect(weights.sent).toHaveLength(1));
    const remove = (await row("Default")).getByRole("button", { name: "Delete" });
    expectHeld(remove);
    writes = recordWrites();
    await user.click(remove);
    expect(writes).toEqual([]);

    weights.release();
    await waitFor(() => expectNotHeld(remove));
  });

  /** T33-U6. */
  it("lets nothing be undone while a deletion is being sent", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await user.click((await row("Default")).getByRole("button", { name: "Rename" }));
    await user.keyboard("{Control>}a{/Control}Alex{Enter}");
    const history = await historyPanel();
    await history.findByText("Renamed Default to Alex");
    const deletion = holdRequests("delete", "/v1/criteria-sets/:criteriaSetId");

    await deleteSet(user, "Remote only");
    await waitFor(() => expect(deletion.sent).toHaveLength(1));

    expectHeld(history.getByRole("button", { name: "Undo this" }));
    deletion.release();
    await history.findByText("Deleted Remote only");
  });

  /** T33-U7. */
  it("keeps the entry and says why when the server refuses the restore", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await deleteSet(user, "Remote only");
    const history = await historyPanel();
    await history.findByText("Deleted Remote only");
    // Another tab takes the name meanwhile.
    await createCriteriaSet("elsewhere", "Remote only");

    await user.click(history.getByRole("button", { name: "Undo this" }));

    expect(
      await history.findByText("Another criteria set is already called “Remote only”."),
    ).toBeInTheDocument();
    expect(history.getByText("Deleted Remote only")).toBeInTheDocument();
  });
});

/** D-C03-9. The other three set verbs are listed too, each undone by the request that reverses it. */
describe("Recent changes for a set", () => {
  afterEach(() => mockServer.events.removeAllListeners("request:start"));

  it("lists a created set and undoes it by deleting it", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await create("Partner");
    const history = await historyPanel();
    await history.findByText("Created Partner");
    const writes = recordWrites();

    await user.click(history.getByRole("button", { name: "Undo this" }));

    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Partner" })).toBeNull());
    expect(writes).toEqual([expect.stringMatching(/^DELETE \/v1\/criteria-sets\/partner_\w+$/)]);
  });

  it("lists a run of renames as one, from the first name, and undoes it to that name", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    for (const name of ["Alex", "Alexa"]) {
      const current = name === "Alex" ? "Default" : "Alex";
      await user.click((await row(current)).getByRole("button", { name: "Rename" }));
      await user.keyboard(`{Control>}a{/Control}${name}{Enter}`);
      await row(name);
    }
    const history = await historyPanel();
    await history.findByText("Renamed Default to Alexa");

    await user.click(history.getByRole("button", { name: "Undo this" }));

    expect(await row("Default")).toBeTruthy();
  });

  it("lists a copy and undoes it by deleting the copy", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await user.click((await row("Default")).getByRole("button", { name: "Duplicate" }));
    const history = await historyPanel();
    await history.findByText("Duplicated Default as Default copy");
    const writes = recordWrites();

    await user.click(history.getByRole("button", { name: "Undo this" }));

    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Default copy" })).toBeNull(),
    );
    expect(writes).toEqual([expect.stringMatching(/^DELETE \/v1\/criteria-sets\/default_copy_\w+$/)]);
  });
});

/**
 * PL-033 follow-up. **A set action and another request in flight, answered in the order that
 * breaks the history.** Each case holds the responses and lets them go in that order.
 */
describe("a set action beside another request in flight", () => {
  let writes: string[] = [];
  afterEach(() => {
    mockServer.events.removeAllListeners("request:start");
    writes = [];
  });

  it("is held while an undo is being sent, so no entry is noted for a set the undo removes", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await create("Partner");
    const history = await historyPanel();
    await history.findByText("Created Partner");
    await user.click((await row("Partner")).getByRole("button", { name: "Rename" }));
    const undo = holdRequests("delete", "/v1/criteria-sets/:criteriaSetId");
    await user.click(history.getByRole("button", { name: "Undo this" }));
    await waitFor(() => expect(undo.sent).toHaveLength(1));
    writes = recordWrites();

    await user.click(screen.getByRole("textbox", { name: "New name for Partner" }));
    await user.keyboard("{Control>}a{/Control}Pat{Enter}");
    undo.release();

    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Partner" })).toBeNull());
    expect(writes).toEqual([]);
    expect(history.getByText("No changes yet.")).toBeInTheDocument();
  });

  it.each([
    {
      what: "a pillar's lock",
      path: "/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId",
      method: "put" as const,
      write: async (user: UserEvent) =>
        user.click(await screen.findByRole("button", { name: "Lock Economy" })),
      entry: "Locked the Economy pillar, in Default",
    },
    {
      what: "a criterion's lock",
      path: "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
      method: "patch" as const,
      write: async (user: UserEvent) => {
        await user.click(await screen.findByRole("button", { name: /^Economy/ }));
        await user.click(
          await screen.findByRole("button", { name: "Lock the weight for Cost of living index" }),
        );
      },
      entry: "Locked Cost of living index, in Default",
    },
  ])("holds Delete on the set $what was sent to, whichever set is in use, until it answers", async ({
    path,
    method,
    write,
    entry,
  }) => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const answer = holdAnswers(method, path);
    await write(user);
    await waitFor(() => expect(answer.sent).toHaveLength(1));
    await user.click((await row("Remote only")).getByRole("button", { name: "Use" }));
    await waitFor(() => expect(sidebarSets()).toHaveValue("remote_only"));
    const remove = (await row("Default")).getByRole("button", { name: "Delete" });
    writes = recordWrites();

    expectHeld(remove);
    await user.click(remove);
    expect(writes).toEqual([]);

    answer.release();
    const history = await historyPanel();
    await history.findByText(entry);
    await waitFor(() => expectNotHeld(remove));
    await user.click(remove);
    await history.findByText("Deleted Default");
    const entries = history.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(entries.findIndex((text) => text.includes("Deleted Default"))).toBeLessThan(
      entries.findIndex((text) => text.includes(entry)),
    );
  });

  it("does not put a restored set back in use over a set chosen while the restore was sent", async () => {
    const user = userEvent.setup();
    await createCriteriaSet("partner", "Partner");
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await deleteSet(user, "Default");
    await waitFor(() => expect(sidebarSets()).toHaveValue("partner"));
    const restore = holdRequests("post", "/v1/criteria-sets/:criteriaSetId/restore");
    await user.click((await historyPanel()).getByRole("button", { name: "Undo this" }));
    await waitFor(() => expect(restore.sent).toHaveLength(1));

    await user.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { name: "Rank", level: 1 });
    await user.selectOptions(sidebarSets(), "remote_only");
    restore.release();

    expect(await within(sidebarSets()).findByRole("option", { name: "Default" })).toBeTruthy();
    expect(sidebarSets()).toHaveValue("remote_only");
  });

  it("keeps Delete held until the refreshed list no longer shows the deleted set", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const remove = (await row("Remote only")).getByRole("button", { name: "Delete" });
    const list = holdRequests("get", "/v1/criteria-sets");
    writes = recordWrites();

    await user.click(remove);
    await waitFor(() => expect(list.sent).toHaveLength(1));
    expectHeld(remove);
    await user.click(remove);
    list.release();

    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Remote only" })).toBeNull(),
    );
    expect(writes).toEqual(["DELETE /v1/criteria-sets/remote_only"]);
  });
});

/**
 * PL-033, the root of the residual races. **A history entry never outlives, or overtakes, the set
 * it targets**: a write and the deletion of its set never overlap, an entry is placed by when its
 * write was sent, an entry whose set is gone is held and says why, and every set action waits for
 * the list to show what it did.
 */
describe("an entry and the set it targets", () => {
  let writes: string[] = [];
  afterEach(() => {
    mockServer.events.removeAllListeners("request:start");
    writes = [];
  });

  /** Opens the Economy pillar and finds a criterion's lock inside it. */
  async function criterionLock(user: UserEvent): Promise<HTMLElement> {
    await user.click(await screen.findByRole("button", { name: /^Economy/ }));
    return screen.findByRole("button", { name: "Lock the weight for Cost of living index" });
  }

  it.each([
    { what: "a criterion's lock", find: criterionLock },
    {
      what: "a pillar's lock",
      find: () => screen.findByRole("button", { name: "Lock Economy" }),
    },
  ])("holds $what on a set while its deletion is being sent", async ({ find }) => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const lock = await find(user);
    const deletion = holdRequests("delete", "/v1/criteria-sets/:criteriaSetId");
    writes = recordWrites();

    await deleteSet(user, "Default");
    await waitFor(() => expect(deletion.sent).toHaveLength(1));
    expectHeld(lock);
    await user.click(lock);
    deletion.release();

    await (await historyPanel()).findByText("Deleted Default");
    expect(writes).toEqual(["DELETE /v1/criteria-sets/default"]);
  });

  it("holds the undo of a creation while a write to that set is still answering", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await create("Partner");
    const history = await historyPanel();
    await history.findByText("Created Partner");
    await waitFor(() => expect(sidebarSets().value).toMatch(/^partner_/));
    const answer = holdAnswers("put", "/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId");
    await user.click(await screen.findByRole("button", { name: "Lock Economy" }));
    await waitFor(() => expect(answer.sent).toEqual([expect.stringMatching(/\/partner_\w+\//)]));
    await user.click((await row("Remote only")).getByRole("button", { name: "Use" }));
    await waitFor(() => expect(sidebarSets()).toHaveValue("remote_only"));
    const undo = history.getByRole("button", { name: "Undo this" });
    writes = recordWrites();

    expectHeld(undo);
    await user.click(undo);
    expect(writes).toEqual([]);
    answer.release();

    await history.findByText("Locked the Economy pillar, in Partner");
    await user.click(history.getByRole("button", { name: "Undo this and the 1 after it" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Partner" })).toBeNull());
    expect(writes).toEqual([
      expect.stringMatching(/^PUT \/v1\/criteria-sets\/partner_\w+\/pillar-weights\/economics$/),
      expect.stringMatching(/^DELETE \/v1\/criteria-sets\/partner_\w+$/),
    ]);
    expect(history.getByText("No changes yet.")).toBeInTheDocument();
  });

  it("holds Rename until the list read after an undo has landed", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await create("Partner");
    const history = await historyPanel();
    await history.findByText("Created Partner");
    const list = holdRequests("get", "/v1/criteria-sets");
    writes = recordWrites();

    await user.click(history.getByRole("button", { name: "Undo this" }));
    await waitFor(() => expect(list.sent).toHaveLength(1));
    const rename = (await row("Partner")).getByRole("button", { name: "Rename" });
    expectHeld(rename);
    await user.click(rename);
    expect(screen.queryByRole("textbox", { name: "New name for Partner" })).toBeNull();
    list.release();

    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Partner" })).toBeNull());
    expect(writes).toEqual([expect.stringMatching(/^DELETE \/v1\/criteria-sets\/partner_\w+$/)]);
  });

  it("keeps Delete held after the list fails to be read again, and offers Try again", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const remove = (await row("Remote only")).getByRole("button", { name: "Delete" });
    mockServer.use(
      http.get(
        "/v1/criteria-sets",
        () =>
          HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 }),
        { once: true },
      ),
    );
    writes = recordWrites();

    await user.click(remove);
    const retry = await (await panel()).findByRole("button", { name: "Try again" });
    expectHeld(remove);
    // Restore waits too: the row it would bring back is not yet known to be gone.
    expectHeld((await historyPanel()).getByRole("button", { name: "Undo this" }));
    await user.click(remove);
    await user.click(retry);

    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Remote only" })).toBeNull(),
    );
    expect(writes).toEqual(["DELETE /v1/criteria-sets/remote_only"]);
  });

  it("puts focus on the new-set field when Try again takes its own button away", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const remove = (await row("Remote only")).getByRole("button", { name: "Delete" });
    mockServer.use(
      http.get(
        "/v1/criteria-sets",
        () =>
          HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 }),
        { once: true },
      ),
    );
    await user.click(remove);
    const retry = await (await panel()).findByRole("button", { name: "Try again" });
    const list = holdRequests("get", "/v1/criteria-sets");

    retry.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(list.sent).toHaveLength(1));

    expect(retry.isConnected).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: /name a new set/i }),
    );
    list.release();
  });

  const PILLAR_LOCK = {
    method: "put" as const,
    path: "/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId",
    press: async (user: UserEvent) =>
      user.click(await screen.findByRole("button", { name: "Lock Economy" })),
    entry: "Locked the Economy pillar, in Default",
  };
  const CRITERION_LOCK = {
    method: "patch" as const,
    path: "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
    press: async (user: UserEvent) => user.click(await criterionLock(user)),
    entry: "Locked Cost of living index, in Default",
  };

  /** Moves a pillar's weight and lets go, which is the whole gesture. */
  function movePillar(pillar: string, weight: string): void {
    const slider = screen.getByRole("slider", { name: `${pillar} weight` });
    fireEvent.change(slider, { target: { value: weight } });
    fireEvent.pointerUp(slider);
  }

  it.each([
    { what: "a pillar's lock", lock: PILLAR_LOCK },
    { what: "a criterion's lock", lock: CRITERION_LOCK },
  ])("holds $what whose set was deleted elsewhere, says why, and frees it once the set is back", async ({
    lock,
  }) => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await lock.press(user);
    const history = await historyPanel();
    await history.findByText(lock.entry);
    await user.click((await row("Remote only")).getByRole("button", { name: "Use" }));
    await waitFor(() => expect(sidebarSets()).toHaveValue("remote_only"));
    const renameRemoteOnly = async (from: string, to: string) => {
      await user.click((await row(from)).getByRole("button", { name: "Rename" }));
      await user.keyboard(`{Control>}a{/Control}${to}{Enter}`);
      await row(to);
    };

    // Another tab deletes it; the next set action reads the list that says so.
    await deleteCriteriaSet("default");
    await renameRemoteOnly("Remote only", "Remote");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Default" })).toBeNull());

    const entry = history.getByText(lock.entry).closest("li")!;
    expect(within(entry).getByText("Its set was deleted: restore it to undo this.")).toBeTruthy();
    expectHeld(within(entry).getByRole("button"));
    expectNotHeld(history.getByRole("button", { name: "Undo this" }));

    await restoreCriteriaSet("default");
    await renameRemoteOnly("Remote", "Remote only");
    await row("Default");
    await waitFor(() => expectNotHeld(within(entry).getByRole("button")));
    expect(within(entry).queryByText(/Its set was deleted/)).toBeNull();
  });

  /** Single flight: one write at a time across the screen, and every other one held, saying why. */
  it("never has two writes in flight, and holds every other action until the one answers", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await screen.findByRole("slider", { name: "Economy weight" });
    movePillar("Economy", "50");
    const history = await historyPanel();
    await history.findByText(/Pillar weight for Economy/);
    const pending = holdRequests(CRITERION_LOCK.method, CRITERION_LOCK.path);
    await CRITERION_LOCK.press(user);
    await waitFor(() => expect(pending.sent).toHaveLength(1));
    writes = recordWrites();

    const held = [
      await screen.findByRole("button", { name: "Lock Economy" }),
      (await row("Remote only")).getByRole("button", { name: "Delete" }),
      (await row("Default")).getByRole("button", { name: "Duplicate" }),
      history.getByRole("button", { name: "Undo this" }),
    ];
    for (const control of held) {
      expectHeld(control);
      await user.click(control);
    }
    // Enter in the name field submits whatever the button looks like, so the writer refuses too.
    await create("Partner");
    expect(writes).toEqual([]);
    expect(history.getByRole("status")).toHaveTextContent(
      "A change is being saved; the next waits until it is stored.",
    );

    pending.release();
    await history.findByText(CRITERION_LOCK.entry);
    await waitFor(() => held.filter((control) => control.isConnected).forEach(expectNotHeld));
    expect(history.queryByRole("status")).toBeNull();
  });

  it("does not let a later move of a weight collapse past a write still answering", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await screen.findByRole("slider", { name: "Economy weight" });
    movePillar("Economy", "50");
    const history = await historyPanel();
    await history.findByText(/Pillar weight for Economy: 40.* to 50/);
    const lock = await criterionLock(user);
    const answer = holdAnswers(CRITERION_LOCK.method, CRITERION_LOCK.path);
    await user.click(lock);
    await waitFor(() => expect(answer.sent).toHaveLength(1));
    writes = recordWrites();

    movePillar("Economy", "30");
    answer.release();

    await history.findByText(CRITERION_LOCK.entry);
    expect(writes).toEqual([]);
    expect(history.getByText(/Pillar weight for Economy: 40.* to 50/)).toBeTruthy();
  });

  it("holds an undo while a write to another set answers, so going back restores the start", async () => {
    const user = userEvent.setup();
    await createCriteriaSet("partner", "Partner");
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await PILLAR_LOCK.press(user);
    const history = await historyPanel();
    await history.findByText(PILLAR_LOCK.entry);
    await deleteSet(user, "Remote only");
    await history.findByText("Deleted Remote only");
    const unlock = holdAnswers(PILLAR_LOCK.method, PILLAR_LOCK.path);
    await PILLAR_LOCK.press(user);
    await waitFor(() => expect(unlock.sent).toHaveLength(1));
    await user.click((await row("Partner")).getByRole("button", { name: "Use" }));
    await waitFor(() => expect(sidebarSets()).toHaveValue("partner"));
    const undo = history.getByRole("button", { name: "Undo this and the 1 after it" });
    writes = recordWrites();

    expectHeld(undo);
    await user.click(undo);
    expect(writes).toEqual([]);
    unlock.release();
    await history.findByText("Unlocked the Economy pillar, in Default");
    await user.click(history.getByRole("button", { name: "Back to where I started" }));

    await waitFor(() => expect(history.getByText("No changes yet.")).toBeInTheDocument());
    const economy = (await fetchCriteriaSet("default")).pillar_weights?.find(
      (each) => each.pillar === "economics",
    );
    expect(economy?.weight_locked).toBe(false);
    expect(await row("Remote only")).toBeTruthy();
  });

  it("keeps an entry below its set's deletion undoable, because the undo restores the set first", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await PILLAR_LOCK.press(user);
    const history = await historyPanel();
    await history.findByText(PILLAR_LOCK.entry);
    await user.click((await row("Remote only")).getByRole("button", { name: "Use" }));
    await deleteSet(user, "Default");
    await history.findByText("Deleted Default");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Default" })).toBeNull());
    const undo = history.getByRole("button", { name: "Undo this and the 1 after it" });
    writes = recordWrites();

    expectNotHeld(undo);
    await user.click(undo);

    await waitFor(() => expect(history.getByText("No changes yet.")).toBeInTheDocument());
    expect(writes).toEqual([
      "POST /v1/criteria-sets/default/restore",
      "PUT /v1/criteria-sets/default/pillar-weights/economics",
    ]);
  });
});

/**
 * PL-033, round 5. **Configure's one write in flight is held above the route**: every write
 * that touches a set takes it -- a rule's switch and its kind included -- it outlives the screen
 * that sent it, a write whose answer was lost is read back, and a list that never comes back
 * is a failure with Try again rather than a hold for ever.
 */
describe("the one write in flight, above the screen", () => {
  let writes: string[] = [];
  afterEach(() => {
    mockServer.events.removeAllListeners("request:start");
    writes = [];
  });
  const PILLAR_PATH = "/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId";
  const GATE_PATH = "/v1/criteria-sets/:criteriaSetId/match-rules/:matchRuleId";

  function movePillar(pillar: string, weight: string): void {
    const slider = screen.getByRole("slider", { name: `${pillar} weight` });
    fireEvent.change(slider, { target: { value: weight } });
    fireEvent.pointerUp(slider);
  }

  it("holds Delete while a rule's switch is being saved", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const gate = await screen.findByRole("switch", { name: "Enforce Free movement applies" });
    const enforce = holdRequests("put", GATE_PATH);
    await user.click(gate);
    await waitFor(() => expect(enforce.sent).toHaveLength(1));
    const remove = (await row("Default")).getByRole("button", { name: "Delete" });
    writes = recordWrites();

    expectHeld(remove);
    await user.click(remove);
    expect(writes).toEqual([]);
    enforce.release();

    await waitFor(() => expect(gate).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expectNotHeld(remove));
  });

  it("holds a rule's switch and its kind while another write is in flight", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const gate = await screen.findByRole("switch", { name: "Enforce A visa route exists" });
    const kind = screen.getByRole("combobox", { name: "What A visa route exists does when it fires" });
    const lock = holdRequests("put", PILLAR_PATH);
    await user.click(await screen.findByRole("button", { name: "Lock Economy" }));
    await waitFor(() => expect(lock.sent).toHaveLength(1));
    writes = recordWrites();

    expectHeld(gate);
    expectHeld(kind);
    await user.click(gate);
    fireEvent.change(kind, { target: { value: "warning" } });
    expect(writes).toEqual([]);
    lock.release();

    await waitFor(() => expectNotHeld(gate));
    expect(gate).toHaveAttribute("aria-checked", "true");
  });

  it("keeps a write's hold, and says why, when Configure is left and opened again", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const lock = holdRequests("put", PILLAR_PATH);
    await user.click(await screen.findByRole("button", { name: "Lock Economy" }));
    await waitFor(() => expect(lock.sent).toHaveLength(1));

    await user.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { name: "Rank", level: 1 });
    await user.click(screen.getByRole("link", { name: "Configure" }));
    const history = await historyPanel();
    const remove = (await row("Remote only")).getByRole("button", { name: "Delete" });
    writes = recordWrites();

    expectHeld(remove);
    expect(history.getByRole("status")).toHaveTextContent(
      "A change is being saved; the next waits until it is stored.",
    );
    // PL-142: the set is not drawn from a read the write in flight could outdate.
    expect(screen.queryByRole("button", { name: "Lock Economy" })).toBeNull();
    await user.click(remove);
    expect(writes).toEqual([]);
    lock.release();

    await history.findByText("Locked the Economy pillar, in Default");
    const again = await screen.findByRole("button", { name: "Lock Economy" });
    await waitFor(() => expect(again).toHaveAttribute("aria-pressed", "true"));
    await user.click(history.getByRole("button", { name: "Undo this" }));
    await waitFor(() => expect(again).toHaveAttribute("aria-pressed", "false"));
    const economy = (await fetchCriteriaSet("default")).pillar_weights?.find(
      (each) => each.pillar === "economics",
    );
    expect(economy?.weight_locked).toBe(false);
  });

  it("reads a deletion back when its answer is lost, and lists it with its restore", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    mockServer.use(
      http.delete(
        "/v1/criteria-sets/:criteriaSetId",
        async ({ request }) => {
          await getResponse(handlers, request);
          return HttpResponse.error();
        },
        { once: true },
      ),
    );

    await deleteSet(user, "Remote only");

    const history = await historyPanel();
    await history.findByText("Deleted Remote only");
    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Remote only" })).toBeNull(),
    );
    writes = recordWrites();
    await user.click(history.getByRole("button", { name: "Undo this" }));
    expect(await row("Remote only")).toBeTruthy();
    expect(writes).toEqual(["POST /v1/criteria-sets/remote_only/restore"]);
  });

  it.each([
    {
      what: "a pillar's lock",
      method: "put" as const,
      path: PILLAR_PATH,
      control: () => screen.findByRole("button", { name: "Lock Economy" }),
      shows: (control: HTMLElement) => expect(control).toHaveAttribute("aria-pressed", "true"),
      entry: "Locked the Economy pillar, in Default",
    },
    {
      what: "a criterion's lock",
      method: "patch" as const,
      path: "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
      control: () => criterionLockOf(userEvent.setup()),
      shows: (control: HTMLElement) => expect(control).toHaveAttribute("aria-pressed", "true"),
      entry: "Locked Cost of living index, in Default",
    },
    {
      what: "a rule's switch",
      method: "put" as const,
      path: GATE_PATH,
      control: () => screen.findByRole("switch", { name: "Enforce Free movement applies" }),
      shows: (control: HTMLElement) => expect(control).toHaveAttribute("aria-checked", "true"),
      entry: null,
    },
  ])("reads $what back when its answer is lost, and shows and lists what took effect", async ({
    method,
    path,
    control,
    shows,
    entry,
  }) => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const pressed = await control();
    mockServer.use(
      http[method](
        path,
        async ({ request }) => {
          await getResponse(handlers, request);
          return HttpResponse.error();
        },
        { once: true },
      ),
    );

    await user.click(pressed);

    await waitFor(() => shows(pressed));
    const history = await historyPanel();
    if (entry !== null) expect(await history.findByText(entry)).toBeInTheDocument();
    expect(screen.queryByText(/did not go through/)).toBeNull();
  });

  it("turns a list that never comes back into a failure with Try again, saying why it waits", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderShell("/configure");
    const remove = (await row("Remote only")).getByRole("button", { name: "Delete" });
    const list = holdRequests("get", "/v1/criteria-sets");

    await settledScreen();
    await user.click(remove);
    await waitFor(() => expect(list.sent).toHaveLength(1));
    const history = await historyPanel();
    expect(history.getByRole("status")).toHaveTextContent(
      "The list of sets is being read again; undo waits for it.",
    );
    act(() => {
      vi.advanceTimersByTime(READ_PATIENCE_MS);
    });
    const retry = await (await panel()).findByRole("button", { name: "Try again" });
    expectHeld(remove);
    expectHeld(history.getByRole("button", { name: "Undo this" }));
    list.release();
    await user.click(retry);

    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Remote only" })).toBeNull(),
    );
    expectNotHeld(history.getByRole("button", { name: "Undo this" }));
  });

  it("shows a pillar's late answer in the panel showing its set now, so the next change reads it", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    await screen.findByRole("slider", { name: "Economy weight" });
    const move = holdRequests("put", PILLAR_PATH);
    movePillar("Economy", "50");
    await waitFor(() => expect(move.sent).toHaveLength(1));
    await user.click((await row("Remote only")).getByRole("button", { name: "Use" }));
    await waitFor(() => expect(sidebarSets()).toHaveValue("remote_only"));
    await user.click((await row("Default")).getByRole("button", { name: "Use" }));
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));

    move.release();
    const history = await historyPanel();
    await history.findByText(/Pillar weight for Economy: 40.* to 50/);
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Economy weight" })).toHaveValue("50"),
    );
    movePillar("Housing", "40");

    await history.findByText(/Pillar weight for Housing: 29\.2% to 40/);
  });

  it("shows a criterion's late answer in the editor of a Configure opened again", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await waitFor(() => expect(sidebarSets()).toHaveValue("default"));
    const lock = holdRequests("patch", "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId");
    await user.click(await criterionLockOf(user));
    await waitFor(() => expect(lock.sent).toHaveLength(1));
    await user.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { name: "Rank", level: 1 });
    await user.click(screen.getByRole("link", { name: "Configure" }));

    lock.release();

    await (await historyPanel()).findByText("Locked Cost of living index, in Default");
    const shown = await criterionLockOf(user);
    await waitFor(() => expect(shown).toHaveAttribute("aria-pressed", "true"));
  });
});

/**
 * PL-033, round 6. **An answer lost on the way is never guessed at.** What this tab cannot
 * prove it wrote, it does not claim; what it cannot yet read back stays listed, unconfirmed,
 * with Check again; and nothing waited for waits for ever.
 */
describe("a write whose answer was lost", () => {
  let writes: string[] = [];
  afterEach(() => {
    mockServer.events.removeAllListeners("request:start");
    writes = [];
  });

  /** The deletion commits, and its answer never reaches the screen. */
  function loseTheDeletion(): void {
    mockServer.use(
      http.delete(
        "/v1/criteria-sets/:criteriaSetId",
        async ({ request }) => {
          await getResponse(handlers, request);
          return HttpResponse.error();
        },
        { once: true },
      ),
    );
  }

  it("lists it unconfirmed, with Check again, when the read-back fails, and confirms it later", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settledScreen();
    loseTheDeletion();
    mockServer.use(
      http.get(
        "/v1/criteria-sets/remote_only",
        () => HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 }),
        { once: true },
      ),
    );

    await deleteSet(user, "Remote only");

    const history = await historyPanel();
    const entry = (await history.findByText("Deleted Remote only")).closest("li")!;
    expect(within(entry).getByText(/not confirmed/i)).toBeInTheDocument();
    expectHeld(within(entry).getByRole("button", { name: "Undo this" }));
    await user.click(within(entry).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(within(entry).queryByText(/not confirmed/i)).toBeNull());
    writes = recordWrites();
    await user.click(within(entry).getByRole("button", { name: "Undo this" }));
    expect(await row("Remote only")).toBeTruthy();
    expect(writes).toEqual(["POST /v1/criteria-sets/remote_only/restore"]);
  });

  it("gives up on a read-back that never answers, lists it unconfirmed, and frees the screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderShell("/configure");
    await settledScreen();
    loseTheDeletion();
    const readBack = holdRequests("get", "/v1/criteria-sets/remote_only");

    await deleteSet(user, "Remote only");
    await waitFor(() => expect(readBack.sent).toHaveLength(1));
    const lock = await screen.findByRole("button", { name: "Lock Economy" });
    expectHeld(lock);
    act(() => {
      vi.advanceTimersByTime(READ_PATIENCE_MS);
    });

    const history = await historyPanel();
    const entry = (await history.findByText("Deleted Remote only")).closest("li")!;
    expect(within(entry).getByRole("button", { name: "Check again" })).toBeInTheDocument();
    await waitFor(() => expectNotHeld(lock));
    readBack.release();
  });

  it.each([
    {
      what: "a pillar's lock",
      method: "put" as const,
      path: "/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId",
      press: async (user: UserEvent) =>
        user.click(await screen.findByRole("button", { name: "Lock Economy" })),
      entry: "Locked the Economy pillar, in Default",
    },
    {
      what: "a criterion's lock",
      method: "patch" as const,
      path: "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
      press: async (user: UserEvent) => user.click(await criterionLockOf(user)),
      entry: "Locked Cost of living index, in Default",
    },
  ])("lists $what unconfirmed when its answer is lost and the read-back fails", async ({
    method,
    path,
    press,
    entry,
  }) => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settledScreen();
    mockServer.use(
      http[method](
        path,
        async ({ request }) => {
          await getResponse(handlers, request);
          // Only the read-back that follows fails: the screen's own reads are done.
          mockServer.use(
            http.get(
              "/v1/criteria-sets/default",
              () =>
                HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 }),
              { once: true },
            ),
          );
          return HttpResponse.error();
        },
        { once: true },
      ),
    );

    await press(user);

    const listed = (await (await historyPanel()).findByText(entry)).closest("li")!;
    expect(within(listed).getByText(/not confirmed/i)).toBeInTheDocument();
    expect(within(listed).getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("never claims a set another tab made under the same name", async () => {
    renderShell("/configure");
    await settledScreen();
    // Another tab makes Partner after this one read its list.
    await createCriteriaSet("partner", "Partner");
    // This tab's create never reaches the server.
    mockServer.use(http.post("/v1/criteria-sets", () => HttpResponse.error(), { once: true }));

    await create("Partner");

    expect(await (await panel()).findByText(/did not go through/)).toBeInTheDocument();
    expect((await historyPanel()).queryByText("Created Partner")).toBeNull();
    expect(await fetchCriteriaSet("partner")).toMatchObject({ id: "partner", name: "Partner" });
  });

  it("arms its patience again for every Try again on a list that keeps not answering", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderShell("/configure");
    await settledScreen();
    const list = holdRequests("get", "/v1/criteria-sets");

    await deleteSet(user, "Remote only");
    await waitFor(() => expect(list.sent).toHaveLength(1));
    act(() => {
      vi.advanceTimersByTime(READ_PATIENCE_MS);
    });
    await user.click(await (await panel()).findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(list.sent).toHaveLength(2));
    act(() => {
      vi.advanceTimersByTime(READ_PATIENCE_MS);
    });

    const retry = await (await panel()).findByRole("button", { name: "Try again" });
    list.release();
    await user.click(retry);
    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Remote only" })).toBeNull(),
    );
    expectNotHeld((await historyPanel()).getByRole("button", { name: "Undo this" }));
  });
});

/**
 * PL-142. **A read of a set that a write overlapped is never shown.** Configure left and opened
 * again reads its set afresh, and that read must not be one taken before a write still in flight
 * committed -- whatever became of the write's answer.
 */
describe("a set read and a write it overlaps (PL-142)", () => {
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  async function leaveAndReturn(user: UserEvent): Promise<void> {
    await user.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { name: "Rank", level: 1 });
    await user.click(screen.getByRole("link", { name: "Configure" }));
  }

  it("shows a criterion's lock as stored when Configure is opened again while it is sent", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settledScreen();
    const lock = await criterionLockOf(user);
    const write = deferred();
    const staleRead = deferred();
    let committed = false;
    let heldARead = false;
    mockServer.use(
      http.patch(
        "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
        async ({ request }) => {
          await write.promise;
          await getResponse(handlers, request);
          committed = true;
          return HttpResponse.error();
        },
        { once: true },
      ),
    );
    await user.click(lock);
    await user.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { name: "Rank", level: 1 });
    // Configure opened again reads its set before the write commits, and that read is answered
    // only after the reconciliation has.
    mockServer.use(
      http.get("/v1/criteria-sets/default", async ({ request }) => {
        if (committed || heldARead) return undefined;
        heldARead = true;
        const before = await getResponse(handlers, request);
        await staleRead.promise;
        return before;
      }),
    );
    await user.click(screen.getByRole("link", { name: "Configure" }));
    await screen.findByRole("heading", { name: "Configure", level: 1 });
    // Long enough for the screen's read to have been sent, were it going to be.
    await new Promise((resolve) => setTimeout(resolve, 50));
    write.resolve();
    await (await historyPanel()).findByText("Locked Cost of living index, in Default");
    staleRead.resolve();

    const shown = await criterionLockOf(user);
    await waitFor(() => expect(shown).toHaveAttribute("aria-pressed", "true"));
    const stored = (await fetchCriteriaSet("default")).criteria?.find(
      (each) => each.attribute === "country.cost_of_living_index",
    );
    expect(stored?.weight_locked).toBe(true);
  });

  it("shows a rule as stored when Configure is opened again while its switch is sent", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settledScreen();
    const enforce = holdRequests("put", "/v1/criteria-sets/:criteriaSetId/match-rules/:matchRuleId");
    await user.click(await screen.findByRole("switch", { name: "Enforce Free movement applies" }));
    await waitFor(() => expect(enforce.sent).toHaveLength(1));

    await leaveAndReturn(user);
    enforce.release();

    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Enforce Free movement applies" }),
      ).toHaveAttribute("aria-checked", "true"),
    );
  });
});

/** The last panel on the screen has arrived, so every read before it has too. */
async function settledScreen(): Promise<void> {
  await screen.findByRole("region", { name: "Source priority" });
  await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
}

/** Opens the Economy pillar, if it is not open, and finds a criterion's lock inside it. */
async function criterionLockOf(user: UserEvent): Promise<HTMLElement> {
  const named = { name: "Lock the weight for Cost of living index" };
  if (screen.queryByRole("button", named) === null) {
    await user.click(await screen.findByRole("button", { name: /^Economy/ }));
  }
  return screen.findByRole("button", named);
}

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
    await deleteCriteriaSet("remote_only");

    await deleteSet(user, "Default");
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

    await waitFor(() => expect(sidebarSets().value).toMatch(/^partner_/));
    // The default is copied even once it has been deleted, as the server copies it.
    expect(
      await screen.findByRole("region", { name: "Pillar weights" }),
    ).toBeInTheDocument();
  });
});
