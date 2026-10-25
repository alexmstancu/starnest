import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { makeCriteriaSetDetails } from "../../mocks/fixtures";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * PL-001 and PL-010 on Acquire: **a read that has not answered is never drawn as an answer.**
 *
 * Every GET the screen makes, three ways -- still on its way, failed with an empty body, and
 * refused with a code -- and in each the regions it feeds say that, rather than "0 of 0", "no
 * cap is set" or "not scored here", which is what a pending or failed read used to become.
 * The sidebar reads some of the same paths and is its own unit; these look at the screen.
 */

const BASE = "/v1";

/** What no read may ever become on this screen. */
const NEVER = [/0 of 0/, /Loading…/];

interface Refusal {
  status: number;
  body: { code: string; message: string; details: Record<string, unknown> };
}

const NOT_FOUND: Refusal = {
  status: 404,
  body: { code: "not_found", message: "No such thing.", details: {} },
};
const INVALID: Refusal = {
  status: 400,
  body: {
    code: "invalid_request",
    message: "The request is malformed.",
    details: { errors: [{ location: "query", kind: "unexpected", problem: "x" }] },
  },
};

const UNKNOWN_LEVEL: Refusal = {
  status: 422,
  body: {
    code: "unknown_scope",
    message: "the scope names 1 id(s) that exist at no row at level country: country.",
    details: { level: "country", unknown_levels: ["country"] },
  },
};

interface ScreenRead {
  what: string;
  path: string;
  refusal: Refusal;
  /** The regions drawn from it, by heading. */
  owners: RegExp[];
  /** The facts it alone could establish -- an absence, a default -- anywhere on the screen. */
  facts: RegExp[];
  /** What those regions may say only once it has answered. */
  drawnFromIt: RegExp[];
}

const HOLDS = /what the database holds/i;
const GAPS = /what you can do about the gaps/i;
const UNSOURCED = /attributes with no data source at all/i;
const LAST_ACQUISITION = /^the last acquisition$/i;
const HAND_ENTRY = /figures you can enter by hand/i;

const READS: ScreenRead[] = [
  {
    what: "the history",
    path: `${BASE}/data-acquisition-runs`,
    refusal: INVALID,
    owners: [HOLDS, /every acquisition so far/i],
    facts: [/Nothing yet/, /None — one at a time/, /no acquisition has been started yet/i],
    drawnFromIt: [/last filled by/i, /running now/i],
  },
  {
    what: "the last acquisition",
    path: `${BASE}/data-acquisition-runs/:runId`,
    refusal: NOT_FOUND,
    // The panel and the remedy cards read the database, never this run (PL-051, PL-054).
    owners: [LAST_ACQUISITION],
    facts: [],
    drawnFromIt: [/figures stored/i],
  },
  {
    what: "what the database holds",
    path: `${BASE}/holdings`,
    refusal: UNKNOWN_LEVEL,
    owners: [HOLDS, GAPS],
    // An empty card is a fact about the database, so it waits for the read like a count does.
    facts: [/nothing is failing/i, /nothing went unanswered/i],
    drawnFromIt: [
      /values stored/i,
      /past their allowed age/i,
      /spent this month/i,
      /retry \d+ (failed|unanswered)/i,
      /by their latest outcome/i,
    ],
  },
  {
    what: "the ranking",
    path: `${BASE}/rankings`,
    refusal: INVALID,
    owners: [HOLDS],
    facts: [],
    drawnFromIt: [/could not be scored/i, /every candidate/i],
  },
  {
    what: "the settings",
    path: `${BASE}/settings`,
    refusal: INVALID,
    owners: [HOLDS],
    facts: [/no cap is set/i],
    drawnFromIt: [/the cap is/i, /spent this month/i],
  },
  {
    what: "the catalog",
    path: `${BASE}/attributes`,
    refusal: INVALID,
    owners: [UNSOURCED, HAND_ENTRY],
    facts: [/every attribute at this level has at least one source/i],
    drawnFromIt: [/residency admin ease/i, /nobody measures this/i],
  },
  {
    what: "the criteria set",
    path: `${BASE}/criteria-sets/:criteriaSetId`,
    refusal: NOT_FOUND,
    owners: [UNSOURCED],
    facts: [/not scored here/i, /every attribute at this level has at least one source/i],
    // PL-088: the rows are the catalog's; only the weights are the set's, and wait for it
    // as a dash.
    drawnFromIt: [/not scored here/i, /\d%/],
  },
  {
    what: "the list of criteria sets",
    path: `${BASE}/criteria-sets`,
    refusal: INVALID,
    owners: [UNSOURCED],
    facts: [/not scored here/i, /every attribute at this level has at least one source/i],
    // PL-088: the rows are the catalog's; only the weights are the set's, and wait for it
    // as a dash.
    drawnFromIt: [/not scored here/i, /\d%/],
  },
];

function theScreen(): HTMLElement {
  return screen.getByRole("region", { name: "Acquire" });
}

function region(name: RegExp): HTMLElement {
  return within(theScreen()).getByRole("region", { name });
}

function findRegion(name: RegExp): Promise<HTMLElement> {
  return within(theScreen()).findByRole("region", { name });
}

function expectNoFactInferred(read: ScreenRead): void {
  for (const fact of [...NEVER, ...read.facts]) {
    expect(theScreen()).not.toHaveTextContent(fact);
  }
  for (const owner of read.owners) {
    for (const drawn of read.drawnFromIt) expect(region(owner)).not.toHaveTextContent(drawn);
  }
}

function heldAnswer(): { held: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/** Fails `path` for the screen's reads; the sidebar's one-run read of the history goes through. */
function answerWith(path: string, answer: () => Response): void {
  mockServer.use(
    http.get(path, ({ request }) =>
      new URL(request.url).searchParams.get("limit") === "1" ? undefined : answer(),
    ),
  );
}

describe.each(READS)("Acquire while $what is read", (read) => {
  it("marks its regions busy while it is on its way, and draws nothing from it", async () => {
    const answer = heldAnswer();
    let asked = false;
    mockServer.use(
      http.get(read.path, async () => {
        asked = true;
        await answer.held;
      }),
    );
    try {
      renderShell("/acquire");
      await waitFor(() => expect(asked).toBe(true));

      for (const owner of read.owners) {
        const drawn = await findRegion(owner);
        await waitFor(() =>
          expect(drawn.querySelector('[aria-busy="true"]')).not.toBeNull(),
        );
      }
      expectNoFactInferred(read);
    } finally {
      answer.release();
    }
  });

  it("says each region could not be loaded when it failed", async () => {
    answerWith(read.path, () => new HttpResponse("Internal Server Error", { status: 500 }));
    renderShell("/acquire");

    for (const owner of read.owners) {
      const drawn = within(await findRegion(owner));
      expect(await drawn.findByText(/could not be loaded/i)).toBeInTheDocument();
      expect(drawn.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    }
    expectNoFactInferred(read);
  });

  it("says each region could not be loaded when it was refused", async () => {
    answerWith(read.path, () =>
      HttpResponse.json(read.refusal.body, { status: read.refusal.status }),
    );
    renderShell("/acquire");

    for (const owner of read.owners) {
      const drawn = within(await findRegion(owner));
      expect(await drawn.findByText(/could not be loaded/i)).toBeInTheDocument();
    }
    expectNoFactInferred(read);
  });
});

/**
 * PL-088 (UF-092). **The gaps are the catalog's; only what each is worth is the set's.** While
 * the set is read, each weight is a dash -- never "not scored here", which is a claim the set
 * has not made -- and the rows stand in name order. A failed set read is the failure card.
 */
describe("the attributes with no source while the set is read", () => {
  function weightCells(card: HTMLElement): HTMLElement[] {
    return within(card)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[2]!);
  }

  it.each([
    ["the criteria set", `${BASE}/criteria-sets/:criteriaSetId`],
    ["the list of criteria sets", `${BASE}/criteria-sets`],
  ])("shows a dash in each weight while %s is on its way", async (_what, path) => {
    const answer = heldAnswer();
    mockServer.use(
      http.get(path, async () => {
        await answer.held;
      }),
    );
    try {
      renderShell("/acquire");
      const card = await findRegion(UNSOURCED);
      const names = (await within(card).findAllByRole("rowheader")).map(
        (header) => header.textContent,
      );

      expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
      for (const cell of weightCells(card)) {
        expect(cell).toHaveTextContent(/^—$/);
        expect(cell).toHaveAttribute("aria-busy", "true");
      }
      expect(card).not.toHaveTextContent(/not scored here/i);
    } finally {
      answer.release();
    }
    const card = region(UNSOURCED);
    await waitFor(() => expect(card).toHaveTextContent(/not scored here/i));
    expect(card.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

/**
 * PL-010. **Reading the history again keeps what it drew**, marked busy: every act on the screen
 * reads it again as it ends, and "What the database holds" left the screen for each re-read.
 */
describe("what the database holds while the history is read again", () => {
  it("stays on screen, marked busy, until the new answer lands", async () => {
    const answer = heldAnswer();
    let reads = 0;
    let waiting = false;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, async ({ request }) => {
        if (new URL(request.url).searchParams.get("limit") === "1") return;
        reads += 1;
        if (reads === 1) return;
        waiting = true;
        await answer.held;
      }),
    );
    try {
      renderShell("/acquire");
      await within(await screen.findByRole("region", { name: HOLDS })).findByText(
        /last filled by/i,
      );

      await userEvent.click(
        await screen.findByRole("button", { name: /estimate an acquisition/i }),
      );
      await waitFor(() => expect(waiting).toBe(true));

      expect(region(HOLDS)).toHaveTextContent(/last filled by/i);
      expect(region(HOLDS).querySelector('[aria-busy="true"]')).not.toBeNull();
    } finally {
      answer.release();
    }
  });
});

/** The diff's own read: the values each of the two chosen runs produced. */
describe("the comparison of two acquisitions while their values are read", () => {
  async function chooseFiveAndSeven(): Promise<HTMLElement> {
    const diff = await screen.findByRole("region", {
      name: /what changed between two acquisitions/i,
    });
    await userEvent.selectOptions(
      within(diff).getByRole("combobox", { name: /earlier acquisition/i }),
      "5",
    );
    await userEvent.selectOptions(
      within(diff).getByRole("combobox", { name: /later acquisition/i }),
      "7",
    );
    return diff;
  }

  it("is busy, and counts nothing, while they are on their way", async () => {
    const answer = heldAnswer();
    mockServer.use(
      http.get(`${BASE}/values`, async () => {
        await answer.held;
      }),
    );
    try {
      renderShell("/acquire");
      const diff = await chooseFiveAndSeven();

      await waitFor(() =>
        expect(diff.querySelector('[aria-busy="true"]')).not.toBeNull(),
      );
      expect(diff).not.toHaveTextContent(/newly acquired|Loading…/i);
    } finally {
      answer.release();
    }
  });

  it("says the comparison could not be loaded when they cannot be read", async () => {
    mockServer.use(
      http.get(`${BASE}/values`, () => new HttpResponse(null, { status: 500 })),
    );
    renderShell("/acquire");
    const diff = await chooseFiveAndSeven();

    expect(await within(diff).findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(within(diff).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(diff).not.toHaveTextContent(/newly acquired/i);
  });
});

/**
 * PL-001 at the seam with the selection. **The criteria-set list answering is not a set being
 * chosen**: the first set is adopted a render later, and in that render the unsourced card read
 * "no set" as "nothing is weighed" and drew every row "not scored here" -- a fact from a
 * selection that had not settled. Watched as the DOM changes, because it lasts one render.
 */
describe("the unsourced card while the first criteria set is adopted", () => {
  it("never calls an attribute the set weighs unscored", async () => {
    const sets = heldAnswer();
    let catalogRead = false;
    mockServer.use(
      http.get(`${BASE}/criteria-sets`, async () => {
        await sets.held;
      }),
      http.get(`${BASE}/attributes`, () => {
        catalogRead = true;
      }),
      // The active set weighs residency, so "not scored here" on its row is never true.
      http.get(`${BASE}/criteria-sets/:criteriaSetId`, ({ params }) => {
        const set = makeCriteriaSetDetails()[String(params["criteriaSetId"])]!;
        const first = set.criteria![0]!;
        return HttpResponse.json({
          ...set,
          criteria: [
            ...set.criteria!,
            { ...first, attribute: "country.residency_admin_ease", weight: 5 },
          ],
        });
      }),
    );
    // Every row as it was drawn, kept even if a later render replaced it.
    const rowsDrawn: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const touched = [...record.addedNodes, record.target];
        for (const node of touched) {
          if (!(node instanceof Element)) continue;
          const rows = [node.closest("tr"), ...node.querySelectorAll("tr")];
          for (const row of rows) if (row) rowsDrawn.push(row.textContent ?? "");
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      renderShell("/acquire");
      await waitFor(() => expect(catalogRead).toBe(true));
      await findRegion(UNSOURCED);

      sets.release();
      const residency = await within(region(UNSOURCED)).findByRole("row", {
        name: /residency admin ease/i,
      });
      expect(residency).not.toHaveTextContent(/not scored here/i);
    } finally {
      observer.disconnect();
      sets.release();
    }
    expect(rowsDrawn.filter((row) => /residency admin ease.*not scored here/i.test(row))).toEqual(
      [],
    );
  });
});

/**
 * PL-001. **The run the screen opens by itself is a read like any other**: failed or refused, it
 * says so with Try again, where it used to leave no card at all -- as if there had been no run.
 */
describe("the last acquisition when it could not be read", () => {
  /** Fails the newest run's detail until the returned switch is flipped. */
  function failTheNewestRun(): { failing: boolean } {
    const switched = { failing: true };
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs/7`, () =>
        switched.failing ? HttpResponse.json(NOT_FOUND.body, { status: 404 }) : undefined,
      ),
    );
    return switched;
  }

  it("shows the run once Try again answers, and takes the reader to it", async () => {
    const run = failTheNewestRun();
    renderShell("/acquire");
    const last = within(await findRegion(LAST_ACQUISITION));
    expect(await last.findByText(/could not be loaded/i)).toBeInTheDocument();

    run.failing = false;
    await userEvent.click(last.getByRole("button", { name: "Try again" }));

    const card = await findRegion(/^acquisition 7$/i);
    expect(within(card).getByRole("heading", { level: 2 })).toHaveFocus();
  });

  it("gives way to a run the reader opens, and stays gone once that one is dismissed", async () => {
    failTheNewestRun();
    renderShell("/acquire");
    await within(await findRegion(LAST_ACQUISITION)).findByText(/could not be loaded/i);

    const six = await screen.findByRole("rowheader", { name: "6" });
    await userEvent.click(within(six).getByRole("button", { name: "Open acquisition 6" }));
    const card = await findRegion(/^acquisition 6$/i);
    await userEvent.click(within(card).getByRole("button", { name: "Dismiss" }));

    expect(within(theScreen()).queryByRole("region", { name: /acquisition 6/i })).toBeNull();
    expect(within(theScreen()).queryByRole("region", { name: LAST_ACQUISITION })).toBeNull();
  });
});

/**
 * PL-001. **An empty history is not the end of the opening view**: an acquisition started
 * elsewhere reaches the screen when an act reads the history again, and the screen opens it then.
 * Settled on the first, empty answer, it drew "The last acquisition" busy for ever and never
 * read it.
 */
describe("the last acquisition when the history was empty at first", () => {
  it("is read and shown once a re-read of the history finds one", async () => {
    let empty = true;
    let detailReads = 0;
    mockServer.use(
      http.get(`${BASE}/data-acquisition-runs`, () =>
        empty ? HttpResponse.json({ items: [], total: 0 }) : undefined,
      ),
      http.get(`${BASE}/data-acquisition-runs/7`, () => {
        detailReads += 1;
      }),
    );
    renderShell("/acquire");
    await within(await findRegion(HOLDS)).findByText("Nothing yet");

    empty = false;
    await userEvent.click(
      await screen.findByRole("button", { name: /estimate an acquisition/i }),
    );

    await findRegion(/^acquisition 7$/i);
    expect(detailReads).toBeGreaterThan(0);
    expect(within(theScreen()).queryByRole("region", { name: LAST_ACQUISITION })).toBeNull();
  });
});

/**
 * The focus rule. **Try again finding nothing open to hand entry keeps the reader in the card**:
 * the card used to leave the screen when the catalog answered with none, taking the focused
 * button with it, and focus fell to the page.
 */
describe("figures you can enter by hand when Try again finds none", () => {
  it("keeps the card, and focus inside it", async () => {
    let failing = true;
    mockServer.use(
      http.get(`${BASE}/attributes`, () =>
        failing
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ items: [] }),
      ),
    );
    renderShell("/acquire");
    // Every other read on the screen settled first: an answer to any of them reads a read the
    // server did not answer again (PL-002), which draws a new Try again in place of this one.
    await within(await findRegion(HOLDS)).findByText(/^under /);
    const handEntry = await findRegion(HAND_ENTRY);
    const tryAgain = await within(handEntry).findByRole("button", { name: "Try again" });

    failing = false;
    await userEvent.click(tryAgain);

    expect(
      await within(region(HAND_ENTRY)).findByText(/no attribute at this level/i),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(region(HAND_ENTRY)).toContainElement(document.activeElement as HTMLElement);
  });
});
