import { describe, expect, it } from "vitest";
import { type OpenRow, isOpen, toggleRow } from "./openRows";

const PORTUGAL: OpenRow = { candidate: "country.portugal", name: "Portugal" };
const FINLAND: OpenRow = { candidate: "country.finland", name: "Finland" };

describe("the rows a reader has opened", () => {
  it("opens a row that was closed", () => {
    expect(toggleRow([], PORTUGAL)).toEqual([PORTUGAL]);
  });

  /**
   * The whole point of the change. Opening a second candidate used to close the first, so
   * comparing two countries' evidence meant remembering one of them.
   */
  it("keeps the rows already open when another is opened", () => {
    expect(toggleRow([PORTUGAL], FINLAND)).toEqual([PORTUGAL, FINLAND]);
  });

  it("closes a row that was open, leaving the others alone", () => {
    expect(toggleRow([PORTUGAL, FINLAND], PORTUGAL)).toEqual([FINLAND]);
  });

  it("opens a row at the end, so the order is the order they were opened in", () => {
    const opened = toggleRow(toggleRow([], FINLAND), PORTUGAL);
    expect(opened.map((row) => row.candidate)).toEqual([
      "country.finland",
      "country.portugal",
    ]);
  });

  /** A candidate appearing twice would render its detail panel twice. */
  it("never holds the same candidate twice", () => {
    const again = { ...PORTUGAL, name: "Portugal (again)" };
    expect(toggleRow([PORTUGAL], again)).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const before: OpenRow[] = [PORTUGAL];
    toggleRow(before, FINLAND);
    expect(before).toEqual([PORTUGAL]);
  });

  it("says which candidates are open, and which are not", () => {
    expect(isOpen([PORTUGAL], "country.portugal")).toBe(true);
    expect(isOpen([PORTUGAL], "country.finland")).toBe(false);
    expect(isOpen([], "country.portugal")).toBe(false);
  });
});
