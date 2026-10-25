import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, getResponse, http } from "msw";
import { handlers } from "../../../mocks/handlers";
import { beforeEach, describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../../testing/keyboard";
import { renderShell } from "../../../testing/renderShell";
import { HOUSEHOLD as STORED } from "../../../mocks/fixtures";
import { replaceHousehold } from "../../../api/endpoints";

/**
 * The household panel.
 *
 * **The record is written whole or not at all**, so the assertions are about the whole record
 * arriving back -- and about the panel refusing to send one that the contract would reject,
 * which is a kinder answer than a 400 about a field name.
 */

/** The household stage, once its read has settled: the card is drawn before it lands. */
async function panel() {
  const region = await screen.findByRole("region", { name: "Household" });
  await waitFor(() => expect(region.querySelector('[aria-busy="true"]')).toBeNull());
  return within(region);
}

function field(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name });
}

describe("the household panel", () => {
  it("shows the stored record, with the citizenships as a list", async () => {
    renderShell("/configure");
    await panel();

    expect(field("Net income")).toHaveValue("7400");
    // Segments, not fields: the stored number shows as the pressed button.
    expect(
      within(screen.getByRole("group", { name: "Adults" })).getByRole("button", {
        name: "2",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(
        screen.getByRole("group", { name: "Children" }),
      ).getByRole("button", { name: "1" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Chips, not a comma-separated string: the passport shows by name. Awaited, because the
    // roster is fetched and the chip reads the id until it lands.
    expect(
      await within(
        await screen.findByRole("list", { name: "Passports held" }),
      ).findByText("Romania"),
    ).toBeInTheDocument();
  });

  // PL-163. **Monthly**, as the requirements, the domain model and the design all say.
  it("asks for the net income per month", async () => {
    renderShell("/configure");
    await panel();

    expect(field("Net income")).toHaveAccessibleDescription(/^per month\./);
  });

  it("shows no city rather than an empty one when the household lives in none", async () => {
    renderShell("/configure");
    await panel();

    expect(
      screen.getByRole("combobox", { name: "Moving from (city)" }),
    ).toHaveValue("");
  });

  it("saves the whole record and says so", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Comfortable monthly spend"));
    await user.type(field("Comfortable monthly spend"), "3100");
    await user.click(household.getByRole("button", { name: "Save household" }));

    expect(await household.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() =>
      expect(field("Comfortable monthly spend")).toHaveValue("3100"),
    );
  });

  it("will not send a household with no citizenship, and says which fields it needs", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();

    // Taking the one passport off, which is what "no citizenship" now looks like.
    await user.click(
      await screen.findByRole("button", { name: "Remove Romania" }),
    );

    expect(
      household.getByRole("button", { name: "Save household" }),
    ).toBeDisabled();
    // Disabled outright rather than held: nothing is in flight, there is only nothing to send.
    expectNotHeld(household.getByRole("button", { name: "Save household" }));
    expect(
      household.getByText(
        /Income, adults, children, the home country and one citizenship/,
      ),
    ).toBeInTheDocument();
  });

  it("clears an optional field rather than storing a zero for it", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Rent ceiling"));
    await user.click(household.getByRole("button", { name: "Save household" }));

    expect(await household.findByText("Saved.")).toBeInTheDocument();
    // Absent in the response, so absent in the form -- not "0", which would be a rent cap
    // nobody chose.
    await waitFor(() => expect(field("Rent ceiling")).toHaveValue(""));
  });

  /**
   * PL-028 and C02-S2. **The server's refusal, in the server's shape**: 422 `invalid_request`
   * with each field in `details.errors`. Said on the field it names, worded from its kind and
   * limit, with no code -- and a field with no box of its own is named above the form.
   */
  it("marks the fields the server refused rather than pretending the record was written", async () => {
    mockServer.use(
      http.put("/v1/household", () =>
        HttpResponse.json(
          {
            code: "invalid_request",
            message: "The request does not match what this operation accepts.",
            details: {
              errors: [
                {
                  location: ["body", "net_income"],
                  problem: "Input should be greater than or equal to 0",
                  kind: "greater_than_equal",
                  limit: 0,
                },
                {
                  location: ["body", "citizenships"],
                  problem: "Tuple should have at least 1 item after validation, not 0",
                  kind: "too_short",
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
    const household = await panel();

    await user.click(household.getByRole("button", { name: "Save household" }));

    const alert = await household.findByRole("alert");
    expect(alert).toHaveTextContent("Not saved: the marked fields were refused.");
    expect(alert).toHaveTextContent("Passports held: At least one is required.");
    expect(field("Net income")).toHaveAttribute("aria-invalid", "true");
    expect(field("Net income")).toHaveAccessibleDescription(/At least 0\./);
    expect(household.queryByText(/invalid_request|greater_than_equal|Input should/)).toBeNull();
    expect(household.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("refuses a negative income in the form, and sends nothing", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockServer.use(
      http.put("/v1/household", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Net income"));
    await user.type(field("Net income"), "-1");
    fireEvent.submit(field("Net income").closest("form")!);

    expect(field("Net income")).toHaveAttribute("aria-invalid", "true");
    expect(field("Net income")).toHaveAccessibleDescription(/cannot be negative/);
    expect(household.getByRole("button", { name: "Save household" })).toBeDisabled();
    expect(sent).toEqual([]);
  });

  /** PL-166. The segments stop at four; the domain does not. */
  it("saves a household of five adults entered through More", async () => {
    const user = userEvent.setup();
    const sent: { number_adults?: number }[] = [];
    mockServer.use(
      http.put("/v1/household", async ({ request }) => {
        const body = (await request.json()) as { number_adults?: number };
        sent.push(body);
        return HttpResponse.json(body);
      }),
    );
    renderShell("/configure");
    const household = await panel();
    const adults = within(screen.getByRole("group", { name: "Adults" }));

    await user.click(adults.getByRole("button", { name: "More" }));
    await user.clear(field("Adults, exact number"));
    await user.type(field("Adults, exact number"), "5");
    await user.click(household.getByRole("button", { name: "Save household" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.number_adults).toBe(5);
    expect(await household.findByText("Saved.")).toBeInTheDocument();
    expect(adults.getByRole("button", { name: "More" })).toHaveAttribute("aria-pressed", "true");
    expect(field("Adults, exact number")).toHaveValue("5");
  });

  it("shows a stored five adults as More, with five in its field", async () => {
    mockServer.use(
      http.get("/v1/household", () => HttpResponse.json({ ...STORED, number_adults: 5 })),
    );
    renderShell("/configure");
    await panel();

    expect(
      within(screen.getByRole("group", { name: "Adults" })).getByRole("button", {
        name: "More",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(field("Adults, exact number")).toHaveValue("5");
  });

  it("refuses no adults typed through More, and sends nothing", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockServer.use(
      http.put("/v1/household", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderShell("/configure");
    const household = await panel();

    await user.click(
      within(screen.getByRole("group", { name: "Adults" })).getByRole("button", {
        name: "More",
      }),
    );
    await user.clear(field("Adults, exact number"));
    await user.type(field("Adults, exact number"), "0");
    fireEvent.submit(field("Adults, exact number").closest("form")!);

    expect(field("Adults, exact number")).toHaveAttribute("aria-invalid", "true");
    expect(household.getByRole("button", { name: "Save household" })).toBeDisabled();
    expect(sent).toEqual([]);
  });

  /** PL-024. "72,000" was filtered to 72 and saved; it is now refused with both readings. */
  it("refuses an income typed with a comma, offering both readings", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Net income"));
    await user.type(field("Net income"), "72,000");

    expect(field("Net income")).toHaveValue("72,000");
    expect(field("Net income")).toHaveAccessibleDescription(/Type 72000, or 72 if/);
    expect(household.getByRole("button", { name: "Save household" })).toBeDisabled();
  });

  it("reports a household that could not be read at all", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json(
          { code: "internal_error", message: "no household" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");

    const household = await panel();
    expect(
      await household.findByText("The household could not be loaded"),
    ).toBeInTheDocument();
    expect(household.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("a household nobody has recorded yet", () => {
  /**
   * The opening state of the whole application. The API answers 404
   * `household_not_configured`, which is a "start here" rather than a fault -- and an error
   * notice would be a dead end on the first thing anyone does.
   */
  function nothingRecorded() {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json(
          {
            code: "household_not_configured",
            message: "nothing has been recorded about the household yet",
          },
          { status: 404 },
        ),
      ),
    );
  }

  it("offers an empty form rather than an error", async () => {
    nothingRecorded();
    renderShell("/configure");
    const household = await panel();

    expect(
      await household.findByText(/Nothing has been recorded/),
    ).toBeInTheDocument();
    expect(field("Net income")).toHaveValue("");
    expect(
      screen.queryByRole("list", { name: "Passports held" }),
    ).not.toBeInTheDocument();
    expect(household.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("writes the first household from that form", async () => {
    nothingRecorded();
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();
    await household.findByText(/Nothing has been recorded/);

    await user.type(field("Net income"), "70000");
    await user.click(
      within(screen.getByRole("group", { name: "Adults" })).getByRole("button", {
        name: "2",
      }),
    );
    await user.click(
      within(
        screen.getByRole("group", { name: "Children" }),
      ).getByRole("button", { name: "None" }),
    );
    // Chosen from the roster, never typed: the stored value is an id the database holds.
    await user.type(
      screen.getByRole("combobox", { name: "Moving from" }),
      "Romania",
    );
    await user.click(
      within(
        screen.getByRole("listbox", { name: "Moving from" }),
      ).getByRole("option", { name: "Romania" }),
    );
    await user.type(
      screen.getByRole("combobox", { name: "Passports held" }),
      "Romania",
    );
    await user.click(
      within(screen.getByRole("listbox", { name: "Passports held" })).getByRole(
        "option",
        { name: "Romania" },
      ),
    );
    await user.click(household.getByRole("button", { name: "Save household" }));

    expect(await household.findByText("Saved.")).toBeInTheDocument();
  });

  it("still reports a failure that is not the missing household", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json(
          { code: "internal_error", message: "the database is down" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");

    expect(
      await (await panel()).findByText("The household could not be loaded"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save household" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * UI-06 and UI-10. **A save answers with the record it stored**, and the form took that answer
 * whatever had been typed since; nothing stopped a second save overlapping the first. And a lone
 * point in the rent went out as NaN, which JSON sends as null: a rent cap cleared by a typo.
 */
describe("the household panel while a save is in flight", () => {
  /** Holds every household write until the test lets go, then lets the mock store it. */
  function holdHouseholdWrites(): { sent: unknown[]; release: () => void } {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    mockServer.use(
      http.put("/v1/household", async ({ request }) => {
        sent.push(await request.clone().json());
        await held;
      }),
    );
    return { sent, release: () => release() };
  }

  it("sends one save at a time, and says it is saving", async () => {
    const user = userEvent.setup();
    const writes = holdHouseholdWrites();
    renderShell("/configure");
    const household = await panel();

    await user.click(household.getByRole("button", { name: "Save household" }));
    const saving = household.getByRole("button", { name: "Saving…" });
    expectHeld(saving);
    // Held, it still takes a click -- and Enter in a field submits as well. Neither sends.
    await user.click(saving);
    fireEvent.submit(saving.closest("form")!);
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    writes.release();

    await waitFor(() =>
      expectNotHeld(household.getByRole("button", { name: "Save household" })),
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
      const writes = holdHouseholdWrites();
      renderShell("/configure");
      const household = await panel();
      const save = household.getByRole("button", { name: "Save household" });
      act(() => save.focus());

      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(save).toHaveFocus();
      expectHeld(save);
      expect(save).toHaveTextContent("Saving…");
      await user.keyboard("{Enter}");

      writes.release();

      expect(await household.findByText("Saved.")).toBeInTheDocument();
      await waitFor(() => expectNotHeld(save));
      expect(save).toHaveFocus();
      await user.keyboard("{Enter}");
      // The third Enter's request arriving is what proves the second sent nothing.
      await waitFor(() => expect(writes.sent).toHaveLength(2));
    });

    it("lets go of Save after a refused save, with focus still on it", async () => {
      mockServer.use(
        http.put("/v1/household", () =>
          HttpResponse.json(
            { code: "internal_error", message: "the household is locked" },
            { status: 500 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderShell("/configure");
      const household = await panel();
      const save = household.getByRole("button", { name: "Save household" });
      act(() => save.focus());

      await user.keyboard("{Enter}");

      expect(
        await household.findByText("The server failed while answering."),
      ).toBeInTheDocument();
      await waitFor(() => expectNotHeld(save));
      expect(save).toBeEnabled();
      expect(save).toHaveFocus();
    });
  });

  it("keeps what was typed while the save was in flight", async () => {
    const user = userEvent.setup();
    const writes = holdHouseholdWrites();
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Comfortable monthly spend"));
    await user.type(field("Comfortable monthly spend"), "3100");
    await user.click(household.getByRole("button", { name: "Save household" }));
    await waitFor(() => expect(writes.sent).toHaveLength(1));
    await user.clear(field("Rent ceiling"));
    await user.type(field("Rent ceiling"), "1600");

    writes.release();

    // **Waited for, not timed** (NEW-50). The save is over once its button is back and no
    // longer held, which is after the answer was handled -- a fixed second without "Saved."
    // proved nothing when the answer came later than that, or never.
    await waitFor(() =>
      expectNotHeld(household.getByRole("button", { name: "Save household" })),
    );
    // What was stored is older than what is on screen, so it is neither adopted nor called saved.
    expect(household.queryByText("Saved.")).toBeNull();
    expect(field("Rent ceiling")).toHaveValue("1600");
    expect(field("Comfortable monthly spend")).toHaveValue("3100");
  });

  it("refuses a maximum rent of '.', and says which field", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockServer.use(
      http.put("/v1/household", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Rent ceiling"));
    await user.type(field("Rent ceiling"), ".");
    await user.click(household.getByRole("button", { name: "Save household" }));
    fireEvent.submit(field("Rent ceiling").closest("form")!);

    expect(field("Rent ceiling")).toHaveAttribute("aria-invalid", "true");
    expect(field("Rent ceiling")).toHaveAccessibleDescription(/not a number/i);
    expect(field("Net income")).toHaveAttribute("aria-invalid", "false");
    // Disabled outright, which is the one state Save is disabled for: nothing is in flight.
    const save = household.getByRole("button", { name: "Save household" });
    expect(save).toBeDisabled();
    expectNotHeld(save);
    expect(sent).toEqual([]);
  });
});

/**
 * NEW-42. **"Saved." was a paragraph that appeared with its word**, and a screen reader announces
 * a change to a live region it already knows, not a region that arrives already saying something
 * -- so a save was confirmed to everybody who could see it and to nobody who could not.
 */
describe("the household panel's confirmation", () => {
  it("keeps an empty status line in place before anything is saved", async () => {
    renderShell("/configure");
    const household = await panel();

    expect(household.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says Saved. in that same status line once the save lands", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();
    const status = household.getByRole("status");

    await user.click(household.getByRole("button", { name: "Save household" }));

    await waitFor(() => expect(status).toHaveTextContent("Saved."));
    expect(household.getByRole("status")).toBe(status);
  });

  it("empties the status line, and keeps it there, once something is typed again", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();
    const status = household.getByRole("status");
    await user.click(household.getByRole("button", { name: "Save household" }));
    await waitFor(() => expect(status).toHaveTextContent("Saved."));

    await user.type(field("Rent ceiling"), "0");

    expect(household.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();
  });

  it("says nothing in the status line when the save is refused", async () => {
    mockServer.use(
      http.put("/v1/household", () =>
        HttpResponse.json(
          { code: "internal_error", message: "the household is locked" },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();

    await user.click(household.getByRole("button", { name: "Save household" }));

    expect(await household.findByRole("alert")).toHaveTextContent("The server failed while answering.");
    expect(household.getByRole("status")).toBeEmptyDOMElement();
  });
});

/**
 * UI-26. **The citizenship picker adds rather than replaces**, so it is the one used most from
 * the keyboard: tab into its list, choose, and go on to the next passport.
 */
/**
 * The home picker, once the roster has arrived. **Before it, the box can only show the stored id
 * and there is no list to open**, so typing into it tests nothing -- and a loaded `make check`
 * types before the roster lands (P13). The stored home's name is what only the roster can give.
 */
async function homePickerWithItsRoster(): Promise<HTMLInputElement> {
  const home = await screen.findByRole<HTMLInputElement>("combobox", {
    name: "Moving from",
  });
  await waitFor(() => expect(home).toHaveValue("Romania"));
  return home;
}

/** Counts the household writes and lets the mock's own handler answer them. */
function countingHouseholdSaves(): { saved: number } {
  const seen = { saved: 0 };
  mockServer.use(
    http.put("/v1/household", () => {
      seen.saved += 1;
    }),
  );
  return seen;
}

describe("the household panel from the keyboard", () => {
  /**
   * UIC-G2. **Enter in a picker whose list is open picks or does nothing; it never saves.** With
   * several places matching, Enter fell through to the household form and wrote the record --
   * with the previous choice still in it, not what was being typed.
   */
  it.each([
    ["several matches", "a"],
    ["no match", "zzz"],
  ])("does not save the household when Enter is pressed in a picker with %s", async (_, typed) => {
    const user = userEvent.setup();
    const writes = countingHouseholdSaves();
    renderShell("/configure");
    await panel();
    const home = await homePickerWithItsRoster();
    await user.clear(home);
    await user.type(home, typed);
    expect(
      screen.getByRole("listbox", { name: "Moving from" }),
    ).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

    expect(writes.saved).toBe(0);
    expect(
      screen.getByRole("listbox", { name: "Moving from" }),
    ).toBeInTheDocument();
  });

  it("still saves with Enter once the place is chosen and the list has closed", async () => {
    const user = userEvent.setup();
    const writes = countingHouseholdSaves();
    renderShell("/configure");
    await panel();
    const home = await homePickerWithItsRoster();
    await user.clear(home);
    await user.type(home, "Portu{Enter}");
    expect(
      screen.queryByRole("listbox", { name: "Moving from" }),
    ).toBeNull();

    await user.keyboard("{Enter}");

    await waitFor(() => expect(writes.saved).toBe(1));
  });

  /**
   * RD-3. **A key that ends an IME composition belongs to the input method.** Typing a place
   * through one ends each word with Enter, and Escape abandons it; taken by the picker, the Enter
   * chose a place before its name was finished, and the Escape threw the list away with it.
   */
  it.each([
    ["Enter, composing", { key: "Enter", isComposing: true }],
    ["Enter, as Safari reports a composing key", { key: "Enter", keyCode: 229 }],
    ["Escape, composing", { key: "Escape", isComposing: true }],
  ])("leaves a key that ends a composition to the input method: %s", async (_, key) => {
    const user = userEvent.setup();
    const writes = countingHouseholdSaves();
    renderShell("/configure");
    await panel();
    const home = await homePickerWithItsRoster();
    await user.clear(home);
    await user.type(home, "Portu");

    fireEvent.keyDown(home, key);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

    expect(home).toHaveValue("Portu");
    expect(
      screen.getByRole("listbox", { name: "Moving from" }),
    ).toBeInTheDocument();
    expect(writes.saved).toBe(0);
  });

  it("adds a passport chosen from the list, and leaves the keyboard in the picker", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    const citizenships = screen.getByRole("combobox", { name: "Passports held" });
    await user.click(citizenships);
    await user.type(citizenships, "Port");

    await user.tab();
    expect(
      within(screen.getByRole("listbox", { name: "Passports held" })).getByRole(
        "option",
        { name: "Portugal" },
      ),
    ).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(
      await within(
        screen.getByRole("list", { name: "Passports held" }),
      ).findByText("Portugal"),
    ).toBeInTheDocument();
    expect(citizenships).toHaveFocus();
    expect(screen.queryByRole("listbox", { name: "Passports held" })).toBeNull();
  });
});

/**
 * UI-27. **The home country and the citizenships are chosen from the roster**, so a roster that
 * could not be read left two required pickers offering nothing, with no word as to why.
 */
describe("the household panel when the list of places is not there", () => {
  it("says the list of places could not be read, and reads it again when asked", async () => {
    const user = userEvent.setup();
    let failing = true;
    mockServer.use(
      http.get("/v1/candidates", () =>
        failing
          ? HttpResponse.json(
              { code: "internal_error", message: "the roster is down" },
              { status: 500 },
            )
          : undefined,
      ),
    );
    renderShell("/configure");
    const household = await panel();

    expect(
      await household.findByText(/list of places could not be read/i),
    ).toBeInTheDocument();
    expect(household.getByRole("alert")).toHaveTextContent("The server failed while answering.");

    failing = false;
    await user.click(household.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(
        household.queryByText(/list of places could not be read/i),
      ).toBeNull(),
    );
    const home = screen.getByRole("combobox", { name: "Moving from" });
    await user.clear(home);
    await user.type(home, "Port");
    expect(
      within(
        screen.getByRole("listbox", { name: "Moving from" }),
      ).getByRole("option", { name: "Portugal" }),
    ).toBeInTheDocument();
  });

  it("marks the list of places busy with a skeleton while it loads (PL-012)", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get("/v1/candidates", async ({ request }) => {
        // Only the roster every picker shares, which is the request that asks for every level.
        if (new URL(request.url).searchParams.has("level")) return;
        await held;
      }),
    );
    renderShell("/configure");
    const region = await screen.findByRole("region", { name: "Household" });
    // The household itself is read; only the places are on their way.
    await within(region).findByRole("button", { name: /save/i });
    expect(region.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(region).not.toHaveTextContent(/Loading/);

    release();

    await waitFor(() => expect(region.querySelector('[aria-busy="true"]')).toBeNull());
  });
});

/**
 * PL-025 (UF-033, NEW-55-S1, D8). **What is on screen says whether it is stored**, and a draft
 * outlives the screen it was typed on.
 */
describe("the household panel's draft", () => {
  /** Whether a reload or a closed tab would be asked about first. */
  function reloadAsksFirst(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  async function leaveForRankAndComeBack(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { level: 1, name: "Rank" });
    await user.click(screen.getByRole("link", { name: "Configure" }));
    return panel();
  }

  // T25-3. By what the field reads, not its text: 7400.0 is the stored 7400.
  it("says Not saved yet while the draft differs from what is stored, and only then", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();
    expect(household.queryByText("Not saved yet")).toBeNull();

    await user.type(field("Net income"), "1");
    expect(household.getByText("Not saved yet")).toBeInTheDocument();

    await user.clear(field("Net income"));
    await user.type(field("Net income"), "7400.0");
    expect(household.queryByText("Not saved yet")).toBeNull();

    await user.type(field("Rent ceiling"), "5");
    await user.click(household.getByRole("button", { name: "Save household" }));
    await waitFor(() => expect(household.getByRole("status")).toHaveTextContent("Saved."));
    expect(household.queryByText("Not saved yet")).toBeNull();
  });

  // T25-4 (NEW-55-S1).
  it("drops the nothing-recorded note once the first household is saved", async () => {
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json(
          { code: "household_not_configured", message: "nothing has been recorded" },
          { status: 404 },
        ),
      ),
      http.put("/v1/household", async ({ request }) =>
        HttpResponse.json(await request.json()),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();
    await household.findByText(/Nothing has been recorded/);
    await user.type(field("Net income"), "7000");
    await user.click(
      within(screen.getByRole("group", { name: "Adults" })).getByRole("button", { name: "1" }),
    );
    await user.click(
      within(screen.getByRole("group", { name: "Children" })).getByRole("button", { name: "None" }),
    );
    await user.type(screen.getByRole("combobox", { name: "Moving from" }), "Romania");
    await user.click(
      within(screen.getByRole("listbox", { name: "Moving from" })).getByRole("option", {
        name: "Romania",
      }),
    );
    await user.type(screen.getByRole("combobox", { name: "Passports held" }), "Romania");
    await user.click(
      within(screen.getByRole("listbox", { name: "Passports held" })).getByRole("option", {
        name: "Romania",
      }),
    );

    await user.click(household.getByRole("button", { name: "Save household" }));

    await waitFor(() => expect(household.getByRole("status")).toHaveTextContent("Saved."));
    expect(household.queryByText(/Nothing has been recorded/)).toBeNull();
  });

  // T25-6 (D8, R1).
  it("keeps an unsaved edit through a visit to Rank", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    await user.clear(field("Comfortable monthly spend"));
    await user.type(field("Comfortable monthly spend"), "3100");

    const household = await leaveForRankAndComeBack(user);

    expect(field("Comfortable monthly spend")).toHaveValue("3100");
    expect(household.getByText("Not saved yet")).toBeInTheDocument();
  });

  it("puts the stored record back on Discard", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();
    await user.type(field("Net income"), "1");

    await user.click(household.getByRole("button", { name: "Discard household changes" }));

    expect(field("Net income")).toHaveValue("7400");
    expect(household.queryByText("Not saved yet")).toBeNull();
  });

  // T25-7.
  it("asks before a reload only while something is unsaved", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    expect(reloadAsksFirst()).toBe(false);

    await user.type(field("Net income"), "1");
    expect(reloadAsksFirst()).toBe(true);

    await user.type(field("Net income"), "{Backspace}");
    expect(reloadAsksFirst()).toBe(false);
  });

  // T25-8 (C02-S3).
  it("keeps a draft the stored record changed under, and says so", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    await user.clear(field("Comfortable monthly spend"));
    await user.type(field("Comfortable monthly spend"), "3100");
    await user.click(screen.getByRole("link", { name: "Rank" }));
    await replaceHousehold({ ...STORED, net_income: 8000 });

    await user.click(screen.getByRole("link", { name: "Configure" }));
    const household = await panel();

    expect(field("Comfortable monthly spend")).toHaveValue("3100");
    expect(field("Net income")).toHaveValue("7400");
    expect(household.getByText(/The stored household changed since you began/)).toBeInTheDocument();
    await user.click(household.getByRole("button", { name: "Discard household changes" }));
    expect(field("Net income")).toHaveValue("8000");
  });

  it("follows a stored record that changed while nothing was typed", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();
    await user.click(screen.getByRole("link", { name: "Rank" }));
    await replaceHousehold({ ...STORED, net_income: 8000 });

    await user.click(screen.getByRole("link", { name: "Configure" }));
    const household = await panel();

    expect(field("Net income")).toHaveValue("8000");
    expect(household.queryByText(/The stored household changed/)).toBeNull();
  });

  // T25-10.
  it("leaves nothing unsaved when a save lands after the form has gone", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.put("/v1/household", async ({ request }) => {
        const body = await request.clone().json();
        await held;
        return HttpResponse.json(body);
      }),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();
    await user.type(field("Rent ceiling"), "5");
    await user.click(household.getByRole("button", { name: "Save household" }));
    await user.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { level: 1, name: "Rank" });

    release();

    await waitFor(() => expect(reloadAsksFirst()).toBe(false));
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
    const discard = form.getByRole("button", { name: "Discard household changes" });
    expectHeld(discard);
    await user.type(field("Net income"), "1");
    expectNotHeld(discard);

    await press(user, discard);

    expect(form.queryByText("Not saved yet")).toBeNull();
    expect(form.getByRole("button", { name: "Discard household changes" })).toBe(discard);
    expect(discard).toHaveFocus();
    expectHeld(discard);
  });
});

/** PL-033: a save whose answer was lost is read back, never called refused on a guess. */
describe("a household save whose answer was lost", () => {
  function loseTheAnswer({ readBackFails }: { readBackFails: boolean }) {
    mockServer.use(
      http.put(
        "/v1/household",
        async ({ request }) => {
          await getResponse(handlers, request);
          if (readBackFails) {
            mockServer.use(
              http.get(
                "/v1/household",
                () => HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 }),
                { once: true },
              ),
            );
          }
          return HttpResponse.error();
        },
        { once: true },
      ),
    );
  }

  async function saveAHousehold(user: ReturnType<typeof userEvent.setup>) {
    const form = await panel();
    await user.clear(field("Comfortable monthly spend"));
    await user.type(field("Comfortable monthly spend"), "3100");
    await user.click(form.getByRole("button", { name: "Save household" }));
    return form;
  }

  it("is saved when reading it back shows it stored", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    loseTheAnswer({ readBackFails: false });

    const form = await saveAHousehold(user);

    expect(await form.findByText("Saved.")).toBeInTheDocument();
    expect(form.queryByRole("alert")).toBeNull();
    const history = within(await screen.findByRole("region", { name: /^recent changes/i }));
    expect(await history.findByText(/Comfortable monthly spend .* to 3100/)).toBeInTheDocument();
  });

  it("is unconfirmed, keeps its draft, and is settled by Check again, when it cannot be read back", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    loseTheAnswer({ readBackFails: true });

    const form = await saveAHousehold(user);

    const status = form.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent(/not confirmed/i));
    expect(status).toHaveTextContent(/Recent changes/);
    expect(form.queryByText("Saved.")).toBeNull();
    expect(form.queryByRole("alert")).toBeNull();
    expect(field("Comfortable monthly spend")).toHaveValue("3100");
    expectHeld(form.getByRole("button", { name: "Save household" }));

    const history = within(await screen.findByRole("region", { name: /^recent changes/i }));
    const entry = within((await history.findByText(/Comfortable monthly spend .* to 3100/)).closest("li") as HTMLElement);
    await user.click(entry.getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(status).not.toHaveTextContent(/not confirmed/i));
    expect(entry.queryByText(/not confirmed/i)).toBeNull();
    expect(field("Comfortable monthly spend")).toHaveValue("3100");
    await waitFor(() => expectNotHeld(form.getByRole("button", { name: "Save household" })));
  });
});
