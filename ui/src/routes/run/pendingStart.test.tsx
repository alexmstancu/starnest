import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { STARTED_RUN, STARTED_RUN_DETAIL } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { expectHeld, expectNotHeld } from "../../testing/keyboard";
import { renderShell } from "../../testing/renderShell";

/**
 * P94 (PL-118): **a start outlives the screen that sent it.** Leaving Acquire while a start is
 * in flight, and coming back, keeps every way to start held until it ends; the run it began is
 * shown, or its refusal reported once (D33).
 */

const BASE = "/v1";

function heldAnswer(): { held: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/** The start held until the test lets go, then answered as `answer` says. */
function holdTheStart(answer: () => Response): { release: () => void } {
  const start = heldAnswer();
  mockServer.use(
    http.post(`${BASE}/data-acquisition-runs`, async () => {
      await start.held;
      return answer();
    }),
  );
  return start;
}

const ACCEPTED = () => HttpResponse.json(STARTED_RUN, { status: 202 });
const REFUSED = () =>
  HttpResponse.json(
    {
      code: "run_already_in_flight",
      message: "run 7 is still going, and one household runs one pass at a time",
      details: { run: 7 },
    },
    { status: 409 },
  );

async function sendAStart(): Promise<void> {
  await screen.findByRole("region", { name: /acquisition 7/i });
  await userEvent.click(await screen.findByRole("button", { name: /estimate an acquisition/i }));
  await userEvent.click(
    await screen.findByRole("button", { name: /start this acquisition|yes, start it/i }),
  );
}

async function goTo(tab: string): Promise<void> {
  await userEvent.click(within(screen.getByRole("navigation", { name: "Sections" })).getByRole("link", { name: tab }));
}

async function leaveAndComeBack(): Promise<void> {
  await goTo("Rank");
  await screen.findByRole("heading", { level: 1, name: /rank/i });
  await goTo("Acquire");
  await screen.findByRole("heading", { level: 1, name: /acquire/i });
}

describe("a start sent from an Acquire since left", () => {
  it("holds every way to start on the Acquire opened again, then shows the run it began", async () => {
    const start = holdTheStart(ACCEPTED);
    renderShell("/acquire");
    await sendAStart();

    await leaveAndComeBack();
    const card = within(await screen.findByRole("region", { name: /acquisition 7/i }));
    const history = within(
      await screen.findByRole("region", { name: "Every acquisition so far" }),
    );

    expectHeld(card.getByRole("button", { name: "Refresh" }));
    expectHeld(card.getByRole("button", { name: "Dismiss" }));
    expectHeld(history.getAllByRole("button")[0]!);
    await userEvent.click(await screen.findByRole("button", { name: /estimate an acquisition/i }));
    expectHeld(
      await screen.findByRole("button", { name: /start this acquisition|yes, start it|running…|starting…/i }),
    );

    start.release();

    expect(await screen.findByRole("region", { name: /acquisition 8/i })).toBeInTheDocument();
    await waitFor(() =>
      expectNotHeld(
        within(screen.getByRole("region", { name: /acquisition 8/i })).getByRole("button", {
          name: "Refresh",
        }),
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a refusal that landed while Acquire was closed, once, on return", async () => {
    const start = holdTheStart(REFUSED);
    renderShell("/acquire");
    await sendAStart();
    await goTo("Rank");
    await screen.findByRole("heading", { level: 1, name: /rank/i });

    await act(async () => {
      start.release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await goTo("Acquire");

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(/the start did not go through/i);
    // The card keeps the newest run, and nothing is held any more.
    const card = within(await screen.findByRole("region", { name: /acquisition 7/i }));
    expectNotHeld(card.getByRole("button", { name: "Refresh" }));

    await userEvent.click(within(refusal).getByRole("button", { name: "Dismiss" }));
    await leaveAndComeBack();
    await screen.findByRole("region", { name: /acquisition 7/i });
    expect(screen.queryByText(/the start did not go through/i)).toBeNull();
  });

  it("shows the run a start began while Acquire was closed, with nothing held", async () => {
    const start = holdTheStart(ACCEPTED);
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/8`, () =>
        HttpResponse.json({ ...STARTED_RUN_DETAIL, id: 8 }),
      ),
    );
    renderShell("/acquire");
    await sendAStart();
    await goTo("Rank");
    await screen.findByRole("heading", { level: 1, name: /rank/i });

    await act(async () => {
      start.release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await goTo("Acquire");

    const card = within(await screen.findByRole("region", { name: /acquisition 8/i }));
    expectNotHeld(card.getByRole("button", { name: "Refresh" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
