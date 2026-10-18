import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
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

function goalSelect(): HTMLSelectElement {
  return screen.getByRole<HTMLSelectElement>("combobox", { name: "Goal" });
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
    // The row's own goal chip, re-rendered from the response rather than from the draft.
    await waitFor(() =>
      expect(screen.getByRole("group", { name: ANCHORED })).toHaveTextContent(
        "goal: maximise",
      ),
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
  return screen.getAllByRole("spinbutton", { name: /^Anchor \d+ value for/ });
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
    for (const group of ["Target band", "Scale anchors", "Matching threshold"]) {
      expectHeld(screen.getByRole("group", { name: group }));
    }
    const bandMinimum = screen.getByRole("spinbutton", { name: "Band minimum" });
    const threshold = screen.getByRole("spinbutton", {
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
    expect(bandMinimum).toHaveValue(null);
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
      screen.getByRole("spinbutton", { name: `Anchor 1 score for ${ANCHORED}` }),
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
      await user.selectOptions(goalSelect(), "maximise");
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

      await waitFor(() => expectNotHeld(save));
      // Nothing is left to save once it has: the one reason Save is ever disabled outright.
      expect(save).toBeDisabled();
      expect(writes.sent).toEqual([
        {
          attribute: "country.overcrowding_rate",
          body: expect.objectContaining({ goal: "maximise" }),
        },
      ]);
    });

    it("keeps focus in a field that Enter saved from, and takes no typing until the answer", async () => {
      const user = userEvent.setup();
      await openTheRuleFor(ANCHORED);
      const writes = holdCriterionWrites();
      const threshold = screen.getByRole("spinbutton", {
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
      expect(threshold).toHaveValue(12);

      writes.release();

      await waitFor(() => expect(threshold).not.toHaveAttribute("readonly"));
      expectNotHeld(threshold);
      expect(threshold).toHaveFocus();
      await user.clear(threshold);
      await user.type(threshold, "9");
      expect(threshold).toHaveValue(9);
    });

    it("keeps focus on Save while another write is in flight, and sends the rule once it has answered", async () => {
      const user = userEvent.setup();
      await openTheRuleFor(ANCHORED);
      await user.selectOptions(goalSelect(), "maximise");
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
          body: expect.objectContaining({ goal: "maximise" }),
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
      const threshold = screen.getByRole("spinbutton", {
        name: "Threshold maximum",
      });
      await user.clear(threshold);
      await user.type(threshold, "12");

      await user.keyboard("{Enter}");

      expect(await screen.findByText(/cannot express a band/i)).toBeInTheDocument();
      await waitFor(() => expect(threshold).not.toHaveAttribute("readonly"));
      expectNotHeld(threshold);
      expectNotHeld(screen.getByRole("group", { name: "Matching threshold" }));
      expectNotHeld(screen.getByRole("button", { name: "Save rule" }));
      expect(threshold).toHaveFocus();
      // The stored rule is back on screen, as it is after any refusal.
      await waitFor(() => expect(threshold).toHaveValue(15));
    });
  });
});
