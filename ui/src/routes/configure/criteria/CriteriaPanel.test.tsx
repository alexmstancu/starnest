import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
import { renderShell } from "../../../testing/renderShell";

/**
 * The inner half of the weighting, while a pointer is down.
 *
 * **One request still goes, when the pointer lifts.** What these cover is the preview in
 * between: a criterion's weight is a share of its pillar's hundred, so moving one moves the
 * rest of that pillar, and the panel works that out locally (`previewRebalance`) rather than
 * leaving the pillar visibly off 100 for the length of a drag.
 *
 * **Every figure asserted during a drag is checked before any release**, so nothing here can be
 * read off a response by accident. The stored weights, the rebalance the server actually
 * performs and the refusals all have their tests in `ConfigureScreen.test.tsx`, which drives
 * the same panel through whole gestures.
 */

const BASE = "/v1";

/**
 * The attributes inside a pillar, which is where their weights are changed.
 *
 * A criterion's weight is a share of its pillar's, so the screen keeps it there and the way to
 * reach one is to open the pillar it belongs to.
 */
async function openPillar(pillar: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: new RegExp(`^${pillar}`) }),
  );
}

/**
 * Waits until the screen has finished loading.
 *
 * **Reading a weight off a half-loaded screen is a race, not a slow test** (`known-issues.md`
 * P13): a response landing mid-drag re-renders the row the drag is in. The source priority
 * table is the last panel to arrive, so its presence means the rest have arrived too.
 */
async function settled(): Promise<void> {
  await screen.findByRole("region", { name: "Source priority" });
  await waitFor(() =>
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument(),
  );
}

/**
 * The criteria these tests drive, **named as the screen names them**.
 *
 * The design bars programmatic identifiers from rendered text, so a row is found by what it is
 * called rather than by the key the criterion carries. All but the first are the id read as
 * words: the mock's catalog has an entry for four attributes and the screen shows seven
 * criteria, so most rows exercise the fallback -- the path that used to print a key.
 */
const COST_OF_LIVING = "Cost of living index";
/** The catalog's name, which is **not** the id read as words -- the words are in another order. */
const TAX = "Total effective tax rate";
const OUTLOOK = "Economic outlook";
const HOMICIDE = "Homicide rate";
const PERCEIVED_SAFETY = "Perceived safety index";

function rowOf(criterion: string): HTMLElement {
  return screen.getByRole("group", { name: criterion });
}

/** What one row reads, which mid-drag is the preview and otherwise the stored weight. */
function readingOf(criterion: string): string {
  return within(rowOf(criterion)).getByText(/%$/).textContent ?? "";
}

/** What a pillar's criteria come to, as the chip above the rows reports it. */
function pillarTotal(pillar: string): string {
  return (
    within(
      screen.getByRole("list", { name: "Weight totals by pillar" }),
    ).getByText(new RegExp(`^${pillar}`)).textContent ?? ""
  );
}

/**
 * Moves a weight without letting go, which is the half of the gesture the server never sees.
 *
 * Several positions are a drag through them: `change` is what a range input fires on every
 * pixel of one, and nothing is sent until the pointer lifts.
 */
function drag(criterion: string, ...positions: string[]) {
  const slider = screen.getByRole("slider", { name: `Weight for ${criterion}` });
  for (const position of positions) {
    fireEvent.change(slider, { target: { value: position } });
  }
}

function release(criterion: string) {
  fireEvent.pointerUp(
    screen.getByRole("slider", { name: `Weight for ${criterion}` }),
  );
}

/** Every weight change the panel sends, so a test can count them as well as read them. */
function recordWeightRequests(): unknown[] {
  const sent: unknown[] = [];
  mockServer.use(
    http.patch(
      `${BASE}/criteria-sets/:criteriaSetId/criteria/:attributeId`,
      async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ pillar: "economics", criteria: [] });
      },
    ),
  );
  return sent;
}

describe("the criteria panel while a pointer is down", () => {
  it("moves the rest of the pillar as the pointer moves, before anything is sent", async () => {
    renderShell("/configure");
    await openPillar("Economy");
    await settled();
    const sent = recordWeightRequests();

    drag(COST_OF_LIVING, "40", "30");

    // Economy holds three criteria: 50, 30 and a locked 20. Taking the first to 30 leaves 50
    // for the one unlocked sibling, and the lock holds where it is.
    await waitFor(() =>
      expect(readingOf(TAX)).toBe("50.0%"),
    );
    expect(readingOf(OUTLOOK)).toBe("20.0%");
    expect(sent).toEqual([]);
  });

  it("keeps the pillar at 100 for the whole gesture", async () => {
    renderShell("/configure");
    await openPillar("Economy");
    await settled();
    recordWeightRequests();

    for (const position of ["10", "45.5", "80", "0"]) {
      drag(COST_OF_LIVING, position);
      await waitFor(() => expect(pillarTotal("Economy")).toContain("100.0%"));
    }
  });

  it("keeps the dragged row on the pointer's own position", async () => {
    renderShell("/configure");
    await openPillar("Economy");
    await settled();
    recordWeightRequests();

    drag(COST_OF_LIVING, "22.5");

    await waitFor(() =>
      expect(readingOf(COST_OF_LIVING)).toBe("22.5%"),
    );
    expect(
      screen.getByRole("slider", {
        name: `Weight for ${COST_OF_LIVING}`,
      }),
    ).toHaveValue("22.5");
  });

  it("sends nothing while the pointer is down, and one weight when it lifts", async () => {
    renderShell("/configure");
    await openPillar("Economy");
    await settled();
    const sent = recordWeightRequests();

    drag(COST_OF_LIVING, "45", "40", "35");
    await waitFor(() =>
      expect(readingOf(TAX)).toBe("45.0%"),
    );
    expect(sent).toEqual([]);

    release(COST_OF_LIVING);

    await waitFor(() => expect(sent).toEqual([{ weight: 35 }]));
  });

  it("sends nothing when the pointer lifts where it took hold", async () => {
    renderShell("/configure");
    await openPillar("Economy");
    await settled();
    const sent = recordWeightRequests();

    drag(COST_OF_LIVING, "80", "50");
    release(COST_OF_LIVING);

    // Nothing moved, so nothing is sent -- and the gesture ends itself, because no answer is
    // coming to end it.
    await waitFor(() =>
      expect(readingOf(TAX)).toBe("30.0%"),
    );
    expect(sent).toEqual([]);
  });

  it("moves nothing when the only sibling is locked, and says so on release", async () => {
    renderShell("/configure");
    await openPillar("Safety");
    await settled();

    drag(HOMICIDE, "40");

    // **No preview, and no refusal in the interface's own words.** Safety holds two criteria
    // and one of them is locked, so there is nothing to absorb the change: the sibling holds
    // still and the pillar reads what its rows actually come to rather than a reassuring 100.
    await waitFor(() => expect(readingOf(HOMICIDE)).toBe("40.0%"));
    expect(readingOf(PERCEIVED_SAFETY)).toBe("35.0%");
    expect(pillarTotal("Safety")).toContain("75.0%");

    release(HOMICIDE);

    // The refusal is the server's, and it names the lock that is in the way.
    expect(await screen.findByText(/weights_all_locked/)).toBeInTheDocument();
    const locked = within(
      screen.getByRole("list", { name: /Locked, so unable to absorb/ }),
    );
    expect(locked.getByText(PERCEIVED_SAFETY)).toBeInTheDocument();
    // And the row the drag refused goes back to the weight that is stored.
    await waitFor(() => expect(readingOf(HOMICIDE)).toBe("65.0%"));
  });

  /**
   * **The one bug that would ruin this**, and the sequence that can see it.
   *
   * Every frame is computed from the weights as they stood when the drag began, which is what
   * the server does with the stored weights on every request. A client that fed each preview
   * into the next would agree for an ordinary drag -- proportional sharing keeps the siblings'
   * ratios -- and then lose the shape for good the moment the drag touched the top of the
   * track, where every absorber is at zero and the way back down is an even split. 80 shared
   * 30:20 is 48 and 32; shared evenly it is 40 each.
   */
  it("keeps the shape of the pillar when the drag goes up to 100 and back", async () => {
    renderShell("/configure");
    await openPillar("Economy");
    await settled();
    const user = userEvent.setup();
    const lock = () =>
      screen.getByRole("button", {
        name: `Lock the weight for ${OUTLOOK}`,
      });

    // Two unlocked siblings are needed for a shape to be lost, and the shipped set locks one
    // of Economy's three. Unlocking is its own request, and it moves no weight.
    await user.click(lock());
    await waitFor(() => expect(lock()).toHaveAttribute("aria-pressed", "false"));
    const sent = recordWeightRequests();

    drag(COST_OF_LIVING, "70", "100", "20");

    await waitFor(() =>
      expect(readingOf(TAX)).toBe("48.0%"),
    );
    expect(readingOf(OUTLOOK)).toBe("32.0%");
    expect(sent).toEqual([]);
  });
});
