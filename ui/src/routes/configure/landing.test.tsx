import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * PL-018 on Configure. **A route to a setting lands on it**: its stage or its field is focused
 * and marked until the reader acts -- also when the reader is already on Configure.
 */

function stage(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe.each([
  ["household", "Household"],
  ["pillar-weights", "Pillar weights"],
  ["criteria", "Pillar weights"],
  ["source-priority", "Source priority"],
])("?show=%s", (show, name) => {
  it(`lands on the ${name} stage, marked until a key is pressed`, async () => {
    renderShell(`/configure?show=${show}`);
    await screen.findByRole("region", { name });

    await waitFor(() => expect(stage(name)).toHaveFocus());
    expect(stage(name)).toHaveClass("is-landed");
    await userEvent.keyboard("{Shift}");
    expect(stage(name)).not.toHaveClass("is-landed");
  });
});

describe.each([
  ["score-range", "setting-score_scale_max"],
  ["comparator-limit", "setting-comparator_limit"],
  ["refetch-age", "setting-refetch_older_than_days"],
])("?show=%s", (show, field) => {
  it("focuses the setting's box once the limits are read", async () => {
    renderShell(`/configure?show=${show}`);

    await waitFor(() => expect(document.activeElement?.id).toBe(field));
  });
});

describe("landing on Configure", () => {
  it("lands again when the sidebar's Edit is followed from Configure itself", async () => {
    renderShell("/configure");
    const household = within(await screen.findByRole("region", { name: "Household summary" }));
    await screen.findByRole("region", { name: "Household" });

    await userEvent.click(household.getByRole("link", { name: "Edit" }));

    await waitFor(() => expect(stage("Household")).toHaveFocus());
    expect(stage("Household")).toHaveClass("is-landed");
  });

  it("marks nothing for a name it does not know", async () => {
    renderShell("/configure?show=nowhere");
    await screen.findByRole("region", { name: "Household" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(document.querySelector(".is-landed")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("waits for the limits to be read before focusing the field", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.get("/v1/settings", async () => {
        await held;
      }),
    );
    renderShell("/configure?show=score-range");
    await screen.findByRole("region", { name: "Acquisition limits" });
    expect(document.getElementById("setting-score_scale_max")).toBeNull();

    release();

    await waitFor(() => expect(document.activeElement?.id).toBe("setting-score_scale_max"));
  });
});

/**
 * PL-011 on Configure. **No criteria set at all** is said with the one way to make one, in
 * stage 3, once the list has been read -- never while it is pending or after it failed.
 */
describe("Configure with no criteria set", () => {
  it("offers to create a first set, and takes the reader to stage 1's name field", async () => {
    mockServer.use(http.get("/v1/criteria-sets", () => HttpResponse.json({ items: [] })));
    renderShell("/configure");

    const card = await within(stage("Pillar weights")).findByRole("region", {
      name: "No criteria set yet",
    });
    await userEvent.click(within(card).getByRole("button", { name: "Create a first set" }));

    expect(document.activeElement?.id).toBe("new-criteria-set");
    expect(within(stage("Match rules & gates")).queryByRole("region", { name: "No criteria set yet" })).toBeNull();
    // The global stages stay.
    expect(stage("Household")).toBeInTheDocument();
  });

  it("says nothing of the kind while the list is on its way", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets", async () => {
        await delay("infinite");
        return HttpResponse.json({ items: [] });
      }),
    );
    renderShell("/configure");
    await screen.findByRole("region", { name: "Pillar weights" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(screen.queryByRole("region", { name: "No criteria set yet" })).toBeNull();
  });

  it("says nothing of the kind when the list could not be read", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets", () =>
        HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 }),
      ),
    );
    renderShell("/configure");

    expect(
      (await screen.findAllByText(/criteria sets.* could not be loaded/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "No criteria set yet" })).toBeNull();
  });
});
