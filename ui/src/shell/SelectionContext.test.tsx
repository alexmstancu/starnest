import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { SelectionProvider, useSelection } from "./SelectionContext";

const BASE = "/v1";

function wrapper({ children }: { children: ReactNode }) {
  return <SelectionProvider>{children}</SelectionProvider>;
}

describe("the selection's read (PL-009, PL-010)", () => {
  it("is pending, with no sets, until both lists have arrived", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    expect(result.current.read.state).toBe("pending");
    expect(result.current.criteriaSets).toEqual([]);
  });

  it("is failed when either list fails, never an empty ready", async () => {
    mockServer.use(http.get(`${BASE}/levels`, () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useSelection(), { wrapper });

    await waitFor(() => expect(result.current.read.state).toBe("failed"));
  });

  it("keeps the sets while they are read again, and reload settles once they land", async () => {
    let release = () => {};
    let reads = 0;
    mockServer.use(
      http.get(`${BASE}/criteria-sets`, async () => {
        reads += 1;
        if (reads > 1) await new Promise<void>((resolve) => (release = resolve));
        return undefined;
      }),
    );
    const { result } = renderHook(() => useSelection(), { wrapper });
    await waitFor(() => expect(result.current.read.state).toBe("ready"));
    const sets = result.current.criteriaSets;
    expect(sets.length).toBeGreaterThan(0);

    let settled = false;
    act(() => {
      void result.current.reloadAndWait().then(() => (settled = true));
    });

    await waitFor(() => expect(reads).toBe(2));
    expect(result.current.criteriaSets).toBe(sets);
    expect(result.current.read).toMatchObject({ state: "ready", refresh: "running" });
    expect(settled).toBe(false);

    act(() => release());
    await waitFor(() => expect(settled).toBe(true));
    expect(result.current.read).toMatchObject({ state: "ready", refresh: "idle" });
  });
});
