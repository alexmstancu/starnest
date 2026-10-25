import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { ATTRIBUTES } from "../../../mocks/fixtures";
import { mockServer } from "../../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../../testing/keyboard";
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

/**
 * The two criteria these tests drive, **named as the screen names them**.
 *
 * Not by their ids, which is what these tests used to say. The design bars programmatic
 * identifiers from rendered text -- and an accessible name is rendered text, the only text some
 * readers get -- so every label on a criterion row now says what the attribute is called.
 *
 * These two are the id read as words rather than a catalog name: the mock's catalog carries an
 * entry for four attributes and this screen shows seven criteria, so most rows exercise the
 * fallback. Which is the path worth exercising, because it is the one that used to print a key.
 */
const ANCHORED = "Overcrowding rate";
const PLAIN = "Homicide rate";
/** The other criterion in the anchored one's pillar, whose weight is saved beside its rule. */
const NEIGHBOUR = "Housing cost overburden rate";

/**
 * Which pillar each of them is weighed inside.
 *
 * **A criterion lives inside a pillar, and the screen says so by keeping it there.** Its
 * weight is a share of the pillar's, so the way to reach one is to open the pillar -- which
 * is what these tests now do before touching a rule.
 */
const PILLAR_OF: Record<string, string> = {
  [ANCHORED]: "Housing",
  [PLAIN]: "Safety",
};

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

/** Opens the pillar an attribute is weighed inside, which is where its row lives. */
async function openThePillarOf(attribute: string): Promise<void> {
  const user = userEvent.setup();
  const pillar = PILLAR_OF[attribute]!;
  await user.click(
    await screen.findByRole("button", { name: new RegExp(`^${pillar}`) }),
  );
}

async function openTheRuleFor(attribute: string): Promise<void> {
  const user = userEvent.setup();
  renderShell("/configure");
  await settled();
  await openThePillarOf(attribute);
  await user.click(
    await screen.findByRole("button", {
      name: `Edit the rule for ${attribute}`,
    }),
  );
}

function ruleForm(attribute: string): HTMLElement {
  return screen.getByRole("form", { name: `The rule for ${attribute}` });
}

function goalSelect(): HTMLSelectElement {
  return screen.getByRole<HTMLSelectElement>("combobox", { name: "Goal" });
}

/** Focusable, saying it is unavailable, and taking no press: nothing to send or drop (UIC-G1). */
function expectUnavailable(control: HTMLElement): void {
  expect(control).toBeEnabled();
  expect(control).toHaveAttribute("aria-disabled", "true");
}

/** Long enough for a request the press might have sent to reach the mock server. */
function aMomentLater(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
}

describe("reading the rule a criterion already has", () => {
  it("is closed until asked for, because forty-one open scales is unreadable", async () => {
    renderShell("/configure");
    await settled();
    await openThePillarOf(PLAIN);

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
      screen.getByRole<HTMLInputElement>("textbox", {
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
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Threshold maximum",
      }).value,
    ).toBe("15");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
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
    // The row's own goal chip, re-rendered from the response rather than from the draft.
    await waitFor(() =>
      expect(screen.getByRole("group", { name: ANCHORED })).toHaveTextContent(
        "Higher is better",
      ),
    );
  });

  /**
   * UIC-G1. **Unavailable, not disabled**, so a keyboard user standing on Save or Discard is not
   * thrown onto the page when the draft becomes the stored rule again. A press then does nothing.
   */
  it("cannot be saved until something has changed", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    const writes = holdCriterionWrites();
    const save = screen.getByRole("button", { name: "Save rule" });

    expectUnavailable(save);
    expectUnavailable(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(save);
    await aMomentLater();

    expect(writes.sent).toEqual([]);
  });

  it("sends nothing when Enter is pressed in a field with nothing changed", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    const writes = holdCriterionWrites();
    act(() => screen.getByRole("textbox", { name: "Threshold maximum" }).focus());

    await user.keyboard("{Enter}");
    await aMomentLater();

    expect(writes.sent).toEqual([]);
  });

  it("adds and removes an anchor row without saving anything", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(PLAIN);

    await user.click(screen.getByRole("button", { name: "Add an anchor" }));

    expect(
      screen.getByRole("textbox", { name: `Anchor 1 value for ${PLAIN}` }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove anchor 1" }));

    expect(
      screen.queryByRole("textbox", { name: `Anchor 1 value for ${PLAIN}` }),
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
    // One half of a pair: a value with no score maps nothing.
    await user.clear(
      screen.getByRole("textbox", {
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
      await within(ruleForm(ANCHORED)).findByText(/this rule is not valid as written/i),
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
    await screen.findByText(/this rule is not valid as written/i);

    await waitFor(() => expect(goalSelect()).toHaveValue(stored));
  });

  it("discards a draft without sending it", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);

    await user.selectOptions(goalSelect(), "maximise");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(goalSelect().value).toBe("minimise");
    expectUnavailable(screen.getByRole("button", { name: "Save rule" }));
  });

  it("keeps an unsent draft when the weight on the same row is saved", async () => {
    // **A weight save is not this draft's save** (P82). The rule fields go back to the
    // stored rule once the save they were waiting on ends -- correct for a rule save, and
    // the flag they watched was set by every save on the row. So editing a goal and then
    // nudging the weight threw the edit away with nothing said, which is the one thing a
    // configuration screen must never do quietly.
    await openTheRuleFor(ANCHORED);
    const user = userEvent.setup();
    await user.selectOptions(goalSelect(), "maximise");

    // **Slowed on purpose.** The revert fires on the transition from saving to not saving, so
    // a save that resolves before React renders never exposes it -- the test would pass
    // against the bug. A delay makes the in-flight state real.
    mockServer.use(
      http.patch("/v1/criteria-sets/:id/criteria/:attribute", async () => {
        await delay(20);
        return HttpResponse.json({ pillar: "housing", criteria: [] });
      }),
    );

    const slider = screen.getByRole("slider", {
      name: `Weight for ${ANCHORED}`,
    });
    fireEvent.change(slider, { target: { value: "30" } });
    fireEvent.pointerUp(slider);
    // The save is in flight: the controls on the row are held while it is.
    await waitFor(() => expectHeld(slider));
    await waitFor(() =>
      expectNotHeld(screen.getByRole("button", { name: "Save rule" })),
    );

    expect(goalSelect().value).toBe("maximise");
  });
});


/**
 * PL-024 on the rule editor (C02-S1). The band, zero points, anchors and threshold were
 * `type="number"` boxes, which report text they cannot parse as "" -- and the form read "" as
 * "no bound", so "1,000" typed as a threshold cleared it in silence. They are the shared field
 * now: what was typed stays, and what cannot be read is refused on the box.
 */
describe("a figure typed into the rule", () => {
  it("keeps 1,000 as typed, refuses it on the box, and sends nothing", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    const writes = holdCriterionWrites();
    const threshold = screen.getByRole("textbox", { name: "Threshold maximum" });

    await user.clear(threshold);
    await user.type(threshold, "1,000");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    expect(threshold).toHaveValue("1,000");
    expect(threshold).toHaveAttribute("aria-invalid", "true");
    expect(threshold).toHaveAccessibleDescription(/a comma is not read/i);
    expect(await within(ruleForm(ANCHORED)).findByText(/^The threshold's maximum: /)).toBeInTheDocument();
    await aMomentLater();
    expect(writes.sent).toEqual([]);
  });

  it("sends a negative bound, since a figure may be below zero", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    const writes = holdCriterionWrites();

    await user.type(screen.getByRole("textbox", { name: "Zero below" }), "-5");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(writes.sent).toHaveLength(1));
    expect(writes.sent[0]?.body).toMatchObject({ zero_score_below: -5 });
    writes.release();
  });

  it("refuses a fraction as an anchor's score, on the box", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    const score = screen.getByRole("textbox", { name: `Anchor 1 score for ${ANCHORED}` });

    await user.clear(score);
    await user.type(score, "2.5");
    await user.tab();

    expect(score).toHaveAttribute("aria-invalid", "true");
    expect(score).toHaveAccessibleDescription(/a whole number, with no point/i);
  });

  it("reads the figures of a counted attribute as whole numbers", async () => {
    mockServer.use(
      http.get("/v1/attributes", () =>
        HttpResponse.json({
          items: [
            ...ATTRIBUTES,
            { ...ATTRIBUTES[0]!, id: "country.homicide_rate", name: PLAIN, value_type: "Count", unit: null },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    await openTheRuleFor(PLAIN);
    const threshold = screen.getByRole("textbox", { name: "Threshold minimum" });

    await user.type(threshold, "2.5");
    await user.tab();

    expect(threshold).toHaveAccessibleDescription(/a whole number, with no point/i);
  });

  it("offers each goal and method in words", async () => {
    await openTheRuleFor(ANCHORED);

    expect(
      within(goalSelect()).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Lower is better", "Higher is better", "Within a band"]);
    expect(
      within(screen.getByRole("combobox", { name: "Normalisation" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Against fixed anchors", "By percentile", "As published"]);
  });
});

/**
 * PL-026. **A refused rule is reported where it is, field by field**: inside the rule's own form,
 * from the fields the server names in `details.errors`, in the server's sentence and never its
 * code. The stored rule is shown again (P55), and what was asked for stays one click away.
 */
describe("a rule the server refuses", () => {
  async function aBackwardsBand(): Promise<void> {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    await user.selectOptions(goalSelect(), "target_range");
    await user.type(screen.getByRole("textbox", { name: "Band minimum" }), "30");
    await user.type(screen.getByRole("textbox", { name: "Band maximum" }), "10");
    await user.click(screen.getByRole("button", { name: "Save rule" }));
    expect(await within(ruleForm(ANCHORED)).findByRole("alert")).toHaveTextContent(
      /runs 30 to 10, which is backwards/,
    );
  }

  it("says why inside the rule's form, naming the attribute, with no code", async () => {
    await aBackwardsBand();
    const form = ruleForm(ANCHORED);

    expect(within(form).getByRole("alert")).toHaveTextContent(
      "the target range of Overcrowding rate runs 30 to 10, which is backwards",
    );
    expect(screen.queryByText(/invalid_criterion/)).not.toBeInTheDocument();
    expect(screen.queryByText(/country\.overcrowding_rate/)).not.toBeInTheDocument();
    // Nothing at the top of the pillar, where a weight's refusal goes.
    expect(screen.getAllByRole("alert").every((alert) => form.contains(alert))).toBe(true);
  });

  it("marks the fields it names, and only those", async () => {
    await aBackwardsBand();

    for (const name of ["Band minimum", "Band maximum"]) {
      const field = screen.getByRole("textbox", { name });
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(/which is backwards/);
    }
    expect(screen.getByRole("textbox", { name: "Zero below" })).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(goalSelect()).not.toHaveAttribute("aria-invalid", "true");
  });

  it("marks the goal and method when it is their combination it refuses", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    await user.selectOptions(goalSelect(), "target_range");
    await user.selectOptions(screen.getByRole("combobox", { name: "Normalisation" }), "percentile");
    await user.type(screen.getByRole("textbox", { name: "Band minimum" }), "5");
    await user.type(screen.getByRole("textbox", { name: "Band maximum" }), "10");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    expect(await within(ruleForm(ANCHORED)).findByRole("alert")).toHaveTextContent(
      /cannot express a band/,
    );
    expect(goalSelect()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("combobox", { name: "Normalisation" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("marks both threshold bounds when it refuses the threshold", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    await user.type(screen.getByRole("textbox", { name: "Threshold minimum" }), "50");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    expect(await within(ruleForm(ANCHORED)).findByRole("alert")).toHaveTextContent(
      "minimum 50 is above maximum 15",
    );
    for (const name of ["Threshold minimum", "Threshold maximum"]) {
      expect(screen.getByRole("textbox", { name })).toHaveAttribute("aria-invalid", "true");
    }
  });

  it("says a refusal about the anchors under them", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    const score = screen.getByRole("textbox", { name: `Anchor 1 score for ${ANCHORED}` });
    await user.clear(score);
    await user.type(score, "150");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    const anchors = screen.getByRole("group", { name: "Scale anchors" });
    expect(
      await within(anchors).findByText(/the score scale stops at 100/),
    ).toBeInTheDocument();
  });

  it("shows the stored rule, says what was asked for, and puts it back on request", async () => {
    const user = userEvent.setup();
    await aBackwardsBand();

    await waitFor(() => expect(goalSelect()).toHaveValue("minimise"));
    expect(screen.getByRole("textbox", { name: "Band minimum" })).toHaveValue("");
    expect(within(ruleForm(ANCHORED)).getByText(/^You asked for: /)).toHaveTextContent(
      "You asked for: within a band, against fixed anchors; a band from 30 to 10; 2 anchors; " +
        "a threshold of at most 15.",
    );

    await user.click(screen.getByRole("button", { name: "Put my values back" }));

    expect(goalSelect()).toHaveValue("target_range");
    expect(screen.getByRole("textbox", { name: "Band minimum" })).toHaveValue("30");
    expect(screen.getByRole("textbox", { name: "Band maximum" })).toHaveValue("10");
    // Back, so nothing is left to put back -- and the reason stays until the rule is sent again.
    expect(screen.queryByRole("button", { name: "Put my values back" })).not.toBeInTheDocument();
    expect(within(ruleForm(ANCHORED)).getByRole("alert")).toHaveTextContent(/which is backwards/);
  });

  it("clears a field's mark when that field is typed in, and only that one", async () => {
    const user = userEvent.setup();
    await aBackwardsBand();
    await user.click(screen.getByRole("button", { name: "Put my values back" }));

    await user.clear(screen.getByRole("textbox", { name: "Band minimum" }));
    await user.type(screen.getByRole("textbox", { name: "Band minimum" }), "5");

    expect(screen.getByRole("textbox", { name: "Band minimum" })).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(screen.getByRole("textbox", { name: "Band maximum" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("forgets the refusal once the rule is sent again and stored", async () => {
    const user = userEvent.setup();
    await aBackwardsBand();
    await user.click(screen.getByRole("button", { name: "Put my values back" }));
    await user.clear(screen.getByRole("textbox", { name: "Band maximum" }));
    await user.type(screen.getByRole("textbox", { name: "Band maximum" }), "40");

    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() =>
      expect(within(ruleForm(ANCHORED)).queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: "Band maximum" })).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(screen.getByRole("group", { name: ANCHORED })).toHaveTextContent("Within a band");
  });

  it("says a refusal that names no field in words, inside the form, with no code", async () => {
    mockServer.use(
      http.patch("/v1/criteria-sets/:id/criteria/:attribute", () =>
        HttpResponse.json({ code: "internal_error", message: "Something broke on the server." }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    await user.selectOptions(goalSelect(), "maximise");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    expect(
      await within(ruleForm(ANCHORED)).findByText("The server failed while answering."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something broke on the server.")).not.toBeInTheDocument();
    expect(screen.queryByText("internal_error")).not.toBeInTheDocument();
  });

  it("keeps the refusal when the rule's editor is closed and opened again", async () => {
    const user = userEvent.setup();
    await aBackwardsBand();
    const toggle = screen.getByRole("button", { name: `Close the rule for ${ANCHORED}` });

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: `Edit the rule for ${ANCHORED}` }));

    expect(within(ruleForm(ANCHORED)).getByRole("alert")).toHaveTextContent(/which is backwards/);
  });
});

/**
 * Every write to a criterion, recorded with the attribute it was for, held until the test lets
 * go and then answered by the stateful mock behind this one.
 */
function holdCriterionWrites(): {
  sent: { attribute: string; body: unknown }[];
  release: () => void;
} {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: { attribute: string; body: unknown }[] = [];
  mockServer.use(
    http.patch(
      "/v1/criteria-sets/:id/criteria/:attribute",
      async ({ params, request }) => {
        sent.push({
          attribute: String(params["attribute"]),
          body: await request.clone().json(),
        });
        await held;
      },
    ),
  );
  return { sent, release: () => release() };
}

/** An anchor's figure field, which is how many anchors the rule holds can be counted. */
function anchorValues(): HTMLElement[] {
  return screen.getAllByRole("textbox", { name: /^Anchor \d+ value for/ });
}

/**
 * UI-06. **A rule's fields follow the stored rule once its save ends**, so anything typed while
 * it is in flight would be thrown away when the answer lands. They are held still instead --
 * held rather than disabled (NEW-34), so a keyboard is not thrown off them, and taking no input.
 */
describe("a rule while it is being saved", () => {
  it("holds the rule's fields still while it is being saved", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    await user.selectOptions(goalSelect(), "maximise");
    const writes = holdCriterionWrites();

    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expectHeld(goalSelect()));
    expectHeld(screen.getByRole("combobox", { name: "Normalisation" }));
    const blocks = screen.getByRole("checkbox", {
      name: "Missing figure blocks scoring",
    });
    expectHeld(blocks);
    // A group says it is held; its fields carry the look, so the group is not faded twice.
    for (const group of ["Target band", "Scale anchors", "Matching threshold"]) {
      expect(screen.getByRole("group", { name: group })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    const bandMinimum = screen.getByRole("textbox", { name: "Band minimum" });
    const threshold = screen.getByRole("textbox", {
      name: "Threshold maximum",
    });
    for (const field of [bandMinimum, anchorValues()[0]!, threshold]) {
      expectHeld(field);
      expect(field).toHaveAttribute("readonly");
    }
    expectHeld(screen.getByRole("button", { name: "Add an anchor" }));
    expectHeld(screen.getByRole("button", { name: "Remove anchor 1" }));
    expectHeld(screen.getByRole("button", { name: "Discard changes" }));

    // Held, they still take a pointer and a keyboard -- and do nothing with either.
    await user.selectOptions(goalSelect(), "minimise");
    await user.click(blocks);
    await user.type(bandMinimum, "5");
    await user.click(screen.getByRole("button", { name: "Add an anchor" }));
    await user.click(screen.getByRole("button", { name: "Remove anchor 1" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(goalSelect()).toHaveValue("maximise");
    expect(blocks).not.toBeChecked();
    expect(bandMinimum).toHaveValue("");
    expect(anchorValues()).toHaveLength(2);

    writes.release();

    await waitFor(() => expectNotHeld(goalSelect()));
    expectNotHeld(threshold);
    expect(threshold).not.toHaveAttribute("readonly");
    expectNotHeld(screen.getByRole("group", { name: "Matching threshold" }));
    expect(writes.sent).toHaveLength(1);
  });

  it("does nothing at all when a held Save is pressed, not even list what is wrong", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    await user.clear(
      screen.getByRole("textbox", { name: `Anchor 1 score for ${ANCHORED}` }),
    );
    const writes = holdCriterionWrites();
    const neighbour = screen.getByRole("slider", {
      name: `Weight for ${NEIGHBOUR}`,
    });
    fireEvent.change(neighbour, { target: { value: "65" } });
    fireEvent.pointerUp(neighbour);
    await waitFor(() => expect(writes.sent).toHaveLength(1));
    const save = screen.getByRole("button", { name: "Save rule" });
    expectHeld(save);

    await user.click(save);

    expect(
      screen.queryByText("Anchor 1 needs both a value and a score."),
    ).not.toBeInTheDocument();
    writes.release();
    await waitFor(() => expectNotHeld(save));
    // Let go, the same press says what is wrong with the draft -- and still sends nothing.
    await user.click(save);
    expect(
      await screen.findByText("Anchor 1 needs both a value and a score."),
    ).toBeInTheDocument();
    expect(writes.sent).toHaveLength(1);
  });

  /**
   * NEW-34. **Held, never disabled.** Chromium throws focus off a control the moment it is
   * disabled -- a field inside a disabled fieldset included -- and does not give it back, so a
   * keyboard user who saved a rule with Enter landed on the page and had to find their way back.
   * jsdom keeps focus on a disabled control, which is why these follow Chromium's rule instead.
   */
  describe("from the keyboard", () => {
    beforeEach(() => followChromiumFocusFixup());

    it("keeps focus on Save while the rule is saved, and a second Enter sends nothing", async () => {
      const user = userEvent.setup();
      await openTheRuleFor(ANCHORED);
      // A change the server stores: "maximise" would be refused, its anchors falling (PL-026).
      await user.click(screen.getByRole("checkbox", { name: "Missing figure blocks scoring" }));
      const writes = holdCriterionWrites();
      const save = screen.getByRole("button", { name: "Save rule" });
      act(() => save.focus());

      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(save).toHaveFocus();
      expectHeld(save);
      expect(save).toHaveTextContent("Saving…");
      await user.keyboard("{Enter}");

      writes.release();

      // Nothing is left to save once it has, and focus stays where Enter put it (UIC-G1).
      await waitFor(() => expect(save).toHaveTextContent("Save rule"));
      expect(save).toHaveFocus();
      expectUnavailable(save);
      expect(writes.sent).toEqual([
        {
          attribute: "country.overcrowding_rate",
          body: expect.objectContaining({ blocks_if_missing: true }),
        },
      ]);
    });

    it("keeps focus on Discard once it has thrown the draft away", async () => {
      const user = userEvent.setup();
      await openTheRuleFor(ANCHORED);
      await user.selectOptions(goalSelect(), "maximise");
      const discard = screen.getByRole("button", { name: "Discard changes" });
      act(() => discard.focus());

      await user.keyboard("{Enter}");

      expect(goalSelect().value).toBe("minimise");
      expect(discard).toHaveFocus();
      expectUnavailable(discard);
    });

    it("keeps focus in a field that Enter saved from, and takes no typing until the answer", async () => {
      const user = userEvent.setup();
      await openTheRuleFor(ANCHORED);
      const writes = holdCriterionWrites();
      const threshold = screen.getByRole("textbox", {
        name: "Threshold maximum",
      });
      await user.clear(threshold);
      await user.type(threshold, "12");

      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(threshold).toHaveFocus();
      expectHeld(threshold);
      expect(threshold).toHaveAttribute("readonly");
      await user.keyboard("3");
      expect(threshold).toHaveValue("12");

      writes.release();

      await waitFor(() => expect(threshold).not.toHaveAttribute("readonly"));
      expectNotHeld(threshold);
      expect(threshold).toHaveFocus();
      await user.clear(threshold);
      await user.type(threshold, "9");
      expect(threshold).toHaveValue("9");
    });

    it("keeps focus on Save while another write is in flight, and sends the rule once it has answered", async () => {
      const user = userEvent.setup();
      await openTheRuleFor(ANCHORED);
      await user.click(screen.getByRole("checkbox", { name: "Missing figure blocks scoring" }));
      const save = screen.getByRole("button", { name: "Save rule" });
      act(() => save.focus());
      const writes = holdCriterionWrites();

      // The weight beside it, saved by a pointer while the keyboard waits on Save.
      const neighbour = screen.getByRole("slider", {
        name: `Weight for ${NEIGHBOUR}`,
      });
      fireEvent.change(neighbour, { target: { value: "65" } });
      fireEvent.pointerUp(neighbour);
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(save).toHaveFocus();
      expectHeld(save);
      await user.keyboard("{Enter}");

      writes.release();

      await waitFor(() => expectNotHeld(save));
      expect(save).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(2));
      expect(writes.sent).toEqual([
        {
          attribute: "country.housing_cost_overburden_rate",
          body: { weight: 65 },
        },
        {
          attribute: "country.overcrowding_rate",
          body: expect.objectContaining({ blocks_if_missing: true }),
        },
      ]);
    });

    it("lets go of every field after a refused rule, with focus where it was", async () => {
      mockServer.use(
        http.patch("/v1/criteria-sets/:id/criteria/:attribute", () =>
          HttpResponse.json(
            { code: "invalid_criterion", message: "cannot express a band" },
            { status: 422 },
          ),
        ),
      );
      const user = userEvent.setup();
      await openTheRuleFor(ANCHORED);
      const threshold = screen.getByRole("textbox", {
        name: "Threshold maximum",
      });
      await user.clear(threshold);
      await user.type(threshold, "12");

      await user.keyboard("{Enter}");

      expect(await screen.findByText(/this rule is not valid as written/i)).toBeInTheDocument();
      await waitFor(() => expect(threshold).not.toHaveAttribute("readonly"));
      expectNotHeld(threshold);
      expectNotHeld(screen.getByRole("group", { name: "Matching threshold" }));
      expect(threshold).toHaveFocus();
      // The stored rule is back on screen, as it is after any refusal: nothing to save until the
      // next edit (UIC-G1), and the next edit can be saved -- Save was let go, not held.
      await waitFor(() => expect(threshold).toHaveValue("15"));
      const save = screen.getByRole("button", { name: "Save rule" });
      expectUnavailable(save);
      await user.clear(threshold);
      await user.type(threshold, "13");
      expectNotHeld(save);
    });
  });
});

/** PL-025 (UF-054, D8, C02-S3). The rule form says whether what it shows is stored. */
describe("a rule's save state", () => {
  // T25-9. Mounted empty before the save, so its word is announced (NEW-42).
  it("says Saved. in a status region that was there before the save, and an edit takes it back", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(PLAIN);
    const form = within(ruleForm(PLAIN));
    const status = form.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    await user.selectOptions(goalSelect(), "maximise");
    expect(form.getByText("Not saved yet")).toBeInTheDocument();
    await user.click(form.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(status).toHaveTextContent("Saved."));
    expect(form.queryByText("Not saved yet")).toBeNull();

    await user.selectOptions(goalSelect(), "minimise");
    expect(status).toBeEmptyDOMElement();
    expect(form.getByText("Not saved yet")).toBeInTheDocument();
  });

  // T25-6 (D8, R1).
  it("keeps an unsaved goal through closing the pillar, and marks it on the closed editor", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    await user.selectOptions(goalSelect(), "maximise");

    await user.click(screen.getByRole("button", { name: `Close the rule for ${ANCHORED}` }));
    const row = within(screen.getByRole("group", { name: ANCHORED }));
    expect(row.getByText("Not saved yet")).toBeInTheDocument();
    await openThePillarOf(ANCHORED);
    await openThePillarOf(ANCHORED);
    await user.click(
      await screen.findByRole("button", { name: `Edit the rule for ${ANCHORED}` }),
    );

    expect(goalSelect()).toHaveValue("maximise");
  });

  it("keeps an unsaved goal through switching to another set and back", async () => {
    const user = userEvent.setup();
    await openTheRuleFor(ANCHORED);
    await user.selectOptions(goalSelect(), "maximise");
    const sets = screen.getByRole<HTMLSelectElement>("combobox", { name: /active criteria set/i });

    await user.selectOptions(sets, "remote_only");
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Goal" })).toBeNull());
    await user.selectOptions(sets, "default");
    await settled();
    await openThePillarOf(ANCHORED);
    await user.click(
      await screen.findByRole("button", { name: `Edit the rule for ${ANCHORED}` }),
    );

    expect(goalSelect()).toHaveValue("maximise");
  });
});
