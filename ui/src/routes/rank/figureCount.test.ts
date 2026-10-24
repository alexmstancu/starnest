import { describe, expect, it } from "vitest";
import { describeFigureCount } from "./figureCount";

/** PL-077: "N of M candidates have a figure", counting candidates rather than rows. */
describe("how many candidates have a figure, in words", () => {
  const PORTUGAL = { candidate: "country.portugal" };
  const SPAIN = { candidate: "country.spain" };

  it("counts a candidate once however many of its options have a figure", () => {
    expect(describeFigureCount([PORTUGAL, PORTUGAL, SPAIN], 32)).toBe(
      "2 of 32 candidates have a figure for this attribute.",
    );
  });

  it("agrees with a single candidate", () => {
    expect(describeFigureCount([PORTUGAL, PORTUGAL], 32)).toBe(
      "1 of 32 candidates has a figure for this attribute.",
    );
  });

  it("gives no total while the roster is unknown, rather than a total of nothing", () => {
    expect(describeFigureCount([PORTUGAL, SPAIN])).toBe(
      "2 candidates have a figure for this attribute.",
    );
    expect(describeFigureCount([PORTUGAL])).toBe(
      "1 candidate has a figure for this attribute.",
    );
  });
});
