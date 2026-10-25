import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { isApiError } from "../../../api/ApiError";
import { fetchLevels, putMatchRuleResult } from "../../../api/endpoints";
import { mockServer } from "../../../mocks/server";
import { SelectionProvider } from "../../../shell/SelectionContext";
import { SessionProvider } from "../../../shell/SessionProvider";
import { SLICES_KEY } from "../../../shell/sessionState";
import {
  COUNTRY_GATES,
  gatesAsked,
  watchResearch,
} from "../../../testing/research";
import { type ResearchPass, useResearchPass } from "./useResearchPass";

/**
 * UI-01. **The pass as the screen holds it**: one at a time, asked gate by gate, and abandoned
 * -- never finished in the background -- when the screen that holds it goes.
 */

/** What is said of a stored outcome this build cannot trust: never a figure. */
const UNREADABLE =
  "An earlier pass's outcome could not be read. What research spent this month is counted in Acquire's “Spent this month”.";

const A_PASS = {
  level: "country",
  questionsTotal: 3,
  acceptUncapped: false,
  ceilingEur: 0.12,
};

function nothingToTell(): void {
  // The answers were read again; nothing here is reading them.
}

/** The shell's providers, which keep the pass above the screen (PL-052). */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <SelectionProvider>
      <SessionProvider>{children}</SessionProvider>
    </SelectionProvider>
  );
}

describe("one research pass at a time", () => {
  it("ignores a second start while a pass runs", async () => {
    const research = watchResearch();
    const { result } = renderHook(() => useResearchPass(nothingToTell), { wrapper });

    act(() => {
      result.current.start(A_PASS);
      result.current.start({ ...A_PASS, acceptUncapped: true });
    });

    await waitFor(() => expect(result.current.end?.kind).toBe("finished"));
    expect(gatesAsked(research)).toEqual(COUNTRY_GATES.map((gate) => [gate]));
    expect(research.sent.map((body) => body.accept_uncapped_spend)).toEqual(
      COUNTRY_GATES.map(() => false),
    );
  });

  it("does not let a Stop pressed with no pass running stop the next one", async () => {
    const research = watchResearch();
    const { result } = renderHook(() => useResearchPass(nothingToTell), { wrapper });

    act(() => result.current.stop());
    act(() => result.current.start(A_PASS));

    await waitFor(() => expect(result.current.end?.kind).toBe("finished"));
    expect(gatesAsked(research)).toEqual(COUNTRY_GATES.map((gate) => [gate]));
  });

  it("tells the screen the answers moved once, when the pass is over", async () => {
    watchResearch();
    const told = { times: 0 };
    const { result } = renderHook(() =>
      useResearchPass(() => {
        told.times += 1;
      }),
      { wrapper },
    );

    act(() => result.current.start(A_PASS));

    await waitFor(() => expect(result.current.end?.kind).toBe("finished"));
    expect(told.times).toBe(1);
  });
});

describe("leaving while a pass runs", () => {
  it("asks nothing once the screen goes while the pass reads its spend cap", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads = { sent: 0, answered: 0 };
    mockServer.use(
      http.get("/v1/settings", async () => {
        reads.sent += 1;
        await held;
        reads.answered += 1;
        return undefined;
      }),
    );
    const research = watchResearch();
    const { result, unmount } = renderHook(
      () => useResearchPass(nothingToTell),
      { wrapper },
    );
    act(() => result.current.start(A_PASS));
    await waitFor(() => expect(reads.sent).toBe(1));

    unmount();
    release();

    await waitFor(() => expect(reads.answered).toBe(1));
    // A round trip through the mock after the read was answered, by which a question would
    // have been asked.
    await fetchLevels();
    expect(research.sent).toEqual([]);
  });
});

/**
 * PL-052. **What a pass did outlives the screen that ran it.** Money it spent must never leave
 * the page unsaid, so how it ended is kept in the session store -- through leaving Configure, a
 * reload and a remount -- until the reader dismisses it. A pass the page stopped running is
 * recorded as abandoned, with what it had spent, rather than dropped.
 */
describe("the last pass's end, kept until it is dismissed", () => {
  /** The shell's providers stay; the screen holding the pass comes and goes beneath them. */
  function renderScreen() {
    const seen: { current: ResearchPass | null } = { current: null };
    function Screen() {
      seen.current = useResearchPass(nothingToTell);
      return null;
    }
    function Shell({ screen }: { screen: boolean }) {
      return (
        <SelectionProvider>
          <SessionProvider>{screen && <Screen />}</SessionProvider>
        </SelectionProvider>
      );
    }
    const page = render(<Shell screen />);
    return {
      pass: (): ResearchPass => {
        if (seen.current === null) throw new Error("the screen is not mounted");
        return seen.current;
      },
      leave: () => {
        page.rerender(<Shell screen={false} />);
        seen.current = null;
      },
      comeBack: () => page.rerender(<Shell screen />),
      reload: () => {
        page.unmount();
        seen.current = null;
        return renderScreen();
      },
    };
  }

  /** Free movement applies: the second gate, asked once the first has cost four cents. */
  const SECOND_GATE = COUNTRY_GATES[1];

  it("keeps how the last pass ended, and what it spent, once the screen goes and comes back", async () => {
    watchResearch();
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(screen.pass().end?.kind).toBe("finished"));

    screen.leave();
    screen.comeBack();

    expect(screen.pass().end?.kind).toBe("finished");
    expect(screen.pass().statusLine?.text).toBe(
      "The last pass at the Country level asked every gate: it asked 3 of 3 questions and spent €0.12 of at most €0.12.",
    );
  });

  it("keeps it across a reload of the page", async () => {
    watchResearch();
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(screen.pass().end?.kind).toBe("finished"));

    const reloaded = screen.reload();

    expect(reloaded.pass().end?.kind).toBe("finished");
    expect(reloaded.pass().statusLine?.text).toMatch(/spent €0\.12 of at most €0\.12/);
  });

  it("records a pass left mid-question as abandoned, with what it had spent and the question in flight", async () => {
    const research = watchResearch({ holdAt: 2 });
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(research.sent).toHaveLength(2));

    screen.leave();
    research.release();
    screen.comeBack();

    await waitFor(() => expect(screen.pass().end?.kind).toBe("abandoned"));
    expect(screen.pass().running).toBe(false);
    expect(screen.pass().statusLine).toEqual({
      text:
        "The last pass at the Country level ended when you left Configure while Free movement " +
        "applies was being asked, and what that question spent is not known: before it, the " +
        "pass asked 1 of 3 questions and spent €0.04 of at most €0.12.",
      warning: true,
    });
    expect(gatesAsked(research)).toEqual([[COUNTRY_GATES[0]], [SECOND_GATE]]);
  });

  it("records a pass left while it read the spend cap as abandoned, having asked nothing", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads = { sent: 0 };
    mockServer.use(
      http.get("/v1/settings", async () => {
        reads.sent += 1;
        await held;
        return undefined;
      }),
    );
    const research = watchResearch();
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(reads.sent).toBe(1));

    screen.leave();
    release();
    screen.comeBack();

    await waitFor(() => expect(screen.pass().end?.kind).toBe("abandoned"));
    expect(screen.pass().statusLine?.text).toBe(
      "The last pass at the Country level ended when you left Configure: it asked 0 of 3 questions and spent nothing.",
    );
    expect(research.sent).toEqual([]);
  });

  it("records a pass a reload cut short as abandoned", async () => {
    const research = watchResearch({ holdAt: 2 });
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(research.sent).toHaveLength(2));

    const reloaded = screen.reload();
    research.release();

    await waitFor(() => expect(reloaded.pass().end?.kind).toBe("abandoned"));
    expect(reloaded.pass().statusLine?.text).toMatch(/spent €0\.04 of at most €0\.12/);
  });

  it("forgets the end once dismissed, here and after a reload", async () => {
    watchResearch();
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(screen.pass().end?.kind).toBe("finished"));

    act(() => screen.pass().dismiss());

    expect(screen.pass().end).toBeNull();
    expect(screen.pass().statusLine).toBeNull();
    expect(screen.reload().pass().end).toBeNull();
  });

  it("dismisses nothing while a pass runs", async () => {
    const research = watchResearch({ holdAt: 2 });
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(research.sent).toHaveLength(2));

    act(() => screen.pass().dismiss());
    research.release();

    await waitFor(() => expect(screen.pass().end?.kind).toBe("finished"));
  });

  it("keeps a failed read's code and details through a reload, never the server's sentence", async () => {
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json(
          { code: "internal_error", message: "the settings table is locked" },
          { status: 500 },
        ),
      ),
    );
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(screen.pass().end?.kind).toBe("unread"));

    const reloaded = screen.reload();

    const failure = reloaded.pass().failure;
    expect(isApiError(failure) && [failure.code, failure.status]).toEqual(["internal_error", 500]);
    expect(window.sessionStorage.getItem(SLICES_KEY)).not.toContain("locked");
  });

  const FINISHED =
    "The last pass at the Country level asked every gate: it asked 3 of 3 questions and spent €0.12 of at most €0.12.";

  /** A pass that spent twelve cents, still on screen: what a later start must not take away. */
  async function aPassThatSpent() {
    const research = watchResearch();
    const screen = renderScreen();
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(screen.pass().statusLine?.text).toBe(FINISHED));
    return { screen, research };
  }

  it("keeps an outcome that spent when the next start is refused before it asks anything", async () => {
    const { screen } = await aPassThatSpent();
    mockServer.use(
      http.post("/v1/match-rule-research", () =>
        HttpResponse.json({ code: "spend_cap_not_set", message: "no cap" }, { status: 409 }),
      ),
    );

    act(() => screen.pass().start(A_PASS));

    await waitFor(() => expect(screen.pass().end?.kind).toBe("refused"));
    expect(screen.pass().statusLine?.text).toMatch(/was refused at A visa route exists, which spent nothing/);
    expect(screen.pass().keptLine?.text).toBe(
      "The pass before it at the Country level asked every gate: it asked 3 of 3 questions and spent €0.12 of at most €0.12.",
    );
    expect(screen.reload().pass().statusLine?.text).toBe(FINISHED);
  });

  it("keeps an outcome that spent when the next pass cannot read its spend cap", async () => {
    const { screen } = await aPassThatSpent();
    mockServer.use(
      http.get("/v1/settings", () =>
        HttpResponse.json({ code: "internal_error", message: "down" }, { status: 500 }),
      ),
    );

    act(() => screen.pass().start(A_PASS));

    await waitFor(() => expect(screen.pass().end?.kind).toBe("unread"));
    expect(screen.pass().keptLine?.text).toMatch(/spent €0\.12 of at most €0\.12/);
    expect(screen.reload().pass().statusLine?.text).toBe(FINISHED);
  });

  it("keeps an outcome that spent through a later pass left before it asked anything", async () => {
    const { screen } = await aPassThatSpent();
    const reads = { sent: 0 };
    mockServer.use(
      http.get("/v1/settings", async () => {
        reads.sent += 1;
        await new Promise<void>(() => undefined);
      }),
    );
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(reads.sent).toBe(1));
    expect(screen.pass().keptLine?.text).toMatch(/spent €0\.12/);

    screen.leave();
    screen.comeBack();

    await waitFor(() => expect(screen.pass().statusLine?.text).toBe(FINISHED));
    expect(screen.pass().keptLine).toBeNull();
  });

  it("replaces an outcome with a later pass that asked", async () => {
    const { screen } = await aPassThatSpent();

    act(() => screen.pass().start({ ...A_PASS, ceilingEur: 0.2 }));

    await waitFor(() =>
      expect(screen.pass().statusLine?.text).toMatch(/spent €0\.12 of at most €0\.20/),
    );
    expect(screen.pass().keptLine).toBeNull();
  });

  /** A record as a pass stores it, which each case below spoils in one place. */
  function storedPass(spoil: (record: { pass: { tally: Record<string, unknown> } & Record<string, unknown> }) => void) {
    const record = {
      kind: "finished",
      pass: {
        level: "country",
        gates: [{ id: "country.visa_route_exists", name: "A visa route exists" }],
        questionsTotal: 3,
        capEur: 10,
        ceilingEur: 0.12,
        tally: {
          asked: 1,
          calls: 1,
          spentMicroEur: 40_000,
          proposed: 0,
          refusals: [],
          haltedOnSpendCap: false,
        },
      },
    };
    spoil(record);
    window.sessionStorage.setItem(
      SLICES_KEY,
      JSON.stringify({ "configure/research-pass": { value: record, level: null } }),
    );
  }

  it("reads a sound stored record as it was", () => {
    storedPass(() => undefined);

    expect(renderScreen().pass().statusLine?.text).toMatch(/spent €0\.04 of at most €0\.12/);
  });

  it.each([
    ["a negative spend", (r: { pass: { tally: Record<string, unknown> } }) => { r.pass.tally["spentMicroEur"] = -40_000; }],
    ["a fractional spend", (r: { pass: { tally: Record<string, unknown> } }) => { r.pass.tally["spentMicroEur"] = 0.5; }],
    ["an absurd spend", (r: { pass: { tally: Record<string, unknown> } }) => { r.pass.tally["spentMicroEur"] = 1e18; }],
    ["a spend that is not a number", (r: { pass: { tally: Record<string, unknown> } }) => { r.pass.tally["spentMicroEur"] = null; }],
    ["a negative count of calls", (r: { pass: { tally: Record<string, unknown> } }) => { r.pass.tally["calls"] = -1; }],
    ["more gates asked than there are", (r: { pass: { tally: Record<string, unknown> } }) => { r.pass.tally["asked"] = 2; }],
    ["a negative ceiling", (r: { pass: Record<string, unknown> }) => { r.pass["ceilingEur"] = -0.12; }],
    ["a negative cap", (r: { pass: Record<string, unknown> }) => { r.pass["capEur"] = -10; }],
    ["a fractional count of questions", (r: { pass: Record<string, unknown> }) => { r.pass["questionsTotal"] = 2.5; }],
  ])("says an earlier outcome could not be read, rather than show %s", (_case, spoil) => {
    storedPass(spoil);

    const pass = renderScreen().pass();

    expect(pass.statusLine).toEqual({ text: UNREADABLE, warning: true });
    expect(pass.statusLine?.text).not.toMatch(/€/);
  });

  /** One research answer that made no model call and cost nothing: a gate research skipped. */
  function noCall(proposals: unknown[] = []): Response {
    return HttpResponse.json({
      proposals,
      refusals: [],
      cost_eur: 0,
      calls: 0,
      halted_on_spend_cap: false,
    });
  }

  function refusedForWantOfACap(): Response {
    return HttpResponse.json({ code: "spend_cap_not_set", message: "no cap" }, { status: 409 });
  }

  const KEPT = /^The pass before it at the Country level asked every gate: .*spent €0\.12 of at most €0\.12\.$/;

  it("keeps an outcome that spent through a pass whose answered gate made no call, then refused", async () => {
    const { screen } = await aPassThatSpent();
    watchResearch({
      answer: (_body, index) => (index === 1 ? noCall([{ is_proposal: true }]) : refusedForWantOfACap()),
    });

    act(() => screen.pass().start(A_PASS));

    await waitFor(() => expect(screen.pass().end?.kind).toBe("refused"));
    expect(screen.pass().keptLine?.text).toMatch(KEPT);
    expect(screen.reload().pass().statusLine?.text).toBe(FINISHED);
  });

  it("keeps an outcome that spent through a pass that skipped every gate, and a refusal after it", async () => {
    const { screen } = await aPassThatSpent();
    watchResearch({ answer: () => noCall() });

    act(() => screen.pass().start(A_PASS));

    await waitFor(() => expect(screen.pass().end?.kind).toBe("finished"));
    expect(screen.pass().keptLine?.text).toMatch(KEPT);
    watchResearch({ answer: () => refusedForWantOfACap() });
    act(() => screen.pass().start(A_PASS));
    await waitFor(() => expect(screen.pass().end?.kind).toBe("refused"));
    expect(screen.pass().keptLine?.text).toMatch(KEPT);
    expect(screen.reload().pass().statusLine?.text).toBe(FINISHED);
  });

  interface Spoilable {
    kind: string;
    pass: Record<string, unknown> & { gates: unknown[]; tally: Record<string, unknown> };
  }

  it.each<[string, (record: Spoilable) => void]>([
    ["a spend with no gate to ask", (r) => { r.pass.gates = []; r.pass.tally["asked"] = 0; }],
    ["a spend with no call", (r) => { r.pass.tally["calls"] = 0; }],
    ["a finished pass that did not ask every gate", (r) => { r.pass.gates.push({ id: "country.eu_free_movement", name: "Free movement applies" }); }],
    ["a pass that never started, with a spend", (r) => { r.kind = "unread"; }],
    ["an abandoned pass asking a gate that was not next", (r) => {
      r.kind = "abandoned";
      Object.assign(r, { inFlight: { id: "country.eu_free_movement", name: "Free movement applies" } });
    }],
  ])("says an earlier outcome could not be read, rather than a figure from %s", (_case, spoil) => {
    storedPass(spoil as never);

    expect(renderScreen().pass().statusLine).toEqual({ text: UNREADABLE, warning: true });
  });

  it("reads a record nested past one kept outcome as unreadable, never as a throw", () => {
    const depth = 12_000;
    // Each level a sound running pass in itself, so only its depth is wrong.
    const pass = JSON.stringify({
      level: "country",
      gates: [],
      questionsTotal: 3,
      capEur: null,
      ceilingEur: 0.12,
      tally: { asked: 0, calls: 0, spentMicroEur: 0, proposed: 0, refusals: [], haltedOnSpendCap: false },
    });
    const level = `{"kind":"running","pass":${pass},"inFlight":null,"kept":`;
    const nested = `${level.repeat(depth)}null${"}".repeat(depth)}`;
    window.sessionStorage.setItem(
      SLICES_KEY,
      `{"configure/research-pass":{"value":${nested},"level":null}}`,
    );

    expect(renderScreen().pass().statusLine).toEqual({ text: UNREADABLE, warning: true });
  });

  it("keeps a re-check's outcome, naming it as one, across a reload", async () => {
    await putMatchRuleResult("country.visa_route_exists", "country.portugal", {
      match_result: "matching",
      data_source: "manual",
    });
    const screen = renderScreen();
    act(() =>
      screen.pass().start({
        ...A_PASS,
        questionsTotal: 1,
        ceilingEur: 0.04,
        recheck: [
          { id: "country.visa_route_exists", candidate: "country.portugal", name: "A visa route exists for Portugal" },
        ],
      }),
    );
    await waitFor(() => expect(screen.pass().end?.kind).toBe("finished"));

    expect(screen.reload().pass().statusLine?.text).toBe(
      "The last re-check at the Country level re-checked every answer: it asked 1 of 1 question and spent €0.04 of at most €0.04.",
    );
  });

  it("forgets an outcome that could not be read once dismissed", () => {
    storedPass((r) => { r.pass.tally["spentMicroEur"] = -1; });
    const screen = renderScreen();

    act(() => screen.pass().dismiss());

    expect(screen.pass().statusLine).toBeNull();
  });

  it("starts with no end when what was stored cannot be read", () => {
    window.sessionStorage.setItem(
      SLICES_KEY,
      JSON.stringify({ "configure/research-pass": { value: { kind: "finished" }, level: null } }),
    );

    const screen = renderScreen();

    expect(screen.pass().end).toBeNull();
  });
});
