import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * The same handlers, in Node, for the unit tests.
 *
 * Sharing one set of handlers between the browser and the tests is the point: a test that
 * passes here passes against exactly what `npm run dev:mock` serves, so the two cannot drift.
 */
export const mockServer = setupServer(...handlers);
