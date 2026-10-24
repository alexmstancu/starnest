import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replaceSettings, saveEvaluation } from "../api/endpoints";
import {
  ATTRIBUTES,
  COMPOUND_RULES,
  CRITERIA_SETS,
  DATA_SOURCES,
  LEVELS,
  MATCH_RULES,
  PILLARS,
  SETTINGS,
  STARTED_RUN_DETAIL,
  candidatesForLevel,
} from "../mocks/fixtures";
import { mockServer } from "../mocks/server";
import {
  IDENTIFIER_LEDGER,
  type KnownOffender,
  type ScreenState,
} from "../testing/identifierLedger";
import {
  IDENTIFIER_PATTERNS,
  enumLiteralsIn,
  findIdentifiers,
  readingsOf,
  type Finding,
  type Vocabulary,
} from "../testing/identifiers";
import { renderShell } from "../testing/renderShell";

/**
 * M3 (map-C01 §3): **no internal identifier reaches the screen unrecorded.**
 *
 * The guard this replaces read one screen as it first drew, matched one shape, and knew three
 * ids by name -- and identifiers went on reaching the screen through every gap in that: the
 * states it never opened, the shapes it never looked for, the screens it never visited. This
 * renders every screen in the states a reader meets, scans everything a reader is told
 * (`testing/identifiers.ts`), and holds what it finds to `testing/identifierLedger.ts` both
 * ways, so the ledger can only shrink.
 */

/**
 * What the mocks call things. **A one-word id has no shape**, so the set `default` or the source
 * `manual` is an identifier only where it stands alone -- and only the data can say which words
 * those are.
 */
const VOCABULARY: Vocabulary = {
  enumLiterals: enumLiteralsIn(
    readFileSync(join(__dirname, "..", "api", "schema.ts"), "utf8"),
  ),
  ids: [
    ...CRITERIA_SETS.map((set) => set.id),
    ...DATA_SOURCES.map((source) => source.id),
    ...PILLARS.map((pillar) => pillar.id),
    ...LEVELS.map((level) => level.id),
    ...MATCH_RULES.map((rule) => rule.id),
    ...COMPOUND_RULES.map((rule) => rule.id),
    ...candidatesForLevel(null).map((candidate) => candidate.id),
    ...ATTRIBUTES.map((attribute) => attribute.id),
  ],
};

describe("no internal identifier reaches the screen unrecorded", () => {
  it.each(Object.keys(IDENTIFIER_LEDGER) as ScreenState[])("%s", async (state) => {
    await ARRANGEMENTS[state]();
    await quiet();

    const findings = findIdentifiers(document.body, VOCABULARY);
    const found = new Set(findings.map((finding) => finding.identifier));
    const ledger: readonly KnownOffender[] = IDENTIFIER_LEDGER[state];
    const recorded = new Set(ledger.map((offender) => offender.identifier));

    // **Both directions, in one assertion**, so a failure names everything that moved at once.
    // Unrecorded: a new identifier on screen. Stale: a fix that did not cross itself off.
    expect({
      unrecorded: [
        ...new Set(
          findings.filter((finding) => !recorded.has(finding.identifier)).map(quoted),
        ),
      ],
      stale: [...recorded].filter((identifier) => !found.has(identifier)),
    }).toEqual({ unrecorded: [], stale: [] });
  });
});

/**
 * Each state as a reader reaches it. **Opened, not only drawn**: a closed pillar, row or group
 * draws nothing inside it, and looking only at what a screen first draws is how the old guard
 * missed what was there.
 */
const ARRANGEMENTS: Record<ScreenState, () => Promise<void>> = {
  // The one criterion with a full rule, because only an anchored scale draws the anchor rows.
  "Configure, a pillar and a rule editor open": async () => {
    renderShell("/configure");
    const weights = await screen.findByRole("region", { name: "Pillar weights" });
    await userEvent.click(within(weights).getByRole("button", { name: /^Housing/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit the rule for Overcrowding rate" }),
    );
    await screen.findByRole("table", { name: /proposals/i });
  },
  // Safety holds one unlocked criterion beside a locked one: the mock's one way to the refusal.
  "Configure, a weight change refused": async () => {
    renderShell("/configure");
    const weights = await screen.findByRole("region", { name: "Pillar weights" });
    await userEvent.click(within(weights).getByRole("button", { name: /^Safety/ }));
    const slider = await screen.findByRole("slider", { name: "Weight for Homicide rate" });
    await quiet();
    fireEvent.change(slider, { target: { value: "80" } });
    fireEvent.pointerUp(slider);
    await screen.findByRole("list", { name: /locked/i });
  },
  "Configure, nothing set": async () => {
    await replaceSettings({
      min_coverage: null,
      score_scale_max: null,
      comparator_limit: null,
      run_spend_cap_eur: null,
      refetch_older_than_days: null,
    });
    mockServer.use(
      http.get("/v1/household", () =>
        HttpResponse.json(
          { code: "household_not_configured", message: "No household has been recorded." },
          { status: 404 },
        ),
      ),
    );
    renderShell("/configure");
    await screen.findByText(/it is the first thing to fill in/i);
  },
  "Configure, no criteria set": async () => {
    mockServer.use(http.get("/v1/criteria-sets", () => HttpResponse.json({ items: [] })));
    renderShell("/configure");
    await screen.findByText(/choose a criteria set to see its criteria/i);
  },
  "Configure, the server unreachable": async () => {
    serverUnreachable();
    renderShell("/configure");
    await screen.findAllByRole("alert");
  },

  "Acquire, a run card with its gaps open, a diff chosen and hand entry open": async () => {
    renderShell("/acquire");
    await startAnAcquisition();
    await openEveryGroupIn(/which sources broke/i);
    await openEveryGroupIn(/which values went unanswered/i);

    const diff = within(
      await screen.findByRole("region", { name: /what changed between two acquisitions/i }),
    );
    await userEvent.selectOptions(
      diff.getByRole("combobox", { name: /earlier acquisition/i }),
      "5",
    );
    await userEvent.selectOptions(diff.getByRole("combobox", { name: /later acquisition/i }), "7");
    await diff.findByText("Newly acquired");

    const byHand = within(
      await screen.findByRole("region", { name: /figures you can enter by hand/i }),
    );
    const employers = await byHand.findByRole("row", { name: /international employers/i });
    await userEvent.click(
      within(employers).getByRole("button", { name: /enter a value by hand/i }),
    );
    await screen.findByRole("region", { name: /enter a value for/i });
  },
  // The mock's runs all finish or halt on the cap, so a run stopped by hand is served here.
  "Acquire, a run stopped by hand": async () => {
    mockServer.use(
      http.get("/v1/data-acquisition-runs/:runId", ({ params }) =>
        HttpResponse.json({
          ...STARTED_RUN_DETAIL,
          id: Number(params["runId"]),
          run_status: "halted_by_user",
          stop_requested_at: "2026-09-12T09:00:06Z",
        }),
      ),
    );
    renderShell("/acquire");
    await startAnAcquisition();
  },
  "Acquire, no spend cap set": async () => {
    await replaceSettings({ ...SETTINGS, run_spend_cap_eur: null });
    renderShell("/acquire");
    await screen.findByText(/no cap is set/i);
  },
  "Acquire, nothing acquired yet": async () => {
    mockServer.use(
      http.get("/v1/data-acquisition-runs", () => HttpResponse.json({ items: [], total: 0 })),
      http.get("/v1/values", () => HttpResponse.json({ items: [], total: 0 })),
    );
    renderShell("/acquire");
    await screen.findByText(/no acquisition has been started yet/i);
  },
  "Acquire, the server unreachable": async () => {
    serverUnreachable();
    renderShell("/acquire");
    await screen.findAllByRole("alert");
  },

  "Rank, a row open on a pillar, an attribute drilled into and a saved ranking open":
    async () => {
      const saved = await saveEvaluation("default", "country", "");
      renderShell(`/rank?saved=${saved.id}`);
      // The live table's row, by its toggle: the saved table beside it opens nothing.
      const toggle = await screen.findByRole("button", { name: "Portugal" });
      const portugal = toggle.closest("tr")!;
      await userEvent.click(toggle);
      await userEvent.click(await within(portugal).findByRole("button", { name: /^Economy:/ }));
      await screen.findByRole("heading", { name: /economy — stored values/i });

      const drill = within(
        screen.getByRole("region", { name: /one attribute, every candidate/i }),
      );
      await drill.findByRole("option", { name: "Cost of living index" });
      await userEvent.selectOptions(
        drill.getByRole("combobox", { name: "Attribute" }),
        "country.cost_of_living_index",
      );
      await drill.findByRole("table");

      const opened = within(await screen.findByRole("region", { name: /a saved ranking/i }));
      await opened.findByText(/as it was when it was saved/i);
    },
  "Rank, the score range unset": async () => {
    await scoreRangeUnset();
    renderShell("/rank");
    await screen.findByRole("region", { name: "No ranking" });
  },
  "Rank, nothing ranked": async () => {
    mockServer.use(
      http.get("/v1/rankings", () =>
        HttpResponse.json({
          evaluation: null,
          criteria_set: "default",
          level: "country",
          computed_at: "2026-08-30T09:15:00Z",
          candidates: [],
        }),
      ),
    );
    renderShell("/rank");
    await screen.findByText(/no candidate has been evaluated/i);
  },
  "Rank, the server unreachable": async () => {
    serverUnreachable();
    renderShell("/rank");
    // The sidebar's regions fail quietly (N4), so wait for their words, not for an alert.
    await screen.findAllByText(/could not be loaded/i);
  },

  "Compare, drawn as scores": async () => {
    renderShell("/compare");
    await askForAComparison();
    await openEconomy();
  },
  "Compare, drawn as raw figures": async () => {
    renderShell("/compare");
    await askForAComparison();
    await openEconomy();
    await userEvent.click(screen.getByRole("radio", { name: /raw figures/i }));
    await userEvent.click(screen.getByRole("radio", { name: /weighted impact/i }));
  },
  "Compare, no comparator limit set": async () => {
    await replaceSettings({ ...SETTINGS, comparator_limit: null });
    renderShell("/compare");
    await askForAComparison();
    await screen.findByRole("alert");
  },
  "Compare, the score range unset": async () => {
    await scoreRangeUnset();
    renderShell("/compare");
    await askForAComparison();
    await screen.findByRole("region", { name: "Nothing to compare" });
  },
  "Compare, nothing compared yet": async () => {
    renderShell("/compare");
    await screen.findByRole("option", { name: "Portugal" });
  },
  "Compare, the server unreachable": async () => {
    serverUnreachable();
    renderShell("/compare");
    // The sidebar's regions fail quietly (N4), so wait for their words, not for an alert.
    await screen.findAllByText(/could not be loaded/i);
  },
};

/** Every request refused at the network, as a stopped backend refuses it. */
function serverUnreachable(): void {
  mockServer.use(http.all("/v1/*", () => HttpResponse.error()));
}

/** The score range unset, refused wherever the server refuses it. */
async function scoreRangeUnset(): Promise<void> {
  await replaceSettings({ ...SETTINGS, score_scale_max: null });
  const refusal = () =>
    HttpResponse.json(
      {
        code: "score_scale_not_set",
        message: "score_scale_max is not set, so there is no scale to score onto.",
      },
      { status: 409 },
    );
  mockServer.use(
    http.get("/v1/rankings", refusal),
    http.get("/v1/rankings/candidates/:candidateId", refusal),
    http.get("/v1/comparisons", refusal),
  );
}

async function startAnAcquisition(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: /estimate an acquisition/i }));
  await userEvent.click(screen.getByRole("button", { name: /start this acquisition/i }));
  await screen.findByRole("region", { name: /acquisition 8/i });
}

async function openEveryGroupIn(region: RegExp): Promise<void> {
  const group = await screen.findByRole("region", { name: region });
  for (const head of within(group).getAllByRole("button", { expanded: false })) {
    await userEvent.click(head);
  }
}

async function askForAComparison(): Promise<void> {
  const portugal = await screen.findByRole("option", { name: "Portugal" });
  await userEvent.selectOptions(await screen.findByLabelText(/focus/i), portugal);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Netherlands" }));
  await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));
}

/** The pillar row opens onto its attributes, which is where the figures are drawn. */
async function openEconomy(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Economy" }));
  await screen.findByRole("row", { name: /cost of living index/i });
}

/**
 * **Settled means the network is quiet, not that "Loading…" has gone.** Several panels draw
 * nothing while they read -- the hand-entry card is one -- so a scan could run before them and
 * miss what they say, and a ledger entry would come and go between runs. This waits until no
 * request is in flight and the page has not changed for `QUIET_FOR_MS`.
 */
const QUIET_FOR_MS = 100;

const STILL_WAITING =
  /(Loading|Reading|Comparing|Estimating|Saving|Storing|Starting|Running|Researching)[^.…]*…/;

const inFlight = new Set<string>();
let answered = 0;

const started = ({ requestId }: { requestId: string }) => void inFlight.add(requestId);
const ended = ({ requestId }: { requestId: string }) => {
  if (inFlight.delete(requestId)) answered += 1;
};

beforeEach(() => {
  inFlight.clear();
  mockServer.events.on("request:start", started);
  mockServer.events.on("request:end", ended);
});

afterEach(() => {
  mockServer.events.removeListener("request:start", started);
  mockServer.events.removeListener("request:end", ended);
});

async function quiet(): Promise<void> {
  let seen = "";
  let since = Date.now();
  await waitFor(() => {
    const now = `${String(answered)} ${JSON.stringify(readingsOf(document.body))}`;
    if (now !== seen) {
      seen = now;
      since = Date.now();
    }
    expect(inFlight.size).toBe(0);
    expect(document.body.textContent).not.toMatch(STILL_WAITING);
    expect(Date.now() - since).toBeGreaterThanOrEqual(QUIET_FOR_MS);
  });
}

function quoted(finding: Finding): string {
  return `${finding.identifier} (${finding.reading.from}: "${finding.reading.text.trim()}")`;
}

/**
 * The scanner's own rules, on markup small enough to read. The guard above can only say that
 * nothing new was found; these say the scanner was looking.
 */
describe("what the scanner finds", () => {
  const vocabulary: Vocabulary = { enumLiterals: ["AllConditionsHold"], ids: ["default"] };

  function identifiersIn(markup: string): string[] {
    const root = document.createElement("div");
    root.innerHTML = markup;
    return findIdentifiers(root, vocabulary).map((finding) => finding.identifier);
  }

  it.each([
    ["a catalog id in a sentence", "<p>Removes country.portugal.</p>", ["country.portugal"]],
    ["a snake_case word", "<p>Status: halted_by_user</p>", ["halted_by_user"]],
    ["a client code", "<code>client.unreachable</code>", ["client.unreachable"]],
    ["an enumerated literal", "<span>AllConditionsHold, and warns</span>", ["AllConditionsHold"]],
    ["an id standing alone", "<dd>default</dd>", ["default"]],
    ["an accessible name", '<button aria-label="Weight for city.lisbon"></button>', ["city.lisbon"]],
    ["a title", '<span title="world_bank"></span>', ["world_bank"]],
    ["a placeholder", '<input placeholder="as_is">', ["as_is"]],
    ["an image's text", '<img alt="target_range">', ["target_range"]],
    ["a text field's value", '<input value="country.romania">', ["country.romania"]],
    ["a text area's value", "<textarea>not_matching</textarea>", ["not_matching"]],
  ])("finds %s", (_what, markup, expected) => {
    expect(identifiersIn(markup)).toEqual(expected);
  });

  it.each([
    ["a one-word id inside a sentence", "<p>Saved under the default set.</p>"],
    ["a link's address", "<p>Read at https://example.gov/visa_route_exists today</p>"],
    ["anything marked verbatim", "<blockquote data-verbatim><p>not_matching</p></blockquote>"],
    ["a number field's value", '<input type="number" value="12">'],
    ["a script", "<script>const not_shown = 1;</script>"],
  ])("finds nothing in %s", (_what, markup) => {
    expect(identifiersIn(markup)).toEqual([]);
  });

  it("finds an identifier once, whole, not again as a part of itself", () => {
    expect(
      identifiersIn("<p>client.malformed_error_body under country.visa_route_exists</p>"),
    ).toEqual(["country.visa_route_exists", "client.malformed_error_body"]);
  });

  it("harvests the PascalCase literals a schema enumerates, and no type name", () => {
    const schema = [
      'shape: "ShareOfHouseholdField" | "AllConditionsHold";',
      'value_type: "Count" | "LabelSet";',
      '"application/json": components["schemas"]["CriteriaSet"];',
    ].join("\n");

    expect(enumLiteralsIn(schema)).toEqual([
      "AllConditionsHold",
      "LabelSet",
      "ShareOfHouseholdField",
    ]);
    expect(VOCABULARY.enumLiterals).toEqual(
      expect.arrayContaining(["AllConditionsHold", "LabelSet"]),
    );
  });
});

/**
 * **The browser sweep runs a copy, and the copy must not drift.** A spec under `e2e/` imports
 * nothing from `src/`, so `e2e/identifiers.ts` is a second file -- and a second file is a second
 * opinion the day one of them is edited alone. Read as text, because that is the only way to
 * read a file this suite may not import.
 */
describe("the browser sweep's copy of the scanner", () => {
  const copies = {
    unit: readFileSync(join(__dirname, "..", "testing", "identifiers.ts"), "utf8"),
    browser: readFileSync(join(__dirname, "..", "..", "e2e", "identifiers.ts"), "utf8"),
  };

  function patternListIn(source: string): string[] {
    const list = /export const IDENTIFIER_PATTERNS = \{([\s\S]*?)\n\} as const;/.exec(source);
    return [...(list?.[1] ?? "").matchAll(/^ {2}(\w+): (\/.+\/[a-z]*),$/gm)].map(
      (entry) => `${entry[1] ?? ""}: ${entry[2] ?? ""}`,
    );
  }

  function functionIn(source: string, name: string): string {
    const start = source.indexOf(`export function ${name}(`);
    return start === -1 ? "" : source.slice(start, source.indexOf("\n}\n", start));
  }

  it("has the same pattern list", () => {
    // Read from the text the guard runs, so a list that failed to parse cannot pass as equal.
    const unit = patternListIn(copies.unit);
    expect(unit).toEqual(
      Object.entries(IDENTIFIER_PATTERNS).map(([name, pattern]) => `${name}: ${String(pattern)}`),
    );

    expect(patternListIn(copies.browser)).toEqual(unit);
  });

  it.each(["readingsOf", "identifiersIn"])("reads and matches the same way in %s", (name) => {
    const unit = functionIn(copies.unit, name);
    expect(unit).not.toBe("");

    expect(functionIn(copies.browser, name)).toBe(unit);
  });
});
