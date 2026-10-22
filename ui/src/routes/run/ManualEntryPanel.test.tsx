import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../testing/keyboard";
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
  return render(
    <MemoryRouter>
      <ManualEntryPanel
        attribute={EMPLOYERS}
        attributeName="International employers"
        kind="LabelSet"
        level="country"
      />
    </MemoryRouter>,
  );
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
    await user.type(field("Values"), ", Bosch");

    writes.release();

    // Still said, because it names what was stored rather than what is on screen.
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Stored .*Siemens.* for Portugal/,
    );
    expect(field("Values")).toHaveValue("Siemens, Bosch");
    expect(screen.getByLabelText("Describes, from")).toHaveValue("2025-01-01");
  });

  it("clears the form once a figure is stored and nothing was typed since", async () => {
    const user = userEvent.setup();
    renderEntry();
    await fillAFigure();

    await user.click(screen.getByRole("button", { name: "Store this figure" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/for Portugal/);
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

    const stored = await screen.findByRole("status");
    await waitFor(() =>
      expect(stored).toHaveTextContent(
        "Stored Siemens for Portugal, under Manual entry.",
      ),
    );
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

    expect(await screen.findByRole("status")).toHaveTextContent(/for Portugal/);
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
  it("says the candidates could not be read, and reads them again when asked", async () => {
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
      await screen.findByText(/candidates could not be read/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("the roster is down");

    failing = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("option", { name: "Portugal" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/candidates could not be read/i)).toBeNull();
  });

  it("says the candidates are loading while they load", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get("/v1/candidates", async () => {
        await held;
      }),
    );
    renderEntry();

    expect(
      await screen.findByText("Loading the candidates…"),
    ).toBeInTheDocument();

    release();

    expect(
      await screen.findByRole("option", { name: "Portugal" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading the candidates…")).toBeNull();
  });
});
