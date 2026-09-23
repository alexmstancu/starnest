import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import { renderShell } from "../../../testing/renderShell";

/**
 * The five tuning values.
 *
 * **The behaviour worth testing is the empty one.** Every setting is provisional (`reqs.md`
 * 3.10), and an emptied field must stay empty rather than acquiring a plausible default --
 * a score scale of 100 nobody chose is exactly the fabricated number this application exists
 * to avoid.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Acquisition limits" }));
}

function field(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name });
}

describe("the settings panel", () => {
  it("shows the five stored values", async () => {
    renderShell("/configure");
    await panel();

    expect(field("Minimum coverage to score")).toHaveValue("60");
    expect(field("Top of the score range")).toHaveValue("100");
    expect(field("Candidates you can compare at once")).toHaveValue("5");
    expect(field("Spend cap per acquisition")).toHaveValue("10");
    // Empty in the shipped database, and empty here: an undecided setting shows as nothing.
    expect(field("Refetch data older than")).toHaveValue("");
  });

  /**
   * **A bare number is ambiguous and two of these are the reason.** A coverage floor of 60
   * could be a percentage or a count of attributes, and a cap of 10 could be euros or calls.
   * The unit is announced with the field rather than hidden, so it is part of what the field
   * says rather than decoration beside it.
   */
  it("says what each figure is counted in, as part of the field", async () => {
    renderShell("/configure");
    const settings = await panel();

    expect(field("Minimum coverage to score")).toHaveAccessibleDescription(
      /^%/,
    );
    expect(field("Spend cap per acquisition")).toHaveAccessibleDescription(
      /^€/,
    );
    expect(settings.getByText("candidates")).toBeInTheDocument();
    expect(settings.getByText("points")).toBeInTheDocument();
    expect(settings.getByText("days")).toBeInTheDocument();
  });

  it("saves a changed value and shows what came back", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Candidates you can compare at once"));
    await user.type(field("Candidates you can compare at once"), "3");
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() => expect(field("Candidates you can compare at once")).toHaveValue("3"));
  });

  it("leaves an emptied setting empty instead of inventing a default", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Top of the score range"));
    await user.click(settings.getByRole("button", { name: "Save settings" }));

    expect(await settings.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() => expect(field("Top of the score range")).toHaveValue(""));
  });

  it("shows a refusal, and does not claim to have saved", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const settings = await panel();

    await user.clear(field("Top of the score range"));
    await user.type(field("Top of the score range"), "0");
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

/**
 * UX review K. All four settings are nullable with null the shipped state, and the screen
 * could not express that: an empty field looked the same as one nobody had reached yet.
 */
describe("a setting that is not set", () => {
  it("shows an empty field as Not set rather than as blank", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: null,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    expect(
      await settings.findByRole("textbox", { name: "Minimum coverage to score" }),
    ).toHaveAttribute("placeholder", "Not set");
  });

  it("says what leaving a setting blank costs", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: null,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    expect(
      await settings.findByText(/no coverage floor is in force/i),
    ).toBeInTheDocument();
    expect(
      settings.getByText(/1 setting is not set|one setting is not set/i),
    ).toBeInTheDocument();
  });

  /** The blank that stops the product working, as against the three that leave a rule off. */
  it("raises a blocking banner when the score scale is unset", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: null,
          min_coverage: 60,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    expect(await settings.findByRole("alert")).toHaveTextContent(
      /nothing can be ranked or compared until the score scale maximum is set/i,
    );
  });

  it("says nothing at all when every setting is set", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: 60,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    await settings.findByRole("textbox", { name: "Top of the score range" });
    expect(settings.queryByRole("alert")).toBeNull();
    expect(settings.queryByText(/is not set/i)).toBeNull();
  });

  /** Read off the draft, so clearing a field says what that costs before any save. */
  it("warns as soon as a field is cleared, not only after saving", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({
          score_scale_max: 100,
          min_coverage: 60,
          comparator_limit: 5,
          run_spend_cap_eur: 5,
          refetch_older_than_days: 365,
        }),
      ),
    );
    renderShell("/configure");
    const settings = await panel();

    await user.clear(
      await settings.findByRole("textbox", { name: "Top of the score range" }),
    );

    expect(await settings.findByRole("alert")).toHaveTextContent(
      /nothing can be ranked or compared/i,
    );
  });
});
