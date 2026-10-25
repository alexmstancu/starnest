import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { isApiError } from "../../../api/ApiError";
import { fetchLevels } from "../../../api/endpoints";
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

  it("starts with no end when what was stored cannot be read", () => {
    window.sessionStorage.setItem(
      SLICES_KEY,
      JSON.stringify({ "configure/research-pass": { value: { kind: "finished" }, level: null } }),
    );

    const screen = renderScreen();

    expect(screen.pass().end).toBeNull();
  });
});
