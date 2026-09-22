import { describe, expect, it } from "vitest";
import { acquiringProgress } from "./acquiringProgress";

describe("how far through an acquisition is", () => {
  it("reads as a count of what is done out of what there is", () => {
    expect(acquiringProgress(12, 96)).toEqual({
      reading: "12 of 96",
      portion: 12.5,
    });
  });

  /** A run that has not said how much there is to do has not failed to do any of it. */
  it("says it is starting rather than none of none", () => {
    expect(acquiringProgress(0, 0)).toEqual({
      reading: "starting",
      portion: 0,
    });
  });

  it("never draws past the end of the track", () => {
    expect(acquiringProgress(120, 96).portion).toBe(100);
  });

  it("never draws behind the start of it", () => {
    expect(acquiringProgress(-5, 96).portion).toBe(0);
  });

  it("is full when everything is done", () => {
    expect(acquiringProgress(96, 96)).toEqual({
      reading: "96 of 96",
      portion: 100,
    });
  });
});
