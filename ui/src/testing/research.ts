import { http } from "msw";
import { MATCH_RULES } from "../mocks/fixtures";
import { mockServer } from "../mocks/server";

/**
 * Gate research as the tests watch it (UI-01): one request per gate, so what a pass did is the
 * list of requests it sent -- which gates, in which order, with what acceptance.
 */

/** A research request's body, as the page sends it. */
export interface ResearchBody {
  level: string;
  match_rules?: string[] | null;
  candidates?: string[] | null;
  accept_uncapped_spend?: boolean;
}

export interface ResearchRequests {
  /** Every request's body, in the order they arrived. */
  sent: ResearchBody[];
  /** How many have been answered: a held one counts once it is let go. */
  answered: number;
  /** Lets the held request go. */
  release: () => void;
}

/** The gates at the country level, in the order the mock's catalog lists them. */
export const COUNTRY_GATES = MATCH_RULES.filter(
  (rule) => rule.level === null || rule.level === "country",
).map((rule) => rule.id);

/**
 * Every research request, recorded as it arrives and answered by `answer` -- or, when that gives
 * nothing, by the mock behind it, which answers as the server does. The request numbered
 * `holdAt`, counting from 1, waits until the test lets it go.
 *
 * **The body is read from a clone**, because a request that falls through to the mock is read
 * again there.
 */
export function watchResearch(
  options: {
    holdAt?: number;
    answer?: (body: ResearchBody, index: number) => Response | undefined;
  } = {},
): ResearchRequests {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: ResearchRequests = {
    sent: [],
    answered: 0,
    release: () => release(),
  };
  mockServer.use(
    http.post("/v1/match-rule-research", async ({ request }) => {
      const body = (await request.clone().json()) as ResearchBody;
      const index = requests.sent.push(body);
      if (index === options.holdAt) await held;
      requests.answered += 1;
      return options.answer?.(body, index);
    }),
  );
  return requests;
}

/** The gates each request named, in the order they were asked. */
export function gatesAsked(requests: ResearchRequests): ResearchBody["match_rules"][] {
  return requests.sent.map((body) => body.match_rules);
}
