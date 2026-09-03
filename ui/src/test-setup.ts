import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { resetMockData } from "./mocks/handlers";
import { mockServer } from "./mocks/server";

// Every wait in the suite is for a mocked request that resolves in milliseconds. The default
// one-second budget is generous for that and still short enough to lose a race on a loaded
// machine, which shows up as a test that fails only when the whole pipeline runs at once.
configure({ asyncUtilTimeout: 5_000 });

/**
 * Unit tests run against the same mock handlers the dev server uses, so a test can only pass
 * against a response shape that `docs/openapi.yaml` describes.
 *
 * `onUnhandledRequest: "error"` is deliberate: a request the mock does not know about is a
 * test silently hitting the network, which is the failure mode that makes a suite unreliable.
 */

let restoreFetch: (() => void) | null = null;

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: "error" });
  restoreFetch = installRelativeUrlFetch();
});

afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  // The mock's criteria sets are writable, so one test's weight change must not become the
  // next test's starting point. `resetHandlers()` restores handlers, not what they wrote.
  resetMockData();
});

afterAll(() => {
  restoreFetch?.();
  mockServer.close();
});

/**
 * Adapts the browser's `fetch` contract to the one Node offers under jsdom. Two mismatches,
 * both artefacts of the test environment rather than anything the product does:
 *
 * 1. **Relative URLs.** The client calls `/v1/...`, which is what makes every request
 *    same-origin in a browser and removes CORS from the project entirely. Node's `fetch`
 *    demands an absolute URL, so the path is resolved against the document origin here.
 * 2. **`AbortSignal` identity.** jsdom replaces the global `AbortController`, and Node's
 *    `fetch` rejects a signal that is not from its own realm ("Expected signal to be an
 *    instance of AbortSignal"). The signal is therefore withheld from the underlying call and
 *    honoured here instead, so a caller still observes an `AbortError` and nothing in
 *    `client.ts` has to know that tests exist.
 *
 * **It has to wrap msw's fetch, not the other way round**, which is why it is installed after
 * `listen()`: msw would otherwise be handed the URL and the signal it cannot accept.
 */
function installRelativeUrlFetch(): () => void {
  const inner = globalThis.fetch;

  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const { signal, ...withoutSignal } = init;
    const target =
      typeof input === "string" && input.startsWith("/")
        ? new URL(input, window.location.origin)
        : input;

    const response = inner(target, withoutSignal);
    return signal ? Promise.race([response, rejectWhenAborted(signal)]) : response;
  }) as typeof fetch;

  return () => {
    globalThis.fetch = inner;
  };
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
