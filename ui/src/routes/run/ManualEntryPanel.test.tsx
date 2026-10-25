import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockServer } from "../../mocks/server";
import { AppConfigProvider } from "../../config/AppConfigContext";
import { TEST_CONFIG } from "../../testing/renderShell";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../testing/keyboard";
import { formatDateTime } from "../../format/display";
import { ManualEntryPanel } from "./ManualEntryPanel";

/**
 * A figure typed by hand, for one attribute.
 *
 * **Rendered on its own**, because what is under test is the form and its one request: the
 * screen around it decides only whether it is offered, which `RunScreen.test.tsx` covers.
 */

/** The one attribute in the mock's catalog that takes a list typed by hand. */
const EMPLOYERS = "country.international_employers";

function renderEntry() {
  // In the provider because a read that failed names the product when it says why.
  return render(
    <AppConfigProvider config={TEST_CONFIG}>
      <MemoryRouter>
        <ManualEntryPanel
          attribute={EMPLOYERS}
          attributeName="International employers"
          kind="LabelSet"
          level="country"
        />
      </MemoryRouter>
    </AppConfigProvider>,
  );
}

/** The read-back, once it says something: the region is there, empty, before it speaks. */
async function readBack(text: RegExp | string): Promise<HTMLElement> {
  const status = screen.getByRole("status");
  await waitFor(() => expect(status).toHaveTextContent(text));
  return status;
}

function field(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name });
}

/** Everything a list needs before it may be stored: a candidate, the names, and a period. */
async function fillAFigure(): Promise<void> {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Portugal" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Candidate" }),
    "country.portugal",
  );
  await user.type(field("Values"), "Siemens");
  fireEvent.change(screen.getByLabelText("Describes, from"), {
    target: { value: "2025-01-01" },
  });
  fireEvent.change(screen.getByLabelText("Describes, to"), {
    target: { value: "2025-12-31" },
  });
}

/** Holds every hand-typed figure until the test lets go, then lets the mock store it. */
function holdManualWrites(): { sent: unknown[]; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: unknown[] = [];
  mockServer.use(
    http.post("/v1/values/manual", async ({ request }) => {
      sent.push(await request.clone().json());
      await held;
    }),
  );
  return { sent, release: () => release() };
}

/**
 * UI-06. **The form clears once a figure is stored**, so a second identical entry is not one
 * click away -- and it cleared whatever had been typed while the first was being stored.
 */
describe("storing a figure typed by hand", () => {
  it("does not clear a figure typed while the last one was being stored", async () => {
    const user = userEvent.setup();
    const writes = holdManualWrites();
    renderEntry();
    await fillAFigure();

    await user.click(screen.getByRole("button", { name: "Store this figure" }));
    await waitFor(() => expect(writes.sent).toHaveLength(1));
    await user.type(field("Values"), "{Enter}Bosch");

    writes.release();

    // Still said, because it names what was stored rather than what is on screen.
    await readBack(/Stored Siemens for Portugal/);
    expect(field("Values")).toHaveValue("Siemens\nBosch");
    expect(
      within(screen.getByRole("group", { name: "Will store" })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(screen.getByLabelText("Describes, from")).toHaveValue("2025-01-01");
  });

  it("clears the form once a figure is stored and nothing was typed since", async () => {
    const user = userEvent.setup();
    renderEntry();
    await fillAFigure();

    await user.click(screen.getByRole("button", { name: "Store this figure" }));

    await readBack(/for Portugal/);
    expect(field("Values")).toHaveValue("");
  });

  /**
   * RB-4. **The source it was stored under, as the catalog names it.** The confirmation ended
   * "under manual." -- the source's id, where the catalog says "Manual entry".
   */
  it("says which source it stored the figure under, by the catalog's name", async () => {
    const user = userEvent.setup();
    renderEntry();
    await fillAFigure();

    await user.click(screen.getByRole("button", { name: "Store this figure" }));

    const stored = await readBack("Stored Siemens for Portugal, under Manual entry.");
    expect(stored).not.toHaveTextContent(/\bmanual\b/);
  });

  it("keeps the figure when the server refuses it", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.post("/v1/values/manual", () =>
        HttpResponse.json(
          { code: "manual_entry_not_permitted", message: "no" },
          { status: 409 },
        ),
      ),
    );
    renderEntry();
    await fillAFigure();

    await user.click(screen.getByRole("button", { name: "Store this figure" }));

    expect(
      await screen.findByText(/does not accept a manually entered value/),
    ).toBeInTheDocument();
    expect(field("Values")).toHaveValue("Siemens");
  });
});

/**
 * NEW-44. **Held, never disabled, while a figure is stored.** Chromium throws focus off a button
 * the moment it is disabled and does not give it back, so a keyboard user who stored a figure
 * with Enter was put back on the page. jsdom keeps focus on a disabled button, which is why these
 * follow Chromium's rule.
 */
describe("storing a figure from the keyboard", () => {
  beforeEach(() => followChromiumFocusFixup());

  /** Holds every figure until the test lets go, then answers with `answer` or stores it. */
  function holdManualWritesAnswering(
    answer: () => Response | undefined,
  ): { sent: number; release: () => void } {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes = { sent: 0, release: () => release() };
    mockServer.use(
      http.post("/v1/values/manual", async () => {
        writes.sent += 1;
        await held;
        return answer();
      }),
    );
    return writes;
  }

  it("keeps focus on Store while it stores, and a second Enter sends nothing", async () => {
    const user = userEvent.setup();
    const writes = holdManualWrites();
    renderEntry();
    await fillAFigure();
    const store = screen.getByRole("button", { name: "Store this figure" });
    act(() => store.focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    expect(store).toHaveFocus();
    expectHeld(store);
    expect(store).toHaveTextContent("Storing…");
    await user.keyboard("{Enter}");

    writes.release();

    await readBack(/for Portugal/);
    await waitFor(() => expectNotHeld(store));
    expect(store).toHaveTextContent("Store this figure");
    expect(store).toHaveFocus();
    expect(writes.sent).toHaveLength(1);
  });

  it("lets go of Store after a refused figure, with focus still on it", async () => {
    const user = userEvent.setup();
    const writes = holdManualWritesAnswering(() =>
      HttpResponse.json(
        { code: "manual_entry_not_permitted", message: "no" },
        { status: 409 },
      ),
    );
    renderEntry();
    await fillAFigure();
    const store = screen.getByRole("button", { name: "Store this figure" });
    act(() => store.focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes.sent).toBe(1));
    expectHeld(store);
    await user.keyboard("{Enter}");

    writes.release();

    expect(
      await screen.findByText(/does not accept a manually entered value/),
    ).toBeInTheDocument();
    await waitFor(() => expectNotHeld(store));
    expect(store).toBeEnabled();
    expect(store).toHaveFocus();
    await user.keyboard("{Enter}");
    // The third Enter's request arriving is what proves the second sent nothing.
    await waitFor(() => expect(writes.sent).toBe(2));
  });
});

/**
 * UI-27. **The candidate a figure is about is chosen from a list**, and a list that could not be
 * read left that choice empty with nothing said: only a failed store was ever reported.
 */
describe("the hand-entry form when the candidates are not there", () => {
  it("says the candidates could not be loaded, and reads them again when asked", async () => {
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
    renderEntry();

    expect(
      await screen.findByText("The candidates could not be loaded"),
    ).toBeInTheDocument();
    // Nobody to choose is not the same as nobody there: no list is offered at all.
    expect(screen.queryByRole("combobox", { name: "Candidate" })).toBeNull();

    failing = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("option", { name: "Portugal" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  it("marks the candidate list busy, and offers none, while it loads", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get("/v1/candidates", async () => {
        await held;
      }),
    );
    const { container } = renderEntry();

    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull(),
    );
    expect(screen.queryByRole("combobox", { name: "Candidate" })).toBeNull();

    release();

    expect(
      await screen.findByRole("option", { name: "Portugal" }),
    ).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

/**
 * PL-085 (UF-089, NEW-55-S2). **The form as the design's round 4 draws it**: two bands, the
 * retrieval date shown before it is sent, labels previewed as the chips that will be stored,
 * every problem marking its field, and a read-back a screen reader hears.
 */
describe("the hand-entry form as designed", () => {
  afterEach(() => vi.useRealTimers());

  function renderScore() {
    return render(
      <AppConfigProvider config={TEST_CONFIG}>
        <MemoryRouter>
          <ManualEntryPanel
            attribute="country.residency_admin_ease"
            attributeName="Residency admin ease"
            kind="AssignedScore"
            level="country"
          />
        </MemoryRouter>
      </AppConfigProvider>,
    );
  }

  it("announces a stored figure from a status line that was already there", async () => {
    const user = userEvent.setup();
    renderEntry();

    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await fillAFigure();
    await user.click(screen.getByRole("button", { name: "Store this figure" }));

    await waitFor(() => expect(status).toHaveTextContent(/Stored Siemens for Portugal/));
    expect(screen.getByRole("status")).toBe(status);
  });

  it("marks each field its problem is about", async () => {
    const user = userEvent.setup();
    renderScore();
    await screen.findByRole("option", { name: "Portugal" });

    await user.click(screen.getByRole("button", { name: "Store this figure" }));

    for (const name of ["Candidate", "Score", "Scale, lowest", "Scale, highest", "Describes, from", "Describes, to"]) {
      const control = screen.getByLabelText(name);
      expect(control, name).toHaveAttribute("aria-invalid", "true");
      expect(control, name).toHaveAccessibleDescription(expect.stringMatching(/\S/) as unknown);
    }
    expect(screen.getByLabelText("Candidate")).toHaveAccessibleDescription(
      "Choose the candidate this figure is about.",
    );
    expect(screen.getByLabelText("Where this came from")).not.toHaveAttribute("aria-invalid");
  });

  it("groups the figure and where it came from", () => {
    renderEntry();

    expect(screen.getByRole("group", { name: "The figure" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Where it came from" })).toBeInTheDocument();
  });

  it("shows the retrieval date it will stamp", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-25T09:15:00.000Z") });
    const user = userEvent.setup();
    const writes = holdManualWrites();
    renderEntry();

    const retrieved = screen.getByRole("textbox", { name: "Retrieved" });
    expect(retrieved).toHaveAttribute("readonly");
    expect(retrieved).toHaveValue(formatDateTime("2026-10-25T09:15:00.000Z"));

    await fillAFigure();
    await user.click(screen.getByRole("button", { name: "Store this figure" }));

    await waitFor(() => expect(writes.sent).toHaveLength(1));
    expect(writes.sent[0]).toMatchObject({ retrieval_date: "2026-10-25T09:15:00.000Z" });
    writes.release();
  });

  it("previews the labels exactly as they will be stored", async () => {
    const user = userEvent.setup();
    const writes = holdManualWrites();
    renderEntry();
    await fillAFigure();
    await user.clear(field("Values"));
    fireEvent.change(field("Values"), {
      target: { value: "SAP\nSiemens\nSAP\n\nBooking Holdings, Inc." },
    });

    const preview = within(screen.getByRole("group", { name: "Will store" }));
    expect(preview.getAllByRole("listitem").map((chip) => chip.textContent)).toEqual([
      "SAP",
      "Siemens",
      "Booking Holdings, Inc.",
    ]);

    await user.click(screen.getByRole("button", { name: "Store this figure" }));
    await waitFor(() => expect(writes.sent).toHaveLength(1));
    expect(writes.sent[0]).toMatchObject({
      payload: { labels: ["SAP", "Siemens", "Booking Holdings, Inc."] },
    });
    writes.release();
  });

  it("names its confidence levels in capitals, starting at Medium", () => {
    renderEntry();

    const confidence = screen.getByRole("combobox", { name: "Confidence" });
    expect(confidence).toHaveDisplayValue("Medium");
    expect(
      within(confidence).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Absolute", "High", "Medium", "Low"]);
  });

  it("moves focus to the candidate it asks first when it opens", async () => {
    renderEntry();

    expect(await screen.findByRole("combobox", { name: "Candidate" })).toHaveFocus();
  });
});
