import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveEvaluation } from "../../api/endpoints";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * The failure sweep of `map-C01.md` M1 for `/rank` (PL-001, PL-010): every GET the screen makes
 * with Portugal open in the live ranking and in a saved one, and an attribute drilled into --
 * held pending, then failed, one at a time. **Each shows its true state, never a fact**: a
 * skeleton while it is pending, the failure card with Try again where it failed, and nowhere a
 * figure, a setting or an absence inferred from a read that has not succeeded. Try again then
 * reads it, and the failure goes.
 *
 * A failure here is a server that answered and failed -- a 500 with a JSON body. One that did
 * not answer is the shell's to say, once (PL-002), and is swept on Compare.
 *
 * The sidebar's own reads are swept with Compare's, since the sidebar is the same on every
 * screen; here they are only listed, so that nothing Rank asks for goes unswept.
 */

// Each case renders the whole shell and walks it to three open panels; under two loaded full
// gates that outran the suite's 15 s, so this file alone is given longer.
vi.setConfig({ testTimeout: 30_000 });

interface SweptRead {
  /** Whether a GET is this read. */
  matches: (url: URL) => boolean;
}

const READS: Record<string, SweptRead> = {
  "GET /levels": { matches: path("/v1/levels") },
  "GET /criteria-sets": { matches: path("/v1/criteria-sets") },
  "GET /rankings": { matches: path("/v1/rankings") },
  "GET /rankings/candidates/{id}": {
    matches: (url) => url.pathname.startsWith("/v1/rankings/candidates/"),
  },
  "GET /values?candidate": {
    matches: (url) => url.pathname === "/v1/values" && url.searchParams.has("candidate"),
  },
  "GET /values?attribute": {
    matches: (url) => url.pathname === "/v1/values" && url.searchParams.has("attribute"),
  },
  // Whether anything is stored at all (PL-011).
  "GET /values?limit=1": {
    matches: (url) =>
      url.pathname === "/v1/values" &&
      !url.searchParams.has("candidate") &&
      !url.searchParams.has("attribute"),
  },
  "GET /external-scores": {
    matches: (url) => url.pathname.startsWith("/v1/external-scores"),
  },
  "GET /match-rule-results": { matches: path("/v1/match-rule-results") },
  "GET /criteria-sets/{id}": { matches: path("/v1/criteria-sets/default") },
  "GET /attributes?level": {
    matches: (url) => url.pathname === "/v1/attributes" && url.searchParams.has("level"),
  },
  "GET /evaluations": { matches: path("/v1/evaluations") },
  "GET /evaluations/{id}": {
    matches: (url) => /^\/v1\/evaluations\/\d+$/.test(url.pathname),
  },
  "GET /evaluations/{id}/candidates/{id}": {
    matches: (url) => /^\/v1\/evaluations\/\d+\/candidates\/[^/]+$/.test(url.pathname),
  },
};

/**
 * Reads Rank makes whose failure is silence there by design, each said by the sidebar: the
 * roster gives the flags beside a name and the total a count is out of, and the household
 * says which row is home. Neither draws a figure; without them a row has no flag, a count no
 * total, and no row is marked home.
 */
const SIDEBAR_READS: readonly ((url: URL) => boolean)[] = [
  (url) => url.pathname === "/v1/candidates",
  path("/v1/household"),
  path("/v1/data-acquisition-runs"),
];

/** Names for labels, whose fallback is a readable id, never a figure (M1). */
const NAME_READS: readonly ((url: URL) => boolean)[] = [
  path("/v1/pillars"),
  (url) => url.pathname === "/v1/attributes" && !url.searchParams.has("level"),
  path("/v1/data-sources"),
  path("/v1/match-rules"),
];

/** Sentences that are only true of a read that succeeded, and so are never drawn otherwise. */
const NEVER_INFERRED = [
  "Choose a criteria set",
  "No candidate has been evaluated",
  "Nothing to save",
  "No figure has been stored",
  "has a value in use",
  "No outside index has been stored",
  "No gate has been answered",
  "No candidate has a figure for this attribute",
  "Kept without a note",
  "No figure was scored for this candidate",
  "No criteria sets",
  "No criteria set yet",
  "0 sets",
  "Loading…",
];

function path(pathname: string): (url: URL) => boolean {
  return (url) => url.pathname === pathname;
}

function rank(): HTMLElement {
  return screen.getByRole("region", { name: "Rank" });
}

function saved(): HTMLElement | null {
  return screen.queryByRole("region", { name: /a saved ranking/i });
}

/** Answers every GET that is this read with `answer`, and lets every other through. */
function answerWith(read: SweptRead, answer: () => Response | Promise<Response> | undefined) {
  mockServer.use(
    http.get("/v1/*", ({ request }) =>
      read.matches(new URL(request.url)) ? answer() : undefined,
    ),
  );
}

/** The read failing, as a server that answered: a 500 with the contract's error body. */
function serverFault(): Response {
  return HttpResponse.json(
    { code: "internal_error", message: "SENTINEL_MESSAGE" },
    { status: 500 },
  );
}

/**
 * Portugal open in the live ranking and in the saved one, and an attribute drilled into: as
 * far as the screen lets a reader get while one read is held or failed.
 */
async function openEverything(): Promise<void> {
  const live = liveTable();
  if (live !== null) await userEvent.click(within(live).getByRole("button", { name: "Portugal" }));
  const attribute = screen.queryByRole("combobox", { name: "Attribute" });
  const option = attribute && within(attribute).queryByRole("option", { name: "Cost of living index" });
  if (attribute && option) await userEvent.selectOptions(attribute, option);
  const savedTable = saved() && within(saved()!).queryByRole("table", { name: /ranked candidates/i });
  if (savedTable) {
    await userEvent.click(within(savedTable).getByRole("button", { name: "Portugal" }));
  }
}

function liveTable(): HTMLElement | null {
  return (
    within(rank())
      .queryAllByRole("table", { name: /ranked candidates/i })
      .find((table) => !saved()?.contains(table)) ?? null
  );
}

async function settled(): Promise<void> {
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
}

/**
 * Everything the page has said since the test began, **including what it said for one render
 * and took back**: a sentence that flashes while a read is in flight was still said.
 */
let everSaid: string[] = [];
let listening: MutationObserver | null = null;
let savedId = 0;

beforeEach(async () => {
  savedId = (await saveEvaluation("default", "country", "kept for the sweep")).id;
  everSaid = [];
  listening = new MutationObserver((records) => {
    for (const record of records) {
      everSaid.push(record.target.textContent ?? "");
      record.addedNodes.forEach((node) => everSaid.push(node.textContent ?? ""));
    }
  });
  listening.observe(document.body, { subtree: true, childList: true, characterData: true });
});

afterEach(() => {
  listening?.disconnect();
});

function expectNothingInferred() {
  const said = [...everSaid, document.body.textContent ?? ""].join("\n");
  expect(NEVER_INFERRED.filter((phrase) => said.includes(phrase))).toEqual([]);
  expect(said).not.toContain("SENTINEL_MESSAGE");
}

/** Waits until every request but the held read's has been answered, twice over a pause. */
async function everythingElseAnswered(held: SweptRead): Promise<void> {
  let inFlight = 0;
  const started = ({ request }: { request: Request }) => {
    if (!held.matches(new URL(request.url))) inFlight += 1;
  };
  const ended = ({ request }: { request: Request }) => {
    if (!held.matches(new URL(request.url))) inFlight -= 1;
  };
  mockServer.events.on("request:start", started);
  mockServer.events.on("request:end", ended);
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
      await waitFor(() => expect(inFlight).toBeLessThanOrEqual(0));
    }
  } finally {
    mockServer.events.removeListener("request:start", started);
    mockServer.events.removeListener("request:end", ended);
  }
}

function render(): void {
  renderShell(`/rank?saved=${String(savedId)}`);
}

describe("the reads Rank makes", () => {
  it("are the ones this sweep covers, and no others", async () => {
    const asked: URL[] = [];
    const listen = ({ request }: { request: Request }) => {
      if (request.method === "GET") asked.push(new URL(request.url));
    };
    mockServer.events.on("request:start", listen);
    try {
      render();
      await waitFor(() => expect(liveTable()).not.toBeNull());
      await waitFor(() =>
        expect(within(saved()!).getByRole("table", { name: /ranked candidates/i })).toBeVisible(),
      );
      await waitFor(() =>
        expect(screen.getByRole("option", { name: "Cost of living index" })).toBeInTheDocument(),
      );
      await openEverything();
      await screen.findByRole("table", { name: /every stored value/i });
      await screen.findByRole("table", { name: "Saved figures" });
      await settled();
    } finally {
      mockServer.events.removeListener("request:start", listen);
    }

    const swept = [
      ...Object.values(READS).map((read) => read.matches),
      ...SIDEBAR_READS,
      ...NAME_READS,
    ];
    expect(asked.filter((url) => !swept.some((matches) => matches(url))).map(String)).toEqual([]);
    const unasked = Object.entries(READS)
      .filter(([, read]) => !asked.some((url) => read.matches(url)))
      .map(([name]) => name);
    expect(unasked).toEqual([]);
  });
});

describe.each(Object.entries(READS))("%s", (_name, read) => {
  it("pending: the screen is busy, and nothing it would feed is drawn as a fact", async () => {
    answerWith(read, async () => {
      await delay("infinite");
      return HttpResponse.json({});
    });
    render();
    await everythingElseAnswered(read);
    await openEverything();
    await everythingElseAnswered(read);

    await waitFor(() => expect(rank().querySelector('[aria-busy="true"]')).not.toBeNull());
    expectNothingInferred();
  });

  it("failed: the screen says it could not be loaded, infers nothing, and Try again reads it", async () => {
    let failing = true;
    answerWith(read, () => (failing ? serverFault() : undefined));
    render();
    await everythingElseAnswered(read);
    await openEverything();
    await settled();

    const said = within(rank());
    await waitFor(() => expect(said.queryAllByText(/could not be loaded/i)).not.toEqual([]));
    expectNothingInferred();

    failing = false;
    for (const retry of said.getAllByRole("button", { name: "Try again" })) {
      await userEvent.click(retry);
    }
    await settled();
    await waitFor(() => expect(said.queryAllByText(/could not be loaded/i)).toEqual([]));
    expect(said.queryByRole("alert")).toBeNull();
  });
});
