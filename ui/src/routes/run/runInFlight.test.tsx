import { renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { RUNS, STARTED_RUN_DETAIL } from "../../mocks/fixtures";
import type { RunDetail } from "../../api/endpoints";
import { mockServer } from "../../mocks/server";
import { expectHeld, expectNotHeld } from "../../testing/keyboard";
import { renderShell } from "../../testing/renderShell";
import { useRunScreen } from "./useRunScreen";

/**
 * UF-080 (PL-119): **Start is held while a run is in flight**, and says which, with a way to it.
 * One household runs one acquisition at a time (`reqs.md` 10), so a start offered beside a
 * running run could only be refused -- and the refusal, which names the run in its details,
 * offers the way to it as well.
 */

const BASE = "/v1";

function detailOf(runId: number, over: Partial<RunDetail> = {}): RunDetail {
  return { ...STARTED_RUN_DETAIL, id: runId, ...over };
}

/** Run 7 running, the history saying so as well. */
function runSevenGoing(): void {
  mockServer.use(
    http.get(`${BASE}/data-acquisition-runs`, () =>
      HttpResponse.json({
        items: RUNS.map((run) =>
          run.id === 7 ? { ...run, run_status: "running", finished_at: null } : run,
        ),
        total: RUNS.length,
      }),
    ),
    http.get(`${BASE}/data-acquisition-runs/:runId`, ({ params }) =>
      HttpResponse.json(
        detailOf(Number(params["runId"]), { run_status: "running", finished_at: null }),
      ),
    ),
  );
}

function whole() {
  return within(
    screen.getByRole("heading", { name: /an acquisition over every country candidate/i })
      .closest("section")!,
  );
}

async function estimateEverything(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: /estimate an acquisition/i }));
}

describe("starting while an acquisition is in flight", () => {
  it("holds Start, naming the run going, with a way to it", async () => {
    runSevenGoing();
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await estimateEverything();

    const card = whole();
    expectHeld(
      await card.findByRole("button", { name: /yes, start it/i }),
    );
    expect(card.getByText("Acquisition 7 is still going, and one runs at a time.")).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Open acquisition 7" })).toBeInTheDocument();
  });

  it("holds the armed strip's Yes too", async () => {
    runSevenGoing();
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await userEvent.click(await screen.findByRole("button", { name: /^retry \d+ failed$/i }));

    expectHeld(await screen.findByRole("button", { name: "Yes, start it" }));
    expectNotHeld(screen.getByRole("button", { name: "Not yet" }));
  });

  it("offers Start once nothing is in flight, with no run named", async () => {
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });

    await estimateEverything();

    const card = whole();
    expectNotHeld(
      await card.findByRole("button", { name: /yes, start it/i }),
    );
    expect(card.queryByText(/is still going/)).toBeNull();
  });
});

describe("a start refused as in flight", () => {
  function refuseStarts(details: Record<string, unknown>): void {
    mockServer.use(
      http.post(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json(
          {
            code: "run_already_in_flight",
            message: "run 9 is still going, and one household runs one pass at a time",
            details,
          },
          { status: 409 },
        ),
      ),
      http.get(`${BASE}/data-acquisition-runs/9`, () =>
        HttpResponse.json(detailOf(9, { run_status: "running", finished_at: null })),
      ),
    );
  }

  /** Started from another tab, so nothing on this one knew of it until the refusal. */
  it("opens the run its details name", async () => {
    refuseStarts({ run: 9 });
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    await estimateEverything();
    await userEvent.click(
      await screen.findByRole("button", { name: /yes, start it/i }),
    );
    const refusal = within(
      (await screen.findByText(/the start did not go through/i)).closest<HTMLElement>(
        '[role="alert"]',
      )!,
    );

    await userEvent.click(refusal.getByRole("button", { name: "Open acquisition 9" }));

    expect(await screen.findByRole("region", { name: /acquisition 9/i })).toBeInTheDocument();
    expect(screen.queryByText(/the start did not go through/i)).toBeNull();
  });

  /** The run ended between the refusal and the read that names it: Dismiss alone (P1-14). */
  it("offers no way to a run its details do not name", async () => {
    refuseStarts({});
    renderShell("/acquire");
    await screen.findByRole("region", { name: /acquisition 7/i });
    await estimateEverything();
    await userEvent.click(
      await screen.findByRole("button", { name: /yes, start it/i }),
    );

    const refusal = within(
      (await screen.findByText(/the start did not go through/i)).closest<HTMLElement>(
        '[role="alert"]',
      )!,
    );
    expect(refusal.queryByRole("button", { name: /open acquisition/i })).toBeNull();
    expect(refusal.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});

/**
 * Review finding 4: **a run the card is not showing ends, and the history hears of it.** The shell
 * signals every end it sees; read again on it, the history stops calling run 9 running, and the
 * starts held for it are let go.
 */
describe("a run that ends while the card shows another", () => {
  it("reads the history again when the shell says an acquisition ended", async () => {
    let ended = false;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        HttpResponse.json({
          items: [
            { ...RUNS[0]!, id: 9, run_status: ended ? "completed" : "running", finished_at: null },
            ...RUNS,
          ],
          total: RUNS.length + 1,
        }),
      ),
    );
    const { result, rerender } = renderHook(
      ({ ends }: { ends: number }) => useRunScreen("country", () => undefined, ends),
      { initialProps: { ends: 0 } },
    );
    await waitFor(() => expect(result.current.history.state).toBe("ready"));
    const statusOf9 = () =>
      result.current.history.state === "ready"
        ? result.current.history.data.find((run) => run.id === 9)?.run_status
        : undefined;
    expect(statusOf9()).toBe("running");

    ended = true;
    rerender({ ends: 1 });

    await waitFor(() => expect(statusOf9()).toBe("completed"));
  });
});
