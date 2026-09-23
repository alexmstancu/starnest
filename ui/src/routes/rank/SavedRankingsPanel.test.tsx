import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * UX review A. `GET /rankings` computes and stores nothing -- which is what makes re-weighting
 * instant, and why keeping a ranking has to be a deliberate act rather than a side effect of
 * looking at one.
 *
 * **Three parts, three places, as the design has them.** Saving is an act about the ranking in
 * front of you, so it sits in that ranking's header; the list of what has been kept is about
 * the whole session, so it sits in the sidebar, in reach from Configure while a weight is
 * being moved; and the one you opened is a thing to look at, so it appears under the live
 * table it is being compared against. These tests exercise all three, because the interesting
 * behaviour is that they stay in step.
 */

/** Where saved rankings are listed: the sidebar card, present on every screen. */
async function savedList(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: /saved rankings/i });
}

/**
 * The header's save button, once saving is actually possible.
 *
 * A ranking is saved for a criteria set at a level, so it stays disabled until the shell has
 * resolved both. Clicking before then does nothing, which reads in a failure as "saving is
 * broken" rather than "the test was early".
 */
async function armedSave(): Promise<HTMLElement> {
  // **Re-queried after the wait, never captured before it.** `RankScreen` keys the ranking on
  // the selection, so resolving it remounts that subtree -- and a button found beforehand is
  // a detached node that still answers `toBeEnabled` with the state it had when it was torn
  // out, which is disabled, forever.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /save this ranking/i }),
    ).toBeEnabled(),
  );
  return screen.getByRole("button", { name: /save this ranking/i });
}

/**
 * **Two steps, as the design draws it.** One button until it is pressed, then the field and
 * the confirmation -- so the common case is one click and the field never sits there empty
 * inviting somebody to wonder what it is for.
 */
async function saveOne(note?: string) {
  await userEvent.click(await armedSave());
  if (note !== undefined) {
    await userEvent.type(
      screen.getByLabelText(/worth keeping/i),
      note,
    );
  }
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
}

describe("saved rankings", () => {
  it("says nothing is saved yet, and why", async () => {
    renderShell("/rank");

    expect(
      await within(await savedList()).findByText(/none yet/i),
    ).toBeInTheDocument();
    await armedSave();
    expect(
      screen.getByText(/nothing is kept until you save it/i),
    ).toBeInTheDocument();
  });

  it("saves the ranking with the note it was given", async () => {
    renderShell("/rank");
    await saveOne("before I raised housing");

    // It appears in the sidebar, which is the list the shell keeps.
    const list = within(await savedList());
    expect(
      await list.findByText("before I raised housing"),
    ).toBeInTheDocument();
  });

  /** A saved ranking names its criteria set and level, whether or not it has a note. */
  it("falls back to the criteria set and level when no note was given", async () => {
    renderShell("/rank");
    await saveOne();

    const list = within(await savedList());
    expect(await list.findByText(/default, country/i)).toBeInTheDocument();
  });

  /** The field goes away again, so the next save starts from one button as the first did. */
  it("puts the control back once it has saved", async () => {
    renderShell("/rank");
    await saveOne("a reason");

    await within(await savedList()).findByText("a reason");
    await waitFor(() =>
      expect(screen.queryByLabelText(/worth keeping/i)).toBeNull(),
    );
    expect(
      await screen.findByText(/nothing is kept until you save it/i),
    ).toBeInTheDocument();
  });

  it("asks for nothing when the save is cancelled", async () => {
    renderShell("/rank");
    await userEvent.click(await armedSave());
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByLabelText(/worth keeping/i)).toBeNull();
    expect(await savedList()).toBeInTheDocument();
  });

  /**
   * The divergence from the design's prototype, and the reason for it: restoring a saved
   * weight vector would overwrite whatever criteria set is being worked on.
   */
  it("shows a saved ranking rather than restoring it over the live one", async () => {
    renderShell("/rank");
    await saveOne();
    const list = within(await savedList());
    await list.findByText(/default, country/i);

    await userEvent.click(list.getAllByRole("link")[0]!);

    const opened = within(
      await screen.findByRole("region", { name: /a saved ranking/i }),
    );
    expect(
      await opened.findByText(/as it was when it was saved/i),
    ).toBeInTheDocument();
    // Frozen, so no drill-down into evidence that has since moved on.
    const frozen = within(
      await opened.findByRole("table", { name: /ranked candidates/i }),
    );
    expect(frozen.queryByRole("button")).toBeNull();
  });

  it("closes a saved ranking that was open", async () => {
    renderShell("/rank");
    await saveOne();
    const list = within(await savedList());
    await list.findByText(/default, country/i);
    await userEvent.click(list.getAllByRole("link")[0]!);

    const opened = await screen.findByRole("region", {
      name: /a saved ranking/i,
    });
    await within(opened).findByText(/as it was when it was saved/i);
    await userEvent.click(
      within(opened).getByRole("button", { name: /close/i }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /a saved ranking/i }),
      ).toBeNull(),
    );
  });

  it("reports a refusal to save, and keeps the note so nothing is retyped", async () => {
    renderShell("/rank");
    await userEvent.click(await armedSave());

    mockServer.use(
      http.post("/v1/evaluations", () =>
        HttpResponse.json(
          { code: "score_scale_not_set", message: "not set" },
          { status: 409 },
        ),
      ),
    );

    const note = screen.getByLabelText(/worth keeping/i);
    await userEvent.type(note, "worth keeping");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /top of the score range is set/i,
    );
    expect(note).toHaveValue("worth keeping");
  });

  it("reports a failure to list what has been saved", async () => {
    mockServer.use(http.get("/v1/evaluations", () => HttpResponse.error()));
    renderShell("/rank");

    const list = within(await savedList());
    expect(await list.findByRole("alert")).toHaveTextContent(
      "client.unreachable",
    );
  });
});
