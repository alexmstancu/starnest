import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * The four tuning values.
 *
 * **The behaviour worth testing is the empty one.** Every setting is provisional (`reqs.md`
 * 3.10), and an emptied field must stay empty rather than acquiring a plausible default --
 * a score scale of 100 nobody chose is exactly the fabricated number this application exists
 * to avoid.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Settings" }));
}

function field(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name });
}

describe("the settings panel", () => {
  it("shows the four stored values", async () => {
    renderShell("/configure");
    await panel();

    expect(field("Score scale maximum")).toHaveValue("100");
    expect(field("Minimum coverage")).toHaveValue("60");
    expect(field("Comparator limit")).toHaveValue("5");
    expect(field("Run spend cap (EUR)")).toHaveValue("10");
  });

  it("saves a changed value and shows what came back", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Comparator limit"));
    await user.type(field("Comparator limit"), "3");
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() => expect(field("Comparator limit")).toHaveValue("3"));
  });

  it("leaves an emptied setting empty instead of inventing a default", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Score scale maximum"));
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() => expect(field("Score scale maximum")).toHaveValue(""));
  });

  it("shows a refusal, and does not claim to have saved", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Score scale maximum"));
    await user.type(field("Score scale maximum"), "0");
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
