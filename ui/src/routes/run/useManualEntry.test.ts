/**
 * NEW-29. **A figure typed by hand is sent once, however often submit is called.**
 *
 * The only thing standing between two clicks and two stored rows was the button's `disabled`,
 * which is React state: it takes effect at the next render, and a second call before that
 * render sent a second POST. The store accepts both -- values are never overwritten -- so the
 * active-value rule is then left to choose between two copies on nothing but a timestamp.
 *
 * **Driven through the hook rather than the panel**, because the window is the one a disabled
 * button cannot close: two calls with no render between them.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { useManualEntry, type ManualEntryState } from "./useManualEntry";

/** The one attribute in the mock's catalog that takes a list typed by hand. */
const EMPLOYERS = "country.international_employers";

function renderEntry() {
  const rendered = renderHook(() => useManualEntry(EMPLOYERS, "LabelSet"));
  fill(rendered.result, "Siemens");
  return rendered;
}

/** Everything a list needs before it may be stored: a candidate, the names, and a period. */
function fill(entry: { current: ManualEntryState }, labels: string): void {
  act(() => {
    entry.current.change("candidate", "country.portugal");
    entry.current.change("labels", labels);
    entry.current.change("periodStart", "2025-01-01");
    entry.current.change("periodEnd", "2025-12-31");
  });
}

/**
 * Counts each figure as it reaches the network -- on arrival, not on answer -- then answers
 * with `answer`, or lets the mock's own handler store it when `answer` gives nothing back.
 */
function countManualWrites(
  answer: () => Promise<Response | undefined> | Response | undefined = () => undefined,
): { sent: number } {
  const writes = { sent: 0 };
  mockServer.use(
    http.post("/v1/values/manual", () => {
      writes.sent += 1;
      return answer();
    }),
  );
  return writes;
}

/** The same count, holding every figure until the test lets go. */
function holdManualWrites(): { sent: number; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes = countManualWrites(async () => {
    await held;
    return undefined;
  });
  return Object.assign(writes, { release: () => release() });
}

describe("storing a figure typed by hand, once", () => {
  it("sends one figure when submit is called twice before the form re-renders", async () => {
    const writes = countManualWrites();
    const { result } = renderEntry();

    // One act, so nothing renders between the calls: both see the same draft and `saving`.
    act(() => {
      result.current.submit();
      result.current.submit();
    });

    await waitFor(() => expect(result.current.saved).not.toBeNull());
    expect(writes.sent).toBe(1);
  });

  it("sends nothing more while the server is still storing the last figure", async () => {
    const writes = holdManualWrites();
    const { result } = renderEntry();
    act(() => result.current.submit());
    await waitFor(() => expect(writes.sent).toBe(1));

    act(() => result.current.submit());
    writes.release();

    await waitFor(() => expect(result.current.saved).not.toBeNull());
    expect(writes.sent).toBe(1);
  });

  it("sends the next figure once the last one has been answered", async () => {
    const writes = countManualWrites();
    const { result } = renderEntry();
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.saved).not.toBeNull());

    // Typing clears the last outcome, so `saved` is null again until this one is answered.
    fill(result, "Bosch");
    act(() => result.current.submit());

    await waitFor(() => expect(result.current.saved).not.toBeNull());
    expect(writes.sent).toBe(2);
  });

  it.each([
    [
      "the server failed",
      () =>
        HttpResponse.json(
          { code: "internal_error", message: "the store is down" },
          { status: 500 },
        ),
    ],
    ["the backend could not be reached", () => HttpResponse.error()],
  ])("sends the figure again when it is retried after %s", async (_, failure) => {
    let failing = true;
    const writes = countManualWrites(() => (failing ? failure() : undefined));
    const { result } = renderEntry();
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.failure).not.toBeNull();
    failing = false;

    act(() => result.current.submit());

    await waitFor(() => expect(result.current.saved).not.toBeNull());
    expect(writes.sent).toBe(2);
  });

  it("still sends once the form has refused a submit for want of a figure", async () => {
    const writes = countManualWrites();
    const { result } = renderHook(() => useManualEntry(EMPLOYERS, "LabelSet"));
    act(() => result.current.submit());
    expect(result.current.problems).not.toHaveLength(0);

    fill(result, "Siemens");
    act(() => result.current.submit());

    await waitFor(() => expect(result.current.saved).not.toBeNull());
    expect(writes.sent).toBe(1);
  });
});
