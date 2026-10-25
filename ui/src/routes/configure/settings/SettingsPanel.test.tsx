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
    // Euros, with their cents, as the design shows a cap (PL-032).
    expect(field("Spend cap per acquisition")).toHaveValue("10.00");
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
    expect(settings.getByText("candidates (1–20)")).toBeInTheDocument();
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

  /**
   * T28-3 (PL-028). **The server's refusal is said on the field it names**, worded from its
   * kind and limit -- not as one sentence naming no field, and never with its code.
   */
  it("marks the field the server refused, in words, and does not claim to have saved", async () => {
    mockServer.use(
      http.put("/v1/settings", () =>
        HttpResponse.json(
          {
            code: "invalid_request",
            message: "The request does not match what this operation accepts.",
            details: {
              errors: [
                {
                  location: ["body", "min_coverage"],
                  problem: "Input should be less than or equal to 100",
                  kind: "less_than_equal",
                  limit: 100,
                },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByRole("alert")).toHaveTextContent(
      "Not saved: the marked fields were refused.",
    );
    expect(field("Minimum coverage to score")).toHaveAttribute("aria-invalid", "true");
    expect(field("Minimum coverage to score")).toHaveAccessibleDescription(/At most 100\./);
    expect(field("Top of the score range")).toHaveAttribute("aria-invalid", "false");
    expect(settings.queryByText(/invalid_request|does not match what this operation/)).toBeNull();
    expect(settings.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("keeps the server's mark until that field is edited", async () => {
    mockServer.use(
      http.put("/v1/settings", () =>
        HttpResponse.json(
          {
            code: "invalid_request",
            message: "The request does not match what this operation accepts.",
            details: {
              errors: [
                { location: ["body", "min_coverage"], problem: "x", kind: "less_than_equal", limit: 100 },
                { location: ["body", "refetch_older_than_days"], problem: "y", kind: "missing" },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    await settings.findByRole("alert");

    await user.type(field("Minimum coverage to score"), "5");

    expect(field("Minimum coverage to score")).not.toHaveAccessibleDescription(/At most 100/);
    expect(field("Refetch data older than")).toHaveAccessibleDescription(/Required\./);
  });

  /** A refusal that names no field on the form is still said, as the server's own failure. */
  it("shows a refusal that names no field as a notice", async () => {
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

    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByText("The server failed while answering.")).toBeInTheDocument();
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

    expect(
      await screen.findByText("The acquisition limits could not be loaded"),
    ).toBeInTheDocument();
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
      /nothing can be ranked or compared until the top of the score range is set/i,
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

  /**
   * T25-5 (PL-025, UF-033). **The banners describe what is stored**: a cleared score range that
   * has not been saved stops nothing yet, so the field says what saving it would do instead.
   */
  it("says on the field what saving a cleared field would do, and raises no banner for it", async () => {
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

    expect(field("Top of the score range")).toHaveAccessibleDescription(
      /If you save this, nothing can be ranked or compared until this is set\./,
    );
    expect(settings.queryByRole("alert")).toBeNull();
    expect(settings.queryByText(/is not set/i)).toBeNull();
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
        await settings.findByText("The server failed while answering."),
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

    // **Waited for, not timed** (NEW-50). The save is over once its button is back and no
    // longer held -- which is also all `toBeEnabled()` here used to say, and has not since the
    // button is held rather than disabled while it saves (NEW-34).
    await waitFor(() =>
      expectNotHeld(settings.getByRole("button", { name: "Save settings" })),
    );
    // What was stored is older than what is on screen, so it is neither adopted nor called saved.
    expect(settings.queryByText("Saved.")).toBeNull();
    expect(field("Spend cap per acquisition")).toHaveValue("25");
    expect(field("Candidates you can compare at once")).toHaveValue("3");
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
      /not a number/i,
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
      /If you save this, Compare refuses every comparison until this is set\./,
    );
    // Saved, the blank is what is stored, and the summary above the form says so (PL-025).
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(settings.getByRole("status")).toHaveTextContent("Saved."));
    expect(
      field("Candidates you can compare at once"),
    ).toHaveAccessibleDescription(/ Compare refuses every comparison until this is set\./);
    expect(settings.queryByText(/as many comparators as you pick/)).toBeNull();
    // T30-3 (PL-030). The summary names what the blank stops, not a rule "not in force". The
    // fixture leaves the refetch age unset too, so it is the other.
    expect(
      settings.getByText(
        "2 settings are not set: Compare refuses every comparison until the comparator limit " +
          "is set, and the rule behind the other is not in force.",
      ),
    ).toBeInTheDocument();
  });
});

/** PL-028, PL-030. A figure outside its field's range is refused there, and nothing is sent. */
describe("a setting outside its range", () => {
  function recordSettingsWrites(): unknown[] {
    const sent: unknown[] = [];
    mockServer.use(
      http.put("/v1/settings", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    return sent;
  }

  it("states each field's range in its note", async () => {
    renderShell("/configure");
    await panel();

    expect(field("Minimum coverage to score")).toHaveAccessibleDescription(/From 0 to 100\./);
    expect(field("Candidates you can compare at once")).toHaveAccessibleDescription(
      /From 1 to 20\./,
    );
    expect(field("Top of the score range")).toHaveAccessibleDescription(/At least 1\./);
  });

  /** T28-4. */
  it("refuses a coverage floor of 150 in the form, and sends nothing", async () => {
    const user = userEvent.setup();
    const sent = recordSettingsWrites();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Minimum coverage to score"));
    await user.type(field("Minimum coverage to score"), "150");
    fireEvent.submit(field("Minimum coverage to score").closest("form")!);

    expect(field("Minimum coverage to score")).toHaveAttribute("aria-invalid", "true");
    expect(settings.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(sent).toEqual([]);
  });

  /** T30-3. */
  it("refuses a comparator limit of 25 in the form, and sends nothing", async () => {
    const user = userEvent.setup();
    const sent = recordSettingsWrites();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Candidates you can compare at once"));
    await user.type(field("Candidates you can compare at once"), "25");
    fireEvent.submit(field("Candidates you can compare at once").closest("form")!);

    expect(field("Candidates you can compare at once")).toHaveAttribute("aria-invalid", "true");
    expect(settings.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(sent).toEqual([]);
  });

  it("marks a stored limit outside the range and holds Save until it is fixed", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: 60,
          comparator_limit: 25,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    const sent = recordSettingsWrites();
    renderShell("/configure");
    const settings = await panel();

    expect(await settings.findByDisplayValue("25")).toHaveAttribute("aria-invalid", "true");
    expect(settings.getByRole("button", { name: "Save settings" })).toBeDisabled();

    await user.clear(field("Candidates you can compare at once"));
    await user.type(field("Candidates you can compare at once"), "20");
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ comparator_limit: 20 });
  });

  /** T32-1 (PL-032). Shown as euros and cents, and saved unchanged as the same number. */
  it("shows a stored cap of 5 as 5.00, and saves 5", async () => {
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
    const sent = recordSettingsWrites();
    renderShell("/configure");
    const settings = await panel();

    expect(await settings.findByDisplayValue("5.00")).toBe(field("Spend cap per acquisition"));
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ run_spend_cap_eur: 5 });
  });
});

/**
 * NEW-42. **"Saved." was a paragraph that appeared with its word**, and a screen reader announces
 * a change to a live region it already knows, not a region that arrives already saying something
 * -- so a save was confirmed to everybody who could see it and to nobody who could not.
 */
describe("the settings panel's confirmation", () => {
  it("keeps an empty status line in place before anything is saved", async () => {
    renderShell("/configure");
    const settings = await panel();

    expect(settings.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says Saved. in that same status line once the save lands", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();
    const status = settings.getByRole("status");

    await user.click(settings.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(status).toHaveTextContent("Saved."));
    expect(settings.getByRole("status")).toBe(status);
  });

  /** Emptied as a save starts and filled when it lands, so a second save is announced too. */
  it("says Saved. again for a second save", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();
    const status = settings.getByRole("status");
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(status).toHaveTextContent("Saved."));
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.put("/v1/settings", async () => {
        await held;
      }),
    );

    await user.click(settings.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(status).toBeEmptyDOMElement());
    release();
    await waitFor(() => expect(status).toHaveTextContent("Saved."));
    expect(settings.getByRole("status")).toBe(status);
  });

  it("says nothing in the status line when the save is refused", async () => {
    mockServer.use(
      http.put("/v1/settings", () =>
        HttpResponse.json(
          {
            code: "invalid_request",
            message: "The request does not match what this operation accepts.",
            details: {
              errors: [
                { location: ["body", "score_scale_max"], problem: "x", kind: "greater_than_equal", limit: 1 },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByRole("alert")).toHaveTextContent(/Not saved/);
    expect(settings.getByRole("status")).toBeEmptyDOMElement();
  });
});

/** PL-025 (NEW-55). "Saved." is about what is on screen, so an edit takes it back. */
describe("the settings panel's confirmation", () => {
  // T25-1.
  it("empties the status line once something is typed after a save", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();
    const status = settings.getByRole("status");
    await user.click(settings.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(status).toHaveTextContent("Saved."));

    await user.type(field("Refetch data older than"), "3");

    expect(settings.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(settings.getByText("Not saved yet")).toBeInTheDocument();
  });
});

/** PL-025 follow-up. **Discard stays where it is**, held, once there is nothing to discard. */
describe("discarding a draft", () => {
  it.each([
    ["a click", async (user: ReturnType<typeof userEvent.setup>, discard: HTMLElement) => {
      await user.click(discard);
    }],
    ["Enter", async (user: ReturnType<typeof userEvent.setup>, discard: HTMLElement) => {
      act(() => discard.focus());
      await user.keyboard("{Enter}");
    }],
  ])("keeps focus on Discard after %s, held", async (_how, press) => {
    const user = userEvent.setup();
    renderShell("/configure");
    const form = await panel();
    const discard = form.getByRole("button", { name: "Discard settings changes" });
    expectHeld(discard);
    await user.type(field("Refetch data older than"), "1");
    expectNotHeld(discard);

    await press(user, discard);

    expect(form.queryByText("Not saved yet")).toBeNull();
    expect(form.getByRole("button", { name: "Discard settings changes" })).toBe(discard);
    expect(discard).toHaveFocus();
    expectHeld(discard);
  });
});
