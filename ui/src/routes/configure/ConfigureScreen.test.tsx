import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * The weight editor.
 *
 * The behaviour under test is narrow and the whole point: **the screen sends one weight and
 * shows what the server made of the pillar**. So the assertions are about what arrived back,
 * never about a number this code worked out -- there is no such number.
 */

/**
 * Opens the pillar an attribute is weighed inside.
 *
 * **Found by looking, not by a table of which pillar holds what.** A criterion's weight is a
 * share of its pillar's, so the screen keeps it there and the way to reach one is to open the
 * pillar -- but which pillar that is belongs to the catalog, and a map here would be a second
 * copy of it to keep in step.
 */
async function openThePillarOf(attribute: string): Promise<void> {
  const named = { name: `Weight for ${attribute}` };
  if (screen.queryByRole("spinbutton", named) !== null) return;

  const weights = await screen.findByRole("region", { name: "Pillar weights" });
  const pillars = within(weights)
    .getAllByRole("group")
    .map((row) => row.getAttribute("aria-label") ?? "");
  for (const pillar of pillars) {
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(`^${pillar}`) }),
    );
    if (screen.queryByRole("spinbutton", named) !== null) return;
  }
}

/** A criterion's lock, opening the pillar it lives in first. */
async function findLockAnywhere(attribute: string): Promise<HTMLInputElement> {
  await openThePillarOf(attribute);
  return screen.getByRole<HTMLInputElement>("checkbox", {
    name: `Lock the weight for ${attribute}`,
  });
}

async function weightInput(attribute: string): Promise<HTMLInputElement> {
  await openThePillarOf(attribute);
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
  /**
   * **Inside its pillar, not beside it.** A criterion's weight is a share of its pillar's, so
   * opening the pillar is what reveals the attributes sharing that hundred -- and the pillar
   * is then the row above rather than a column repeated down every row.
   */
  it("shows every criterion in a pillar with its weight, once the pillar is open", async () => {
    renderShell("/configure");

    expect(await weightInput("country.cost_of_living_index")).toHaveValue(50);
    expect(await weightInput("country.total_tax_rate_effective")).toHaveValue(30);

    const row = (await weightInput("country.homicide_rate")).closest("tr")!;
    expect(within(row).getByRole("rowheader")).toHaveTextContent(
      "country.homicide_rate",
    );
    // The pillar names the block these rows are in, so the row itself no longer repeats it.
    expect(row).not.toHaveTextContent("safety");
    expect(
      screen.getByRole("button", { name: /^safety/ }),
    ).toHaveAttribute("aria-expanded", "true");
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
      expect(shownWeight("country.total_tax_rate_effective")).toBe("40"),
    );
    expect(shownWeight("country.cost_of_living_index")).toBe("40");
    expect(shownWeight("country.economic_outlook")).toBe("20");
  });

  /**
   * **One pillar is open at a time**, as the design has it, so the other pillar's weights are
   * read by opening it -- which is also the honest test: the rebalance has to have left them
   * alone on the server, not merely off screen.
   */
  it("leaves the other pillars alone", async () => {
    renderShell("/configure");

    await saveWeight("country.cost_of_living_index", "40");

    await waitFor(() =>
      expect(shownWeight("country.total_tax_rate_effective")).toBe("40"),
    );
    expect(
      await weightInput("country.housing_cost_overburden_rate"),
    ).toHaveValue(60);
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
    expect(await weightInput("country.total_tax_rate_effective")).toHaveValue(30);
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
    // No pillar weights either: a set that weighs nothing has nothing to open, and the
    // stage says so where the pillars would be.
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () =>
        HttpResponse.json({
          id: "default",
          name: "Default",
          criteria: [],
          pillar_weights: [],
        }),
      ),
    );
    renderShell("/configure");

    // Scoped to the screen: the sidebar says "No criteria sets" while its own list is in
    // flight, which an unscoped /no criteria/i matches first and then loses when it re-renders.
    const configure = within(
      await screen.findByRole("region", { name: "Configure" }),
    );
    expect(
      await configure.findByText(/weighs no pillar yet/i),
    ).toBeInTheDocument();
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

/**
 * UX review G. `CriterionInput` has carried `weight_locked` all along and the screen never
 * sent it, so the pillar-weight rule existed one level up and not here.
 */
describe("locking a criterion's weight", () => {
  // `settled()` waits for the last panel to arrive, which can happen before the criteria
  // table does -- so the first read of a row has to be a `findBy`, as `saveWeight` already is.
  async function findLock(attribute: string): Promise<HTMLInputElement> {
    await openThePillarOf(attribute);
    return screen.findByRole<HTMLInputElement>("checkbox", {
      name: `Lock the weight for ${attribute}`,
    });
  }

  function lockFor(attribute: string): HTMLInputElement {
    return screen.getByRole<HTMLInputElement>("checkbox", {
      name: `Lock the weight for ${attribute}`,
    });
  }


  it("shows which criteria are locked, as the set says", async () => {
    renderShell("/configure");
    await settled();

    expect(await findLock("country.economic_outlook")).toBeChecked();
    expect(lockFor("country.cost_of_living_index")).not.toBeChecked();
  });

  it("locks a weight, and the lock stays on", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();

    await user.click(await findLock("country.cost_of_living_index"));

    await waitFor(() =>
      expect(lockFor("country.cost_of_living_index")).toBeChecked(),
    );
  });

  /** A lock holds its weight where it is: a rebalance must route around it. */
  it("leaves a locked sibling's weight untouched when another moves", async () => {
    renderShell("/configure");
    await settled();
    await weightInput("country.economic_outlook");
    expect(shownWeight("country.economic_outlook")).toBe("20");

    await saveWeight("country.cost_of_living_index", "40");

    await waitFor(() =>
      expect(shownWeight("country.total_tax_rate_effective")).not.toBe("30"),
    );
    expect(shownWeight("country.economic_outlook")).toBe("20");
  });

  it("refuses a change when every other weight in the pillar is locked", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();

    // Lock the one unlocked sibling, leaving nowhere for a change to be absorbed.
    await user.click(await findLock("country.total_tax_rate_effective"));
    await waitFor(() =>
      expect(lockFor("country.total_tax_rate_effective")).toBeChecked(),
    );

    await saveWeight("country.cost_of_living_index", "40");

    // The client's own wording, not the server's: `errorPresentation` maps this code to a
    // sentence of its own, which is the one a reader sees.
    expect(
      await screen.findByText(/nothing to rebalance into/i),
    ).toBeInTheDocument();
  });
});

/**
 * The protocol the real backend enforces, learned by driving it: a lock travels **alone**.
 *
 * Sending `{ weight, weight_locked: false }` for a locked criterion is refused, because the
 * request asks to move a weight that is locked at the moment it arrives -- even when the
 * weight sent is the one it already holds. The mock was more permissive than the server for
 * a while, which certified a protocol the server rejects.
 */
describe("a locked weight holds where it is", () => {
  it("refuses a weight change on a criterion that is itself locked", async () => {
    renderShell("/configure");
    await settled();
    await weightInput("country.economic_outlook");

    await saveWeight("country.economic_outlook", "25");

    expect(
      await screen.findByText(/nothing to rebalance into/i),
    ).toBeInTheDocument();
  });

  it("unlocks without touching the weight, so the weight can then move", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();

    const lock = await findLockAnywhere("country.economic_outlook");
    expect(shownWeight("country.economic_outlook")).toBe("20");

    await user.click(lock);

    await waitFor(() => expect(lock).not.toBeChecked());
    // Unlocking moves nothing: it says the weight may move, not that it has.
    expect(shownWeight("country.economic_outlook")).toBe("20");

    await saveWeight("country.economic_outlook", "25");
    await waitFor(() =>
      expect(shownWeight("country.economic_outlook")).toBe("25"),
    );
  });
});

describe("what each pillar's criteria come to", () => {
  /** The total belongs to the pillar it is inside, and is read there. */
  it("shows the total inside each pillar, so the rule can be seen holding", async () => {
    renderShell("/configure");
    await settled();

    await openThePillarOf("country.cost_of_living_index");
    expect(
      within(
        await screen.findByRole("list", { name: /weight totals by pillar/i }),
      ).getByText(/^economics 100/i),
    ).toBeInTheDocument();

    await openThePillarOf("country.overcrowding_rate");
    expect(
      within(
        await screen.findByRole("list", { name: /weight totals by pillar/i }),
      ).getByText(/^housing 100/i),
    ).toBeInTheDocument();
  });

  it("keeps the total at 100 after a weight moves", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight("country.cost_of_living_index", "40");

    await waitFor(() =>
      expect(shownWeight("country.total_tax_rate_effective")).not.toBe("30"),
    );
    const totals = within(
      await screen.findByRole("list", { name: /weight totals by pillar/i }),
    );
    expect(totals.getByText(/^economics 100/i)).toBeInTheDocument();
  });
});

/**
 * UX review E. Session-scoped on purpose: the backend records no change log, and inventing one
 * in the client would be a second account of the truth the server cannot confirm.
 */
describe("what this session changed", () => {
  async function historyPanel() {
    return within(await screen.findByRole("region", { name: /^recent changes/i }));
  }

  it("says nothing has changed, and that the list is not stored", async () => {
    renderShell("/configure");
    const panel = await historyPanel();

    expect(
      panel.getByText(/nothing has been changed in this session/i),
    ).toBeInTheDocument();
    expect(panel.getByText(/reloading clears it/i)).toBeInTheDocument();
  });

  it("lists a weight change once it has been made", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight("country.cost_of_living_index", "40");

    const panel = await historyPanel();
    expect(
      await panel.findByText(/Weight for country\.cost_of_living_index: 50 to 40/),
    ).toBeInTheDocument();
  });

  /** A configuration is a state, so the reach is named before it is taken. */
  it("names how far an undo would reach", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight("country.cost_of_living_index", "40");
    // A different pillar, so it is opened first -- which is also two changes, which is the
    // reach this test is about.
    await openThePillarOf("country.homicide_rate");
    await userEvent.click(
      await screen.findByRole("checkbox", {
        name: "Lock the weight for country.homicide_rate",
      }),
    );

    const panel = await historyPanel();
    await panel.findByText(/Locked country\.homicide_rate/);
    expect(
      panel.getByRole("button", { name: "Undo this and the 1 after it" }),
    ).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Undo this" })).toBeInTheDocument();
  });

  /**
   * The behaviour the whole panel turns on: an undo that only put a number back on screen
   * would disagree with the server the moment anything else read it.
   */
  it("undoes by making the opposite request, not by restoring the screen", async () => {
    const sent: unknown[] = [];
    renderShell("/configure");
    await settled();
    await saveWeight("country.cost_of_living_index", "40");
    await screen.findByText(/Weight for country\.cost_of_living_index: 50 to 40/);

    mockServer.use(
      http.patch(
        "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
        async ({ request, params }) => {
          const body = await request.json();
          sent.push({ attribute: params["attributeId"], body });
          return HttpResponse.json({ pillar: "economics", criteria: [] });
        },
      ),
    );

    const panel = await historyPanel();
    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      attribute: "country.cost_of_living_index",
      body: { weight: 50 },
    });
  });

  it("drops the change from the list once it has been undone", async () => {
    renderShell("/configure");
    await settled();
    await saveWeight("country.cost_of_living_index", "40");

    const panel = await historyPanel();
    await panel.findByText(/Weight for country\.cost_of_living_index: 50 to 40/);
    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    await waitFor(() =>
      expect(
        screen.queryByText(/Weight for country\.cost_of_living_index: 50 to 40/),
      ).toBeNull(),
    );
  });

  it("offers a way back to where the session started", async () => {
    renderShell("/configure");
    await settled();
    await saveWeight("country.cost_of_living_index", "40");

    const panel = await historyPanel();
    await panel.findByText(/Weight for country\.cost_of_living_index: 50 to 40/);
    await userEvent.click(
      panel.getByRole("button", { name: "Back to where I started" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Back to where I started" }),
      ).toBeNull(),
    );
  });

  it("reports a refusal to undo, and keeps the change listed", async () => {
    renderShell("/configure");
    await settled();
    await saveWeight("country.cost_of_living_index", "40");
    const panel = await historyPanel();
    await panel.findByText(/Weight for country\.cost_of_living_index: 50 to 40/);

    mockServer.use(
      http.patch("/v1/criteria-sets/:criteriaSetId/criteria/:attributeId", () =>
        HttpResponse.json(
          { code: "weights_all_locked", message: "no" },
          { status: 409 },
        ),
      ),
    );
    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    expect(await panel.findByRole("alert")).toHaveTextContent(
      /nothing to rebalance into/i,
    );
    // A half-finished undo is a real state, so what was not undone stays listed.
    expect(
      screen.getByText(/Weight for country\.cost_of_living_index: 50 to 40/),
    ).toBeInTheDocument();
  });
});
