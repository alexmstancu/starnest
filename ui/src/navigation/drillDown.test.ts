import { describe, expect, it } from "vitest";
import { drillDownAsked, drillDownPath, withoutDrillDown } from "./drillDown";

describe("an address that opens a candidate on Rank (PL-084)", () => {
  it("reads back the candidate, pillar and level its own link names", () => {
    const asked = { candidate: "country.portugal", pillar: "governance", level: "country" };

    const address = new URL(drillDownPath(asked), "http://localhost");

    expect(address.pathname).toBe("/rank");
    expect(drillDownAsked(address.search)).toEqual(asked);
  });

  it("leaves out a pillar and a level it was not given", () => {
    const address = new URL(
      drillDownPath({ candidate: "country.spain", pillar: null, level: null }),
      "http://localhost",
    );

    expect(address.search).toBe("?candidate=country.spain");
    expect(drillDownAsked(address.search)).toEqual({
      candidate: "country.spain",
      pillar: null,
      level: null,
    });
  });

  it("ignores an address that names nothing usable", () => {
    expect(drillDownAsked("")).toBeNull();
    expect(drillDownAsked("?candidate=")).toBeNull();
    expect(drillDownAsked("?candidate=%20&pillar=governance")).toBeNull();
    expect(drillDownAsked("?pillar=governance")).toBeNull();
    expect(drillDownAsked("?show=unsourced")).toBeNull();
    expect(drillDownAsked("?candidate=country.spain&pillar=")).toEqual({
      candidate: "country.spain",
      pillar: null,
      level: null,
    });
  });

  it("takes the request out and keeps the rest of the address", () => {
    expect(
      withoutDrillDown("?saved=4&candidate=country.spain&pillar=safety&level=country").toString(),
    ).toBe("saved=4");
  });
});
