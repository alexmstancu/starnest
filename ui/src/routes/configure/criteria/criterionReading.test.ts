import { describe, expect, it } from "vitest";
import type { Criterion } from "../../../api/endpoints";
import {
  catalogOf,
  chipsFor,
  hasNoSource,
  titleOf,
  weightBarWidth,
} from "./criterionReading";

/**
 * What a criterion row says about itself.
 *
 * **The rule under test is that nothing is invented.** A criterion that states no threshold
 * says it states none; an attribute the catalog has not answered for gets no type line and no
 * claim about its sources. A row that guessed either would be the fabricated number this
 * application exists to avoid, in words rather than in figures.
 */

function criterion(over: Partial<Criterion> = {}): Criterion {
  return {
    attribute: "country.cost_of_living_index",
    pillar: "economics",
    weight: 50,
    goal: "minimise",
    normalisation_method: "fixed",
    ...over,
  };
}

describe("the chips on a row", () => {
  it("states the goal, the threshold and the method, in that order", () => {
    expect(
      chipsFor(
        criterion({ matching_threshold: { max_value: 20 } }),
      ).map((chip) => chip.text),
    ).toEqual(["goal: minimise", "at most 20", "scored against fixed anchors"]);
  });

  it("marks a criterion whose absence makes a candidate unscoreable", () => {
    const chips = chipsFor(criterion({ blocks_if_missing: true }));
    expect(chips.map((chip) => chip.text)).toContain("Required");
  });

  it("says a criterion that is not scored counts for matching only, and never Required", () => {
    const texts = chipsFor(
      criterion({ is_scored: false, blocks_if_missing: true }),
    ).map((chip) => chip.text);
    expect(texts).toContain("Not scored, matching only");
    expect(texts).not.toContain("Required");
  });

  it("says nothing about matching only for a scored criterion", () => {
    const texts = chipsFor(criterion({ is_scored: true })).map((chip) => chip.text);
    expect(texts).not.toContain("Not scored, matching only");
  });

  it("leaves the mark off a criterion that does not block", () => {
    const chips = chipsFor(criterion({ blocks_if_missing: false }));
    expect(chips.map((chip) => chip.text)).not.toContain("Required");
  });

  /**
   * Every source in its priority, as the server resolves it since BE-39 -- `manual` and `llm`
   * included -- so the order cannot say whether anything can fetch the attribute.
   * `answerable_by` can (`reqs.md` Q235), and both are carried so a row reading the wrong one
   * fails.
   */
  const EVERY_SOURCE = ["eurostat", "oecd", "manual", "llm"];
  const nothingCanFetch = {
    id: "country.cost_of_living_index",
    effective_source_priority: EVERY_SOURCE,
    answerable_by: [] as string[],
  };
  const eurostatCanFetch = { ...nothingCanFetch, answerable_by: ["eurostat"] };

  /** No adapter can fetch it, so no run can fill it -- which is a different gap from an empty one. */
  it("says when nothing can fetch the attribute, though every source is in its priority", () => {
    const chips = chipsFor(criterion(), nothingCanFetch);
    expect(chips.map((chip) => chip.text)).toContain("No source yet →");
    // **And it goes somewhere.** The other chips state the rule; this one states a gap, and a
    // gap with no route out leaves a reader holding a problem. The arrow says so.
    expect(chips.find((chip) => chip.key === "no-source")?.to).toBe(
      "/acquire?show=unsourced",
    );
    expect(hasNoSource(nothingCanFetch)).toBe(true);
    // PL-113. Its weight is shared among the rest of the pillar, said in a neutral pill.
    expect(chips.find((chip) => chip.key === "redistributed")).toMatchObject({
      text: "Weight redistributed",
      tone: "neutral",
    });
  });

  it("says no weight is redistributed for an attribute a source can fetch", () => {
    expect(chipsFor(criterion(), eurostatCanFetch).map((chip) => chip.key)).not.toContain(
      "redistributed",
    );
  });

  /**
   * Asked by key, not by text. The chip reads "No source yet →", so asking an array of texts
   * whether it holds "No source yet" is true whatever the row shows.
   */
  it("says nothing about sources for an attribute a source can fetch", () => {
    const chips = chipsFor(criterion(), eurostatCanFetch);
    expect(chips.map((chip) => chip.key)).not.toContain("no-source");
    expect(hasNoSource(eurostatCanFetch)).toBe(false);
  });

  /**
   * **Absent is "not said", never "nothing".** A catalog entry without the field has made no
   * claim about sources, and a chip would put one in its mouth.
   */
  it("claims nothing when the catalog does not say which sources can fetch it", () => {
    const unsaid = { id: "country.cost_of_living_index" };
    expect(
      chipsFor(criterion(), unsaid).map((chip) => chip.key),
    ).not.toContain("no-source");
    expect(hasNoSource(unsaid)).toBe(false);
  });

  /**
   * The catalog arrives in its own request. Until it does, a row knows nothing about sources --
   * and claiming a gap it has not been told about would report a pending request as a hole.
   */
  it("claims nothing about sources before the catalog has answered", () => {
    const chips = chipsFor(criterion(), undefined);
    expect(chips.map((chip) => chip.key)).not.toContain("no-source");
    expect(hasNoSource(undefined)).toBe(false);
  });

  it("omits the goal and the method a criterion does not state", () => {
    const bare: Criterion = {
      attribute: "country.homicide_rate",
      pillar: "safety",
    };
    expect(chipsFor(bare).map((chip) => chip.key)).toEqual(["threshold"]);
  });
});

describe("the width of a weight's bar", () => {
  it("is the weight itself, because the bar answers the same question", () => {
    expect(weightBarWidth(40)).toBe(40);
    expect(weightBarWidth(0)).toBe(0);
  });

  /** A pillar mid-rebalance can hold a weight above 100 for one render. */
  it("clamps to the bar it is drawn in", () => {
    expect(weightBarWidth(140)).toBe(100);
    expect(weightBarWidth(-5)).toBe(0);
  });

  it("draws nothing for a weight that is not there", () => {
    expect(weightBarWidth(undefined)).toBe(0);
    expect(weightBarWidth(Number.NaN)).toBe(0);
  });
});

describe("the catalog", () => {
  it("is keyed by attribute id, which is what a criterion names", () => {
    const catalog = catalogOf([
      { id: "country.cost_of_living_index", value_type: "Quantity" },
    ]);
    expect(catalog.get("country.cost_of_living_index")?.value_type).toBe(
      "Quantity",
    );
    expect(catalog.get("country.nothing")).toBeUndefined();
  });

  it("is empty when the catalog is", () => {
    expect(catalogOf([]).size).toBe(0);
  });
});


describe("what a row is called", () => {
  it("uses the catalog's name", () => {
    // The design bars programmatic identifiers from rendered text -- no attribute keys, rule
    // ids or settings field names -- so the id is not shown beside the name.
    expect(
      titleOf("country.cost_of_living_index", {
        id: "country.cost_of_living_index",
        name: "Cost of living index",
      }),
    ).toBe("Cost of living index");
  });

  it("reads the id as words when the catalog has not answered", () => {
    /**
     * **Never the key itself.** The design bars programmatic identifiers from rendered text,
     * and the catalog being slow or silent is no licence to print one: `attributeName` drops
     * the level, which is the thing the whole screen is about, and spaces the rest.
     *
     * This asserted the opposite until the rule was applied -- the id was the fallback on the
     * argument that spacing one is a guess at what the attribute measures.
     */
    expect(titleOf("country.overcrowding_rate", undefined)).toBe(
      "Overcrowding rate",
    );
    expect(
      titleOf("country.rent", { id: "country.rent", name: "" }),
    ).toBe("Rent");
  });

  it("keeps a name that happens to look like an id", () => {
    /** The catalog's answer is taken as given: it is somebody's decision, not a derivation. */
    expect(
      titleOf("country.rent", { id: "country.rent", name: "country.rent" }),
    ).toBe("country.rent");
  });
});
