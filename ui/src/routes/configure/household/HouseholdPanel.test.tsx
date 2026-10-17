import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import { renderShell } from "../../../testing/renderShell";

/**
 * The household panel.
 *
 * **The record is written whole or not at all**, so the assertions are about the whole record
 * arriving back -- and about the panel refusing to send one that the contract would reject,
 * which is a kinder answer than a 400 about a field name.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Household" }));
}

function field(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name });
}

describe("the household panel", () => {
  it("shows the stored record, with the citizenships as a list", async () => {
    renderShell("/configure");
    await panel();

    expect(field("Net annual income")).toHaveValue("90000");
    // Segments, not fields: the stored number shows as the pressed button.
    expect(
      within(screen.getByRole("group", { name: "Adults" })).getByRole("button", {
        name: "2",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(
        screen.getByRole("group", { name: "Children under 18" }),
      ).getByRole("button", { name: "1" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Chips, not a comma-separated string: the passport shows by name. Awaited, because the
    // roster is fetched and the chip reads the id until it lands.
    expect(
      await within(
        await screen.findByRole("list", { name: /citizenships held/i }),
      ).findByText("Romania"),
    ).toBeInTheDocument();
  });

  it("shows no city rather than an empty one when the household lives in none", async () => {
    renderShell("/configure");
    await panel();

    expect(
      screen.getByRole("combobox", { name: "Home city candidate" }),
    ).toHaveValue("");
  });

  it("saves the whole record and says so", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Target monthly spend"));
    await user.type(field("Target monthly spend"), "3100");
    await user.click(household.getByRole("button", { name: "Save household" }));

    expect(await household.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() =>
      expect(field("Target monthly spend")).toHaveValue("3100"),
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

    await user.clear(field("Maximum rent"));
    await user.click(household.getByRole("button", { name: "Save household" }));

    expect(await household.findByText("Saved.")).toBeInTheDocument();
    // Absent in the response, so absent in the form -- not "0", which would be a rent cap
    // nobody chose.
    await waitFor(() => expect(field("Maximum rent")).toHaveValue(""));
  });

  it("shows the server's refusal rather than pretending the record was written", async () => {
    mockServer.use(
      http.put("/v1/household", () =>
        HttpResponse.json(
          { code: "invalid_field", message: "net_income must be positive." },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Net annual income"));
    await user.type(field("Net annual income"), "-1");
    await user.click(household.getByRole("button", { name: "Save household" }));

    expect(
      await household.findByText(/net_income must be positive/),
    ).toBeInTheDocument();
    expect(household.queryByText("Saved.")).not.toBeInTheDocument();
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

    expect(await screen.findByText(/no household/)).toBeInTheDocument();
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
    expect(field("Net annual income")).toHaveValue("");
    expect(
      screen.queryByRole("list", { name: /citizenships held/i }),
    ).not.toBeInTheDocument();
    expect(household.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("writes the first household from that form", async () => {
    nothingRecorded();
    const user = userEvent.setup();
    renderShell("/configure");
    const household = await panel();
    await household.findByText(/Nothing has been recorded/);

    await user.type(field("Net annual income"), "70000");
    await user.click(
      within(screen.getByRole("group", { name: "Adults" })).getByRole("button", {
        name: "2",
      }),
    );
    await user.click(
      within(
        screen.getByRole("group", { name: "Children under 18" }),
      ).getByRole("button", { name: "None" }),
    );
    // Chosen from the roster, never typed: the stored value is an id the database holds.
    await user.type(
      screen.getByRole("combobox", { name: "Home country candidate" }),
      "Romania",
    );
    await user.click(
      within(
        screen.getByRole("listbox", { name: "Home country candidate" }),
      ).getByRole("option", { name: "Romania" }),
    );
    await user.type(
      screen.getByRole("combobox", { name: "Citizenships" }),
      "Romania",
    );
    await user.click(
      within(screen.getByRole("listbox", { name: "Citizenships" })).getByRole(
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

    expect(await screen.findByText(/the database is down/)).toBeInTheDocument();
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
    expect(saving).toBeDisabled();
    // Enter in a field submits too, and the button being disabled does not stop that.
    fireEvent.submit(saving.closest("form")!);
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    writes.release();

    await waitFor(() =>
      expect(
        household.getByRole("button", { name: "Save household" }),
      ).toBeEnabled(),
    );
    expect(writes.sent).toHaveLength(1);
  });

  it("keeps what was typed while the save was in flight", async () => {
    const user = userEvent.setup();
    const writes = holdHouseholdWrites();
    renderShell("/configure");
    const household = await panel();

    await user.clear(field("Target monthly spend"));
    await user.type(field("Target monthly spend"), "3100");
    await user.click(household.getByRole("button", { name: "Save household" }));
    await waitFor(() => expect(writes.sent).toHaveLength(1));
    await user.clear(field("Maximum rent"));
    await user.type(field("Maximum rent"), "1600");

    writes.release();

    // What was stored is older than what is on screen, so it is neither adopted nor called saved.
    await expect(
      household.findByText("Saved.", {}, { timeout: 1_000 }),
    ).rejects.toThrow();
    expect(field("Maximum rent")).toHaveValue("1600");
    expect(field("Target monthly spend")).toHaveValue("3100");
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

    await user.clear(field("Maximum rent"));
    await user.type(field("Maximum rent"), ".");
    await user.click(household.getByRole("button", { name: "Save household" }));
    fireEvent.submit(field("Maximum rent").closest("form")!);

    expect(field("Maximum rent")).toHaveAttribute("aria-invalid", "true");
    expect(field("Maximum rent")).toHaveAccessibleDescription(
      /not a number that can be saved/i,
    );
    expect(field("Net annual income")).toHaveAttribute("aria-invalid", "false");
    expect(sent).toEqual([]);
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
    expect(household.getByRole("alert")).toHaveTextContent("the roster is down");

    failing = false;
    await user.click(household.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(
        household.queryByText(/list of places could not be read/i),
      ).toBeNull(),
    );
    const home = screen.getByRole("combobox", { name: "Home country candidate" });
    await user.clear(home);
    await user.type(home, "Port");
    expect(
      within(
        screen.getByRole("listbox", { name: "Home country candidate" }),
      ).getByRole("option", { name: "Portugal" }),
    ).toBeInTheDocument();
  });

  it("says the list of places is still loading while it loads", async () => {
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
    const household = await panel();

    expect(
      await household.findByText("Loading the list of places…"),
    ).toBeInTheDocument();

    release();

    await waitFor(() =>
      expect(household.queryByText("Loading the list of places…")).toBeNull(),
    );
  });
});
