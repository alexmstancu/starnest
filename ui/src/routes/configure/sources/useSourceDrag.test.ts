import { describe, expect, it } from "vitest";
import { advertiseMove } from "./useSourceDrag";

/**
 * Telling the browser a drag is a move.
 *
 * The gesture itself is exercised through the panel, where a real `dragstart` on a real row is
 * the only honest way to drive it. What is worth testing here on its own is the guard: it
 * exists for the case where there is no `DataTransfer` to talk to, which is every run of the
 * suite, and a guard nobody tests in both directions is a guard that can be deleted silently.
 */
describe("advertising a drag as a move", () => {
  it("says move, and leaves a payload for the browsers that insist on one", () => {
    const set: [string, string][] = [];
    const transfer = {
      effectAllowed: "none",
      setData: (format: string, data: string) => set.push([format, data]),
    } as unknown as DataTransfer;

    advertiseMove(transfer, "eurostat");

    expect(transfer.effectAllowed).toBe("move");
    expect(set).toEqual([["text/plain", "eurostat"]]);
  });

  /**
   * **jsdom implements no `DataTransfer` at all**, and the field is typed as always present.
   * Without this the handler would throw on every `dragstart` the suite fires, and the gesture
   * would be the one part of the drag no test could reach.
   */
  it("does nothing where there is no transfer to talk to", () => {
    expect(() => {
      advertiseMove(undefined, "eurostat");
    }).not.toThrow();
    expect(() => {
      advertiseMove(null, "eurostat");
    }).not.toThrow();
  });
});
