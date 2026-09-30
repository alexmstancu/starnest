import { describe, expect, it } from "vitest";
import { highlighted, linkTo, SHOW, UNSOURCED } from "./highlight";

describe("sending a reader to a particular card", () => {
  it("reads the card a link named", () => {
    expect(highlighted(`?${SHOW}=${UNSOURCED}`)).toBe(UNSOURCED);
  });

  it("highlights nothing when the URL names nothing", () => {
    expect(highlighted("")).toBeNull();
    expect(highlighted("?level=country")).toBeNull();
  });

  it("ignores a name it does not know rather than throwing", () => {
    // A URL somebody edited by hand is not an error. It is a URL that says nothing.
    expect(highlighted(`?${SHOW}=whatever`)).toBeNull();
  });

  it("builds a link that survives a reload and a copy", () => {
    expect(linkTo("/acquire", UNSOURCED)).toBe("/acquire?show=unsourced");
  });

  it("finds the card among other parameters", () => {
    expect(highlighted(`?level=country&${SHOW}=${UNSOURCED}`)).toBe(UNSOURCED);
  });
});
