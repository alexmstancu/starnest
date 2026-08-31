import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/**
 * The mock in a real browser, for `npm run dev:mock` and for the Playwright smoke spec.
 *
 * `/config.json` is deliberately not intercepted: it is a static file Vite already serves, and
 * mocking it would hide the very failure mode the boot sequence guards against.
 */
export const worker = setupWorker(...handlers);

export async function startMockWorker(): Promise<void> {
  await worker.start({
    // Anything the mock does not answer -- /config.json, the module graph, source maps --
    // goes to the network untouched.
    onUnhandledRequest: "bypass",
    quiet: true,
  });
}
