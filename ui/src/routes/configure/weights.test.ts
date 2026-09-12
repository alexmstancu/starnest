import { describe, expect, it } from "vitest";
import { totalOf, weightAsText, weightFrom } from "./weights";

/** Reading a typed weight, which both levels of weighting do and neither's markup should. */

describe("reading a typed weight", () => {
  it("reads a number", () => {
    expect(weightFrom("40")).toBe(40);
    expect(weightFrom("29.17")).toBe(29.17);
  });

  it("refuses an empty field rather than calling it zero", () => {
    expect(weightFrom("")).toBeNull();
    expect(weightFrom("   ")).toBeNull();
  });

  it("refuses something that is not a number at all", () => {
    /** Nothing is sent, so the refusal is about weights rather than about parsing. */
    expect(weightFrom("ten")).toBeNull();
    expect(weightFrom("4o")).toBeNull();
  });

  it("refuses an infinity, which is a number and not a percentage", () => {
    expect(weightFrom("Infinity")).toBeNull();
  });

  it("keeps a real zero, which is a weight somebody chose", () => {
    expect(weightFrom("0")).toBe(0);
  });
});

describe("showing a stored weight", () => {
  it("prints the number", () => {
    expect(weightAsText(65)).toBe("65");
  });

  it("shows an absent weight as empty, never as a zero standing in for not set", () => {
    expect(weightAsText(undefined)).toBe("");
  });
});

describe("the running total", () => {
  it("adds the weights up", () => {
    expect(totalOf([{ weight: 40 }, { weight: 35 }, { weight: 25 }])).toBe(100);
  });

  it("is zero for a set that weighs nothing yet", () => {
    expect(totalOf([])).toBe(0);
  });
});
