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
 * **Saving and listing are in two places, as the design has them.** The sidebar lists what has
 * been kept, because a saved ranking is about the session rather than about one screen; Rank
 * owns the act of saving and the view of the one that was opened. These tests exercise both
 * ends, because the interesting behaviour is that they stay in step.
 */

/** Where a ranking is saved: the panel under the table on Rank. */
async function savingPanel(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: /save this ranking/i });
}

/** Where saved rankings are listed: the sidebar card, present on every screen. */
async function savedList(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: /saved rankings/i });
}

/**
 * The saving panel, once saving is actually possible.
 *
 * A ranking is saved for a criteria set at a level, so the button stays disabled until the
 * shell has resolved both. Clicking before then does nothing, which reads in a failure as
 * "saving is broken" rather than "the test was early".
 *
 * **The panel is re-queried after the wait, never captured before it.** `RankScreen` keys the
 * ranking on the selection, so resolving it remounts that subtree -- and an element captured
 * beforehand is a detached node that still answers queries with the state it had when it was
 * torn out.
 */
// No explicit return type: `within` is generic, so `ReturnType<typeof within>` instantiates
// it as `any` and every query off the result becomes an unsafe call. Inference gives the
// real thing.
async function armedPanel() {
  await waitFor(() =>
    expect(
      within(
        screen.getByRole("region", { name: /save this ranking/i }),
      ).getByRole("button", { name: /save this ranking/i }),
    ).toBeEnabled(),
  );
  return within(await savingPanel());
}

async function saveOne(note?: string) {
  const panel = await armedPanel();
  if (note !== undefined) {
    await userEvent.type(
      panel.getByLabelText(/why this one is worth keeping/i),
      note,
    );
  }
  await userEvent.click(
    panel.getByRole("button", { name: /save this ranking/i }),
  );
  return panel;
}

describe("saved rankings", () => {
  it("says nothing is saved yet, and why", async () => {
    renderShell("/rank");

    const list = within(await savedList());
    expect(await list.findByText(/none yet/i)).toBeInTheDocument();
    const panel = await armedPanel();
    expect(
      panel.getByText(/nothing is kept until you save it/i),
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

  it("clears the note once it has been saved, so the next one starts empty", async () => {
    renderShell("/rank");
    const panel = await armedPanel();
    const note = panel.getByLabelText(/why this one is worth keeping/i);
    await userEvent.type(note, "a reason");
    await userEvent.click(
      panel.getByRole("button", { name: /save this ranking/i }),
    );

    await within(await savedList()).findByText("a reason");
    expect(note).toHaveValue("");
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

    const panel = within(await savingPanel());
    expect(
      await panel.findByText(/as it was when it was saved/i),
    ).toBeInTheDocument();
    // Frozen, so no drill-down into evidence that has since moved on.
    const frozen = within(
      await panel.findByRole("table", { name: /ranked candidates/i }),
    );
    expect(frozen.queryByRole("button")).toBeNull();
  });

  it("closes a saved ranking that was open", async () => {
    renderShell("/rank");
    await saveOne();
    const list = within(await savedList());
    await list.findByText(/default, country/i);
    await userEvent.click(list.getAllByRole("link")[0]!);

    const panel = within(await savingPanel());
    await panel.findByText(/as it was when it was saved/i);
    await userEvent.click(
      panel.getByRole("button", { name: /close this saved ranking/i }),
    );

    await waitFor(() =>
      expect(
        within(document.body).queryByText(/as it was when it was saved/i),
      ).toBeNull(),
    );
  });

  it("reports a refusal to save, and keeps the note so nothing is retyped", async () => {
    renderShell("/rank");
    const panel = await armedPanel();

    mockServer.use(
      http.post("/v1/evaluations", () =>
        HttpResponse.json(
          { code: "score_scale_not_set", message: "not set" },
          { status: 409 },
        ),
      ),
    );

    const note = panel.getByLabelText(/why this one is worth keeping/i);
    await userEvent.type(note, "worth keeping");
    await userEvent.click(
      panel.getByRole("button", { name: /save this ranking/i }),
    );

    expect(await panel.findByRole("alert")).toHaveTextContent(
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
