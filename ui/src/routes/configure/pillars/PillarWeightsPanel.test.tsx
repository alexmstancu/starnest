import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { makeCriteriaSetDetails } from "../../../mocks/fixtures";
import { mockServer } from "../../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
  pressArrowRight,
  snapToStep,
} from "../../../testing/keyboard";
import { renderShell } from "../../../testing/renderShell";

/**
 * The outer half of the weighting.
 *
 * **Every stored number asserted here came back from the server.** The panel sends one weight
 * and prints the rebalanced list, so a test that computed an expected rebalance would be
 * testing arithmetic the interface deliberately does not have (`arch.md` 8.3).
 *
 * The exception is what the rows show *while a pointer is down*, which the interface does work
 * out (`previewRebalance`) because the server is asked once, on release. Those figures are
 * asserted too, and the two kinds are kept apart: a preview is checked between a `change` and a
 * `pointerUp`, a stored weight only after one.
 */

const BASE = "/v1";

async function panel() {
  return within(await screen.findByRole("region", { name: "Pillar weights" }));
}

/**
 * The weight control is a slider, as the design draws it: a weight is a proportion, and the
 * question asked of it is "more or less than the one above".
 */
function weightBox(pillar: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("slider", {
    name: `${pillar} weight`,
  });
}

/**
 * **Dragging shows; letting go sends.** A range input fires `change` on every pixel of a
 * drag, so the panel commits on blur -- and so does this, which is the gesture rather than a
 * shortcut around it.
 */
async function setWeight(pillar: string, weight: string) {
  const slider = weightBox(pillar);
  fireEvent.change(slider, { target: { value: weight } });
  fireEvent.pointerUp(slider);
}

/**
 * Moves a weight without letting go, which is the half of the gesture the server never sees.
 *
 * Several calls in a row are a drag through those positions: `change` is what a range input
 * fires on every pixel of one, and nothing is sent until the pointer lifts.
 */
function drag(pillar: string, ...positions: string[]) {
  const slider = weightBox(pillar);
  for (const position of positions) {
    fireEvent.change(slider, { target: { value: position } });
  }
}

function release(pillar: string) {
  fireEvent.pointerUp(weightBox(pillar));
}

/** Every weight change the panel sends, so a test can count them as well as read them. */
function recordWeightRequests(): unknown[] {
  const sent: unknown[] = [];
  mockServer.use(
    http.put(
      `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
      async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ items: [] });
      },
    ),
  );
  return sent;
}

/**
 * The running total, read off the summary rather than off whichever element matches.
 *
 * **Scoped on purpose**: a row at 100 and a total of 100 are the same string, so a bare
 * `getByText("100.0%")` is ambiguous exactly when a drag reaches the end of the track.
 */
async function runningTotal(): Promise<string> {
  return (await panel()).getByText(/^Total/).textContent ?? "";
}

/** What one row reads, which mid-drag is the preview and otherwise the stored weight. */
function readingOf(pillar: string): string {
  return within(rowOf(pillar)).getByText(/%$/).textContent ?? "";
}

/**
 * A pillar's whole row, which is where its reading and its lock live.
 *
 * **Found by role, never by class.** `architecture.test.ts` fails a test that selects on a
 * class name, and rightly: a test coupled to the stylesheet breaks on every redesign for
 * reasons that have nothing to do with what it was checking.
 */
function rowOf(pillar: string): HTMLElement {
  return screen.getByRole("group", { name: pillar });
}

/**
 * Locks a pillar and waits for the answer.
 *
 * **One write at a time** (UI-04): every pillar control is held until an answer is in, so a
 * second click made before it would land on a held button and do nothing.
 */
async function lockPillar(pillar: string): Promise<void> {
  const disc = () => screen.getByRole("button", { name: `Lock ${pillar}` });
  await userEvent.click(disc());
  await waitFor(() => expect(disc()).toHaveAttribute("aria-pressed", "true"));
}

describe("the pillar weights panel", () => {
  it("shows each pillar's weight and what they sum to", async () => {
    renderShell("/configure");
    const pillars = await panel();

    expect(
      await screen.findByRole<HTMLInputElement>("slider", {
        name: "Economy weight",
      }),
    ).toHaveValue("40");
    expect(weightBox("Housing")).toHaveValue("35");
    expect(weightBox("Safety")).toHaveValue("25");
    // The total is the summary's, beside the design's own line. That line states the rule for
    // the hundred *inside* a pillar while sitting beside the pillar total, which reads oddly
    // and is what the live design says; it was changed to the pillar rule once on that
    // reasoning and changed back when the design was read again.
    expect(
      pillars.getByText(/Attribute weights sum to 100 inside each pillar/),
    ).toBeInTheDocument();
    expect(pillars.getByText("100.0%")).toBeInTheDocument();
  });

  it("shows the weights the server rebalanced to", async () => {
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await setWeight("Economy", "50");

    // Housing and safety absorbed the ten points between them, in proportion. The figures are
    // the response's: the slider snaps to its half-point step, and the reading beside it is
    // the server's own number, which is the one that decides anything.
    //
    // **All three inside one `waitFor`, and every row re-queried inside it.** They arrive in a
    // single PATCH response, so checking one and then asserting the other two against elements
    // captured earlier would read a subtree that had since re-rendered.
    // **A longer budget than the suite's five seconds, for this one assertion.** It waits on
    // a write round trip *and* a re-render of the whole Configure screen, which since the
    // attribute blocks landed draws every pillar's criteria and reads the catalog. It timed
    // out twice in `make check` and never in a direct run -- the difference is machine load,
    // not correctness, and the assertion below is the one that proves the rebalance is the
    // server's rather than ours.
    await waitFor(
      () => {
        expect(within(rowOf("Housing")).getByText("29.2%")).toBeInTheDocument();
        expect(within(rowOf("Safety")).getByText("20.8%")).toBeInTheDocument();
        expect(within(rowOf("Economy")).getByText("50.0%")).toBeInTheDocument();
      },
      { timeout: 15_000 },
    );
  });

  it("sends the weight the pointer left, and sends it once", async () => {
    /**
     * **The request, not the re-render.** The test below reads the rebalanced figures back off
     * the screen, which means it waits for a PUT *and* a full re-render of a screen that now
     * draws every pillar's attributes. This one waits only for the request, so "the gesture
     * sends the right weight" stays provable when the render is slow.
     *
     * One entry, not several: `change` fires on every pixel of a drag and only the release
     * sends, which is the whole reason the commit is on `pointerUp`.
     */
    const sent: unknown[] = [];
    mockServer.use(
      http.put(
        `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
        async ({ request }) => {
          sent.push(await request.json());
          return HttpResponse.json({ items: [] });
        },
      ),
    );
    renderShell("/configure");
    const slider = await screen.findByRole("slider", {
      name: "Economy weight",
    });

    fireEvent.change(slider, { target: { value: "50" } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(sent).toEqual([{ weight: 50 }]));
  });

  it("commits a weight set with the arrow keys, not only one dragged", async () => {
    // A range input moves on arrow keys, and a keyboard user never lifts a pointer. The four
    // handlers -- pointer up, mouse up, key up, blur -- are one event ("the reader has stopped
    // moving this"), and this is the one a mouse test can never reach.
    const sent: unknown[] = [];
    mockServer.use(
      http.put(
        `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
        async ({ request }) => {
          sent.push(await request.json());
          return HttpResponse.json({ items: [] });
        },
      ),
    );
    renderShell("/configure");
    const slider = await screen.findByRole("slider", {
      name: "Economy weight",
    });

    fireEvent.change(slider, { target: { value: "45" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });

    await waitFor(() => expect(sent).toEqual([{ weight: 45 }]));
  });

  it("locks a pillar and unlocks it again", async () => {
    // **The round trip, which nothing covered** (P68). The disc sent the lock *with* the
    // weight, and the server refuses moving a locked weight even to the value it already
    // holds -- so the second click answered 409 and the disc stayed filled for ever. The
    // mock accepted both together, so no unit test could see it.
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });
    const disc = () => screen.getByRole("button", { name: "Lock Economy" });

    await user.click(disc());
    await waitFor(() => expect(disc()).toHaveAttribute("aria-pressed", "true"));

    await user.click(disc());

    await waitFor(() => expect(disc()).toHaveAttribute("aria-pressed", "false"));
    // Nothing was refused on the way back out.
    expect(screen.queryByText(/weights_all_locked/)).toBeNull();
  });

  it("draws its lock as a padlock, shut when locked and open when free, never a disc", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });
    const lock = () => screen.getByRole("button", { name: "Lock Economy" });
    const padlock = () => lock().querySelector("svg");

    expect(padlock()).toHaveAttribute("data-state", "open");
    expect(lock()).toHaveTextContent(/^$/);

    await user.click(lock());

    await waitFor(() => expect(padlock()).toHaveAttribute("data-state", "shut"));
    expect(lock()).not.toHaveTextContent(/[\u25CF\u25CB]/);
  });

  it("sends the lock without a weight, because a locked weight cannot be moved", async () => {
    const sent: unknown[] = [];
    mockServer.events.on("request:start", async ({ request }) => {
      if (request.method === "PUT" && request.url.includes("pillar-weights")) {
        sent.push(await request.clone().json());
      }
    });
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await user.click(screen.getByRole("button", { name: "Lock Economy" }));

    await waitFor(() => expect(sent).toEqual([{ weight_locked: true }]));
  });

  it("refuses the change when every other pillar is locked, and says which", async () => {
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await lockPillar("Housing");
    await lockPillar("Safety");
    await setWeight("Economy", "10");

    const pillars = await panel();
    expect(await pillars.findByText(/every other weight in this pillar is locked/i)).toBeInTheDocument();
    // The refused weight is not shown as though it had been stored.
    expect(weightBox("Housing")).toHaveValue("35");
  });

  /**
   * **The control cannot express a wrong answer.** A text field could hold "ten", which is why
   * the panel used to have to report it (P56); a slider cannot, so there is no nonsense value
   * to reject -- the browser replaces one with the midpoint of the track before React is told,
   * and what arrives is an ordinary drag to an ordinary weight.
   *
   * **This test used to assert the opposite and passed for the wrong reason.** It read the rows
   * back before the response it had just provoked could land, so "nothing was sent" was never
   * checked and was not true: 50 was sent. The guard against text that is not a number is
   * `weightFrom`, and it is tested where it lives.
   */
  it("drags to the midpoint of the track when handed a value no slider can hold", async () => {
    const sent = recordWeightRequests();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await setWeight("Economy", "ten");

    await waitFor(() => expect(sent).toEqual([{ weight: 50 }]));
  });

  it("says so when the set weighs no pillar yet", async () => {
    // Create copies the default now (PL-034), so a set that weighs nothing is served directly.
    const { default: shipped } = makeCriteriaSetDetails();
    mockServer.use(
      http.get("/v1/criteria-sets/:criteriaSetId", () =>
        HttpResponse.json({ ...shipped, pillar_weights: [], criteria: [] }),
      ),
    );
    renderShell("/configure");

    expect(
      await screen.findByText("This set weighs no pillar yet."),
    ).toBeInTheDocument();
  });
});

/**
 * The half of the gesture the server never sees.
 *
 * **One request still goes, on release.** What these cover is the preview in between: moving one
 * weight moves the others, and the panel works that out locally (`previewRebalance`) so the set
 * does not sit visibly off 100 for the length of a drag. Every figure asserted here is checked
 * **before** any release, so nothing in this block can be read off a response by accident.
 */
describe("the pillar weights panel while a pointer is down", () => {
  it("moves the other pillars as the pointer moves, before anything is sent", async () => {
    const sent = recordWeightRequests();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    drag("Economy", "45", "50", "55");

    // 45 left to share in the ratio 35:25, which is 26.25 and 18.75 -- the same arithmetic
    // `rebalance()` does, and the same figures it will send back.
    await waitFor(() => expect(readingOf("Housing")).toBe("26.3%"));
    expect(readingOf("Safety")).toBe("18.8%");
    expect(sent).toEqual([]);
  });

  it("keeps the dragged row on the pointer's own position", async () => {
    // Not on its preview, although the two are the same number: a row that re-rendered its
    // slider from a value computed elsewhere would have the thumb fighting the cursor.
    recordWeightRequests();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    drag("Economy", "55");

    await waitFor(() => expect(readingOf("Economy")).toBe("55.0%"));
    expect(weightBox("Economy")).toHaveValue("55");
  });

  it("keeps the total at 100 for the whole gesture", async () => {
    const sent = recordWeightRequests();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    for (const position of ["12", "37.5", "88", "0", "100"]) {
      drag("Economy", position);
      // Compared with slack rather than exactly, which is `comesToAHundred`'s whole job: a
      // rebalance divides 100 and the result rarely lands on it in binary floating point.
      await waitFor(async () => expect(await runningTotal()).toContain("100.0%"));
    }
    expect(sent).toEqual([]);
  });

  it("sends nothing while the pointer is down, and one weight when it lifts", async () => {
    const sent = recordWeightRequests();
    renderShell("/configure");
    const slider = await screen.findByRole("slider", { name: "Economy weight" });

    drag("Economy", "45", "50", "55");
    await waitFor(() => expect(readingOf("Housing")).toBe("26.3%"));
    expect(sent).toEqual([]);

    fireEvent.pointerUp(slider);

    await waitFor(() => expect(sent).toEqual([{ weight: 55 }]));
  });

  it("sends nothing when the pointer lifts where it took hold", async () => {
    const sent = recordWeightRequests();
    renderShell("/configure");
    const slider = await screen.findByRole("slider", { name: "Economy weight" });

    drag("Economy", "60", "40");
    fireEvent.pointerUp(slider);

    // Nothing moved, so nothing is sent -- and the gesture has to end itself, because no
    // answer is coming to end it.
    await waitFor(() => expect(readingOf("Housing")).toBe("35.0%"));
    expect(sent).toEqual([]);
  });

  it("holds a locked pillar where it is and leaves the rest to absorb the change", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await user.click(screen.getByRole("button", { name: "Lock Housing" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Lock Housing" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    const sent = recordWeightRequests();
    drag("Economy", "50");

    // Housing holds its 35, so the whole ten points come out of safety's 25.
    await waitFor(() => expect(readingOf("Safety")).toBe("15.0%"));
    expect(readingOf("Housing")).toBe("35.0%");
    expect(sent).toEqual([]);
  });

  it("moves nothing when the locks leave no room, and says so on release", async () => {
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await lockPillar("Housing");
    await lockPillar("Safety");

    drag("Economy", "10");

    // **No preview, and no refusal in the interface's own words.** Nothing can absorb the
    // change, so the siblings hold still -- and the total reads what the three rows actually
    // come to rather than a reassuring 100, which is the gesture saying it will not be taken.
    await waitFor(() => expect(readingOf("Economy")).toBe("10.0%"));
    expect(readingOf("Housing")).toBe("35.0%");
    expect(readingOf("Safety")).toBe("25.0%");
    expect(await runningTotal()).toContain("70.0%");

    release("Economy");

    // The refusal is the server's, with the locks it names.
    expect(
      await (await panel()).findByText(/every other weight in this pillar is locked/i),
    ).toBeInTheDocument();
    expect(readingOf("Housing")).toBe("35.0%");
  });

  it("previews nothing in a level of one pillar, which already holds the hundred", async () => {
    mockServer.use(
      http.get(`${BASE}/criteria-sets/:criteriaSetId`, () =>
        HttpResponse.json({
          id: "default",
          name: "Default",
          pillar_weights: [
            { pillar: "economics", weight: 100, weight_locked: false },
          ],
          criteria: [],
          enforced_match_rules: [],
          applied_compound_rules: [],
        }),
      ),
    );
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    drag("Economy", "60");

    // There is no sibling to absorb it, lock or no lock, so the only thing that moves is the
    // row under the pointer -- and the total says the set no longer adds up.
    await waitFor(() => expect(readingOf("Economy")).toBe("60.0%"));
    expect(await runningTotal()).toContain("60.0%");
  });

  /**
   * **The one bug that would ruin this**, and the sequence that can see it.
   *
   * Every frame of a drag is computed from the weights as they stood when the drag began, which
   * is what the server does with the stored weights on every request. A client that fed each
   * preview into the next would agree for an ordinary drag -- proportional sharing keeps the
   * siblings' ratios -- and then lose the reader's 35:25 for good the moment the drag touched
   * the top of the track, where every absorber is at zero and the way back down is an even
   * split. 76 shared 35:25 is 44.3 and 31.7; shared evenly it is 38.0 each.
   */
  it("keeps the shape of the set when the drag goes up to 100 and back", async () => {
    recordWeightRequests();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    drag("Economy", "60", "100", "24");

    await waitFor(() => expect(readingOf("Housing")).toBe("44.3%"));
    expect(readingOf("Safety")).toBe("31.7%");
  });

  it("replaces the preview with the server's answer, even when the two disagree", async () => {
    /**
     * **The preview is not an authority.** Whatever the server says a pillar now weighs is what
     * the row shows, and the answer landing is also what ends the gesture -- a preview left
     * standing over the response would be a figure nobody can account for.
     *
     * An answer no rebalance would produce is the only way to tell the two apart: the preview
     * and the real thing agree to the last decimal by construction, which is the point of them.
     */
    mockServer.use(
      http.put(
        `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
        () =>
          HttpResponse.json({
            items: [
              { pillar: "economics", weight: 55, weight_locked: false },
              { pillar: "housing", weight: 10, weight_locked: false },
              { pillar: "safety", weight: 35, weight_locked: false },
            ],
          }),
      ),
    );
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    drag("Economy", "55");
    await waitFor(() => expect(readingOf("Housing")).toBe("26.3%"));

    release("Economy");

    await waitFor(() => expect(readingOf("Housing")).toBe("10.0%"));
    expect(readingOf("Safety")).toBe("35.0%");
  });

  it("takes a fresh hold after a release that sent nothing", async () => {
    /**
     * A release that moves nothing sends nothing, so no answer comes back to end the gesture --
     * which is why the row ends it itself. Left open, the next drag of the same weight would be
     * computed from the weights as they stood **two gestures ago**, and a lock taken in between
     * would be missing from them: the screen would preview a rebalance the server is about to
     * refuse.
     */
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    drag("Economy", "60", "40");
    release("Economy");
    await user.click(screen.getByRole("button", { name: "Lock Economy" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Lock Economy" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    drag("Economy", "50");

    // Economy is locked now, so nothing can be previewed at all: housing holds where it is and
    // the total says the set no longer adds up, which is the refusal coming.
    await waitFor(() => expect(readingOf("Economy")).toBe("50.0%"));
    expect(readingOf("Housing")).toBe("35.0%");
    expect(await runningTotal()).toContain("110.0%");
  });
});

/**
 * UI-04 and UI-05. **One pillar write at a time, and one per gesture.** Every pillar answer is
 * the whole level rebalanced, so two in flight can land in either order; and a range input ends
 * one gesture with up to four events -- pointer, mouse, key and blur -- each of which used to
 * send the weight again while the first answer was on its way.
 */
describe("the pillar weights panel while a change is being saved", () => {
  /**
   * Holds every pillar write until the test lets go, then lets the mock answer it as usual:
   * returning nothing hands the request on to the stateful handler behind this one.
   */
  function holdPillarWrites(): { sent: unknown[]; release: () => void } {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    mockServer.use(
      http.put(
        `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
        async ({ request }) => {
          sent.push(await request.clone().json());
          await held;
        },
      ),
    );
    return { sent, release: () => release() };
  }

  /** Every pillar write, recorded and then answered by the stateful mock behind this one. */
  function recordAnsweredWrites(): unknown[] {
    const sent: unknown[] = [];
    mockServer.use(
      http.put(
        `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
        async ({ request }) => {
          sent.push(await request.clone().json());
        },
      ),
    );
    return sent;
  }

  it("holds every pillar still while one pillar's weight is being saved", async () => {
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });
    // Locked first, so the drag below previews nothing for it and a stray release on it would
    // send the weight its slider holds.
    await lockPillar("Safety");
    const writes = holdPillarWrites();

    await setWeight("Economy", "50");
    await waitFor(() => expect(writes.sent).toHaveLength(1));

    expectHeld(weightBox("Housing"));
    expectHeld(weightBox("Economy"));
    expectHeld(screen.getByRole("button", { name: "Lock Housing" }));
    expectHeld(screen.getByRole("button", { name: "Lock Economy" }));
    // The rebalance the drag previewed stands until its answer replaces it.
    expect(readingOf("Housing")).toBe("25.0%");
    // A held slider still hears a pointer -- it is not disabled -- so the panel refuses it:
    // nothing moves, and the preview is not ended by a release no gesture started.
    fireEvent.change(weightBox("Safety"), { target: { value: "30" } });
    fireEvent.pointerUp(weightBox("Safety"));
    expect(weightBox("Safety")).toHaveValue("25");
    expect(readingOf("Housing")).toBe("25.0%");

    writes.release();

    await waitFor(() => expectNotHeld(weightBox("Housing")));
    expectNotHeld(screen.getByRole("button", { name: "Lock Housing" }));
    expect(writes.sent).toEqual([{ weight: 50 }]);
    // And the thumb it moved goes back to the weight the server holds.
    await waitFor(() => expect(weightBox("Safety")).toHaveValue("25"));
  });

  it("holds every pillar still while a lock is being saved", async () => {
    const writes = holdPillarWrites();
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await user.click(screen.getByRole("button", { name: "Lock Housing" }));
    await waitFor(() => expect(writes.sent).toEqual([{ weight_locked: true }]));

    expectHeld(weightBox("Economy"));
    expectHeld(screen.getByRole("button", { name: "Lock Safety" }));

    writes.release();

    await waitFor(() => expectNotHeld(weightBox("Economy")));
  });

  it("sends one weight for one release, even when the mouse and focus let go too", async () => {
    const sent = recordAnsweredWrites();
    renderShell("/configure");
    const slider = await screen.findByRole("slider", { name: "Economy weight" });

    fireEvent.change(slider, { target: { value: "50" } });
    fireEvent.pointerUp(slider);
    fireEvent.mouseUp(slider);
    fireEvent.blur(slider);
    await waitFor(() => expect(readingOf("Housing")).toBe("29.2%"), {
      timeout: 15_000,
    });
    await waitFor(() => expectNotHeld(weightBox("Economy")));
    // A later gesture, so every request the first one could have made is in before this is read.
    fireEvent.change(weightBox("Economy"), { target: { value: "45" } });
    fireEvent.pointerUp(weightBox("Economy"));

    await waitFor(() => expect(sent.at(-1)).toEqual({ weight: 45 }));
    expect(sent).toEqual([{ weight: 50 }, { weight: 45 }]);
  });

  it("puts the thumb back after a refused weight, and the next blur sends nothing", async () => {
    const sent: unknown[] = [];
    mockServer.use(
      http.put(
        `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
        async ({ request }) => {
          sent.push(await request.json());
          return HttpResponse.json(
            { code: "weights_all_locked", message: "Every other pillar is locked." },
            { status: 409 },
          );
        },
      ),
    );
    renderShell("/configure");
    const slider = await screen.findByRole("slider", { name: "Economy weight" });

    fireEvent.change(slider, { target: { value: "50" } });
    fireEvent.pointerUp(slider);
    expect(
      await (await panel()).findByText(/every other weight in this pillar is locked/i),
    ).toBeInTheDocument();

    await waitFor(() => expect(weightBox("Economy")).toHaveValue("40"));
    fireEvent.blur(weightBox("Economy"));
    // A gesture that does send, so the blur before it has had every chance to send too.
    fireEvent.change(weightBox("Economy"), { target: { value: "45" } });
    fireEvent.pointerUp(weightBox("Economy"));

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([{ weight: 50 }, { weight: 45 }]);
  });

  it("sends once for a gesture made with the keys, however focus then leaves", async () => {
    const sent = recordAnsweredWrites();
    renderShell("/configure");
    const slider = await screen.findByRole("slider", { name: "Economy weight" });

    fireEvent.change(slider, { target: { value: "45" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    fireEvent.blur(slider);
    await waitFor(() => expect(readingOf("Economy")).toBe("45.0%"), {
      timeout: 15_000,
    });
    await waitFor(() => expectNotHeld(weightBox("Economy")));
    fireEvent.change(weightBox("Economy"), { target: { value: "50" } });
    fireEvent.pointerUp(weightBox("Economy"));

    await waitFor(() => expect(sent.at(-1)).toEqual({ weight: 50 }));
    expect(sent).toEqual([{ weight: 45 }, { weight: 50 }]);
  });

  /**
   * NEW-34. **Held, never disabled.** Chromium throws focus off a control the moment it is
   * disabled and does not give it back, so a keyboard user who nudged a weight or pressed a lock
   * landed on the page after every step and had to tab back. jsdom keeps focus on a disabled
   * control, which is why these follow Chromium's rule rather than jsdom's.
   */
  describe("from the keyboard", () => {
    beforeEach(() => followChromiumFocusFixup());

    it("keeps focus on a slider while its weight is saved, and steps it no further until then", async () => {
      const user = userEvent.setup();
      const writes = holdPillarWrites();
      renderShell("/configure");
      const slider = await screen.findByRole("slider", { name: "Economy weight" });
      act(() => slider.focus());

      await pressArrowRight(user);
      await waitFor(() => expect(writes.sent).toEqual([{ weight: 40.5 }]));

      expect(slider).toHaveFocus();
      expectHeld(slider);
      // A second step while the first is on its way: nothing moves and nothing is sent.
      await pressArrowRight(user);
      expect(slider).toHaveValue("40.5");
      expect(readingOf("Economy")).toBe("40.0%");

      writes.release();

      await waitFor(() => expect(readingOf("Economy")).toBe("40.5%"));
      await waitFor(() => expectNotHeld(slider));
      expect(slider).toHaveFocus();
      await pressArrowRight(user);
      // The third step's request arriving is what proves the second sent nothing.
      await waitFor(() => expect(writes.sent).toHaveLength(2));
      expect(writes.sent).toEqual([{ weight: 40.5 }, { weight: 41 }]);
    });

    it("keeps focus on a lock while it is saved, and a second press sends nothing", async () => {
      const user = userEvent.setup();
      const writes = holdPillarWrites();
      renderShell("/configure");
      await screen.findByRole("slider", { name: "Economy weight" });
      const lock = screen.getByRole("button", { name: "Lock Housing" });
      act(() => lock.focus());

      await user.keyboard(" ");
      await waitFor(() => expect(writes.sent).toEqual([{ weight_locked: true }]));

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
        { weight_locked: true },
        { weight_locked: false },
      ]);
    });

    it("lets go of the slider after a refused weight, with focus still on it", async () => {
      mockServer.use(
        http.put(
          `${BASE}/criteria-sets/:criteriaSetId/pillar-weights/:pillarId`,
          () =>
            HttpResponse.json(
              { code: "weights_all_locked", message: "Every other pillar is locked." },
              { status: 409 },
            ),
        ),
      );
      const user = userEvent.setup();
      renderShell("/configure");
      const slider = await screen.findByRole("slider", { name: "Economy weight" });
      act(() => slider.focus());

      await pressArrowRight(user);

      expect(
      await (await panel()).findByText(/every other weight in this pillar is locked/i),
    ).toBeInTheDocument();
      await waitFor(() => expectNotHeld(slider));
      expect(slider).toHaveFocus();
      await waitFor(() => expect(slider).toHaveValue("40"));
    });
  });
});

/**
 * NEW-43. **A slider nobody moved sends nothing.** A rebalance leaves weights between two steps
 * of the slider, and Chromium holds a slider's value snapped to its step -- so a release with no
 * movement before it (focus arriving by Tab, a thumb clicked and let go) used to send the snapped
 * weight, which nobody chose, and rebalance every other pillar around it.
 */
describe("a pillar slider nobody moved", () => {
  beforeEach(() => {
    const set = makeCriteriaSetDetails()["default"];
    mockServer.use(
      http.get(`${BASE}/criteria-sets/:criteriaSetId`, () =>
        HttpResponse.json({
          ...set,
          pillar_weights: [
            { pillar: "economics", level: "country", weight: 40.2, weight_locked: false },
            { pillar: "housing", level: "country", weight: 34.8, weight_locked: false },
            { pillar: "safety", level: "country", weight: 25, weight_locked: false },
          ],
        }),
      ),
    );
  });

  /** Economy's slider as Chromium holds it: 40.2 snapped to the step, which reads 40. */
  async function snappedEconomy(): Promise<HTMLInputElement> {
    renderShell("/configure");
    await waitFor(() => expect(readingOf("Economy")).toBe("40.2%"));
    const slider = weightBox("Economy");
    snapToStep(slider);
    expect(slider.value, "the premise: the slider reads a weight nobody chose").toBe("40");
    return slider;
  }

  /** A real gesture on another pillar, so anything the first could have sent is in before it. */
  async function thenAMovedWeight(sent: unknown[]): Promise<void> {
    await setWeight("Safety", "30");
    await waitFor(() => expect(sent.at(-1)).toEqual({ weight: 30 }));
  }

  it("sends nothing when focus arrives on it and leaves again", async () => {
    const sent = recordWeightRequests();
    const slider = await snappedEconomy();

    // Tab lands here: the key comes up on the slider, and focus later moves on.
    fireEvent.keyUp(slider, { key: "Tab" });
    fireEvent.blur(slider);

    expectNotHeld(slider);
    await thenAMovedWeight(sent);
    expect(sent).toEqual([{ weight: 30 }]);
  });

  it("sends nothing when its thumb is clicked and let go without moving", async () => {
    const sent = recordWeightRequests();
    const slider = await snappedEconomy();

    fireEvent.pointerUp(slider);
    fireEvent.mouseUp(slider);

    expectNotHeld(slider);
    await thenAMovedWeight(sent);
    expect(sent).toEqual([{ weight: 30 }]);
  });

  it("still sends the weight a key moved it to, once", async () => {
    const user = userEvent.setup();
    const sent = recordWeightRequests();
    const slider = await snappedEconomy();
    slider.focus();

    await pressArrowRight(user);
    fireEvent.blur(slider);

    await waitFor(() => expect(sent).toEqual([{ weight: 40.5 }]));
  });
});


/** PL-114 and PL-115. Stage 3 in the design's colours, without the two jargon paragraphs. */
describe("stage 3 as the design draws it", () => {
  function servedWithWeights(weights: number[]) {
    const set = makeCriteriaSetDetails()["default"];
    if (set === undefined) throw new Error("the fixtures lost the default set");
    const pillarWeights = (set.pillar_weights ?? []).map((each, index) => ({
      ...each,
      weight: weights[index] ?? each.weight,
    }));
    mockServer.use(
      http.get("/v1/criteria-sets/default", () =>
        HttpResponse.json({ ...set, pillar_weights: pillarWeights }),
      ),
    );
  }

  it("draws a total of 100 in green", async () => {
    renderShell("/configure");
    const pillars = await panel();
    expect(await pillars.findByText("100.0%")).toHaveClass("chip--matching");
  });

  it("draws a total that is not 100 in red", async () => {
    servedWithWeights([40, 35, 20]);
    renderShell("/configure");
    const pillars = await panel();
    expect(await pillars.findByText("95.0%")).toHaveClass("chip--not_matching");
  });

  it("tints the open pillar, and only that one", async () => {
    renderShell("/configure");
    await panel();
    await userEvent.click(await screen.findByRole("button", { name: /^Economy/ }));

    expect(screen.getByRole("group", { name: "Economy" })).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("group", { name: "Housing" })).not.toHaveAttribute("data-open");
  });

  it("draws each pillar's criteria total in green, and says nothing about a backend", async () => {
    renderShell("/configure");
    await panel();
    await userEvent.click(await screen.findByRole("button", { name: /^Economy/ }));

    const totals = await screen.findByRole("list", { name: "Weight totals by pillar" });
    within(totals)
      .getAllByRole("listitem")
      .forEach((total) => expect(total).toHaveClass("chip--matching"));
    expect(screen.queryByText(/backend/i)).not.toBeInTheDocument();
  });
});
