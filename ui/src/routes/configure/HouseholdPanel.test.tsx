import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

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
    expect(field("Adults")).toHaveValue("2");
    expect(field("Children under 18")).toHaveValue("1");
    expect(field("Citizenships")).toHaveValue("country.romania");
  });

  it("shows no city rather than an empty one when the household lives in none", async () => {
    renderShell("/configure");
    await panel();

    expect(field("Home city candidate")).toHaveValue("");
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

    await user.clear(field("Citizenships"));

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
