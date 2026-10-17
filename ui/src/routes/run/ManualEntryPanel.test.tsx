import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
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
