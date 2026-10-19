import { act, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";
import { fetchLevels } from "../../../api/endpoints";
import { mockServer } from "../../../mocks/server";
import {
  COUNTRY_GATES,
  gatesAsked,
  watchResearch,
} from "../../../testing/research";
import { useResearchPass } from "./useResearchPass";

/**
 * UI-01. **The pass as the screen holds it**: one at a time, asked gate by gate, and abandoned
 * -- never finished in the background -- when the screen that holds it goes.
 */

const A_PASS = { level: "country", acceptUncapped: false, ceilingEur: 0.12 };

function nothingToTell(): void {
  // The answers were read again; nothing here is reading them.
}

describe("one research pass at a time", () => {
  it("ignores a second start while a pass runs", async () => {
    const research = watchResearch();
    const { result } = renderHook(() => useResearchPass(nothingToTell));

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
    const { result } = renderHook(() => useResearchPass(nothingToTell));

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
    const { result, unmount } = renderHook(() =>
      useResearchPass(nothingToTell),
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
