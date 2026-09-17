import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import { renderShell } from "../../../testing/renderShell";

/**
 * The criterion editor: how a criterion judges, not how much it weighs.
 *
 * **This is the subjective half of the ontology becoming editable** (`reqs.md` 3.0). Until it
 * existed, a criterion's direction and its scale anchors could only be changed by a migration,
 * which made them configuration in name and code in practice.
 *
 * What is under test is the same thing the weight editor's tests hold: **the screen sends a
 * rule and shows what the server made of it**. Nothing here works out whether a rule is legal
 * -- that is one question with one answer, and it lives on the server.
 */

const ANCHORED = "country.overcrowding_rate";
const PLAIN = "country.homicide_rate";

/**
 * Waits until every panel has finished loading before anything is typed.
 *
 * The same race as `ConfigureScreen.test.tsx` (P13): the screen mounts seven panels behind six
 * requests, and a response landing mid-edit refills a field that was being typed into.
 */
async function settled(): Promise<void> {
  await screen.findByRole("region", { name: "Source priority" });
  await waitFor(() =>
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument(),
  );
}

async function openTheRuleFor(attribute: string): Promise<void> {
  const user = userEvent.setup();
  renderShell("/configure");
  await settled();
  await user.click(
    await screen.findByRole("button", {
      name: `Edit the rule for ${attribute}`,
    }),
  );
}

function goalSelect(): HTMLSelectElement {
  return screen.getByRole<HTMLSelectElement>("combobox", { name: "Goal" });
}

describe("reading the rule a criterion already has", () => {
  it("is closed until asked for, because forty-one open scales is unreadable", async () => {
    renderShell("/configure");
    await settled();

    expect(
      screen.queryByRole("combobox", { name: "Goal" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: `Edit the rule for ${PLAIN}` }),
    ).toBeInTheDocument();
  });

  it("shows the stored goal, method and anchors", async () => {
    await openTheRuleFor(ANCHORED);

    expect(goalSelect().value).toBe("minimise");
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "Normalisation" })
        .value,
    ).toBe("fixed");
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: `Anchor 1 value for ${ANCHORED}`,
      }).value,
    ).toBe("2");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: `Anchor 2 label for ${ANCHORED}`,
      }).value,
    ).toBe("crowded");
  });

  it("shows a threshold's bound, and leaves the bound nobody set empty", async () => {
    await openTheRuleFor(ANCHORED);

    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: "Threshold maximum",
      }).value,
    ).toBe("15");
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: "Threshold minimum",
      }).value,
    ).toBe("");
  });

  it("says so when a criterion has no fixed scale at all", async () => {
    await openTheRuleFor(PLAIN);

    expect(
      screen.getByText(/no anchors, so this criterion has no fixed scale/i),
    ).toBeInTheDocument();
  });
});

describe("changing the rule", () => {
  it("sends the whole rule and shows what came back", async () => {
    const sent: unknown[] = [];
    mockServer.events.on("request:start", () => undefined);
    const user = userEvent.setup();
    mockServer.use(
      http.patch(
        `/v1/criteria-sets/:criteriaSetId/criteria/:attributeId`,
        async ({ request, params }) => {
          const body = (await request.json()) as Record<string, unknown>;
          sent.push(body);
          return HttpResponse.json({
            pillar: "housing",
            criteria: [
              {
                attribute: String(params["attributeId"]),
                pillar: "housing",
                weight: 70,
                weight_locked: false,
                is_scored: true,
                blocks_if_missing: false,
                normalisation_method: "fixed",
                ...body,
              },
            ],
          });
        },
      ),
    );

    await openTheRuleFor(ANCHORED);
    await user.selectOptions(goalSelect(), "maximise");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ goal: "maximise" });
    // The table's own Goal column, re-rendered from the response rather than from the draft.
    await waitFor(() =>
      expect(
        screen.getByRole("row", { name: new RegExp(ANCHORED) }),
      ).toHaveTextContent("maximise"),
    );
  });

  it("cannot be saved until something has changed", async () => {
    await openTheRuleFor(ANCHORED);

    expect(screen.getByRole("button", { name: "Save rule" })).toBeDisabled();
  });

  it("adds and removes an anchor row without saving anything", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(PLAIN);

    await user.click(screen.getByRole("button", { name: "Add an anchor" }));

    expect(
      screen.getByRole("spinbutton", { name: `Anchor 1 value for ${PLAIN}` }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove anchor 1" }));

    expect(
      screen.queryByRole("spinbutton", { name: `Anchor 1 value for ${PLAIN}` }),
    ).not.toBeInTheDocument();
  });

  it("reports every unreadable figure and sends nothing", async () => {
    const sent: unknown[] = [];
    const user = userEvent.setup();
    mockServer.use(
      http.patch(
        `/v1/criteria-sets/:criteriaSetId/criteria/:attributeId`,
        async () => {
          sent.push(true);
          return HttpResponse.json({ pillar: "housing", criteria: [] });
        },
      ),
    );

    await openTheRuleFor(ANCHORED);
    // A number input will not hold letters, so the unreadable figure comes from an anchor's
    // label field being left where a score is needed: one half of a pair.
    await user.clear(
      screen.getByRole("spinbutton", {
        name: `Anchor 1 score for ${ANCHORED}`,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    expect(
      await screen.findByText("Anchor 1 needs both a value and a score."),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("shows the server's refusal rather than absorbing it", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.patch(`/v1/criteria-sets/:criteriaSetId/criteria/:attributeId`, () =>
        HttpResponse.json(
          {
            code: "invalid_criterion",
            message:
              "country.overcrowding_rate aims at a target range and normalises `as_is`, which cannot express a band",
          },
          { status: 422 },
        ),
      ),
    );

    await openTheRuleFor(ANCHORED);
    await user.selectOptions(goalSelect(), "target_range");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    expect(
      await screen.findByText(/cannot express a band/i),
    ).toBeInTheDocument();
  });

  it("puts the stored rule back on screen after the server refuses one", async () => {
    // P55: `useCriterionRule`'s own header promises "a refused change leaves the criterion
    // exactly as it was, so the draft goes back to it once the attempt is over", and the
    // effect cleared the problems without restoring the draft. So the Goal select still read
    // `target_range` while the rule being scored was still the stored one -- the rule in front
    // of the reader was not the rule doing the work. The weight input beside it already
    // restores, and says why: the value on screen is the one a reader takes for the truth.
    const user = userEvent.setup();
    mockServer.use(
      http.patch(`/v1/criteria-sets/:criteriaSetId/criteria/:attributeId`, () =>
        HttpResponse.json(
          { code: "invalid_criterion", message: "cannot express a band" },
          { status: 422 },
        ),
      ),
    );

    await openTheRuleFor(ANCHORED);
    const stored = goalSelect().value;
    await user.selectOptions(goalSelect(), "target_range");
    await user.click(screen.getByRole("button", { name: "Save rule" }));
    await screen.findByText(/cannot express a band/i);

    await waitFor(() => expect(goalSelect()).toHaveValue(stored));
  });

  it("discards a draft without sending it", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);

    await user.selectOptions(goalSelect(), "maximise");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(goalSelect().value).toBe("minimise");
    expect(screen.getByRole("button", { name: "Save rule" })).toBeDisabled();
  });
});
