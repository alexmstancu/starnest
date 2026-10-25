import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SLICES_KEY,
  readLastUsedSelection,
  readSlices,
  readTabSelection,
  writeSelection,
  writeSlices,
} from "./sessionState";

describe("the session's storage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads back what it wrote, keeping each slice's level", () => {
    writeSlices({ "rank/open": { value: [{ candidate: "country.portugal" }], level: "country" } });

    expect(readSlices()).toEqual({
      "rank/open": { value: [{ candidate: "country.portugal" }], level: "country" },
    });
  });

  it.each([
    ["not JSON", "{oops"],
    ["not an object", "[1, 2]"],
  ])("ignores a stored entry that is %s", (_what, stored) => {
    window.sessionStorage.setItem(SLICES_KEY, stored);

    expect(readSlices()).toEqual({});
  });

  it("drops a malformed slice and keeps the rest", () => {
    window.sessionStorage.setItem(
      SLICES_KEY,
      JSON.stringify({ broken: 3, kept: { value: 1, level: null } }),
    );

    expect(readSlices()).toEqual({ kept: { value: 1, level: null } });
  });

  it("opens a new tab on a selection only when it was chosen, never when it was restored", () => {
    writeSelection({ criteriaSet: { id: "default", name: "Default" }, levelId: "country" }, { lastUsed: true });
    writeSelection(
      { criteriaSet: { id: "remote_only", name: "Remote only" }, levelId: "country" },
      { lastUsed: false },
    );

    expect(readTabSelection()?.criteriaSet?.id).toBe("remote_only");
    expect(readLastUsedSelection()?.criteriaSet?.id).toBe("default");
  });

  it("lives in memory only when storage is unavailable, and never throws", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => writeSlices({ any: { value: 1, level: null } })).not.toThrow();
    expect(() =>
      writeSelection({ criteriaSet: null, levelId: "country" }, { lastUsed: true }),
    ).not.toThrow();
    expect(readSlices()).toEqual({});
    expect(readTabSelection()).toBeUndefined();
  });
});
