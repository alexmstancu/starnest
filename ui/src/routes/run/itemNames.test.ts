import { describe, expect, it } from "vitest";
import { groupLabel, itemPhrase } from "./itemNames";

/**
 * The design's rule, as something the suite fails on: **no programmatic identifiers in
 * rendered text**. Every assertion here is what a reader sees.
 */

const NAMES = {
  attributes: new Map([
    ["country.rail_passenger_km", "Rail passenger-km"],
    ["country.total_tax_rate_effective", "Total tax rate"],
  ]),
  candidates: new Map([
    ["country.malta", "Malta"],
    ["country.liechtenstein", "Liechtenstein"],
  ]),
};

describe("one item of an acquisition, as a phrase", () => {
  it("reads as the design writes it", () => {
    expect(
      itemPhrase(NAMES, {
        candidate: "country.malta",
        attribute: "country.rail_passenger_km",
      }),
    ).toBe("Rail passenger-km for Malta");
  });

  /** The separator the design bars outright, and the juxtaposition it replaced. */
  it("joins the two facts with a word, never a separator", () => {
    const phrase = itemPhrase(NAMES, {
      candidate: "country.malta",
      attribute: "country.rail_passenger_km",
    });

    expect(phrase).not.toContain("·");
    expect(phrase).not.toContain("Malta Rail");
  });

  /**
   * **A failure of the name fetch is silence, not a key.** The maps come back empty, and the
   * fallback strips the level prefix and capitalises -- "Rail passenger km for Malta" reads as
   * a phrase, where `country.rail_passenger_km` reads as a key.
   */
  it("still reads as a phrase when neither catalog answered", () => {
    const phrase = itemPhrase(
      { attributes: new Map(), candidates: new Map() },
      { candidate: "country.malta", attribute: "country.rail_passenger_km" },
    );

    expect(phrase).toBe("Rail passenger km for Malta");
    expect(phrase).not.toContain("country.");
    expect(phrase).not.toContain("_");
  });

  it("names the half it can when only one catalog answered", () => {
    expect(
      itemPhrase(
        { attributes: NAMES.attributes, candidates: new Map() },
        { candidate: "country.malta", attribute: "country.rail_passenger_km" },
      ),
    ).toBe("Rail passenger-km for Malta");
    expect(
      itemPhrase(
        { attributes: new Map(), candidates: NAMES.candidates },
        { candidate: "country.malta", attribute: "country.rail_passenger_km" },
      ),
    ).toBe("Rail passenger km for Malta");
  });

  /** An item the run described incompletely still has to read as words. */
  it("says something readable for an item with no identifier at all", () => {
    expect(itemPhrase(NAMES, { candidate: "", attribute: "" })).toBe(" for ");
  });
});

describe("what to call a group of items", () => {
  /**
   * **A source is already its own name and an attribute is not.** Passing both through one
   * naming function would print "Oecd" for a publisher every other panel here calls "oecd".
   */
  it("leaves a source alone, because the key is the publisher's name", () => {
    expect(groupLabel(NAMES, "data_source", "oecd")).toBe("oecd");
    expect(groupLabel(NAMES, "data_source", "eurostat")).toBe("eurostat");
  });

  it("names an attribute, because the key is a key", () => {
    expect(groupLabel(NAMES, "attribute", "country.rail_passenger_km")).toBe(
      "Rail passenger-km",
    );
  });

  it("falls back to the id made readable for an attribute nobody named", () => {
    expect(groupLabel(NAMES, "attribute", "country.overcrowding_rate")).toBe(
      "Overcrowding rate",
    );
  });
});
