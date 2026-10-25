import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replaceSettings } from "../../api/endpoints";
import { SETTINGS } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";
import { SETTLE_MS } from "./useSettledRequest";

/**
 * The failure sweep of `map-C01.md` M1 for `/compare` (PL-001, PL-005): every GET the screen
 * and its sidebar make, held pending, failed and refused, one at a time. **Each shows its true
 * state, never a fact**: a skeleton while it is pending, a failure where it failed, the
 * server's reason where it refused -- and nowhere a figure, a setting or an absence inferred
 * from a read that has not succeeded.
 *
 * It lives beside Compare because the layering keeps `app/` out of reach of this change; it
 * renders the whole shell, so it reads Compare through the door a reader uses.
 */

type Owner = "screen" | "sidebar";

interface SweptRead {
  /** Whether a GET is this read. */
  matches: (url: URL) => boolean;
  /** The regions that draw what it reads, and so must say what became of it. */
  owners: readonly Owner[];
  /** The picker is drawn from it, so nothing can be picked while it is not read. */
  feedsThePicker: boolean;
  /** How its regions say it failed, where that is not "could not be loaded". */
  failedSays?: RegExp;
  /** How its regions mark it pending, where that is not `aria-busy`. */
  pendingMark?: string;
}

const READS: Record<string, SweptRead> = {
  "GET /levels": { matches: path("/v1/levels"), owners: ["screen", "sidebar"], feedsThePicker: true },
  "GET /criteria-sets": {
    matches: path("/v1/criteria-sets"),
    owners: ["screen", "sidebar"],
    feedsThePicker: true,
  },
  "GET /settings": { matches: path("/v1/settings"), owners: ["screen"], feedsThePicker: true },
  "GET /candidates?level": {
    matches: (url) => url.pathname === "/v1/candidates" && url.searchParams.has("level"),
    owners: ["screen", "sidebar"],
    feedsThePicker: true,
  },
  "GET /candidates": {
    matches: (url) => url.pathname === "/v1/candidates" && !url.searchParams.has("level"),
    owners: ["sidebar"],
    feedsThePicker: false,
    // Which levels hold candidates (PL-009): every level is held until it is known.
    failedSays: /could not check which levels hold candidates/i,
    pendingMark: '[aria-disabled="true"]',
  },
  "GET /criteria-sets/{id}": {
    matches: path("/v1/criteria-sets/default"),
    owners: ["screen"],
    feedsThePicker: false,
  },
  "GET /comparisons": { matches: path("/v1/comparisons"), owners: ["screen"], feedsThePicker: false },
  "GET /rankings": { matches: path("/v1/rankings"), owners: ["sidebar"], feedsThePicker: false },
  "GET /household": { matches: path("/v1/household"), owners: ["sidebar"], feedsThePicker: false },
  "GET /evaluations": { matches: path("/v1/evaluations"), owners: ["sidebar"], feedsThePicker: false },
  "GET /data-acquisition-runs": {
    matches: path("/v1/data-acquisition-runs"),
    owners: ["sidebar"],
    feedsThePicker: false,
  },
};

/**
 * Reads whose failure is silence by design: names for labels, whose fallback is a readable id,
 * never a figure (M1, "the name hooks keep 'a failure is silence'").
 */
const NAME_READS = ["/v1/pillars", "/v1/attributes", "/v1/data-sources"];

/** Sentences that are only true of a read that succeeded, and so are never drawn otherwise. */
const NEVER_INFERRED = [
  "0 of 0",
  "No comparator limit is configured",
  "no cap is set",
  "Nothing has been recorded about the household",
  "No figure has been stored",
  "No criteria sets",
  "0 sets",
  "Choose a criteria set",
  "shape this interface",
  "Loading…",
];

function path(pathname: string): (url: URL) => boolean {
  return (url) => url.pathname === pathname;
}

function region(owner: Owner): HTMLElement {
  return owner === "screen"
    ? screen.getByRole("region", { name: "Compare" })
    : screen.getByRole("complementary");
}

/** Answers every GET that is this read with `answer`, and lets every other through. */
function answerWith(read: SweptRead, answer: () => Response | Promise<Response>) {
  mockServer.use(
    http.get("/v1/*", ({ request }) =>
      read.matches(new URL(request.url)) ? answer() : undefined,
    ),
  );
}

/** Portugal against the Netherlands, as far as the screen lets a reader get. */
async function drawPortugalAgainstTheNetherlands(read: SweptRead): Promise<void> {
  if (read.feedsThePicker) return;
  const option = await screen.findByRole("option", { name: "Portugal" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /focus/i }), option);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
  // No button (PL-094): the comparison is asked for once the selection has been still a moment.
  await act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)));
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

beforeEach(() => {
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

function expectNothingInferred(except: readonly string[] = []) {
  const said = [...everSaid, document.body.textContent ?? ""].join("\n");
  expect(
    NEVER_INFERRED.filter((phrase) => !except.includes(phrase) && said.includes(phrase)),
  ).toEqual([]);
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

describe("the reads Compare makes", () => {
  it("are the ones this sweep covers, and no others", async () => {
    const asked: URL[] = [];
    const listen = ({ request }: { request: Request }) => {
      if (request.method === "GET") asked.push(new URL(request.url));
    };
    mockServer.events.on("request:start", listen);
    try {
      renderShell("/compare");
      await drawPortugalAgainstTheNetherlands({ ...READS["GET /comparisons"]! });
      await screen.findByRole("table", { name: /every pillar/i });
      await settled();
    } finally {
      mockServer.events.removeListener("request:start", listen);
    }

    const unswept = asked.filter(
      (url) =>
        !NAME_READS.includes(url.pathname) &&
        !Object.values(READS).some((read) => read.matches(url)),
    );
    expect(unswept.map((url) => url.pathname)).toEqual([]);
    const unasked = Object.entries(READS)
      .filter(([, read]) => !asked.some((url) => read.matches(url)))
      .map(([name]) => name);
    expect(unasked).toEqual([]);
  });
});

describe.each(Object.entries(READS))("%s", (_name, read) => {
  it("pending: its regions are busy, and nothing it would feed is drawn as a fact", async () => {
    answerWith(read, async () => {
      await delay("infinite");
      return HttpResponse.json({});
    });
    renderShell("/compare");
    await drawPortugalAgainstTheNetherlands(read);
    await everythingElseAnswered(read);

    for (const owner of read.owners) {
      await waitFor(() =>
        expect(region(owner).querySelector(read.pendingMark ?? '[aria-busy="true"]')).not.toBeNull(),
      );
    }
    expectNothingInferred();
  });

  it("failed: its regions say it could not be loaded, and nothing is inferred", async () => {
    answerWith(read, () => HttpResponse.error());
    renderShell("/compare");
    await drawPortugalAgainstTheNetherlands(read);
    await settled();

    // Waited for rather than read once: a server that did not answer is asked again whenever
    // anything else answers (PL-002), so its regions pass through pending on the way.
    for (const owner of read.owners) {
      await waitFor(() => {
        const said = within(region(owner));
        expect(
          [...said.queryAllByText(read.failedSays ?? /could not be loaded/i), ...said.queryAllByRole("alert")],
          `nothing in the ${owner} says the read failed`,
        ).not.toEqual([]);
      });
    }
    expectNothingInferred();
  });
});

describe("refused reads, each in its own words", () => {
  it("GET /comparisons, the score range cleared meanwhile: Nothing to compare, and no picker", async () => {
    renderShell("/compare");
    await screen.findByRole("option", { name: "Portugal" });
    await replaceSettings({ ...SETTINGS, score_scale_max: null });
    await drawPortugalAgainstTheNetherlands(READS["GET /comparisons"]!);

    const compare = within(region("screen"));
    expect(await compare.findByRole("heading", { name: "Nothing to compare" })).toBeInTheDocument();
    expect(compare.queryByRole("combobox", { name: /focus/i })).toBeNull();
    expect(compare.queryByRole("alert")).toBeNull();
    expectNothingInferred();
  });

  it("GET /comparisons, the limit cleared meanwhile: Nothing to compare, with the way to set it", async () => {
    renderShell("/compare");
    await screen.findByRole("option", { name: "Portugal" });
    await replaceSettings({ ...SETTINGS, comparator_limit: null });
    await drawPortugalAgainstTheNetherlands(READS["GET /comparisons"]!);

    // A setting nobody decided is a state, not a fault (PL-019): the calm card, not an alert.
    const refusal = await within(region("screen")).findByRole("region", { name: "Nothing to compare" });
    expect(within(refusal).getByRole("link", { name: /set it in configure/i })).toBeInTheDocument();
    expectNothingInferred();
  });

  it("GET /criteria-sets/{id}, the set gone: its weights could not be loaded", async () => {
    answerWith(READS["GET /criteria-sets/{id}"]!, () =>
      HttpResponse.json(
        { code: "not_found", message: "No criteria set 'default'." },
        { status: 404 },
      ),
    );
    renderShell("/compare");
    await drawPortugalAgainstTheNetherlands(READS["GET /criteria-sets/{id}"]!);
    await settled();

    expect(within(region("screen")).getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(within(region("screen")).queryByRole("table")).toBeNull();
    expectNothingInferred();
  });

  it("GET /rankings, the score range unset: the sidebar says why there are no counts", async () => {
    await replaceSettings({ ...SETTINGS, score_scale_max: null });
    renderShell("/compare");
    await settled();

    expect(within(region("sidebar")).getByText(/depend on a score/i)).toBeInTheDocument();
    expect(within(region("sidebar")).queryByRole("alert")).toBeNull();
    expectNothingInferred();
  });

  it("GET /household, never recorded: says so, and only then", async () => {
    answerWith(READS["GET /household"]!, () =>
      HttpResponse.json(
        { code: "household_not_configured", message: "No household has been recorded." },
        { status: 404 },
      ),
    );
    renderShell("/compare");
    await settled();

    expect(
      within(region("sidebar")).getByText(/nothing has been recorded about the household/i),
    ).toBeInTheDocument();
    expectNothingInferred(["Nothing has been recorded about the household"]);
  });
});
