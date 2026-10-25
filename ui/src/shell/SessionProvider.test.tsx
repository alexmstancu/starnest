import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SelectionProvider, useSelection } from "./SelectionContext";
import { SessionProvider, useSessionState } from "./SessionProvider";
import { SLICES_KEY } from "./sessionState";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SelectionProvider>
      <SessionProvider>{children}</SessionProvider>
    </SelectionProvider>
  );
}

const asNumber = (stored: unknown) => (typeof stored === "number" ? stored : undefined);

function useCounters() {
  const selection = useSelection();
  const [perLevel, setPerLevel] = useSessionState("test/per-level", 0, asNumber);
  const [everywhere, setEverywhere] = useSessionState("test/everywhere", 0, asNumber, {
    scope: "session",
  });
  const [unstored, setUnstored] = useSessionState("test/unstored", 0, asNumber, {
    persist: false,
  });
  return { selection, perLevel, setPerLevel, everywhere, setEverywhere, unstored, setUnstored };
}

async function atCountry() {
  const hook = renderHook(useCounters, { wrapper });
  await waitFor(() => expect(hook.result.current.selection.levelId).toBe("country"));
  return hook;
}

describe("the session store (PL-016)", () => {
  it("resets a level-scoped slice on a level change, even after coming back", async () => {
    const { result } = await atCountry();
    act(() => result.current.setPerLevel(3));

    act(() => result.current.selection.selectLevel("city"));
    expect(result.current.perLevel).toBe(0);
    act(() => result.current.selection.selectLevel("country"));

    expect(result.current.perLevel).toBe(0);
  });

  it("keeps a session-scoped slice across a level change", async () => {
    const { result } = await atCountry();
    act(() => result.current.setEverywhere(4));

    act(() => result.current.selection.selectLevel("city"));

    expect(result.current.everywhere).toBe(4);
  });

  it("restores a stored slice on a reload, and keeps an unpersisted one out of storage", async () => {
    const first = await atCountry();
    act(() => {
      first.result.current.setPerLevel((current) => current + 2);
      first.result.current.setUnstored(9);
    });
    first.unmount();

    const { result } = await atCountry();

    expect(result.current.perLevel).toBe(2);
    expect(result.current.unstored).toBe(0);
    expect(window.sessionStorage.getItem(SLICES_KEY)).not.toContain("test/unstored");
  });

  it("reads a stored value its parser refuses as the initial one", async () => {
    window.sessionStorage.setItem(
      SLICES_KEY,
      JSON.stringify({ "test/everywhere": { value: "seven", level: null } }),
    );

    const { result } = await atCountry();

    expect(result.current.everywhere).toBe(0);
  });

  it("refuses to be used outside its provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useSessionState("x", 0, asNumber))).toThrow(
      /inside SessionProvider/,
    );
  });
});
