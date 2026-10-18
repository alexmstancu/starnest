import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../../testing/keyboard";
import { renderShell } from "../../../testing/renderShell";

/**
 * The five tuning values.
 *
 * **The behaviour worth testing is the empty one.** Every setting is provisional (`reqs.md`
 * 3.10), and an emptied field must stay empty rather than acquiring a plausible default --
 * a score scale of 100 nobody chose is exactly the fabricated number this application exists
 * to avoid.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Acquisition limits" }));
}

function field(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name });
}

describe("the settings panel", () => {
  it("shows the five stored values", async () => {
    renderShell("/configure");
    await panel();

    expect(field("Minimum coverage to score")).toHaveValue("60");
    expect(field("Top of the score range")).toHaveValue("100");
    expect(field("Candidates you can compare at once")).toHaveValue("5");
    expect(field("Spend cap per acquisition")).toHaveValue("10");
    // Empty in the shipped database, and empty here: an undecided setting shows as nothing.
    expect(field("Refetch data older than")).toHaveValue("");
  });

  /**
   * **A bare number is ambiguous and two of these are the reason.** A coverage floor of 60
   * could be a percentage or a count of attributes, and a cap of 10 could be euros or calls.
   * The unit is announced with the field rather than hidden, so it is part of what the field
   * says rather than decoration beside it.
   */
  it("says what each figure is counted in, as part of the field", async () => {
    renderShell("/configure");
    const settings = await panel();

    expect(field("Minimum coverage to score")).toHaveAccessibleDescription(
      /^%/,
    );
    expect(field("Spend cap per acquisition")).toHaveAccessibleDescription(
      /^€/,
    );
    expect(settings.getByText("candidates")).toBeInTheDocument();
    expect(settings.getByText("points")).toBeInTheDocument();
    expect(settings.getByText("days")).toBeInTheDocument();
  });

  it("saves a changed value and shows what came back", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Candidates you can compare at once"));
    await user.type(field("Candidates you can compare at once"), "3");
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() => expect(field("Candidates you can compare at once")).toHaveValue("3"));
  });

  it("leaves an emptied setting empty instead of inventing a default", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Top of the score range"));
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() => expect(field("Top of the score range")).toHaveValue(""));
  });

  it("shows a refusal, and does not claim to have saved", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Top of the score range"));
    await user.type(field("Top of the score range"), "0");
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(
      await settings.findByText(/score scale maximum must be at least 1/i),
    ).toBeInTheDocument();
    expect(settings.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("reports settings that could not be read", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json(
          { code: "internal_error", message: "no settings" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");

    expect(await screen.findByText(/no settings/)).toBeInTheDocument();
  });
});

/**
 * UX review K. All four settings are nullable with null the shipped state, and the screen
 * could not express that: an empty field looked the same as one nobody had reached yet.
 */
describe("a setting that is not set", () => {
  it("shows an empty field as Not set rather than as blank", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: null,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    expect(
      await settings.findByRole("textbox", { name: "Minimum coverage to score" }),
    ).toHaveAttribute("placeholder", "Not set");
  });

  it("says what leaving a setting blank costs", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: null,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    expect(
      await settings.findByText(/no coverage floor is in force/i),
    ).toBeInTheDocument();
    // **The wording, not either wording.** An alternation satisfied by both let the panel ship
    // "1 setting" or "One setting" indifferently, which is not a thing a test can be neutral
    // about: the sentence is what a reader gets.
    expect(
      settings.getByText(
        "One setting is not set, so the rule behind it is not in force.",
      ),
    ).toBeInTheDocument();
  });

  /** The blank that stops the product working, as against the three that leave a rule off. */
  it("raises a blocking banner when the score scale is unset", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: null,
          min_coverage: 60,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    expect(await settings.findByRole("alert")).toHaveTextContent(
      /nothing can be ranked or compared until the score scale maximum is set/i,
    );
  });

  it("says nothing at all when every setting is set", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: 60,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    await settings.findByRole("textbox", { name: "Top of the score range" });
    expect(settings.queryByRole("alert")).toBeNull();
    expect(settings.queryByText(/is not set/i)).toBeNull();
  });

  /** Read off the draft, so clearing a field says what that costs before any save. */
  it("warns as soon as a field is cleared, not only after saving", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: 60,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    await user.clear(
      await settings.findByRole("textbox", { name: "Top of the score range" }),
    );

    expect(await settings.findByRole("alert")).toHaveTextContent(
      /nothing can be ranked or compared/i,
    );
  });
});

/**
 * UI-06 and UI-10. **A save answers with the record it stored**, and the form took that answer
 * whatever had been typed since; nothing stopped a second save overlapping the first. And a lone
 * point went out as null, which is "unset" -- a cleared coverage floor nobody chose.
 */
describe("the settings panel while a save is in flight", () => {
  /** Holds every settings write until the test lets go, then lets the mock store it. */
  function holdSettingsWrites(): { sent: unknown[]; release: () => void } {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    mockServer.use(
      http.put("/v1/settings", async ({ request }) => {
        sent.push(await request.clone().json());
        await held;
      }),
    );
    return { sent, release: () => release() };
  }

  it("sends one save at a time, and says it is saving", async () => {
    const user = userEvent.setup();
    const writes = holdSettingsWrites();
    renderShell("/configure");
    const settings = await panel();

    await user.click(settings.getByRole("button", { name: "Save settings" }));
    const saving = settings.getByRole("button", { name: "Saving…" });
    expectHeld(saving);
    // Held, it still takes a click -- and Enter in a field submits as well. Neither sends.
    await user.click(saving);
    fireEvent.submit(saving.closest("form")!);
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    writes.release();

    await waitFor(() =>
      expectNotHeld(settings.getByRole("button", { name: "Save settings" })),
    );
    expect(writes.sent).toHaveLength(1);
  });

  /**
   * NEW-34. **Held, never disabled.** Chromium throws focus off a button the moment it is
   * disabled and does not give it back, so a keyboard user who saved with Enter was put back on
   * the page. jsdom keeps focus on a disabled button, which is why this follows Chromium's rule.
   */
  describe("from the keyboard", () => {
    beforeEach(() => followChromiumFocusFixup());

    it("keeps focus on Save while it saves, and a second Enter sends nothing", async () => {
      const user = userEvent.setup();
      const writes = holdSettingsWrites();
      renderShell("/configure");
      const settings = await panel();
      const save = settings.getByRole("button", { name: "Save settings" });
      act(() => save.focus());

      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(save).toHaveFocus();
      expectHeld(save);
      expect(save).toHaveTextContent("Saving…");
      await user.keyboard("{Enter}");

      writes.release();

      expect(await settings.findByText("Saved.")).toBeInTheDocument();
      await waitFor(() => expectNotHeld(save));
      expect(save).toHaveFocus();
      await user.keyboard("{Enter}");
      // The third Enter's request arriving is what proves the second sent nothing.
      await waitFor(() => expect(writes.sent).toHaveLength(2));
    });

    it("lets go of Save after a refused save, with focus still on it", async () => {
      mockServer.use(
        http.put("/v1/settings", () =>
          HttpResponse.json(
            { code: "internal_error", message: "the settings are locked" },
            { status: 500 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderShell("/configure");
      const settings = await panel();
      const save = settings.getByRole("button", { name: "Save settings" });
      act(() => save.focus());

      await user.keyboard("{Enter}");

      expect(
        await settings.findByText(/the settings are locked/),
      ).toBeInTheDocument();
      await waitFor(() => expectNotHeld(save));
      expect(save).toBeEnabled();
      expect(save).toHaveFocus();
    });
  });

  it("keeps what was typed while the save was in flight", async () => {
    const user = userEvent.setup();
    const writes = holdSettingsWrites();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Candidates you can compare at once"));
    await user.type(field("Candidates you can compare at once"), "3");
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(writes.sent).toHaveLength(1));
    await user.clear(field("Spend cap per acquisition"));
    await user.type(field("Spend cap per acquisition"), "25");

    writes.release();

    // What was stored is older than what is on screen, so it is neither adopted nor called saved.
    await expect(
      settings.findByText("Saved.", {}, { timeout: 1_000 }),
    ).rejects.toThrow();
    expect(field("Spend cap per acquisition")).toHaveValue("25");
    expect(field("Candidates you can compare at once")).toHaveValue("3");
    expect(
      settings.getByRole("button", { name: "Save settings" }),
    ).toBeEnabled();
  });

  it("still takes what came back when nothing was typed since", async () => {
    const user = userEvent.setup();
    const writes = holdSettingsWrites();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Candidates you can compare at once"));
    await user.type(field("Candidates you can compare at once"), "3");
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    writes.release();

    expect(await settings.findByText("Saved.")).toBeInTheDocument();
    expect(field("Candidates you can compare at once")).toHaveValue("3");
  });

  it("refuses to save a coverage floor of '.', and says which field", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockServer.use(
      http.put("/v1/settings", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Minimum coverage to score"));
    await user.type(field("Minimum coverage to score"), ".");
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    fireEvent.submit(field("Minimum coverage to score").closest("form")!);

    expect(field("Minimum coverage to score")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(field("Minimum coverage to score")).toHaveAccessibleDescription(
      /not a number that can be saved/i,
    );
    expect(field("Top of the score range")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    // Disabled outright, which is the one state Save is disabled for: nothing is in flight.
    const save = settings.getByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();
    expectNotHeld(save);
    expect(sent).toEqual([]);
  });
});

describe("an unset comparator limit", () => {
  it("says that clearing it stops every comparison", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Candidates you can compare at once"));

    expect(
      field("Candidates you can compare at once"),
    ).toHaveAccessibleDescription(
      /Compare refuses every comparison until this is set\./,
    );
    expect(settings.queryByText(/as many comparators as you pick/)).toBeNull();
  });
});
