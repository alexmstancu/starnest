import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import { renderShell } from "../../../testing/renderShell";

/**
 * The rules, and which of them the set lets act.
 *
 * **The switch must never be ahead of the server.** A checkbox that ticked itself and then
 * failed would have the screen claiming a gate is enforced when it is not -- and a gate is what
 * decides whether a candidate can be ranked at all (`reqs.md` 5.5), so the test for the sad path
 * is the important one here.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Rules" }));
}

describe("the rules panel", () => {
  it("lists the gates at the level, and the one asked at every level", async () => {
    renderShell("/configure");
    const rules = await panel();

    expect(
      await rules.findByRole("rowheader", { name: "A visa route exists" }),
    ).toBeInTheDocument();
    const anywhere = rules.getByRole("rowheader", {
      name: "Not excluded by hand",
    });
    expect(anywhere.closest("tr")).toHaveTextContent("every level");
  });

  it("shows which gates this set enforces", async () => {
    renderShell("/configure");
    await panel();

    expect(
      await screen.findByRole("checkbox", {
        name: "Enforce A visa route exists",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Enforce Free movement applies" }),
    ).not.toBeChecked();
  });

  it("enforces a gate once the server has accepted it", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    const toggle = await screen.findByRole("checkbox", {
      name: "Enforce Free movement applies",
    });
    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("leaves the gate as it was when the write fails, and says why", async () => {
    mockServer.use(
      http.put(
        "/v1/criteria-sets/:criteriaSetId/match-rules/:matchRuleId",
        () =>
          HttpResponse.json(
            { code: "internal_error", message: "the gate could not be stored" },
            { status: 500 },
          ),
      ),
    );
    const user = userEvent.setup();
    renderShell("/configure");
    const rules = await panel();

    const toggle = await screen.findByRole("checkbox", {
      name: "Enforce Free movement applies",
    });
    await user.click(toggle);

    expect(
      await rules.findByText(/the gate could not be stored/),
    ).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it("lists compound rules with what each does when it fires", async () => {
    renderShell("/configure");
    const rules = await panel();

    const row = (
      await rules.findByRole("rowheader", { name: "Mild and connected" })
    ).closest("tr");
    expect(row).toHaveTextContent("AllConditionsHold");
    expect(row).toHaveTextContent("not_matching");
  });

  it("applies a compound rule once the server has accepted it", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await panel();

    const toggle = await screen.findByRole("checkbox", {
      name: "Apply Rent fits the target spend",
    });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("reports gates that could not be listed", async () => {
    mockServer.use(
      http.get("/v1/match-rules", () =>
        HttpResponse.json(
          { code: "internal_error", message: "no rules" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");
    const rules = await panel();

    expect(await rules.findByText(/no rules/)).toBeInTheDocument();
  });

  it("says so when a level defines no compound rule", async () => {
    mockServer.use(
      http.get("/v1/compound-rules", () => HttpResponse.json({ items: [] })),
    );
    renderShell("/configure");
    const rules = await panel();

    expect(
      await rules.findByText("No compound rule is defined at this level."),
    ).toBeInTheDocument();
  });
});
