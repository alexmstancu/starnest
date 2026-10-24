import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
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
const UNSOURCED = /attributes with no data source at all/i;

const READS: ScreenRead[] = [
  {
    what: "the history",
    path: `${BASE}/data-acquisition-runs`,
    refusal: INVALID,
    owners: [HOLDS, /every acquisition so far/i],
    facts: [
      /Nothing yet/,
      /None — one at a time/,
      /nothing has been acquired yet/i,
      /no acquisition has been started yet/i,
    ],
    drawnFromIt: [/last filled by/i, /running now/i, /spent this month/i],
  },
  {
    what: "the last acquisition",
    path: `${BASE}/data-acquisition-runs/:runId`,
    refusal: NOT_FOUND,
    owners: [HOLDS],
    facts: [],
    drawnFromIt: [/values filled/i, /nobody answered/i, /a source broke/i],
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
    owners: [UNSOURCED, /figures you can enter by hand/i],
    facts: [/every attribute at this level has at least one source/i],
    drawnFromIt: [/residency admin ease/i, /nobody measures this/i],
  },
  {
    what: "the criteria set",
    path: `${BASE}/criteria-sets/:criteriaSetId`,
    refusal: NOT_FOUND,
    owners: [UNSOURCED],
    facts: [/not scored here/i, /every attribute at this level has at least one source/i],
    drawnFromIt: [/nobody measures this/i],
  },
  {
    what: "the list of criteria sets",
    path: `${BASE}/criteria-sets`,
    refusal: INVALID,
    owners: [UNSOURCED],
    facts: [/not scored here/i, /every attribute at this level has at least one source/i],
    drawnFromIt: [/nobody measures this/i],
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
    answerWith(read.path, () => new HttpResponse(null, { status: 500 }));
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
        /values filled/i,
      );

      await userEvent.click(
        screen.getByRole("button", { name: /estimate an acquisition/i }),
      );
      await waitFor(() => expect(waiting).toBe(true));

      expect(region(HOLDS)).toHaveTextContent(/values filled/i);
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
