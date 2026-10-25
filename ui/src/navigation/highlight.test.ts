import { describe, expect, it } from "vitest";
import {
  handEntryAsked,
  highlighted,
  linkTo,
  linkToHandEntry,
  SHOW,
  UNSOURCED,
} from "./highlight";

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

describe("sending a reader to one attribute's hand-entry form", () => {
  it("names the attribute the arriving screen opens", () => {
    const link = linkToHandEntry("/acquire", "country.residency_admin_ease");
    expect(link).toBe("/acquire?show=hand-entry&attribute=country.residency_admin_ease");
    expect(handEntryAsked(link.slice(link.indexOf("?")))).toBe("country.residency_admin_ease");
  });

  it("opens nothing when the link names another card or no attribute", () => {
    expect(handEntryAsked("?show=unsourced&attribute=country.rent")).toBeNull();
    expect(handEntryAsked("?show=hand-entry")).toBeNull();
    expect(handEntryAsked("?show=hand-entry&attribute=")).toBeNull();
  });
});
