import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { renderShell } from "../testing/renderShell";

/**
 * The weight editor.
 *
 * The behaviour under test is narrow and the whole point: **the screen sends one weight and
 * shows what the server made of the pillar**. So the assertions are about what arrived back,
 * never about a number this code worked out -- there is no such number.
 */

async function weightInput(attribute: string): Promise<HTMLInputElement> {
  return await screen.findByRole("spinbutton", {
    name: `Weight for ${attribute}`,
  });
}

/**
 * The weight the table currently shows, read synchronously.
 *
 * **Never call `weightInput` inside a `waitFor`.** `findByRole` is itself a retry loop with its
 * own one-second budget, so nesting the two means each `waitFor` attempt can spend a second in
 * the inner one -- five real attempts out of a five-second budget, which passes alone and times
 * out under load. `getByRole` throws at once and lets `waitFor` poll at its own interval.
 */
function shownWeight(attribute: string): number | string | string[] | null {
  return screen.getByRole<HTMLInputElement>("spinbutton", {
    name: `Weight for ${attribute}`,
  }).value;
}

/**
 * Waits until every panel on the screen has finished loading.
 *
 * **Typing into a half-loaded screen is a race, not a slow test.** The Configure screen mounts
 * seven panels behind six requests, and `CriterionRow` follows the stored weight with an effect
 * -- so a response landing between `clear()` and `click()` refills the input, the click saves 50
 * instead of nothing, and the assertion waits for an alert that will never come. It failed once
 * inside a loaded `make check` and passed a thousand times alone, which is what a race looks
 * like (`known-issues.md` P13).
 *
 * The source priority table is the last panel on the screen, so its arrival means the rest have
 * arrived too.
 */
async function settled(): Promise<void> {
  await screen.findByRole("region", { name: "Source priority" });
  await waitFor(() =>
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument(),
  );
}

async function saveWeight(attribute: string, weight: string): Promise<void> {
  const user = userEvent.setup();
  const input = await weightInput(attribute);
  await settled();
  const row = input.closest("tr")!;

  await user.clear(input);
  await user.type(input, weight);
  await user.click(within(row).getByRole("button", { name: "Save" }));
}

describe("the criteria list", () => {
  it("shows every criterion in the selected set with its pillar and weight", async () => {
    renderShell("/configure");

    expect(await weightInput("country.cost_of_living_index")).toHaveValue(50);
    expect(await weightInput("country.income_tax_effective")).toHaveValue(30);
    const row = (await weightInput("country.homicide_rate")).closest("tr")!;
    expect(within(row).getByRole("rowheader")).toHaveTextContent(
      "country.homicide_rate",
    );
    expect(row).toHaveTextContent("safety");
  });

  it("follows the criteria set chosen in the sidebar", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await weightInput("country.cost_of_living_index");

    await user.selectOptions(
      screen.getByRole("combobox", { name: /active criteria set/i }),
      "remote-only",
    );

    expect(await weightInput("country.broadband_coverage")).toHaveValue(70);
    expect(
      screen.queryByRole("spinbutton", {
        name: "Weight for country.cost_of_living_index",
      }),
    ).not.toBeInTheDocument();
  });
});

describe("changing a weight", () => {
  it("shows the weights the server rebalanced to, not a local calculation", async () => {
    renderShell("/configure");

    await saveWeight("country.cost_of_living_index", "40");

    // The unlocked sibling absorbed the whole change; the locked one did not move. Both
    // figures came back from the PATCH.
    await waitFor(() =>
      expect(shownWeight("country.income_tax_effective")).toBe("40"),
    );
    expect(shownWeight("country.cost_of_living_index")).toBe("40");
    expect(shownWeight("country.net_median_salary")).toBe("20");
  });

  it("leaves the other pillars alone", async () => {
    renderShell("/configure");

    await saveWeight("country.cost_of_living_index", "40");

    await waitFor(() =>
      expect(shownWeight("country.income_tax_effective")).toBe("40"),
    );
    expect(shownWeight("country.housing_cost_overburden_rate")).toBe("60");
  });

  it("shows the refusal, and which locks caused it, when nothing can absorb the change", async () => {
    renderShell("/configure");

    await saveWeight("country.homicide_rate", "80");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("weights_all_locked");
    expect(alert).toHaveTextContent(
      /every other weight in this pillar is locked/i,
    );

    // Scoped to the list: every attribute id here is also a row heading in the table above, so
    // an unscoped query matches twice and proves nothing about the refusal.
    const locks = within(await screen.findByRole("list", { name: /locked/i }));
    expect(
      locks.getByText("country.perceived_safety_index"),
    ).toBeInTheDocument();
  });

  it("keeps showing the stored weight after a refusal, because it was not changed", async () => {
    renderShell("/configure");

    await saveWeight("country.homicide_rate", "80");

    await screen.findByRole("alert");
    expect(await weightInput("country.homicide_rate")).toHaveValue(65);
  });

  it("reports a failed save rather than letting it look like it worked", async () => {
    mockServer.use(
      http.patch("/v1/criteria-sets/:id/criteria/:attribute", () =>
        HttpResponse.error(),
      ),
    );
    renderShell("/configure");

    await saveWeight("country.cost_of_living_index", "40");

    expect(await screen.findByText("client.unreachable")).toBeInTheDocument();
  });

  it("refuses to send a weight that is not a number", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const input = await weightInput("country.cost_of_living_index");
    const row = input.closest("tr")!;
    await settled();

    await user.clear(input);
    await user.click(within(row).getByRole("button", { name: "Save" }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      /must be a number/i,
    );
    // Nothing was sent, so nothing was rebalanced.
    expect(await weightInput("country.income_tax_effective")).toHaveValue(30);
  });

  it("offers nothing to save until the weight is actually changed", async () => {
    renderShell("/configure");
    const row = (await weightInput("country.cost_of_living_index")).closest(
      "tr",
    )!;

    expect(within(row).getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("when the criteria set cannot be shown", () => {
  it("reports the failure with its code, and retries when asked", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () =>
        HttpResponse.json(
          { code: "not_found", message: "No such criteria set." },
          { status: 404 },
        ),
      ),
    );
    renderShell("/configure");

    const configure = within(
      await screen.findByRole("region", { name: "Configure" }),
    );
    expect(await configure.findByText("not_found")).toBeInTheDocument();
    expect(configure.getByText("No such criteria set.")).toBeInTheDocument();

    mockServer.resetHandlers();
    // A 404 is not retryable, so there is no button; reloading happens through the sidebar.
    expect(
      configure.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });

  it("says so plainly when the set has no criteria", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () =>
        HttpResponse.json({ id: "default", name: "Default", criteria: [] }),
      ),
    );
    renderShell("/configure");

    // Scoped to the screen: the sidebar says "No criteria sets" while its own list is in
    // flight, which an unscoped /no criteria/i matches first and then loses when it re-renders.
    const configure = within(
      await screen.findByRole("region", { name: "Configure" }),
    );
    expect(await configure.findByText(/has no criteria/i)).toBeInTheDocument();
  });

  it("asks for a selection rather than fetching a criteria set of nothing", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets", () => HttpResponse.json({ items: [] })),
      http.get("/v1/levels", () => HttpResponse.json({ items: [] })),
    );
    renderShell("/configure");

    const configure = within(
      await screen.findByRole("region", { name: "Configure" }),
    );
    await waitFor(() =>
      expect(configure.getByText(/choose a criteria set/i)).toBeInTheDocument(),
    );
  });
});
