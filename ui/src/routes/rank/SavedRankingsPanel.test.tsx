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
 */
async function savedPanel(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: /saved rankings/i });
}

/**
 * The panel, once saving is actually possible.
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
      within(screen.getByRole("region", { name: /saved rankings/i })).getByRole(
        "button",
        { name: /save this ranking/i },
      ),
    ).toBeEnabled(),
  );
  return within(await savedPanel());
}

describe("saved rankings", () => {
  it("says nothing is saved yet, and why", async () => {
    renderShell("/rank");

    const panel = await armedPanel();
    expect(
      await panel.findByText(/no ranking has been saved yet/i),
    ).toBeInTheDocument();
    expect(panel.getByText(/nothing is kept until you keep it/i)).toBeInTheDocument();
  });

  it("saves the ranking with the note it was given", async () => {
    renderShell("/rank");
    const panel = await armedPanel();
    await panel.findByText(/no ranking has been saved yet/i);

    await userEvent.type(
      panel.getByLabelText(/why this one is worth keeping/i),
      "before I raised housing",
    );
    await userEvent.click(
      panel.getByRole("button", { name: /save this ranking/i }),
    );

    expect(
      await panel.findByText("before I raised housing"),
    ).toBeInTheDocument();
  });

  /** A saved ranking names its criteria set and level, whether or not it has a note. */
  it("falls back to the criteria set and level when no note was given", async () => {
    renderShell("/rank");
    const panel = await armedPanel();
    await panel.findByText(/no ranking has been saved yet/i);

    await userEvent.click(
      panel.getByRole("button", { name: /save this ranking/i }),
    );

    expect(await panel.findByText(/default, country/i)).toBeInTheDocument();
  });

  it("clears the note once it has been saved, so the next one starts empty", async () => {
    renderShell("/rank");
    const panel = await armedPanel();
    await panel.findByText(/no ranking has been saved yet/i);

    const note = panel.getByLabelText(/why this one is worth keeping/i);
    await userEvent.type(note, "a reason");
    await userEvent.click(
      panel.getByRole("button", { name: /save this ranking/i }),
    );

    await panel.findByText("a reason");
    expect(note).toHaveValue("");
  });

  /**
   * The divergence from the design's prototype, and the reason for it: restoring a saved
   * weight vector would overwrite whatever criteria set is being worked on.
   */
  it("shows a saved ranking rather than restoring it over the live one", async () => {
    renderShell("/rank");
    const panel = await armedPanel();
    await panel.findByText(/no ranking has been saved yet/i);
    await userEvent.click(
      panel.getByRole("button", { name: /save this ranking/i }),
    );
    await panel.findByText(/default, country/i);

    await userEvent.click(panel.getByRole("button", { name: /^open$/i }));

    expect(
      await panel.findByText(/as it was when it was saved/i),
    ).toBeInTheDocument();
    // Frozen, so no drill-down into evidence that has since moved on.
    const frozen = within(
      await panel.findByRole("table", { name: /ranked candidates/i }),
    );
    expect(frozen.queryByRole("button", { name: /show figures/i })).toBeNull();
  });

  it("closes a saved ranking that was open", async () => {
    renderShell("/rank");
    const panel = await armedPanel();
    await panel.findByText(/no ranking has been saved yet/i);
    await userEvent.click(
      panel.getByRole("button", { name: /save this ranking/i }),
    );
    await panel.findByText(/default, country/i);

    await userEvent.click(panel.getByRole("button", { name: /^open$/i }));
    await panel.findByText(/as it was when it was saved/i);
    await userEvent.click(panel.getByRole("button", { name: /^hide$/i }));

    await waitFor(() =>
      expect(panel.queryByText(/as it was when it was saved/i)).toBeNull(),
    );
  });

  it("reports a refusal to save, and keeps the note so nothing is retyped", async () => {
    renderShell("/rank");
    const panel = await armedPanel();
    await panel.findByText(/no ranking has been saved yet/i);

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

    const panel = within(await savedPanel());
    expect(await panel.findByRole("alert")).toHaveTextContent(
      "client.unreachable",
    );
  });
});
