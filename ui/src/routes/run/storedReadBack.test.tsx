import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * PL-015. **A figure stored by hand is read back where it counts**: what the database holds and
 * whether anything is stored are asked again once the server has kept it -- and not when it
 * refused it, since nothing moved.
 */

const BASE = "/v1";
const EMPLOYERS = "country.international_employers";

function countReads(): { holdings: number; values: number } {
  const asked = { holdings: 0, values: 0 };
  mockServer.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    if (request.method !== "GET") return;
    if (url.pathname === `${BASE}/holdings`) asked.holdings += 1;
    if (url.pathname === `${BASE}/values` && url.searchParams.get("limit") === "1") {
      asked.values += 1;
    }
  });
  return asked;
}

async function storeAFigure(): Promise<HTMLElement> {
  const form = await screen.findByRole("region", { name: /enter a value for .* by hand/i });
  const inside = within(form);
  await inside.findByRole("option", { name: "Portugal" });
  await userEvent.selectOptions(inside.getByRole("combobox", { name: "Candidate" }), "country.portugal");
  await userEvent.type(inside.getByRole("textbox", { name: "Values" }), "Siemens");
  fireEvent.change(inside.getByLabelText("Describes, from"), { target: { value: "2025-01-01" } });
  fireEvent.change(inside.getByLabelText("Describes, to"), { target: { value: "2025-12-31" } });
  await userEvent.click(inside.getByRole("button", { name: "Store this figure" }));
  return form;
}

describe("a figure stored by hand on Acquire", () => {
  it("reads what the database holds again once it is stored", async () => {
    const asked = countReads();
    renderShell(`/acquire?show=hand-entry&attribute=${EMPLOYERS}`);
    await screen.findByRole("region", { name: /what the database holds/i });
    await waitFor(() => expect(asked.holdings).toBeGreaterThan(0));
    const before = { ...asked };

    const form = await storeAFigure();

    const status = within(form).getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent(/Stored Siemens for Portugal/));
    await waitFor(() => expect(asked.holdings).toBeGreaterThan(before.holdings));
    expect(asked.values).toBeGreaterThan(before.values);
    mockServer.events.removeAllListeners();
  });

  it("reads nothing again when the server refused it", async () => {
    mockServer.use(
      http.post(`${BASE}/values/manual`, () =>
        HttpResponse.json(
          { code: "manual_entry_switched_off", message: "", details: {} },
          { status: 409 },
        ),
      ),
    );
    const asked = countReads();
    renderShell(`/acquire?show=hand-entry&attribute=${EMPLOYERS}`);
    await screen.findByRole("region", { name: /what the database holds/i });
    await waitFor(() => expect(asked.holdings).toBeGreaterThan(0));

    const form = await storeAFigure();
    await within(form).findByRole("alert");
    const before = { ...asked };
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(asked).toEqual(before);
    mockServer.events.removeAllListeners();
  });
});
