import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { forgetAttributeNames } from "./api/useAttributeNames";
import { forgetCandidateNames } from "./api/useCandidateNames";
import { forgetPillarNames } from "./api/usePillarNames";
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
let restoreConsole: (() => void) | null = null;

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: "error" });
  restoreFetch = installRelativeUrlFetch();
  restoreConsole = failOnConsoleError();
});

afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  // The mock's criteria sets are writable, so one test's weight change must not become the
  // next test's starting point. `resetHandlers()` restores handlers, not what they wrote.
  resetMockData();
  // The pillar names are fetched once and kept for the life of the module, which is right in a
  // browser and wrong across tests: one test's answer -- or its failure -- would be the next
  // test's starting point, and a test that stubbed `/pillars` would silently serve every test
  // that ran after it. The attribute and candidate names are the same cache, same hazard --
  // and a cache that is not reset here leaks silently, which is why they are listed together
  // rather than each remembered separately.
  forgetPillarNames();
  forgetAttributeNames();
  forgetCandidateNames();
  // Last, so the resets above happen whether or not this throws.
  failOnAnythingWrittenToConsoleError();
});

afterAll(() => {
  restoreConsole?.();
  restoreFetch?.();
  mockServer.close();
});

/**
 * **React reports its own bugs through `console.error`, and nothing here read it.**
 *
 * Act warnings, duplicate-key warnings and "Maximum update depth exceeded" are all written
 * there and nowhere else: the run stays green, the lines scroll past, and the build says
 * nothing. That is how two `useResource` tests passed for weeks through an unbounded render
 * loop -- 42 aborted update cascades in one file, 13/13 passed.
 *
 * The message is still forwarded, so a failure shows what React actually said rather than
 * only that it said something.
 *
 * **The opt-out is `vi.spyOn(console, "error")`, which replaces this wrapper for the length of
 * one test.** A test that renders a component outside its provider *expects* React to log the
 * throw, and `contextGuards.test.tsx` already silences it exactly that way. Keeping the
 * exemption at the call site rather than in an allowlist here means it is read by whoever is
 * reading the test, and disappears when the test does.
 *
 * **The test this fails is not always the test at fault.** A timer or promise a previous test
 * left running fires during a later one in the same worker, and its log lands in that test's
 * bucket -- which is why the message is printed rather than counted: React names the component,
 * and the component names the leak. The first thing this caught was exactly that shape, a blur
 * timer that outlived its component (`CandidateField`), and it read as a failure two files
 * away.
 */
function failOnConsoleError(): () => void {
  const inner = console.error;

  console.error = (...args: unknown[]) => {
    writtenToConsoleError.push(args.map(describeArgument).join(" "));
    inner(...args);
  };

  return () => {
    console.error = inner;
  };
}

const writtenToConsoleError: string[] = [];

function failOnAnythingWrittenToConsoleError(): void {
  const written = writtenToConsoleError.splice(0, writtenToConsoleError.length);
  if (written.length === 0) return;

  throw new Error(
    `${written.length} message(s) written to console.error during this test. ` +
      "React reports render bugs there and nowhere else, so this is a failure rather than " +
      "noise. If the log is the expected behaviour, silence it in the test with " +
      "vi.spyOn(console, \"error\").mockImplementation(() => {}).\n\n" +
      written.join("\n"),
  );
}

function describeArgument(argument: unknown): string {
  if (argument instanceof Error) return `${argument.name}: ${argument.message}`;
  return typeof argument === "string" ? argument : JSON.stringify(argument);
}

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
  });

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
