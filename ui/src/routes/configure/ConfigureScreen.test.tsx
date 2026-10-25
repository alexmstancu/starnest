import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { fetchLevels, type Criterion } from "../../api/endpoints";
import { makeCriteriaSetDetails } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
  pressArrowRight,
} from "../../testing/keyboard";
import {
  COUNTRY_GATES,
  gatesAsked,
  watchResearch,
} from "../../testing/research";
import { renderShell } from "../../testing/renderShell";

/**
 * The weight editor.
 *
 * The behaviour under test is narrow and the whole point: **the screen sends one weight and
 * shows what the server made of the pillar**. So the assertions are about what arrived back,
 * never about a number this code worked out -- there is no such number.
 */

/**
 * What each criterion is called on screen.
 *
 * **Not the ids these tests used to name.** The design bars programmatic identifiers from
 * rendered text -- and an accessible name is rendered text, the only text some readers get --
 * so every row, slider and lock here is found by what the attribute is called.
 *
 * Two come from the catalog and the rest are the id read as words, because the mock's catalog
 * answers for five attributes and this screen shows seven criteria. The tax rate shows why the
 * catalog is the authority and the formatter only a fallback: its name puts the words in
 * another order than its id does.
 */
const COST_OF_LIVING = "Cost of living index";
const TAX = "Total effective tax rate";
const OUTLOOK = "Economic outlook";
const OVERBURDEN = "Housing cost overburden rate";
const OVERCROWDING = "Overcrowding rate";
const HOMICIDE = "Homicide rate";
const PERCEIVED_SAFETY = "Perceived safety index";
const BROADBAND = "Broadband coverage";
const UNSOURCED_ATTRIBUTE = "Nobody measures this";

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
  if (screen.queryByRole("slider", named) !== null) return;

  const weights = await screen.findByRole("region", { name: "Pillar weights" });
  // The pillar rows only: an opened pillar puts a group of its own around every criterion
  // inside it, and clicking one of those would close the pillar this loop just opened.
  //
  // **Found by the shape of the slider's label, not by the shape of the row's.** This asked
  // whether the row's name had a dot in it, which told a pillar from an attribute only while
  // the attributes were named by their keys. A pillar's slider is "Economy weight" and a
  // criterion's is "Weight for Economic outlook", and that distinction is about what the
  // control is rather than about what it happens to be called.
  const pillars = (await within(weights).findAllByRole("slider"))
    .map((slider) => slider.getAttribute("aria-label") ?? "")
    .filter((label) => label.endsWith(" weight"))
    .map((label) => label.slice(0, -" weight".length));
  for (const pillar of pillars) {
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(`^${pillar}`) }),
    );
    if (screen.queryByRole("slider", named) !== null) return;
  }
}

/**
 * A criterion's lock, opening the pillar it lives in first.
 *
 * **A button that is pressed or not, never a checkbox.** The design draws a disc, and a
 * checkbox cannot be one without hiding behind a label -- the shape that shipped a lock
 * nobody could click (P52).
 */
async function findLockAnywhere(attribute: string): Promise<HTMLElement> {
  await openThePillarOf(attribute);
  return screen.getByRole("button", {
    name: `Lock the weight for ${attribute}`,
  });
}

async function weightSlider(attribute: string): Promise<HTMLInputElement> {
  await openThePillarOf(attribute);
  return await screen.findByRole("slider", {
    name: `Weight for ${attribute}`,
  });
}

/**
 * The weight the row currently shows, read synchronously.
 *
 * **Never call `weightSlider` inside a `waitFor`.** `findByRole` is itself a retry loop with
 * its own one-second budget, so nesting the two means each `waitFor` attempt can spend a
 * second in the inner one -- five real attempts out of a five-second budget, which passes
 * alone and times out under load. `getByRole` throws at once and lets `waitFor` poll at its
 * own interval.
 */
function shownWeight(attribute: string): string {
  return screen.getByRole<HTMLInputElement>("slider", {
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

/**
 * Moves a weight and lets go, which is the whole gesture.
 *
 * **Dragging shows; letting go sends.** A range input fires `change` on every pixel of a
 * drag, so the row commits when the pointer lifts -- and so does this, rather than reaching
 * past the control to the request.
 */
async function saveWeight(attribute: string, weight: string): Promise<void> {
  const slider = await weightSlider(attribute);
  await settled();

  fireEvent.change(slider, { target: { value: weight } });
  fireEvent.pointerUp(slider);
}

/** The rail that lists what this session changed. */
async function historyPanel() {
  return within(await screen.findByRole("region", { name: /^recent changes/i }));
}

/** The sidebar's set picker: how a reader moves from one criteria set to another. */
function activeSet(): HTMLSelectElement {
  return screen.getByRole<HTMLSelectElement>("combobox", {
    name: /active criteria set/i,
  });
}

/**
 * Moves to another set through the sidebar and waits for it to arrive.
 *
 * **Through the picker, which is an event**, so the screen has started loading the new set by
 * the time this returns and `settled` has something real to wait for.
 */
async function chooseSet(id: string): Promise<void> {
  await userEvent.selectOptions(activeSet(), id);
  await settled();
}

/**
 * Duplicates Default and leaves its copy shown -- a second set holding the same attributes,
 * which is the case where a change meant for one could land in the other.
 *
 * The duplicate selects its copy from its own answer rather than from an event, so the screen
 * is then moved away and back through the sidebar: what that leaves on screen is known.
 */
async function duplicateDefault(): Promise<string> {
  await userEvent.click(
    within(await screen.findByRole("listitem", { name: "Default" })).getByRole(
      "button",
      { name: "Duplicate" },
    ),
  );
  // The copy's identifier is the one this tab chose for it (PL-033), read off the sidebar.
  await waitFor(() => expect(activeSet().value).toMatch(/^default_copy_\w+$/));
  const copy = activeSet().value;
  await chooseSet("default");
  await chooseSet(copy);
  return copy;
}

/**
 * What one row reads beside its slider.
 *
 * **Read off the reading, not the slider**, because the reading is drawn in the same render as
 * whatever changed it, while the slider follows a render later -- an assertion on the slider
 * can pass in the gap before a wrong answer reaches it.
 */
function readingOf(attribute: string): string {
  return (
    within(screen.getByRole("group", { name: attribute })).getByText(/%$/)
      .textContent ?? ""
  );
}

/**
 * Holds every criterion write until the test lets go, then lets the mock answer it as usual.
 *
 * **Returning nothing hands the request on** to the next handler, which is the mock's own
 * stateful one -- so what arrives after the release is what the server would have said, and
 * what the screen does in between is what it does while a save is in flight.
 */
function holdCriterionWrites(): { sent: string[]; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: string[] = [];
  mockServer.use(
    http.patch(
      "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
      async ({ params }) => {
        sent.push(
          `${String(params["criteriaSetId"])}/${String(params["attributeId"])}`,
        );
        await held;
      },
    ),
  );
  return { sent, release: () => release() };
}

/**
 * Holds every write of one kind under a criteria set until released, then lets the mock's own
 * handler answer it -- so the mock's set changes only once the write is let go.
 */
function holdSetWrites(
  method: "put" | "patch",
  path: string,
): { sent: string[]; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: string[] = [];
  const on = method === "put" ? http.put : http.patch;
  mockServer.use(
    on(path, async ({ params }) => {
      sent.push(String(params["criteriaSetId"]));
      await held;
    }),
  );
  return { sent, release: () => release() };
}

describe("the criteria list", () => {
  /**
   * **Inside its pillar, not beside it.** A criterion's weight is a share of its pillar's, so
   * opening the pillar is what reveals the attributes sharing that hundred -- and the pillar
   * is then the row above rather than a column repeated down every row.
   */
  it("shows every criterion in a pillar with its weight, once the pillar is open", async () => {
    renderShell("/configure");

    expect(await weightSlider(COST_OF_LIVING)).toHaveValue("50");
    expect(await weightSlider(TAX)).toHaveValue(
      "30",
    );

    await weightSlider(HOMICIDE);
    const row = screen.getByRole("group", { name: HOMICIDE });
    expect(row).toHaveTextContent(HOMICIDE);
    // The pillar names the block these rows are in, so the row itself no longer repeats it.
    expect(row).not.toHaveTextContent("safety");
    expect(
      screen.getByRole("button", { name: /^Safety/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  /**
   * **The rule in words, before it is opened for editing.** A criterion is one sentence about
   * one attribute -- which way is better, what rules a candidate out, how it is scaled -- and
   * a row that showed only a number would make the reader open every rule to read the set.
   */
  it("says what each criterion's rule is, and what the attribute measures", async () => {
    renderShell("/configure");
    await weightSlider(COST_OF_LIVING);

    const row = screen.getByRole("group", {
      name: COST_OF_LIVING,
    });
    expect(row).toHaveTextContent("Lower is better");
    expect(row).toHaveTextContent("scored by percentile");
    expect(row).toHaveTextContent("no threshold");
    // From the catalog, not the criterion: what the figure is is a fact about the attribute.
    expect(row).toHaveTextContent("Measured in EU27 = 100");
  });

  /**
   * The two facts a weight cannot carry. **A weight on an attribute nothing answers is a
   * share of the pillar going nowhere**, and one whose absence blocks costs the candidate its
   * whole score -- both are worth knowing before the weight is chosen rather than after a run
   * has come back empty.
   */
  it("says when nothing would ever fill an attribute, and when its absence blocks", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () =>
        HttpResponse.json({
          id: "default",
          name: "Default",
          pillar_weights: [
            { pillar: "family", weight: 100, weight_locked: false },
          ],
          // In the catalog with every source in its priority and none able to fetch it, which
          // is the case this row exists to show.
          criteria: [
            {
              attribute: "country.nobody_measures_this",
              pillar: "family",
              weight: 100,
              goal: "maximise",
              normalisation_method: "fixed",
              blocks_if_missing: true,
            },
          ],
        }),
      ),
    );
    renderShell("/configure");
    await weightSlider(UNSOURCED_ATTRIBUTE);

    const row = screen.getByRole("group", {
      name: UNSOURCED_ATTRIBUTE,
    });
    expect(row).toHaveTextContent("No source yet");
    expect(row).toHaveTextContent("Required");
  });

  it("follows the criteria set chosen in the sidebar", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await weightSlider(COST_OF_LIVING);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /active criteria set/i }),
      "remote_only",
    );

    expect(await weightSlider(BROADBAND)).toHaveValue("70");
    expect(
      screen.queryByRole("slider", {
        name: `Weight for ${COST_OF_LIVING}`,
      }),
    ).not.toBeInTheDocument();
  });
});

describe("changing a weight", () => {
  it("shows the weights the server rebalanced to, not a local calculation", async () => {
    renderShell("/configure");

    await saveWeight(COST_OF_LIVING, "40");

    // The unlocked sibling absorbed the whole change; the locked one did not move. Both
    // figures came back from the PATCH.
    await waitFor(() =>
      expect(shownWeight(TAX)).toBe("40"),
    );
    expect(shownWeight(COST_OF_LIVING)).toBe("40");
    expect(shownWeight(OUTLOOK)).toBe("20");
  });

  /**
   * **One pillar is open at a time**, as the design has it, so the other pillar's weights are
   * read by opening it -- which is also the honest test: the rebalance has to have left them
   * alone on the server, not merely off screen.
   */
  it("leaves the other pillars alone", async () => {
    renderShell("/configure");

    await saveWeight(COST_OF_LIVING, "40");

    await waitFor(() =>
      expect(shownWeight(TAX)).toBe("40"),
    );
    expect(
      await weightSlider(OVERBURDEN),
    ).toHaveValue("60");
  });

  it("shows the refusal, and which locks caused it, when nothing can absorb the change", async () => {
    renderShell("/configure");

    await saveWeight(HOMICIDE, "80");

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("weights_all_locked");
    expect(alert).toHaveTextContent(/every other weight here is locked/i);

    // Scoped to the list: every attribute id here is also a row heading in the table above, so
    // an unscoped query matches twice and proves nothing about the refusal.
    const locks = within(await screen.findByRole("list", { name: /locked/i }));
    expect(
      locks.getByText(PERCEIVED_SAFETY),
    ).toBeInTheDocument();
  });

  it("keeps showing the stored weight after a refusal, because it was not changed", async () => {
    renderShell("/configure");

    await saveWeight(HOMICIDE, "80");

    await screen.findByRole("alert");
    // The refusal and the stored weight reach the screen through the write gate one render
    // apart, so the weight is waited for rather than read once beside the alert.
    await waitFor(() => expect(shownWeight(HOMICIDE)).toBe("65"));
  });

  it("reports a failed save rather than letting it look like it worked", async () => {
    mockServer.use(
      http.patch("/v1/criteria-sets/:id/criteria/:attribute", () =>
        HttpResponse.error(),
      ),
    );
    renderShell("/configure");

    await saveWeight(COST_OF_LIVING, "40");

    expect(await screen.findByText(/backend did not answer/i)).toBeInTheDocument();
    expect(screen.queryByText("client.unreachable")).toBeNull();
  });

  /**
   * **There is deliberately no test here for a weight that is not a number**, and the reason
   * is worth writing down so nobody puts one back. A range input cannot hold one: jsdom
   * replaces nonsense with the midpoint of the track before React's `onChange` fires, so the
   * row is handed a number whatever the test typed -- and when that midpoint happens to be the
   * weight already stored, `commit` finds nothing moved and sends nothing. A test asserting
   * "nothing was sent" then passes for the wrong reason and goes on passing with the guard
   * deleted, which is what the one that stood here did (mutation-proved 2026-10-04).
   *
   * The guard lives in `weightFrom`, and four tests in `weights.test.ts` and
   * `useWeightDrag.test.ts` go red when it is removed. What is still worth asserting through
   * the screen is that an unmoved weight sends nothing, which is the test below.
   */

  /** Letting go without having moved is not a change, and a PATCH would rebalance a pillar
      to the weights it already holds. */
  it("sends nothing when the weight was not actually moved", async () => {
    const sent: string[] = [];
    mockServer.use(
      http.patch(
        "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
        ({ params }) => {
          sent.push(String(params["attributeId"]));
          return HttpResponse.json({ pillar: "economics", criteria: [] });
        },
      ),
    );
    renderShell("/configure");
    const slider = await weightSlider(COST_OF_LIVING);
    await settled();

    fireEvent.pointerUp(slider);

    expect(sent).toEqual([]);
  });
});

describe("when the criteria set cannot be shown", () => {
  it("says inside stage 3 why the set is not there, and reads it again when asked", async () => {
    let reads = 0;
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () => {
        reads += 1;
        return HttpResponse.json(
          { code: "not_found", message: "No such criteria set." },
          { status: 404 },
        );
      }),
    );
    renderShell("/configure");

    const weights = within(
      await screen.findByRole("region", { name: "Pillar weights" }),
    );
    expect(
      await weights.findByText("The criteria set could not be loaded"),
    ).toBeInTheDocument();
    expect(weights.getByText(/not there any more/i)).toBeInTheDocument();
    expect(screen.queryByText("No such criteria set.")).not.toBeInTheDocument();
    // The code is for branching on and is never printed (M3).
    expect(screen.queryByText("not_found")).not.toBeInTheDocument();

    const before = reads;
    await userEvent.click(weights.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(reads).toBe(before + 1));
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
    // No set at all: the card that offers to create one (PL-011).
    expect(
      await configure.findByRole("region", { name: "No criteria set yet" }),
    ).toBeInTheDocument();
  });
});

/**
 * UX review G. `CriterionInput` has carried `weight_locked` all along and the screen never
 * sent it, so the pillar-weight rule existed one level up and not here.
 */
describe("locking a criterion's weight", () => {
  // `settled()` waits for the last panel to arrive, which can happen before the criteria
  // rows do -- so the first read of a row has to be a `findBy`, as `saveWeight` already is.
  async function findLock(attribute: string): Promise<HTMLElement> {
    await openThePillarOf(attribute);
    return screen.findByRole("button", {
      name: `Lock the weight for ${attribute}`,
    });
  }

  function lockFor(attribute: string): HTMLElement {
    return screen.getByRole("button", {
      name: `Lock the weight for ${attribute}`,
    });
  }


  it("draws each lock as a padlock, shut or open as the set says, never a disc", async () => {
    renderShell("/configure");
    await settled();

    const locked = await findLock(OUTLOOK);
    expect(locked.querySelector("svg")).toHaveAttribute("data-state", "shut");
    expect(lockFor(COST_OF_LIVING).querySelector("svg")).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(locked).toHaveTextContent(/^$/);
  });

  it("shows which criteria are locked, as the set says", async () => {
    renderShell("/configure");
    await settled();

    expect(await findLock(OUTLOOK)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(lockFor(COST_OF_LIVING)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("locks a weight, and the lock stays on", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();

    await user.click(await findLock(COST_OF_LIVING));

    await waitFor(() =>
      expect(lockFor(COST_OF_LIVING)).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  /** A lock holds its weight where it is: a rebalance must route around it. */
  it("leaves a locked sibling's weight untouched when another moves", async () => {
    renderShell("/configure");
    await settled();
    await weightSlider(OUTLOOK);
    expect(shownWeight(OUTLOOK)).toBe("20");

    await saveWeight(COST_OF_LIVING, "40");

    await waitFor(() =>
      expect(shownWeight(TAX)).not.toBe("30"),
    );
    expect(shownWeight(OUTLOOK)).toBe("20");
  });

  it("refuses a change when every other weight in the pillar is locked", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();

    // Lock the one unlocked sibling, leaving nowhere for a change to be absorbed.
    await user.click(await findLock(TAX));
    await waitFor(() =>
      expect(lockFor(TAX)).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    await saveWeight(COST_OF_LIVING, "40");

    // The client's own wording, not the server's: `errorPresentation` words the refusal from
    // its reason, which is the sentence a reader sees.
    expect(
      await screen.findByText(/every other weight here is locked/i),
    ).toBeInTheDocument();
  });

  /**
   * **A refusal describes the locks it was answered under, so it goes when they do** (UF-035).
   * Unlocking from the row clears it on the way out; an undo in Recent changes moves the lock
   * without passing through the row, which is how the banner used to outlive its cause.
   */
  it("clears the refusal once a lock it was about is undone from Recent changes", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    await user.click(await findLockAnywhere(TAX));
    const panel = await historyPanel();
    await panel.findByText(/Locked Total effective tax rate/);

    await saveWeight(COST_OF_LIVING, "40");
    expect(
      await screen.findByText(/every other weight here is locked/i),
    ).toBeInTheDocument();

    await user.click(panel.getByRole("button", { name: "Undo this" }));

    await waitFor(() =>
      expect(screen.queryByText(/every other weight here is locked/i)).toBeNull(),
    );
    expect(lockFor(TAX)).toHaveAttribute("aria-pressed", "false");
  });

  /** One editor serves whichever pillar is open, so its refusal must stay with its own. */
  it("keeps a pillar's refusal inside that pillar", async () => {
    renderShell("/configure");
    await saveWeight(HOMICIDE, "80");
    expect(
      await screen.findByText(/every other weight here is locked/i),
    ).toBeInTheDocument();

    await openThePillarOf(COST_OF_LIVING);

    expect(screen.queryByText(/every other weight here is locked/i)).toBeNull();
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
  /**
   * **Held, so the move is never made to be refused** (UF-035). A live slider previewed the move,
   * sent it, and then listed the weight itself as the lock in its own way.
   */
  it("holds a locked criterion's slider, and sends nothing when it is moved", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockServer.use(
      http.patch(
        "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
        async ({ request }) => {
          sent.push(await request.clone().json());
        },
      ),
    );
    renderShell("/configure");
    await settled();
    const slider = await weightSlider(OUTLOOK);
    expect(slider).toHaveAttribute("aria-disabled", "true");
    expect(slider).toHaveAttribute("title", expect.stringMatching(/unlock it to move/i));

    await saveWeight(OUTLOOK, "25");
    // Proved by the next write: had the move gone, it would be listed before the unlock.
    await user.click(await findLockAnywhere(OUTLOOK));

    await waitFor(() => expect(sent).toEqual([{ weight_locked: false }]));
    expect(shownWeight(OUTLOOK)).toBe("20");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("unlocks without touching the weight, so the weight can then move", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();

    const lock = await findLockAnywhere(OUTLOOK);
    expect(shownWeight(OUTLOOK)).toBe("20");

    await user.click(lock);

    await waitFor(() =>
      expect(lock).toHaveAttribute("aria-pressed", "false"),
    );
    // Unlocking moves nothing: it says the weight may move, not that it has.
    expect(shownWeight(OUTLOOK)).toBe("20");

    await saveWeight(OUTLOOK, "25");
    await waitFor(() =>
      expect(shownWeight(OUTLOOK)).toBe("25"),
    );
  });
});

describe("what each pillar's criteria come to", () => {
  /** The total belongs to the pillar it is inside, and is read there. */
  it("shows the total inside each pillar, so the rule can be seen holding", async () => {
    renderShell("/configure");
    await settled();

    await openThePillarOf(COST_OF_LIVING);
    expect(
      within(
        await screen.findByRole("list", { name: /weight totals by pillar/i }),
      ).getByText(/^Economy 100/i),
    ).toBeInTheDocument();

    await openThePillarOf(OVERCROWDING);
    expect(
      within(
        await screen.findByRole("list", { name: /weight totals by pillar/i }),
      ).getByText(/^Housing 100/i),
    ).toBeInTheDocument();
  });

  it("keeps the total at 100 after a weight moves", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight(COST_OF_LIVING, "40");

    await waitFor(() =>
      expect(shownWeight(TAX)).not.toBe("30"),
    );
    const totals = within(
      await screen.findByRole("list", { name: /weight totals by pillar/i }),
    );
    expect(totals.getByText(/^Economy 100/i)).toBeInTheDocument();
  });
});

/**
 * UX review E. Session-scoped on purpose: the backend records no change log, and inventing one
 * in the client would be a second account of the truth the server cannot confirm.
 */
describe("what this session changed", () => {
  it("says nothing has changed", async () => {
    // Four words, as the design has it. The paragraph that stood here explained that the list
    // is session-scoped -- true, and not what an empty panel is for: a reader meets it before
    // they have made a change and needs only to know that.
    renderShell("/configure");

    const rail = within(
      await screen.findByRole("region", { name: /^Recent changes/ }),
    );

    expect(rail.getByText("No changes yet.")).toBeInTheDocument();
  });

  /**
   * **The stage and the time, because a list of six weight changes is otherwise a heap.** The
   * stage is named rather than numbered: the stages are numbered by a CSS counter so that
   * moving a card moves its numeral, and a "Stage 3" written into a history entry would be
   * the one place that could then disagree with the screen.
   */
  it("says which stage a change came from, and when it was made", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight(COST_OF_LIVING, "40");

    const panel = await historyPanel();
    await panel.findByText(/Weight for Cost of living index: 50 to 40/);
    expect(panel.getByText("Pillar weights")).toBeInTheDocument();
    expect(panel.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  /** The rail never scrolls away, so the way to get the screen back is to fold it up. */
  it("folds the list away and brings it back", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    await saveWeight(COST_OF_LIVING, "40");
    const panel = await historyPanel();
    await panel.findByText(/Weight for Cost of living index: 50 to 40/);

    await user.click(panel.getByRole("button", { name: /recent changes/i }));

    expect(
      panel.queryByText(/Weight for Cost of living index: 50 to 40/),
    ).toBeNull();
    // The count stays, so a folded card still says how much it is holding.
    expect(panel.getByText("1 in this session")).toBeInTheDocument();

    await user.click(panel.getByRole("button", { name: /recent changes/i }));

    expect(
      panel.getByText(/Weight for Cost of living index: 50 to 40/),
    ).toBeInTheDocument();
  });

  it("lists a weight change once it has been made", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight(COST_OF_LIVING, "40");

    const panel = await historyPanel();
    expect(
      await panel.findByText(/Weight for Cost of living index: 50 to 40/),
    ).toBeInTheDocument();
  });

  /** A configuration is a state, so the reach is named before it is taken. */
  it("names how far an undo would reach", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight(COST_OF_LIVING, "40");
    // Listed before the next change, because one write runs at a time and the lock below is
    // disabled until this answer is in.
    const panel = await historyPanel();
    await panel.findByText(/Weight for Cost of living index: 50 to 40/);
    // A different pillar, so it is opened first -- which is also two changes, which is the
    // reach this test is about.
    await openThePillarOf(HOMICIDE);
    await userEvent.click(
      await screen.findByRole("button", {
        name: `Lock the weight for ${HOMICIDE}`,
      }),
    );

    await panel.findByText(/Locked Homicide rate/);
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
    await saveWeight(COST_OF_LIVING, "40");
    await screen.findByText(/Weight for Cost of living index: 50 to 40/);

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
    await saveWeight(COST_OF_LIVING, "40");

    const panel = await historyPanel();
    await panel.findByText(/Weight for Cost of living index: 50 to 40/);
    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    await waitFor(() =>
      expect(
        screen.queryByText(/Weight for Cost of living index: 50 to 40/),
      ).toBeNull(),
    );
  });

  it("offers a way back to where the session started", async () => {
    renderShell("/configure");
    await settled();
    await saveWeight(COST_OF_LIVING, "40");

    const panel = await historyPanel();
    await panel.findByText(/Weight for Cost of living index: 50 to 40/);
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
    await saveWeight(COST_OF_LIVING, "40");
    const panel = await historyPanel();
    await panel.findByText(/Weight for Cost of living index: 50 to 40/);

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
      /this change cannot be made/i,
    );
    // A half-finished undo is a real state, so what was not undone stays listed.
    expect(
      screen.getByText(/Weight for Cost of living index: 50 to 40/),
    ).toBeInTheDocument();
  });
});

/**
 * PL-138: every Configure edit is listed in Recent changes with the request that reverses it --
 * a criterion's rule and the source priority among them, not only weights, locks and sets.
 */
describe("the Configure edits Recent changes records", () => {
  /** The bodies of the requests sent to one endpoint, in the order they were sent. */
  function bodiesSent(method: string, path: RegExp): unknown[] {
    const bodies: unknown[] = [];
    const listen = ({ request }: { request: Request }) => {
      if (request.method === method && path.test(new URL(request.url).pathname)) {
        void request.clone().json().then((body: unknown) => bodies.push(body));
      }
    };
    mockServer.events.on("request:start", listen);
    onTestFinished(() => {
      mockServer.events.removeListener("request:start", listen);
    });
    return bodies;
  }

  it("records a criterion's rule, and its undo sends the rule as it was", async () => {
    const user = userEvent.setup();
    const rules = bodiesSent("PATCH", /\/criteria\/country\.total_tax_rate_effective$/);
    renderShell("/configure");
    await settled();
    await openThePillarOf(TAX);
    await user.click(screen.getByRole("button", { name: `Edit the rule for ${TAX}` }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Goal" }), "maximise");
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    const panel = await historyPanel();
    const entry = await panel.findByText(
      `Rule for ${TAX}: goal minimise to maximise, in Default`,
    );
    const item = within(entry.closest("li") as HTMLElement);
    expect(item.getByText("Pillar weights")).toBeInTheDocument();

    await user.click(item.getByRole("button", { name: "Undo this" }));

    await waitFor(() => expect(panel.getByText("No changes yet.")).toBeInTheDocument());
    expect(rules).toHaveLength(2);
    expect(rules[1]).toMatchObject({ goal: "minimise" });
  });

  it("records a move in the source priority, and its undo puts the order back", async () => {
    const user = userEvent.setup();
    const orders = bodiesSent("PUT", /\/data-sources\/order$/);
    renderShell("/configure");
    await settled();
    const sources = within(screen.getByRole("region", { name: "Source priority" }));
    const order = () =>
      sources.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"));

    await user.click(sources.getByRole("button", { name: "Move Manual entry up" }));

    const panel = await historyPanel();
    const entry = await panel.findByText("Moved Manual entry from position 2 to 1");
    const item = within(entry.closest("li") as HTMLElement);
    expect(item.getByText("Source priority")).toBeInTheDocument();
    expect(order()[0]).toBe("Manual entry");

    await user.click(item.getByRole("button", { name: "Undo this" }));

    await waitFor(() => expect(order()[0]).toBe("Eurostat"));
    expect(orders).toHaveLength(2);
    expect((orders[1] as { order: string[] }).order[0]).toBe("eurostat");
    expect(panel.getByText("No changes yet.")).toBeInTheDocument();
  });

  it("records a source switched off, and its undo switches it on again", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    const eurostat = () => screen.getByRole("listitem", { name: "Eurostat" });

    await user.click(screen.getByRole("switch", { name: "Consult Eurostat" }));
    const panel = await historyPanel();
    const entry = await panel.findByText("Switched off Eurostat");
    await waitFor(() => expect(eurostat()).toHaveTextContent("not consulted"));

    await user.click(
      within(entry.closest("li") as HTMLElement).getByRole("button", { name: "Undo this" }),
    );

    await waitFor(() => expect(eurostat()).not.toHaveTextContent("not consulted"));
    expect(screen.getByRole("switch", { name: "Consult Eurostat" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("holds the sources while another Configure write is in flight", async () => {
    renderShell("/configure");
    await settled();
    const writes = holdCriterionWrites();

    await saveWeight(COST_OF_LIVING, "40");
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    expectHeld(screen.getByRole("switch", { name: "Consult Eurostat" }));
    writes.release();
    await waitFor(() =>
      expectNotHeld(screen.getByRole("switch", { name: "Consult Eurostat" })),
    );
  });
});

/**
 * PL-138a. **A pillar's weight and lock are recorded as a criterion's are**, with the request
 * that reverses them: they are the decision the user sets most deliberately, and they were the
 * one weighting Recent changes never listed, so "Back to where I started" left them changed.
 */
describe("what this session changed in the pillar weights", () => {
  const ECONOMY_MOVED = "Pillar weight for Economy: 40.0% to 50.0%, in Default";

  async function movePillar(pillar: string, weight: string): Promise<void> {
    await settled();
    const slider = await screen.findByRole("slider", { name: `${pillar} weight` });
    fireEvent.change(slider, { target: { value: weight } });
    fireEvent.pointerUp(slider);
  }

  function recordPillarRequests(): unknown[] {
    const sent: unknown[] = [];
    mockServer.events.on("request:start", ({ request }) => {
      if (request.method === "PUT" && request.url.includes("/pillar-weights/")) {
        void request
          .clone()
          .json()
          .then((body: unknown) =>
            sent.push({ pillar: request.url.split("/").pop(), body }),
          );
      }
    });
    return sent;
  }

  afterEach(() => mockServer.events.removeAllListeners());

  it("lists a pillar's weight change, in the stage it was made in", async () => {
    renderShell("/configure");
    await movePillar("Economy", "50");

    const panel = await historyPanel();
    expect(await panel.findByText(ECONOMY_MOVED)).toBeInTheDocument();
    expect(panel.getByText("Pillar weights")).toBeInTheDocument();
  });

  it("collapses a second move of the same pillar into one entry that undoes to the first value", async () => {
    renderShell("/configure");
    await movePillar("Economy", "45");
    const panel = await historyPanel();
    await panel.findByText(/Pillar weight for Economy: 40\.0% to 45\.0%/);
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Economy weight" })).not.toHaveAttribute(
        "aria-disabled",
      ),
    );

    await movePillar("Economy", "50");
    // The label names the last step only, as a criterion's merged entry does (PL-141).
    await panel.findByText(/Pillar weight for Economy: 45\.0% to 50\.0%/);
    expect(panel.getByText("1 in this session")).toBeInTheDocument();
    const sent = recordPillarRequests();

    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    await waitFor(() => expect(sent).toEqual([{ pillar: "economics", body: { weight: 40 } }]));
  });

  it("undoes a pillar's weight by sending the weight it had", async () => {
    renderShell("/configure");
    await movePillar("Economy", "50");
    const panel = await historyPanel();
    await panel.findByText(ECONOMY_MOVED);
    const sent = recordPillarRequests();

    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    await waitFor(() => expect(panel.queryByText(ECONOMY_MOVED)).toBeNull());
    expect(sent).toEqual([{ pillar: "economics", body: { weight: 40 } }]);
    expect(screen.getByRole("slider", { name: "Economy weight" })).toHaveValue("40");
  });

  it("lists a pillar's lock, and Back to where I started releases it", async () => {
    renderShell("/configure");
    await settled();
    const lock = () => screen.getByRole("button", { name: "Lock Housing" });
    await userEvent.click(await screen.findByRole("button", { name: "Lock Housing" }));
    const panel = await historyPanel();
    await panel.findByText("Locked the Housing pillar, in Default");
    const sent = recordPillarRequests();

    await userEvent.click(
      panel.getByRole("button", { name: "Back to where I started" }),
    );

    await waitFor(() => expect(lock()).toHaveAttribute("aria-pressed", "false"));
    expect(sent).toEqual([{ pillar: "housing", body: { weight_locked: false } }]);
    expect(panel.getByText("No changes yet.")).toBeInTheDocument();
  });

  it("holds the undo while a pillar's weight is being saved, and the pillars while undoing", async () => {
    renderShell("/configure");
    await movePillar("Economy", "50");
    const panel = await historyPanel();
    await panel.findByText(ECONOMY_MOVED);
    let answer: () => void = () => undefined;
    mockServer.use(
      http.put("/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId", async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return HttpResponse.json({
          items: [
            { pillar: "economics", level: "country", weight: 50, weight_locked: false },
            { pillar: "housing", level: "country", weight: 30, weight_locked: false },
            { pillar: "safety", level: "country", weight: 20, weight_locked: false },
          ],
        });
      }),
    );

    await movePillar("Housing", "30");

    await waitFor(() => expectHeld(panel.getByRole("button", { name: "Undo this" })));
    answer();
    await waitFor(() =>
      expectNotHeld(panel.getByRole("button", { name: "Back to where I started" })),
    );
    await userEvent.click(panel.getByRole("button", { name: "Back to where I started" }));
    await waitFor(() =>
      expectHeld(screen.getByRole("slider", { name: "Economy weight" })),
    );
    answer();
  });

  it("reports a refused undo of a pillar's weight, and keeps it listed", async () => {
    renderShell("/configure");
    await movePillar("Economy", "50");
    const panel = await historyPanel();
    await panel.findByText(ECONOMY_MOVED);
    mockServer.use(
      http.put("/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId", () =>
        HttpResponse.json(
          { code: "weights_all_locked", message: "no", details: { locked: [] } },
          { status: 409 },
        ),
      ),
    );

    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    expect(await panel.findByRole("alert")).toHaveTextContent(
      /this change cannot be made/i,
    );
    expect(panel.getByText(ECONOMY_MOVED)).toBeInTheDocument();
  });
});

/**
 * UI-04. **One write at a time, and its answer belongs to the set it was sent for.** A weight
 * change rebalances its pillar, so two in flight can answer in either order; and a set switched
 * to meanwhile holds the same attributes when it is a copy, so an answer matched on attribute
 * alone lands in a set it was never sent to.
 */
describe("while a change is being saved", () => {
  it("never lands a weight saved in one set in another set chosen meanwhile", async () => {
    renderShell("/configure");
    await settled();
    const copy = await duplicateDefault();
    const writes = holdCriterionWrites();

    await saveWeight(COST_OF_LIVING, "40");
    await waitFor(() =>
      expect(writes.sent).toEqual([
        `${copy}/country.cost_of_living_index`,
      ]),
    );
    await chooseSet("default");
    await weightSlider(COST_OF_LIVING);
    expect(readingOf(COST_OF_LIVING)).toBe("50.0%");

    writes.release();

    // The answer has landed once the change is listed beside the copy (D-C03-9): it is the
    // copy's, and recorded as such.
    await (await historyPanel()).findByText("2 in this session");
    expect(readingOf(COST_OF_LIVING)).toBe("50.0%");
    expect(readingOf(TAX)).toBe("30.0%");
  });

  /**
   * UIC-A3. **A read older than an acknowledged save is never the one left on screen.** Coming
   * back to a set while its weight was being saved reads it again; a read taken before the save
   * committed but answered after it ended the screen on the old weights, though the save had been
   * confirmed -- and the next change's undo would have started from them.
   */
  it("reads a set only once a save to it has been answered, so never the older set", async () => {
    renderShell("/configure");
    await settled();
    const copy = await duplicateDefault();
    const writes = holdCriterionWrites();
    await saveWeight(COST_OF_LIVING, "40");
    await waitFor(() =>
      expect(writes.sent).toEqual([`${copy}/country.cost_of_living_index`]),
    );
    let reads = 0;
    mockServer.use(
      http.get(`/v1/criteria-sets/${copy}`, () => {
        reads += 1;
      }),
    );
    await chooseSet("default");
    await weightSlider(COST_OF_LIVING);

    // Not `chooseSet`, which waits for the read this test is holding back.
    await userEvent.selectOptions(activeSet(), copy);
    // PL-142: no read of the copy is sent while the save to it is in flight.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toBe(0);
    writes.release();
    // The copy is listed too (D-C03-9), so the save makes two.
    await (await historyPanel()).findByText("2 in this session");

    await waitFor(() => expect(reads).toBe(1));
    await settled();
    await weightSlider(COST_OF_LIVING);
    expect(readingOf(COST_OF_LIVING)).toBe("40.0%");
    expect(reads).toBe(1);
  });

  /**
   * RD-2. **Every writer of a set, not only the criteria list.** A pillar's weight or lock, a
   * gate or a compound rule written while its set was being read again ended the screen on the
   * read: the panels start from the set the screen reads, and only the criteria list's own writes
   * marked that read as older than what they had just changed.
   */
  it.each([
    {
      what: "a pillar's weight",
      path: "/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId",
      write: (): Promise<void> => {
        const slider = screen.getByRole("slider", { name: "Economy weight" });
        fireEvent.change(slider, { target: { value: "50" } });
        fireEvent.pointerUp(slider);
        return Promise.resolve();
      },
      shows: (): void => {
        expect(screen.getByRole("slider", { name: "Economy weight" })).toHaveValue("50");
      },
    },
    {
      what: "a pillar's lock",
      path: "/v1/criteria-sets/:criteriaSetId/pillar-weights/:pillarId",
      write: () => userEvent.click(screen.getByRole("button", { name: "Lock Economy" })),
      shows: (): void => {
        expect(screen.getByRole("button", { name: "Lock Economy" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      },
    },
    {
      what: "a gate",
      path: "/v1/criteria-sets/:criteriaSetId/match-rules/:matchRuleId",
      write: () =>
        userEvent.click(screen.getByRole("switch", { name: "Enforce Free movement applies" })),
      shows: (): void => {
        expect(screen.getByRole("switch", { name: "Enforce Free movement applies" })).toBeChecked();
      },
    },
    {
      what: "a compound rule",
      path: "/v1/criteria-sets/:criteriaSetId/compound-rules/:compoundRuleId",
      write: () =>
        userEvent.click(screen.getByRole("switch", { name: "Apply Rent fits the target spend" })),
      shows: (): void => {
        expect(
          screen.getByRole("switch", { name: "Apply Rent fits the target spend" }),
        ).toBeChecked();
      },
    },
  ])("reads a set only once a write to $what has been answered", async ({
    path,
    write,
    shows,
  }) => {
    renderShell("/configure");
    await settled();
    const copy = await duplicateDefault();
    const writes = holdSetWrites("put", path);
    await write();
    await waitFor(() => expect(writes.sent).toEqual([copy]));
    let reads = 0;
    mockServer.use(
      http.get(`/v1/criteria-sets/${copy}`, () => {
        reads += 1;
      }),
    );
    await chooseSet("default");

    // Not `chooseSet`, which waits for the read this test is holding back.
    await userEvent.selectOptions(activeSet(), copy);
    // PL-142: no read of the copy is sent while the write to it is in flight.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toBe(0);
    writes.release();

    await waitFor(() => expect(reads).toBe(1));
    await settled();
    shows();
  });

  it("does not report a refusal against a set it was not sent for", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderShell("/configure");
    await settled();
    await duplicateDefault();
    mockServer.use(
      http.patch(
        "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
        async () => {
          await held;
          return HttpResponse.json(
            { code: "weights_all_locked", message: "no" },
            { status: 409 },
          );
        },
      ),
    );

    await saveWeight(COST_OF_LIVING, "40");
    await chooseSet("default");
    await weightSlider(COST_OF_LIVING);
    release();

    // The attempt is over once the row it was saving can be moved again.
    await waitFor(() =>
      expectNotHeld(
        screen.getByRole("slider", { name: `Weight for ${COST_OF_LIVING}` }),
      ),
    );
    expect(screen.queryByText(/this change cannot be made/i)).toBeNull();
  });

  it("holds every other criterion still while one is being saved", async () => {
    renderShell("/configure");
    await settled();
    const writes = holdCriterionWrites();

    await saveWeight(COST_OF_LIVING, "40");
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    expectHeld(screen.getByRole("slider", { name: `Weight for ${TAX}` }));
    expectHeld(
      screen.getByRole("button", { name: `Lock the weight for ${TAX}` }),
    );
    expectHeld(
      screen.getByRole("button", { name: `Lock the weight for ${OUTLOOK}` }),
    );
    // The rebalance the drag previewed stands until its answer replaces it.
    expect(readingOf(TAX)).toBe("40.0%");
    // A held slider still hears a pointer -- it is not disabled -- so the row refuses it:
    // nothing moves, and the preview is not ended by a release no gesture started. The locked
    // row, because it is the one the drag above previews nothing for.
    const outlook = screen.getByRole("slider", { name: `Weight for ${OUTLOOK}` });
    fireEvent.change(outlook, { target: { value: "25" } });
    fireEvent.pointerUp(outlook);
    expect(outlook).toHaveValue("20");
    expect(readingOf(TAX)).toBe("40.0%");

    writes.release();

    await waitFor(() =>
      expectNotHeld(screen.getByRole("slider", { name: `Weight for ${TAX}` })),
    );
    expectNotHeld(
      screen.getByRole("button", { name: `Lock the weight for ${TAX}` }),
    );
    expect(writes.sent).toEqual(["default/country.cost_of_living_index"]);
  });

  it("holds a rule's Save while a weight is being saved, and keeps the unsent edit", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await settled();
    await openThePillarOf(TAX);
    await user.click(
      screen.getByRole("button", { name: `Edit the rule for ${TAX}` }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Goal" }),
      "maximise",
    );
    const writes = holdCriterionWrites();

    await saveWeight(COST_OF_LIVING, "40");
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    expectHeld(screen.getByRole("button", { name: "Save rule" }));
    expectHeld(screen.getByRole("button", { name: "Discard changes" }));
    // Held, they still take a click -- and do nothing with it: the edit is neither thrown away
    // nor sent into the rebalance in flight.
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));
    expect(screen.getByRole("combobox", { name: "Goal" })).toHaveValue(
      "maximise",
    );

    writes.release();

    await waitFor(() =>
      expectNotHeld(screen.getByRole("button", { name: "Save rule" })),
    );
    expect(screen.getByRole("button", { name: "Save rule" })).toBeEnabled();
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "Goal" }).value,
    ).toBe("maximise");
    expect(writes.sent).toEqual(["default/country.cost_of_living_index"]);
  });

  it("lets nothing be undone while a change is being saved", async () => {
    renderShell("/configure");
    await settled();
    await saveWeight(COST_OF_LIVING, "40");
    const panel = await historyPanel();
    await panel.findByText("1 in this session");
    const writes = holdCriterionWrites();

    await saveWeight(TAX, "35");
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    expectHeld(panel.getByRole("button", { name: "Undo this" }));
    expectHeld(panel.getByRole("button", { name: "Back to where I started" }));
    // Held, they still take a click -- and send nothing into the rebalance in flight.
    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));
    await userEvent.click(
      panel.getByRole("button", { name: "Back to where I started" }),
    );

    writes.release();

    await waitFor(() =>
      expectNotHeld(
        panel.getByRole("button", { name: "Back to where I started" }),
      ),
    );
    await panel.findByText("2 in this session");
    expect(writes.sent).toEqual(["default/country.total_tax_rate_effective"]);
  });

  it("holds the weights still while an undo is being sent", async () => {
    renderShell("/configure");
    await settled();
    await saveWeight(COST_OF_LIVING, "40");
    const panel = await historyPanel();
    await panel.findByText("1 in this session");
    const writes = holdCriterionWrites();

    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    expectHeld(
      screen.getByRole("slider", { name: `Weight for ${COST_OF_LIVING}` }),
    );
    expectHeld(screen.getByRole("slider", { name: `Weight for ${TAX}` }));
    expectHeld(
      screen.getByRole("button", { name: `Lock the weight for ${TAX}` }),
    );
    // A held slider still hears a pointer -- it is not disabled -- so the row refuses it.
    const tax = screen.getByRole("slider", { name: `Weight for ${TAX}` });
    fireEvent.change(tax, { target: { value: "45" } });
    fireEvent.pointerUp(tax);
    expect(tax).toHaveValue("40");

    writes.release();

    await waitFor(() =>
      expectNotHeld(screen.getByRole("slider", { name: `Weight for ${TAX}` })),
    );
    expect(writes.sent).toHaveLength(1);
  });

  /**
   * NEW-34. **Held, never disabled.** Chromium throws focus off a control the moment it is
   * disabled and does not give it back, so a keyboard user who nudged a weight or pressed a lock
   * landed on the page after every step and had to tab back. jsdom keeps focus on a disabled
   * control, which is why these follow Chromium's rule rather than jsdom's.
   */
  describe("from the keyboard", () => {
    beforeEach(() => followChromiumFocusFixup());

    it("keeps focus on a criterion's slider while its weight is saved, and steps it no further", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      const slider = await weightSlider(COST_OF_LIVING);
      const writes = holdCriterionWrites();
      act(() => slider.focus());

      await pressArrowRight(user);
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(slider).toHaveFocus();
      expectHeld(slider);
      // A second step while the first is on its way: nothing moves and nothing is sent.
      await pressArrowRight(user);
      expect(slider).toHaveValue("50.5");

      writes.release();

      await waitFor(() => expect(readingOf(COST_OF_LIVING)).toBe("50.5%"));
      await waitFor(() => expectNotHeld(slider));
      expect(slider).toHaveFocus();
      await pressArrowRight(user);
      // The third step's answer arriving is what proves the second sent nothing.
      await waitFor(() => expect(readingOf(COST_OF_LIVING)).toBe("51.0%"));
      expect(writes.sent).toEqual([
        "default/country.cost_of_living_index",
        "default/country.cost_of_living_index",
      ]);
    });

    it("keeps focus on a criterion's lock while it is saved, and a second press sends nothing", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      const lock = await findLockAnywhere(TAX);
      const writes = holdCriterionWrites();
      act(() => lock.focus());

      await user.keyboard(" ");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(lock).toHaveFocus();
      expectHeld(lock);
      await user.keyboard(" ");

      writes.release();

      await waitFor(() => expect(lock).toHaveAttribute("aria-pressed", "true"));
      await waitFor(() => expectNotHeld(lock));
      expect(lock).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() => expect(lock).toHaveAttribute("aria-pressed", "false"));
      expect(writes.sent).toEqual([
        "default/country.total_tax_rate_effective",
        "default/country.total_tax_rate_effective",
      ]);
    });

    it("keeps focus on an undo while it is sent, and a second Enter sends nothing", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      await saveWeight(COST_OF_LIVING, "40");
      const panel = await historyPanel();
      await panel.findByText("1 in this session");
      const writes = holdCriterionWrites();
      const undo = panel.getByRole("button", { name: "Undo this" });
      act(() => undo.focus());

      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(undo).toHaveFocus();
      expectHeld(undo);
      expectHeld(panel.getByRole("button", { name: "Back to where I started" }));
      await user.keyboard("{Enter}");

      writes.release();

      // Undone, the change leaves the list -- and its button with it.
      await panel.findByText("nothing yet");
      expect(writes.sent).toEqual(["default/country.cost_of_living_index"]);
    });

    /**
     * NEW-45. **An undo takes the pressed button away with its entry**, and "Back to where I
     * started" takes itself away with the last one -- so a keyboard user was put back on the
     * page after either. Focus goes to the panel's own heading button, which is always there,
     * and where a stray Enter only folds the panel rather than undoing anything more.
     */
    it("puts focus on Recent changes once an undo has taken the pressed button away", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      await saveWeight(COST_OF_LIVING, "40");
      await saveWeight(TAX, "35");
      const panel = await historyPanel();
      await panel.findByText("2 in this session");
      const undo = panel.getByRole("button", { name: "Undo this" });
      act(() => undo.focus());

      await user.keyboard("{Enter}");

      await panel.findByText("1 in this session");
      await waitFor(() =>
        expect(
          panel.getByRole("button", { name: /recent changes/i }),
        ).toHaveFocus(),
      );
    });

    it("puts focus on Recent changes once Back to where I started has gone", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      await saveWeight(COST_OF_LIVING, "40");
      const panel = await historyPanel();
      await panel.findByText("1 in this session");
      const back = panel.getByRole("button", {
        name: "Back to where I started",
      });
      act(() => back.focus());

      await user.keyboard("{Enter}");

      await panel.findByText("nothing yet");
      await waitFor(() =>
        expect(
          panel.getByRole("button", { name: /recent changes/i }),
        ).toHaveFocus(),
      );
    });

    it("keeps focus on an undo held by a weight being saved, and undoes once that has answered", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      await saveWeight(COST_OF_LIVING, "40");
      const panel = await historyPanel();
      await panel.findByText("1 in this session");
      const undo = panel.getByRole("button", { name: "Undo this" });
      act(() => undo.focus());
      const writes = holdCriterionWrites();

      // A weight saved by a pointer while the keyboard waits on the undo.
      await saveWeight(TAX, "35");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(undo).toHaveFocus();
      expectHeld(undo);
      await user.keyboard("{Enter}");

      writes.release();

      await panel.findByText("2 in this session");
      await waitFor(() => expectNotHeld(undo));
      expect(undo).toHaveFocus();
      await user.keyboard("{Enter}");
      await panel.findByText("nothing yet");
      // The weight, then its undo and the undo of the change before it: nothing in between.
      expect(writes.sent).toEqual([
        "default/country.total_tax_rate_effective",
        "default/country.total_tax_rate_effective",
        "default/country.cost_of_living_index",
      ]);
    });

    it("lets go of an undo the server refused, with focus still on it", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      await saveWeight(COST_OF_LIVING, "40");
      const panel = await historyPanel();
      await panel.findByText("1 in this session");
      const sent: string[] = [];
      mockServer.use(
        http.patch(
          "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
          ({ params }) => {
            sent.push(String(params["attributeId"]));
            return HttpResponse.json(
              { code: "weights_all_locked", message: "no" },
              { status: 409 },
            );
          },
        ),
      );
      const undo = panel.getByRole("button", { name: "Undo this" });
      act(() => undo.focus());

      await user.keyboard("{Enter}");

      expect(await panel.findByRole("alert")).toHaveTextContent(
        /this change cannot be made/i,
      );
      await waitFor(() => expectNotHeld(undo));
      expect(undo).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(sent).toHaveLength(2));
    });

    it("keeps focus on the way back while it is sent, and a second Enter sends nothing", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      await saveWeight(COST_OF_LIVING, "40");
      const panel = await historyPanel();
      await panel.findByText("1 in this session");
      const writes = holdCriterionWrites();
      const back = panel.getByRole("button", { name: "Back to where I started" });
      act(() => back.focus());

      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(back).toHaveFocus();
      expectHeld(back);
      await user.keyboard("{Enter}");

      writes.release();

      await panel.findByText("nothing yet");
      expect(writes.sent).toEqual(["default/country.cost_of_living_index"]);
    });

    it("lets go of a criterion's slider after a refused weight, with focus still on it", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      await settled();
      const slider = await weightSlider(COST_OF_LIVING);
      mockServer.use(
        http.patch("/v1/criteria-sets/:criteriaSetId/criteria/:attributeId", () =>
          HttpResponse.json(
            { code: "weights_all_locked", message: "no" },
            { status: 409 },
          ),
        ),
      );
      act(() => slider.focus());

      await pressArrowRight(user);

      expect(
        await screen.findByText(/this change cannot be made/i),
      ).toBeInTheDocument();
      await waitFor(() => expectNotHeld(slider));
      expect(slider).toHaveFocus();
      await waitFor(() => expect(slider).toHaveValue("50"));
    });
  });
});

/**
 * UI-08 and NEW-07. **A history entry names the set and the attribute it was made to.** The
 * same attribute in two sets is two decisions, and an entry keyed on the attribute alone
 * folded them into one whose undo wrote one set's weight into the other.
 */
describe("changes made in more than one set", () => {
  it("names the attribute a change was made to, never its id", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight(COST_OF_LIVING, "40");

    const panel = await historyPanel();
    expect(
      await panel.findByText(/^Weight for Cost of living index: 50 to 40/),
    ).toBeInTheDocument();
    expect(panel.queryByText(/country\./)).toBeNull();
  });

  it("undoes a lock with the opposite lock, in the set it was made in", async () => {
    renderShell("/configure");
    await settled();
    await userEvent.click(await findLockAnywhere(COST_OF_LIVING));
    const panel = await historyPanel();
    await panel.findByText("Locked Cost of living index, in Default");

    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: `Lock the weight for ${COST_OF_LIVING}`,
        }),
      ).toHaveAttribute("aria-pressed", "false"),
    );
    expect(panel.getByText("No changes yet.")).toBeInTheDocument();
  });

  it("says which set each change was made in", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight(COST_OF_LIVING, "40");

    expect(
      await (await historyPanel()).findByText(
        "Weight for Cost of living index: 50 to 40, in Default",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the same change to two sets as two entries, each undone in its own set", async () => {
    renderShell("/configure");
    await settled();
    const copy = await duplicateDefault();
    await saveWeight(COST_OF_LIVING, "40");
    const panel = await historyPanel();
    // The copy is listed below the weights (D-C03-9).
    await panel.findByText("2 in this session");
    await chooseSet("default");
    await saveWeight(COST_OF_LIVING, "40");

    await panel.findByText("3 in this session");
    expect(
      panel.getByText("Weight for Cost of living index: 50 to 40, in Default copy"),
    ).toBeInTheDocument();
    expect(
      panel.getByText("Weight for Cost of living index: 50 to 40, in Default"),
    ).toBeInTheDocument();

    const undone: unknown[] = [];
    mockServer.use(
      http.patch(
        "/v1/criteria-sets/:criteriaSetId/criteria/:attributeId",
        async ({ params, request }) => {
          undone.push({
            set: params["criteriaSetId"],
            body: await request.clone().json(),
          });
        },
      ),
    );
    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));
    await panel.findByText("2 in this session");
    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));

    await waitFor(() =>
      expect(undone).toEqual([
        { set: "default", body: { weight: 50 } },
        { set: copy, body: { weight: 50 } },
      ]),
    );
  });
});

/**
 * UI-09. **An undo re-sends the weight it changed, and that is not always the whole pillar.**
 * The server shares a change among the unlocked siblings in proportion to their weights; a
 * change that emptied them all leaves nothing to be in proportion to, so the way back shares
 * evenly. Undo still makes the real request -- what changes is that it says so first.
 */
describe("an undo that cannot put a whole pillar back", () => {
  /** Economy's third criterion is locked in the shipped set; unlocked, two siblings can empty. */
  async function unlockOutlook(): Promise<void> {
    await userEvent.click(await findLockAnywhere(OUTLOOK));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `Lock the weight for ${OUTLOOK}` }),
      ).toHaveAttribute("aria-pressed", "false"),
    );
  }

  it("warns before undoing a change that left the rest of its pillar at zero", async () => {
    renderShell("/configure");
    await settled();
    await unlockOutlook();

    await saveWeight(COST_OF_LIVING, "100");

    const panel = await historyPanel();
    const entry = (
      await panel.findByText(/: 50 to 100/)
    ).closest("li")!;
    expect(entry).toHaveTextContent(/cannot restore the rest of this pillar/i);
    expect(
      within(entry).getByRole("button", { name: "Undo this" }),
    ).toHaveAccessibleDescription(/cannot restore the rest of this pillar/i);
    expect(
      panel.getByRole("button", { name: "Back to where I started" }),
    ).toHaveAccessibleDescription(/cannot restore every weight/i);
  });

  it("undoes it with the real request, and shows what the server shared out", async () => {
    renderShell("/configure");
    await settled();
    await unlockOutlook();
    await saveWeight(COST_OF_LIVING, "100");
    const panel = await historyPanel();
    const entry = (
      await panel.findByText(/: 50 to 100/)
    ).closest("li")!;

    await userEvent.click(within(entry).getByRole("button", { name: "Undo this" }));

    // An even share of the fifty left, never the 30 and 20 the pillar held before.
    await waitFor(() => expect(readingOf(TAX)).toBe("25.0%"));
    expect(readingOf(OUTLOOK)).toBe("25.0%");
    expect(readingOf(COST_OF_LIVING)).toBe("50.0%");
  });

  it("says nothing more of a change the undo can reverse exactly", async () => {
    renderShell("/configure");
    await settled();

    await saveWeight(COST_OF_LIVING, "40");

    const panel = await historyPanel();
    await panel.findByText(/: 50 to 40/);
    expect(panel.queryByRole("note")).toBeNull();
    expect(
      panel.getByRole("button", { name: "Undo this" }),
    ).not.toHaveAccessibleDescription();
  });
});

/**
 * UI-12. **A gate's sentence follows its answers while the screen stays open.** The rules and
 * the proposals read the answers separately, so confirming a proposal re-read only the
 * proposals: the gate went on saying "awaits confirmation" -- false once confirmed -- until the
 * screen was remounted.
 */
describe("a gate's sentence once its answers change", () => {
  const PORTUGAL_PROPOSED = {
    match_rule: "country.visa_route_exists",
    candidate: "country.portugal",
    match_result: "not_matching",
    data_source: "llm",
    retrieval_date: "2026-09-12T09:00:00Z",
    reason: "The official page lists no route for these citizenships.",
    citations: ["https://example.gov/skilled-worker"],
    is_proposal: true,
  };

  /** The enforced gate's row, kept: the same element must change, which is what "without remounting" means. */
  async function visaGate(): Promise<HTMLElement> {
    return within(
      await screen.findByRole("region", { name: "Match rules & gates" }),
    ).findByRole("listitem", { name: "A visa route exists" });
  }

  it("names who a proposal removes once it is confirmed, without remounting", async () => {
    renderShell("/configure");
    await settled();
    const gate = await visaGate();
    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "Removes Spain. 1 proposed answer awaits confirmation and rules nobody out until then.",
      ),
    );

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Confirm A visa route exists for Portugal",
      }),
    );

    await waitFor(() => expect(gate).toHaveTextContent("Removes 2 countries: Portugal and Spain."));
    expect(gate).not.toHaveTextContent(/awaits confirmation/);
  });

  it("mentions a proposal a research pass stored, without remounting", async () => {
    const user = userEvent.setup();
    const spainProposed = { ...PORTUGAL_PROPOSED, candidate: "country.spain" };
    let researched = false;
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({
          items: researched
            ? [PORTUGAL_PROPOSED, spainProposed]
            : [PORTUGAL_PROPOSED],
        }),
      ),
      http.post("/v1/match-rule-research", () => {
        researched = true;
        return HttpResponse.json({
          proposals: [spainProposed],
          refusals: [],
          cost_eur: 0.04,
          calls: 2,
          halted_on_spend_cap: false,
        });
      }),
    );
    renderShell("/configure");
    await settled();
    const gate = await visaGate();
    await waitFor(() =>
      expect(gate).toHaveTextContent("1 proposed answer awaits confirmation"),
    );

    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/3 questions to research/i);
    await user.click(screen.getByRole("button", { name: "Research the gates" }));

    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "2 proposed answers await confirmation and rule nobody out until then.",
      ),
    );
  });

  /**
   * **A pass that failed part way may already have stored proposals**, one per question it got
   * through. Left unread, they were invisible, and the next pass would pay to ask them again.
   */
  it("shows what a failed pass stored before it failed, in the list and the gate's sentence", async () => {
    const user = userEvent.setup();
    const spainProposed = { ...PORTUGAL_PROPOSED, candidate: "country.spain" };
    let stored = false;
    mockServer.use(
      http.get("/v1/match-rule-results", () =>
        HttpResponse.json({
          items: stored ? [PORTUGAL_PROPOSED, spainProposed] : [PORTUGAL_PROPOSED],
        }),
      ),
      http.post("/v1/match-rule-research", () => {
        // One question was answered and stored, and then the pass failed.
        stored = true;
        return HttpResponse.json(
          { code: "internal_error", message: "the model provider failed" },
          { status: 500 },
        );
      }),
    );
    renderShell("/configure");
    await settled();
    const gate = await visaGate();
    await waitFor(() =>
      expect(gate).toHaveTextContent("1 proposed answer awaits confirmation"),
    );

    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/3 questions to research/i);
    await user.click(screen.getByRole("button", { name: "Research the gates" }));

    expect(
      (await screen.findAllByText("The server failed while answering.")).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(gate).toHaveTextContent(
        "2 proposed answers await confirmation and rule nobody out until then.",
      ),
    );
    // In the list too, where it can be confirmed rather than paid for a second time.
    expect(
      await screen.findByRole("button", {
        name: "Confirm A visa route exists for Spain",
      }),
    ).toBeInTheDocument();
  });

  /**
   * How many times the stored answers were read because of a refused pass.
   *
   * **A later write that does re-read** follows the refusal, so any read the refusal asked for
   * is counted first: a confirm re-reads the proposals, the rules and the gate answers, three
   * reads and no more.
   */
  async function readsCausedByARefusedPass(
    refusal: () => Response,
    shown: RegExp,
  ): Promise<number> {
    const user = userEvent.setup();
    const reads = { count: 0 };
    const countReads = ({ request }: { request: Request }) => {
      if (
        request.method === "GET" &&
        new URL(request.url).pathname === "/v1/match-rule-results"
      ) {
        reads.count += 1;
      }
    };
    mockServer.events.on("request:start", countReads);
    onTestFinished(() =>
      mockServer.events.removeListener("request:start", countReads),
    );
    mockServer.use(http.post("/v1/match-rule-research", refusal));
    renderShell("/configure");
    await settled();
    const gate = await visaGate();
    await user.click(screen.getByRole("button", { name: "Estimate the research" }));
    await screen.findByText(/3 questions to research/i);
    const before = reads.count;

    await user.click(screen.getByRole("button", { name: "Research the gates" }));
    await screen.findByText(shown);
    await user.click(
      await screen.findByRole("button", {
        name: "Confirm A visa route exists for Portugal",
      }),
    );
    await waitFor(() => expect(gate).toHaveTextContent("Removes 2 countries: Portugal and Spain."));

    return reads.count - before - 3;
  }

  it("reads nothing again after a refusal, which stored nothing", async () => {
    const reads = await readsCausedByARefusedPass(
      () =>
        HttpResponse.json(
          {
            code: "spend_cap_not_set",
            message: "this would spend money and no spend cap is set",
          },
          { status: 409 },
        ),
      /no spend cap is set/i,
    );

    expect(reads).toBe(0);
  });

  /**
   * NEW-31. **Switching the `llm` source off in Data sources, on this screen, after the
   * estimate** makes the pass a 501: refused before anything was asked, so nothing was stored
   * and there is nothing to read again.
   */
  it("reads nothing again after a pass refused because no model may be asked", async () => {
    const reads = await readsCausedByARefusedPass(
      () =>
        HttpResponse.json(
          {
            code: "llm_not_configured",
            message:
              "the llm source is switched off, so no gate can be researched",
          },
          { status: 501 },
        ),
      /the llm source is switched off/i,
    );

    expect(reads).toBe(0);
  });
});

/**
 * UI-01. **A research pass belongs to the screen, not to the panel that started it.** Switching
 * the criteria set remounts the rules and the proposals beneath them, which would have taken a
 * pass held there with them and left what it spent unsaid. Leaving Configure is what stops one,
 * and then it asks nothing more.
 */
describe("a research pass while the screen changes around it", () => {
  function theProposals() {
    return within(screen.getByRole("region", { name: "Gate proposals" }));
  }

  async function startAPass(): Promise<void> {
    await screen.findByRole("region", { name: "Gate proposals" });
    await userEvent.click(
      theProposals().getByRole("button", { name: "Estimate the research" }),
    );
    await theProposals().findByText(/3 questions to research/i);
    await userEvent.click(
      theProposals().getByRole("button", { name: "Research the gates" }),
    );
  }

  /**
   * PL-151. **A pass names the level it researches**, whatever level the screen shows now, and
   * goes on asking only about the level its estimate priced. The City panel holds its Estimate
   * while the Country pass runs, and lists no Country proposal.
   */
  it("says Country, and asks only about Country, after the level is switched to City mid-pass", async () => {
    const research = watchResearch({ holdAt: 2 });
    renderShell("/configure");
    await settled();
    await startAPass();
    await waitFor(() => expect(research.sent).toHaveLength(2));

    await userEvent.click(await screen.findByRole("button", { name: "City" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "City" })).toHaveAttribute("aria-pressed", "true"),
    );

    expect(theProposals().getByRole("status")).toHaveTextContent(
      "Asking Free movement applies at the Country level",
    );
    expect(
      theProposals().getByRole("button", { name: "Estimate the research" }),
    ).toHaveAttribute("aria-disabled", "true");
    research.release();
    await waitFor(() =>
      expect(theProposals().getByRole("status")).toHaveTextContent(
        "The last pass at the Country level asked every gate",
      ),
    );
    expect(research.sent.map((body) => body.level)).toEqual(
      COUNTRY_GATES.map(() => "country"),
    );
    expect(await theProposals().findByText(/no proposal is waiting/i)).toBeInTheDocument();
  });

  /**
   * PL-162. **The proposals heading nests under the rules stage**, a sibling of Gates and
   * Compound rules, wherever the panel is drawn: beside a loaded set's rules, or alone in the
   * stage when the set cannot be read and a pass needs its Stop.
   */
  it("heads the proposals one level below the stage, beside the rules and without them", async () => {
    renderShell("/configure");
    await settled();
    await screen.findByRole("region", { name: "Gate proposals" });
    expect(
      theProposals().getByRole("heading", { name: "Gate proposals" }),
    ).toHaveProperty("tagName", "H3");

    await startAPass();
    await waitFor(() =>
      expect(theProposals().getByRole("status")).toHaveTextContent(/The last pass/),
    );
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () =>
        HttpResponse.json(
          { code: "unavailable", message: "the criteria set could not be read" },
          { status: 503 },
        ),
      ),
    );
    await chooseSet("remote_only");
    expect((await screen.findAllByText("The server failed while answering.")).length).toBeGreaterThan(0);

    expect(
      theProposals().getByRole("heading", { name: "Gate proposals" }),
    ).toHaveProperty("tagName", "H3");
  });

  it("goes on asking when the criteria set is switched mid-pass", async () => {
    const research = watchResearch({ holdAt: 2 });
    renderShell("/configure");
    await settled();
    await startAPass();
    await waitFor(() => expect(research.sent).toHaveLength(2));

    await chooseSet("remote_only");

    // Another panel, drawn for another set, showing the pass the screen still holds.
    expect(theProposals().getByRole("status")).toHaveTextContent(
      "Asking Free movement applies at the Country level",
    );
    research.release();
    await waitFor(() =>
      expect(theProposals().getByRole("status")).toHaveTextContent(
        "The last pass at the Country level asked every gate",
      ),
    );
    expect(gatesAsked(research)).toEqual(COUNTRY_GATES.map((gate) => [gate]));
  });

  /**
   * UIC-A4. **Stop stays on screen whatever the criteria set's read does.** The proposals were
   * drawn only beside a loaded set, so a set that could not be read took Stop, the progress and
   * the spend away while the pass went on asking -- and paying -- with no way to stop it short of
   * leaving the screen.
   */
  it("keeps Stop on screen when the set switched to cannot be read, and stops the pass", async () => {
    const research = watchResearch({ holdAt: 2 });
    renderShell("/configure");
    await settled();
    await startAPass();
    await waitFor(() => expect(research.sent).toHaveLength(2));
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () =>
        HttpResponse.json(
          { code: "unavailable", message: "the criteria set could not be read" },
          { status: 503 },
        ),
      ),
    );

    await chooseSet("remote_only");
    expect((await screen.findAllByText("The server failed while answering.")).length).toBeGreaterThan(0);
    await userEvent.click(
      theProposals().getByRole("button", { name: "Stop after this question" }),
    );
    research.release();

    await waitFor(() =>
      expect(theProposals().getByRole("status")).toHaveTextContent(
        /You stopped the last pass at the Country level/,
      ),
    );
    expect(research.sent).toHaveLength(2);
    expect(screen.getAllByRole("region", { name: "Gate proposals" })).toHaveLength(1);
  });

  it("asks nothing more once Configure is left mid-pass", async () => {
    const research = watchResearch({ holdAt: 1 });
    renderShell("/configure");
    await settled();
    await startAPass();
    await waitFor(() => expect(research.sent).toHaveLength(1));

    await userEvent.click(screen.getByRole("link", { name: "Rank" }));
    await screen.findByRole("heading", { name: "Rank", level: 1 });
    research.release();

    await waitFor(() => expect(research.answered).toBe(1));
    // A round trip through the mock after the question in flight was answered, by which the
    // next one would have been asked.
    await fetchLevels();
    expect(research.sent).toHaveLength(1);
  });
});

/**
 * PL-013. **Six stage cards, whatever state each read is in.** The numeral is a CSS counter on
 * the header, so a stage that returned early without its card took its number with it and the
 * stages after it renumbered: source priority moved from 5 to 3 and back.
 */
describe("the six stages", () => {
  const STAGES = [
    /^Criteria set/,
    /^Household$/,
    /^Pillar weights$/,
    /^Match rules/,
    /^Source priority$/,
    /^Acquisition limits$/,
  ];

  /** The stage headings, in document order; the gate proposals' heading is not a stage. */
  function stageTitles(): string[] {
    return screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "")
      .filter((title) => STAGES.some((stage) => stage.test(title)));
  }

  /** A read that never answers until the test is over. */
  function heldForever(path: string) {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    return http.get(path, async () => {
      await held;
      return HttpResponse.json({}, { status: 500 });
    });
  }

  function failing(path: string) {
    return http.get(path, () =>
      HttpResponse.json({ code: "internal_error", message: "broken" }, { status: 500 }),
    );
  }

  it.each([
    ["the set is still being read", () => heldForever("/v1/criteria-sets/:id")],
    ["the set could not be read", () => failing("/v1/criteria-sets/:id")],
    ["the household could not be read", () => failing("/v1/household")],
    ["the settings could not be read", () => failing("/v1/settings")],
  ])("draws all six, numbered in order, while %s", async (_case, handler) => {
    mockServer.use(handler());
    renderShell("/configure");

    await screen.findByRole("region", { name: "Configure" });
    await waitFor(() => {
      const titles = stageTitles();
      expect(titles).toHaveLength(STAGES.length);
      STAGES.forEach((stage, index) => expect(titles[index]).toMatch(stage));
    });
  });

  it("marks a stage busy, inside its card, while its read is pending", async () => {
    mockServer.use(heldForever("/v1/criteria-sets/:id"));
    renderShell("/configure");

    const weights = await screen.findByRole("region", { name: "Pillar weights" });
    await waitFor(() =>
      expect(weights.querySelector('[aria-busy="true"]')).not.toBeNull(),
    );
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("says in stage 3 that the criteria sets could not be read, rather than asking for a choice", async () => {
    mockServer.use(failing("/v1/criteria-sets"));
    renderShell("/configure");

    const weights = within(await screen.findByRole("region", { name: "Pillar weights" }));
    expect(
      await weights.findByText("The criteria sets could not be loaded"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Choose a criteria set to see its criteria."),
    ).not.toBeInTheDocument();
  });

  it("never shows the old set's weights while the newly chosen set is read", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await weightSlider(COST_OF_LIVING);
    mockServer.use(heldForever("/v1/criteria-sets/remote_only"));

    await user.selectOptions(
      screen.getByRole("combobox", { name: /active criteria set/i }),
      "remote_only",
    );

    const weights = await screen.findByRole("region", { name: "Pillar weights" });
    await waitFor(() =>
      expect(weights.querySelector('[aria-busy="true"]')).not.toBeNull(),
    );
    expect(within(weights).queryAllByRole("slider")).toEqual([]);
  });

  it("says inside its card that a stage could not be read, and reads it again on request", async () => {
    let reads = 0;
    mockServer.use(
      http.get("/v1/settings", () => {
        reads += 1;
        return HttpResponse.json(
          { code: "internal_error", message: "broken" },
          { status: 500 },
        );
      }),
    );
    renderShell("/configure");

    const limits = within(
      await screen.findByRole("region", { name: "Acquisition limits" }),
    );
    expect(
      await limits.findByText("The acquisition limits could not be loaded"),
    ).toBeInTheDocument();
    await userEvent.click(limits.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(reads).toBe(2));
  });
});

/**
 * PL-014. **A failed catalog read is said, not silent.** The absence of a "No source yet" chip is
 * itself a claim that the attribute has a source, so the stage says it could not tell.
 */
describe("when the attribute catalog cannot be read", () => {
  it("says so in stage 3 with Try again, and draws no attribute as sourced or unsourced", async () => {
    let reads = 0;
    mockServer.use(
      http.get("/v1/attributes", () => {
        reads += 1;
        return HttpResponse.json(
          { code: "internal_error", message: "broken" },
          { status: 500 },
        );
      }),
    );
    renderShell("/configure");

    const weights = within(
      await screen.findByRole("region", { name: "Pillar weights" }),
    );
    expect(
      await weights.findByText("The attribute catalog could not be loaded"),
    ).toBeInTheDocument();
    await weightSlider(COST_OF_LIVING);
    expect(screen.queryByText(/No source yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Measured in/)).not.toBeInTheDocument();

    const before = reads;
    await userEvent.click(weights.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(reads).toBe(before + 1));
  });

  it("says nothing about the catalog once it has been read", async () => {
    renderShell("/configure");
    await weightSlider(COST_OF_LIVING);
    await settled();

    expect(
      screen.queryByText("The attribute catalog could not be loaded"),
    ).not.toBeInTheDocument();
  });
});

/**
 * PL-111. **A criterion that is not scored is a matching rule, not a weight.** Its slider moved
 * a share that counts for nothing, and its "Required" said a missing figure blocks a score it
 * never enters.
 */
describe("a criterion that is not scored", () => {
  /** The default set served with the tax criterion changed as `change` says. */
  function withTax(change: Partial<Criterion>) {
    const set = makeCriteriaSetDetails()["default"];
    if (set === undefined) throw new Error("the fixtures lost the default set");
    const criteria = (set.criteria ?? []).map((each) =>
      each.attribute === "country.total_tax_rate_effective" ? { ...each, ...change } : each,
    );
    mockServer.use(
      http.get("/v1/criteria-sets/default", () => HttpResponse.json({ ...set, criteria })),
    );
  }

  function withTaxNotScored() {
    withTax({ is_scored: false, blocks_if_missing: true });
  }

  it("is marked matching only, with its slider held and no Required", async () => {
    withTaxNotScored();
    renderShell("/configure");

    const slider = await weightSlider(TAX);
    const row = within(screen.getByRole("group", { name: TAX }));
    expect(row.getByText("Not scored, matching only")).toBeInTheDocument();
    expect(row.queryByText("Required")).not.toBeInTheDocument();
    expectHeld(slider);
  });

  it("sends no weight when its held slider is moved", async () => {
    withTaxNotScored();
    const sent: unknown[] = [];
    mockServer.use(
      http.patch("/v1/criteria-sets/:id/criteria/:attribute", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 });
      }),
    );
    renderShell("/configure");

    const slider = await weightSlider(TAX);
    fireEvent.change(slider, { target: { value: "10" } });
    fireEvent.pointerUp(slider);
    await settled();
    expect(sent).toEqual([]);
  });

  it("says the blocking box takes effect once the criterion is scored", async () => {
    withTaxNotScored();
    renderShell("/configure");
    await weightSlider(TAX);

    await userEvent.click(screen.getByRole("button", { name: `Edit the rule for ${TAX}` }));
    expect(
      screen.getByText(/takes effect once this criterion is scored/i),
    ).toBeInTheDocument();
  });

  it("keeps a scored criterion's slider live and its Required", async () => {
    withTax({ blocks_if_missing: true });
    renderShell("/configure");

    const slider = await weightSlider(TAX);
    const row = within(screen.getByRole("group", { name: TAX }));
    expect(row.getByText("Required")).toBeInTheDocument();
    expect(slider).not.toHaveAttribute("aria-disabled");
  });
});

/** PL-113. **A pillar says how much of its weight no source can fetch.** */
describe("the unsourced share of a pillar", () => {
  it("is named on the pillar's row, from the catalog and the weights", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/:id", ({ params }) =>
        HttpResponse.json({
          id: String(params["id"]),
          name: "Default",
          pillar_weights: [
            { pillar: "family", level: "country", weight: 100, weight_locked: false },
          ],
          criteria: [
            {
              attribute: "country.nobody_measures_this",
              pillar: "family",
              weight: 40,
              goal: "maximise",
              normalisation_method: "percentile",
            },
            {
              attribute: "country.cost_of_living_index",
              pillar: "family",
              weight: 60,
              goal: "minimise",
              normalisation_method: "percentile",
            },
          ],
        }),
      ),
    );
    renderShell("/configure");

    const family = await screen.findByRole("group", { name: "Family" });
    await waitFor(() =>
      expect(family).toHaveTextContent("2 attributes, 40% of the weight unsourced"),
    );
    await weightSlider(UNSOURCED_ATTRIBUTE);
    expect(screen.getByRole("group", { name: UNSOURCED_ATTRIBUTE })).toHaveTextContent(
      "Weight redistributed",
    );
  });
});

/**
 * From review. **While the catalog is being read, the share unsourced is not yet known**, and a
 * pillar line saying nothing about it read as "nothing unsourced".
 */
describe("the unsourced share while the catalog is being read", () => {
  it("says the share is not known yet, rather than nothing", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    mockServer.use(
      http.get("/v1/attributes", async () => {
        await held;
        return HttpResponse.json({ code: "internal_error", message: "late" }, { status: 500 });
      }),
    );
    renderShell("/configure");

    const economy = await screen.findByRole("group", { name: "Economy" });
    await waitFor(() =>
      expect(economy).toHaveTextContent(/attributes?; unsourced share not yet known/),
    );
  });
});

/**
 * PL-138a, from review. **A pillar's undo answers the panel on screen now**, not the one that
 * recorded the change: switching sets remounts the pillar weights, and the answer went to a
 * panel long gone while the screen kept the changed weight.
 */
describe("a pillar change undone after the panel remounted", () => {
  const economy = () => screen.getByRole<HTMLInputElement>("slider", { name: "Economy weight" });

  async function chooseSet(id: string) {
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /active criteria set/i }),
      id,
    );
  }

  it("shows the restored weights", async () => {
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });
    await settled();
    fireEvent.change(economy(), { target: { value: "50" } });
    fireEvent.pointerUp(economy());
    await waitFor(() => expect(economy()).toHaveValue("50"));

    await chooseSet("remote_only");
    await screen.findByRole("slider", { name: "Transport weight" });
    await chooseSet("default");
    await waitFor(() => expect(economy()).toHaveValue("50"));
    await settled();

    const panel = await historyPanel();
    await userEvent.click(panel.getByRole("button", { name: "Undo this" }));
    await waitFor(() => expect(economy()).toHaveValue("40"));
  });

  // PL-033: Configure writes one thing at a time, so the undo waits for the write -- and is
  // given back by the write itself once it answers, though no pillar panel is there to say so.
  it("holds Recent changes until a write answers, though its panel has unmounted", async () => {
    let answer = (): void => undefined;
    const write = new Promise<void>((resolve) => {
      answer = resolve;
    });
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => {
      answer();
      release();
    });
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });
    await settled();
    // One change to undo, made before the write that will wait.
    await saveWeight(COST_OF_LIVING, "40");
    const panel = await historyPanel();
    await panel.findByText(/Weight for Cost of living index: 50 to 40/);

    mockServer.use(
      http.put("/v1/criteria-sets/:id/pillar-weights/:pillar", async () => {
        await write;
        return HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 });
      }),
      // No set comes back, so no pillar panel mounts again to say the write is over.
      http.get("/v1/criteria-sets/remote_only", async () => {
        await held;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    fireEvent.change(economy(), { target: { value: "50" } });
    fireEvent.pointerUp(economy());
    await waitFor(() =>
      expectHeld(panel.getByRole("button", { name: "Undo this" })),
    );

    await chooseSet("remote_only");
    await waitFor(() =>
      expect(screen.queryByRole("slider", { name: "Economy weight" })).toBeNull(),
    );
    expectHeld(panel.getByRole("button", { name: "Undo this" }));
    answer();
    await waitFor(() =>
      expect(panel.getByRole("button", { name: "Undo this" })).not.toHaveAttribute(
        "aria-disabled",
      ),
    );
  });
});
