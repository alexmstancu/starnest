import { waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { mockServer } from "../mocks/server";

/**
 * Starts watching for the next `GET /comparisons`; the function it returns settles once the mock
 * has answered it, however it answered, and the screen has drawn what came back.
 *
 * **Compare has no button** (PL-094): the comparison follows the selection after a short pause,
 * so a test that has made its choices waits for the answer rather than pressing anything. The
 * waits are `waitFor`s, so the pause's timer and the answer land inside React's `act`.
 */
export function watchNextComparison(): () => Promise<void> {
  let answered = false;
  const listener = ({ request }: { request: Request }) => {
    if (!new URL(request.url).pathname.endsWith("/comparisons")) return;
    mockServer.events.removeListener("response:mocked", listener);
    answered = true;
  };
  mockServer.events.on("response:mocked", listener);
  return async () => {
    await waitFor(() => expect(answered).toBe(true));
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  };
}
