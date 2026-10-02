import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import { renderShell } from "../../../testing/renderShell";

/**
 * The outer half of the weighting.
 *
 * **Every number asserted here came back from the server.** The panel sends one weight and
 * prints the rebalanced list, so a test that computed an expected rebalance would be testing
 * arithmetic the interface deliberately does not have (`arch.md` 8.3).
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
 * A pillar's whole row, which is where its reading and its lock live.
 *
 * **Found by role, never by class.** `architecture.test.ts` fails a test that selects on a
 * class name, and rightly: a test coupled to the stylesheet breaks on every redesign for
 * reasons that have nothing to do with what it was checking.
 */
function rowOf(pillar: string): HTMLElement {
  return screen.getByRole("group", { name: pillar });
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
    const user = userEvent.setup();
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await user.click(screen.getByRole("button", { name: "Lock Housing" }));
    await user.click(screen.getByRole("button", { name: "Lock Safety" }));
    await setWeight("Economy", "10");

    const pillars = await panel();
    expect(await pillars.findByText(/weights_all_locked/)).toBeInTheDocument();
    // The refused weight is not shown as though it had been stored.
    expect(weightBox("Housing")).toHaveValue("35");
  });

  /**
   * **The control cannot express a wrong answer.** A text field could hold "ten", which is
   * why the panel used to have to report it (P56); a slider holds a number or nothing, so a
   * nonsense value is not rejected here -- it cannot be produced. The criterion rows, which
   * are still typed, keep that test of their own.
   */
  it("never sends a weight that is not a number", async () => {
    renderShell("/configure");
    await screen.findByRole("slider", { name: "Economy weight" });

    await setWeight("Economy", "ten");

    // Nothing moved, and nothing was sent: the browser refused the value before React saw it.
    expect(weightBox("Housing")).toHaveValue("35");
    expect(within(rowOf("Economy")).getByText("40.0%")).toBeInTheDocument();
  });

  it("says so when the set weighs no pillar yet", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sets = within(
      await screen.findByRole("region", { name: /^criteria set/i }),
    );

    await user.type(
      sets.getByRole("textbox", { name: /name a new set/i }),
      "Empty",
    );
    await user.click(sets.getByRole("button", { name: "Create set" }));

    expect(
      await screen.findByText("This set weighs no pillar yet."),
    ).toBeInTheDocument();
  });
});
